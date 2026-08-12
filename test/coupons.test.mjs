// SOW-119: the coupon registry core (membership/coupons.mjs). Pure, no network, no fs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeCouponCode,
  couponsFromParsed,
  couponByCode,
  couponIsRedeemable,
  redemptionUntil,
  redemptionKey,
  redemptionCountKey,
  validateCoupons,
  toCouponsMirror,
  couponTier,
} from '../membership/coupons.mjs';

// sow-185: every ACTIVE coupon names its tier, matching the shipped house/coupons.yml shape. RETIRED is
// deliberately left tierless: an inactive coupon hands nothing out, so the rule does not reach it.
const POOL = {
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', note: 'Codeable', maxRedemptions: null, expiresAt: null },
    { code: 'halfyear', freeDays: 182, active: true, tier: 'member' },
    { code: 'RETIRED', freeDays: 30, active: false },
    { code: 'CAPPED', freeDays: 30, active: true, tier: 'creator', maxRedemptions: 2 },
    { code: 'EXPIRED', freeDays: 30, active: true, tier: 'creator', expiresAt: '2020-01-01T00:00:00.000Z' },
  ],
};

test('normalizeCouponCode trims and uppercases', () => {
  assert.equal(normalizeCouponCode('  codeableyear '), 'CODEABLEYEAR');
  assert.equal(normalizeCouponCode(null), '');
});

test('couponsFromParsed normalizes, skips malformed, first write wins on dup', () => {
  const map = couponsFromParsed({
    coupons: [
      { code: 'GOOD', freeDays: 10, active: true },
      { code: 'good', freeDays: 99, active: true }, // dup after normalization: ignored
      { code: 'bad code!', freeDays: 10, active: true }, // invalid chars
      { code: 'NODAYS', freeDays: 0, active: true }, // invalid freeDays
      { code: 'FLOAT', freeDays: 1.5, active: true },
      { code: 'NEGCAP', freeDays: 10, active: true, maxRedemptions: -1 },
    ],
  });
  assert.deepEqual([...map.keys()], ['GOOD']);
  assert.equal(map.get('GOOD').freeDays, 10);
});

test('couponByCode resolves case-insensitively and fails closed', () => {
  const now = new Date('2026-07-15T00:00:00Z');
  assert.equal(couponByCode(POOL, 'codeableyear', now)?.code, 'CODEABLEYEAR');
  assert.equal(couponByCode(POOL, 'HALFYEAR', now)?.freeDays, 182);
  assert.equal(couponByCode(POOL, 'RETIRED', now), null); // inactive
  assert.equal(couponByCode(POOL, 'EXPIRED', now), null); // past expiresAt
  assert.equal(couponByCode(POOL, 'UNKNOWN', now), null);
  assert.equal(couponByCode(null, 'CODEABLEYEAR', now), null);
});

test('couponIsRedeemable fails closed on an unparseable expiresAt', () => {
  assert.equal(couponIsRedeemable({ code: 'X', freeDays: 10, active: true, expiresAt: 'not-a-date' }), false);
  assert.equal(couponIsRedeemable({ code: 'X', freeDays: 10, active: true, expiresAt: null }), true);
});

test('redemptionUntil adds freeDays in UTC and fails closed on junk', () => {
  assert.equal(redemptionUntil(new Date('2026-07-15T08:00:00.000Z'), 365), '2027-07-15T08:00:00.000Z');
  assert.equal(redemptionUntil(new Date('2026-07-15T08:00:00.000Z'), 0), null);
  assert.equal(redemptionUntil('garbage', 10), null);
});

test('KV key helpers normalize the code', () => {
  assert.equal(redemptionKey('codeableyear', '1367750'), 'redemption:CODEABLEYEAR:1367750');
  assert.equal(redemptionCountKey('codeableyear'), 'redemptions:CODEABLEYEAR');
});

test('validateCoupons flags structural problems and accepts the shipped file shape', () => {
  assert.deepEqual(validateCoupons(POOL), []);
  assert.deepEqual(validateCoupons(null), []);
  const errs = validateCoupons({
    coupons: [
      { code: 'x!', freeDays: 0, active: 'yes', maxRedemptions: 0, expiresAt: 'junk' },
      { code: 'DUP', freeDays: 5, active: true },
      { code: 'dup', freeDays: 5, active: true },
    ],
  });
  assert.ok(errs.some((e) => e.includes('code must be')));
  assert.ok(errs.some((e) => e.includes('freeDays')));
  assert.ok(errs.some((e) => e.includes('active')));
  assert.ok(errs.some((e) => e.includes('maxRedemptions')));
  assert.ok(errs.some((e) => e.includes('expiresAt')));
  assert.ok(errs.some((e) => e.includes('duplicate coupon code DUP')));
  assert.deepEqual(validateCoupons({ coupons: 'nope' }), ['coupons.yml: `coupons` must be a list']);
});

// sow-185: the owner's "TIER IS EXPLICIT, NOT INHERITED" ruling, enforced in CI rather than restated in a
// comment. A live campaign must name what it hands out.
test('validateCoupons: an ACTIVE coupon must name its tier, and a named tier must be a real paid tier', () => {
  const missing = validateCoupons({ coupons: [{ code: 'NOTIER', freeDays: 30, active: true }] });
  assert.ok(missing.some((e) => e.includes('must name the tier it confers')), 'an active tierless coupon is rejected');

  // An INACTIVE coupon hands nothing out, so it is not held to naming one.
  assert.deepEqual(validateCoupons({ coupons: [{ code: 'NOTIER', freeDays: 30, active: false }] }), []);

  for (const tier of ['creator', 'member']) {
    assert.deepEqual(validateCoupons({ coupons: [{ code: 'OKAY', freeDays: 30, active: true, tier }] }), [], `${tier} is accepted`);
  }

  // `none` is not a GRANT tier: a grant is a paid comp, so free is "no grant" rather than a tier of none.
  for (const bad of ['none', 'creater', 'CREATOR', true, 7]) {
    const errs = validateCoupons({ coupons: [{ code: 'BAD', freeDays: 30, active: true, tier: bad }] });
    assert.ok(errs.some((e) => e.includes('tier must be one of')), `rejects tier ${JSON.stringify(bad)}`);
  }
});

// sow-185: a typo must cost the EXPLICITNESS, never produce a wrong grant. An unrecognized tier normalizes
// to null, which the fold reads as "names no tier" and leaves the grant exactly as it folded pre-sow-185.
test('couponsFromParsed + couponTier: only a real paid tier survives normalization', () => {
  const parsed = {
    coupons: [
      { code: 'CREATORONE', freeDays: 30, active: true, tier: 'creator' },
      { code: 'MEMBERONE', freeDays: 30, active: true, tier: 'member' },
      { code: 'TYPO', freeDays: 30, active: true, tier: 'creater' },
      { code: 'NONETIER', freeDays: 30, active: true, tier: 'none' },
      { code: 'BARE', freeDays: 30, active: true },
    ],
  };
  assert.equal(couponTier(parsed, 'creatorone'), 'creator', 'case-insensitive lookup');
  assert.equal(couponTier(parsed, 'MEMBERONE'), 'member');
  assert.equal(couponTier(parsed, 'TYPO'), null, 'a typo yields no tier rather than a wrong one');
  assert.equal(couponTier(parsed, 'NONETIER'), null, 'none is not a grant tier');
  assert.equal(couponTier(parsed, 'BARE'), null);
  assert.equal(couponTier(parsed, 'NOSUCHCODE'), null);
  assert.equal(couponTier(null, 'CREATORONE'), null, 'an unreadable registry yields no tier, never a guess');

  // An inactive or expired coupon still resolves: a grant is folded from a redemption that ALREADY
  // happened, so switching a campaign off must not silently downgrade a fold still in flight.
  const off = { coupons: [{ code: 'OFF', freeDays: 30, active: false, tier: 'creator' }] };
  assert.equal(couponTier(off, 'OFF'), 'creator');
});

test('toCouponsMirror carries only normalized coupons + generatedAt', () => {
  const m = toCouponsMirror(POOL, new Date('2026-07-15T00:00:00Z'));
  assert.equal(m.generatedAt, '2026-07-15T00:00:00.000Z');
  assert.equal(m.coupons.length, 5);
  assert.ok(m.coupons.every((c) => /^[A-Z0-9]+$/.test(c.code)));
});
