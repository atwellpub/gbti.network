// SOW-023: the follow-graph Worker handler. Effective-paid auth (stubbed), KV read-modify-write, erasure.
// No network/secrets: a fake KV + a stubbed authorizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleFollows, eraseMemberFollows, FOLLOWS_KEY } from '../workers/signup/membership-follows.mjs';
import { FOLLOWERS_KEY, normalizeFollowers } from '../membership/member-followers.mjs'; // SOW-186 phase 3

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    store: m,
    async get(k, type) { const v = m.get(k); return type === 'json' && typeof v === 'string' ? JSON.parse(v) : (v ?? null); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const req = (method, body) => ({
  method,
  headers: { get: () => 'Bearer tok' },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
const paid = async () => ({ ok: true, githubId: '42' });
const now = () => 5000;

test('GET: an empty store returns no follows', async () => {
  const kv = fakeKv();
  const r = await handleFollows(req('GET'), {}, { kv, authorize: paid, now });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, following: [] });
});

test('POST: follow persists under follows:<github_id> and dedupes', async () => {
  const kv = fakeKv();
  let r = await handleFollows(req('POST', { username: 'Alice' }), {}, { kv, authorize: paid, now });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.following, [{ username: 'alice', addedAt: 5000 }]);
  assert.ok(kv.store.has(FOLLOWS_KEY('42')), 'stored under the caller github_id key');
  // a second follow of the same user does not duplicate
  r = await handleFollows(req('POST', { username: 'alice' }), {}, { kv, authorize: paid, now });
  assert.equal(r.body.following.length, 1);
});

test('POST on:false unfollows', async () => {
  const kv = fakeKv({ [FOLLOWS_KEY('42')]: JSON.stringify({ following: [{ username: 'alice', addedAt: 1 }], updatedAt: 1 }) });
  const r = await handleFollows(req('POST', { username: 'alice', on: false }), {}, { kv, authorize: paid, now });
  assert.deepEqual(r.body.following, []);
});

test('POST: an invalid username is a 400, not a 500', async () => {
  const r = await handleFollows(req('POST', { username: '../etc/passwd' }), {}, { kv: fakeKv(), authorize: paid, now });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'invalid');
});

test('a non-paid / unauthorized caller is denied (fail-closed), no write', async () => {
  const kv = fakeKv();
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });
  const r = await handleFollows(req('POST', { username: 'alice' }), {}, { kv, authorize: deny, now });
  assert.equal(r.status, 403);
  assert.equal(kv.store.size, 0, 'nothing written for a denied caller');
});

test('PUT (or any non GET/POST) is 405', async () => {
  const r = await handleFollows(req('PUT'), {}, { kv: fakeKv(), authorize: paid, now });
  assert.equal(r.status, 405);
});

test('a missing store is a 500 misconfigured', async () => {
  const r = await handleFollows(req('GET'), {}, { kv: null, authorize: paid, now });
  assert.equal(r.status, 500);
});

test('eraseMemberFollows hard-deletes the follow record (right-to-erasure)', async () => {
  const kv = fakeKv({ [FOLLOWS_KEY('42')]: JSON.stringify({ following: [{ username: 'alice', addedAt: 1 }] }) });
  const r = await eraseMemberFollows({}, '42', { kv });
  assert.deepEqual(r, { ok: true, key: 'follows:42' });
  assert.equal(kv.store.has('follows:42'), false);
});

// --- SOW-186 phase 3 (REWORKED 2026-08-22): the hot path writes ONLY the forward store ---
// The reverse follower index is now DERIVED state that reconcile reconverges from the forward graph
// (scripts/lib/follower-index.mjs); the follow handler must not write followers:* at all. These tests pin that
// invariant so a re-added follow-time mirror (the retired b103f609 behaviour) goes red.

test('POST follow: writes ONLY follows:<github_id>, never a followers:* reverse key', async () => {
  const kv = fakeKv();
  await handleFollows(req('POST', { username: 'Alice' }), {}, { kv, authorize: paid, now });
  assert.ok(kv.store.has(FOLLOWS_KEY('42')), 'the forward store is written');
  const reverseKeys = [...kv.store.keys()].filter((k) => k.startsWith('followers:'));
  assert.deepEqual(reverseKeys, [], 'the hot path writes no reverse-index key (reconcile owns it)');
});

test('POST unfollow: still touches ONLY the forward store, leaving any reverse index to reconcile', async () => {
  const kv = fakeKv({
    [FOLLOWS_KEY('42')]: JSON.stringify({ following: [{ username: 'alice', addedAt: 1 }], updatedAt: 1 }),
    // A pre-existing reverse entry (as reconcile would have built it) must be left untouched by the hot path.
    [FOLLOWERS_KEY('99')]: JSON.stringify({ followers: [{ githubId: '42', addedAt: 1 }, { githubId: '7', addedAt: 1 }], updatedAt: 1 }),
  });
  await handleFollows(req('POST', { username: 'alice', on: false }), {}, { kv, authorize: paid, now });
  const rev = normalizeFollowers(JSON.parse(kv.store.get(FOLLOWERS_KEY('99'))));
  assert.deepEqual(rev.followers, [{ githubId: '42', addedAt: 1 }, { githubId: '7', addedAt: 1 }], 'the reverse index is unchanged by an unfollow (reconcile heals it later)');
  const fwd = JSON.parse(kv.store.get(FOLLOWS_KEY('42')));
  assert.deepEqual(fwd.following, [], 'only the forward store reflects the unfollow');
});
