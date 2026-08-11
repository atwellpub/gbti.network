// sow-158 Phase 1b: CSRF (double-submit token + mandatory Origin allow-list) for cookie-authenticated writes.
// Verifies the token cookie shape, the double-submit match, and the fail-closed Origin check (cookie-tossing
// defense). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCsrfToken, csrfCookieHeader, readCsrfCookie, readAllCsrfCookies, requireCsrf, requireOrigin, CSRF_COOKIE, CSRF_HEADER } from '../workers/signup/csrf.mjs';

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

// --- requireOrigin: the form-POST routes (/checkout, /referral/connect/start) --------------------------------
// These read the session cookie directly and cannot use requireCsrf: a top-level form POST is what lets the Lax
// cookie ride so the Worker can 302 to Stripe, and a form cannot set X-GBTI-CSRF. Enforcing the half that IS
// possible beats enforcing neither.

test('requireOrigin accepts the real checkout shape: allow-listed Origin, NO csrf header', () => {
  // The exact request MembershipTiers.astro produces: a cross-origin top-level form POST from the apex to the
  // Worker, carrying the session cookie and no custom header. If this ever fails, checkout is 403ing.
  const req = new Request('https://signup.gbti.network/checkout?tier=creator&period=annual', {
    method: 'POST',
    headers: { Origin: 'https://gbti.network', Cookie: 'gbti_session=abc' },
  });
  assert.equal(requireOrigin(req, ENV).ok, true);
  assert.equal(requireCsrf(req, ENV).ok, false, 'and requireCsrf would have rejected it, which is why this exists');
});

test('requireOrigin rejects a missing, null, or non-allow-listed Origin (fail closed)', () => {
  const at = (origin) => new Request('https://signup.gbti.network/checkout', {
    method: 'POST',
    headers: origin == null ? {} : { Origin: origin },
  });
  assert.equal(requireOrigin(at(null), ENV).ok, false, 'absent Origin is hostile on a state-changing request');
  assert.equal(requireOrigin(at('null'), ENV).ok, false);
  assert.equal(requireOrigin(at('https://evil.example'), ENV).ok, false);
  // The residual threat this actually closes: a SAME-SITE attacker on a sibling subdomain. SameSite=Lax already
  // blocks the cross-site case, so this is the one that was reachable.
  assert.equal(requireOrigin(at('https://evil.gbti.network'), ENV).ok, false);
  assert.equal(requireOrigin(at('http://gbti.network'), ENV).ok, false, 'scheme is part of the origin');
});

test('requireOrigin returns the same 403 shape as requireCsrf and shares the allow-list', () => {
  const bad = requireOrigin(new Request('https://signup.gbti.network/checkout', { method: 'POST' }), ENV);
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, 'forbidden');
  // Shared parseAllowedOrigins: a custom allow-list moves BOTH, so they can never drift about who is trusted.
  const CUSTOM = { CORS_ALLOWED_ORIGINS: 'https://staging.gbti.network' };
  const req = new Request('https://signup.gbti.network/checkout', { method: 'POST', headers: { Origin: 'https://staging.gbti.network' } });
  assert.equal(requireOrigin(req, CUSTOM).ok, true);
  assert.equal(requireOrigin(req, ENV).ok, false);
});

test('a missing CORS_ALLOWED_ORIGINS falls back to the apex, never to open', () => {
  const ok = new Request('https://signup.gbti.network/checkout', { method: 'POST', headers: { Origin: 'https://gbti.network' } });
  const no = new Request('https://signup.gbti.network/checkout', { method: 'POST', headers: { Origin: 'https://anything.example' } });
  assert.equal(requireOrigin(ok, {}).ok, true);
  assert.equal(requireOrigin(no, {}).ok, false);
});
