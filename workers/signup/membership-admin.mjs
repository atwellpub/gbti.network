// SOW-038 P2: admin-only per-member Stripe status, for the superadmin dashboard roster. The dashboard already
// shows OVERRIDE-derived status (ban > staff > grandfather) from the public repo; this fills in the live Stripe
// tier (paid / trialing / expired / cancelled / none) that is NOT reachable from public data.
//
//   GET /membership/admin/statuses -> { ok, statuses: { <github_id>: '<stripe status>' } }
//
// authorizeAdmin() applies the SAME fail-closed gate as membership-content: identity from the verified GitHub
// token only, the caller's role read from the reconcile-written SIGNUP_KV overrides mirror with the same
// staleness + shape checks, and ONLY an admin/superadmin passes. Billing status is sensitive, so this never
// reaches a non-admin and is never cached. Pure over injected deps so it unit-tests with no network/secrets.

import { githubFetchUser } from './oauth.mjs';
import { resolveIdentity } from './identity.mjs'; // sow-161: cookie-session identity for the website admin surface
import { rolesFromParsed, roleOf, isAdminRole, curatorsFromParsed, isCurator, canCurateNews, bansFromParsed, isBanned } from '../../membership/overrides-core.mjs';
import { deriveMembershipFromCustomer } from '../../membership/derive-status.mjs'; // sow-229: both axes (status + tier) from one customer
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs'; // sow-229: env price -> tier map for the live Stripe tier
import { TIER } from '../../membership/tiers.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';
import { wlog } from './wlog.mjs'; // SOW-124: Worker diagnostic logger (redacted)

const fail = (status, error, message) => ({ ok: false, status, body: { error, message } });

/**
 * Authorize an ADMIN/superadmin caller. Identity comes ONLY from the verified token; the role comes from the
 * SIGNUP_KV overrides mirror (same staleness + shape checks as membership-content), FAIL CLOSED on a
 * missing/unverifiable token, a missing/stale/incomplete mirror, or a non-admin role.
 * Returns { ok:true, githubId, role } or { ok:false, status, body }.
 */
// Verify the token -> github_id and read the fresh overrides mirror, returning the caller's role + curator flag.
// Shared, fail-closed prefix for authorizeAdmin + authorizeCurator. Returns { ok, githubId, role, isCurator, mirror }.
async function resolveCaller(request, env, { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, verifyCookie, now = new Date(), allowCookie = false } = {}) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let githubId;
  if (token) {
    let user;
    // SOW-126 review fix: the admin gate is RARE and fails closed with a hard 401 (no fallback), so it explicitly
    // opts IN to the bounded transient retry (403/429/5xx). Hot paths keep the retries=0 default.
    try { user = await fetchUser(token, fetchImpl, { retries: 2 }); }
    catch (e) {
      // Surface GitHub's real status so a transient rate-limit (403/429/5xx, retried in githubFetchUser) is not
      // confused with a genuinely bad token (401). Never echo the response body (it can carry sensitive detail).
      wlog('admin', 'token verify failed', { githubStatus: e?.status ?? null }); // SOW-124
      const gh = Number.isFinite(e?.status) && e.status ? ` (github ${e.status})` : '';
      return fail(401, 'unauthorized', `could not verify the GitHub token${gh}`);
    }
    if (!user?.githubId) return fail(401, 'unauthorized', 'the GitHub token has no user id');
    githubId = String(user.githubId);
  } else if (allowCookie) {
    // sow-161: the website admin surface authorizes over the httpOnly-cookie session (no bearer token).
    // resolveIdentity verifies the signed session HMAC and, on a non-safe method (a mutation), enforces the
    // double-submit CSRF gate; the role is then read from the mirror below exactly as for a bearer caller.
    // Fail-closed: an absent/invalid/CSRF-failing session returns its own 401/403 body, never a role.
    const id = await resolveIdentity(request, env, { fetchImpl, fetchUser, ...(verifyCookie ? { verifyCookie } : {}), now, allowCookie: true, retries: 2 });
    if (!id.ok) return { ok: false, status: id.status, body: id.body };
    githubId = String(id.githubId);
  } else {
    return fail(401, 'unauthorized', 'a GitHub bearer token is required');
  }

  let mirror = null;
  try { mirror = await env.SIGNUP_KV.get(OVERRIDES_KV_KEY, 'json'); } catch { mirror = null; }
  if (!mirror || !mirror.generatedAt) return fail(403, 'forbidden', 'member overrides are unavailable right now');
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return fail(403, 'forbidden', 'member overrides are stale right now');
  const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!isSection(mirror.roles)) return fail(403, 'forbidden', 'member overrides are incomplete right now');

  // SOW-078: ban > staff. This admin/curator path read ONLY roles, so a banned admin/superadmin/curator kept full
  // powers (statuses enumeration, ops dispatch, news publish, syndication). Read the bans section too (fail closed
  // if it is missing/malformed, exactly like roles) and deny a banned caller before any role grant.
  if (!isSection(mirror.bans)) return fail(403, 'forbidden', 'member overrides are incomplete right now');
  if (isBanned(githubId, bansFromParsed(mirror.bans))) return fail(403, 'forbidden', 'this account is not permitted');

  const role = roleOf(githubId, rolesFromParsed(mirror.roles));
  return { ok: true, githubId, role, isCurator: isCurator(githubId, curatorsFromParsed(mirror.roles)), mirror };
}

/**
 * Authorize an ADMIN/superadmin caller. Identity comes ONLY from the verified token; the role from the SIGNUP_KV
 * overrides mirror. FAIL CLOSED on a missing/unverifiable token, a missing/stale/incomplete mirror, or a
 * non-admin role. Returns { ok:true, githubId, role } or { ok:false, status, body }.
 */
export async function authorizeAdmin(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (!isAdminRole(r.role)) return fail(403, 'forbidden', 'admin access is required');
  return { ok: true, githubId: r.githubId, role: r.role };
}

/**
 * sow-183: authorize a SUPERADMIN caller. Same fail-closed mirror gate as authorizeAdmin (identity from the
 * verified token/cookie, role from the fresh SIGNUP_KV mirror, banned denied), but the floor is superadmin,
 * not admin/moderator. Used by the hosted-authoring endpoint (membership-author.mjs) to decide whether a
 * write may target a folder other than the caller's own (house/, or another member's, for content authorship
 * reassignment) -- a narrower, separate question from "is this caller admin-tier" (authorizeAdmin), so it
 * gets its own gate rather than overloading authorizeAdmin's floor. Returns { ok:true, githubId, role } or
 * { ok:false, status, body }.
 */
export async function authorizeSuperadmin(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (r.role !== 'superadmin') return fail(403, 'forbidden', 'superadmin access is required');
  return { ok: true, githubId: r.githubId, role: r.role };
}

/**
 * sow-161: authorize a STAFF caller (moderator OR admin OR superadmin) for content moderation. Same fail-closed
 * mirror gate as authorizeAdmin (identity from the verified token/cookie, role from the fresh mirror, banned
 * denied), but the floor is moderator, not admin, so a moderator can deplatform/republish/remove content. The
 * per-PATH authority is still re-checked independently by the SOW-005 gate (decide()), so this is the endpoint
 * half of the two-authority model. Returns { ok:true, githubId, role } or { ok:false, status, body }.
 */
export async function authorizeStaff(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (!(r.role === 'moderator' || isAdminRole(r.role))) return fail(403, 'forbidden', 'moderator access is required');
  return { ok: true, githubId: r.githubId, role: r.role };
}

/**
 * SOW-046 C: authorize a NEWS CURATOR (admin/superadmin OR an explicit `curators:` listing) for the news->Discord
 * publish. Same fail-closed mirror gate; a plain member with no curator grant is denied. Returns
 * { ok:true, githubId, role, isCurator } or { ok:false, status, body }.
 */
export async function authorizeCurator(request, env, deps = {}) {
  const r = await resolveCaller(request, env, deps);
  if (!r.ok) return r;
  if (!canCurateNews(r.role, r.isCurator)) return fail(403, 'forbidden', 'news curator access is required');
  return { ok: true, githubId: r.githubId, role: r.role, isCurator: r.isCurator };
}

// sow-229: list coupon redemptions from the Worker KV BINDING. This is deliberately NOT the REST-based
// scripts/lib/coupon-grants.mjs listCouponRedemptions (that reader is for the Node reconcile and speaks the
// Cloudflare KV REST API); inside the Worker we read the binding. Returns { github_id -> { code, until, tier } }
// for every `redemption:<CODE>:<id>` record, so the roster can annotate a grant a member has redeemed but
// reconcile has not yet folded into house/grandfathered.yml. Best-effort and fail-soft: any KV error yields {}
// (the roster still renders, just without the pending annotation). Billing-class data, so it never leaves the
// admin gate this endpoint already enforces.
const REDEMPTION_KEY_RE = /^redemption:([A-Z0-9]{3,32}):(\d+)$/;
async function listPendingGrants(env) {
  const out = {};
  try {
    let cursor;
    do {
      const page = await env.SIGNUP_KV.list({ prefix: 'redemption:', ...(cursor ? { cursor } : {}) });
      for (const k of page?.keys ?? []) {
        const m = REDEMPTION_KEY_RE.exec(k.name);
        if (!m) continue; // an unexpected key shape contributes nothing (fail closed)
        const [, code, id] = m;
        let value = null;
        try { value = await env.SIGNUP_KV.get(k.name, 'json'); } catch { value = null; }
        if (!value?.until) continue; // no recorded bound -> nothing to annotate
        out[id] = { code, until: value.until, tier: value.tier ?? null }; // last record wins for a member with two codes
      }
      cursor = page?.list_complete ? '' : (page?.cursor || '');
    } while (cursor);
  } catch {
    return {}; // a KV failure must not break the roster; the pending annotation is simply omitted
  }
  return out;
}

/**
 * GET /membership/admin/statuses — admin-only. Enumerate Stripe customers and return, per github_id, the derived
 * Stripe `status` AND `tier` (deriveMembershipFromCustomer, the same customer/subscription the reconcile job
 * reads), plus `logins` (SOW-091) and `pendingGrants` (sow-229: redeemed-but-unfolded coupon grants read from
 * the KV binding, an annotation for the roster). A customer with no github_id metadata is skipped. Stripe errors
 * fail closed to a 502 (no partial/guessed data); the tier is omitted for any id that does not resolve to a real
 * paid tier, so the roster fails closed to `none` rather than guessing creator.
 */
export async function membershipAdminStatuses(request, env, deps = {}) {
  const auth = await authorizeAdmin(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.STRIPE_SECRET_KEY) return { status: 500, body: { error: 'misconfigured', message: 'Stripe is not configured' } };

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const stripe = (deps.makeStripe ?? createStripeClient)({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
  const now = deps.now ?? new Date();
  const priceTierMap = buildEnvPriceTierMap(env); // sow-229: resolve the live Stripe tier from the subscription's price
  const statuses = {};
  const tiers = {}; // sow-229: github_id -> tier, only when a paid subscription resolves to a real tier
  const logins = {}; // SOW-091: github_id -> github_login (captured at signup) so the roster names a member with no content
  try {
    for await (const customer of stripe.listCustomers()) {
      const gid = String(customer?.metadata?.github_id ?? '');
      if (!gid) continue; // not a membership customer
      const { status, tier } = deriveMembershipFromCustomer(customer, { priceTierMap, now });
      statuses[gid] = status;
      if (tier && tier !== TIER.none) tiers[gid] = tier; // omit `none` so the roster fails closed rather than guessing
      const login = String(customer?.metadata?.github_login ?? '').trim();
      if (login) logins[gid] = login;
    }
  } catch {
    return { status: 502, body: { error: 'stripe_unavailable', message: 'could not read membership statuses' } };
  }
  const pendingGrants = await listPendingGrants(env); // sow-229: best-effort; {} on any KV failure
  return { status: 200, body: { ok: true, statuses, tiers, logins, pendingGrants } };
}
