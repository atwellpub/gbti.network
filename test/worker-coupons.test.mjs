// SOW-119: coupon redemption at signup (workers/signup/coupons.mjs) + the runSignup coupon path + the
// membership-status fast-path. No network, no secrets: in-memory KV/Stripe/Discord fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  readCouponsConfig,
  validateCouponParam,
  redeemCoupon,
  readCouponGrant,
  couponGrantKey,
} from '../workers/signup/coupons.mjs';
import { redemptionKey, redemptionCountKey } from '../membership/coupons.mjs';
import { couponLockKey, COUPON_LOCK_VALUE } from '../membership/coupon-lock.mjs'; // sow-212
import { runSignup } from '../workers/signup/signup.mjs';
import { membershipStatus } from '../workers/signup/membership-status.mjs';

const NOW = new Date('2026-07-15T12:00:00.000Z');

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

// sow-185: the mirror carries each coupon's tier. CAPPED deliberately names none, standing in for a record
// written before the field existed.
const MIRROR = JSON.stringify({
  generatedAt: NOW.toISOString(),
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', note: '', maxRedemptions: null, expiresAt: null },
    { code: 'CAPPED', freeDays: 30, active: true, note: '', maxRedemptions: 1, expiresAt: null },
  ],
});

test('readCouponsConfig honors the freshness guard', async () => {
  const fresh = fakeKv({ 'coupons:config': MIRROR });
  assert.ok(await readCouponsConfig(fresh, NOW));
  const stale = fakeKv({
    'coupons:config': JSON.stringify({ generatedAt: '2026-07-01T00:00:00.000Z', coupons: [] }),
  });
  assert.equal(await readCouponsConfig(stale, NOW), null); // > 48h old
  assert.equal(await readCouponsConfig(fakeKv(), NOW), null); // absent
});

test('validateCouponParam returns the normalized code only when redeemable', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  assert.equal(await validateCouponParam(kv, ' codeableyear ', NOW), 'CODEABLEYEAR');
  assert.equal(await validateCouponParam(kv, 'UNKNOWN', NOW), '');
  assert.equal(await validateCouponParam(kv, '', NOW), '');
});

test('redeemCoupon writes the grant, the per-code record, and the counter', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const r = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  assert.equal(r.already, false);
  assert.equal(r.until, '2027-07-15T12:00:00.000Z');
  assert.ok(kv.store.has(couponGrantKey('42')));
  assert.ok(kv.store.has(redemptionKey('CODEABLEYEAR', '42')));
  assert.equal(kv.store.get(redemptionCountKey('CODEABLEYEAR')), '1');
});

// sow-185: the record is the PROMISE. The reconcile fold can resolve the tier from house/coupons.yml, so
// this is not what makes a grant explicit; it pins what the coupon conferred at the moment it was redeemed,
// so retuning a live campaign cannot fold a pending redemption under terms the member never accepted.
test('redeemCoupon stamps the coupon tier into both KV records, and omits it when the coupon names none', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const r = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', login: 'newbie', now: NOW });
  assert.equal(r.tier, 'creator');
  assert.equal(JSON.parse(kv.store.get(couponGrantKey('42'))).tier, 'creator', 'the fast-path grant carries it');
  assert.equal(JSON.parse(kv.store.get(redemptionKey('CODEABLEYEAR', '42'))).tier, 'creator', 'and so does the record the fold reads');

  // A coupon naming no tier writes no tier: the fold falls back to the registry rather than to a guess.
  const bare = fakeKv({ 'coupons:config': MIRROR });
  const b = await redeemCoupon({ kv: bare, code: 'CAPPED', githubId: '43', now: NOW });
  assert.equal(b.tier, undefined);
  assert.equal('tier' in JSON.parse(bare.store.get(redemptionKey('CAPPED', '43'))), false);
});

test('redeemCoupon is idempotent per github_id (one coupon per member, ever)', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  const again = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW });
  assert.equal(again.already, true);
  assert.equal(kv.store.get(redemptionCountKey('CODEABLEYEAR')), '1'); // counter did not move
  const other = await redeemCoupon({ kv, code: 'CAPPED', githubId: '42', now: NOW });
  assert.equal(other.already, true); // the existing grant wins; no second coupon
  assert.equal(kv.store.has(redemptionKey('CAPPED', '42')), false);
});

// sow-212: after a right-to-erasure the raw-id grant is replaced by a keyed hash of the github_id, because
// the owner ruled the one-per-member lock survives erasure while the identifying record does not. If the
// redemption path did not consult that hash, the lock would be silently unenforced for exactly the accounts
// that were erased, which is the abuse the ruling exists to prevent.
test('redeemCoupon REFUSES a member holding only the minimized (post-erasure) lock', async () => {
  const SALT = 's3cret-test-salt';
  const lockKey = await couponLockKey(SALT, '42');
  const kv = fakeKv({ 'coupons:config': MIRROR, [lockKey]: COUPON_LOCK_VALUE });

  const r = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW, lockSecret: SALT });
  assert.equal(r, null, 'no redemption: the erased account cannot use the coupon again');
  assert.equal(kv.store.has(couponGrantKey('42')), false, 'no new grant was written');
  assert.equal(kv.store.has(redemptionKey('CODEABLEYEAR', '42')), false);
  assert.equal(kv.store.get(redemptionCountKey('CODEABLEYEAR')), undefined, 'the shared counter did not move');

  // A DIFFERENT member is unaffected by someone else's lock.
  const other = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '43', now: NOW, lockSecret: SALT });
  assert.equal(other.already, false, 'an unlocked member still redeems normally');
});

test('the minimized lock is only consulted when a salt is configured', async () => {
  // Without the salt the Worker cannot compute the key, so it cannot enforce the lock. That is the same
  // fail-closed pairing as the erasure side, which declines to delete the raw record without a salt: either
  // both halves have the secret or the raw-id lock stays in place doing the job.
  const SALT = 's3cret-test-salt';
  const lockKey = await couponLockKey(SALT, '42');
  const kv = fakeKv({ 'coupons:config': MIRROR, [lockKey]: COUPON_LOCK_VALUE });
  const r = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '42', now: NOW }); // no lockSecret
  assert.equal(r.already, false, 'redeems, because the lock key is not computable');
});

test('redeemCoupon enforces maxRedemptions and fails closed on unknowns', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  assert.ok(await redeemCoupon({ kv, code: 'CAPPED', githubId: '1', now: NOW }));
  assert.equal(await redeemCoupon({ kv, code: 'CAPPED', githubId: '2', now: NOW }), null); // cap hit
  assert.equal(await redeemCoupon({ kv, code: 'UNKNOWN', githubId: '3', now: NOW }), null);
  assert.equal(await redeemCoupon({ kv: null, code: 'CODEABLEYEAR', githubId: '4', now: NOW }), null);
});

test('readCouponGrant honors the window and fails closed on junk', async () => {
  const kv = fakeKv({
    [couponGrantKey('42')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
    [couponGrantKey('99')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: '2025-01-01T00:00:00.000Z', until: '2026-01-01T00:00:00.000Z' }),
    [couponGrantKey('66')]: JSON.stringify({ code: 'X', until: 'garbage' }),
  });
  assert.equal((await readCouponGrant(kv, '42', NOW))?.code, 'CODEABLEYEAR');
  assert.equal(await readCouponGrant(kv, '99', NOW), null); // expired
  assert.equal(await readCouponGrant(kv, '66', NOW), null); // malformed until
  assert.equal(await readCouponGrant(kv, '77', NOW), null); // absent
});

function fakeStripeCreate() {
  const created = [];
  return {
    created,
    async searchCustomerByGithubId() { return null; },
    async createCustomer(body, idem) { created.push({ body, idem }); return { id: 'cus_test1' }; },
    async updateCustomer() { throw new Error('should not update on create path'); },
  };
}
const fakeDiscord = { async addGuildMember() {}, async addRole() {} };

test('runSignup redeems a coupon for a new customer and reports it', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const out = await runSignup({
    identity: { githubId: '4242', githubLogin: 'octo', discordUserId: null, email: 'o@example.com', discordAccessToken: null },
    stripe: fakeStripeCreate(),
    discord: fakeDiscord,
    kv,
    config: { trialRoleId: 'r', guildId: 'g' },
    refCode: '',
    via: '',
    touchSession: '',
    coupon: 'CODEABLEYEAR',
    now: NOW,
  });
  assert.equal(out.couponApplied, true);
  assert.equal(out.couponUntil, '2027-07-15T12:00:00.000Z');
  assert.ok(kv.store.has(couponGrantKey('4242')));
});

// --- The trial retirement must not touch the owner's 1-year invites (2026-08-11) ---------------------------
// "trialing is completely retired now, EXCEPT for who we manually give 1-year off invites to like Codeable
// experts." Those invites are coupons, not trials: they resolve to effective PAID through the coupon grant
// and then the house/grandfathered.yml fold, on a completely separate axis from the trial clock. This is the
// single most important test in the retirement, because it is the owner's stated exception.
test('a coupon signup grants a full year and mints NO trial clock', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const stripe = fakeStripeCreate();
  const out = await runSignup({
    identity: { githubId: '4244', githubLogin: 'codeable-expert', discordUserId: null, email: 'e@example.com', discordAccessToken: null },
    stripe,
    discord: fakeDiscord,
    kv,
    config: { trialRoleId: 'r', guildId: 'g' },
    refCode: '', via: '', touchSession: '',
    coupon: 'CODEABLEYEAR',
    now: NOW,
  });

  // The invite still works, unchanged: a full free year recorded as the grant the fold reads.
  assert.equal(out.couponApplied, true);
  assert.equal(out.couponUntil, '2027-07-15T12:00:00.000Z');
  assert.ok(kv.store.has(couponGrantKey('4244')));

  // And the retirement holds even here: no trial clock is minted, so this member is never `trialing`.
  const md = stripe.created[0].body.metadata;
  assert.equal(md.trial_started_at, undefined, 'the trial is retired: no clock, even on the invite path');
  assert.equal(md.coupon, 'CODEABLEYEAR', 'the arrival record survives');
});

test('an ordinary new signup mints NO trial clock (the retirement, at the one tap)', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const stripe = fakeStripeCreate();
  await runSignup({
    identity: { githubId: '4245', githubLogin: 'plain', discordUserId: null, email: null, discordAccessToken: null },
    stripe,
    discord: fakeDiscord,
    kv,
    config: { trialRoleId: 'r', guildId: 'g' },
    refCode: '', via: '', touchSession: '', coupon: '',
    now: NOW,
  });
  const md = stripe.created[0].body.metadata;
  assert.equal(md.trial_started_at, undefined);
  assert.equal(md.github_id, '4245', 'the rest of the metadata is untouched');
});

test('runSignup with no coupon reports couponApplied false and writes no grant', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const out = await runSignup({
    identity: { githubId: '4243', githubLogin: 'octo2', discordUserId: null, email: null, discordAccessToken: null },
    stripe: fakeStripeCreate(),
    discord: fakeDiscord,
    kv,
    config: {},
    now: NOW,
  });
  assert.equal(out.couponApplied, false);
  assert.equal(kv.store.has(couponGrantKey('4243')), false);
});

test('runSignup records the coupon in new-customer metadata', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const stripe = fakeStripeCreate();
  await runSignup({
    identity: { githubId: '4244', githubLogin: 'octo3', discordUserId: null, email: null, discordAccessToken: null },
    stripe,
    discord: fakeDiscord,
    kv,
    config: {},
    coupon: 'CODEABLEYEAR',
    now: NOW,
  });
  assert.equal(stripe.created[0].body.metadata.coupon, 'CODEABLEYEAR');
});

test('membership-status reports paid for a fresh coupon grant (Stripe says none)', async () => {
  const kv = fakeKv({
    [couponGrantKey('777')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
  });
  const env = { STRIPE_SECRET_KEY: 'sk_test', SIGNUP_KV: kv };
  const request = new Request('https://signup.example/membership/status', { headers: { Authorization: 'Bearer tok' } });
  const r = await membershipStatus(request, env, {
    fetchImpl: async () => { throw new Error('no network'); },
    makeStripe: () => ({ async searchCustomerByGithubId() { throw new Error('stripe down'); } }),
    fetchUser: async () => ({ githubId: 777, githubLogin: 'couponer' }),
    now: NOW,
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'paid');
});

test('membership-status emits couponUntil for a KV grant, a mirror grant, and never for Stripe-paid', async () => {
  const until = '2027-07-15T12:00:00.000Z';
  const overridesMirror = (grand) => JSON.stringify({
    generatedAt: NOW.toISOString(), roles: {}, bans: { bans: [] }, grandfathered: { grandfathered: grand },
  });
  const base = (kv, stripe) => membershipStatus(
    new Request('https://signup.example/membership/status', { headers: { Authorization: 'Bearer tok' } }),
    { STRIPE_SECRET_KEY: 'sk_test', SIGNUP_KV: kv },
    {
      fetchImpl: async () => { throw new Error('no network'); },
      makeStripe: () => stripe,
      fetchUser: async () => ({ githubId: 777, githubLogin: 'couponer' }),
      now: NOW,
    },
  );
  const stripeNone = { async searchCustomerByGithubId() { throw new Error('none'); } };

  // KV fast-path grant -> paid + couponUntil
  const kvGrant = fakeKv({ [couponGrantKey('777')]: JSON.stringify({ code: 'CODEABLEYEAR', redeemedAt: NOW.toISOString(), until }) });
  const a = await base(kvGrant, stripeNone);
  assert.equal(a.body.status, 'paid');
  assert.equal(a.body.couponUntil, until);

  // No KV record, folded-in mirror grant with a coupon: reason -> paid comes from the CLIENT overrides
  // fold, but the ORACLE still reports the until (status itself stays non-paid here: Stripe none)
  const kvMirror = fakeKv({ 'overrides:mirror': overridesMirror([{ github_id: '777', reason: 'coupon:CODEABLEYEAR', until }]) });
  const b = await base(kvMirror, stripeNone);
  assert.equal(b.body.couponUntil, until);

  // A non-coupon grandfather entry emits nothing
  const kvComp = fakeKv({ 'overrides:mirror': overridesMirror([{ github_id: '777', reason: 'complimentary access', until: null }]) });
  const c = await base(kvComp, stripeNone);
  assert.equal(c.body.couponUntil, null);

  // An expired mirror grant emits nothing
  const kvExpired = fakeKv({ 'overrides:mirror': overridesMirror([{ github_id: '777', reason: 'coupon:CODEABLEYEAR', until: '2026-01-01T00:00:00.000Z' }]) });
  const d = await base(kvExpired, stripeNone);
  assert.equal(d.body.couponUntil, null);
});
