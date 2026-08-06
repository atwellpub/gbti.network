// sow-185: the deploy.yml CLI orchestration itself (scripts/deploy-status.mjs), not just the pure KV helpers
// it calls (those are test/deploy-status-kv.test.mjs). This is the highest-blast-radius file in the repo
// (every push to main runs it), and its own sequencing has a real failure mode worth locking down: the
// watermark must ONLY advance once marking is CONFIRMED to have succeeded for every changed item, never
// unconditionally -- otherwise a transient mark failure permanently drops notice coverage for whatever failed
// to get marked, which is worse than the burst-skip problem the watermark exists to solve in the first place.
// Injected env/fetchImpl/gitDiff/writeState/readState: no real git, filesystem, or network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mark, clear } from '../scripts/deploy-status.mjs';
import { WATERMARK_KV_KEY } from '../scripts/lib/deploy-status-kv.mjs';

const CREDS = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const NOW = new Date('2026-08-06T02:00:00Z');
const watermarkUrlRe = new RegExp(`values/${encodeURIComponent(WATERMARK_KV_KEY)}`);

/** A controllable fake fetch: GET the watermark returns `watermark` (or 404 if null); every PUT/DELETE
 *  succeeds unless its key matches `failKeyRe`. Records every call. */
function fakeFetch({ watermark = null, failKeyRe = null } = {}) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET' });
    if (!opts.method || opts.method === 'GET') {
      if (watermarkUrlRe.test(url)) {
        return watermark ? { ok: true, text: async () => watermark } : { status: 404 };
      }
      return { status: 404 };
    }
    if (failKeyRe && failKeyRe.test(url)) return { ok: false, status: 500, text: async () => 'boom' };
    return { ok: true };
  };
  return { fn, calls };
}

test('mark: nothing changed -> watermark still advances (nothing to lose)', async () => {
  const { fn, calls } = fakeFetch({ watermark: 'old-sha' });
  let saved;
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl: fn, now: NOW, gitDiff: () => [], writeState: (items) => { saved = items; },
  });
  assert.deepEqual(saved, []);
  const watermarkPut = calls.find((c) => c.method === 'PUT' && watermarkUrlRe.test(c.url));
  assert.ok(watermarkPut, 'the watermark must still advance when there was nothing to mark');
});

test('mark: items present + mark succeeds -> watermark advances', async () => {
  const { fn, calls } = fakeFetch({ watermark: 'old-sha' });
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl: fn, now: NOW, gitDiff: () => ['house/posts/a/index.md'], writeState: () => {},
  });
  const markPut = calls.find((c) => c.method === 'PUT' && /pendingdeploy%3Apost%3Aa/.test(c.url));
  const watermarkPut = calls.find((c) => c.method === 'PUT' && watermarkUrlRe.test(c.url));
  assert.ok(markPut, 'the item must be marked');
  assert.ok(watermarkPut, 'the watermark must advance once marking succeeded');
});

test('THE BUG THIS FILE EXISTS TO PREVENT: mark fails -> watermark must NOT advance', async () => {
  // pendingdeploy:post:a fails; without the fix, writeWatermark would still fire unconditionally afterward,
  // permanently excluding this item's changes from every future diff (the watermark would sit past it).
  const { fn, calls } = fakeFetch({ watermark: 'old-sha', failKeyRe: /pendingdeploy%3Apost%3Aa/ });
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl: fn, now: NOW, gitDiff: () => ['house/posts/a/index.md'], writeState: () => {},
  });
  const watermarkPut = calls.find((c) => c.method === 'PUT' && watermarkUrlRe.test(c.url));
  assert.equal(watermarkPut, undefined, 'a failed mark must leave the watermark untouched, not advance past the lost item');
});

test('mark: missing CF credentials (mark not written) -> watermark must NOT advance either', async () => {
  const { fn, calls } = fakeFetch({ watermark: 'old-sha' });
  await mark({
    env: { EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' }, // no CF creds
    fetchImpl: fn, now: NOW, gitDiff: () => ['house/posts/a/index.md'], writeState: () => {},
  });
  const watermarkPut = calls.find((c) => c.method === 'PUT' && watermarkUrlRe.test(c.url));
  assert.equal(watermarkPut, undefined);
});

test('mark: watermark read failure falls back to the push\'s own before, still marks and advances', async () => {
  const fetchImpl = async (url, opts = {}) => {
    if ((!opts.method || opts.method === 'GET') && watermarkUrlRe.test(url)) throw new Error('network blip');
    return { ok: true };
  };
  let saved;
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl, now: NOW, gitDiff: (from, to) => { assert.equal(from, 'before-sha'); assert.equal(to, 'after-sha'); return ['house/posts/a/index.md']; },
    writeState: (items) => { saved = items; },
  });
  assert.deepEqual(saved, [{ type: 'post', slug: 'a' }]);
});

test('mark: gitDiff failure (null, distinct from an empty array) does not advance the watermark', async () => {
  // A failed diff must never be treated the same as a legitimately empty one -- see defaultGitDiff's own
  // comment. Confirms neither the watermark PUT nor any mark PUT fires, and the state file is left untouched.
  const { fn, calls } = fakeFetch({ watermark: 'old-sha' });
  let writeStateCalled = false;
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl: fn, now: NOW, gitDiff: () => null, writeState: () => { writeStateCalled = true; },
  });
  assert.equal(writeStateCalled, false, 'a failed diff must not overwrite the state file for clear() to act on');
  const anyPut = calls.find((c) => c.method === 'PUT');
  assert.equal(anyPut, undefined, 'nothing should be marked or watermarked when the diff itself failed');
});

test('mark: a genuinely empty diff ([], not null) still advances the watermark', async () => {
  const { fn, calls } = fakeFetch({ watermark: 'old-sha' });
  let saved;
  await mark({
    env: { ...CREDS, EVENT_BEFORE: 'before-sha', GITHUB_SHA: 'after-sha' },
    fetchImpl: fn, now: NOW, gitDiff: () => [], writeState: (items) => { saved = items; },
  });
  assert.deepEqual(saved, []);
  const watermarkPut = calls.find((c) => c.method === 'PUT' && watermarkUrlRe.test(c.url));
  assert.ok(watermarkPut, 'an empty diff is a real, known "nothing changed" and should still advance the watermark');
});

test('mark: no GITHUB_SHA -> a genuine no-op, nothing is called', async () => {
  let called = false;
  await mark({ env: {}, fetchImpl: async () => { called = true; return { ok: true }; }, gitDiff: () => { called = true; return []; } });
  assert.equal(called, false);
});

test('clear: items from readState are cleared', async () => {
  const { fn, calls } = fakeFetch();
  await clear({ env: CREDS, fetchImpl: fn, readState: () => [{ type: 'post', slug: 'a' }] });
  const del = calls.find((c) => c.method === 'DELETE' && /pendingdeploy%3Apost%3Aa/.test(c.url));
  assert.ok(del);
});

test('clear: no items -> a genuine no-op, nothing is called', async () => {
  let called = false;
  await clear({ env: CREDS, fetchImpl: async () => { called = true; return { ok: true }; }, readState: () => [] });
  assert.equal(called, false);
});

test('clear: a malformed state (readState throwing or returning junk) is treated as nothing to clear', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true }; };
  await clear({ env: CREDS, fetchImpl, readState: () => null });
  await clear({ env: CREDS, fetchImpl, readState: () => 'not-an-array' });
  assert.equal(called, false);
});

test('clear: a clear failure is caught (never throws), the TTL backstop is the fallback', async () => {
  const { fn } = fakeFetch({ failKeyRe: /pendingdeploy/ });
  await assert.doesNotReject(clear({ env: CREDS, fetchImpl: fn, readState: () => [{ type: 'post', slug: 'a' }] }));
});
