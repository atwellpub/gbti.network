// sow-185 phase 3b: the multi-price checkout allowlist. PURE, node-free, Worker-safe (like membership/tiers.mjs).
// Resolves a requested { tier, period } to a CONFIGURED Stripe price id, FAIL CLOSED. The price ids are injected
// from the Worker env (the owner provisions them); this module never hardcodes an id. The env-var NAMES match
// house/membership-tiers.yml `priceEnv`, the single naming convention shared by the site and the Worker (a test
// asserts they do not drift). Free (none) is not purchasable and has no price.
import { TIER, isTier } from './tiers.mjs';

export const BILLING_PERIODS = Object.freeze(['monthly', 'annual']);
export const isBillingPeriod = (p) => BILLING_PERIODS.includes(p);

// The env-var name per PAID tier x period. MUST equal house/membership-tiers.yml priceEnv (drift-tested).
export const PRICE_ENV = Object.freeze({
  [TIER.member]: Object.freeze({ monthly: 'STRIPE_PRICE_MEMBER_MONTHLY', annual: 'STRIPE_PRICE_MEMBER_ANNUAL' }),
  [TIER.creator]: Object.freeze({ monthly: 'STRIPE_PRICE_CREATOR_MONTHLY', annual: 'STRIPE_PRICE_CREATOR_ANNUAL' }),
});

/**
 * Build the { tier: { period: priceId } } allowlist from the injected Worker env. Reads the four PRICE_ENV vars;
 * an unset var is omitted, so an un-provisioned price is simply absent (and thus not purchasable -> fail closed
 * downstream). The legacy single price env.STRIPE_PRICE_ID is the Content Creator annual, so it back-fills
 * creator.annual ONLY when the new var is unset, keeping today's checkout working through the transition. Pure.
 */
export function buildCheckoutPriceMap(env = {}) {
  const map = {};
  for (const tier of [TIER.member, TIER.creator]) {
    const periods = {};
    for (const period of BILLING_PERIODS) {
      const id = env[PRICE_ENV[tier][period]];
      if (typeof id === 'string' && id) periods[period] = id;
    }
    if (Object.keys(periods).length) map[tier] = periods;
  }
  const legacy = env.STRIPE_PRICE_ID;
  if (typeof legacy === 'string' && legacy) {
    if (!map[TIER.creator]) map[TIER.creator] = {};
    if (!map[TIER.creator].annual) map[TIER.creator].annual = legacy;
  }
  return map;
}

/**
 * Resolve a requested { tier, period } to a configured price id, or null. FAIL CLOSED: an unknown or free tier,
 * an unknown period, or a tier+period with no configured price all return null (never a fallback to a different
 * price). The caller rejects a null request rather than charging the wrong price.
 */
export function resolveCheckoutPrice({ tier, period } = {}, map = {}) {
  if (!isTier(tier) || tier === TIER.none) return null; // free is not purchasable; an unknown tier fails closed
  if (!isBillingPeriod(period)) return null;
  const id = map && map[tier] && map[tier][period];
  return typeof id === 'string' && id ? id : null;
}
