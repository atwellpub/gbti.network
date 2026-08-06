// sow-185: the deploy-pipeline side of the "still deploying" notice. Verifies path classification, the
// creds-gated no-ops, the watermark read/write shape, and -- the part that actually protects notice coverage
// during a burst -- that mark/clear hit the right per-item KV keys with a TTL, and that a missing watermark
// falls back cleanly. Injected fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  contentPathsChanged, readWatermark, writeWatermark, markPendingDeploy, clearPendingDeploy, resolveDiffFrom,
  WATERMARK_KV_KEY, PENDING_TTL_SECONDS, NULL_SHA,
} from '../scripts/lib/deploy-status-kv.mjs';

const CREDS = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const NOW = new Date('2026-08-06T02:00:00Z');

test('contentPathsChanged classifies changed paths, dedupes, and skips non-content/share paths', () => {
  const items = contentPathsChanged([
    'house/posts/my-post/index.md',
    'members/alice/products/widget/index.md',
    'members/alice/products/widget/index.md', // duplicate, same push touching two files under one item
    'members/alice/shares/2026-x.md', // shares have no public page, excluded
    'house/roles.yml', // governance, not content
    'README.md',
  ]);
  assert.deepEqual(items, [
    { type: 'post', slug: 'my-post' },
    { type: 'product', slug: 'widget' },
  ]);
});

test('contentPathsChanged returns [] for an empty or non-array input', () => {
  assert.deepEqual(contentPathsChanged([]), []);
  assert.deepEqual(contentPathsChanged(undefined), []);
});

test('readWatermark, writeWatermark, markPendingDeploy, clearPendingDeploy are creds-gated no-ops without CF credentials', async () => {
  const never = async () => { throw new Error('should not be called'); };
  assert.equal(await readWatermark({ env: {}, fetchImpl: never }), null);
  const w = await writeWatermark('abc123', { env: {}, fetchImpl: never });
  assert.equal(w.written, false);
  assert.match(w.reason, /CF_ACCOUNT_ID/);
  const m = await markPendingDeploy([{ type: 'post', slug: 'x' }], { env: {}, fetchImpl: never });
  assert.equal(m.written, false);
  assert.deepEqual(m.marked, []);
  const c = await clearPendingDeploy([{ type: 'post', slug: 'x' }], { env: {}, fetchImpl: never });
  assert.equal(c.written, false);
  assert.deepEqual(c.cleared, []);
});

test('readWatermark GETs the watermark key and returns the trimmed SHA', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, text: async () => 'deadbeef\n' }; };
  const sha = await readWatermark({ env: CREDS, fetchImpl });
  assert.equal(sha, 'deadbeef');
  assert.match(captured.url, new RegExp(`values/${encodeURIComponent(WATERMARK_KV_KEY)}$`));
  assert.equal(captured.opts.headers.Authorization, 'Bearer tok');
});

test('readWatermark returns null on a 404 (never written yet) without throwing', async () => {
  const sha = await readWatermark({ env: CREDS, fetchImpl: async () => ({ status: 404 }) });
  assert.equal(sha, null);
});

test('readWatermark throws on a real API error (not 404)', async () => {
  await assert.rejects(
    readWatermark({ env: CREDS, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /watermark read failed: 500/,
  );
});

test('writeWatermark PUTs the SHA as the raw body', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true }; };
  const r = await writeWatermark('cafef00d', { env: CREDS, fetchImpl });
  assert.equal(r.written, true);
  assert.equal(captured.opts.method, 'PUT');
  assert.equal(captured.opts.body, 'cafef00d');
});

test('markPendingDeploy PUTs one key per item with the TTL query param and a startedAt body', async () => {
  const puts = [];
  const fetchImpl = async (url, opts) => { puts.push({ url, opts }); return { ok: true }; };
  const items = [{ type: 'post', slug: 'a' }, { type: 'product', slug: 'b' }];
  const r = await markPendingDeploy(items, { env: CREDS, fetchImpl, now: NOW });
  assert.equal(r.written, true);
  assert.equal(puts.length, 2);
  assert.match(puts[0].url, /values\/pendingdeploy%3Apost%3Aa\?expiration_ttl=600$/);
  assert.match(puts[1].url, /values\/pendingdeploy%3Aproduct%3Ab\?expiration_ttl=600$/);
  assert.deepEqual(JSON.parse(puts[0].opts.body), { startedAt: '2026-08-06T02:00:00.000Z' });
  assert.deepEqual(r.marked, [
    'pendingdeploy:post:a', 'pendingdeploy:product:b',
  ]);
});

test('markPendingDeploy honors a custom ttlSeconds', async () => {
  let captured;
  const fetchImpl = async (url) => { captured = url; return { ok: true }; };
  await markPendingDeploy([{ type: 'post', slug: 'a' }], { env: CREDS, fetchImpl, now: NOW, ttlSeconds: 120 });
  assert.match(captured, /expiration_ttl=120$/);
});

test('markPendingDeploy throws on a real API error', async () => {
  await assert.rejects(
    markPendingDeploy([{ type: 'post', slug: 'a' }], { env: CREDS, fetchImpl: async () => ({ ok: false, status: 403 }) }),
    /mark pending failed for pendingdeploy:post:a: 403/,
  );
});

test('clearPendingDeploy DELETEs one key per item', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true }; };
  const items = [{ type: 'post', slug: 'a' }, { type: 'prompt', slug: 'c' }];
  const r = await clearPendingDeploy(items, { env: CREDS, fetchImpl });
  assert.equal(r.written, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].opts.method, 'DELETE');
  assert.match(calls[0].url, /values\/pendingdeploy%3Apost%3Aa$/);
  assert.match(calls[1].url, /values\/pendingdeploy%3Aprompt%3Ac$/);
  assert.deepEqual(r.cleared, ['pendingdeploy:post:a', 'pendingdeploy:prompt:c']);
});

test('clearPendingDeploy throws on a real API error', async () => {
  await assert.rejects(
    clearPendingDeploy([{ type: 'post', slug: 'a' }], { env: CREDS, fetchImpl: async () => ({ ok: false, status: 500 }) }),
    /clear pending failed for pendingdeploy:post:a: 500/,
  );
});

test('PENDING_TTL_SECONDS is generous headroom over the observed real deploy time', () => {
  assert.equal(PENDING_TTL_SECONDS, 600); // 10 minutes; real deploys finish in well under 2
});

// ---- resolveDiffFrom: the decision that keeps notice coverage robust to a burst of skipped runs ----

test('resolveDiffFrom prefers the stored watermark, even when a push before is also present', () => {
  assert.equal(resolveDiffFrom('watermark-sha', 'push-before-sha'), 'watermark-sha');
});

test('resolveDiffFrom falls back to the push\'s own before when no watermark is stored yet', () => {
  assert.equal(resolveDiffFrom(null, 'push-before-sha'), 'push-before-sha');
  assert.equal(resolveDiffFrom(undefined, 'push-before-sha'), 'push-before-sha');
});

test('resolveDiffFrom treats the null SHA before as "no prior commit", not a real one to diff from', () => {
  assert.equal(resolveDiffFrom(null, NULL_SHA), null);
});

test('resolveDiffFrom returns null (first push, nothing to diff) when both are absent', () => {
  assert.equal(resolveDiffFrom(null, ''), null);
  assert.equal(resolveDiffFrom(null, null), null);
});

test('resolveDiffFrom: the burst scenario -- a run skipped mid-window never loses coverage', () => {
  // Push 1 (before=A, after=B) starts a run that is still executing when pushes 2 and 3 arrive; deploy.yml's
  // own concurrency group skips run 2 entirely and only run 3 (before=C, after=D) survives once run 1 finishes.
  // Without the watermark, run 3 would diff only C..D and silently lose whatever changed in B..C (run 2's own
  // slice). With it, run 1 leaves the watermark at B; run 3 reads that watermark instead of trusting its own
  // `before` (C), so it diffs B..D -- the FULL accumulated range, including what run 2 would have covered.
  const watermarkAfterRun1 = 'B';
  const run3PushBefore = 'C'; // run 3's own immediate parent -- would lose B..C if used directly
  const from = resolveDiffFrom(watermarkAfterRun1, run3PushBefore);
  assert.equal(from, 'B', 'must diff from the watermark, not from run 3\'s own narrower before');
});
