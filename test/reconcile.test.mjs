// SOW-005 reconcile tests. Drives the PURE planReconcile with fixtures for each scenario plus an
// idempotency check. No network, no secrets: the planner is pure and the few CLI helpers we exercise
// (flipStatus, parseArgs, memberEntryFor) take plain objects. Run ONLY this file:
//   node --test test/reconcile.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { planReconcile, discordRoleTarget, discordCreatorTarget, CREATOR_DISCORD_ROLE, REMINDER_DAY } from '../scripts/lib/reconcile-plan.mjs';
import { applyPendingCouponGrants } from '../scripts/reconcile.mjs'; // sow-218: same-run coupon grant pre-apply
import {
  flipStatus,
  parseArgs,
  memberEntryFor,
  resolveUsername,
  resolveDiscordRoles,
  enactPlan,
  targetedGithubId,
  gatherMembers,
  gatherOverrideOnlyMembers,
  parseDiscordUserMap,
  shouldSyncCreatorRole,
} from '../scripts/reconcile.mjs';
import { buildRepoIndex, githubLoginFromUrl, githubLoginFromProfile } from '../scripts/lib/repo-content.mjs';
import { createResendClient } from '../clients/resend.mjs';
import { effectiveStatus } from '../membership/overrides.mjs';
import { deriveStatusFromCustomer } from '../membership/derive-status.mjs';

const NOW = new Date('2026-06-02T00:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

/** Build an effective-status object the way the CLI does, so the test mirrors production wiring. */
function effective(githubId, derived, { bans = new Map(), grandfathers = new Map() } = {}) {
  return effectiveStatus(githubId, derived, { bans, grandfathers }, NOW);
}

/** Repo entry helper: files with their current status. */
const file = (p, status, visibility = 'public') => ({ path: p, status, visibility });

// helper to find actions by kind/type
const ofKind = (actions, kind) => actions.filter((a) => a.kind === kind);

// ---- cancelled member with published posts -> NO content action, Locked role only (sow-197) ----
// This test used to assert the opposite. A lapse now changes ACCESS, never published work: membership is
// enforced at write time (the gate, the Worker author route, the client), so nothing new can be published,
// and reconcile no longer reaches back into content it did not author. Only a BAN still drafts.
test('cancelled member keeps their published content and only loses the Discord role', () => {
  const members = [
    {
      githubId: '100',
      username: 'casey',
      derived: 'cancelled',
      effective: effective('100', 'cancelled'),
      discordUserId: 'd100',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = {
    casey: {
      files: [
        file('members/casey/profile.md', 'published'),
        file('members/casey/posts/hello/index.md', 'published'),
        file('members/casey/posts/already-draft/index.md', 'draft'),
      ],
    },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'a lapse must not touch content in either direction');
  // cancelled -> the Locked role: add locked, remove the member role they still hold (locked out, not kicked)
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.deepEqual(discord.find((a) => a.type === 'add-role'), { kind: 'discord', type: 'add-role', githubId: '100', discordUserId: 'd100', role: 'locked' });
  assert.deepEqual(discord.find((a) => a.type === 'remove-role'), { kind: 'discord', type: 'remove-role', githubId: '100', discordUserId: 'd100', role: 'member' });
});

// ---- grandfathered member with no sub -> keep published + member role ----
test('grandfathered member keeps published content and gets the member role', () => {
  const grandfathers = new Map([['200', { github_id: '200' }]]);
  const eff = effective('200', 'none', { grandfathers });
  assert.equal(eff.status, 'paid');
  assert.equal(eff.source, 'grandfather');
  const members = [
    {
      githubId: '200',
      username: 'gwen',
      derived: 'none',
      effective: eff,
      discordUserId: 'd200',
      discordRoles: [], // no role yet
    },
  ];
  const repoIndex = {
    gwen: { files: [file('members/gwen/profile.md', 'published'), file('members/gwen/posts/p1/index.md', 'published')] },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  // already published + grandfather (paid) -> NO content flip (idempotent)
  assert.equal(ofKind(actions, 'content').length, 0);
  // role is added (none -> member)
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 1);
  assert.equal(discord[0].type, 'add-role');
  assert.equal(discord[0].role, 'member');
});

// sow-185: the Content-Creator Discord badge is a SEPARATE, stackable axis (a creator holds member + creator;
// a member holds member only). Gated on creatorRoleEnabled (reconcile passes !!DISCORD_CREATOR_ROLE_ID).
test('discordCreatorTarget: only creator tier wants the badge', () => {
  assert.equal(discordCreatorTarget('creator'), true);
  assert.equal(discordCreatorTarget('member'), false);
  assert.equal(discordCreatorTarget('none'), false);
  assert.equal(discordCreatorTarget(undefined), false);
  assert.equal(CREATOR_DISCORD_ROLE, 'creator');
});

const creatorMember = (over = {}) => ({ githubId: '300', username: 'cr', derived: 'paid', effective: effective('300', 'paid'), discordUserId: 'd300', discordRoles: ['member'], tier: 'creator', ...over });

test('sow-185: a Content Creator gains the @Creator badge on TOP of @Member (member kept, not swapped)', () => {
  const actions = ofKind(planReconcile({ members: [creatorMember()], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  // no member add (already held), no member remove, exactly one creator add
  assert.deepEqual(actions, [{ kind: 'discord', type: 'add-role', githubId: '300', discordUserId: 'd300', role: 'creator' }]);
});

test('sow-185: a Content Creator already holding member + creator gets NO action (idempotent)', () => {
  const actions = ofKind(planReconcile({ members: [creatorMember({ discordRoles: ['member', 'creator'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.equal(actions.length, 0);
});

test('sow-185: a Network Member (member tier) never gets @Creator; a downgraded creator LOSES the badge', () => {
  const memberTier = planReconcile({ members: [creatorMember({ tier: 'member', discordRoles: ['member'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true });
  assert.equal(ofKind(memberTier, 'discord').length, 0); // member tier holds member already -> nothing
  const downgraded = ofKind(planReconcile({ members: [creatorMember({ tier: 'member', discordRoles: ['member', 'creator'] })], repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.deepEqual(downgraded, [{ kind: 'discord', type: 'remove-role', githubId: '300', discordUserId: 'd300', role: 'creator' }]);
});

test('sow-185: with the Creator role UNPROVISIONED (creatorRoleEnabled false) the badge axis emits NOTHING', () => {
  // pre-provision every paid member resolves to creator via the inert price map; the flag keeps the plan clean.
  const actions = ofKind(planReconcile({ members: [creatorMember()], repoIndex: {}, now: NOW }), 'discord');
  assert.equal(actions.filter((a) => a.role === 'creator').length, 0);
});

// ---- a draft is left alone, full stop (the 2026-08-08 incident) ----
// Reconcile published an unfinished article overnight (63c2800) because it republished ANY draft a paid member
// owned: nothing records WHY a file is draft, so it could not tell content it had drafted after a lapse from a
// draft the author was still writing. sow-197 removed the publish path entirely rather than guessing at intent.
// Without this the WorkBench draft review shipped in sow-194 is pointless, since every reviewable draft would
// be one nightly run from going live.
test('a paid member\'s draft is never auto-published', () => {
  const members = [
    {
      githubId: '900', username: 'nia', derived: 'paid', effective: effective('900', 'paid'),
      discordUserId: 'd900', discordRoles: ['member'],
    },
  ];
  const repoIndex = { nia: { files: [file('members/nia/posts/wip/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'an unfinished draft must never be auto-published');
});

test('removing the publish path does NOT weaken the ban path: a banned member is still drafted', () => {
  // ban > staff > grandfather > Stripe exists so a ban deplatforms regardless of payment. The ban branch is
  // the one content path sow-197 kept, and this asserts it: the one direction that must never regress.
  const bans = new Map([['902', { github_id: '902' }]]);
  const members = [
    {
      githubId: '902', username: 'pat', derived: 'paid', effective: effective('902', 'paid', { bans }),
      discordUserId: 'd902', discordRoles: ['member'],
    },
  ];
  const repoIndex = { pat: { files: [file('members/pat/posts/live/index.md', 'published')] } };
  const content = ofKind(planReconcile({ members, repoIndex, now: NOW }), 'content');
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'draft');
});

// ---- grandfathered member with DRAFT content -> still no publish (sow-197) ----
// A grant makes the member effective-paid, and that used to republish anything of theirs sitting in draft.
// It no longer does: a draft is the author's own unpublish state, and only the author republishes it.
test('grandfathered member\'s drafted content is left in draft', () => {
  const grandfathers = new Map([['205', { github_id: '205' }]]);
  const members = [
    {
      githubId: '205',
      username: 'gabe',
      derived: 'none',
      effective: effective('205', 'none', { grandfathers }),
      discordUserId: 'd205',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = { gabe: { files: [file('members/gabe/posts/p1/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'a grant changes access, not content status');
  // role already member -> no discord action
  assert.equal(ofKind(actions, 'discord').length, 0);
});

// ---- banned member who is paid -> draft + roles removed (+ block) ----
test('banned member who is paid is deplatformed (draft + role removed + block)', () => {
  const bans = new Map([['300', { github_id: '300', reason: 'spam' }]]);
  const eff = effective('300', 'paid', { bans });
  assert.equal(eff.status, 'banned'); // ban overrides paid
  const members = [
    {
      githubId: '300',
      username: 'mallory',
      derived: 'paid',
      effective: eff,
      discordUserId: 'd300',
      discordRoles: ['member'],
    },
  ];
  const repoIndex = { mallory: { files: [file('members/mallory/posts/x/index.md', 'published')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  const content = ofKind(actions, 'content');
  assert.equal(content.length, 1);
  assert.equal(content[0].type, 'draft');
  // banned -> the Locked role (locked out, NOT kicked): add locked, remove the member role they held
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.equal(discord.find((a) => a.type === 'add-role').role, 'locked');
  assert.equal(discord.find((a) => a.type === 'remove-role').role, 'member');
  // a block marker is emitted
  assert.equal(ofKind(actions, 'block').length, 1);
});

// ---- trial member at day 88 -> reminder action ----
test('trial member inside the day-87 window gets a reminder', () => {
  const trialStartedAt = new Date(NOW.getTime() - 88 * DAY).toISOString();
  const members = [
    {
      githubId: '400',
      username: 'tori',
      derived: 'trialing',
      effective: effective('400', 'trialing'),
      discordUserId: 'd400',
      email: 'tori@example.com',
      discordRoles: ['trial'],
      trialStartedAt,
      converted: false,
    },
  ];
  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  const reminders = ofKind(actions, 'reminder');
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].type, 'day-87');
  assert.equal(reminders[0].email, 'tori@example.com');
  // trial role already correct -> no discord action
  assert.equal(ofKind(actions, 'discord').length, 0);
});

test('day-87 window excludes day 86 (too early), day 90 (expired), and converted members', () => {
  const make = (offsetDays, converted, status = 'trialing') => ({
    githubId: 'x',
    username: 'x',
    derived: status,
    effective: { status, source: 'stripe' },
    trialStartedAt: new Date(NOW.getTime() - offsetDays * DAY).toISOString(),
    converted,
  });
  assert.equal(REMINDER_DAY, 87);
  // day 86: before the window
  assert.equal(ofKind(planReconcile({ members: [make(86, false)], now: NOW }), 'reminder').length, 0);
  // day 88: inside
  assert.equal(ofKind(planReconcile({ members: [make(88, false)], now: NOW }), 'reminder').length, 1);
  // day 90: at/after expiry, window closed
  assert.equal(ofKind(planReconcile({ members: [make(90, false)], now: NOW }), 'reminder').length, 0);
  // day 88 but already converted: no reminder
  assert.equal(ofKind(planReconcile({ members: [make(88, true)], now: NOW }), 'reminder').length, 0);
});

// SOW-142: the day-87 nag is gated on the EFFECTIVE status being a trial. A member whose Stripe record is
// a day-88 trial but who is effective-paid another way (grandfather comp, a coupon free year, staff) must
// NOT be told their trial is ending; their entitlement does not end at day 90.
test('day-87 reminder never targets an effective-paid member with a Stripe trial record', () => {
  const make = (source) => ({
    githubId: 'g1',
    username: 'g1',
    derived: 'trialing',
    effective: { status: 'paid', source },
    trialStartedAt: new Date(NOW.getTime() - 88 * DAY).toISOString(),
    converted: false,
  });
  for (const source of ['grandfather', 'staff']) {
    const reminders = ofKind(planReconcile({ members: [make(source)], now: NOW }), 'reminder');
    assert.equal(reminders.filter((r) => r.type === 'day-87').length, 0, `source=${source}`);
  }
  // the plain trial control case still fires
  const plain = { githubId: 't', username: 't', derived: 'trialing', effective: { status: 'trialing', source: 'stripe' }, trialStartedAt: new Date(NOW.getTime() - 88 * DAY).toISOString(), converted: false };
  assert.equal(ofKind(planReconcile({ members: [plain], now: NOW }), 'reminder').filter((r) => r.type === 'day-87').length, 1);
});

// ---- resubscribed member -> member role added, content untouched (sow-197) ----
// Resubscribing restores ACCESS. It does not sweep the member's drafts live: reconcile never drafted them in
// the first place, so there is nothing of its own making left to reverse.
test('resubscribed (paid) member gets the member role and their drafts stay drafts', () => {
  const members = [
    {
      githubId: '500',
      username: 'rhea',
      derived: 'paid',
      effective: effective('500', 'paid'),
      discordUserId: 'd500',
      discordRoles: ['locked'], // was locked out while lapsed
    },
  ];
  const repoIndex = {
    rhea: {
      files: [
        file('members/rhea/profile.md', 'draft'),
        file('members/rhea/posts/p/index.md', 'draft'),
        file('members/rhea/products/q/index.md', 'published'), // already published, skip
      ],
    },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(ofKind(actions, 'content'), [], 'resubscribing restores access, not content status');
  // role swap: add member, remove the locked role they held while lapsed
  const discord = ofKind(actions, 'discord');
  assert.equal(discord.length, 2);
  assert.equal(discord.find((a) => a.type === 'add-role').role, 'member');
  assert.equal(discord.find((a) => a.type === 'remove-role').role, 'locked');
});

// ---- idempotency: running against the already-correct state yields no actions ----
test('idempotent: an already-correct paid member yields zero actions', () => {
  const members = [
    {
      githubId: '600',
      username: 'ida',
      derived: 'paid',
      effective: effective('600', 'paid'),
      discordUserId: 'd600',
      discordRoles: ['member'], // already correct
    },
  ];
  const repoIndex = {
    ida: { files: [file('members/ida/profile.md', 'published'), file('members/ida/posts/p/index.md', 'published')] },
  };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(actions, []);
});

test('idempotent: an already-correct expired member (all draft, holds the locked role) yields zero actions', () => {
  const members = [
    {
      githubId: '601',
      username: 'evan',
      derived: 'expired',
      effective: effective('601', 'expired'),
      discordUserId: 'd601',
      discordRoles: ['locked'], // already locked out (the target for an expired member)
    },
  ];
  const repoIndex = { evan: { files: [file('members/evan/posts/p/index.md', 'draft')] } };
  const actions = planReconcile({ members, repoIndex, now: NOW });
  assert.deepEqual(actions, []);
});

// ---- discordRoleTarget mapping ----
test('discordRoleTarget maps statuses to exactly one of the three managed roles', () => {
  assert.equal(discordRoleTarget('paid'), 'member');
  assert.equal(discordRoleTarget('trialing'), 'trial');
  // every non-entitled status maps to the Locked role (locked out of the channels, not kicked)
  assert.equal(discordRoleTarget('expired'), 'locked');
  assert.equal(discordRoleTarget('cancelled'), 'locked');
  assert.equal(discordRoleTarget('banned'), 'locked');
  assert.equal(discordRoleTarget('none'), 'locked');
});

// ---- three-role swaps: exactly one managed role, stray self-heal, never kick ----
test('trial -> paid swap: add member, remove the trial role they held', () => {
  const members = [{ githubId: '110', username: 'tess', derived: 'paid', effective: effective('110', 'paid'), discordUserId: 'd110', discordRoles: ['trial'] }];
  const actions = ofKind(planReconcile({ members, repoIndex: {}, now: NOW }), 'discord');
  assert.equal(actions.length, 2);
  assert.equal(actions.find((a) => a.type === 'add-role').role, 'member');
  assert.equal(actions.find((a) => a.type === 'remove-role').role, 'trial');
});

test('stray self-heal: a paid member who also holds a stray locked role has only the stray removed', () => {
  const members = [{ githubId: '111', username: 'stu', derived: 'paid', effective: effective('111', 'paid'), discordUserId: 'd111', discordRoles: ['member', 'locked'] }];
  const actions = ofKind(planReconcile({ members, repoIndex: {}, now: NOW }), 'discord');
  // target (member) already held -> no add; the stray locked is removed so exactly one managed role remains
  assert.equal(actions.length, 1);
  assert.deepEqual(actions[0], { kind: 'discord', type: 'remove-role', githubId: '111', discordUserId: 'd111', role: 'locked' });
});

test('enactPlan maps the locked role to DISCORD_LOCKED_ROLE_ID and never kicks the member', async () => {
  const calls = [];
  const discord = {
    addRole: async (g, u, r) => { calls.push(['add', g, u, r]); },
    removeRole: async (g, u, r) => { calls.push(['remove', g, u, r]); },
    kickMember: async () => { calls.push(['kick']); }, // must never be called
  };
  const env = { DISCORD_GUILD_ID: 'g1', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const actions = [
    { kind: 'discord', type: 'add-role', githubId: '120', discordUserId: 'd120', role: 'locked' },
    { kind: 'discord', type: 'remove-role', githubId: '120', discordUserId: 'd120', role: 'member' },
  ];
  await enactPlan(actions, { github: null, discord, resend: null }, env);
  assert.deepEqual(calls, [['add', 'g1', 'd120', 'rl'], ['remove', 'g1', 'd120', 'rm']]);
  assert.ok(!calls.some((c) => c[0] === 'kick'), 'the reconcile must never kick a member from the guild');
});

// ---- CLI helper: flipStatus toggles the frontmatter line both directions, leaves others intact ----
test('flipStatus flips published<->draft and leaves other frontmatter alone', () => {
  const md = ['---', 'type: post', 'status: published', 'visibility: public', '---', 'body'].join('\n');
  const drafted = flipStatus(md, 'draft');
  assert.match(drafted, /^status: draft$/m);
  assert.match(drafted, /^visibility: public$/m); // untouched
  const republished = flipStatus(drafted, 'published');
  assert.match(republished, /^status: published$/m);
  // quoted form is handled too
  const quoted = 'status: "draft"\n';
  assert.equal(flipStatus(quoted, 'published'), 'status: published\n');
});

// ---- CLI helper: parseArgs defaults to dry-run ----
test('parseArgs defaults to dry-run; --apply enacts; --dry-run wins over --apply', () => {
  assert.deepEqual(parseArgs([]), { apply: false, dryRun: true });
  assert.deepEqual(parseArgs(['--apply']), { apply: true, dryRun: false });
  assert.deepEqual(parseArgs(['--dry-run']), { apply: false, dryRun: true });
  // explicit dry-run overrides apply (safety)
  assert.deepEqual(parseArgs(['--apply', '--dry-run']), { apply: false, dryRun: true });
});

// ---- CLI helper: memberEntryFor wires Stripe customer + overrides into a planner entry ----
test('memberEntryFor derives status, resolves username via members-index, and reads metadata', () => {
  const trialStartedAt = new Date(NOW.getTime() - 10 * DAY).toISOString();
  const customer = {
    id: 'cus_1',
    email: 'paid@example.com',
    metadata: { github_id: '700', github_login: 'paula', discord_user_id: 'd700', trial_started_at: trialStartedAt },
    subscriptions: { data: [{ status: 'active', created: 1 }] },
  };
  const overrides = {
    roles: new Map(),
    bans: new Map(),
    grandfathers: new Map(),
    membersIndex: new Map([['700', 'paula-folder']]),
  };
  const entry = memberEntryFor(customer, overrides, NOW);
  assert.equal(entry.githubId, '700');
  assert.equal(entry.username, 'paula-folder'); // members-index wins over github_login
  assert.equal(entry.discordUserId, 'd700');
  assert.equal(entry.email, 'paid@example.com');
  assert.equal(entry.derived, 'paid');
  assert.equal(entry.effective.status, 'paid');
  assert.equal(entry.converted, true);
  // sanity: derive directly matches
  assert.equal(deriveStatusFromCustomer(customer, NOW), 'paid');
});

test('sow-185: memberEntryFor resolves the effective TIER override-aware (Stripe price, grandfather, default)', () => {
  const ov = (over = {}) => ({ roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map(), ...over });
  const paidCustomer = (priceId) => ({ id: 'c', metadata: { github_id: '710' }, subscriptions: { data: [{ status: 'active', created: 1, ...(priceId ? { items: { data: [{ price: { id: priceId } }] } } : {}) }] } });
  const priceMap = new Map([['price_m', 'member'], ['price_c', 'creator']]);
  // 2026-08-11: with NO price map, a paid sub now resolves to `none`, not `creator`. The empty-map default
  // was the sow-185 fail-open and has been removed. This is inert for reconcile: the ONLY consumer of a
  // member entry's tier is the Creator Discord badge (reconcile-plan.mjs:185), and that sits behind
  // shouldSyncCreatorRole, which itself requires a NON-empty price map. Verified by execution: with the role
  // id set and no price env it returns false, so nothing reads this value in reconcile's real env.
  assert.equal(memberEntryFor(paidCustomer(), ov(), NOW).tier, 'none');
  // with the map: a member-priced sub -> member, a creator-priced sub -> creator
  assert.equal(memberEntryFor(paidCustomer('price_m'), ov(), NOW, { priceTierMap: priceMap }).tier, 'member');
  assert.equal(memberEntryFor(paidCustomer('price_c'), ov(), NOW, { priceTierMap: priceMap }).tier, 'creator');
  // a grandfathered member (no sub) -> creator by default; a tier:member grant -> member (the override wins)
  const noSub = { id: 'c', metadata: { github_id: '720' } };
  assert.equal(memberEntryFor(noSub, ov({ grandfathers: new Map([['720', { github_id: '720' }]]) }), NOW, { priceTierMap: priceMap }).tier, 'creator');
  assert.equal(memberEntryFor(noSub, ov({ grandfathers: new Map([['720', { github_id: '720', tier: 'member' }]]) }), NOW, { priceTierMap: priceMap }).tier, 'member');
  // a non-paid (expired) account -> tier none
  assert.equal(memberEntryFor(noSub, ov(), NOW, { priceTierMap: priceMap }).tier, 'none');
});

test('memberEntryFor resolves the folder via repoIndex byGithubLogin (login != folder name)', () => {
  // Real-data shape: folder 'frankfolder' whose profile links.github is github.com/frank.
  const customer = { id: 'cus_2', metadata: { github_id: '701', github_login: 'frank' } };
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };
  const repoIndex = {
    byUsername: { frankfolder: { files: [] } },
    byGithubLogin: new Map([['frank', 'frankfolder']]),
    byGithubId: new Map(),
  };
  const entry = memberEntryFor(customer, overrides, NOW, { repoIndex });
  assert.equal(entry.username, 'frankfolder'); // resolved through the login -> folder map, not the raw login
  // 2026-08-11: no sub AND no trial clock now resolves 'none', not 'expired'. The assertion the test
  // actually cares about is unchanged (NOT paid, fail closed); only the word for it moved, because the trial
  // is retired and nothing expired for a member who never had anything.
  assert.equal(entry.effective.status, 'none');
});

test('memberEntryFor leaves username null when no folder resolves (fail closed, warning path)', () => {
  const customer = { id: 'cus_3', metadata: { github_id: '702', github_login: 'nobody' } };
  const overrides = { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() };
  const repoIndex = { byUsername: {}, byGithubLogin: new Map(), byGithubId: new Map() };
  const entry = memberEntryFor(customer, overrides, NOW, { repoIndex });
  assert.equal(entry.username, null);
});

// =============================================================================================
// FIX 1: authoritative, fail-closed folder resolution (login != folder name => still drafts on lapse)
// =============================================================================================

const noOverrides = () => ({ roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map() });

test('githubLoginFromUrl extracts and lowercases the trailing segment', () => {
  assert.equal(githubLoginFromUrl('https://github.com/atwellpub'), 'atwellpub');
  assert.equal(githubLoginFromUrl('https://github.com/atwellpub/'), 'atwellpub');
  assert.equal(githubLoginFromUrl('https://github.com/AtwellPub'), 'atwellpub');
  assert.equal(githubLoginFromUrl('http://github.com/foo/bar'), 'foo');
  assert.equal(githubLoginFromUrl('github.com/baz'), 'baz');
  assert.equal(githubLoginFromUrl('plainlogin'), 'plainlogin');
  assert.equal(githubLoginFromUrl(''), null);
  assert.equal(githubLoginFromUrl(null), null);
});

test('githubLoginFromProfile reads the nested links.github line', () => {
  const profile = [
    '---',
    'type: profile',
    'username: hudson',
    'status: published',
    'links:',
    '  github: "https://github.com/atwellpub"',
    '  x: "https://x.com/atwellpub"',
    '---',
    'body',
  ].join('\n');
  assert.equal(githubLoginFromProfile(profile), 'atwellpub');
});

test('resolveUsername precedence: members-index > byGithubId > byGithubLogin > case-insensitive folder', () => {
  const repoIndex = {
    byUsername: { hudson: { files: [] }, casey: { files: [] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map([['999', 'casey']]),
  };
  // 1. members-index wins outright
  const ov = noOverrides();
  ov.membersIndex.set('42', 'casey');
  assert.equal(resolveUsername('42', 'atwellpub', ov, repoIndex), 'casey');
  // 2. byGithubId
  assert.equal(resolveUsername('999', 'whatever', noOverrides(), repoIndex), 'casey');
  // 3. byGithubLogin (THE hudson/atwellpub case)
  assert.equal(resolveUsername('1', 'atwellpub', noOverrides(), repoIndex), 'hudson');
  assert.equal(resolveUsername('1', 'AtwellPub', noOverrides(), repoIndex), 'hudson'); // case-insensitive
  // 4. case-insensitive folder name match
  assert.equal(resolveUsername('1', 'Casey', noOverrides(), repoIndex), 'casey');
  // nothing resolves -> null (fail closed; triggers the warning)
  assert.equal(resolveUsername('1', 'ghost', noOverrides(), repoIndex), null);
});

test('FIX 1: a member whose login != folder name (hudson/atwellpub) still resolves, and a BAN reaches their content', () => {
  // The confirmed real-data bug: Stripe github_login is 'atwellpub' but the folder is 'hudson'. Folder
  // resolution still has to be right after sow-197, because the BAN path depends on it: an unresolvable
  // banned member is the one case that must never quietly leave content live.
  const repoIndex = {
    byUsername: { hudson: { files: [file('members/hudson/profile.md', 'published')] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map(),
  };
  const customer = { id: 'cus_h', metadata: { github_id: '5000', github_login: 'atwellpub' } };
  const entry = memberEntryFor(customer, noOverrides(), NOW, { repoIndex });
  assert.equal(entry.username, 'hudson'); // resolved despite login != folder
  assert.equal(entry.effective.status, 'none'); // no sub, no trial clock -> not paid (see the note above)

  // Plan against the SAME byUsername the production main() passes to the planner.
  // Lapsed: access changes, content does not (sow-197).
  const lapsed = planReconcile({ members: [entry], repoIndex: repoIndex.byUsername, now: NOW });
  assert.deepEqual(ofKind(lapsed, 'content'), [], 'a lapse leaves hudson\'s published profile live');

  // Banned: the same resolution now feeds the one path that DOES draft.
  const bans = new Map([['5000', { github_id: '5000' }]]);
  const bannedEntry = memberEntryFor(customer, { ...noOverrides(), bans }, NOW, { repoIndex });
  assert.equal(bannedEntry.effective.status, 'banned');
  const banned = ofKind(planReconcile({ members: [bannedEntry], repoIndex: repoIndex.byUsername, now: NOW }), 'content');
  assert.equal(banned.length, 1, 'a banned member\'s content must be drafted, not left live');
  assert.equal(banned[0].type, 'draft');
  assert.deepEqual(banned[0].files, ['members/hudson/profile.md']);
});

test('FIX 1: buildRepoIndex parses login + status from a real on-disk member folder', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-repo-'));
  const dir = path.join(tmp, 'members', 'hudson');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'profile.md'),
    ['---', 'type: profile', 'username: hudson', 'status: published', 'visibility: public', 'links:', '  github: "https://github.com/atwellpub"', '---', 'bio'].join('\n'),
  );
  const postDir = path.join(dir, 'posts', 'hello');
  fs.mkdirSync(postDir, { recursive: true });
  fs.writeFileSync(path.join(postDir, 'index.md'), ['---', 'type: post', 'status: draft', '---', 'hi'].join('\n'));

  const idx = buildRepoIndex(tmp);
  assert.ok(idx.byUsername.hudson, 'folder indexed by username');
  assert.equal(idx.byGithubLogin.get('atwellpub'), 'hudson', 'login parsed from links.github');
  // file statuses parsed
  const statuses = Object.fromEntries(idx.byUsername.hudson.files.map((f) => [f.path.split('/').slice(-1)[0] === 'profile.md' ? 'profile' : 'post', f.status]));
  assert.equal(statuses.profile, 'published');
  assert.equal(statuses.post, 'draft');
  fs.rmSync(tmp, { recursive: true, force: true });
});

// =============================================================================================
// FIX 2: Discord current-role resolution (so remove-role fires on lapse, add-role does not churn)
// =============================================================================================

test('resolveDiscordRoles returns the SET of managed roles held, and NULL when the read fails', async () => {
  const env = { DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const member = (roles) => ({ getMember: async () => ({ roles }) });
  assert.deepEqual(await resolveDiscordRoles(member(['rm', 'other']), 'g', 'u', env), ['member']);
  assert.deepEqual(await resolveDiscordRoles(member(['rt']), 'g', 'u', env), ['trial']);
  assert.deepEqual(await resolveDiscordRoles(member(['rl']), 'g', 'u', env), ['locked']);
  // a corrupted state holding two managed roles is reported in full so the planner can heal it
  assert.deepEqual(await resolveDiscordRoles(member(['rm', 'rl']), 'g', 'u', env), ['member', 'locked']);
  assert.deepEqual(await resolveDiscordRoles(member(['other']), 'g', 'u', env), [], 'read OK, holds none -> EMPTY');
  // sow-218: UNKNOWN is null, not []. Returning [] for both made the planner treat an unreadable member as
  // holding nothing, so it skipped every removal and a lapsed member kept @Member. These two lines are the
  // difference between "we know they hold nothing" and "we could not find out".
  // A null member is the 404 path (clients/discord.mjs getMember maps it): they are NOT in the guild, which
  // is KNOWN, so it stays []. Only a genuine failure is unknown. Treating 404 as unknown took a real dry run
  // from 3 planned actions to 15, every extra one destined to fail against a member who is not there.
  assert.deepEqual(await resolveDiscordRoles({ getMember: async () => null }, 'g', 'u', env), [], '404 -> not in guild -> EMPTY');
  assert.equal(await resolveDiscordRoles({ getMember: async () => { throw new Error('429'); } }, 'g', 'u', env), null, 'error -> UNKNOWN');
  // no client / no guild / no user -> []
  assert.deepEqual(await resolveDiscordRoles(null, 'g', 'u', env), []);
  assert.deepEqual(await resolveDiscordRoles(member(['rm']), null, 'u', env), []);
  assert.deepEqual(await resolveDiscordRoles(member(['rm']), 'g', null, env), []);
});

test('FIX 2: gatherMembers sets discordRoles from getMember so a lapsed member is swapped to locked', async () => {
  const customer = { id: 'c', metadata: { github_id: '6000', github_login: 'atwellpub', discord_user_id: 'd6000' } };
  const stripe = { async *listCustomers() { yield customer; } };
  const discord = { getMember: async () => ({ roles: ['rm'] }) }; // currently holds the member role
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const repoIndex = {
    byUsername: { hudson: { files: [file('members/hudson/profile.md', 'published')] } },
    byGithubLogin: new Map([['atwellpub', 'hudson']]),
    byGithubId: new Map(),
  };
  const members = await gatherMembers(stripe, noOverrides(), NOW, { repoIndex, discord, env });
  assert.equal(members.length, 1);
  assert.deepEqual(members[0].discordRoles, ['member']); // resolved from the live guild member

  const actions = planReconcile({ members, repoIndex: repoIndex.byUsername, now: NOW });
  const discordActions = ofKind(actions, 'discord');
  // lapse (expired): swap member -> locked (add locked, remove member); never a hardcoded-null churn
  assert.equal(discordActions.length, 2);
  assert.equal(discordActions.find((a) => a.type === 'add-role').role, 'locked');
  assert.equal(discordActions.find((a) => a.type === 'remove-role').role, 'member');
});

// =============================================================================================
// Override-only enumeration: grandfathered / banned members with NO Stripe customer still get their
// managed Discord role synced (gatherMembers iterates Stripe customers only and would miss them).
// =============================================================================================

test('parseDiscordUserMap parses login->id JSON, lowercases logins, ignores absent/invalid', () => {
  assert.deepEqual([...parseDiscordUserMap({}).entries()], []);
  assert.deepEqual([...parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: 'not json' }).entries()], []);
  assert.deepEqual([...parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: '[]' }).entries()], []); // array -> empty (no string keys)
  const m = parseDiscordUserMap({ DISCORD_MENTION_OVERRIDES: '{"RFilipo":"629","bomsn":"920","blank":""}' });
  assert.equal(m.get('rfilipo'), '629'); // login lowercased
  assert.equal(m.get('bomsn'), '920');
  assert.equal(m.has('blank'), false); // empty id dropped
});

test('gatherOverrideOnlyMembers: a grandfathered member with no Stripe customer gets the Member role', async () => {
  const overrides = {
    roles: new Map(),
    bans: new Map(),
    grandfathers: new Map([['225425', { github_id: '225425', login: 'rfilipo' }]]),
    membersIndex: new Map(),
  };
  const env = {
    DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl',
    DISCORD_MENTION_OVERRIDES: '{"rfilipo":"629903610582663183"}',
  };
  const discord = { getMember: async () => ({ roles: [] }) }; // in the guild, holds no managed role yet
  const members = await gatherOverrideOnlyMembers(overrides, NOW, { seen: new Set(), discord, env });
  assert.equal(members.length, 1);
  assert.equal(members[0].githubId, '225425');
  assert.equal(members[0].discordUserId, '629903610582663183'); // resolved from the override map
  assert.equal(members[0].effective.status, 'paid'); // grandfather -> paid
  assert.equal(members[0].effective.source, 'grandfather');
  assert.equal(members[0].tier, 'creator'); // sow-185: a default grandfather grant resolves to creator (was undefined pre-fix)

  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  const discordActions = ofKind(actions, 'discord');
  assert.equal(discordActions.length, 1);
  assert.equal(discordActions[0].type, 'add-role');
  assert.equal(discordActions[0].role, 'member'); // grandfathered co-op member -> the full Member role
  assert.equal(discordActions[0].discordUserId, '629903610582663183');

  // sow-185 (review fix): once the Creator role is provisioned, this override-only grandfathered creator ALSO
  // gets @Creator on top of @Member (before the fix m.tier was undefined, so @Creator was wrongly withheld).
  const withCreator = ofKind(planReconcile({ members, repoIndex: {}, now: NOW, creatorRoleEnabled: true }), 'discord');
  assert.deepEqual(withCreator.filter((a) => a.type === 'add-role').map((a) => a.role).sort(), ['creator', 'member']);
});

test('gatherOverrideOnlyMembers: skips ids already gathered from Stripe and yields no Discord action without an id', async () => {
  const overrides = {
    roles: new Map(),
    bans: new Map([['7000', { github_id: '7000', login: 'banned-guy' }]]),
    grandfathers: new Map([
      ['225425', { github_id: '225425', login: 'rfilipo' }], // already seen -> skipped
      ['9999', { github_id: '9999', login: 'no-discord' }],  // no override-map entry -> no discordUserId
    ]),
    membersIndex: new Map(),
  };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_LOCKED_ROLE_ID: 'rl', DISCORD_MENTION_OVERRIDES: '{}' };
  const discord = { getMember: async () => ({ roles: [] }) };
  const members = await gatherOverrideOnlyMembers(overrides, NOW, { seen: new Set(['225425']), discord, env });
  // rfilipo skipped (already seen); banned-guy + no-discord remain
  assert.deepEqual(members.map((m) => m.githubId).sort(), ['7000', '9999']);
  const banned = members.find((m) => m.githubId === '7000');
  assert.equal(banned.effective.status, 'banned'); // ban -> Locked target
  // No discordUserId resolves for any of them (empty map) -> the planner emits zero Discord actions.
  const actions = planReconcile({ members, repoIndex: {}, now: NOW });
  assert.equal(ofKind(actions, 'discord').length, 0);
});

// =============================================================================================
// FIX 4: targeted single-member regate from a repository_dispatch event
// =============================================================================================

test('FIX 4: targetedGithubId parses client_payload.github_id from a repository_dispatch event', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-evt-'));
  const eventPath = path.join(tmp, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ action: 'regate', client_payload: { github_id: 583231 } }));

  // wrong event name -> null
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'schedule', GITHUB_EVENT_PATH: eventPath }), null);
  // correct dispatch -> the id as a string
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: eventPath }), '583231');
  // missing path -> null (no throw)
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: path.join(tmp, 'nope.json') }), null);
  // missing payload field -> null
  fs.writeFileSync(eventPath, JSON.stringify({ client_payload: {} }));
  assert.equal(targetedGithubId({ GITHUB_EVENT_NAME: 'repository_dispatch', GITHUB_EVENT_PATH: eventPath }), null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// =============================================================================================
// FIX 5: day-87 email via Resend is the PRIMARY channel (attempted before the Discord DM)
// =============================================================================================

test('createResendClient posts the email with Bearer auth and JSON body', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'email_1' }) };
  };
  const resend = createResendClient({ apiKey: 'rk_test', fetch: fakeFetch });
  const out = await resend.sendEmail({ from: 'GBTI <hi@gbti.network>', to: 'tori@example.com', subject: 'Hi', text: 'body' });
  assert.equal(out.id, 'email_1');
  assert.equal(captured.url, 'https://api.resend.com/emails');
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers.Authorization, 'Bearer rk_test');
  assert.equal(captured.opts.headers['Content-Type'], 'application/json');
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.from, 'GBTI <hi@gbti.network>');
  assert.equal(sent.to, 'tori@example.com');
  assert.equal(sent.text, 'body');
});

test('FIX 5: enactPlan reminder sends the Resend email FIRST, then the optional Discord DM', async () => {
  const order = [];
  const resend = { sendEmail: async (args) => { order.push(['email', args]); return { id: 'e1' }; } };
  const discord = { sendDirectMessage: async (uid, content) => { order.push(['dm', uid, content]); } };
  const action = { kind: 'reminder', type: 'day-87', githubId: '400', email: 'tori@example.com', discordUserId: 'd400' };
  await enactPlan([action], { github: null, discord, resend }, { RESEND_FROM: 'GBTI <hi@gbti.network>' });
  assert.equal(order.length, 2);
  assert.equal(order[0][0], 'email'); // email is attempted BEFORE the DM
  assert.equal(order[0][1].to, 'tori@example.com');
  assert.equal(order[0][1].from, 'GBTI <hi@gbti.network>');
  assert.match(order[0][1].subject, /trial ends/i);
  assert.equal(order[1][0], 'dm');
  assert.equal(order[1][1], 'd400');
});

test('FIX 5: reminder still sends the Discord DM when no Resend client is configured', async () => {
  const order = [];
  const discord = { sendDirectMessage: async (uid) => { order.push(['dm', uid]); } };
  const action = { kind: 'reminder', type: 'day-87', githubId: '400', email: 'tori@example.com', discordUserId: 'd400' };
  await enactPlan([action], { github: null, discord, resend: null }, {});
  assert.deepEqual(order, [['dm', 'd400']]);
});

// =============================================================================================
// FIX 6: flipBranch appends a random suffix so same-second re-runs do not collide
// =============================================================================================

test('FIX 6: enactContent opens a branch (unique name), flips each file, and squash-merges', async () => {
  const created = [];
  const puts = [];
  const merges = [];
  let pullNum = 0;
  const github = {
    getRef: async () => ({ object: { sha: 'basesha' } }),
    createRef: async (branch, sha) => { created.push([branch, sha]); },
    getContent: async (p) => ({ sha: `sha-${p}`, content: Buffer.from(`---\nstatus: published\n---\n`).toString('base64') }),
    putContent: async (p, opts) => { puts.push([p, opts.branch]); },
    createPull: async (opts) => { pullNum += 1; return { number: pullNum, ...opts }; },
    mergePull: async (n, opts) => { merges.push([n, opts.method]); },
  };
  const action = {
    kind: 'content',
    type: 'draft',
    githubId: '700',
    username: 'paula',
    files: ['members/paula/profile.md', 'members/paula/posts/p/index.md'],
  };
  await enactPlan([action], { github, discord: null, resend: null }, {});

  assert.equal(created.length, 1);
  const branch = created[0][0];
  assert.match(branch, /^reconcile\/draft-700-\d{14}-[0-9a-f]{8}$/, 'branch has a random suffix (FIX 6)');
  assert.equal(created[0][1], 'basesha');
  // both files flipped on the new branch
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((p) => p[0]).sort(), ['members/paula/posts/p/index.md', 'members/paula/profile.md']);
  for (const [, b] of puts) assert.equal(b, branch);
  // squash-merged
  assert.deepEqual(merges, [[1, 'squash']]);

  // Two calls to flipBranch in the same second must differ (random suffix).
  await enactPlan([action], { github, discord: null, resend: null }, {});
  assert.notEqual(created[0][0], created[1][0]);
});

// ---- sow-198: one failed action must not abandon the rest of the plan ----
// enactPlan was the ONE step in main() with no error handling, and its loop had no per-action isolation,
// so a single throw abandoned every action queued behind it. On 2026-08-08 only one action was planned so
// nothing was lost; with several, a failed content flip would silently skip the Discord role swaps and the
// day-87 reminders after it.
test('enactPlan isolates a failing action and still enacts the ones after it', async () => {
  const github = {
    getRef: async () => ({ object: { sha: 'basesha' } }),
    createRef: async () => {},
    getContent: async (p) => ({ sha: `sha-${p}`, content: Buffer.from('---\nstatus: published\n---\n').toString('base64') }),
    putContent: async () => {},
    createPull: async () => ({ number: 1 }),
    mergePull: async () => { throw new Error('github error 405: Base branch was modified'); },
  };
  const roles = [];
  const discord = { addRole: async (g, u, r) => { roles.push(['add', r]); }, removeRole: async (g, u, r) => { roles.push(['remove', r]); } };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_LOCKED_ROLE_ID: 'rl' };

  const actions = [
    { kind: 'content', type: 'draft', githubId: '800', username: 'quinn', files: ['members/quinn/profile.md'] },
    { kind: 'discord', type: 'add-role', githubId: '800', discordUserId: 'd800', role: 'locked' },
  ];
  const { counts, failures } = await enactPlan(actions, { github, discord, resend: null }, env);

  assert.deepEqual(roles, [['add', 'rl']], 'the Discord action queued behind the failure still ran');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].action.kind, 'content');
  assert.match(failures[0].message, /405/);
  assert.deepEqual(counts, { content: 1, discord: 1 }, 'counts report what was attempted');
});

test('enactPlan reports no failures on a clean plan', async () => {
  const discord = { addRole: async () => {}, removeRole: async () => {} };
  const env = { DISCORD_GUILD_ID: 'g', DISCORD_LOCKED_ROLE_ID: 'rl' };
  const { failures } = await enactPlan(
    [{ kind: 'discord', type: 'add-role', githubId: '801', discordUserId: 'd801', role: 'locked' }],
    { github: null, discord, resend: null }, env,
  );
  assert.deepEqual(failures, []);
});

test('sow-185: shouldSyncCreatorRole gates the Content-Creator badge on a POPULATED price map, not the role id alone', () => {
  // The whole safety: with an EMPTY price map, tierForPrice runs legacy mode and resolves EVERY paid member to
  // creator, so the badge must NOT sync on the role id alone (that would stamp @Creator on everyone in the guild).
  assert.equal(shouldSyncCreatorRole({}), false);                                                          // nothing set
  assert.equal(shouldSyncCreatorRole({ DISCORD_CREATOR_ROLE_ID: '1536102140802633788' }), false);          // role id but EMPTY price map -> inert (the guard)
  assert.equal(shouldSyncCreatorRole({ STRIPE_PRICE_CREATOR_ANNUAL: 'price_c' }), false);                  // price map but no role id
  assert.equal(shouldSyncCreatorRole({ DISCORD_CREATOR_ROLE_ID: '1536102140802633788', STRIPE_PRICE_CREATOR_ANNUAL: 'price_c' }), true); // both -> sync
});

// sow-218: the fail-open this closes. A member whose Discord roles could not be read must still have every
// non-target role stripped, because "unknown" was previously indistinguishable from "holds nothing" and the
// removals were skipped entirely. In an ALLOW-based guild that left a lapsed member holding @Member, which is
// the role that actually grants access, until some later run happened to read them cleanly.
test('sow-218: an UNREADABLE member still gets every non-target role stripped', () => {
  const lapsed = {
    githubId: '900', discordUserId: 'd900', effective: { status: 'cancelled' },
    discordRoles: null, // the read failed
  };
  const actions = planReconcile({ members: [lapsed], now: new Date('2026-08-12T00:00:00Z') }).filter((a) => a.kind === 'discord');
  const removed = actions.filter((a) => a.type === 'remove-role').map((a) => a.role).sort();
  const added = actions.filter((a) => a.type === 'add-role').map((a) => a.role);
  assert.deepEqual(added, ['locked'], 'the target is still assigned');
  assert.deepEqual(removed, ['member', 'trial'], 'and BOTH other access roles are stripped despite the failed read');
});

test('sow-218: a member read as holding NOTHING emits no pointless removals', () => {
  // The optimization the null/[] split preserves: a successful read of an empty set still skips the no-op calls.
  const fresh = {
    githubId: '901', discordUserId: 'd901', effective: { status: 'cancelled' },
    discordRoles: [],
  };
  const actions = planReconcile({ members: [fresh], now: new Date('2026-08-12T00:00:00Z') }).filter((a) => a.kind === 'discord');
  assert.deepEqual(actions.filter((a) => a.type === 'remove-role'), [], 'nothing held, nothing to remove');
  assert.deepEqual(actions.filter((a) => a.type === 'add-role').map((a) => a.role), ['locked']);
});

// sow-218: pre-applying unfolded coupon grants, so run ONE sees a grant it is about to write down.
//
// The durable fold opens a PR and merges it via the API, which never touches this run's checkout. That is why
// a coupon invitee needed two daily runs: run one folded a grant it could not itself see, and only run two
// resolved them effective-paid. Until then they were not paid to the gate and not eligible for members-index
// enrollment, so the site promised Content Creator through 2027 while every publish was rejected.
// THESE TESTS BUILD THEIR OWN ROOT, and that is the fix for a red main rather than a nicety.
//
// They used to pass `root: tempRoot()`, so applyPendingCouponGrants read the LIVE
// house/grandfathered.yml, and the fixture named a REAL member (github_id 190312419, metacast). On
// 2026-08-13 the reconcile bot folded exactly that member's coupon grant into exactly that file (22d31cf,
// PR #282), which is the whole point of the fold. planCouponGrants then correctly SKIPPED the redemption
// as already granted and returned 0, and the test that asserted 1 went red on main.
//
// Nothing was wrong with the code. The test asked production data to stay still, and the feature under
// test is the thing that moves it. A temp root removes the dependency entirely.
function tempRoot({ grandfathered = 'grandfathered: []\n', coupons = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-reconcile-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'house', 'grandfathered.yml'), grandfathered, 'utf8');
  if (coupons) fs.writeFileSync(path.join(dir, 'house', 'coupons.yml'), coupons, 'utf8');
  return dir;
}

test('sow-218: an unfolded KV grant is applied to THIS run\'s overrides', async () => {
  const overrides = { grandfathers: new Map(), bans: new Map(), roles: new Map(), membersIndex: new Map() };
  const listRedemptions = async () => ({
    available: true,
    redemptions: [{ code: 'CODEABLEYEAR', githubId: '190312419', login: 'metacast', until: '2027-08-12T00:00:00.000Z' }],
  });
  const root = tempRoot({ coupons: 'coupons:\n  - code: CODEABLEYEAR\n    freeDays: 365\n    active: true\n    tier: creator\n' });
  const n = await applyPendingCouponGrants({ overrides, listRedemptions, now: new Date('2026-08-12T00:00:00Z'), root });
  assert.equal(n, 1);
  const g = overrides.grandfathers.get('190312419');
  assert.equal(g.reason, 'coupon:CODEABLEYEAR');
  assert.equal(g.until, '2027-08-12T00:00:00.000Z');
  // sow-185: the pre-applied grant names its tier from the coupon registry, so THIS run gates on the same
  // tier the durable fold is about to write down. The two callers of planCouponGrants must not disagree.
  assert.equal(g.tier, 'creator');
});

// The behaviour that broke the old test is itself worth pinning: a grant ALREADY folded into
// house/grandfathered.yml must never be pre-applied a second time.
test('sow-218: a grant already folded into grandfathered.yml is NOT re-applied', async () => {
  const overrides = { grandfathers: new Map(), bans: new Map(), roles: new Map(), membersIndex: new Map() };
  const listRedemptions = async () => ({
    available: true,
    redemptions: [{ code: 'CODEABLEYEAR', githubId: '190312419', login: 'metacast', until: '2027-08-12T00:00:00.000Z' }],
  });
  const root = tempRoot({
    grandfathered: 'grandfathered:\n  - github_id: "190312419"\n    login: metacast-entertainment\n    reason: coupon:CODEABLEYEAR\n    until: "2027-08-12T12:56:20.498Z"\n    tier: creator\n',
  });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions, now: new Date('2026-08-12T00:00:00Z'), root }), 0);
  assert.equal(overrides.grandfathers.size, 0, 'the fold is the durable record; a second apply would be a duplicate');
});

test('sow-218: an EXPIRED grant is not applied, and an empty KV is a clean no-op', async () => {
  const overrides = { grandfathers: new Map() };
  const expired = async () => ({ available: true, redemptions: [{ code: 'X', githubId: '1', until: '2020-01-01T00:00:00.000Z' }] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: expired, now: new Date('2026-08-12T00:00:00Z'), root: tempRoot() }), 0);
  assert.equal(overrides.grandfathers.size, 0);
  const empty = async () => ({ available: true, redemptions: [] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: empty, root: tempRoot() }), 0);
});

test('sow-218: a KV failure degrades to the OLD two-run behaviour rather than aborting the run', async () => {
  // Best-effort by design, exactly like the fold itself. A reconcile has content flips and role syncs to do;
  // losing the same-day optimization must never cost the rest of the run.
  const overrides = { grandfathers: new Map() };
  const boom = async () => { throw new Error('KV down'); };
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: boom, root: tempRoot() }), 0);
  const unavailable = async () => ({ available: false, reason: 'CF credentials not set' });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: unavailable, root: tempRoot() }), 0);
  // and an UNREADABLE grandfathered.yml is the same story: no throw, no grants, run continues.
  const ok = async () => ({ available: true, redemptions: [{ code: 'X', githubId: '1', until: '2027-01-01T00:00:00.000Z' }] });
  assert.equal(await applyPendingCouponGrants({ overrides, listRedemptions: ok, root: '/nonexistent' }), 0);
  assert.equal(overrides.grandfathers.size, 0);
});
