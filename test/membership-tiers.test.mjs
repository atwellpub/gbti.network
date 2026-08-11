// sow-185 phase 1: the membership TIER axis. Two things are under test and they pull in opposite directions,
// so both are asserted explicitly:
//   1. INERT. Nothing about today's single-price behavior changes. deriveStatus is untouched, and a customer on
//      the existing price still resolves to full creator rights.
//   2. FAIL CLOSED. Once a map exists, an unknown price, an unreadable map, a junk tier value and a lookup
//      error each resolve DOWNWARD, never to creator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIER, tierRank, meetsTier, isTier, parsePriceTiers, buildPriceTierMap,
  tierForPrice, priceIdOfSubscription, tierForSubscription,
} from '../membership/tiers.mjs';
import { STATUS, deriveStatusFromCustomer, deriveMembershipFromCustomer, deriveMembership } from '../membership/derive-status.mjs';

const NOW = new Date('2026-08-05T00:00:00Z');
const LEGACY = 'price_legacy150';
const FIVE = 'price_new5';

const customer = (over = {}) => ({ id: 'cus_1', metadata: over.metadata ?? { github_id: '1' }, subscriptions: over.subscriptions ?? { data: [] } });
const activeSub = (priceId, over = {}) => ({ status: 'active', created: 1, ...(priceId ? { items: { data: [{ price: { id: priceId } }] } } : {}), ...over });

// ---------------------------------------------------------------------------------------------------
// Ordering. The total order is the whole mechanism: a gate names a MINIMUM and meetsTier answers.
// ---------------------------------------------------------------------------------------------------

test('tiers are a total order, none < member < creator', () => {
  assert.ok(tierRank(TIER.none) < tierRank(TIER.member));
  assert.ok(tierRank(TIER.member) < tierRank(TIER.creator));
});

test('an unrecognized tier ranks below none, so it satisfies nothing', () => {
  assert.equal(tierRank('platinum'), -1);
  assert.equal(tierRank(undefined), -1);
  assert.equal(meetsTier('platinum', TIER.none), false); // even the weakest requirement is not met
});

test('meetsTier admits equal-or-higher and denies lower', () => {
  assert.equal(meetsTier(TIER.creator, TIER.member), true);
  assert.equal(meetsTier(TIER.member, TIER.member), true);
  assert.equal(meetsTier(TIER.member, TIER.creator), false);
  assert.equal(meetsTier(TIER.none, TIER.member), false);
});

test('a TYPO in a gate requirement denies rather than admits', () => {
  // The dangerous direction would be treating an unknown requirement as "no requirement". A gate written as
  // meetsTier(actual, 'creater') must deny everyone below creator, not admit everyone.
  assert.equal(meetsTier(TIER.member, 'creater'), false);
  assert.equal(meetsTier(TIER.none, 'creater'), false);
  assert.equal(meetsTier(TIER.creator, 'creater'), true); // the top tier still passes; it cannot be a false denial for a full member
});

test('isTier accepts only the three real tiers', () => {
  assert.ok(isTier(TIER.none) && isTier(TIER.member) && isTier(TIER.creator));
  assert.equal(isTier('paid'), false); // the STATUS vocabulary is a different axis and must not cross over
  assert.equal(isTier(''), false);
});

// ---------------------------------------------------------------------------------------------------
// Parsing. Junk in must not become privilege out.
// ---------------------------------------------------------------------------------------------------

test('parsePriceTiers reads a JSON string or an object', () => {
  assert.equal(parsePriceTiers(`{"${FIVE}":"member"}`).get(FIVE), TIER.member);
  assert.equal(parsePriceTiers({ [FIVE]: 'member' }).get(FIVE), TIER.member);
});

test('parsePriceTiers drops entries whose value is not a real tier', () => {
  const m = parsePriceTiers({ [FIVE]: 'member', bogus: 'admin', empty: '' });
  assert.equal(m.size, 1);
  assert.equal(m.has('bogus'), false);
});

test('unparseable input yields an EMPTY map rather than throwing', () => {
  // A throw inside a membership check would fail the request in a way that is harder to reason about than an
  // explicit empty result, and the caller (buildPriceTierMap) still seeds the legacy price on top.
  for (const bad of ['{not json', '', null, undefined, 42, ['a'], '[]']) {
    assert.equal(parsePriceTiers(bad).size, 0, `expected empty map for ${JSON.stringify(bad)}`);
  }
});

// ---------------------------------------------------------------------------------------------------
// The map. This is where inert and fail-closed are reconciled.
// ---------------------------------------------------------------------------------------------------

test('the legacy price is seeded as creator, which is what makes this ship inert', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  assert.equal(map.get(LEGACY), TIER.creator);
});

test('seeding the legacy price makes the map non-empty, so a NEW price fails closed', () => {
  // The whole point: an operator who creates the $5 price in Stripe but forgets to map it must NOT have those
  // subscribers silently receive creator rights.
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  assert.equal(tierForPrice(FIVE, map), TIER.none);
});

test('an explicit map entry wins over the legacy seed', () => {
  const map = buildPriceTierMap({ priceTiers: { [LEGACY]: 'member' }, legacyCreatorPriceId: LEGACY });
  assert.equal(map.get(LEGACY), TIER.member);
});

// Rewritten 2026-08-11. This asserted an EMPTY map grants `creator`, described as "legacy single-price mode,
// reachable only before any tier configuration exists". It was reachable in production: the Actions env seeded
// nothing, so the PR gate built an empty map and admitted a $5 Network Member as a Content Creator.
test('an entirely empty map grants NOTHING (fail closed)', () => {
  assert.equal(tierForPrice('anything', new Map()), TIER.none);
  assert.equal(tierForPrice(null, buildPriceTierMap({})), TIER.none);
  // The property in one line: an unconfigured system grants no tier, never the highest one.
  assert.notEqual(tierForPrice('anything', new Map()), TIER.creator);
});

test('with a configured map, an absent or non-string price id fails closed', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  for (const bad of [null, undefined, '', 42, {}]) assert.equal(tierForPrice(bad, map), TIER.none);
});

test('a non-Map passed where a map belongs does not throw and does not grant', () => {
  // The NAME is unchanged; only the assertion moved, because the name was right all along and the code never
  // matched it. It asserted TIER.creator, with a comment calling that "legacy behavior, not a crash inside a
  // gate" - but the alternative to granting was never a crash, it was `none`, which the test directly above
  // already asserts for every other malformed input. A `{}` passed as the PRICE failed closed while a `{}`
  // passed as the MAP granted creator. Every price map here is built from an object literal, so passing the
  // object is the natural mistake, and it produced the highest privilege.
  assert.equal(tierForPrice(LEGACY, { [LEGACY]: 'creator' }), TIER.none);
});

// ---------------------------------------------------------------------------------------------------
// Price extraction across the shapes Stripe actually returns. A missed shape would deny a real paying member.
// ---------------------------------------------------------------------------------------------------

test('priceIdOfSubscription reads every shape Stripe returns', () => {
  assert.equal(priceIdOfSubscription({ items: { data: [{ price: { id: 'p1' } }] } }), 'p1'); // modern, expanded
  assert.equal(priceIdOfSubscription({ items: [{ price: { id: 'p2' } }] }), 'p2');           // already an array
  assert.equal(priceIdOfSubscription({ items: { data: [{ plan: { id: 'p3' } }] } }), 'p3');  // legacy plan
  assert.equal(priceIdOfSubscription({ items: { data: [{ price: 'p4' }] } }), 'p4');         // unexpanded string
  assert.equal(priceIdOfSubscription({ plan: { id: 'p5' } }), 'p5');                          // top-level legacy
  assert.equal(priceIdOfSubscription({ price: { id: 'p6' } }), 'p6');
});

test('priceIdOfSubscription returns null rather than throwing on junk', () => {
  for (const bad of [null, undefined, 'sub_1', 42, {}, { items: {} }, { items: { data: [] } }, { items: { data: [{}] } }]) {
    assert.equal(priceIdOfSubscription(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('a subscription with no discoverable price fails closed once a map exists', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  assert.equal(tierForSubscription({ status: 'active' }, map), TIER.none);
});

// ---------------------------------------------------------------------------------------------------
// The two axes together.
// ---------------------------------------------------------------------------------------------------

test('deriveStatus is unchanged BY THE TIER WORK: the existing fixtures still resolve as before', () => {
  // The inertness guarantee that lets phase 1 land before any Stripe work. These fixtures carry no price id,
  // matching every pre-existing test in the suite.
  //
  // 2026-08-11: the no-sub fixture moved from `expired` to `none`, and NOT because of anything on the tier
  // axis, which is what this guard is actually about. The 90-day trial was retired, so a customer with no
  // subscription and no trial clock is now the shape of every new FREE signup rather than a lapsed trialist.
  // The guard still holds in the sense it was written for: adding a tier does not perturb status derivation.
  assert.equal(deriveStatusFromCustomer(customer({ subscriptions: { data: [{ status: 'active', created: 1 }] } }), NOW), STATUS.paid);
  assert.equal(deriveStatusFromCustomer(customer(), NOW), STATUS.none);
  assert.equal(deriveStatusFromCustomer(null, NOW), STATUS.none);
});

test('a customer on the legacy price resolves to paid + creator', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  const r = deriveMembershipFromCustomer(customer({ subscriptions: { data: [activeSub(LEGACY)] } }), { priceTierMap: map, now: NOW });
  assert.deepEqual(r, { status: STATUS.paid, tier: TIER.creator });
});

test('a customer on a mapped $5 price resolves to paid + member, NOT creator', () => {
  // This is the bug the whole phase exists to prevent.
  const map = buildPriceTierMap({ priceTiers: { [FIVE]: 'member' }, legacyCreatorPriceId: LEGACY });
  const r = deriveMembershipFromCustomer(customer({ subscriptions: { data: [activeSub(FIVE)] } }), { priceTierMap: map, now: NOW });
  assert.deepEqual(r, { status: STATUS.paid, tier: TIER.member });
});

test('a customer on an UNMAPPED price is paid but holds NO tier', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  const r = deriveMembershipFromCustomer(customer({ subscriptions: { data: [activeSub(FIVE)] } }), { priceTierMap: map, now: NOW });
  assert.deepEqual(r, { status: STATUS.paid, tier: TIER.none });
});

test('a non-paid status forces tier none regardless of what was once bought', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  const lapsed = customer({ subscriptions: { data: [{ status: 'canceled', created: 1, items: { data: [{ price: { id: LEGACY } }] } }] } });
  const r = deriveMembershipFromCustomer(lapsed, { priceTierMap: map, now: NOW });
  assert.equal(r.status, STATUS.cancelled);
  assert.equal(r.tier, TIER.none);
});

test('the tier is read from the SAME subscription that decided the status', () => {
  // An old cancelled creator subscription must not lend its tier to a current member-priced one.
  const map = buildPriceTierMap({ priceTiers: { [FIVE]: 'member' }, legacyCreatorPriceId: LEGACY });
  const both = customer({ subscriptions: { data: [
    { status: 'canceled', created: 9, items: { data: [{ price: { id: LEGACY } }] } },
    activeSub(FIVE, { created: 1 }),
  ] } });
  const r = deriveMembershipFromCustomer(both, { priceTierMap: map, now: NOW });
  assert.deepEqual(r, { status: STATUS.paid, tier: TIER.member });
});

test('deriveMembership fails closed on a lookup error and on a missing customer', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  const boom = { findCustomerByGithubId: async () => { throw new Error('stripe down'); } };
  const missing = { findCustomerByGithubId: async () => null };
  return Promise.all([
    deriveMembership('1', boom, { priceTierMap: map, now: NOW }).then((r) => assert.deepEqual(r, { status: STATUS.none, tier: TIER.none })),
    deriveMembership('1', missing, { priceTierMap: map, now: NOW }).then((r) => assert.deepEqual(r, { status: STATUS.none, tier: TIER.none })),
  ]);
});

test('deriveMembership resolves a real customer through the injected client', () => {
  const map = buildPriceTierMap({ legacyCreatorPriceId: LEGACY });
  const client = { findCustomerByGithubId: async () => customer({ subscriptions: { data: [activeSub(LEGACY)] } }) };
  return deriveMembership('1', client, { priceTierMap: map, now: NOW })
    .then((r) => assert.deepEqual(r, { status: STATUS.paid, tier: TIER.creator }));
});
