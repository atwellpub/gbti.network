// sow-185: the pure tier DISPLAY parser/validator (membership/tiers-display.mjs) + a check that the committed
// house/membership-tiers.yml is well-formed. No network, no secrets. The pure parser is the ONE shape definition
// shared by the Astro build (src/lib/tiers.ts) and CI (scripts/validate-content.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { parseTierDisplay, validateTierDisplay, TierDisplayError, TIER_ORDER, benefitProse } from '../membership/tiers-display.mjs';
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

// ---------------------------------------------------------------------------------------------------------
// sow-201 (2026-08-26): benefitProse + the membership FAQ binding.
//
// THE DEFECT THESE EXIST FOR. The owner ruled on 2026-08-18 that "Curate your feed" comes out of the Network
// Member benefits, because feed curation is a FREE-tier capability and gating it to justify a sales line was
// the repair they declined. The bullet stayed. So did a second copy of the same claim that the audit never
// named: src/pages/membership.astro hand-wrote the difference between the tiers in prose, on a page whose
// other two answers tell the reader the personalized feed is free. The page contradicted itself and its own
// header comment, which already claimed every benefit bullet comes from house/membership-tiers.yml.
//
// The registry assertions below were run against the UNCHANGED yml first and failed there on the live string.

test('benefitProse: labels join with semicolons and the last takes "and"', () => {
  const tier = { benefits: [{ label: 'Publish articles, products, and prompts' }, { label: 'Reshare your work' }, { label: 'Your creator profile' }] };
  // Semicolons, not commas: the first label carries its own commas, so a comma-joined list reads as one run.
  assert.equal(benefitProse(tier), 'publish articles, products, and prompts; reshare your work; and your creator profile');
});

test('benefitProse: the leading character lowers, except on a proper noun or an acronym', () => {
  assert.equal(benefitProse({ benefits: [{ label: 'Full Discord access' }] }), 'full Discord access');
  // A label that OPENS with a brand or an acronym is left alone; "discord access" and "aI review" are wrong
  // in a way a reader notices, and a future bullet may well start with one.
  assert.equal(benefitProse({ benefits: [{ label: 'Discord access, in full' }] }), 'Discord access, in full');
  assert.equal(benefitProse({ benefits: [{ label: 'AI editorial review' }] }), 'AI editorial review');
});

test('benefitProse: degenerate inputs yield a usable string, never a stray separator', () => {
  assert.equal(benefitProse({ benefits: [{ label: 'Only one' }] }), 'only one');
  assert.equal(benefitProse({ benefits: [] }), '');
  assert.equal(benefitProse(undefined), '');
  // A blank label is dropped rather than producing "; and".
  assert.equal(benefitProse({ benefits: [{ label: 'Kept' }, { label: '   ' }] }), 'kept');
});

test('the committed registry no longer sells feed curation or shop talk as tier benefits', () => {
  const tiers = parseTierDisplay(yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8')));
  const labels = (key) => tiers.find((t) => t.key === key).benefits.map((b) => `${b.label} ${b.description}`.toLowerCase());
  // Curation is a FREE capability (the free tier advertises the personalized feed), so selling it at $5 is
  // the breach of this registry's own header rule, not a wording preference.
  assert.ok(!labels('member').some((l) => l.includes('curate your feed')), 'Network Member still sells "Curate your feed"');
  // Shop talk is positioning, not software. The offerings register requires a named owner and a cadence
  // before it appears in PRICING copy; it lives in general community copy (src/components/JoinOffers.astro).
  assert.ok(!labels('creator').some((l) => l.includes('shop talk')), 'Content Creator still sells shop talk');
});

test('the membership FAQ composes the tier difference from the registry instead of typing it', () => {
  const page = fs.readFileSync(new URL('../src/pages/membership.astro', import.meta.url), 'utf8');
  // Half of this is structural and half would be worthless alone. A "does the page contain a forbidden
  // string" check passes while a page is wrong, which is the failure test/invite-lander-parity.test.mjs
  // documents at length. Paired with the import assertion it holds: the page cannot state a benefit that is
  // absent from the registry, because it does not state benefits at all.
  assert.match(page, /benefitProse/, 'membership.astro must compose the FAQ answer from the registry');
  const tiers = parseTierDisplay(yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8')));
  for (const key of ['member', 'creator']) {
    for (const b of tiers.find((t) => t.key === key).benefits) {
      assert.ok(!page.includes(b.label), `membership.astro hand-writes the benefit "${b.label}"`);
    }
  }
});
