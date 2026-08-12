// SOW-119: the KV -> grandfathered.yml fold-in (scripts/lib/coupon-grants.mjs), the coupon-expiry
// reminder plan, and the memberEntryFor coupon extraction. No network: injected fetch + github fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import {
  planCouponGrants,
  appendGrantEntries,
  removeGrantEntry,
  listCouponRedemptions,
  syncCouponGrants,
} from '../scripts/lib/coupon-grants.mjs';
import { planReconcile, COUPON_REMINDER_DAYS } from '../scripts/lib/reconcile-plan.mjs';
import { couponGrantFor } from '../scripts/reconcile.mjs';
import { grandfathersFromParsed } from '../membership/overrides-core.mjs';

const NOW = new Date('2026-07-15T12:00:00.000Z');

const FILE = `# header comment survives
grandfathered:
  - github_id: "111"   # github.com/existing
    login: existing
    reason: complimentary access (grandfathered co-op member)
    until: null
# - github_id: "..."
#   login: founder
#   reason: founding member
#   until: null   # null = permanent; otherwise an ISO date
`;

// SOW-142 (owner-elected 2026-07-22): redeeming the invite CONVERTS a permanent comp member to the
// standard free-year deal, so a permanent (non-coupon, until null) entry is REPLACED, a coupon: entry is
// skipped (idempotent), and a BOUNDED non-coupon entry is skipped + surfaced (never silently rewritten).
test('planCouponGrants: the four-way policy (add / replace permanent comp / skip coupon / skip bounded)', () => {
  const file = FILE + `  - github_id: "666"\n    login: folded\n    reason: coupon:CODEABLEYEAR\n    until: "2027-01-01T00:00:00.000Z"\n  - github_id: "777"\n    login: handset\n    reason: temporary comp (owner set)\n    until: "2026-12-01T00:00:00.000Z"\n`;
  const parsed = yaml.load(file);
  const { grants, skippedBounded } = planCouponGrants({
    redemptions: [
      { githubId: '111', code: 'CODEABLEYEAR', login: 'existing', until: '2027-01-01T00:00:00.000Z' }, // permanent comp -> REPLACE
      { githubId: '222', code: 'CODEABLEYEAR', login: 'Newbie', until: '2027-07-15T12:00:00.000Z' }, // no entry -> ADD
      { githubId: '222', code: 'CODEABLEYEAR', until: '2028-01-01T00:00:00.000Z' }, // dup id
      { githubId: '333', code: 'CODEABLEYEAR', until: '2026-01-01T00:00:00.000Z' }, // already over
      { githubId: '444', code: 'CODEABLEYEAR', until: 'garbage' }, // malformed
      { githubId: '', code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' }, // no id
      { githubId: '666', code: 'CODEABLEYEAR', until: '2028-01-01T00:00:00.000Z' }, // already folded -> skip
      { githubId: '777', code: 'CODEABLEYEAR', until: '2028-01-01T00:00:00.000Z' }, // bounded non-coupon -> skip + surface
    ],
    grandfatheredParsed: parsed,
    now: NOW,
  });
  assert.equal(grants.length, 2);
  assert.deepEqual(grants[0], { githubId: '111', login: 'existing', code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z', replaces: true });
  assert.deepEqual(grants[1], { githubId: '222', login: 'newbie', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' });
  assert.equal(skippedBounded.length, 1);
  assert.equal(skippedBounded[0].githubId, '777');
  assert.match(skippedBounded[0].reason, /temporary comp/);
});

// sow-185: converting a permanent comp changes the time BOUND only; a hand-set tier is orthogonal and must
// survive the conversion, else the standard fold machinery would silently revert it to the creator default.
test('planCouponGrants + appendGrantEntries carry a hand-set tier through a permanent-comp conversion', () => {
  const file = FILE + `  - github_id: "888"   # github.com/tieredcomp\n    login: tieredcomp\n    reason: complimentary access (member level)\n    until: null\n    tier: member\n`;
  const { grants } = planCouponGrants({
    redemptions: [{ githubId: '888', code: 'CODEABLEYEAR', login: 'tieredcomp', until: '2027-07-15T12:00:00.000Z' }],
    grandfatheredParsed: yaml.load(file),
    now: NOW,
  });
  assert.equal(grants.length, 1);
  assert.equal(grants[0].replaces, true);
  assert.equal(grants[0].tier, 'member'); // the hand-set tier is carried onto the grant

  const next = appendGrantEntries(file, grants, NOW);
  const map = grandfathersFromParsed(yaml.load(next));
  assert.equal(map.get('888').reason, 'coupon:CODEABLEYEAR');
  assert.equal(map.get('888').until, '2027-07-15T12:00:00.000Z');
  assert.equal(map.get('888').tier, 'member'); // renderGrantBlock emitted the tier line, so it survives the fold
});

test('planCouponGrants invents no tier when nothing names one (fold defaults to creator downstream)', () => {
  // github_id 111 in FILE is a permanent comp with NO tier, the redemption carries none, and NO coupon
  // registry is supplied -> the converted grant carries no tier field, exactly as it folded pre-sow-185.
  const { grants } = planCouponGrants({
    redemptions: [{ githubId: '111', code: 'CODEABLEYEAR', login: 'existing', until: '2027-01-01T00:00:00.000Z' }],
    grandfatheredParsed: yaml.load(FILE),
    now: NOW,
  });
  assert.equal(grants.length, 1);
  assert.equal('tier' in grants[0], false); // no tier -> tier-gate.grantTier applies the creator default
});

// sow-185, the owner's "TIER IS EXPLICIT, NOT INHERITED" ruling. The fold NAMES the tier instead of leaving
// grantTier to re-derive it on every read. Four sources, strict precedence, and nothing is ever invented.
test('planCouponGrants tier precedence: hand-set entry > redemption record > coupon registry > nothing', () => {
  const REGISTRY = { coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator' }, { code: 'MEMBERPROMO', freeDays: 30, active: true, tier: 'member' }] };
  const file = FILE + `  - github_id: "888"   # github.com/tieredcomp\n    login: tieredcomp\n    reason: complimentary access (member level)\n    until: null\n    tier: member\n`;
  const plan = (redemptions, couponsParsed = REGISTRY) =>
    planCouponGrants({ redemptions, grandfatheredParsed: yaml.load(file), couponsParsed, now: NOW });

  // 1. The existing entry's HAND-SET tier outranks everything: an owner decision beats a campaign default,
  //    and the conversion changes only the time bound.
  const handSet = plan([{ githubId: '888', code: 'CODEABLEYEAR', login: 'tieredcomp', tier: 'creator', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal(handSet.grants[0].tier, 'member', 'the hand-set member tier survives a creator coupon AND a creator record');

  // 2. The REDEMPTION RECORD beats the registry: it is what the coupon promised when it was redeemed, so
  //    retuning a live campaign afterwards cannot fold a member under terms they never accepted.
  const stamped = plan([{ githubId: '222', code: 'CODEABLEYEAR', login: 'newbie', tier: 'member', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal(stamped.grants[0].tier, 'member', 'the stamped record wins over the registry saying creator');

  // 3. The REGISTRY fills in for a record written before the Worker stamped the tier (metacast's case).
  const fromRegistry = plan([{ githubId: '222', code: 'CODEABLEYEAR', login: 'newbie', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal(fromRegistry.grants[0].tier, 'creator', 'an unstamped record resolves through house/coupons.yml');
  const otherCode = plan([{ githubId: '333', code: 'MEMBERPROMO', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal(otherCode.grants[0].tier, 'member', 'and it resolves PER CODE, not one tier for all coupons');

  // 4. Nothing names one -> no tier field. Never invented, and identical to the pre-sow-185 fold.
  const unknownCode = plan([{ githubId: '444', code: 'NOSUCHCODE', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal('tier' in unknownCode.grants[0], false, 'a code absent from the registry yields no tier');
  const noRegistry = plan([{ githubId: '444', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' }], null);
  assert.equal('tier' in noRegistry.grants[0], false, 'an unreadable registry costs explicitness, not correctness');

  // A junk tier anywhere in the chain is skipped rather than written: fail toward the old behaviour.
  const junk = plan([{ githubId: '444', code: 'NOSUCHCODE', tier: 'creater', until: '2027-07-15T12:00:00.000Z' }]);
  assert.equal('tier' in junk.grants[0], false, 'an unrecognized stamped tier is not written through');

  // And the named tier reaches the FILE, not just the plan.
  const next = appendGrantEntries(file, fromRegistry.grants, NOW);
  assert.equal(grandfathersFromParsed(yaml.load(next)).get('222').tier, 'creator');
});

test('appendGrantEntries keeps comments, parses back, and round-trips through overrides-core', () => {
  const additions = [
    { githubId: '222', login: 'newbie', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' },
    { githubId: '555', login: null, code: 'CAPPED', until: '2026-08-15T12:00:00.000Z' },
  ];
  const next = appendGrantEntries(FILE, additions, NOW);
  assert.ok(next.includes('# header comment survives'));
  assert.ok(next.includes('#   reason: founding member')); // the trailing template comments survive
  const map = grandfathersFromParsed(yaml.load(next));
  assert.equal(map.get('222').reason, 'coupon:CODEABLEYEAR');
  assert.equal(map.get('222').until, '2027-07-15T12:00:00.000Z');
  assert.equal(map.get('555').reason, 'coupon:CAPPED');
  assert.equal(map.get('111').until, null); // a non-replacing fold leaves the permanent grant untouched
});

// SOW-142: a replacement removes the permanent block (its inline comment included), appends the coupon
// entry, and the verification proves no duplicate github_id survives. Comments OUTSIDE the block stay.
test('appendGrantEntries replaces a permanent comp entry without duplicating the id', () => {
  const grants = [
    { githubId: '111', login: 'existing', code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z', replaces: true },
  ];
  const next = appendGrantEntries(FILE, grants, NOW);
  assert.ok(next.includes('# header comment survives'));
  assert.ok(next.includes('#   reason: founding member'));
  assert.ok(!next.includes('complimentary access (grandfathered co-op member)'), 'the permanent entry is gone');
  assert.ok(next.includes('converted from permanent comp'), 'the conversion is noted inline');
  const parsed = yaml.load(next);
  const ids = parsed.grandfathered.map((e) => String(e.github_id));
  assert.equal(ids.filter((id) => id === '111').length, 1, 'exactly one entry for the id');
  const map = grandfathersFromParsed(parsed);
  assert.equal(map.get('111').reason, 'coupon:CODEABLEYEAR');
  assert.equal(map.get('111').until, '2027-01-01T00:00:00.000Z');
});

test('removeGrantEntry throws when the block is missing (a replacement must never silently no-op)', () => {
  assert.throws(() => removeGrantEntry(FILE, '999'), /cannot find the entry block/);
});

test('listCouponRedemptions is a reported no-op without CF creds and parses keys with them', async () => {
  const none = await listCouponRedemptions({ env: {} });
  assert.equal(none.available, false);

  const env = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
  const fetchImpl = async (url) => {
    if (String(url).includes('/keys?')) {
      return { ok: true, json: async () => ({ result: [{ name: 'redemption:CODEABLEYEAR:222' }, { name: 'weird:key' }], result_info: {} }) };
    }
    return { ok: true, json: async () => ({ code: 'CODEABLEYEAR', login: 'newbie', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }) };
  };
  const r = await listCouponRedemptions({ env, fetchImpl });
  assert.equal(r.available, true);
  assert.equal(r.redemptions.length, 1);
  assert.equal(r.redemptions[0].githubId, '222');
  assert.equal(r.redemptions[0].code, 'CODEABLEYEAR');
});

test('syncCouponGrants opens ONE auto-merged PR with the appended file', async () => {
  const puts = [];
  const github = {
    async getRef() { return { object: { sha: 'basesha' } }; },
    async createRef() {},
    async getContent() { return { sha: 'filesha' }; },
    async putContent(p, body) { puts.push({ p, text: Buffer.from(body.content, 'base64').toString('utf8') }); },
    async createPull() { return { number: 77 }; },
    merged: null,
    async mergePull(n, opts) { this.merged = { n, opts }; },
  };
  const r = await syncCouponGrants({
    env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    github,
    now: NOW,
    listRedemptions: async () => ({ available: true, redemptions: [{ githubId: '222', code: 'CODEABLEYEAR', login: 'newbie', until: '2027-07-15T12:00:00.000Z' }] }),
    readGrandfathered: () => ({ text: FILE, parsed: yaml.load(FILE) }),
  });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 77);
  assert.equal(github.merged.n, 77);
  assert.ok(puts[0].text.includes('coupon:CODEABLEYEAR'));
});

test('syncCouponGrants no-ops when every redemption is already granted', async () => {
  const withGrant = FILE.replace('until: null', 'until: null') + `  - github_id: "222"\n    reason: coupon:CODEABLEYEAR\n    until: "2027-07-15T12:00:00.000Z"\n`;
  const r = await syncCouponGrants({
    env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    github: {},
    now: NOW,
    listRedemptions: async () => ({ available: true, redemptions: [{ githubId: '222', code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' }] }),
    readGrandfathered: () => ({ text: withGrant, parsed: yaml.load(withGrant) }),
  });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'all redemptions already granted');
});

test('couponGrantFor extracts only coupon-reason grants with an until', () => {
  const overrides = {
    grandfathers: grandfathersFromParsed({
      grandfathered: [
        { github_id: '222', reason: 'coupon:CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' },
        { github_id: '111', reason: 'complimentary access', until: null },
      ],
    }),
  };
  assert.deepEqual(couponGrantFor('222', overrides), { code: 'CODEABLEYEAR', until: '2027-07-15T12:00:00.000Z' });
  assert.equal(couponGrantFor('111', overrides), null);
  assert.equal(couponGrantFor('999', overrides), null);
});

test('the planner emits a coupon-expiry reminder only inside the final window', () => {
  const base = {
    githubId: '222',
    email: 'n@example.com',
    discordUserId: null,
    username: null,
    derived: 'none',
    effective: { status: 'paid', source: 'grandfather' },
    converted: false,
  };
  const mk = (until, now) => planReconcile({
    members: [{ ...base, couponGrant: { code: 'CODEABLEYEAR', until } }],
    repoIndex: {},
    now,
  }).filter((a) => a.kind === 'reminder' && a.type === 'coupon-expiry');

  const until = '2026-07-25T12:00:00.000Z'; // 10 days out from NOW: inside the 14-day window
  assert.equal(mk(until, NOW).length, 1);
  assert.equal(mk(until, NOW)[0].until, until);
  const farOut = '2026-12-01T00:00:00.000Z'; // far outside the window
  assert.equal(mk(farOut, NOW).length, 0);
  const past = '2026-07-01T00:00:00.000Z'; // already over
  assert.equal(mk(past, NOW).length, 0);
  // converted members are not nagged
  const converted = planReconcile({
    members: [{ ...base, converted: true, couponGrant: { code: 'C', until } }],
    repoIndex: {},
    now: NOW,
  }).filter((a) => a.type === 'coupon-expiry');
  assert.equal(converted.length, 0);
  assert.ok(COUPON_REMINDER_DAYS === 14);
});
