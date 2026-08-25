// SOW-011: the membership-status oracle. The local client (the Chrome extension + the npm host) holds no
// Stripe key, so it asks the Worker for the signed-in member's Stripe-derived status. We authenticate the
// caller by their GitHub token: verify it against GitHub /user to resolve the immutable github_id, then derive
// the status from Stripe. The client folds in the git-native overrides (staff / grandfather / ban) itself. The
// token is used read-only to identify the caller and is never stored.
//
// Returns { status, body } so the router can wrap it in json() with CORS headers. Pure over injected
// fetch/clients, so it is unit-tested with fakes (no network, no secrets).

import { githubFetchUser } from './oauth.mjs';
import { resolveIdentity } from './identity.mjs'; // sow-158 Phase 1b: bearer-or-cookie identity
import { deriveMembership } from '../../membership/derive-status.mjs'; // sow-185: { status, tier } (status == old deriveStatus)
import { createStripeClient } from '../../clients/stripe.mjs';
import { rolesFromParsed, roleOf, curatorsFromParsed, isCurator, canCurateNews, grandfathersFromParsed, effectiveStatus as effectiveStatusOf } from '../../membership/overrides-core.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';
import { recordUsage } from './analytics.mjs'; // SOW-061: usage analytics seam
import { readCouponGrant } from './coupons.mjs'; // SOW-119: the coupon fast-path grant
import { usageBucket, overridesFromMirror } from '../../membership/usage-bucket.mjs'; // SOW-061: effective tier bucket
import { buildEnvPriceTierMap, resolveEffectiveTier, grantTier } from '../../membership/tier-gate.mjs'; // sow-185: price map + override-aware paid tier
import { TIER, meetsTier, isTier } from '../../membership/tiers.mjs'; // sow-185: the paid-tier axis (none < member < creator)

// SOW-046 C: best-effort read of the caller's NEWS-CURATOR capability from the KV overrides mirror. Used ONLY to
// hint the client UI (show the "Add to Discord" action); the Worker re-checks server-side on every publish, so a
// stale/absent mirror just hides the button (fail-closed for the capability, never for the status itself).
// Read + validate the overrides mirror ONCE (present + fresh), reused for the curator hint AND the SOW-061 analytics
// bucket so the status check makes a single KV read. Returns the mirror or null (stale/absent -> null).
async function readFreshMirror(env, now = new Date()) {
  try {
    const mirror = await env.SIGNUP_KV.get(OVERRIDES_KV_KEY, 'json');
    if (!mirror || !mirror.generatedAt) return null;
    const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return null;
    return mirror;
  } catch {
    return null;
  }
}

// The caller's NEWS-CURATOR capability from the mirror (UI hint only; the Worker re-checks on every publish, so a
// stale/absent mirror just hides the button, fail-closed for the capability, never for the status itself).
function computeCanCurate(mirror, githubId) {
  if (!mirror || mirror.roles == null || typeof mirror.roles !== 'object' || Array.isArray(mirror.roles)) return false;
  const role = roleOf(githubId, rolesFromParsed(mirror.roles));
  return canCurateNews(role, isCurator(githubId, curatorsFromParsed(mirror.roles)));
}

export async function membershipStatus(request, env, { fetchImpl = globalThis.fetch, makeStripe = createStripeClient, fetchUser = githubFetchUser, verifyCookie, now = new Date() } = {}) {
  // SOW-061: a status check with no resolvable identity is an 'anonymous' usage event, recorded before the 401.
  const anon = () => recordUsage(env, { tier: 'anonymous', event: 'status_check', request });
  // sow-158 Phase 1b: the oracle also accepts the website session cookie (allowCookie). It is a GET, so there is
  // no CSRF gate; a bearer caller is resolved exactly as before. Any auth failure still records the anon event.
  const id = await resolveIdentity(request, env, { fetchImpl, fetchUser, ...(verifyCookie ? { verifyCookie } : {}), now, allowCookie: true });
  if (!id.ok) { anon(); return { status: id.status, body: id.body }; }
  const githubId = String(id.githubId);
  const login = id.login;

  if (!env?.STRIPE_SECRET_KEY) return { status: 500, body: { error: 'misconfigured', message: 'Stripe is not configured' } };
  const stripe = makeStripe({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });

  // deriveMembership fails closed to { status: 'none', tier: 'none' } on any lookup error, so a Stripe outage
  // never default-opens. `derivedStatus` is IDENTICAL to the old deriveStatus (every existing line is unchanged);
  // sow-185 additionally reads `stripeTier` (the paid tier from the subscription's price via the env price map,
  // which is INERT / all-creator until the owner maps the $5 member price). derivedStatus stays the PRE-coupon
  // value, used below for the tier's effective-source computation.
  const { status: derivedStatus, tier: stripeTier } = await deriveMembership(githubId, stripe, { priceTierMap: buildEnvPriceTierMap(env), now });
  let status = derivedStatus;
  const stripePaid = derivedStatus === 'paid';
  // SOW-119: the coupon fast-path. A fresh redemption reports as paid so the client unlocks immediately
  // (the durable git grant lands at the next reconcile). The client still folds its own overrides on top,
  // so a ban keeps outranking this exactly as it outranks a real subscription.
  let couponUntil = null;
  let couponTier = null; // sow-142: the tier the coupon confers, honored below instead of assuming creator
  if (!stripePaid) {
    const grant = await readCouponGrant(env.SIGNUP_KV, githubId, now);
    if (grant) { status = 'paid'; couponUntil = grant.until ?? null; couponTier = grant.tier ?? null; }
  }
  const mirror = await readFreshMirror(env, now); // one read, reused for the curator hint + the analytics bucket
  // SOW-119 QA: the grant end date also resolves from the folded-in git grant (the mirror grandfather entry
  // with a coupon: reason), covering a lost/expired KV record. Suppressed when Stripe itself is paid, so the
  // countdown only reaches members whose paid status IS the coupon grant.
  if (!stripePaid && !couponUntil) {
    const entry = mirror?.grandfathered && typeof mirror.grandfathered === 'object'
      ? grandfathersFromParsed(mirror.grandfathered).get(githubId)
      : null;
    if (entry?.until && String(entry.reason ?? '').startsWith('coupon:')) {
      const until = new Date(entry.until);
      if (!Number.isNaN(until.getTime()) && now.getTime() < until.getTime()) { couponUntil = until.toISOString(); couponTier = entry.tier ?? null; }
    }
  }
  const canCurate = computeCanCurate(mirror, githubId); // SOW-046 C: UI hint only; the Worker re-checks on publish
  // SOW-061 + sow-158: compute the EFFECTIVE tier (ban > staff > grandfather > Stripe) ONCE, reused for the
  // analytics cohort AND the response. The STATIC SITE cannot read the overrides mirror, so it cannot fold staff/
  // grandfather itself (the extension/npm hosts do); returning effectiveStatus + role lets the site label + gate
  // (e.g. show Admin tools to a superadmin, show "Paid member" for staff) correctly. `status` stays Stripe-derived
  // so the extension/npm keep folding their own local overrides — this is purely additive.
  const overrides = overridesFromMirror(mirror);
  const effectiveStatus = usageBucket(status, { githubId, overrides, now });
  const role = roleOf(githubId, overrides?.roles ?? new Map());
  // sow-185: resolve the paid TIER (none|member|creator) with the SAME rules the gate's authorizeCreator uses
  // (membership-content resolveEffective), so the client never shows a creator perk the server denies. This is
  // the BILLING axis, NOT the SOW-061 usageBucket above (which reuses the word "tier" for the analytics cohort).
  // Fail closed to none: an unresolvable source resolves to none, and NO fresh mirror -> none (the gate DENIES
  // creator on a stale/absent mirror, so the UI must not offer it either). effectiveStatusOf uses the PRE-coupon
  // derivedStatus for the source, exactly as resolveEffective does.
  let paidTier = TIER.none;
  if (overrides) {
    const eff = effectiveStatusOf(githubId, derivedStatus, overrides, now); // { status, source }
    const gfGrant = overrides.grandfathers.get(String(githubId));
    paidTier = resolveEffectiveTier({ source: eff.source, status: eff.status, stripeTier, grant: gfGrant });
    // A fresh coupon grants the tier its campaign confers, and MEMBER for a tierless grant. OWNER RULING
    // 2026-08-24: "coupons ... should only offer membership rather than creator". Guarded exactly as
    // resolveEffective: only when the pre-coupon effective status is neither paid (nothing to add) nor banned
    // (a ban outranks a coupon), and never a downgrade (the meetsTier guard keeps a higher existing tier, so a
    // superadmin or a hand-set creator grandfather is not demoted by holding a member-tier coupon).
    //
    // grantTier() rather than a hand-rolled ternary, so this ORACLE and the membership-content GATE read the
    // same default from one place. They disagreed silently before, and this is the surface the UI renders from.
    const couponPaidTier = grantTier({ tier: couponTier });
    if (couponUntil && eff.status !== 'paid' && eff.status !== 'banned' && !meetsTier(paidTier, couponPaidTier)) {
      paidTier = couponPaidTier;
    }
  }
  recordUsage(env, { tier: effectiveStatus, event: 'status_check', request });
  return { status: 200, body: { ok: true, github_id: githubId, login: login || null, status, effectiveStatus, role, canCurate, couponUntil, paidTier } };
}
