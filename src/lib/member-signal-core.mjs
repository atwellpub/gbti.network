// sow-158 Phase 2: the PURE identity logic shared by the site consumer (member-signal.ts). Kept in a .mjs core so
// `node --test` can import it (the test runner has no TS loader). No DOM. `memberSignalFromStatus` maps the public
// /membership/status payload into the presentation-only MemberSignal; `selectIdentity` is the cookie-wins precedence.

/**
 * Map the /membership/status payload ({ ok, github_id, login, status, canCurate, couponUntil }) into a
 * MemberSignal, or null when there is no signed-in member. Presentation only (it drives header chrome, never a
 * security decision). `role` defaults to 'member': the status oracle does not return the role, and the admin menu
 * item is extension-relay-only, so a cookie-hydrated header surfaces no role-gated actions.
 */
export function memberSignalFromStatus(payload) {
  if (!payload || payload.ok !== true || !payload.login) return null;
  const status = typeof payload.status === 'string' ? payload.status : 'unknown';
  return {
    authenticated: true,
    login: String(payload.login),
    githubId: payload.github_id != null ? String(payload.github_id) : null,
    username: String(payload.login),
    role: 'member',
    membership: status,
    canPublish: status === 'paid',
    source: 'cookie',
  };
}

/**
 * Precedence: the httpOnly-cookie session WINS over the extension's display-only signal. Returns the cookie
 * signal once the cookie fetch has resolved to a member; otherwise the extension signal (which may be null). A
 * resolved-but-signed-out cookie (cookieSignal null) defers to the extension, so an anonymous cookie state does
 * not suppress an installed+signed-in extension.
 */
export function selectIdentity({ cookieResolved, cookieSignal, extSignal }) {
  if (cookieResolved && cookieSignal) return cookieSignal;
  return extSignal ?? null;
}
