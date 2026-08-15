// SOW-011: the signup Worker's /membership/status oracle. Verifies the bearer GitHub token is required and
// verified, and the Stripe-derived status is returned. Injected fetchUser + Stripe client: no network, no secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipStatus } from '../workers/signup/membership-status.mjs';
import { signSession } from '../workers/signup/session.mjs'; // sow-158 Phase 1b: mint a website session cookie
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs'; // sow-185: the overrides-mirror KV key

const req = (auth) => new Request('https://signup.gbti.network/membership/status', { headers: auth ? { Authorization: auth } : {} });
const ENV = { STRIPE_SECRET_KEY: 'rk_test' };

const paidCustomer = { id: 'cus_1', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } };

test('requires a bearer token', async () => {
  assert.equal((await membershipStatus(req(null), ENV)).status, 401);
  assert.equal((await membershipStatus(req('Basic xyz'), ENV)).status, 401);
});

test('401 when the GitHub token cannot be verified', async () => {
  const r = await membershipStatus(req('Bearer bad'), ENV, { fetchUser: async () => { throw new Error('401'); } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'unauthorized');
});

test('verifies the token -> github_id and returns the Stripe-derived status (canCurate false with no mirror)', async () => {
  const r = await membershipStatus(req('Bearer good'), ENV, {
    fetchUser: async () => ({ githubId: '1', githubLogin: 'alice' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
  });
  assert.equal(r.status, 200);
  // No SIGNUP_KV on ENV -> readCanCurate fails closed to false + no overrides mirror, so effectiveStatus == status
  // and role defaults to 'member'; the Stripe-derived status itself is unaffected. (sow-158: effectiveStatus + role
  // are additive fields the static site reads.)
  // sow-185: paidTier fails closed to 'none' with NO fresh mirror (the gate DENIES creator on an absent mirror,
  // so the oracle must not surface it either), even for a Stripe-paid member.
  assert.deepEqual(r.body, { ok: true, github_id: '1', login: 'alice', status: 'paid', effectiveStatus: 'paid', role: 'member', canCurate: false, couponUntil: null, paidTier: 'none' });
});

test('sow-158: folds staff into effectiveStatus + returns the role (a superadmin with NO Stripe sub reads as paid)', async () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const mirror = {
    generatedAt: new Date(now.getTime() - 60_000).toISOString(),
    bans: { bans: [] },
    roles: { superadmins: [{ github_id: '5' }], admins: [], moderators: [], curators: [] },
    grandfathered: { grandfathered: [] },
  };
  const env = { STRIPE_SECRET_KEY: 'rk_test', SIGNUP_KV: { get: async () => mirror } };
  const r = await membershipStatus(req('Bearer good'), env, {
    fetchUser: async () => ({ githubId: '5', githubLogin: 'sam' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => null }), // no Stripe sub -> Stripe status 'none'
    now,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'none', 'the raw Stripe-derived status stays none (the extension folds its own overrides)');
  assert.equal(r.body.effectiveStatus, 'paid', 'staff fold: ban>staff>grandfather>Stripe makes a superadmin paid-equivalent');
  assert.equal(r.body.role, 'superadmin', 'the resolved role lets the site reveal Admin tools on the cookie session');
  assert.equal(r.body.paidTier, 'creator', 'sow-185: staff resolves to the creator tier (resolveEffectiveTier staff -> creator)');
});

test('SOW-046 C: canCurate is true for a roles.yml curator (read from the fresh KV overrides mirror)', async () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const mirror = {
    generatedAt: new Date(now.getTime() - 60_000).toISOString(),
    roles: { superadmins: [], admins: [], moderators: [], curators: [{ github_id: '7' }] },
  };
  const env = { STRIPE_SECRET_KEY: 'rk_test', SIGNUP_KV: { get: async () => mirror } };
  // a curator
  const r = await membershipStatus(req('Bearer good'), env, {
    fetchUser: async () => ({ githubId: '7', githubLogin: 'cara' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
    now,
  });
  assert.equal(r.body.canCurate, true);
  // a plain member with the same fresh mirror is not a curator
  const r2 = await membershipStatus(req('Bearer good'), env, {
    fetchUser: async () => ({ githubId: '9', githubLogin: 'dan' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
    now,
  });
  assert.equal(r2.body.canCurate, false);
});

test('fails closed to none when the member has no Stripe customer', async () => {
  const r = await membershipStatus(req('Bearer good'), ENV, {
    fetchUser: async () => ({ githubId: '2', githubLogin: 'bob' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => null }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'none');
});

test('500 when Stripe is not configured', async () => {
  const r = await membershipStatus(req('Bearer good'), {}, { fetchUser: async () => ({ githubId: '1', githubLogin: 'a' }) });
  assert.equal(r.status, 500);
});

test('sow-158 Phase 1b: accepts the website session cookie and makes NO GitHub /user call', async () => {
  const SESSION_SECRET = 'status-cookie-secret';
  const session = await signSession({ githubId: '1', githubLogin: 'alice' }, SESSION_SECRET);
  const reqCookie = new Request('https://signup.gbti.network/membership/status', { headers: { Cookie: 'gbti_session=' + session } });
  const r = await membershipStatus(reqCookie, { STRIPE_SECRET_KEY: 'rk_test', SESSION_SECRET }, {
    fetchUser: async () => { throw new Error('the cookie path must not call GitHub /user'); }, // proves no round-trip
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.github_id, '1');
  assert.equal(r.body.status, 'paid');
});

test('sow-158 Phase 1b: an unsigned/absent cookie and no bearer fails closed (401)', async () => {
  const r = await membershipStatus(req(null), { STRIPE_SECRET_KEY: 'rk_test', SESSION_SECRET: 'x' });
  assert.equal(r.status, 401);
});

// sow-185: the paidTier matrix. The oracle must resolve the SAME tier the gate (authorizeCreator / resolveEffective)
// would, from the price map + the override-aware resolveEffectiveTier, and FAIL CLOSED to 'none'.
const PRICE_ENV = { STRIPE_PRICE_MEMBER_ANNUAL: 'price_ma', STRIPE_PRICE_CREATOR_ANNUAL: 'price_ca' };
const NOW = new Date('2026-08-08T00:00:00Z');
const freshMirror = (o = {}) => ({
  generatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
  bans: { bans: o.bans ?? [] },
  roles: { superadmins: o.superadmins ?? [], admins: [], moderators: [], curators: [] },
  grandfathered: { grandfathered: o.grandfathered ?? [] },
});
const subWithPrice = (priceId) => ({ id: 'cus_t', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: priceId } }] } }] } });
const kvOf = (mirror, coupon = null) => ({ get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : coupon) });
const tierOf = async ({ mirror = freshMirror(), coupon = null, customer = null, id = '1' } = {}) => {
  const r = await membershipStatus(req('Bearer good'), { STRIPE_SECRET_KEY: 'rk_test', SIGNUP_KV: kvOf(mirror, coupon), ...PRICE_ENV }, {
    fetchUser: async () => ({ githubId: id, githubLogin: 'alice' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => customer }),
    now: NOW,
  });
  return r.body.paidTier;
};

test('paidTier: a creator-priced Stripe subscription resolves to creator', async () => {
  assert.equal(await tierOf({ customer: subWithPrice('price_ca') }), 'creator');
});
test('paidTier: a member-priced Stripe subscription resolves to member (the $5 axis is live once mapped)', async () => {
  assert.equal(await tierOf({ customer: subWithPrice('price_ma') }), 'member');
});
test('paidTier: a non-paid member (fresh mirror, no sub) resolves to none', async () => {
  assert.equal(await tierOf({ customer: null }), 'none');
});
test('paidTier: a grandfather grant confers creator by default; an explicit tier:member confers member', async () => {
  assert.equal(await tierOf({ mirror: freshMirror({ grandfathered: [{ github_id: '1' }] }) }), 'creator');
  assert.equal(await tierOf({ mirror: freshMirror({ grandfathered: [{ github_id: '1', tier: 'member' }] }) }), 'member');
});
test('paidTier: a fresh TIERLESS coupon grant (legacy) falls back to creator', async () => {
  const coupon = { until: new Date(NOW.getTime() + 86_400_000).toISOString() };
  assert.equal(await tierOf({ coupon, customer: null }), 'creator');
});
test('paidTier: a MEMBER-tier coupon grant confers member, not creator (sow-142; LINKEDINCONNECT is member)', async () => {
  const coupon = { until: new Date(NOW.getTime() + 86_400_000).toISOString(), tier: 'member' };
  assert.equal(await tierOf({ coupon, customer: null }), 'member');
});
test('paidTier: a BAN outranks everything -> none, even with a creator sub OR a coupon', async () => {
  assert.equal(await tierOf({ mirror: freshMirror({ bans: [{ github_id: '1' }] }), customer: subWithPrice('price_ca') }), 'none');
  const coupon = { until: new Date(NOW.getTime() + 86_400_000).toISOString() };
  assert.equal(await tierOf({ mirror: freshMirror({ bans: [{ github_id: '1' }] }), coupon, customer: null }), 'none');
});
test('paidTier: fails closed to none when the mirror is STALE (the gate denies creator then too)', async () => {
  const stale = freshMirror(); stale.generatedAt = new Date(NOW.getTime() - 1000 * 60 * 60 * 72).toISOString();
  assert.equal(await tierOf({ mirror: stale, customer: subWithPrice('price_ca') }), 'none');
});
