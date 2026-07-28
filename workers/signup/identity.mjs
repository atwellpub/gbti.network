// sow-158 Phase 1b: the shared identity choke point. Every member endpoint resolves the caller's github_id
// through here. It accepts EITHER an Authorization: Bearer GitHub token (the extension + npm hosts, the default
// and only path unless a route opts in) OR the signed gbti_session httpOnly cookie (the website, credentials:
// 'include'). This is the ONE place the two auth methods meet, so it is also where CSRF is enforced (cookie +
// unsafe method only; bearer is exempt because it has no ambient credential to ride).
//
// SECURITY INVARIANT: cookie acceptance is OPT-IN (allowCookie defaults false). A route that does not pass
// allowCookie:true is bearer-only and behaves byte-for-byte as it did before this change, including its 401
// messages. That keeps every token-required route (encrypt, open-pr, author, admin, ...) closed to a tokenless
// cookie caller by default. The cookie carries github_id + github_login but NO GitHub token, so a route that
// needs a live token can also assert needToken to reject a cookie caller explicitly.

import { githubFetchUser } from './oauth.mjs';
import { verifySession, readSessionCookie } from './session.mjs';
import { requireCsrf } from './csrf.mjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const unauthorized = (message) => ({ ok: false, status: 401, body: { error: 'unauthorized', message } });

/**
 * The default cookie verifier: read gbti_session from the Cookie header and HMAC-verify it against
 * SESSION_SECRET. Returns the payload ({ github_id, github_login, ... }) or null (fail closed). Injectable for
 * unit tests. Note verifySession expects `now` in milliseconds; the resolver carries `now` as a Date (matching
 * resolveEffective), so convert here.
 */
export async function defaultVerifyCookie(request, env, now = new Date()) {
  const raw = readSessionCookie(request.headers.get('Cookie'));
  if (!raw) return null;
  const ms = now instanceof Date ? now.getTime() : now;
  return verifySession(raw, env?.SESSION_SECRET, { now: ms });
}

/**
 * Resolve the caller's identity. Returns { ok:true, githubId, login, via:'bearer'|'cookie', token } or
 * { ok:false, status, body }. `token` is the raw GitHub token on the bearer path and null on the cookie path.
 *
 * @param allowCookie  false (default) => bearer-only, identical to the pre-Phase-1b behavior. true => fall back
 *                     to the gbti_session cookie when no bearer is present.
 * @param needToken    true => reject a (tokenless) cookie caller even when allowCookie (for a token sub-action).
 * @param retries      forwarded to githubFetchUser for the bearer path (the admin gate passes 2; hot paths 0).
 * @param enforceCsrf  true (default) => cookie + unsafe method requires requireCsrf().
 */
export async function resolveIdentity(request, env, {
  fetchImpl = globalThis.fetch,
  fetchUser = githubFetchUser,
  verifyCookie = defaultVerifyCookie,
  now = new Date(),
  allowCookie = false,
  needToken = false,
  retries = 0,
  enforceCsrf = true,
} = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  // Bearer path — unchanged from resolveEffective/membershipStatus, same messages, so no regression.
  if (token) {
    let user;
    try {
      user = await fetchUser(token, fetchImpl, { retries });
    } catch {
      return unauthorized('could not verify the GitHub token');
    }
    if (!user?.githubId) return unauthorized('the GitHub token has no user id');
    return { ok: true, githubId: String(user.githubId), login: user.githubLogin ?? null, via: 'bearer', token };
  }

  // No bearer token. Bearer-only routes (allowCookie:false) fail here exactly as they always have.
  if (!allowCookie) return unauthorized('a GitHub bearer token is required');

  const payload = await verifyCookie(request, env, now);
  if (!payload?.github_id) return unauthorized('authentication is required');
  if (needToken) return unauthorized('this action requires a GitHub token');

  // A state-changing cookie request must clear the CSRF gate (double-submit token + Origin allow-list). Safe
  // methods (GET/HEAD/OPTIONS) skip it. Bearer callers never reach here, so they are structurally exempt.
  if (enforceCsrf && !SAFE_METHODS.has(request.method)) {
    const csrf = requireCsrf(request, env);
    if (!csrf.ok) return csrf;
  }

  return { ok: true, githubId: String(payload.github_id), login: payload.github_login ?? null, via: 'cookie', token: null };
}
