// Tests for the membership trust core: status derivation, override precedence, and the shared
// PR-classification / merge decision (the anti-escalation heart). Run with `node --test`.
// No secrets, no network: a fake Stripe client and in-memory override maps stand in for live infra.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveStatus,
  deriveStatusFromCustomer,
  mostRelevantSubscription,
  STATUS,
  TRIAL_DAYS,
} from '../membership/derive-status.mjs';
import {
  rolesFromParsed,
  bansFromParsed,
  grandfathersFromParsed,
  membersIndexFromParsed,
  roleOf,
  isBanned,
  grandfatherActive,
  effectiveStatus,
  ROLE,
} from '../membership/overrides.mjs';
import { decide, classifyPaths, ownedFolderFor, contentTypesTouched, contributionTarget, isContributionToFolder, requiredTierFor } from '../membership/classify-pr.mjs';
import { TIER } from '../membership/tiers.mjs';

const NOW = new Date('2026-06-02T00:00:00Z');
const daysAgo = (n) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000).toISOString();

const customer = (over = {}) => ({
  id: 'cus_1',
  metadata: { github_id: '100', trial_started_at: daysAgo(10), ...(over.metadata || {}) },
  subscriptions: over.subscriptions ?? { data: [] },
});
const sub = (status, created = 1) => ({ status, created });

// ---------------------------------------------------------------------------
// deriveStatusFromCustomer
// ---------------------------------------------------------------------------
test('active subscription = paid', () => {
  assert.equal(deriveStatusFromCustomer(customer({ subscriptions: { data: [sub('active')] } }), NOW), STATUS.paid);
});
test('past_due subscription stays paid (dunning grace)', () => {
  assert.equal(deriveStatusFromCustomer(customer({ subscriptions: { data: [sub('past_due')] } }), NOW), STATUS.paid);
});
test('canceled / unpaid / incomplete_expired = cancelled', () => {
  for (const s of ['canceled', 'unpaid', 'incomplete_expired']) {
    assert.equal(deriveStatusFromCustomer(customer({ subscriptions: { data: [sub(s)] } }), NOW), STATUS.cancelled, s);
  }
});
test('no subscription within 90 days = trialing', () => {
  assert.equal(deriveStatusFromCustomer(customer({ metadata: { trial_started_at: daysAgo(10) } }), NOW), STATUS.trialing);
});
test('no subscription past 90 days = expired', () => {
  assert.equal(deriveStatusFromCustomer(customer({ metadata: { trial_started_at: daysAgo(120) } }), NOW), STATUS.expired);
});
test('trial boundary is exactly 90 days', () => {
  const justInside = deriveStatusFromCustomer(customer({ metadata: { trial_started_at: daysAgo(TRIAL_DAYS - 1) } }), NOW);
  const justOutside = deriveStatusFromCustomer(customer({ metadata: { trial_started_at: daysAgo(TRIAL_DAYS + 1) } }), NOW);
  assert.equal(justInside, STATUS.trialing);
  assert.equal(justOutside, STATUS.expired);
});
test('incomplete sub within trial falls through to trialing', () => {
  const c = customer({ metadata: { trial_started_at: daysAgo(5) }, subscriptions: { data: [sub('incomplete')] } });
  assert.equal(deriveStatusFromCustomer(c, NOW), STATUS.trialing);
});
test('missing trial_started_at and no sub = expired (fail toward unpaid)', () => {
  assert.equal(deriveStatusFromCustomer({ id: 'c', metadata: {}, subscriptions: { data: [] } }, NOW), STATUS.expired);
});
test('null customer = none', () => {
  assert.equal(deriveStatusFromCustomer(null, NOW), STATUS.none);
});
test('mostRelevantSubscription prefers active over a newer canceled one', () => {
  const picked = mostRelevantSubscription([sub('canceled', 999), sub('active', 1)]);
  assert.equal(picked.status, 'active');
});
test('subscriptions accepted as a plain array too', () => {
  assert.equal(deriveStatusFromCustomer({ metadata: {}, subscriptions: [sub('active')] }, NOW), STATUS.paid);
});

// ---------------------------------------------------------------------------
// deriveStatus (async lookup, fail closed)
// ---------------------------------------------------------------------------
test('deriveStatus returns none when the customer is not found', async () => {
  const client = { findCustomerByGithubId: async () => null };
  assert.equal(await deriveStatus('999', client, NOW), STATUS.none);
});
test('deriveStatus fails closed to none when the client throws', async () => {
  const client = { findCustomerByGithubId: async () => { throw new Error('stripe down'); } };
  assert.equal(await deriveStatus('100', client, NOW), STATUS.none);
});
test('deriveStatus resolves a found customer', async () => {
  const client = { findCustomerByGithubId: async () => customer({ subscriptions: { data: [sub('active')] } }) };
  assert.equal(await deriveStatus('100', client, NOW), STATUS.paid);
});

// ---------------------------------------------------------------------------
// overrides parsing + effective status precedence
// ---------------------------------------------------------------------------
const roles = rolesFromParsed({
  superadmins: [{ github_id: '1', login: 'hudson' }, { github_id: 'REPLACE_AT_M0' }],
  admins: [{ github_id: '2' }, { github_id: '900', login: 'gbti-bot' }],
  moderators: [{ github_id: '3' }],
});

test('roles parse with correct ladder and ignore M0 placeholders', () => {
  assert.equal(roleOf('1', roles), ROLE.superadmin);
  assert.equal(roleOf('2', roles), ROLE.admin);
  assert.equal(roleOf('3', roles), ROLE.moderator);
  assert.equal(roleOf('100', roles), ROLE.member); // unlisted default
  assert.equal(roles.has('REPLACE_AT_M0'), false);
});

test('ban overrides paid and grandfather', () => {
  const bans = bansFromParsed({ bans: [{ github_id: '100' }] });
  const grandfathers = grandfathersFromParsed({ grandfathered: [{ github_id: '100' }] });
  assert.equal(isBanned('100', bans), true);
  const eff = effectiveStatus('100', STATUS.paid, { bans, grandfathers }, NOW);
  assert.deepEqual(eff, { status: 'banned', source: 'ban' });
});

test('grandfather makes an expired user paid with no subscription', () => {
  const bans = bansFromParsed({ bans: [] });
  const grandfathers = grandfathersFromParsed({ grandfathered: [{ github_id: '100', until: null }] });
  const eff = effectiveStatus('100', STATUS.expired, { bans, grandfathers }, NOW);
  assert.deepEqual(eff, { status: 'paid', source: 'grandfather' });
});

test('grandfather respects an until in the past (expires) and future (active)', () => {
  const bans = bansFromParsed({ bans: [] });
  const past = grandfathersFromParsed({ grandfathered: [{ github_id: '100', until: daysAgo(1) }] });
  const future = grandfathersFromParsed({ grandfathered: [{ github_id: '100', until: daysAgo(-30) }] });
  assert.equal(grandfatherActive('100', past, NOW), false);
  assert.equal(grandfatherActive('100', future, NOW), true);
  assert.equal(effectiveStatus('100', STATUS.expired, { bans, grandfathers: past }, NOW).status, STATUS.expired);
  assert.equal(effectiveStatus('100', STATUS.expired, { bans, grandfathers: future }, NOW).status, STATUS.paid);
});

test('no override returns the stripe-derived status', () => {
  const eff = effectiveStatus('100', STATUS.trialing, { bans: new Map(), grandfathers: new Map() }, NOW);
  assert.deepEqual(eff, { status: STATUS.trialing, source: 'stripe' });
});

test('staff (privileged role) is paid-equivalent; ban overrides staff; gate path (no roles) skips it', () => {
  const roles = rolesFromParsed({ superadmins: [{ github_id: '100' }], moderators: [{ github_id: '7' }] });
  const noBan = new Map();
  const noGf = new Map();
  assert.deepEqual(effectiveStatus('100', STATUS.expired, { bans: noBan, grandfathers: noGf, roles }, NOW), { status: 'paid', source: 'staff' });
  assert.equal(effectiveStatus('7', STATUS.none, { bans: noBan, grandfathers: noGf, roles }, NOW).status, 'paid'); // moderator
  assert.equal(effectiveStatus('999', STATUS.trialing, { bans: noBan, grandfathers: noGf, roles }, NOW).status, 'trialing'); // non-staff -> stripe
  const banned = bansFromParsed({ bans: [{ github_id: '100' }] });
  assert.equal(effectiveStatus('100', STATUS.expired, { bans: banned, grandfathers: noGf, roles }, NOW).status, 'banned'); // ban wins
  assert.equal(effectiveStatus('100', STATUS.expired, { bans: noBan, grandfathers: noGf }, NOW).status, STATUS.expired); // no roles passed -> staff tier skipped
});

test('members index resolves github_id to folder', () => {
  const idx = membersIndexFromParsed({ members: { '100': 'octocat', '200': 'defunkt' } });
  assert.equal(ownedFolderFor('100', idx), 'octocat');
  assert.equal(ownedFolderFor('999', idx), null);
});

// ---------------------------------------------------------------------------
// PR classification + merge decision (the anti-escalation heart)
// ---------------------------------------------------------------------------
const PAID = { status: 'paid' };
const TRIAL = { status: 'trialing' };
const BANNED = { status: 'banned' };

test('paid Content Creator, own-folder content => pass + auto-merge', () => {
  const d = decide({ paths: ['members/octocat/posts/hello/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator });
  assert.equal(d.check, 'pass');
  assert.equal(d.autoMerge, true);
  assert.equal(d.label, 'paid');
});

test('trial member, own-folder content => rejected-not-paid (no profile carve-out; the draft stays on the fork)', () => {
  for (const file of ['members/octocat/profile.md', 'members/octocat/posts/x/index.md', 'members/octocat/products/y/index.md']) {
    const d = decide({ paths: [file], role: ROLE.member, effective: TRIAL, ownedFolder: 'octocat' });
    assert.equal(d.check, 'fail', file);
    assert.equal(d.label, 'rejected-not-paid', file);
    assert.equal(d.autoMerge, false, file);
  }
});

test('banned member => fail even when paid and own-folder', () => {
  const d = decide({ paths: ['members/octocat/posts/x/index.md'], role: ROLE.member, effective: BANNED, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'banned');
});

// SOW-024: the SOW-013 favorites carve-out is RETIRED. Favorites moved off the immutable public repo onto the
// deletable edge store (KV), so there is no longer a "favorited" auto-merge label. A stray
// members/<me>/favorites.yml PR is now just own-folder content: paid publishes, trial is rejected-not-paid (the
// stricter, fail-safe behavior). These tests pin that the loophole (trial auto-merge of favorites.yml) is gone.
test('favorites.yml PR is no longer a carve-out: trial => rejected-not-paid, paid => publishes, label never "favorited"', () => {
  const trial = decide({ paths: ['members/octocat/favorites.yml'], role: ROLE.member, effective: TRIAL, ownedFolder: 'octocat' });
  assert.equal(trial.check, 'fail');
  assert.equal(trial.label, 'rejected-not-paid');
  assert.notEqual(trial.autoMerge, true);

  const paid = decide({ paths: ['members/octocat/favorites.yml'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator });
  assert.equal(paid.check, 'pass');
  assert.equal(paid.label, 'paid');
});

test('a banned member still fails on a favorites.yml PR (ban precedes everything)', () => {
  const d = decide({ paths: ['members/octocat/favorites.yml'], role: ROLE.member, effective: BANNED, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'banned');
});

test('a non-member still fails on a favorites.yml PR (members-only)', () => {
  const d = decide({ paths: ['members/octocat/favorites.yml'], role: ROLE.member, effective: { status: 'none' }, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-a-member');
});

test('member editing ANOTHER members folder without owner approval => held contribution', () => {
  const d = decide({ paths: ['members/someone-else/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'contribution-pending-owner');
});

test('contribution: owner approved + owner paid => accepted, no auto-merge', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: true, tier: TIER.creator, ownerTier: TIER.creator });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'contribution-accepted');
  assert.equal(d.autoMerge, false);
});

test('contribution: owner approved but NOT paid => held', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: false, tier: TIER.creator });
  assert.equal(d.label, 'contribution-pending-owner');
});

test('contribution: a TRIAL contributor is paid-gated => rejected-not-paid even with owner approval', () => {
  // Publishing a contribution surfaces the contributor's credit on the live site, which is paid-only.
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: TRIAL, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: true });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-paid');
});

test('contribution to TWO other members => rejected escalation', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md', 'members/carol/posts/y/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: true });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('mixed own + other folder => rejected escalation', () => {
  const d = decide({ paths: ['members/octocat/posts/a/index.md', 'members/bob/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', ownerApproved: true, ownerPaid: true });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('members-only: visitor (none), expired, cancelled => rejected-not-a-member', () => {
  for (const status of ['none', 'expired', 'cancelled']) {
    const d = decide({ paths: ['members/octocat/posts/x/index.md'], role: ROLE.member, effective: { status }, ownedFolder: 'octocat' });
    assert.equal(d.check, 'fail', status);
    assert.equal(d.label, 'rejected-not-a-member', status);
  }
});

test('members-only: a non-member cannot contribute either (rejected before the contribution path)', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: { status: 'expired' }, ownedFolder: null, ownerApproved: true, ownerPaid: true });
  assert.equal(d.label, 'rejected-not-a-member');
});

test('members-only: a trial member is a member but cannot publish (rejected-not-paid, distinct from non-member)', () => {
  const d = decide({ paths: ['members/octocat/posts/x/index.md'], role: ROLE.member, effective: TRIAL, ownedFolder: 'octocat' });
  assert.equal(d.label, 'rejected-not-paid'); // not 'rejected-not-a-member' (trial IS a member) and not held
});

// sow-185: the TIER gate. Public presence (post/product/prompt/profile) needs Content Creator; comments need
// only Network Member. A paid member below the required tier is rejected-not-creator (auto-closed with a nudge).
test('sow-185: a Network Member publishing own-folder public content => rejected-not-creator', () => {
  for (const p of ['members/octocat/posts/x/index.md', 'members/octocat/products/y/index.md', 'members/octocat/prompts/z/index.md', 'members/octocat/profile.md']) {
    const d = decide({ paths: [p], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member });
    assert.equal(d.check, 'fail', p);
    assert.equal(d.label, 'rejected-not-creator', p);
    assert.equal(d.autoMerge, false, p);
  }
});

test('sow-185: a Network Member publishing an own-folder comment => pass (member suffices)', () => {
  const d = decide({ paths: ['members/octocat/comments/hello.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'paid');
});

test('sow-185: a Content Creator publishes every own-folder content type', () => {
  for (const p of ['members/octocat/posts/x/index.md', 'members/octocat/products/y/index.md', 'members/octocat/prompts/z/index.md', 'members/octocat/profile.md', 'members/octocat/comments/c.md']) {
    const d = decide({ paths: [p], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator });
    assert.equal(d.check, 'pass', p);
    assert.equal(d.label, 'paid', p);
  }
});

test('sow-185: a paid status with tier none (an unmapped price) is denied even for a comment (fail closed)', () => {
  const d = decide({ paths: ['members/octocat/comments/c.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.none });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-creator');
});

test('sow-185 contribution: a Network Member cannot contribute public content (rejected-not-creator)', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member, ownerApproved: true, ownerPaid: true, ownerTier: TIER.creator });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-creator');
});

test('sow-185 contribution: a Content Creator contributing into a Network Member owner folder is rejected (cannot live there)', () => {
  const d = decide({ paths: ['members/bob/posts/x/index.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.creator, ownerApproved: true, ownerPaid: true, ownerTier: TIER.member });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-creator');
});

test('sow-185 contribution: a comment by a Network Member into a Network Member owner folder is accepted', () => {
  const d = decide({ paths: ['members/bob/comments/c.md'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member, ownerApproved: true, ownerPaid: true, ownerTier: TIER.member });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'contribution-accepted');
});

test('sow-185 requiredTierFor: public types -> creator, comments-only -> member, mixed/empty -> creator', () => {
  for (const t of ['post', 'product', 'prompt', 'profile']) assert.equal(requiredTierFor([t]), TIER.creator, t);
  assert.equal(requiredTierFor(['comment']), TIER.member);
  assert.equal(requiredTierFor(['comment', 'post']), TIER.creator);
  assert.equal(requiredTierFor([]), TIER.creator);
  assert.equal(requiredTierFor(null), TIER.creator);
});

test('SOW-108: a superadmin auto-merges any path they touch, including house/** and Tier S', () => {
  const sup = (paths) => decide({ paths, role: ROLE.superadmin, effective: PAID });
  const q = sup(['house/quotes.yml']);
  assert.equal(q.check, 'pass');
  assert.equal(q.autoMerge, true);
  assert.equal(q.label, 'superadmin-automerge');
  // Tier S too (roles.yml, CODEOWNERS, .github) -> the owner-elected removal of the two-person review
  assert.equal(sup(['house/roles.yml']).autoMerge, true);
  assert.equal(sup(['CODEOWNERS']).autoMerge, true);
  assert.equal(sup(['.github/workflows/x.yml']).autoMerge, true);
});

test('SOW-108: an admin house edit still needs review; a non-privileged Tier/house PR still hard-fails', () => {
  const admin = decide({ paths: ['house/quotes.yml'], role: ROLE.admin, effective: PAID });
  assert.equal(admin.check, 'pass');
  assert.equal(admin.autoMerge, false); // admins are unchanged: house edits fall to code-owner review
  assert.equal(admin.label, 'admin-review');
  // an admin cannot touch Tier S (roles.yml) at all
  assert.equal(decide({ paths: ['house/roles.yml'], role: ROLE.admin, effective: PAID }).label, 'rejected-escalation');
  // a plain member touching house is rejected
  assert.equal(decide({ paths: ['house/quotes.yml'], role: ROLE.member, effective: PAID }).label, 'rejected-escalation');
});

test('contributionTarget resolves a single other owner, else null', () => {
  assert.equal(contributionTarget(['members/bob/posts/x/index.md'], 'octocat'), 'bob');
  assert.equal(contributionTarget(['members/octocat/posts/x/index.md'], 'octocat'), null); // own folder
  assert.equal(contributionTarget(['members/bob/posts/x/index.md', 'members/carol/p/y/index.md'], 'octocat'), null); // two owners
  assert.equal(contributionTarget(['members/bob/posts/x/index.md', 'house/roles.yml'], 'octocat'), null); // protected
  assert.equal(contributionTarget(['members/octocat/../bob/x.md'], 'octocat'), null); // non-canonical
});

test('isContributionToFolder is the owner-side mirror of contributionTarget (SOW-028)', () => {
  // True only when every path sits cleanly inside members/<owner>/.
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md'], 'bob'), true);
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md', 'members/bob/products/y/index.md'], 'bob'), true);
  assert.equal(isContributionToFolder(['members/carol/posts/z/index.md'], 'bob'), false); // another folder
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md', 'house/roles.yml'], 'bob'), false); // mixed w/ infra
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md', 'members/carol/p/y/index.md'], 'bob'), false); // two owners
  assert.equal(isContributionToFolder(['members/bob/../carol/x.md'], 'bob'), false); // non-canonical
  assert.equal(isContributionToFolder(['members/bobby/posts/x/index.md'], 'bob'), false); // prefix is not a path boundary
  assert.equal(isContributionToFolder([], 'bob'), false); // empty
  // SOW-093: a share is the member's own activity stream, not a contribution to review (was wrongly true).
  assert.equal(isContributionToFolder(['members/bob/shares/20260701-x.md'], 'bob'), false);
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md', 'members/bob/shares/s.md'], 'bob'), false); // a post + a share is not a clean contribution
  assert.equal(isContributionToFolder(['members/bob/comments/c1.md'], 'bob'), true); // comments still count (unchanged by the shares fix)
  assert.equal(isContributionToFolder(['members/bob/posts/x/index.md'], null), false); // no owner folder
});

test('member editing house/bans.yml => rejected escalation', () => {
  const d = decide({ paths: ['house/bans.yml'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('member editing house/grandfathered.yml (self-grant attempt) => rejected escalation', () => {
  const d = decide({ paths: ['house/grandfathered.yml'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('member editing house/roles.yml => rejected escalation', () => {
  const d = decide({ paths: ['house/roles.yml'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('member editing .github workflow (gate tampering) => rejected escalation', () => {
  const d = decide({ paths: ['.github/workflows/pr-membership-gate.yml'], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('member editing infra (src/, root config, CODEOWNERS) => rejected escalation', () => {
  for (const p of ['src/pages/index.astro', 'package.json', 'CODEOWNERS', 'scripts/reconcile.mjs']) {
    const d = decide({ paths: [p], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
    assert.equal(d.check, 'fail', p);
    assert.equal(d.label, 'rejected-escalation', p);
  }
});

test('member mixing own content with a sneaky house file => rejected (whole PR fails)', () => {
  const d = decide({
    paths: ['members/octocat/posts/x/index.md', 'house/grandfathered.yml'],
    role: ROLE.member,
    effective: PAID,
    ownedFolder: 'octocat',
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('moderator deplatforming another members content => pass', () => {
  const d = decide({ paths: ['members/someone-else/posts/x/index.md'], role: ROLE.moderator, effective: TRIAL, ownedFolder: 'mod-folder' });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'admin-review');
  assert.equal(d.autoMerge, false);
});

test('moderator editing bans.yml => rejected (ban is admin-only)', () => {
  const d = decide({ paths: ['house/bans.yml'], role: ROLE.moderator, effective: PAID, ownedFolder: 'mod-folder' });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('admin editing bans.yml => pass', () => {
  const d = decide({ paths: ['house/bans.yml'], role: ROLE.admin, effective: TRIAL, ownedFolder: null });
  assert.equal(d.check, 'pass');
});

test('admin editing roles.yml (self-promotion attempt) => rejected escalation', () => {
  const d = decide({ paths: ['house/roles.yml'], role: ROLE.admin, effective: PAID, ownedFolder: null });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('superadmin editing roles.yml => pass', () => {
  const d = decide({ paths: ['house/roles.yml'], role: ROLE.superadmin, effective: PAID, ownedFolder: null });
  assert.equal(d.check, 'pass');
});

test('reconcile bot (isBot) disabling another members content => pass', () => {
  const d = decide({ paths: ['members/someone-else/posts/x/index.md'], role: ROLE.member, effective: { status: 'none' }, ownedFolder: null, isBot: true });
  assert.equal(d.check, 'pass');
});

test('isBot is a floor, not an override: an unprivileged bot becomes admin (cannot touch roles.yml)', () => {
  const d = decide({ paths: ['house/roles.yml'], role: ROLE.member, effective: { status: 'none' }, ownedFolder: null, isBot: true });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation'); // admin floor, not superadmin
});

test('a bot that is also superadmin keeps superadmin powers (may edit roles.yml)', () => {
  const d = decide({ paths: ['house/roles.yml'], role: ROLE.superadmin, effective: { status: 'none' }, ownedFolder: null, isBot: true });
  assert.equal(d.check, 'pass'); // superadmin not demoted to admin by isBot
});

test('banned admin is still deplatformed (ban beats privilege)', () => {
  const d = decide({ paths: ['members/someone-else/posts/x/index.md'], role: ROLE.admin, effective: BANNED, ownedFolder: null });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'banned');
});

test('empty PR (no changed paths) does not auto-pass', () => {
  const d = decide({ paths: [], role: ROLE.member, effective: PAID, ownedFolder: 'octocat' });
  assert.equal(d.autoMerge, false);
});

test('classifyPaths buckets own vs other vs tiers', () => {
  const c = classifyPaths(
    ['members/octocat/posts/a/index.md', 'members/bob/posts/b/index.md', 'house/bans.yml', 'house/roles.yml', 'src/x.ts'],
    'octocat',
  );
  assert.deepEqual(c.ownPaths, ['members/octocat/posts/a/index.md']);
  assert.deepEqual(c.otherMemberPaths, ['members/bob/posts/b/index.md']);
  assert.deepEqual(c.tierA, ['house/bans.yml']);
  assert.deepEqual(c.tierS.sort(), ['house/roles.yml', 'src/x.ts'].sort());
  assert.deepEqual(c.unclean, []);
  assert.equal(c.ownFolderOnly, false);
});

test('contentTypesTouched reports published types', () => {
  const types = contentTypesTouched(
    ['members/octocat/profile.md', 'members/octocat/posts/a/index.md', 'members/octocat/products/b/index.md'],
    'octocat',
  ).sort();
  assert.deepEqual(types, ['post', 'product', 'profile']);
});
