// sow-185 phase 3a: the tier-gate helpers (membership/tier-gate.mjs). Pure, node-testable, no network.
// Verifies the env -> price-tier map (fail-closed once non-empty, inert when empty), the grandfather grant
// tier default, and the override-aware effective-tier resolution that keeps a grandfathered / staff account
// paid via an override from being wrongly denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvPriceTierMap, grantTier, resolveEffectiveTier, PAID_GRANT_TIERS } from '../membership/tier-gate.mjs';
import { TIER, tierForPrice } from '../membership/tiers.mjs';

const FULL_ENV = {
  STRIPE_PRICE_MEMBER_MONTHLY: 'price_mm',
  STRIPE_PRICE_MEMBER_ANNUAL: 'price_ma',
  STRIPE_PRICE_CREATOR_MONTHLY: 'price_cm',
  STRIPE_PRICE_CREATOR_ANNUAL: 'price_ca',
};

test('buildEnvPriceTierMap: maps each configured price id to its tier', () => {
  const map = buildEnvPriceTierMap(FULL_ENV);
  assert.equal(map.get('price_mm'), TIER.member);
  assert.equal(map.get('price_ma'), TIER.member);
  assert.equal(map.get('price_cm'), TIER.creator);
  assert.equal(map.get('price_ca'), TIER.creator);
  // The map is non-empty, so an UNMAPPED price fails closed to none (this is the enforce-before-provision point).
  assert.equal(tierForPrice('price_unknown', map), TIER.none);
});

test('buildEnvPriceTierMap: the legacy STRIPE_PRICE_ID seeds creator', () => {
  const map = buildEnvPriceTierMap({ STRIPE_PRICE_ID: 'price_legacy' });
  assert.equal(map.get('price_legacy'), TIER.creator);
  assert.equal(tierForPrice('price_legacy', map), TIER.creator);
});

test('buildEnvPriceTierMap: the legacy id is added alongside the explicit prices, all consistent', () => {
  const map = buildEnvPriceTierMap({ ...FULL_ENV, STRIPE_PRICE_ID: 'price_legacy' });
  assert.equal(map.get('price_ca'), TIER.creator);
  assert.equal(map.get('price_legacy'), TIER.creator);
  assert.equal(map.get('price_mm'), TIER.member);
});

test('buildEnvPriceTierMap: empty env -> empty map -> tierForPrice FAILS CLOSED to none', () => {
  // This asserted `creator` and called it "inert, no regression". It was neither: an unprovisioned env is
  // exactly what the PR gate had, so it granted creator to every paid subscriber.
  const map = buildEnvPriceTierMap({});
  assert.equal(map.size, 0);
  assert.equal(tierForPrice('anything', map), TIER.none);
});

test('grantTier: no tier field -> creator (legacy flat grant default)', () => {
  assert.equal(grantTier({ github_id: '1' }), TIER.creator);
  assert.equal(grantTier({}), TIER.creator);
  assert.equal(grantTier(null), TIER.creator);
  assert.equal(grantTier(undefined), TIER.creator);
});

test('grantTier: an explicit member / creator tier is honored', () => {
  assert.equal(grantTier({ tier: 'member' }), TIER.member);
  assert.equal(grantTier({ tier: 'creator' }), TIER.creator);
});

test('grantTier: an invalid or none tier falls back to creator (validate-content rejects it at PR time)', () => {
  assert.equal(grantTier({ tier: 'none' }), TIER.creator);
  assert.equal(grantTier({ tier: 'bogus' }), TIER.creator);
  assert.equal(grantTier({ tier: 5 }), TIER.creator);
});

test('resolveEffectiveTier: ban -> none (denied by status: banned anyway)', () => {
  assert.equal(resolveEffectiveTier({ source: 'ban', status: 'banned' }), TIER.none);
});

test('resolveEffectiveTier: staff -> creator', () => {
  assert.equal(resolveEffectiveTier({ source: 'staff', status: 'paid' }), TIER.creator);
});

test('resolveEffectiveTier: grandfather -> the grant tier, default creator', () => {
  assert.equal(resolveEffectiveTier({ source: 'grandfather', status: 'paid', grant: {} }), TIER.creator);
  assert.equal(resolveEffectiveTier({ source: 'grandfather', status: 'paid', grant: { tier: 'member' } }), TIER.member);
  assert.equal(resolveEffectiveTier({ source: 'grandfather', status: 'paid', grant: { tier: 'creator' } }), TIER.creator);
});

test('resolveEffectiveTier: stripe paid -> the stripe tier; non-paid -> none', () => {
  assert.equal(resolveEffectiveTier({ source: 'stripe', status: 'paid', stripeTier: TIER.member }), TIER.member);
  assert.equal(resolveEffectiveTier({ source: 'stripe', status: 'paid', stripeTier: TIER.creator }), TIER.creator);
  assert.equal(resolveEffectiveTier({ source: 'stripe', status: 'trialing', stripeTier: TIER.member }), TIER.none);
  assert.equal(resolveEffectiveTier({ source: 'stripe', status: 'expired', stripeTier: TIER.creator }), TIER.none);
  assert.equal(resolveEffectiveTier({ source: 'stripe', status: 'paid', stripeTier: 'bogus' }), TIER.none); // junk tier fails closed
});

test('resolveEffectiveTier: unknown source and empty input fail closed to none', () => {
  assert.equal(resolveEffectiveTier({ source: 'wat', status: 'paid' }), TIER.none);
  assert.equal(resolveEffectiveTier({}), TIER.none);
  assert.equal(resolveEffectiveTier(), TIER.none);
});

test('PAID_GRANT_TIERS: exactly member and creator (never none)', () => {
  assert.deepEqual([...PAID_GRANT_TIERS].sort(), ['creator', 'member']);
  assert.ok(!PAID_GRANT_TIERS.includes(TIER.none));
});
