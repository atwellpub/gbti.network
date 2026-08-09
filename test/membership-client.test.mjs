// SOW-011: the client-side publish-eligibility (membership.mjs) + the operations.publish choke point.
// Pure, no network: the status oracle + the host reader are injected. Mirrors the gate's precedence so the
// client blocks exactly the publishes the gate would reject.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  effectiveMembership,
  canPublish,
  canStageDrafts,
  canSeeNews,
  canFollow,
  canSave,
  canBrowse,
  isBlockedFromPublishing,
  isLockedMembership,
  upgradePromptKind,
  bannedIdsFromText,
  grandfathersFromText,
  grandfatherActive,
  fetchStripeStatus,
  resolveMembership,
} from '../client/src/membership.mjs';
import { publish, getStatus, OperationError } from '../client/src/operations.mjs';

// ---- effectiveMembership precedence (ban > staff > grandfather > stripe) ----
test('effectiveMembership folds the git overrides with the gate precedence', () => {
  const roles = new Map([['10', 'admin']]);
  const banned = new Set(['20']);
  const grandfathers = new Map([['30', { github_id: '30' }]]);
  // plain Stripe statuses pass through
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'paid' }), 'paid');
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'trialing' }), 'trialing');
  assert.equal(effectiveMembership({ githubId: '1', stripeStatus: 'none' }), 'none');
  // staff is paid-equivalent even with no sub
  assert.equal(effectiveMembership({ githubId: '10', stripeStatus: 'expired', roles }), 'paid');
  // grandfather is paid-equivalent even with no sub
  assert.equal(effectiveMembership({ githubId: '30', stripeStatus: 'none', grandfathers }), 'paid');
  // a ban overrides everything (even a paid sub, even staff)
  assert.equal(effectiveMembership({ githubId: '20', stripeStatus: 'paid', banned }), 'banned');
  assert.equal(effectiveMembership({ githubId: '20', stripeStatus: 'paid', roles: new Map([['20', 'admin']]), banned }), 'banned');
  // missing oracle -> unknown
  assert.equal(effectiveMembership({ githubId: '1' }), 'unknown');
});

test('canPublish + isBlockedFromPublishing: only paid publishes; unknown is not blocked (fails open)', () => {
  assert.equal(canPublish('paid'), true);
  for (const s of ['trialing', 'expired', 'cancelled', 'none', 'banned', 'unknown']) assert.equal(canPublish(s), false);
  for (const s of ['trialing', 'expired', 'cancelled', 'none', 'banned']) assert.equal(isBlockedFromPublishing(s), true);
  assert.equal(isBlockedFromPublishing('paid'), false);
  assert.equal(isBlockedFromPublishing('unknown'), false); // unknown fails OPEN to the gate
});

test('canStageDrafts (SOW-082): trial + paid may stage drafts on their fork; free/lapsed/banned may not', () => {
  for (const s of ['paid', 'trialing']) assert.equal(canStageDrafts(s), true);
  for (const s of ['expired', 'cancelled', 'none', 'banned', 'unknown']) assert.equal(canStageDrafts(s), false);
  // staging is BROADER than publishing (trial can stage but not publish) and NARROWER than canSave (no lapsed/free)
  assert.equal(canStageDrafts('trialing') && !canPublish('trialing'), true);
  assert.equal(canSave('none') && !canStageDrafts('none'), true);
});

test('override parsers tolerate missing/garbage text and read the github_id lists', () => {
  assert.deepEqual([...bannedIdsFromText('bans:\n  - github_id: "5"\n  - 6\n')].sort(), ['5', '6']);
  assert.deepEqual([...bannedIdsFromText(null)], []);
  assert.deepEqual([...bannedIdsFromText(': not yaml :')], []);
  const g = grandfathersFromText('grandfathered:\n  - github_id: "7"\n  - github_id: "8"\n    until: "2020-01-01"\n');
  assert.ok(g.has('7'));
  assert.equal(grandfatherActive(g.get('7')), true); // no until -> active
  assert.equal(grandfatherActive(g.get('8')), false); // past until -> expired
  assert.equal(grandfatherActive(g.get('8'), new Date('2019-01-01').getTime()), true); // before until -> active
  assert.equal(grandfatherActive({ until: 'not-a-date' }), false); // unparseable -> fail closed
});

// ---- fetchStripeStatus: injected oracle, fails open on any error ----
test('fetchStripeStatus returns the oracle body ({ status, couponUntil, paidTier }), failing open on any error', async () => {
  const ok = await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'trialing' }) }) });
  assert.deepEqual(ok, { status: 'trialing', couponUntil: null, paidTier: 'none' }); // sow-185: no paidTier from the oracle -> fail-closed to 'none'
  const withUntil = await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'paid', couponUntil: '2027-07-18T00:00:00.000Z' }) }) });
  assert.deepEqual(withUntil, { status: 'paid', couponUntil: '2027-07-18T00:00:00.000Z', paidTier: 'none' });
  // sow-185: the oracle's authoritative paidTier is carried through verbatim; a non-string fails closed to 'none'.
  assert.equal((await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'paid', paidTier: 'creator' }) }) })).paidTier, 'creator');
  assert.equal((await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'paid', paidTier: 'member' }) }) })).paidTier, 'member');
  assert.equal((await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: true, json: async () => ({ status: 'paid', paidTier: 5 }) }) })).paidTier, 'none');
  assert.deepEqual(await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => ({ ok: false }) }), { status: 'unknown', couponUntil: null, paidTier: 'none' });
  assert.deepEqual(await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: async () => { throw new Error('net'); } }), { status: 'unknown', couponUntil: null, paidTier: 'none' });
  assert.deepEqual(await fetchStripeStatus({ token: '', signupBase: 'https://s' }), { status: 'unknown', couponUntil: null, paidTier: 'none' }); // no token -> no call
  assert.deepEqual(await fetchStripeStatus({ token: 't', signupBase: '' }), { status: 'unknown', couponUntil: null, paidTier: 'none' }); // no base -> no call
});

test('resolveMembership combines the oracle status with the reader overrides', async () => {
  const files = {
    'house/roles.yml': 'admins:\n  - github_id: "99"\n',
    'house/bans.yml': 'bans:\n  - github_id: "77"\n',
    'house/grandfathered.yml': 'grandfathered:\n  - github_id: "88"\n',
  };
  const readFile = (p) => files[p] ?? null;
  const fetch = async () => ({ ok: true, json: async () => ({ status: 'trialing' }) });
  // a plain trial member stays trial
  assert.deepEqual(await resolveMembership({ githubId: '1', token: 't', signupBase: 'https://s', readFile, fetch }), { stripeStatus: 'trialing', membership: 'trialing', couponUntil: null, paidTier: 'none' });
  // staff -> paid despite the trial Stripe status
  assert.equal((await resolveMembership({ githubId: '99', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'paid');
  // grandfathered -> paid
  assert.equal((await resolveMembership({ githubId: '88', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'paid');
  // banned -> banned
  assert.equal((await resolveMembership({ githubId: '77', token: 't', signupBase: 'https://s', readFile, fetch })).membership, 'banned');
});

test('sow-185: resolveMembership carries the oracle paidTier through; a ban forces it to none', async () => {
  const files = { 'house/roles.yml': '', 'house/bans.yml': 'bans:\n  - github_id: "77"\n', 'house/grandfathered.yml': '' };
  const readFile = (p) => files[p] ?? null;
  const creatorOracle = async () => ({ ok: true, json: async () => ({ status: 'paid', paidTier: 'creator' }) });
  // a paid creator carries creator through (the Worker is authoritative; the client does not re-derive the tier)
  assert.equal((await resolveMembership({ githubId: '1', token: 't', signupBase: 'https://s', readFile, fetch: creatorOracle })).paidTier, 'creator');
  // a git-banned member gets paidTier 'none' even though the oracle said creator (fail-closed; ban outranks)
  assert.equal((await resolveMembership({ githubId: '77', token: 't', signupBase: 'https://s', readFile, fetch: creatorOracle })).paidTier, 'none');
  // an older Worker that sends no paidTier -> 'none'
  const noTier = async () => ({ ok: true, json: async () => ({ status: 'paid' }) });
  assert.equal((await resolveMembership({ githubId: '1', token: 't', signupBase: 'https://s', readFile, fetch: noTier })).paidTier, 'none');
});

test('resolveMembership carries couponUntil only when the coupon grant IS the paid source', async () => {
  const until = '2027-07-01T00:00:00.000Z';
  const files = {
    'house/roles.yml': '',
    'house/bans.yml': '',
    'house/grandfathered.yml': `grandfathered:\n  - github_id: "55"\n    reason: coupon:CODEABLEYEAR\n    until: "${until}"\n  - github_id: "66"\n    reason: complimentary access\n    until: null\n`,
  };
  const readFile = (p) => files[p] ?? null;
  const oracle = (status, couponUntil = null) => async () => ({ ok: true, json: async () => ({ status, couponUntil }) });
  const now = new Date('2026-08-01T00:00:00.000Z').getTime();
  // git coupon grant + non-paid Stripe -> paid with couponUntil from the parsed grant
  const viaGit = await resolveMembership({ githubId: '55', token: 't', signupBase: 'https://s', readFile, fetch: oracle('none'), now });
  assert.deepEqual(viaGit, { stripeStatus: 'none', membership: 'paid', couponUntil: until, paidTier: 'none' });
  // the oracle value wins when present (the pre-fold-in KV window)
  const viaOracle = await resolveMembership({ githubId: '55', token: 't', signupBase: 'https://s', readFile, fetch: oracle('paid', until), now });
  assert.equal(viaOracle.couponUntil, until);
  // a REAL Stripe subscription suppresses the countdown even with a grant on file... but note the oracle
  // itself never emits couponUntil for a Stripe-paid member; simulate that contract:
  const stripePaid = await resolveMembership({ githubId: '55', token: 't', signupBase: 'https://s', readFile, fetch: oracle('paid'), now });
  assert.equal(stripePaid.couponUntil, null);
  // a non-coupon grandfather (permanent comp) has no countdown
  const comp = await resolveMembership({ githubId: '66', token: 't', signupBase: 'https://s', readFile, fetch: oracle('none'), now });
  assert.equal(comp.membership, 'paid');
  assert.equal(comp.couponUntil, null);
  // an EXPIRED grant date yields no countdown
  const late = new Date('2027-08-01T00:00:00.000Z').getTime();
  const expired = await resolveMembership({ githubId: '55', token: 't', signupBase: 'https://s', readFile, fetch: oracle('none'), now: late });
  assert.equal(expired.couponUntil, null);
});

// ---- the operations.publish choke point ----
function ctxFor(membership) {
  const repoCalls = [];
  return {
    repoCalls,
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    membership: () => membership,
    store: { get: () => 'tok' },
    getRepoClient: () => ({
      upstream: 'gbti-network/gbti.network',
      ensureFork: async () => ({ full_name: 'alice/gbti.network', owner: 'alice' }),
      getDefaultBranch: async () => 'main',
      getBranchSha: async () => 'sha',
      ensureBranch: async () => {},
      getFileSha: async () => null,
      putFile: async (r, p) => repoCalls.push(p),
      findOpenPull: async () => null,
      openPull: async () => ({ number: 7, html_url: 'u' }),
    }),
  };
}

test('publish: a trial member is blocked with membership-required BEFORE any PR is opened', async () => {
  const ctx = ctxFor('trialing');
  await assert.rejects(
    () => publish(ctx, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' }),
    (err) => {
      assert.ok(err instanceof OperationError);
      assert.equal(err.code, 'membership-required');
      assert.equal(err.details?.membership, 'trialing');
      return true;
    },
  );
  assert.deepEqual(ctx.repoCalls, [], 'no fork write / PR is attempted for a blocked member');
});

test('publish: a paid member publishes; an unknown membership fails OPEN to the gate', async () => {
  const paid = ctxFor('paid');
  const r1 = await publish(paid, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(r1.prNumber, 7);
  assert.deepEqual(paid.repoCalls, ['members/alice/posts/my-post/index.md']);

  const unknown = ctxFor('unknown'); // oracle unreachable -> do not block; the gate is the authority
  const r2 = await publish(unknown, { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(r2.prNumber, 7);
});

test('getStatus surfaces membership + canPublish for the UI notice', () => {
  assert.deepEqual(
    (() => { const s = getStatus(ctxFor('trialing')); return { membership: s.membership, canPublish: s.canPublish }; })(),
    { membership: 'trialing', canPublish: false },
  );
  const paid = getStatus(ctxFor('paid'));
  assert.equal(paid.canPublish, true);
});

// SOW-060 + SOW-077: every known signed-in status (not banned) gets all the free perks. A BANNED account keeps the
// READ perks that need no KV (browse: a static feed; AND news, opened to banned by the SOW-077 Phase 2 Worker
// read-gate) but loses the KV "basket" (save/collect/follow). canPublish stays paid.
test('free-tier predicates: known signed-in statuses get all perks; banned keeps READ (browse + news) but not the KV basket', () => {
  for (const m of ['paid', 'trialing', 'expired', 'cancelled', 'none']) {
    assert.equal(canSeeNews(m), true, `${m} sees news`);
    assert.equal(canFollow(m), true, `${m} follows`);
    assert.equal(canSave(m), true, `${m} saves`);
    assert.equal(canBrowse(m), true, `${m} browses`);
  }
  // SOW-077: a banned (community-banned) account stays a read-only user — browse AND news, but ZERO KV.
  assert.equal(canBrowse('banned'), true, 'banned may browse (static feed, no KV)');
  assert.equal(canSeeNews('banned'), true, 'banned may read news (SOW-077 P2 read-gate, no KV)');
  assert.equal(canSave('banned'), false, 'banned has no KV basket (save)');
  assert.equal(canFollow('banned'), false, 'banned has no KV basket (follow)');
  for (const m of ['unknown', undefined, null, '']) {
    assert.equal(canBrowse(m), false, `${m} browses nothing`);
    assert.equal(canSave(m), false, `${m} no KV`);
  }
});

// SOW-060 regression: opening the free perks must NOT open publishing. A free (none) member gets every perk but
// canPublish stays false; this guards against the predicate split accidentally widening canPublish. (The
// status-object WIRING regression that asserts getStatus surfaces these rides with the operations.mjs change.)
test('SOW-060 regression: a free (none) member follows + sees news + saves + browses but cannot publish', () => {
  assert.equal(canFollow('none'), true);
  assert.equal(canSeeNews('none'), true);
  assert.equal(canSave('none'), true);
  assert.equal(canBrowse('none'), true);
  assert.equal(canPublish('none'), false);
});

// SOW-077: the new-tab read-only upgrade prompt. Free 'none' -> join; lapsed expired/cancelled -> renew; an active
// member, a banned account (paying does not lift a ban), and 'unknown' (oracle down, fail open) see NO prompt.
test('upgradePromptKind: join for free, renew for lapsed, nothing for active/banned/unknown', () => {
  assert.equal(upgradePromptKind('none'), 'join');
  assert.equal(upgradePromptKind('expired'), 'renew');
  assert.equal(upgradePromptKind('cancelled'), 'renew');
  for (const m of ['paid', 'trialing', 'banned', 'unknown', undefined, null, '']) {
    assert.equal(upgradePromptKind(m), null, `${m} gets no upgrade prompt`);
  }
});

// SOW-018: the extension lock-splash predicate. Lapsed accounts lock; trial reads; paid is full; unknown fails OPEN.
test('isLockedMembership: only lapsed accounts lock the extension', () => {
  for (const m of ['expired', 'cancelled', 'none', 'banned']) assert.equal(isLockedMembership(m), true, `${m} locks`);
  for (const m of ['paid', 'trialing', 'unknown', undefined, null, '']) assert.equal(isLockedMembership(m), false, `${m} does NOT lock`);
});
