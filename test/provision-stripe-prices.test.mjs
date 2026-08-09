// sow-185: the Stripe price provisioning logic. Pure helpers + the idempotent provision flow are exercised
// against a FAKE Stripe client, so the whole thing is proven with no live key and no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { parseTierDisplay } from '../membership/tiers-display.mjs';
import { desiredPricesFromTiers, matchPrice, modeFromKey, sectionForMode, patchWranglerVars, provision } from '../scripts/provision-stripe-prices.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A decoupled fixture for the deterministic assertions (the real file is checked separately, lightly).
const TIERS = [
  { key: 'none', label: 'Free', priceMonthly: 0, priceAnnual: 0, priceEnv: {} },
  { key: 'member', label: 'Network Member', priceMonthly: 5, priceAnnual: 50, priceEnv: { monthly: 'STRIPE_PRICE_MEMBER_MONTHLY', annual: 'STRIPE_PRICE_MEMBER_ANNUAL' } },
  { key: 'creator', label: 'Content Creator', priceMonthly: 15, priceAnnual: 150, priceEnv: { monthly: 'STRIPE_PRICE_CREATOR_MONTHLY', annual: 'STRIPE_PRICE_CREATOR_ANNUAL' } },
];

/** A minimal in-memory Stripe fake: it records what it creates and answers list from its seeded state. */
function fakeStripe({ products = [], prices = [] } = {}) {
  const created = { products: [], prices: [] };
  let n = 0;
  return {
    _created: created,
    async *listProducts() { for (const p of products) yield p; },
    async createProduct({ name }) { const p = { id: `prod_${++n}`, name, active: true }; products.push(p); created.products.push(p); return p; },
    async *listPrices({ product }) { for (const p of prices) if (p.product === product) yield p; },
    async createPrice({ product, unitAmount, interval, nickname }) { const p = { id: `price_${++n}`, product, unit_amount: unitAmount, currency: 'usd', active: true, recurring: { interval }, nickname }; prices.push(p); created.prices.push(p); return p; },
  };
}

test('desiredPricesFromTiers derives the paid prices; the free tier is skipped', () => {
  const d = desiredPricesFromTiers(TIERS);
  const byEnv = Object.fromEntries(d.map((x) => [x.envName, x]));
  assert.deepEqual(Object.keys(byEnv).sort(), ['STRIPE_PRICE_CREATOR_ANNUAL', 'STRIPE_PRICE_CREATOR_MONTHLY', 'STRIPE_PRICE_MEMBER_ANNUAL', 'STRIPE_PRICE_MEMBER_MONTHLY']);
  assert.equal(byEnv.STRIPE_PRICE_MEMBER_MONTHLY.unitAmount, 500);
  assert.equal(byEnv.STRIPE_PRICE_MEMBER_MONTHLY.interval, 'month');
  assert.equal(byEnv.STRIPE_PRICE_MEMBER_ANNUAL.unitAmount, 5000);
  assert.equal(byEnv.STRIPE_PRICE_MEMBER_ANNUAL.interval, 'year');
  assert.equal(byEnv.STRIPE_PRICE_CREATOR_MONTHLY.unitAmount, 1500);
  assert.equal(byEnv.STRIPE_PRICE_CREATOR_ANNUAL.unitAmount, 15000);
  assert.equal(byEnv.STRIPE_PRICE_MEMBER_MONTHLY.productName, 'GBTI Network Member');
  assert.equal(byEnv.STRIPE_PRICE_CREATOR_MONTHLY.productName, 'GBTI Content Creator');
});

test('desiredPricesFromTiers on the REAL house/membership-tiers.yml yields exactly the four paid env vars', () => {
  const tiers = parseTierDisplay(yaml.load(fs.readFileSync(path.join(ROOT, 'house/membership-tiers.yml'), 'utf8')));
  const envs = desiredPricesFromTiers(tiers).map((x) => x.envName).sort();
  assert.deepEqual(envs, ['STRIPE_PRICE_CREATOR_ANNUAL', 'STRIPE_PRICE_CREATOR_MONTHLY', 'STRIPE_PRICE_MEMBER_ANNUAL', 'STRIPE_PRICE_MEMBER_MONTHLY']);
  // every amount is a positive whole number of cents (guards a malformed price in the source file)
  for (const p of desiredPricesFromTiers(tiers)) assert.ok(Number.isInteger(p.unitAmount) && p.unitAmount > 0, `${p.envName} amount invalid`);
});

test('matchPrice matches on amount+interval+currency and only an ACTIVE price, else null', () => {
  const prices = [
    { id: 'a', unit_amount: 500, currency: 'usd', active: true, recurring: { interval: 'month' } },
    { id: 'b', unit_amount: 5000, currency: 'usd', active: false, recurring: { interval: 'year' } },
  ];
  assert.equal(matchPrice(prices, { unitAmount: 500, interval: 'month' })?.id, 'a');
  assert.equal(matchPrice(prices, { unitAmount: 5000, interval: 'year' }), null); // inactive is not reusable
  assert.equal(matchPrice(prices, { unitAmount: 500, interval: 'year' }), null);  // wrong interval
  assert.equal(matchPrice(prices, { unitAmount: 999, interval: 'month' }), null); // wrong amount
});

test('modeFromKey reads test|live from the key prefix, null on anything else (fail closed)', () => {
  assert.equal(modeFromKey('sk_test_abc'), 'test');
  assert.equal(modeFromKey('rk_test_abc'), 'test');
  assert.equal(modeFromKey('rk_live_abc'), 'live');
  assert.equal(modeFromKey('sk_live_abc'), 'live');
  assert.equal(modeFromKey('garbage'), null);
  assert.equal(modeFromKey(''), null);
});

test('sectionForMode targets the right wrangler section (env vars nest under [env.<name>.vars])', () => {
  assert.equal(sectionForMode('test'), '[vars]');
  assert.equal(sectionForMode('live'), '[env.production.vars]'); // NOT [env.production]; that miss lost a live write once
});

test('provision dry-run plans everything and mutates nothing', async () => {
  const stripe = fakeStripe();
  const { mapping, actions } = await provision({ stripe, desired: desiredPricesFromTiers(TIERS), apply: false });
  assert.equal(Object.values(mapping).filter((v) => v === null).length, 4);
  assert.equal(stripe._created.products.length, 0);
  assert.equal(stripe._created.prices.length, 0);
  assert.ok(actions.some((a) => a.kind === 'would-create-product'));
  assert.ok(actions.some((a) => a.kind === 'would-create-price'));
});

test('provision apply on an empty account creates the products + prices and resolves the mapping', async () => {
  const stripe = fakeStripe();
  const { mapping } = await provision({ stripe, desired: desiredPricesFromTiers(TIERS), apply: true });
  assert.equal(Object.values(mapping).filter(Boolean).length, 4);
  assert.equal(stripe._created.products.length, 2); // GBTI Network Member + GBTI Content Creator
  assert.equal(stripe._created.prices.length, 4);
});

test('provision is idempotent: an existing matching price is REUSED, not recreated', async () => {
  const products = [{ id: 'prod_cc', name: 'GBTI Content Creator', active: true }];
  const prices = [{ id: 'price_existing150', product: 'prod_cc', unit_amount: 15000, currency: 'usd', active: true, recurring: { interval: 'year' } }];
  const stripe = fakeStripe({ products, prices });
  const { mapping } = await provision({ stripe, desired: desiredPricesFromTiers(TIERS), apply: true });
  assert.equal(mapping.STRIPE_PRICE_CREATOR_ANNUAL, 'price_existing150'); // reused, no duplicate $150
  assert.equal(stripe._created.prices.length, 3);   // only the 3 genuinely-new prices
  assert.equal(stripe._created.products.length, 1); // Network Member created; Content Creator reused
});

test('patchWranglerVars inserts + replaces within one section and leaves other sections intact', () => {
  const toml = ['[vars]', 'STRIPE_PRICE_ID = "price_sandbox"', '', '[env.production.vars]', 'STRIPE_PRICE_ID = "price_live"', ''].join('\n');
  const out = patchWranglerVars(toml, '[vars]', { STRIPE_PRICE_MEMBER_MONTHLY: 'price_mm', STRIPE_PRICE_ID: 'price_sandbox2' });
  assert.match(out, /\[vars\][\s\S]*STRIPE_PRICE_ID = "price_sandbox2"/);          // existing replaced in [vars]
  assert.match(out, /\[vars\][\s\S]*STRIPE_PRICE_MEMBER_MONTHLY = "price_mm"/);     // new inserted in [vars]
  const prod = out.slice(out.indexOf('[env.production.vars]'));
  assert.match(prod, /STRIPE_PRICE_ID = "price_live"/);                            // the other section untouched
  assert.ok(!prod.includes('STRIPE_PRICE_MEMBER_MONTHLY'), 'the new var must not bleed into [env.production.vars]');
  assert.throws(() => patchWranglerVars(toml, '[missing]', { X: 'y' }), /section \[missing\] not found/);
});
