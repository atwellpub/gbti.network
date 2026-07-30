// SOW-156: the hosted-authoring Worker endpoint (workers/signup/membership-author.mjs). All injectable
// (fake KV, URL-matching fetch, stubbed authorizer/fetchUser/limiter): no network, no secrets. The
// security-relevant paths mirror the adversarial review: flag off, non-paid, identity mismatch, missing
// index entry, out-of-folder paths, and the server-inserted github_id in the branch name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAuthor } from '../workers/signup/membership-author.mjs';

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const fakeKv = () => {
  const m = new Map();
  return { store: m, async get(k, t) { const v = m.get(k); return (t === 'json' || t?.type === 'json') && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
};
const signJwt = async () => 'fake.jwt.sig';
const paidOk = async () => ({ ok: true, githubId: '2002207' });
const userMe = async () => ({ githubLogin: 'atwellpub', githubId: '2002207' });
const allow = async () => ({ allowed: true, count: 1, limit: 10 });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });

const INDEX_YML = 'members:\n  "2002207": atwellpub\n  "225425": rfilipo\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

/** URL-matching GitHub fake covering the whole hosted flow; records every write call. */
function ghFetch(record, { branchExists = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64(INDEX_YML) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return branchExists ? { ok: false, status: 422, async json() { return {}; } } : { ok: true, status: 201, async json() { return {}; } };
    }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, async json() { return {}; } };
    }
    if (/\/contents\//.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } }; // no existing file
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) {
      record.push({ method, url, body: JSON.parse(init.body) });
      return { ok: true, status: 201, async json() { return {}; } };
    }
    if (/\/pulls$/.test(url) && method === 'POST') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://github.com/gbti-network/gbti.network/pull/42' }; } };
    }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}

const goodBody = { itemId: 'my-first-post', title: 'My first post', files: [{ path: 'members/atwellpub/posts/my-first-post.md', content: '---\ntitle: x\n---\nhello' }] };
const deps = (rec, extra = {}) => ({ kv: fakeKv(), fetchImpl: ghFetch(rec, extra), signJwt, authorize: paidOk, fetchUser: userMe, limiter: allow });

test('hosted author: happy path commits to hosted/<github_id>/<itemId> on canonical and opens the PR', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), env, deps(rec));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.number, 42);
  assert.equal(r.body.branch, 'hosted/2002207/my-first-post');
  const branchCreate = rec.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(branchCreate.body.ref, 'refs/heads/hosted/2002207/my-first-post');
  assert.equal(branchCreate.body.sha, 'mainsha', 'fresh-based on live main');
  const put = rec.find((c) => c.method === 'PUT');
  assert.match(put.url, /\/repos\/gbti-network\/gbti\.network\/contents\/members\/atwellpub\/posts\/my-first-post\.md$/);
  assert.equal(put.body.branch, 'hosted/2002207/my-first-post');
  const pr = rec.find((c) => /\/pulls$/.test(c.url));
  assert.equal(pr.body.head, 'hosted/2002207/my-first-post', 'canonical-head PR (no fork owner prefix)');
  assert.equal(pr.body.base, 'main');
  assert.equal(pr.body.maintainer_can_modify, false);
});

test('sow-158 image upload: a binary { contentBase64 } entry PUTs the raw base64 (no re-encode), text unchanged', async () => {
  const rec = [];
  const imgB64 = Buffer.from('a fake image payload').toString('base64');
  const body = {
    itemId: 'post-hello', title: 'Publish article: Hello',
    files: [
      { path: 'members/atwellpub/posts/hello/index.md', content: '---\ntitle: Hello\ncoverImage: members/atwellpub/images/cover.png\n---\nbody' },
      { path: 'members/atwellpub/images/cover.png', contentBase64: imgB64 },
    ],
  };
  const r = await membershipAuthor(req(body), env, deps(rec));
  assert.equal(r.status, 200);
  const imgPut = rec.find((c) => c.method === 'PUT' && /\/images\/cover\.png$/.test(c.url));
  assert.ok(imgPut, 'the image is committed');
  assert.equal(imgPut.body.content, imgB64, 'the binary is committed as its RAW base64, not TextEncoder->btoa re-encoded');
  const mdPut = rec.find((c) => c.method === 'PUT' && /index\.md$/.test(c.url));
  assert.notEqual(mdPut.body.content, undefined, 'the .md still commits its text (base64 of the UTF-8 string)');
});

test('hosted author: the branch github_id is the VERIFIED identity, never body-controlled', async () => {
  const rec = [];
  const evil = { ...goodBody, githubId: '999', branch: 'hosted/999/x' }; // extra body fields are ignored
  const r = await membershipAuthor(req(evil), env, deps(rec));
  assert.equal(r.status, 200);
  assert.equal(r.body.branch, 'hosted/2002207/my-first-post');
});

test('hosted author: an existing branch is force-reset onto live main (fresh-base, SOW-152)', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), env, deps(rec, { branchExists: true }));
  assert.equal(r.status, 200);
  const reset = rec.find((c) => c.method === 'PATCH');
  assert.match(reset.url, /\/git\/refs\/heads\/hosted\/2002207\/my-first-post$/);
  assert.equal(reset.body.force, true);
  assert.equal(reset.body.sha, 'mainsha');
});

test('hosted author: flag off is a hard 403, nothing touched', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), { ...env, MEMBERSHIP_AUTHOR_ENABLED: 'false' }, deps(rec));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'author_disabled');
  assert.equal(rec.length, 0);
});

test('hosted author: non-paid is denied fail-closed (trial gets the SOW-011 membership-required 403)', async () => {
  const rec = [];
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });
  const r = await membershipAuthor(req(goodBody), env, { ...deps(rec), authorize: deny });
  assert.equal(r.status, 403);
  assert.equal(rec.length, 0);
});

test('hosted author: identity mismatch (token user != paid github_id) is unauthorized', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), env, { ...deps(rec), authorize: async () => ({ ok: true, githubId: '111' }) });
  assert.equal(r.status, 401);
  assert.equal(rec.length, 0);
});

test('hosted author: a member missing from the members-index gets a 409, no git writes', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), env, {
    ...deps(rec),
    authorize: async () => ({ ok: true, githubId: '55555' }),
    fetchUser: async () => ({ githubLogin: 'newbie', githubId: '55555' }),
  });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'folder_not_provisioned');
  assert.equal(rec.length, 0);
});

test('hosted author: an out-of-folder path is rejected 400, no git writes', async () => {
  const rec = [];
  for (const path of ['members/rfilipo/posts/x.md', 'house/roles.yml', 'members/atwellpub/../../house/roles.yml']) {
    const r = await membershipAuthor(req({ ...goodBody, files: [{ path, content: 'x' }] }), env, deps(rec));
    assert.equal(r.status, 400, `${path} must be rejected`);
  }
  assert.equal(rec.length, 0);
});

test('hosted author: rate-limited is a 429 before any git work', async () => {
  const rec = [];
  const r = await membershipAuthor(req(goodBody), env, { ...deps(rec), limiter: async () => ({ allowed: false, count: 11, limit: 10 }) });
  assert.equal(r.status, 429);
  assert.equal(rec.length, 0);
});

test('hosted author: a null-content file issues a contents DELETE on the branch', async () => {
  const rec = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/contents\/members\/atwellpub\/posts\/old\.md\?ref=/.test(url) && method === 'GET') {
      return { ok: true, status: 200, async json() { return { sha: 'filesha' }; } };
    }
    return ghFetch(rec)(url, init);
  };
  const r = await membershipAuthor(req({ itemId: 'old', files: [{ path: 'members/atwellpub/posts/old.md', content: null }] }), env, { ...deps(rec), fetchImpl });
  assert.equal(r.status, 200);
  const del = rec.find((c) => c.method === 'DELETE');
  assert.ok(del, 'a DELETE was issued');
  assert.equal(del.body.sha, 'filesha');
  assert.equal(del.body.branch, 'hosted/2002207/old');
});

test('hosted author: an existing PR on the branch (422) reports already, not an error', async () => {
  const rec = [];
  const fetchImpl = async (url, init = {}) => {
    if (/\/pulls$/.test(url) && (init.method || 'GET') === 'POST') return { ok: false, status: 422, async json() { return {}; } };
    return ghFetch(rec)(url, init);
  };
  const r = await membershipAuthor(req(goodBody), env, { ...deps(rec), fetchImpl });
  assert.equal(r.status, 200);
  assert.equal(r.body.already, true);
});

// ---- SOW-157: the 409 path fires the enroll dispatch (rate-limited, fail-soft) ----

test('hosted author: a missing index entry fires the enroll dispatch once (rate-limited) and reports provisioning', async () => {
  const rec = [];
  const dispatched = [];
  const dispatch = async (opts) => { dispatched.push(opts); return true; };
  const d = {
    ...deps(rec),
    authorize: async () => ({ ok: true, githubId: '55555' }),
    fetchUser: async () => ({ githubLogin: 'newbie', githubId: '55555' }),
    dispatch,
  };
  const envd = { ...env, REGATE_DISPATCH_TOKEN: 'dtok', GITHUB_CONTENT_REPO: 'gbti-network/gbti.network' };
  const r = await membershipAuthor(req(goodBody), envd, d);
  assert.equal(r.status, 409);
  assert.equal(r.body.provisioning, true);
  assert.equal(dispatched[0].eventType, 'enroll');
  assert.equal(dispatched[0].githubId, '55555');
  // second call within the window: the rl:enroll limiter (real limiter injected) would block; here the
  // injected allow-all limiter passes, so assert the dispatch carries the token wiring instead.
  assert.equal(dispatched[0].dispatchToken, 'dtok');
});

test('hosted author: the enroll rate limiter blocks a repeat nudge (provisioning false, still 409)', async () => {
  const rec = [];
  const dispatched = [];
  const d = {
    ...deps(rec),
    authorize: async () => ({ ok: true, githubId: '55555' }),
    fetchUser: async () => ({ githubLogin: 'newbie', githubId: '55555' }),
    dispatch: async () => { dispatched.push(1); return true; },
    limiter: async ({ prefix }) => (prefix === 'rl:enroll:' ? { allowed: false } : { allowed: true }),
  };
  const r = await membershipAuthor(req(goodBody), { ...env, REGATE_DISPATCH_TOKEN: 'dtok' }, d);
  assert.equal(r.status, 409);
  assert.equal(r.body.provisioning, false);
  assert.equal(dispatched.length, 0, 'no dispatch when rate-limited');
});

test('sow-158 Phase 3a: a website (cookie) caller publishes with NO bearer re-check', async () => {
  // authorizePaid resolves the cookie session (via:'cookie') and carries the HMAC-verified github_id; the
  // endpoint must skip the fetchUser(bearer) re-check (the cookie holds no token) and still open the hosted PR.
  const rec = [];
  const paidCookie = async () => ({ ok: true, githubId: '2002207', via: 'cookie' });
  let fetchUserCalled = false;
  const fetchUserSpy = async () => { fetchUserCalled = true; return { githubLogin: 'atwellpub', githubId: '2002207' }; };
  const reqNoBearer = { headers: { get: () => null }, json: async () => goodBody }; // no Authorization header
  const r = await membershipAuthor(reqNoBearer, env, { kv: fakeKv(), fetchImpl: ghFetch(rec), signJwt, authorize: paidCookie, fetchUser: fetchUserSpy, limiter: allow });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.branch, 'hosted/2002207/my-first-post', 'server-inserted github_id in the hosted branch');
  assert.equal(fetchUserCalled, false, 'the cookie path does NOT re-verify a bearer token');
});
