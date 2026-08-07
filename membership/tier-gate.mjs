// sow-185 phase 3a: resolve a member's effective TIER for the publish gates, and build the price -> tier map
// from the Worker / CI env. PURE, node-free, Worker+CI-safe (like membership/tiers.mjs and checkout-prices.mjs).
//
// The STATUS axis (paid / trialing / banned / ...) is resolved by membership/overrides-core.mjs effectiveStatus,
// which folds ban > staff > grandfather > Stripe. This module adds ONLY the tier axis, and it resolves the tier
// from that SAME effectiveStatus { status, source } so the overrides are never dropped. An account paid via an
// OVERRIDE (grandfather or staff) has no Stripe subscription, so a Stripe-only resolver (deriveMembership) would
// give it tier none and the creator gate would wrongly deny a grandfathered comp member or a superadmin. Reading
// the source closes that hole. Fail closed to TIER.none everywhere.
import { TIER, isTier, buildPriceTierMap } from './tiers.mjs';
import { PRICE_ENV, BILLING_PERIODS } from './checkout-prices.mjs';

// The paid tiers a grandfather grant may name. A grant is a PAID comp, so `none` is NOT a grant tier
// (free = no grant; deplatform = a ban). Shared with scripts/validate-content.mjs.
export const PAID_GRANT_TIERS = Object.freeze([TIER.member, TIER.creator]);

/**
 * Build the priceId -> tier Map that tiers.mjs tierForPrice / deriveMembership consume, from the injected env.
 * Each configured PRICE_ENV[tier][period] var maps its price id to that tier; the legacy STRIPE_PRICE_ID is
 * seeded as creator (via buildPriceTierMap). Reuses checkout-prices PRICE_ENV so the price-env NAMING has one
 * source. An empty env yields an empty map, which tierForPrice treats as legacy single-price mode (everything
 * resolves to creator): that keeps this inert until the owner provisions AND maps the $5 member price.
 */
export function buildEnvPriceTierMap(env = {}) {
  const priceTiers = {};
  for (const tier of [TIER.member, TIER.creator]) {
    for (const period of BILLING_PERIODS) {
      const id = env[PRICE_ENV[tier][period]];
      if (typeof id === 'string' && id) priceTiers[id] = tier;
    }
  }
  const legacy = typeof env.STRIPE_PRICE_ID === 'string' && env.STRIPE_PRICE_ID ? env.STRIPE_PRICE_ID : null;
  return buildPriceTierMap({ priceTiers, legacyCreatorPriceId: legacy });
}

/**
 * The tier a grandfather grant confers. The optional `tier` field lets a superadmin (admin+) set any account to
 * a specific paid tier by editing house/grandfathered.yml (superadmin auto-merged per SOW-108). A grant with no
 * tier (every legacy flat grant) or an unrecognized one defaults to creator, preserving the full complimentary
 * access those grants were issued under.
 */
export function grantTier(grant) {
  const t = grant?.tier;
  return isTier(t) && t !== TIER.none ? t : TIER.creator;
}

/**
 * Resolve the effective TIER from effectiveStatus's { status, source } plus the Stripe tier and (for a
 * grandfather) the grant entry. Never drops an override:
 *   ban         -> none (the account is denied by status: banned anyway)
 *   staff       -> creator (admins / superadmins hold full access; the owner path folds roles into source)
 *   grandfather -> the grant's tier (default creator)
 *   stripe      -> the Stripe subscription's tier WHEN currently paid, else none
 * Fail closed: an unknown source, or a non-paid stripe status, resolves to none.
 */
export function resolveEffectiveTier({ source, status, stripeTier = TIER.none, grant = null } = {}) {
  switch (source) {
    case 'ban': return TIER.none;
    case 'staff': return TIER.creator;
    case 'grandfather': return grantTier(grant);
    case 'stripe': return status === 'paid' && isTier(stripeTier) ? stripeTier : TIER.none;
    default: return TIER.none;
  }
}
