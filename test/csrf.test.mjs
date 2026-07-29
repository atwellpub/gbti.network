// sow-158 Phase 1b: CSRF (double-submit token + mandatory Origin allow-list) for cookie-authenticated writes.
// Verifies the token cookie shape, the double-submit match, and the fail-closed Origin check (cookie-tossing
// defense). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCsrfToken, csrfCookieHeader, readCsrfCookie, readAllCsrfCookies, requireCsrf, CSRF_COOKIE, CSRF_HEADER } from '../workers/signup/csrf.mjs';

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

test('readAllCsrfCookies returns every gbti_csrf value (host-only + Domain coexistence)', () => {
  assert.deepEqual(readAllCsrfCookies('a=1; gbti_csrf=stale; b=2; gbti_csrf=fresh'), ['stale', 'fresh']);
  assert.deepEqual(readAllCsrfCookies('gbti_csrf=only'), ['only']);
  assert.deepEqual(readAllCsrfCookies('other=1'), []);
  assert.deepEqual(readAllCsrfCookies(null), []);
});

// The web-login-fix collision: a stale host-only gbti_csrf and the Domain=gbti.network gbti_csrf are both sent to
// signup.gbti.network. The site can only read (and echo) the Domain one, so the header must be accepted when it
// matches EITHER present cookie, regardless of order. A strict first-cookie compare would 403 logout + all writes.
test('requireCsrf accepts the header matching ANY present gbti_csrf (stale + fresh coexist)', () => {
  const twoCookies = (header, order) => {
    const cookie = order.map((v) => `${CSRF_COOKIE}=${v}`).join('; ');
    return new Request('https://signup.gbti.network/auth/logout', { method: 'POST', headers: { Cookie: cookie, [CSRF_HEADER]: header, Origin: 'https://gbti.network' } });
  };
  // header matches the SECOND (fresh) cookie while a stale one sorts first -> still passes
  assert.equal(requireCsrf(twoCookies('fresh', ['stale', 'fresh']), ENV).ok, true);
  // header matches the FIRST cookie -> passes
  assert.equal(requireCsrf(twoCookies('fresh', ['fresh', 'stale']), ENV).ok, true);
  // header matches NEITHER -> still 403
  assert.equal(requireCsrf(twoCookies('nope', ['stale', 'fresh']), ENV).status, 403);
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
