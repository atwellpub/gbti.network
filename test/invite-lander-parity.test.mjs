// sow-185 (2026-08-24): AN INVITE LANDER MAY NOT ADVERTISE A TIER ITS COUPON DOES NOT GRANT.
//
// WHY THIS ASSERTS AGAINST THE REGISTRIES AND NOT AGAINST STRINGS. The defect that prompted this shipped
// past a string check. `/codeable-invite/` sold the whole Content Creator pitch in prose: publish under your
// own name, no CMS to run, work rendering on a member profile, weekly shop talk, network syndication. None
// of those sentences contain "Content Creator", "top tier" or "$150", so a grep for those came back CLEAN
// over a page that was misdescribing what it sold. A guard that checks for forbidden words passes while the
// page is wrong, which is worse than no guard, because a green run is then read as evidence.
//
// So this reads `house/coupons.yml` and `house/membership-tiers.yml` and asserts STRUCTURE:
//   1. every active coupon names a tier that actually exists in the tier registry;
//   2. every lander binds its tier label and price to the registry rather than writing them out;
//   3. a lander that ships a default coupon code advertises exactly the tier that code grants;
//   4. a lander that ships a default coupon code renders its benefit list FROM the registry.
//
// Rule 4 is the one that closes the CLASS rather than the instance (@SowMaster's framing). A hand-written
// benefit list cannot be checked for accuracy by any test, because the test would have to know what is true.
// A list rendered from `house/membership-tiers.yml` cannot state a benefit that is not in the file, so the
// property is structural and holds for benefits nobody has thought of yet.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const loadYaml = (rel) => yaml.load(read(rel));

const LANDER_DIR = path.join(ROOT, 'src/pages');

/**
 * Every invite lander on disk, DISCOVERED rather than listed.
 *
 * A hardcoded list is the wrong instrument here: the next lander is added by somebody who is not reading
 * this file, and a guard that does not see it reports green over the page it was written to protect. The
 * discovery itself is asserted below, so this cannot silently start matching nothing.
 */
function landers() {
  return fs.readdirSync(LANDER_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.endsWith('-invite'))
    .flatMap((dir) => fs.readdirSync(path.join(LANDER_DIR, dir.name))
      .filter((f) => f.endsWith('.astro'))
      .map((f) => ({ id: `${dir.name}/${f}`, dir: dir.name, src: read(path.join('src/pages', dir.name, f)) })));
}

/**
 * The tier a lander binds itself to, from its tierDisplay() calls.
 *
 * A page may legitimately call tierDisplay more than once (the label in the hero and the price in the claim
 * card, say). What matters is that every call names the SAME tier: a page resolving two different tiers is
 * describing two different products, which is the drift this whole file exists to catch. So the rule is
 * agreement, not call count. An earlier version of this asserted a single call and failed on a correct page,
 * which is its own kind of bad guard: one that cries about the shape of the code rather than the truth of
 * the claim teaches people to loosen it.
 */
function boundTier(src) {
  const calls = [...src.matchAll(/tierDisplay\(\s*'([a-z]+)'\s*\)/g)].map((m) => m[1]);
  const unique = [...new Set(calls)];
  return { calls, unique, tier: unique.length === 1 ? unique[0] : null };
}

/**
 * The coupon code a lander ships as its default, or null when the code field is hand-entered.
 *
 * `coupon=CODE` is excluded deliberately: it is the placeholder in the page's own explanatory comment, not a
 * real code. Matching it would bind every lander to a coupon named CODE, which does not exist, and rules 3
 * and 4 would then be enforced against a lookup that always misses. That is the failure this repo keeps
 * hitting: a check that runs, finds nothing, and reports success.
 */
function defaultCouponCode(src) {
  const codes = new Set([...src.matchAll(/coupon=([A-Z0-9]{3,32})/g)].map((m) => m[1]).filter((c) => c !== 'CODE'));
  return codes.size === 1 ? [...codes][0] : null;
}

// The archive is exempt from the BENEFIT rule and from nothing else. Its own header states the arrangement:
// the offer surfaces (tier label, price, hero, claim card, meta description, closing FAQ) were corrected on
// 2026-08-24, while the archived sections below them still describe Content Creator on purpose, because
// preserving the design work is the only reason the file is kept. Gutting it would destroy what it is for.
// Named individually rather than by a pattern, so a second archive does not inherit the exemption silently.
const BENEFIT_RULE_EXEMPT = new Set(['codeable-invite/v1.astro']);

test('the lander discovery finds the real pages, so the rules below are not vacuous', () => {
  // ASSERTED BEFORE ANY CLAIM THAT DEPENDS ON IT. Every rule in this file iterates this list, so a discovery
  // that matched nothing would make all of them pass over an empty set and report a clean guard.
  const found = landers();
  assert.ok(found.length >= 3, `expected at least three invite landers, found ${found.length}`);
  const ids = found.map((l) => l.id);
  for (const required of ['codeable-invite/index.astro', 'member-invite/index.astro', 'curator-invite/index.astro']) {
    assert.ok(ids.includes(required), `${required} must be discovered; found ${ids.join(', ')}`);
  }
});

test('every ACTIVE coupon names a tier that exists in the tier registry', () => {
  const coupons = loadYaml('house/coupons.yml')?.coupons ?? [];
  const tierKeys = new Set((loadYaml('house/membership-tiers.yml')?.tiers ?? []).map((t) => t.key));
  assert.ok(tierKeys.size >= 2, 'the tier registry must have loaded');

  const active = coupons.filter((c) => c.active);
  assert.ok(active.length > 0, 'there must be at least one active coupon, or this test proves nothing');
  for (const c of active) {
    assert.ok(c.tier, `active coupon ${c.code} must name a tier`);
    assert.ok(tierKeys.has(c.tier), `coupon ${c.code} grants tier "${c.tier}", which is not in membership-tiers.yml`);
  }
});

test('every lander binds its tier to the registry rather than writing the label and price by hand', () => {
  // The structural half of the defect. A page that hardcodes "Content Creator" or "$150" states a fact the
  // source of truth does not carry, and it keeps stating it after the registry changes. Binding means the
  // page follows the registry by construction: when sow-226 renames Creator to Curator, these pages change
  // by themselves and nobody has to remember them.
  for (const l of landers()) {
    assert.match(l.src, /from '\.\.\/\.\.\/lib\/tiers'/, `${l.id} must import the tier registry`);
    const { calls, unique, tier } = boundTier(l.src);
    assert.ok(calls.length >= 1, `${l.id} must call tierDisplay at least once`);
    assert.equal(unique.length, 1,
      `${l.id} resolves ${unique.length} different tiers (${unique.join(', ')}). One page may describe only `
      + 'one product.');
    assert.ok(tier, `${l.id} must resolve a bound tier`);
  }
});

test('a lander shipping a default coupon code advertises EXACTLY the tier that code grants', () => {
  // The parity assertion proper, and the one that would have caught the original defect. It compares two
  // registries against the page rather than reading the page's prose, so it is indifferent to how the claim
  // is worded, which is exactly why the prose version got through.
  const byCode = new Map((loadYaml('house/coupons.yml')?.coupons ?? []).map((c) => [c.code, c]));
  let checked = 0;
  for (const l of landers()) {
    const code = defaultCouponCode(l.src);
    if (!code) continue;
    const coupon = byCode.get(code);
    assert.ok(coupon, `${l.id} ships coupon ${code}, which is not in house/coupons.yml`);
    const { tier } = boundTier(l.src);
    assert.equal(tier, coupon.tier,
      `${l.id} advertises tier "${tier}" but coupon ${code} grants "${coupon.tier}". `
      + 'A visitor redeeming that link would receive less than the page promised.');
    checked += 1;
  }
  // Never let this pass on zero. If the code extraction stops matching, every comparison above is skipped
  // and the test reports success having compared nothing.
  assert.ok(checked >= 2, `expected at least two coupon-bound landers, checked ${checked}`);
});

test('a coupon-bound lander renders its benefits FROM the registry, never by hand', () => {
  // THE RULE THAT CLOSES THE CLASS. The original defect was five true-sounding sentences that named no tier
  // and no price, so no string check could see them. This asserts the page has no opportunity to write such
  // a sentence: the benefit list comes out of house/membership-tiers.yml, which cannot contain a benefit
  // that does not exist, because its own header makes that a reviewed legal line.
  let checked = 0;
  for (const l of landers()) {
    if (BENEFIT_RULE_EXEMPT.has(l.id)) continue;
    if (!defaultCouponCode(l.src)) continue;
    assert.match(l.src, /\.benefits/,
      `${l.id} must render its benefit list from house/membership-tiers.yml. A hand-written list cannot be `
      + 'checked for accuracy by any test, because the test would have to already know what is true.');
    checked += 1;
  }
  assert.ok(checked >= 2, `expected at least two coupon-bound landers to check, checked ${checked}`);
});
