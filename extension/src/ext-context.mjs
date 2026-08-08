// The extension worker's ctx (SOW-006 v2 P4): the same shape context.mjs builds for the npm host, but with
// the extension adapters (a GitHub-Contents-API Reader instead of fs, the in-memory chrome-backed store). The
// dispatcher computes the role itself (async reader), so no sync role() is needed here.

import { createGithubReader } from '../../client/src/github-reader.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';
import { resolveMembership } from '../../client/src/membership.mjs';
import { SIGNUP_BASE, authModeFor } from '../../client/src/signup-base.mjs';
import { devlog } from './devlog.mjs';

export const UPSTREAM = 'gbti-network/gbti.network';

export function buildExtContext(store) {
  const token = store.get('githubToken');
  // When a read proves the token is dead (a 401 carrying our token), drop the whole session: clear the token AND
  // the cached identity so /api/status reports unauthenticated and the shell forces the sign-in splash instead of
  // showing a stale @handle over an empty hub. `authExpired()` lets /api/status flag THIS as an expiry (so the
  // splash can say "session expired") vs a plain signed-out state.
  // A 401 here means even a refresh could not save the session (the background refreshes BEFORE dispatch, so a
  // 401 reaching the reader = the refresh token is also dead/revoked, or this is a pre-refresh session). Clear the
  // whole session, refresh fields included, so nothing stale lingers and the splash forces a fresh sign-in.
  let authExpired = false;
  let membershipFlight = null;
  const onAuthError = () => { authExpired = true; store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null }); };
  return {
    store,
    devlog, // SOW-124: the background realm's devlog (superadmin + flag gated; a strict no-op otherwise)
    reader: createGithubReader({ upstream: UPSTREAM, token, onAuthError, devlog }),
    authExpired: () => authExpired,
    getRepoClient() {
      const t = store.get('githubToken');
      // SOW-157: app AND hosted members read through the Worker proxies (a hosted member has no install of
      // their own); only classic reads GitHub directly. The stored per-member mode wins over the baked one.
      return t ? createRepoClient({ token: t, upstream: UPSTREAM, appMode: authModeFor(store) !== 'classic' }) : null;
    },
    identity() {
      const id = store.get('identity');
      if (!id) return null;
      return { login: id.login, githubId: id.githubId, username: (id.username || id.login || '').toLowerCase() };
    },
    /** SOW-011: the effective membership cached at login (paid/trialing/...). Gates publish + the UI notice. */
    membership() {
      return store.get('membership') ?? 'unknown';
    },
    /** SOW-119 QA: the coupon-grant end date (ISO) cached at login/resolution; null when the paid status
     *  is not coupon-sourced. Drives the extension expiry countdown. */
    couponUntil() {
      return store.get('couponUntil') ?? null;
    },
    /** SOW-089 fix: membership was resolved ONLY at login, so one failed resolution left the session
     *  'unknown' FOREVER and every fail-closed gate (member comment bodies, the members-only thread,
     *  shares) locked a paid member out until a re-login. This self-heals: an unknown cache with a live
     *  token re-resolves via the oracle + house overrides, caches, and returns; failures stay 'unknown'
     *  (fail-closed). In-flight dedupe keeps a render burst to one resolution. */
    async membershipResolved() {
      const cached = store.get('membership');
      if (cached && cached !== 'unknown') { devlog('membership', 'resolved from cache', { membership: cached }); return cached; }
      const t = store.get('githubToken');
      const id = store.get('identity');
      if (!t || !id?.githubId) { devlog('membership', 'unknown: no token or identity', { hasToken: !!t, hasId: !!id?.githubId }); return 'unknown'; }
      if (!membershipFlight) {
        devlog('membership', 'resolving via oracle + house overrides');
        membershipFlight = resolveMembership({ githubId: String(id.githubId), token: t, signupBase: SIGNUP_BASE, readFile: (p) => this.reader.readFile(p) })
          .then(({ stripeStatus, membership, couponUntil }) => { store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null }); devlog('membership', 'resolved', { stripeStatus, membership: membership ?? 'unknown' }); return membership ?? 'unknown'; })
          .catch((e) => { devlog('membership', 'resolve failed, fail-closed to unknown', { error: e?.message }); return 'unknown'; })
          .finally(() => { membershipFlight = null; });
      }
      return membershipFlight;
    },
  };
}
