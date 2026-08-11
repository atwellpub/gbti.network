// sow-158 Phase 1b: CSRF protection for COOKIE-authenticated writes. A bearer request carries no ambient
// credential, so it cannot be ridden by a cross-site page and is exempt; only the cookie path needs this. The
// defense is two independent layers, BOTH required on an unsafe (state-changing) cookie request:
//   1. Double-submit: the site reads the non-HttpOnly gbti_csrf cookie via document.cookie and echoes it in the
//      X-GBTI-CSRF header; the Worker asserts header === cookie (constant-time). A cross-site page cannot read
//      the cookie value to set the header, so it cannot forge a matching pair.
//   2. Origin allow-list: the request Origin must be present and allow-listed. This independently defeats
//      cookie-tossing (a sibling subdomain setting a Domain=.gbti.network gbti_csrf) because the tossed cookie
//      does not change the forged request's Origin. A missing/null Origin on a state-changing request is hostile
//      and rejected.
// (HMAC-binding the token to the session is a documented defense-in-depth follow-up; the Origin check already
// closes the tossing hole, so a random token is sufficient for Phase 1b.)

import { timingSafeEqual } from './session.mjs';
import { parseAllowedOrigins } from './cors.mjs';

export const CSRF_COOKIE = 'gbti_csrf';
export const CSRF_HEADER = 'X-GBTI-CSRF';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days, matching the session cookie

/** base64url-encode bytes without padding. */
function b64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A fresh, high-entropy CSRF token: base64url of 32 random bytes. Held only in the cookie (stateless). */
export function generateCsrfToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}

/**
 * Build a Set-Cookie value for the CSRF token. Secure + SameSite=Lax + Path=/ + NOT HttpOnly (the site JS must
 * read it via document.cookie to echo it in the header). Pass ttlSeconds:0 to expire it (logout). `secure`
 * mirrors the session cookie's dev toggle.
 *
 * sow-158 web-login fix: `domain` scopes the cookie to a REGISTRABLE domain (e.g. "gbti.network") so the STATIC
 * SITE (gbti.network) can read it even though this Worker serves the OAuth callback from signup.gbti.network. A
 * host-only cookie here is invisible cross-subdomain, which broke real web sign-in. Cookie-tossing from a sibling
 * subdomain is still defeated by the Origin allow-list in requireCsrf (a tossed cookie cannot change the forged
 * request's Origin), so a shared-domain gbti_csrf is safe. Omitting `domain` keeps the host-only behavior (dev).
 */
export function csrfCookieHeader(token, { ttlSeconds = DEFAULT_TTL_SECONDS, secure = true, domain } = {}) {
  const attrs = [`${CSRF_COOKIE}=${token}`, 'Path=/', ...(domain ? [`Domain=${domain}`] : []), ...(secure ? ['Secure'] : []), 'SameSite=Lax', `Max-Age=${ttlSeconds}`];
  return attrs.join('; ');
}

/** Extract the FIRST raw CSRF token from a Cookie request header, or null if absent. */
export function readCsrfCookie(cookieHeader) {
  const all = readAllCsrfCookies(cookieHeader);
  return all.length ? all[0] : null;
}

/**
 * Extract EVERY gbti_csrf value present in a Cookie header. A single browser can send more than one gbti_csrf
 * for one host: a host-only cookie (e.g. an old signup.gbti.network one minted before the web-login fix) and the
 * Domain=gbti.network cookie coexist and are BOTH sent to signup.gbti.network. The header naming is ambiguous, so
 * requireCsrf must accept a header that matches ANY of them (the Origin allow-list still defeats cookie-tossing).
 */
export function readAllCsrfCookies(cookieHeader) {
  const out = [];
  if (typeof cookieHeader !== 'string') return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === CSRF_COOKIE) {
      const val = part.slice(eq + 1).trim();
      if (val) out.push(val);
    }
  }
  return out;
}

const fail = () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'csrf check failed' } });

/**
 * Enforce CSRF on a cookie-authenticated, state-changing request. Returns { ok:true } or a 403. Fail closed:
 * a missing header, a missing/mismatched cookie, or a missing/non-allow-listed Origin all reject.
 */
/**
 * Enforce ONLY the Origin allow-list on a cookie-authenticated, state-changing request. Returns { ok:true }
 * or a 403. For routes where the double-submit half is STRUCTURALLY IMPOSSIBLE, never as a softer default.
 *
 * WHY THIS EXISTS (SecurityMaster finding, 2026-08-11). `POST /checkout` and `POST /referral/connect/start`
 * read the session cookie directly and bypassed requireCsrf entirely. They cannot call it: checkout is driven
 * as a top-level same-site FORM POST (MembershipTiers.astro) so the Lax cookie rides and the Worker can 302 to
 * Stripe, and **a form submission cannot set a custom header**, so X-GBTI-CSRF can never be sent there.
 * requireCsrf would 403 the entire checkout flow.
 *
 * But the header being impossible is no reason to drop the half that IS possible. `Origin` IS sent on a
 * cross-origin form POST, and per csrf.mjs's own header comment the Origin allow-list is the layer that
 * defeats cookie-tossing, "because the tossed cookie does not change the forged request's Origin". That is
 * exactly the residual threat here: a same-site attacker on any *.gbti.network origin, which the sow-158
 * raw-HTML history and the absence of a script-blocking CSP make non-hypothetical.
 *
 * Shares parseAllowedOrigins with requireCsrf deliberately, so the two can never drift about which origins
 * are trusted.
 *
 * DO NOT reach for this to avoid wiring a token. A route that CAN carry X-GBTI-CSRF must use requireCsrf:
 * this is one layer, not two, and it is the weaker configuration.
 */
export function requireOrigin(request, env, { allowedOrigins = parseAllowedOrigins(env) } = {}) {
  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins.has(origin)) return fail();
  return { ok: true };
}

export function requireCsrf(request, env, { allowedOrigins = parseAllowedOrigins(env) } = {}) {
  const header = request.headers.get(CSRF_HEADER);
  const cookies = readAllCsrfCookies(request.headers.get('Cookie'));
  // Match the echoed header against ANY present gbti_csrf value. A host-only + Domain=gbti.network pair coexist
  // for a user who first signed in before the web-login fix; the site can only read one, so a strict first-cookie
  // compare would 403 every cookie write (logout, favorites, comments). Cookie-tossing is still blocked below.
  if (!header || !cookies.some((c) => timingSafeEqual(header, c))) return fail();

  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins.has(origin)) return fail();

  return { ok: true };
}
