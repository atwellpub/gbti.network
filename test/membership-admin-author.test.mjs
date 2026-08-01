// sow-161: the server-side admin mutation endpoint (workers/signup/membership-admin-author.mjs), increment 1:
// content moderation. All injectable (fake KV, URL-matching fetch, stubbed authorize/limiter/signJwt): no network,
// no secrets. The security-relevant paths mirror the adversarial review: non-staff denied, unsupported action,
// a GOVERNANCE-file path rejected (a moderator cannot rewrite roles.yml via this endpoint), the server-inserted
// caller github_id in the branch, the server-computed status flip, remove = delete, and the already-in-state no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const fakeKv = () => { const m = new Map(); return { store: m, async get() { return null; }, async put(k, v) { m.set(k, v); } }; };
const signJwt = async () => 'fake.jwt.sig';
const allow = async () => ({ allowed: true });
const staffMod = async () => ({ ok: true, githubId: '3', role: 'moderator' }); // a moderator
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'moderator access is required' } });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const ITEM = 'members/alice/posts/my-post/index.md';
const fileWithStatus = (status) => `---\ntitle: My Post\nauthor: alice\nstatus: ${status}\n---\n\nBody text.\n`;

/** URL-matching GitHub fake for the admin-author flow; records writes. `mainFile` is the current file text on main
 *  (or null -> 404). `onBranchSha` is the existing target sha on the work branch (undefined -> 404 there). */
function ghFetch(record, { mainFile = fileWithStatus('published'), onBranchSha = 'oldsha', branchExists = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/.+\?ref=main$/.test(url) && method === 'GET') {
      return mainFile == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(mainFile) }; } };
    }
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return branchExists ? { ok: false, status: 422, async json() { return {}; } } : { ok: true, status: 201, async json() { return {}; } };
    }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') { // existing file on the work branch
      return onBranchSha ? { ok: true, status: 200, async json() { return { sha: onBranchSha }; } } : { ok: false, status: 404, async json() { return {}; } };
    }
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, { fetchImpl, authorize = staffMod, ...over } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv: fakeKv(), limiter: allow, signJwt, ...over });

test('sow-161: a non-staff caller is denied (403) and writes NOTHING', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record), authorize: denied });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'no branch, no PR, no write for a denied caller');
});

test('sow-161: an unsupported action is 400', async () => {
  const record = [];
  const r = await run({ action: 'ban', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: a GOVERNANCE or non-content path is rejected (a moderator cannot target roles.yml/bans.yml)', async () => {
  for (const path of ['house/roles.yml', 'house/bans.yml', 'members/alice/collections.yml', 'members/alice/posts/x/../../../house/roles.yml', 'CODEOWNERS', '.github/workflows/x.yml']) {
    const record = [];
    const r = await run({ action: 'remove', path }, { fetchImpl: ghFetch(record) });
    assert.equal(r.status, 400, `path ${path} must be rejected`);
    assert.equal(record.length, 0, `path ${path} must write nothing`);
  }
});

test('sow-161: deplatform flips status to draft, server-side, on a hosted-admin branch keyed to the VERIFIED caller id', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/3/deplatform-my-post', 'branch encodes the moderator id (3) from authorize, not the body');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(deB64(put.body.content), /status: draft/, 'the status was flipped to draft SERVER-SIDE');
  assert.doesNotMatch(deB64(put.body.content), /status: published/);
});

test('sow-161: republish flips status to published; remove deletes the file', async () => {
  const rec1 = [];
  const rp = await run({ action: 'republish', path: ITEM }, { fetchImpl: ghFetch(rec1, { mainFile: fileWithStatus('draft') }) });
  assert.equal(rp.status, 200);
  assert.match(deB64(rec1.find((c) => c.method === 'PUT').body.content), /status: published/);

  const rec2 = [];
  const rr = await run({ action: 'remove', path: ITEM }, { fetchImpl: ghFetch(rec2) });
  assert.equal(rr.status, 200);
  assert.ok(rec2.some((c) => c.method === 'DELETE'), 'remove issues a DELETE');
});

test('sow-161: deplatforming an already-draft item is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: fileWithStatus('draft') }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'a no-op opens no PR');
});

test('sow-161: a target missing on main is 404 (nothing to moderate)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: null }) });
  assert.equal(r.status, 404);
  assert.equal(record.length, 0);
});

test('sow-161: the endpoint is inert unless MEMBERSHIP_AUTHOR_ENABLED is true', async () => {
  const r = await membershipAdminAuthor(req({ action: 'deplatform', path: ITEM }), { ...env, MEMBERSHIP_AUTHOR_ENABLED: 'false' }, { fetchImpl: ghFetch([]), authorize: staffMod, kv: fakeKv(), limiter: allow, signJwt });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'author_disabled');
});
