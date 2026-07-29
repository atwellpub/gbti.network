// sow-158 Phase 1b: CSRF (double-submit token + mandatory Origin allow-list) for cookie-authenticated writes.
// Verifies the token cookie shape, the double-submit match, and the fail-closed Origin check (cookie-tossing
// defense). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCsrfToken, csrfCookieHeader, readCsrfCookie, requireCsrf, CSRF_COOKIE, CSRF_HEADER } from '../workers/signup/csrf.mjs';

const ENV = { CORS_ALLOWED_ORIGINS: 'https://gbti.network' };
const post = ({ cookie, header, origin } = {}) => {
  const headers = {};
  if (cookie != null) headers['Cookie'] = `${CSRF_COOKIE}=${cookie}`;
  if (header != null) headers[CSRF_HEADER] = header;
  if (origin != null) headers['Origin'] = origin;
  return new Request('https://signup.gbti.network/membership/activity', { method: 'POST', headers });
};

test('generateCsrfToken returns distinct high-entropy tokens', () => {
  const a = generateCsrfToken();
  const b = generateCsrfToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40); // 32 random bytes -> ~43 base64url chars
});

test('csrfCookieHeader is Secure + SameSite=Lax + Path=/, and deliberately NOT HttpOnly', () => {
  const c = csrfCookieHeader('tok');
  assert.match(c, /^gbti_csrf=tok/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
  assert.ok(!/HttpOnly/.test(c)); // the site JS must read it via document.cookie
  assert.ok(!/Domain=/.test(c), 'no domain option -> host-only (dev / same-origin)');
});

// sow-158 web-login fix: with a domain, the readable csrf cookie is scoped to the registrable domain so the static
// site (gbti.network) can read it while the Worker serves the OAuth callback from signup.gbti.network.
test('csrfCookieHeader with a domain scopes it cross-subdomain (Domain=<registrable>)', () => {
  const c = csrfCookieHeader('tok', { domain: 'gbti.network' });
  assert.match(c, /Domain=gbti\.network/);
  assert.match(c, /SameSite=Lax/);
  assert.ok(!/HttpOnly/.test(c));
  // the expiry (logout) must carry the SAME domain or the browser keeps the Domain-scoped cookie
  const expired = csrfCookieHeader('', { ttlSeconds: 0, domain: 'gbti.network' });
  assert.match(expired, /Domain=gbti\.network/);
  assert.match(expired, /Max-Age=0/);
});

test('readCsrfCookie extracts the token or null', () => {
  assert.equal(readCsrfCookie('a=1; gbti_csrf=xyz; b=2'), 'xyz');
  assert.equal(readCsrfCookie('other=1'), null);
  assert.equal(readCsrfCookie(null), null);
});

test('requireCsrf passes when header === cookie AND Origin is allow-listed', () => {
  assert.equal(requireCsrf(post({ cookie: 'T', header: 'T', origin: 'https://gbti.network' }), ENV).ok, true);
});

test('requireCsrf 403 on a missing header, a mismatched token, or a missing cookie', () => {
  assert.equal(requireCsrf(post({ cookie: 'T', origin: 'https://gbti.network' }), ENV).status, 403);
  assert.equal(requireCsrf(post({ cookie: 'T', header: 'X', origin: 'https://gbti.network' }), ENV).status, 403);
  assert.equal(requireCsrf(post({ header: 'T', origin: 'https://gbti.network' }), ENV).status, 403);
});

test('requireCsrf 403 on a bad, a sibling-subdomain, or a missing Origin (cookie-tossing defense)', () => {
  assert.equal(requireCsrf(post({ cookie: 'T', header: 'T', origin: 'https://evil.example' }), ENV).status, 403);
  assert.equal(requireCsrf(post({ cookie: 'T', header: 'T', origin: 'https://evil.gbti.network' }), ENV).status, 403);
  assert.equal(requireCsrf(post({ cookie: 'T', header: 'T' }), ENV).status, 403); // null Origin is hostile
});
