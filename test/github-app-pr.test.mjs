// SOW-026: the server-side PR-opener (workers/signup/github-app.mjs). Installation-token mint/cache + the
// open-PR head-ownership + paid gate. All injectable: fake KV, fake fetch, fake JWT signer, stubbed authorizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInstallationToken, openPullForMember, listMemberPulls, memberPrStatus } from '../workers/signup/github-app.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network' };
const fakeKv = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { store: m, async get(k, t) { const v = m.get(k); return t === 'json' && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
};
const signJwt = async () => 'fake.jwt.sig';

test('getInstallationToken mints via JWT when the cache is empty, then caches', async () => {
  const kv = fakeKv();
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, auth: init.headers.Authorization }); return { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } }; };
  const tok = await getInstallationToken(env, { kv, fetchImpl, signJwt, now: Date.now });
  assert.equal(tok, 'ghs_inst');
  assert.match(calls[0].url, /\/app\/installations\/999\/access_tokens$/);
  assert.equal(calls[0].auth, 'Bearer fake.jwt.sig');
  assert.ok(kv.store.has('gh-app:installation-token'), 'token cached');
});

test('getInstallationToken reuses a fresh cached token (no mint)', async () => {
  const kv = fakeKv({ 'gh-app:installation-token': JSON.stringify({ token: 'ghs_cached', expiresAt: Date.now() + 3600e3 }) });
  let fetched = false;
  const tok = await getInstallationToken(env, { kv, fetchImpl: async () => { fetched = true; return { ok: false }; }, signJwt });
  assert.equal(tok, 'ghs_cached');
  assert.equal(fetched, false, 'no network when the cache is fresh');
});

// ---- openPullForMember ----
const paidOk = async () => ({ ok: true, githubId: '1' });
// Mirrors the REAL githubFetchUser shape { githubId, githubLogin } (oauth.mjs) so this stub can never again mask
// a wrong-key read in authMemberLogin / openPullForMember (which previously read user.login and 401'd in prod).
const userAlice = async () => ({ githubLogin: 'Alice', githubId: '1' });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });

function prFetch(record) {
  return async (url, init) => {
    if (/\/access_tokens$/.test(url)) return { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    record.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 201, async json() { return { number: 7, html_url: 'https://github.com/gbti-network/gbti.network/pull/7' }; } };
  };
}

test('openPullForMember: a paid member opens a PR from THEIR OWN fork via the installation token', async () => {
  const rec = [];
  const r = await openPullForMember(req({ head: 'alice:gbti-post', base: 'main', title: 'My post' }), env, { kv: fakeKv(), fetchImpl: prFetch(rec), signJwt, authorize: paidOk, fetchUser: userAlice });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 7);
  assert.match(rec[0].url, /\/repos\/gbti-network\/gbti\.network\/pulls$/);
  assert.equal(rec[0].body.head, 'alice:gbti-post');
  assert.equal(rec[0].body.maintainer_can_modify, false, 'avoids the fork_collab 422');
});

test('openPullForMember: rejects a head that is not the member own fork (403)', async () => {
  const rec = [];
  const r = await openPullForMember(req({ head: 'mallory:evil', base: 'main' }), env, { kv: fakeKv(), fetchImpl: prFetch(rec), signJwt, authorize: paidOk, fetchUser: userAlice });
  assert.equal(r.status, 403);
  assert.equal(rec.length, 0, 'no PR opened for someone else fork');
});

test('openPullForMember: a non-paid caller is denied (fail-closed), no PR', async () => {
  const rec = [];
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });
  const r = await openPullForMember(req({ head: 'alice:x' }), env, { kv: fakeKv(), fetchImpl: prFetch(rec), signJwt, authorize: deny, fetchUser: userAlice });
  assert.equal(r.status, 403);
  assert.equal(rec.length, 0);
});

test('openPullForMember: an identity mismatch (token user != paid github_id) is unauthorized', async () => {
  const r = await openPullForMember(req({ head: 'alice:x' }), env, { kv: fakeKv(), fetchImpl: prFetch([]), signJwt, authorize: async () => ({ ok: true, githubId: '999' }), fetchUser: userAlice });
  assert.equal(r.status, 401);
});

test('openPullForMember: an existing PR (422) is reported gracefully, not an error', async () => {
  const fetchImpl = async (url) => {
    if (/access_tokens$/.test(url)) return { ok: true, async json() { return { token: 't', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    return { ok: false, status: 422, async json() { return { errors: [{ message: 'A pull request already exists for alice:x.' }] }; } };
  };
  const r = await openPullForMember(req({ head: 'alice:x' }), env, { kv: fakeKv(), fetchImpl, signJwt, authorize: paidOk, fetchUser: userAlice });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, true);
});

// ---- listMemberPulls / memberPrStatus (SOW-026 read proxy) ----
const getReq = (url = 'https://w/membership/my-pulls') => ({ url, headers: { get: () => 'Bearer tok' } });
const instOk = (url) => /access_tokens$/.test(url) && { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };

test('listMemberPulls returns ONLY the caller own-fork PRs (filtered by head owner, not author)', async () => {
  const pulls = [
    { number: 7, title: 'Mine', html_url: 'u7', head: { repo: { owner: { login: 'alice' } } } },
    { number: 8, title: 'Theirs', html_url: 'u8', head: { repo: { owner: { login: 'bob' } } } },
    { number: 9, title: 'MineFork', html_url: 'u9', head: { user: { login: 'Alice' } } }, // case-insensitive, head.user fallback
  ];
  const fetchImpl = async (url) => instOk(url) || { ok: true, async json() { return pulls; } };
  const r = await listMemberPulls(getReq(), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAlice });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.number).sort(), [7, 9]);
});

test('listMemberPulls (SOW-033 P4): closed/merged included with state + merged, queries state=all, still head-owner scoped', async () => {
  const pulls = [
    { number: 7, title: 'Open', html_url: 'u7', state: 'open', head: { repo: { owner: { login: 'alice' } } } },
    { number: 8, title: 'Merged', html_url: 'u8', state: 'closed', merged_at: '2026-06-01T00:00:00Z', head: { repo: { owner: { login: 'alice' } } } },
    { number: 9, title: 'Declined', html_url: 'u9', state: 'closed', merged_at: null, head: { repo: { owner: { login: 'alice' } } } },
    { number: 10, title: 'Theirs', html_url: 'u10', state: 'closed', merged_at: '2026-06-02T00:00:00Z', head: { repo: { owner: { login: 'bob' } } } }, // another member: excluded
  ];
  let pullsUrl = '';
  const fetchImpl = async (url) => {
    if (!/access_tokens$/.test(url)) pullsUrl = url;
    return instOk(url) || { ok: true, async json() { return pulls; } };
  };
  const r = await listMemberPulls(getReq(), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAlice });
  assert.equal(r.status, 200);
  assert.ok(pullsUrl.includes('state=all'), 'queries state=all so closed/merged PRs are returned');
  // sow-221: the four timestamps ride along now. The fixtures above set only merged_at, so the rest come back
  // null, which is exactly the shape the UI must tolerate (prEvent falls back to no verb and no time).
  assert.deepEqual(r.body.items, [
    { number: 7, title: 'Open', html_url: 'u7', state: 'open', merged: false, createdAt: null, updatedAt: null, mergedAt: null, closedAt: null },
    { number: 8, title: 'Merged', html_url: 'u8', state: 'closed', merged: true, createdAt: null, updatedAt: null, mergedAt: '2026-06-01T00:00:00Z', closedAt: null },
    { number: 9, title: 'Declined', html_url: 'u9', state: 'closed', merged: false, createdAt: null, updatedAt: null, mergedAt: null, closedAt: null },
  ], 'bob PR #10 excluded by head-owner scope; merged derived from merged_at');
});

// sow-221: the timestamps GitHub actually sends must survive the projection, not just be present as nulls.
test('listMemberPulls passes GitHub created_at / updated_at / merged_at / closed_at straight through', async () => {
  const pulls = [{
    number: 11, title: 'Timed', html_url: 'u11', state: 'closed',
    created_at: '2026-08-01T10:00:00Z', updated_at: '2026-08-10T11:00:00Z',
    merged_at: '2026-08-10T11:00:00Z', closed_at: '2026-08-10T11:00:00Z',
    head: { repo: { owner: { login: 'alice' } } },
  }];
  const fetchImpl = async (url) => instOk(url) || { ok: true, async json() { return pulls; } };
  const r = await listMemberPulls(getReq(), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAlice });
  assert.deepEqual(r.body.items[0], {
    number: 11, title: 'Timed', html_url: 'u11', state: 'closed', merged: true,
    createdAt: '2026-08-01T10:00:00Z', updatedAt: '2026-08-10T11:00:00Z',
    mergedAt: '2026-08-10T11:00:00Z', closedAt: '2026-08-10T11:00:00Z',
  });
});

test('listMemberPulls is unauthorized when the token does not resolve to a user', async () => {
  const r = await listMemberPulls(getReq(), env, { kv: fakeKv(), fetchImpl: async (u) => instOk(u) || { ok: true, async json() { return []; } }, signJwt, fetchUser: async () => { throw new Error('bad token'); } });
  assert.equal(r.status, 401);
});

test('memberPrStatus returns the gate status for the caller own PR', async () => {
  const fetchImpl = async (url) => {
    if (instOk(url)) return instOk(url);
    if (/\/pulls\/7$/.test(url)) return { ok: true, status: 200, async json() { return { head: { sha: 'abc', repo: { owner: { login: 'alice' } } } }; } };
    if (/\/commits\/abc\/status$/.test(url)) return { ok: true, async json() { return { state: 'success', statuses: [{ context: 'membership-gate', state: 'success', description: 'paid member own-folder content' }] }; } };
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const r = await memberPrStatus(getReq('https://w/membership/pr-status?number=7'), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAlice });
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'success');
  assert.equal(r.body.meaning, 'mergeable');
  assert.equal(r.body.sha, 'abc');
});

test("memberPrStatus refuses a PR that is NOT the caller own fork, indistinguishable from not-found (404)", async () => {
  const fetchImpl = async (url) => {
    if (instOk(url)) return instOk(url);
    if (/\/pulls\/8$/.test(url)) return { ok: true, status: 200, async json() { return { head: { sha: 'z', repo: { owner: { login: 'bob' } } } }; } };
    if (/\/commits\//.test(url)) throw new Error('must not read status for someone else PR');
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const r = await memberPrStatus(getReq('https://w/membership/pr-status?number=8'), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAlice });
  assert.equal(r.status, 404, 'a PR that is not yours returns the same 404 as a nonexistent one (no existence leak)');
  assert.equal(r.body.error, 'not_found');
});

test('memberPrStatus rejects a bad number (400) and a missing PR (404)', async () => {
  const base = { kv: fakeKv(), signJwt, fetchUser: userAlice };
  const bad = await memberPrStatus(getReq('https://w/membership/pr-status?number=0'), env, { ...base, fetchImpl: async (u) => instOk(u) || { ok: false, status: 404, async json() { return {}; } } });
  assert.equal(bad.status, 400);
  const missing = await memberPrStatus(getReq('https://w/membership/pr-status?number=99'), env, { ...base, fetchImpl: async (u) => instOk(u) || { ok: false, status: 404, async json() { return {}; } } });
  assert.equal(missing.status, 404);
});

// ---- SOW-157: hosted PRs (canonical-head, branch hosted/<github_id>/...) in my-pulls / pr-status ----

const userAliceWithId = async () => ({ githubLogin: 'Alice', githubId: '777' });
const CANON_ID = 424242;

test('listMemberPulls: a hosted canonical-head PR matching the caller github_id is included; a forged fork-head hosted ref is NOT', async () => {
  const pulls = [
    // the caller's real hosted PR (head repo IS the canonical repo)
    { number: 1, title: 'Hosted mine', html_url: 'u1', state: 'open',
      head: { ref: 'hosted/777/post-x', repo: { id: CANON_ID, owner: { login: 'gbti-network' } } },
      base: { repo: { id: CANON_ID } } },
    // ATTACK: another member pushes hosted/777/spoof to their OWN FORK -- must not appear for the caller
    { number: 2, title: 'Forged', html_url: 'u2', state: 'open',
      head: { ref: 'hosted/777/spoof', repo: { id: 555, owner: { login: 'mallory' } } },
      base: { repo: { id: CANON_ID } } },
    // another member's hosted PR (different github_id in the ref) -- not the caller's
    { number: 3, title: 'Other hosted', html_url: 'u3', state: 'open',
      head: { ref: 'hosted/888/post-y', repo: { id: CANON_ID, owner: { login: 'gbti-network' } } },
      base: { repo: { id: CANON_ID } } },
    // the caller's ordinary fork PR still matches by head owner
    { number: 4, title: 'Fork mine', html_url: 'u4', state: 'open',
      head: { ref: 'gbti/post-z', repo: { id: 999, owner: { login: 'alice' } } },
      base: { repo: { id: CANON_ID } } },
  ];
  const fetchImpl = async (url) => instOk(url) || { ok: true, async json() { return pulls; } };
  const r = await listMemberPulls(getReq(), env, { kv: fakeKv(), fetchImpl, signJwt, fetchUser: userAliceWithId });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.number), [1, 4]);
});

test('memberPrStatus: the caller can read their hosted PR status; a forged fork-head hosted ref 404s', async () => {
  const hostedPr = { number: 9, head: { sha: 'hsha', ref: 'hosted/777/post-x', repo: { id: CANON_ID, owner: { login: 'gbti-network' } } }, base: { repo: { id: CANON_ID } } };
  const forged = { number: 10, head: { sha: 'fsha', ref: 'hosted/777/spoof', repo: { id: 555, owner: { login: 'mallory' } } }, base: { repo: { id: CANON_ID } } };
  const mk = (pr) => async (url) => {
    if (instOk(url)) return instOk(url);
    if (/\/pulls\/\d+$/.test(url)) return { ok: true, status: 200, async json() { return pr; } };
    if (/\/status$/.test(url)) return { ok: true, async json() { return { state: 'success', statuses: [{ context: 'membership-gate', state: 'success', description: 'pass' }] }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
  const ok = await memberPrStatus(getReq('https://w/membership/pr-status?number=9'), env, { kv: fakeKv(), fetchImpl: mk(hostedPr), signJwt, fetchUser: userAliceWithId });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.meaning, 'mergeable');
  const bad = await memberPrStatus(getReq('https://w/membership/pr-status?number=10'), env, { kv: fakeKv(), fetchImpl: mk(forged), signJwt, fetchUser: userAliceWithId });
  assert.equal(bad.status, 404, 'a forged fork-head hosted ref is not the caller\'s PR');
});
