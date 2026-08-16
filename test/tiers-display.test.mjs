// sow-185: the pure tier DISPLAY parser/validator (membership/tiers-display.mjs) + a check that the committed
// house/membership-tiers.yml is well-formed. No network, no secrets. The pure parser is the ONE shape definition
// shared by the Astro build (src/lib/tiers.ts) and CI (scripts/validate-content.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { parseTierDisplay, validateTierDisplay, TierDisplayError, TIER_ORDER } from '../membership/tiers-display.mjs';
import { TIER } from '../membership/tiers.mjs';

// A minimal valid file used across the shape tests.
const OK = {
  tiers: [
    { key: 'none', label: 'Free', priceMonthly: 0, priceAnnual: 0, benefits: ['Browse'] },
    { key: 'member', label: 'Network Member', priceMonthly: 5, priceAnnual: 50, priceEnv: { monthly: 'M_M', annual: 'M_A' }, benefits: ['Comments'], revenue: 'invite 10%' },
    { key: 'creator', label: 'Content Creator', priceMonthly: 15, priceAnnual: 150, priceEnv: { monthly: 'C_M', annual: 'C_A' }, benefits: ['Publish'], revenue: 'pool' },
  ],
};

test('parseTierDisplay: a valid file yields the three tiers in canonical order', () => {
  const tiers = parseTierDisplay(OK);
  assert.deepEqual(tiers.map((t) => t.key), TIER_ORDER); // none, member, creator
  assert.deepEqual([TIER.none, TIER.member, TIER.creator], TIER_ORDER);
  const member = tiers.find((t) => t.key === 'member');
  assert.equal(member.label, 'Network Member');
  assert.equal(member.priceMonthly, 5);
  assert.equal(member.priceAnnual, 50);
  assert.deepEqual({ ...member.priceEnv }, { monthly: 'M_M', annual: 'M_A' });
  // sow-230: a benefit normalizes to { label, description }. A bare string in the yml is still valid and
  // yields an empty description, which is what keeps every existing entry and every other surface working.
  assert.deepEqual([...member.benefits], [{ label: 'Comments', description: '' }]);
});

test('parseTierDisplay: a benefit may be {label, description}, and a bare string still works', () => {
  // sow-230. The description exists so the invite lander can show a supporting line WITHOUT writing benefit
  // prose into the page, which is how a member-tier invite came to advertise Creator benefits. Both forms
  // normalize to one shape so no consumer has to branch.
  const mixed = { tiers: [
    OK.tiers[0],
    { ...OK.tiers[1], benefits: [{ label: 'Comments', description: 'Reply anywhere.' }, 'Discord'] },
    OK.tiers[2],
  ] };
  const member = parseTierDisplay(mixed).find((t) => t.key === 'member');
  assert.deepEqual([...member.benefits], [
    { label: 'Comments', description: 'Reply anywhere.' },
    { label: 'Discord', description: '' },
  ]);
});

test('parseTierDisplay: a benefit object with no label is DROPPED, not rendered blank', () => {
  // An entry that names nothing would render an empty card on the lander. Dropping it matches how the bare
  // string form has always treated '' and keeps the non-empty check meaningful.
  const bad = { tiers: [OK.tiers[0], { ...OK.tiers[1], benefits: [{ description: 'orphan' }, 'Discord'] }, OK.tiers[2]] };
  const member = parseTierDisplay(bad).find((t) => t.key === 'member');
  assert.deepEqual([...member.benefits], [{ label: 'Discord', description: '' }]);
});

test('parseTierDisplay: canonical order regardless of file order', () => {
  const shuffled = { tiers: [OK.tiers[2], OK.tiers[0], OK.tiers[1]] };
  assert.deepEqual(parseTierDisplay(shuffled).map((t) => t.key), ['none', 'member', 'creator']);
});

test('parseTierDisplay: the result is deeply frozen', () => {
  const tiers = parseTierDisplay(OK);
  assert.ok(Object.isFrozen(tiers));
  assert.ok(Object.isFrozen(tiers[0]));
  assert.ok(Object.isFrozen(tiers[0].benefits));
});

test('parseTierDisplay: rejects a missing tiers list', () => {
  assert.throws(() => parseTierDisplay({}), TierDisplayError);
  assert.throws(() => parseTierDisplay({ tiers: 'x' }), TierDisplayError);
});

test('parseTierDisplay: rejects a missing axis tier', () => {
  assert.throws(() => parseTierDisplay({ tiers: [OK.tiers[0], OK.tiers[1]] }), /missing the "creator" tier/);
});

test('parseTierDisplay: rejects a duplicate or unknown tier key', () => {
  assert.throws(() => parseTierDisplay({ tiers: [...OK.tiers, OK.tiers[1]] }), /duplicate tier key "member"/);
  assert.throws(() => parseTierDisplay({ tiers: [{ key: 'bogus', label: 'X', priceMonthly: 0, priceAnnual: 0, benefits: ['b'] }, ...OK.tiers] }), /not a valid tier/);
});

test('parseTierDisplay: rejects an empty benefits list, missing label, or bad price', () => {
  const bad = (patch) => ({ tiers: OK.tiers.map((t) => (t.key === 'member' ? { ...t, ...patch } : t)) });
  assert.throws(() => parseTierDisplay(bad({ benefits: [] })), /benefits\[\] must be a non-empty list/);
  assert.throws(() => parseTierDisplay(bad({ label: '' })), /label is required/);
  assert.throws(() => parseTierDisplay(bad({ priceMonthly: -1 })), /priceMonthly must be a number/);
  assert.throws(() => parseTierDisplay(bad({ priceAnnual: 'x' })), /priceAnnual must be a number/);
});

test('parseTierDisplay: a purchasable tier MUST name its price env var (checkout allowlist needs the id)', () => {
  const bad = { tiers: OK.tiers.map((t) => (t.key === 'member' ? { ...t, priceEnv: { annual: 'M_A' } } : t)) };
  assert.throws(() => parseTierDisplay(bad), /priceMonthly is set but priceEnv.monthly is missing/);
});

test('parseTierDisplay: a free tier needs no price env var', () => {
  assert.doesNotThrow(() => parseTierDisplay(OK)); // none has priceEnv: {} and prices 0
});

test('validateTierDisplay: returns {ok} without throwing', () => {
  assert.deepEqual(validateTierDisplay(OK), { ok: true, error: null });
  const r = validateTierDisplay({});
  assert.equal(r.ok, false);
  assert.match(r.error, /tiers/);
});

test('the committed house/membership-tiers.yml is well-formed and carries all three tiers with prices', () => {
  const raw = yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8'));
  const tiers = parseTierDisplay(raw);
  assert.deepEqual(tiers.map((t) => t.key), ['none', 'member', 'creator']);
  const [free, member, creator] = tiers;
  assert.equal(free.priceMonthly, 0);
  assert.equal(member.priceMonthly, 5);
  assert.equal(member.priceAnnual, 50);
  // sow-185 L59: Content Creator is $15/mo AND $150/yr (both), not annual-only.
  assert.equal(creator.priceMonthly, 15);
  assert.equal(creator.priceAnnual, 150);
  // Every paid tier names its price env vars so the phase-3b checkout allowlist has ids to bind.
  for (const t of [member, creator]) {
    assert.ok(t.priceEnv.monthly && t.priceEnv.annual, `${t.key} must name monthly + annual price env vars`);
  }
});
