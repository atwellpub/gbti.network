// sow-185: the public deploy-status endpoint. Fake KV, no auth involved (this is intentionally public).
// Verifies the happy path, input validation, and the fail-open behavior when KV is unavailable/malformed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipDeployStatus } from '../workers/signup/membership-deploy-status.mjs';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { async get(k, t) { const v = m.get(k); return v == null ? null : (t === 'json' ? JSON.parse(v) : v); } };
}
const req = (query) => ({ url: `https://x/membership/deploy-status${query}` });
const NOW = new Date('2026-08-06T02:00:30Z');

test('returns pending:true with elapsed time when the item is marked', async () => {
  const kv = fakeKv({ 'pendingdeploy:post:my-post': JSON.stringify({ startedAt: '2026-08-06T02:00:00Z' }) });
  const r = await membershipDeployStatus(req('?type=post&slug=my-post'), {}, { kv, now: () => NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pending: true, startedAt: '2026-08-06T02:00:00Z', elapsedSeconds: 30 });
});

test('returns pending:false when nothing is marked for that item', async () => {
  const kv = fakeKv();
  const r = await membershipDeployStatus(req('?type=post&slug=untouched'), {}, { kv, now: () => NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pending: false });
});

test('rejects an invalid type', async () => {
  const kv = fakeKv();
  const r = await membershipDeployStatus(req('?type=share&slug=x'), {}, { kv });
  assert.equal(r.status, 400);
});

test('rejects a missing or malformed slug', async () => {
  const kv = fakeKv();
  const r1 = await membershipDeployStatus(req('?type=post&slug='), {}, { kv });
  assert.equal(r1.status, 400);
  const r2 = await membershipDeployStatus(req('?type=post&slug=UPPERCASE'), {}, { kv });
  assert.equal(r2.status, 400);
  const r3 = await membershipDeployStatus(req('?type=post'), {}, { kv });
  assert.equal(r3.status, 400);
});

test('accepts a leading-hyphen slug (schema-valid per content.config.ts, must not be rejected here)', async () => {
  const kv = fakeKv({ 'pendingdeploy:post:-my-post': JSON.stringify({ startedAt: '2026-08-06T02:00:00Z' }) });
  const r = await membershipDeployStatus(req('?type=post&slug=-my-post'), {}, { kv, now: () => NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.pending, true);
});

test('rejects a slug beyond the sanity length cap', async () => {
  const kv = fakeKv();
  const r = await membershipDeployStatus(req(`?type=post&slug=${'a'.repeat(201)}`), {}, { kv });
  assert.equal(r.status, 400);
});

test('fails OPEN to pending:false when KV is not configured, never blocking the check', async () => {
  const r = await membershipDeployStatus(req('?type=post&slug=x'), {}, { kv: null });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pending: false });
});

test('fails OPEN to pending:false when the KV read itself throws', async () => {
  const kv = { async get() { throw new Error('kv unavailable'); } };
  const r = await membershipDeployStatus(req('?type=post&slug=x'), {}, { kv, now: () => NOW });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { pending: false });
});
