// SOW-038 P2: the pure roster builder behind the superadmin dashboard. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../membership/superadmin-roster.mjs';

const parsed = {
  roles: { superadmins: [{ github_id: '1', login: 'sa' }], admins: [{ github_id: '2', login: 'ad' }], moderators: [] },
  bans: { bans: [{ github_id: '9', login: 'baddie' }] },
  grandfathered: { grandfathered: [{ github_id: '3', login: 'founder', until: null }, { github_id: '4', login: 'expired', until: '2000-01-01' }] },
  membersIndex: { members: { 1: 'sa', 2: 'ad', 3: 'founder', 4: 'expired', 5: 'plain', 9: 'baddie' } },
};

test('buildRoster enumerates the union of index + overrides with override-derived status', () => {
  const { roster, summary } = buildRoster(parsed, new Date('2026-06-17'));
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));

  assert.equal(by['1'].role, 'superadmin');
  assert.equal(by['1'].status, 'paid');
  assert.equal(by['1'].source, 'staff');

  assert.equal(by['2'].role, 'admin');
  assert.equal(by['2'].source, 'staff');

  // active grandfather -> paid via grandfather
  assert.equal(by['3'].grandfathered, true);
  assert.equal(by['3'].status, 'paid');
  assert.equal(by['3'].source, 'grandfather');

  // expired grandfather -> not active, falls through to the unknown Stripe tier
  assert.equal(by['4'].grandfathered, false);
  assert.equal(by['4'].status, 'unknown');
  assert.equal(by['4'].source, 'stripe');

  // plain member, no override -> unknown (live Stripe not available here)
  assert.equal(by['5'].role, 'member');
  assert.equal(by['5'].status, 'unknown');
  assert.equal(by['5'].username, 'plain');

  // banned overrides everything
  assert.equal(by['9'].banned, true);
  assert.equal(by['9'].status, 'banned');
  assert.equal(by['9'].source, 'ban');

  assert.deepEqual(summary, { total: 6, staff: 2, grandfathered: 1, banned: 1, members: 2 });
});

test('a ban on a staff member still resolves to banned (precedence)', () => {
  const { roster } = buildRoster({
    roles: { superadmins: [{ github_id: '1' }], admins: [], moderators: [] },
    bans: { bans: [{ github_id: '1' }] },
    grandfathered: {}, membersIndex: { members: { 1: 'sa' } },
  });
  assert.equal(roster[0].status, 'banned');
  assert.equal(roster[0].source, 'ban');
  assert.equal(roster[0].role, 'superadmin'); // the role flag still reports, but status is banned
});

test('roster sorts staff -> grandfathered -> banned -> members', () => {
  const { roster } = buildRoster(parsed, new Date('2026-06-17'));
  const bands = roster.map((r) => (r.role !== 'member' ? 'staff' : r.grandfathered ? 'gf' : r.banned ? 'ban' : 'mem'));
  // staff entries come before the first non-staff, etc. (monotonic non-decreasing band)
  const order = { staff: 0, gf: 1, ban: 2, mem: 3 };
  for (let i = 1; i < bands.length; i++) assert.ok(order[bands[i]] >= order[bands[i - 1]], `band order at ${i}`);
});

test('stripeStatuses merge: real Stripe tier fills the non-override rows + enumerates pure-Stripe members', () => {
  const { roster, summary } = buildRoster({
    ...parsed,
    stripeStatuses: { 5: 'paid', 4: 'trialing', 8: 'expired' }, // 8 is pure-Stripe (no override, no index entry)
  }, new Date('2026-06-17'));
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));

  // a plain member with a live paid sub -> status paid via stripe (not 'unknown')
  assert.equal(by['5'].status, 'paid');
  assert.equal(by['5'].source, 'stripe');
  assert.equal(by['5'].stripeStatus, 'paid');

  // expired grandfather (4) now falls through to the real Stripe tier (trialing), not 'unknown'
  assert.equal(by['4'].grandfathered, false);
  assert.equal(by['4'].status, 'trialing');

  // a pure-Stripe member (id 8, absent from every override file) is now enumerated
  assert.ok(by['8'], 'a Stripe-only member is listed');
  assert.equal(by['8'].status, 'expired');
  assert.equal(by['8'].username, null);

  // an override still wins over Stripe: the banned id stays banned, staff stays paid-via-staff
  assert.equal(by['9'].status, 'banned');
  assert.equal(by['1'].source, 'staff');
  assert.equal(summary.total, 7); // the 6 known + the pure-Stripe id 8
});

test('empty / missing inputs yield an empty roster, not a throw', () => {
  assert.deepEqual(buildRoster({}), { roster: [], summary: { total: 0, staff: 0, grandfathered: 0, banned: 0, members: 0 } });
  assert.deepEqual(buildRoster(), { roster: [], summary: { total: 0, staff: 0, grandfathered: 0, banned: 0, members: 0 } });
});

// SOW-091: the username resolves through the roles login + the Stripe github_login before the raw-id fallback,
// so a staff member or a paid/trial member with no published content is named instead of "id <github_id>".
test('buildRoster: a staff member absent from members-index resolves to its roles.yml login', () => {
  const { roster } = buildRoster({
    roles: { admins: [{ github_id: '77', login: 'staffy' }], moderators: [], superadmins: [] },
    membersIndex: { members: {} }, // no published content -> not in the index
  });
  const row = roster.find((r) => r.githubId === '77');
  assert.equal(row.username, 'staffy');
  assert.equal(row.role, 'admin');
});

test('buildRoster: a member present only via Stripe resolves to its github_login (stripeLogins)', () => {
  const { roster } = buildRoster({
    membersIndex: { members: {} },
    stripeStatuses: { 88: 'trialing' },
    stripeLogins: { 88: 'trialer' },
  });
  const row = roster.find((r) => r.githubId === '88');
  assert.equal(row.username, 'trialer');
  assert.equal(row.status, 'trialing');
});

test('buildRoster: members-index wins over the roles login; an unknown member keeps the raw-id fallback (null username)', () => {
  const { roster } = buildRoster({
    roles: { admins: [{ github_id: '5', login: 'roles-login' }], moderators: [], superadmins: [] },
    membersIndex: { members: { 5: 'index-name' } },
    stripeStatuses: { 99: 'paid' }, // 99 has no login in any source
  });
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));
  assert.equal(by['5'].username, 'index-name'); // members-index still wins
  assert.equal(by['99'].username, null); // no login source -> null (the dashboard falls back to the raw id)
});

// sow-229: the roster now carries the TIER axis, grant provenance, expiry, and a pending-KV-grant annotation.
test('sow-229: buildRoster resolves tier per source (staff creator, grandfather creator/member, ban none)', () => {
  const { roster } = buildRoster({
    roles: { superadmins: [{ github_id: '1', login: 'sa' }], admins: [{ github_id: '2', login: 'ad' }], moderators: [] },
    bans: { bans: [{ github_id: '9', login: 'baddie' }] },
    grandfathered: { grandfathered: [
      { github_id: '3', login: 'founder', until: null },              // default grant -> creator
      { github_id: '7', login: 'memb', until: null, tier: 'member' }, // explicit member grant
    ] },
    membersIndex: { members: { 1: 'sa', 2: 'ad', 3: 'founder', 7: 'memb', 9: 'baddie' } },
  }, new Date('2026-06-17'));
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));
  assert.equal(by['1'].tier, 'creator'); // superadmin (staff)
  assert.equal(by['2'].tier, 'creator'); // admin (staff)
  assert.equal(by['3'].tier, 'creator'); // grandfather, default tier
  assert.equal(by['7'].tier, 'member');  // grandfather, explicit tier survives
  assert.equal(by['9'].tier, 'none');    // banned -> none
});

test('sow-229: a stripe-source paid member takes its stripeTiers tier; without the map it fails closed to none', () => {
  const withTier = buildRoster({
    membersIndex: { members: {} },
    stripeStatuses: { 50: 'paid', 51: 'paid' },
    stripeTiers: { 50: 'creator' }, // 51 is absent from the tier map
  });
  const a = Object.fromEntries(withTier.roster.map((r) => [r.githubId, r]));
  assert.equal(a['50'].source, 'stripe');
  assert.equal(a['50'].tier, 'creator');
  assert.equal(a['51'].tier, 'none'); // paid but tier unknown -> fail closed to none, never creator

  const noTier = buildRoster({ membersIndex: { members: {} }, stripeStatuses: { 50: 'paid' } });
  assert.equal(noTier.roster.find((r) => r.githubId === '50').tier, 'none'); // no stripeTiers map at all -> none
});

test('sow-229: grant provenance (couponCode) and expiresInDays are surfaced', () => {
  const now = new Date('2026-06-17T00:00:00Z');
  const { roster } = buildRoster({
    grandfathered: { grandfathered: [
      { github_id: '20', login: 'invited', until: '2027-06-17T00:00:00Z', reason: 'coupon:CODEABLEYEAR', tier: 'creator' },
      { github_id: '21', login: 'comp', until: null, reason: 'complimentary access' },
    ] },
    membersIndex: { members: { 20: 'invited', 21: 'comp' } },
  }, now);
  const by = Object.fromEntries(roster.map((r) => [r.githubId, r]));
  assert.equal(by['20'].grantReason, 'coupon:CODEABLEYEAR');
  assert.equal(by['20'].couponCode, 'CODEABLEYEAR'); // parsed from the reason
  assert.equal(by['20'].expiresInDays, 365);         // one year out
  assert.equal(by['20'].tier, 'creator');
  assert.equal(by['21'].couponCode, null);           // a non-coupon reason yields no code
  assert.equal(by['21'].expiresInDays, null);        // a permanent grant -> null
});

test('sow-229: a pending KV grant is an annotation, not effective state, and is suppressed once folded', () => {
  const now = new Date('2026-08-16T00:00:00Z');
  // metacast: a redemption in KV; the member is otherwise only a Stripe customer (trialing), NOT yet folded.
  const pending = buildRoster({
    membersIndex: { members: {} },
    stripeStatuses: { 190312419: 'trialing' },
    pendingGrants: { 190312419: { code: 'CODEABLEYEAR', until: '2027-08-16T00:00:00Z', tier: 'creator' } },
  }, now);
  const row = pending.roster.find((r) => r.githubId === '190312419');
  assert.ok(row, 'a pure-pending member is enumerated');
  assert.deepEqual(row.pendingGrant, { code: 'CODEABLEYEAR', until: '2027-08-16T00:00:00Z', tier: 'creator' });
  assert.equal(row.status, 'trialing'); // effective status stays Stripe-derived
  assert.equal(row.source, 'stripe');
  assert.equal(row.tier, 'none');       // NOT upgraded to creator by the pending grant (annotation only)

  // once folded (a `coupon:` reason exists in grandfathered.yml), the pending marker is suppressed and the
  // grant becomes effective via the grandfather source.
  const folded = buildRoster({
    grandfathered: { grandfathered: [{ github_id: '190312419', login: 'metacast', until: '2027-08-16T00:00:00Z', reason: 'coupon:CODEABLEYEAR', tier: 'creator' }] },
    membersIndex: { members: { 190312419: 'metacast' } },
    pendingGrants: { 190312419: { code: 'CODEABLEYEAR', until: '2027-08-16T00:00:00Z', tier: 'creator' } },
  }, now);
  const frow = folded.roster.find((r) => r.githubId === '190312419');
  assert.equal(frow.pendingGrant, null);         // folded -> no pending marker
  assert.equal(frow.couponCode, 'CODEABLEYEAR'); // shown as a folded coupon grant
  assert.equal(frow.tier, 'creator');            // now effective (grandfather source)
});
