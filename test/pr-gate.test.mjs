// SOW-005 PR-gate tests. Drives the pure core evaluatePR() with fixture PR-event payloads, a fake
// Stripe client, and in-memory overrides Maps. No network, no secrets, no GitHub. Confirms the gate
// reuses decide() and fails closed.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { evaluatePR, STATUS_CONTEXT, shouldAutoClose, shouldAutoMerge, CLOSE_LABELS, CLOSE_NUDGE } from '../scripts/pr-gate.mjs';
import { buildPriceTierMap } from '../membership/tiers.mjs';

// ---- fixtures --------------------------------------------------------------

// github_id -> username folder map (house/members-index.yml shape, already parsed).
const MEMBERS_INDEX = new Map([
  ['100', 'octocat'], // paid member
  ['200', 'trialer'], // trialing member
  ['300', 'badactor'], // member who tries to escalate
  ['900', 'adminuser'], // admin
]);

// roles.yml -> github_id -> role.
const ROLES = new Map([['900', 'admin']]);

const EMPTY_BANS = new Map();
const EMPTY_GRANDFATHERS = new Map();

function overrides({ roles = ROLES, bans = EMPTY_BANS, grandfathers = EMPTY_GRANDFATHERS } = {}) {
  return { roles, bans, grandfathers, membersIndex: MEMBERS_INDEX };
}

// A fake Stripe client honoring the deriveStatus() contract: findCustomerByGithubId(id) -> customer|null.
// `customers` maps github_id -> customer object (or a function to throw).
function fakeStripe(customers) {
  return {
    async findCustomerByGithubId(githubId) {
      const entry = customers[String(githubId)];
      if (typeof entry === 'function') return entry(); // lets a fixture throw
      return entry ?? null;
    },
  };
}

// Customer shapes: an active subscription = paid; a card-less customer inside the 90-day window = trialing.
const NOW = new Date('2026-06-02T00:00:00Z');
// 2026-08-11: the paid fixture now carries a PRICE ID, and the tests pass a matching PRICE_MAP.
//
// Before, it carried neither, and these tests passed only because tierForPrice granted `creator` on an empty
// map. That default has been removed as a fail-open, and its removal made these tests deny. They were not
// asserting the gate's real behaviour; they were asserting the bug. Production passes the ids via
// pr-membership-gate.yml, so a fixture WITH a price and a map is the faithful mirror of the real gate.
const LEGACY_PRICE = 'price_legacy150';
const PRICE_MAP = buildPriceTierMap({ legacyCreatorPriceId: LEGACY_PRICE });
const paidCustomer = { id: 'cus_paid', metadata: { github_id: '100' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: LEGACY_PRICE } }] } }] } };
const trialCustomer = { id: 'cus_trial', metadata: { github_id: '200', trial_started_at: '2026-05-01T00:00:00Z' }, subscriptions: { data: [] } };

// A PR-event payload fixture (the pull_request_target event shape the gate reads).
function event({ number = 1, authorId, headSha = 'sha-' + number }) {
  return { number, pull_request: { number, user: { id: authorId }, head: { sha: headSha } } };
}

// ---- core decision matrix --------------------------------------------------

test('paid member editing only their own folder -> success + paid (auto-merge)', async () => {
  const ev = event({ authorId: 100 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/hello/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 100: paidCustomer }),
    now: NOW,
  });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'paid');
  assert.equal(d.autoMerge, true);
  assert.equal(d.status, 'paid');
});

test('trial member content PR -> failure + rejected-not-paid (publishing is paid-only)', async () => {
  const ev = event({ authorId: 200 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/trialer/profile.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 200: trialCustomer }),
    now: NOW,
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-paid');
  assert.equal(d.autoMerge, false);
  assert.equal(d.status, 'trialing');
});

test('member touching house/roles.yml -> failure + rejected-escalation', async () => {
  const ev = event({ authorId: 300 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['house/roles.yml'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 300: paidCustomer }), // paid does not matter: escalation hard-fails first
    now: NOW,
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test("member editing another member's folder with no owner approval -> held contribution", async () => {
  const ev = event({ authorId: 300 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/steal/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 300: paidCustomer }),
    now: NOW,
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'contribution-pending-owner');
  assert.equal(d.contributionTarget, 'octocat');
});

test('contribution merges when the folder owner approved and is paid', async () => {
  const ev = event({ authorId: 300 });
  // resolveOwner is what main() builds from the reviews API + owner Stripe status; here it is faked.
  const resolveOwner = async (owner) => {
    assert.equal(owner, 'octocat');
    return { ownerApproved: true, ownerPaid: true, ownerTier: 'creator' }; // sow-185: owner is a Content Creator (folder can host a post)
  };
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/improve/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 300: paidCustomer }),
    now: NOW,
    resolveOwner,
  });
  assert.equal(d.check, 'pass');
  assert.equal(d.label, 'contribution-accepted');
  assert.equal(d.autoMerge, false);
});

test('contribution stays held when the owner approved but is not paid', async () => {
  const ev = event({ authorId: 300 });
  const resolveOwner = async () => ({ ownerApproved: true, ownerPaid: false });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/improve/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 300: paidCustomer }),
    now: NOW,
    resolveOwner,
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'contribution-pending-owner');
});

test('admin disabling another member (status flip) -> success', async () => {
  const ev = event({ authorId: 900 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/hello/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({}), // admin has no Stripe customer; membership-exempt
    now: NOW,
  });
  assert.equal(d.check, 'pass');
  // Cross-folder change by a privileged author falls to admin review (auto-merge off).
  assert.equal(d.label, 'admin-review');
  assert.equal(d.autoMerge, false);
  assert.equal(d.role, 'admin');
});

test('admin editing only their OWN folder -> success + auto-merge (staff own-folder content)', async () => {
  const ev = event({ authorId: 900 });
  const paths = ['members/adminuser/posts/hello/index.md'];
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths,
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({}), // admin has no Stripe customer; staff is paid-equivalent
    now: NOW,
  });
  assert.equal(d.check, 'pass');
  assert.equal(d.autoMerge, true); // own-folder staff content is auto-merge eligible
  assert.equal(d.role, 'admin');
  assert.equal(shouldAutoMerge(d, paths), true); // ...and the actuator fires for it
});

test('Stripe lookup throws -> failure (fail closed, treated as unpaid)', async () => {
  const ev = event({ authorId: 100 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/hello/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 100: () => { throw new Error('stripe 503'); } }),
    now: NOW,
  });
  // A known member whose Stripe lookup errors folds to status 'none', which reads as not-a-member.
  // The merge is correctly blocked; main() will NOT auto-close because the lookup was unhealthy.
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-a-member');
  assert.equal(d.status, 'none');
});

// ---- additional fail-closed / override coverage ----------------------------

test('banned author -> failure + banned, overriding paid status', async () => {
  const ev = event({ authorId: 100 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/hello/index.md'],
    overrides: overrides({ bans: new Map([['100', { github_id: '100' }]]) }),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({ 100: paidCustomer }),
    now: NOW,
  });
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'banned');
});

test('grandfathered author (tierless -> member per owner Q15) publishing content -> rejected-not-creator, still effective-paid', async () => {
  const ev = event({ authorId: 100 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/profile.md'],
    overrides: overrides({ grandfathers: new Map([['100', { github_id: '100' }]]) }),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({}), // no customer; grandfather still confers effective-paid, but the tier is now member
    now: NOW,
  });
  // owner Q15 2026-08-18: a tierless grandfather now resolves to member, below the Content Creator floor a
  // profile (public presence) requires, so the publish gate rejects it. This is the lost-publish consequence.
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-creator');
  assert.equal(d.status, 'paid'); // the grandfather still confers effective-paid; only the TIER dropped
});

test('unmapped author (no folder, no customer) -> rejected-not-a-member, never default-open', async () => {
  const ev = event({ authorId: 555 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/someoneelse/posts/x/index.md'],
    overrides: overrides(),
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({}),
    now: NOW,
  });
  // A visitor with no customer is not a member; the members-only gate rejects before anything else.
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-not-a-member');
});

test('shouldAutoClose closes a non-member OR a non-paid trial content PR, only on a healthy Stripe lookup', () => {
  assert.equal(shouldAutoClose('rejected-not-a-member', true), true);
  assert.equal(shouldAutoClose('rejected-not-a-member', false), false); // outage: never close
  assert.equal(shouldAutoClose('rejected-not-paid', true), true); // trial publish attempt: closed with an upgrade nudge
  assert.equal(shouldAutoClose('rejected-not-paid', false), false); // outage: never close
  assert.equal(shouldAutoClose('contribution-pending-owner', true), false); // a held PAID contribution is never closed
  assert.equal(shouldAutoClose('paid', true), false);
});

test('shouldAutoMerge: a passing own-folder member PR auto-merges; a protected-path or non-pass PR never does', () => {
  const ownFolder = ['members/alice/posts/hello/index.md', 'members/alice/_enc/hello-body.enc'];
  // passing own-folder paid/admin content -> auto-merge
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true }, ownFolder), true);
  // defense-in-depth: autoMerge flagged but a path escapes members/ -> NEVER machine-merge (protected paths must be reviewed)
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true }, ['members/alice/profile.md', 'house/roles.yml']), false);
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true }, ['.github/workflows/x.yml']), false);
  // not flagged for auto-merge (a held contribution, a rejected trial) -> never
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: false }, ownFolder), false);
  // a failing gate never auto-merges, even if autoMerge were somehow set
  assert.equal(shouldAutoMerge({ check: 'fail', autoMerge: true }, ownFolder), false);
  // empty / missing paths -> never (cannot prove own-folder)
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true }, []), false);
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true }, undefined), false);
  // SOW-108: a superadmin-automerge decision fires on ANY path, including house/** + Tier S
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true, label: 'superadmin-automerge' }, ['house/quotes.yml']), true);
  assert.equal(shouldAutoMerge({ check: 'pass', autoMerge: true, label: 'superadmin-automerge' }, ['house/roles.yml', 'CODEOWNERS']), true);
  // ...but only when the gate actually passed with autoMerge set (the label alone never merges a failing PR)
  assert.equal(shouldAutoMerge({ check: 'fail', autoMerge: true, label: 'superadmin-automerge' }, ['house/quotes.yml']), false);
});

test('CLOSE_NUDGE distinguishes the non-member sign-up nudge from the trial upgrade nudge', () => {
  for (const label of CLOSE_LABELS) assert.ok(CLOSE_NUDGE[label], `a nudge exists for ${label}`);
  assert.match(CLOSE_NUDGE['rejected-not-a-member'], /sign up/i);
  assert.match(CLOSE_NUDGE['rejected-not-paid'], /your own fork/i); // reassures the trial member nothing is lost
  // SOW-075: both nudges name the fork (publishing is paid-only; the draft is safe), and NEITHER may tell the
  // author to "reopen" the closed PR (post-upgrade the client opens a FRESH PR from the fork-staged drafts).
  assert.match(CLOSE_NUDGE['rejected-not-a-member'], /your own fork/i);
  for (const label of ['rejected-not-a-member', 'rejected-not-paid']) {
    assert.doesNotMatch(CLOSE_NUDGE[label], /reopen/i, `${label} must not say "reopen"`);
    assert.match(CLOSE_NUDGE[label], /paid member/i, `${label} states publishing is paid-only`);
  }
});

test('bot author (botId) is treated as admin and is membership-exempt', async () => {
  const ev = event({ authorId: 4242 });
  const d = await evaluatePR({
    author: ev.pull_request.user.id,
    paths: ['members/octocat/posts/hello/index.md'],
    overrides: overrides({ roles: new Map() }), // bot not even in roles.yml here
    priceTierMap: PRICE_MAP,
    stripe: fakeStripe({}),
    botId: 4242,
    now: NOW,
  });
  assert.equal(d.check, 'pass');
  assert.equal(d.role, 'member'); // raw role is member; isBot promotes it inside decide()
});

// ---- exported constant -----------------------------------------------------

test('the status check context is the branch-protection required check name', () => {
  assert.equal(STATUS_CONTEXT, 'membership-gate');
});
