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
  // sow-158 follow-up: prefer the EFFECTIVE status (the oracle folds ban > staff > grandfather > Stripe, which the
  // static site cannot do itself) and the resolved ROLE, both added to /membership/status. Fall back to the raw
  // Stripe `status` + 'member' for an older Worker. This drives the correct membership label AND lets the header
  // reveal role-gated items (e.g. Admin tools) to a superadmin on the cookie session.
  const membership = typeof payload.effectiveStatus === 'string' ? payload.effectiveStatus
    : (typeof payload.status === 'string' ? payload.status : 'unknown');
  return {
    authenticated: true,
    login: String(payload.login),
    githubId: payload.github_id != null ? String(payload.github_id) : null,
    username: String(payload.login),
    role: typeof payload.role === 'string' && payload.role ? payload.role : 'member',
    membership,
    // sow-185: the resolved paid TIER (none|member|creator) the Worker now folds server-side. Fail closed to
    // 'none' for an older Worker that does not send it, so a creator gate keyed on this never opens by default.
    paidTier: typeof payload.paidTier === 'string' ? payload.paidTier : 'none',
    canPublish: membership === 'paid',
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
