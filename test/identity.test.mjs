// sow-158 Phase 1b: the bearer-or-cookie identity resolver (the one choke point every member endpoint shares).
// Verifies bearer parity (unchanged messages), the OPT-IN cookie fallback, no GitHub /user call on the cookie
// path, bearer-wins precedence, the CSRF gate on cookie writes, and fail-closed everywhere. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIdentity } from '../workers/signup/identity.mjs';
import { signSession } from '../workers/signup/session.mjs';
import { CSRF_COOKIE, CSRF_HEADER } from '../workers/signup/csrf.mjs';

const SECRET = 'test-session-secret';
const ENV = { SESSION_SECRET: SECRET, CORS_ALLOWED_ORIGINS: 'https://gbti.network' };

const bearer = (tok, method = 'GET') => new Request('https://signup.gbti.network/x', { method, headers: tok ? { Authorization: `Bearer ${tok}` } : {} });

// Build a request carrying a valid signed session cookie, plus optional csrf cookie/header/origin/bearer.
async function withCookie({ method = 'GET', csrf, header, origin, githubId = '42', login = 'gwen', bearerTok } = {}) {
  const session = await signSession({ githubId, githubLogin: login }, SECRET);
  const cookies = [`gbti_session=${session}`];
  if (csrf != null) cookies.push(`${CSRF_COOKIE}=${csrf}`);
  const headers = { Cookie: cookies.join('; ') };
  if (header != null) headers[CSRF_HEADER] = header;
  if (origin != null) headers['Origin'] = origin;
  if (bearerTok) headers['Authorization'] = `Bearer ${bearerTok}`;
  return new Request('https://signup.gbti.network/x', { method, headers });
}

test('bearer path resolves via:bearer, carries the token, and calls fetchUser once', async () => {
  let called = 0;
  const r = await resolveIdentity(bearer('tok'), ENV, { fetchUser: async () => (called++, { githubId: 7, githubLogin: 'al' }) });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'bearer');
  assert.equal(r.githubId, '7');
  assert.equal(r.token, 'tok');
  assert.equal(called, 1);
});

test('bearer 401 messages match the pre-Phase-1b wording (no regression)', async () => {
  assert.equal((await resolveIdentity(bearer(null), ENV)).body.message, 'a GitHub bearer token is required');
  const bad = await resolveIdentity(bearer('tok'), ENV, { fetchUser: async () => { throw new Error('x'); } });
  assert.equal(bad.body.message, 'could not verify the GitHub token');
  const noId = await resolveIdentity(bearer('tok'), ENV, { fetchUser: async () => ({}) });
  assert.equal(noId.body.message, 'the GitHub token has no user id');
});

test('allowCookie:false + a valid cookie is STILL 401 (cookie acceptance is opt-in)', async () => {
  const req = await withCookie({});
  const r = await resolveIdentity(req, ENV, { fetchUser: async () => { throw new Error('fetchUser must not run'); } });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.body.message, 'a GitHub bearer token is required');
});

test('allowCookie:true resolves via:cookie WITHOUT a GitHub /user round-trip', async () => {
  let called = 0;
  const req = await withCookie({});
  const r = await resolveIdentity(req, ENV, { allowCookie: true, fetchUser: async () => (called++, {}) });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'cookie');
  assert.equal(r.githubId, '42');
  assert.equal(r.login, 'gwen');
  assert.equal(r.token, null);
  assert.equal(called, 0);
});

test('a tampered or absent cookie fails closed (401) even with allowCookie', async () => {
  assert.equal((await resolveIdentity(bearer(null), ENV, { allowCookie: true })).status, 401);
  const tampered = new Request('https://signup.gbti.network/x', { headers: { Cookie: 'gbti_session=not.a.valid.token' } });
  assert.equal((await resolveIdentity(tampered, ENV, { allowCookie: true })).status, 401);
});

test('needToken rejects a (tokenless) cookie caller even when allowCookie', async () => {
  const req = await withCookie({});
  const r = await resolveIdentity(req, ENV, { allowCookie: true, needToken: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('bearer wins over a cookie when both are present', async () => {
  const req = await withCookie({ bearerTok: 'tok' });
  const r = await resolveIdentity(req, ENV, { allowCookie: true, fetchUser: async () => ({ githubId: '9', githubLogin: 'b' }) });
  assert.equal(r.via, 'bearer');
  assert.equal(r.githubId, '9');
});

test('a cookie POST requires CSRF; a cookie GET does not', async () => {
  const get = await withCookie({ method: 'GET' });
  assert.equal((await resolveIdentity(get, ENV, { allowCookie: true })).ok, true);

  const postNoCsrf = await withCookie({ method: 'POST', origin: 'https://gbti.network' });
  assert.equal((await resolveIdentity(postNoCsrf, ENV, { allowCookie: true })).status, 403);

  const postOk = await withCookie({ method: 'POST', csrf: 'C', header: 'C', origin: 'https://gbti.network' });
  assert.equal((await resolveIdentity(postOk, ENV, { allowCookie: true })).ok, true);

  const postBadCsrf = await withCookie({ method: 'POST', csrf: 'C', header: 'D', origin: 'https://gbti.network' });
  assert.equal((await resolveIdentity(postBadCsrf, ENV, { allowCookie: true })).status, 403);

  const postBadOrigin = await withCookie({ method: 'POST', csrf: 'C', header: 'C', origin: 'https://evil.example' });
  assert.equal((await resolveIdentity(postBadOrigin, ENV, { allowCookie: true })).status, 403);
});
