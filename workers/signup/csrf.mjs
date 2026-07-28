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
 * Build a Set-Cookie value for the CSRF token. Secure + SameSite=Lax + Path=/, host-only, and deliberately
 * NOT HttpOnly (the site JS must read it via document.cookie to echo it in the header). Pass ttlSeconds:0 to
 * expire it (logout). `secure` mirrors the session cookie's dev toggle.
 */
export function csrfCookieHeader(token, { ttlSeconds = DEFAULT_TTL_SECONDS, secure = true } = {}) {
  const attrs = [`${CSRF_COOKIE}=${token}`, 'Path=/', ...(secure ? ['Secure'] : []), 'SameSite=Lax', `Max-Age=${ttlSeconds}`];
  return attrs.join('; ');
}

/** Extract the raw CSRF token from a Cookie request header, or null if absent. */
export function readCsrfCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === CSRF_COOKIE) return part.slice(eq + 1).trim();
  }
  return null;
}

const fail = () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'csrf check failed' } });

/**
 * Enforce CSRF on a cookie-authenticated, state-changing request. Returns { ok:true } or a 403. Fail closed:
 * a missing header, a missing/mismatched cookie, or a missing/non-allow-listed Origin all reject.
 */
export function requireCsrf(request, env, { allowedOrigins = parseAllowedOrigins(env) } = {}) {
  const header = request.headers.get(CSRF_HEADER);
  const cookie = readCsrfCookie(request.headers.get('Cookie'));
  if (!header || !cookie || !timingSafeEqual(header, cookie)) return fail();

  const origin = request.headers.get('Origin');
  if (!origin || !allowedOrigins.has(origin)) return fail();

  return { ok: true };
}
