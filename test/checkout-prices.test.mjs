// sow-185 phase 3b: the multi-price checkout allowlist (membership/checkout-prices.mjs). Pure, node-testable.
// Verifies fail-closed resolution, the legacy single-price back-compat, and that the Worker's price env-var names
// do NOT drift from house/membership-tiers.yml priceEnv (the single naming convention). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { buildCheckoutPriceMap, resolveCheckoutPrice, PRICE_ENV, BILLING_PERIODS } from '../membership/checkout-prices.mjs';
import { TIER } from '../membership/tiers.mjs';

const FULL_ENV = {
  STRIPE_PRICE_MEMBER_MONTHLY: 'price_mm',
  STRIPE_PRICE_MEMBER_ANNUAL: 'price_ma',
  STRIPE_PRICE_CREATOR_MONTHLY: 'price_cm',
  STRIPE_PRICE_CREATOR_ANNUAL: 'price_ca',
};

test('buildCheckoutPriceMap: reads the four price env vars into a tier -> period map', () => {
  assert.deepEqual(buildCheckoutPriceMap(FULL_ENV), {
    member: { monthly: 'price_mm', annual: 'price_ma' },
    creator: { monthly: 'price_cm', annual: 'price_ca' },
  });
});

test('buildCheckoutPriceMap: an unset price var is omitted (so it is not purchasable)', () => {
  assert.deepEqual(buildCheckoutPriceMap({ STRIPE_PRICE_MEMBER_MONTHLY: 'price_mm' }), { member: { monthly: 'price_mm' } });
  assert.deepEqual(buildCheckoutPriceMap({}), {});
});

test('buildCheckoutPriceMap: legacy STRIPE_PRICE_ID back-fills creator.annual ONLY when the new var is unset', () => {
  assert.equal(buildCheckoutPriceMap({ STRIPE_PRICE_ID: 'price_legacy' }).creator.annual, 'price_legacy');
  assert.equal(buildCheckoutPriceMap({ ...FULL_ENV, STRIPE_PRICE_ID: 'price_legacy' }).creator.annual, 'price_ca');
});

test('resolveCheckoutPrice: resolves each configured tier x period', () => {
  const map = buildCheckoutPriceMap(FULL_ENV);
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: 'monthly' }, map), 'price_mm');
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: 'annual' }, map), 'price_ma');
  assert.equal(resolveCheckoutPrice({ tier: 'creator', period: 'monthly' }, map), 'price_cm');
  assert.equal(resolveCheckoutPrice({ tier: 'creator', period: 'annual' }, map), 'price_ca');
});

test('resolveCheckoutPrice: FAIL CLOSED on free / unknown tier / unknown period / missing input', () => {
  const map = buildCheckoutPriceMap(FULL_ENV);
  assert.equal(resolveCheckoutPrice({ tier: 'none', period: 'monthly' }, map), null); // free is not purchasable
  assert.equal(resolveCheckoutPrice({ tier: 'bogus', period: 'monthly' }, map), null);
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: 'weekly' }, map), null);
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: undefined }, map), null);
  assert.equal(resolveCheckoutPrice({}, map), null);
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: 'monthly' }, {}), null); // empty allowlist
});

test('resolveCheckoutPrice: an unprovisioned price fails closed even for a valid tier+period', () => {
  const partial = buildCheckoutPriceMap({ STRIPE_PRICE_MEMBER_MONTHLY: 'price_mm' });
  assert.equal(resolveCheckoutPrice({ tier: 'member', period: 'annual' }, partial), null); // annual not configured
  assert.equal(resolveCheckoutPrice({ tier: 'creator', period: 'monthly' }, partial), null);
});

test('DRIFT GUARD: the Worker price env-var names equal house/membership-tiers.yml priceEnv', () => {
  const raw = yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8'));
  const byKey = Object.fromEntries((raw.tiers || []).map((t) => [t.key, t]));
  for (const tier of [TIER.member, TIER.creator]) {
    for (const period of BILLING_PERIODS) {
      assert.equal(byKey[tier]?.priceEnv?.[period], PRICE_ENV[tier][period],
        `${tier}.${period}: house/membership-tiers.yml priceEnv must match checkout-prices PRICE_ENV`);
    }
  }
});
