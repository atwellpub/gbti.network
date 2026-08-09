// SOW-030: build the PAGE-SAFE identity signal from the /api/status response. The content script publishes this
// to gbti.network so the site can render a signed-in / member experience (header avatar, owner-only edit chrome)
// WITHOUT the GitHub token ever leaving the background worker.
//
// SECURITY CONTRACT: this is an EXPLICIT ALLOWLIST. We build a fresh object from named, non-sensitive fields and
// NEVER spread the raw status, so the GitHub token, the device-flow code, the Stripe customer id, or any secret
// can never reach the page even if a future /api/status grows new fields. login/github_id/username are already
// public on the content repo; role + membership are derived. Pure + node-free so the token-free guarantee is
// asserted directly in a unit test.

export function buildMemberSignal(status) {
  if (!status || typeof status !== 'object') return null;
  const id = status.identity;
  if (!status.authenticated || !id) return null; // signed out (or no identity) -> no signal
  return {
    authenticated: true,
    login: typeof id.login === 'string' ? id.login : null,
    githubId: id.githubId != null ? String(id.githubId) : null,
    username: typeof id.username === 'string' ? id.username : null,
    role: typeof status.role === 'string' ? status.role : 'member',
    membership: typeof status.membership === 'string' ? status.membership : 'unknown',
    // sow-185: the resolved paid TIER (none|member|creator), so the page can gate creator-only chrome without
    // re-deriving it. Fail-closed to 'none'. Presentation only, exactly like membership; the real creator gate
    // is authorizeCreator server-side. (Allowlisted by name, never spread, per the security contract above.)
    paidTier: typeof status.paidTier === 'string' ? status.paidTier : 'none',
    canPublish: status.canPublish === true,
    // SOW-060: the free-tier capability flags (signed-in perks), so the page can render them without re-deriving.
    canSeeNews: status.canSeeNews === true,
    canFollow: status.canFollow === true,
    canSave: status.canSave === true,
    canBrowse: status.canBrowse === true,
  };
}
