// sow-231 Phase 2: redeeming an ISSUED INVITE, not just a campaign code.
//
// Each test here pins one of the five traps identified in planning. They are not general coverage of
// redemption (test/worker-coupons.test.mjs has that); they are the specific ways this feature goes wrong,
// written down so a later refactor that reintroduces one fails loudly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRedeemable, redeemCoupon, couponGrantKey } from '../workers/signup/coupons.mjs';
import { newInvite, inviteKey, inviteState } from '../membership/invites.mjs';
import { redemptionKey, redemptionCountKey, COUPONS_MIRROR_KEY } from '../membership/coupons.mjs';

const NOW = new Date('2026-08-16T12:00:00.000Z');

/** KV double. Coupon config is seeded as the mirror the Worker actually reads. */
function fakeKv({ coupons = [], invites = [], extra = {} } = {}) {
  const store = new Map(Object.entries(extra));
  store.set(COUPONS_MIRROR_KEY, JSON.stringify({ generatedAt: NOW.toISOString(), coupons }));
  for (const inv of invites) store.set(inviteKey(inv.code), JSON.stringify(inv));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

const CAMPAIGN = { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', maxRedemptions: null, expiresAt: null };
const invite = (over = {}) => ({ ...newInvite({ campaign: 'CODEABLEYEAR', code: 'CODEABLE7F3Q', now: NOW }), ...over });

// ---------------------------------------------------------------------------
// TRAP 1: a retired campaign must not void invites already sent
// ---------------------------------------------------------------------------

test('an invite still redeems after its campaign is RETIRED (active: false)', async () => {
  // The trap that would have done real damage. couponByCode returns null for a non-redeemable campaign, and
  // Phase 4 retires CODEABLEYEAR by setting active:false. Resolving invite TERMS through that helper would
  // silently void every outstanding link the moment the flag flipped, and those links were hand-issued to
  // named people who were promised a year. `active: false` closes the WALK-UP code, not the invites.
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, active: false }], invites: [invite()] });
  const { coupon, invite: inv } = await resolveRedeemable(kv, 'CODEABLE7F3Q', NOW);
  assert.ok(coupon, 'the invite still resolves to its campaign terms');
  assert.equal(coupon.tier, 'creator');
  assert.equal(inv.code, 'CODEABLE7F3Q');
});

test('the retired campaign code ITSELF is still refused, which is the point of retiring it', async () => {
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, active: false }], invites: [invite()] });
  const { coupon } = await resolveRedeemable(kv, 'CODEABLEYEAR', NOW);
  assert.equal(coupon, null, 'a walk-up redemption of the shared code is closed');
});

test('an invite whose campaign was DELETED outright resolves to nothing', async () => {
  // Distinct from retired: with no registry entry there are no terms to grant, so refusing is the only
  // honest answer. Fails closed to a plain signup.
  const kv = fakeKv({ coupons: [], invites: [invite()] });
  assert.deepEqual(await resolveRedeemable(kv, 'CODEABLE7F3Q', NOW), { coupon: null, invite: null });
});

test('a revoked, expired or already-redeemed invite resolves to nothing', async () => {
  const cases = [
    ['revoked', invite({ revokedAt: NOW.toISOString(), revokedBy: '1' })],
    ['expired', invite({ expiresAt: '2026-01-01T00:00:00.000Z' })],
    ['redeemed', invite({ redeemedAt: NOW.toISOString(), redeemedBy: '999' })],
  ];
  for (const [label, inv] of cases) {
    const kv = fakeKv({ coupons: [CAMPAIGN], invites: [inv] });
    const { coupon } = await resolveRedeemable(kv, inv.code, NOW);
    assert.equal(coupon, null, `${label} must not resolve`);
  }
});

// ---------------------------------------------------------------------------
// TRAP 2: never burn an invite when no grant was written
// ---------------------------------------------------------------------------

test('a member who ALREADY holds a grant does not burn the invite', async () => {
  // The realistic loss. Someone redeemed a campaign code months ago, then clicks an invite link. The
  // one-coupon-per-member lock refuses them, correctly, and the seat must NOT be spent for nothing.
  const existing = { code: 'OTHER', until: '2027-01-01T00:00:00.000Z' };
  const kv = fakeKv({
    coupons: [CAMPAIGN], invites: [invite()],
    extra: { [couponGrantKey('12345')]: JSON.stringify(existing) },
  });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', now: NOW });
  assert.equal(out.already, true, 'the existing grant is returned');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, null, 'the invite is untouched');
  assert.equal(inviteState(after, NOW), 'issued');
});

test('the signup chain redeeming TWICE marks the invite once and keeps the same grant', async () => {
  // runSignup calls redeemCoupon on the GitHub hop and again on the deferred Discord link.
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()] });
  const first = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', login: 'octocat', now: NOW });
  const second = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', login: 'octocat', now: NOW });
  assert.equal(first.already, false);
  assert.equal(second.already, true);
  assert.equal(Number(kv.store.get(redemptionCountKey('CODEABLEYEAR'))), 1, 'counted once, not twice');
  const after = JSON.parse(kv.store.get(inviteKey('CODEABLE7F3Q')));
  assert.equal(after.redeemedBy, '12345');
});

// ---------------------------------------------------------------------------
// TRAP 3: the cap counts against the CAMPAIGN, not the link
// ---------------------------------------------------------------------------

test('a campaign cap binds across MANY issued invites', async () => {
  // Keyed by invite code every link would have a count of 1 and a cap of 2 would never bind, which is the
  // opposite of what a cap is for.
  const invites = ['CODEABLEAAA', 'CODEABLEBBB', 'CODEABLECCC'].map((code) => invite({ code }));
  const kv = fakeKv({ coupons: [{ ...CAMPAIGN, maxRedemptions: 2 }], invites });
  const a = await redeemCoupon({ kv, code: 'CODEABLEAAA', githubId: '1', now: NOW });
  const b = await redeemCoupon({ kv, code: 'CODEABLEBBB', githubId: '2', now: NOW });
  const c = await redeemCoupon({ kv, code: 'CODEABLECCC', githubId: '3', now: NOW });
  assert.ok(a && b, 'the first two are within the cap');
  assert.equal(c, null, 'the third is refused by the CAMPAIGN cap');
  const third = JSON.parse(kv.store.get(inviteKey('CODEABLECCC')));
  assert.equal(third.redeemedBy, null, 'and the refused link is not burned');
});

// ---------------------------------------------------------------------------
// TRAP 4: the record carries the campaign so the fold can resolve a tier
// ---------------------------------------------------------------------------

test('the redemption record keys on the INVITE code and also names its campaign', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN], invites: [invite()] });
  const out = await redeemCoupon({ kv, code: 'CODEABLE7F3Q', githubId: '12345', now: NOW });
  assert.equal(out.code, 'CODEABLE7F3Q', 'provenance: the roster joins on the code actually used');
  assert.equal(out.campaign, 'CODEABLEYEAR', 'the fold needs a registry key it can resolve');
  assert.equal(out.tier, 'creator');
  assert.ok(kv.store.has(redemptionKey('CODEABLE7F3Q', '12345')), 'the per-member record uses the invite code');
});

// ---------------------------------------------------------------------------
// Unchanged behaviour: a plain campaign redemption
// ---------------------------------------------------------------------------

test('a campaign code still redeems exactly as before, with campaign == code', async () => {
  const kv = fakeKv({ coupons: [CAMPAIGN] });
  const out = await redeemCoupon({ kv, code: 'CODEABLEYEAR', githubId: '77', now: NOW });
  assert.equal(out.code, 'CODEABLEYEAR');
  assert.equal(out.campaign, 'CODEABLEYEAR');
  assert.equal(out.tier, 'creator');
});
