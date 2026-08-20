// SOW-119: the pure coupon-pool edit core + the Worker admin coupon endpoints. No network, no fs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addCouponEdit, updateCouponEdit, CouponEditError } from '../membership/coupon-edits.mjs';
import { membershipCouponUsage } from '../workers/signup/membership-coupons-admin.mjs';

const CTX = { actor: { githubId: '2002207', login: 'atwellpub' }, now: new Date('2026-07-15T12:00:00.000Z') };
// sow-185: the shipped shape now names a tier on every active coupon.
const POOL = { coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', note: '', maxRedemptions: null, expiresAt: null }] };

test('addCouponEdit adds a normalized coupon and rejects dups + junk', () => {
  const r = addCouponEdit(POOL, { code: ' summer25 ', freeDays: 90, note: 'Summer promo' }, CTX);
  assert.equal(r.changed, true);
  assert.equal(r.next.coupons.length, 2);
  assert.deepEqual(r.next.coupons[1], { code: 'SUMMER25', freeDays: 90, active: true, tier: 'member', note: 'Summer promo', maxRedemptions: null, expiresAt: null });
  assert.equal(r.audit.action, 'coupon-add');
  assert.throws(() => addCouponEdit(POOL, { code: 'codeableyear', freeDays: 30 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'bad code', freeDays: 30 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'OK', freeDays: 0 }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'OKOK', freeDays: 30, maxRedemptions: 0 }, CTX), CouponEditError);
});

// sow-185: an added coupon is `active: true`, and validateCoupons rejects an active coupon naming no tier,
// so the admin path must WRITE one or it would hand the admin a PR that fails CI.
test('addCouponEdit always writes a tier: the default is recorded as a value, not left to grantTier', () => {
  // `creator` on purpose: it must DIFFER from DEFAULT_COUPON_TIER, or this passes whether the explicit
  // value is honored or silently ignored in favour of the default.
  const explicit = addCouponEdit(POOL, { code: 'CREATORONLY', freeDays: 30, tier: 'creator' }, CTX);
  assert.equal(explicit.next.coupons[1].tier, 'creator', 'an explicit tier is honored');
  assert.equal(explicit.audit.detail.tier, 'creator', 'and recorded in the audit');

  const defaulted = addCouponEdit(POOL, { code: 'NOTIERGIVEN', freeDays: 30 }, CTX);
  assert.equal(defaulted.next.coupons[1].tier, 'member', 'the default is WRITTEN INTO THE FILE');

  assert.throws(() => addCouponEdit(POOL, { code: 'JUNKTIER', freeDays: 30, tier: 'creater' }, CTX), CouponEditError);
  assert.throws(() => addCouponEdit(POOL, { code: 'NONETIER', freeDays: 30, tier: 'none' }, CTX), CouponEditError);
});

test('updateCouponEdit patches fields, is idempotent, and validates', () => {
  const r = updateCouponEdit(POOL, { code: 'codeableyear', patch: { active: false, freeDays: 180 } }, CTX);
  assert.equal(r.changed, true);
  assert.equal(r.next.coupons[0].active, false);
  assert.equal(r.next.coupons[0].freeDays, 180);
  const same = updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: { active: true } }, CTX);
  assert.equal(same.changed, false); // already active
  assert.throws(() => updateCouponEdit(POOL, { code: 'NOPE', patch: { active: false } }, CTX), CouponEditError);
  assert.throws(() => updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: {} }, CTX), CouponEditError);
});

test('updateCouponEdit patches the tier and heals a legacy active coupon that names none', () => {
  const down = updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: { tier: 'member' } }, CTX);
  assert.equal(down.changed, true);
  assert.equal(down.next.coupons[0].tier, 'member');
  assert.throws(() => updateCouponEdit(POOL, { code: 'CODEABLEYEAR', patch: { tier: 'nonsense' } }, CTX), CouponEditError);

  // A HAND-WRITTEN legacy entry can be active with no tier. Editing it must not produce a file CI rejects,
  // and the admin UI has no field to escape that dead end with, so the edit heals it and says so.
  const legacy = { coupons: [{ code: 'LEGACY', freeDays: 30, active: true }] };
  const healed = updateCouponEdit(legacy, { code: 'LEGACY', patch: { note: 'touched' } }, CTX);
  assert.equal(healed.changed, true);
  assert.equal(healed.next.coupons[0].tier, 'member');
  assert.equal(healed.audit.detail.tierDefaulted, true, 'the heal is visible in the audit, not silent');

  // But an EMPTY patch still throws rather than becoming a silent tier write: the heal runs after the guard.
  assert.throws(() => updateCouponEdit(legacy, { code: 'LEGACY', patch: {} }, CTX), CouponEditError);

  // Deactivating a tierless legacy coupon leaves it tierless: an inactive coupon hands nothing out.
  const off = updateCouponEdit(legacy, { code: 'LEGACY', patch: { active: false } }, CTX);
  assert.equal(off.next.coupons[0].tier, undefined);
});

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

const NOW = new Date('2026-07-15T12:00:00.000Z');
const MIRROR = JSON.stringify({ generatedAt: NOW.toISOString(), coupons: [{ code: 'CODEABLEYEAR', freeDays: 365, active: true, maxRedemptions: null, expiresAt: null }] });
const okAuth = async () => ({ ok: true, githubId: '2002207' });
const noAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const req = (body) => new Request('https://x/y', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('membershipCouponUsage denies before reading and aggregates counts', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'redemption:CODEABLEYEAR:42': JSON.stringify({ code: 'CODEABLEYEAR', login: 'octo', redeemedAt: NOW.toISOString(), until: '2027-07-15T12:00:00.000Z' }),
    'redemptions:CODEABLEYEAR': '1',
  });
  const denied = await membershipCouponUsage(new Request('https://x/y'), { SIGNUP_KV: kv }, { authorize: noAuth });
  assert.equal(denied.status, 403);

  const r = await membershipCouponUsage(new Request('https://x/y'), { SIGNUP_KV: kv }, { authorize: okAuth, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.usage.CODEABLEYEAR.count, 1);
  assert.equal(r.body.usage.CODEABLEYEAR.redemptions[0].login, 'octo');
});

