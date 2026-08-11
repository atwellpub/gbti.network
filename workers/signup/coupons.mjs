// SOW-119: coupon redemption at signup. Codes are validated against the reconcile-written KV mirror
// `coupons:config` (freshness-guarded like the overrides mirror), and a successful redemption writes:
//   coupon-grant:<githubId>              { code, redeemedAt, until }   the fast-path grant + idempotency lock
//   redemption:<CODE>:<githubId>         the same record, keyed per code for usage listings
//   redemptions:<CODE>                   a per-code counter (maxRedemptions enforcement)
// Everything FAILS CLOSED: a stale/absent mirror, an unknown/inactive/expired code, a hit cap, or any KV
// error means NO redemption and the signup proceeds as a normal trial. One coupon per github_id, ever
// (the grant record is the lock); a second code is ignored.
//
// The daily reconcile folds redemptions into house/grandfathered.yml as until-bounded grants (the durable
// record); readCouponGrant below is what keeps the member effective-paid in the window before that lands.

import {
  couponByCode,
  redemptionUntil,
  redemptionKey,
  redemptionCountKey,
  COUPONS_MIRROR_KEY,
} from '../../membership/coupons.mjs';
import { couponLockKey } from '../../membership/coupon-lock.mjs'; // sow-212: the post-erasure minimized lock
// The same 48h freshness bound the overrides mirror uses (a local constant, not an import from
// membership-content: that module imports THIS one for the fast-path grant, and a cycle helps nobody).
const MAX_COUPONS_CONFIG_AGE_MS = 48 * 60 * 60 * 1000;

export const COUPON_GRANT_PREFIX = 'coupon-grant:';
export const couponGrantKey = (githubId) => `${COUPON_GRANT_PREFIX}${String(githubId)}`;

/** Read the coupons:config mirror, freshness-guarded (stale/absent -> null, fail closed). */
export async function readCouponsConfig(kv, now = new Date()) {
  try {
    const mirror = await kv?.get(COUPONS_MIRROR_KEY, 'json');
    if (!mirror || !mirror.generatedAt) return null;
    const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_COUPONS_CONFIG_AGE_MS) return null;
    return mirror;
  } catch {
    return null;
  }
}

/** Validate a ?coupon= param for the signed state: the normalized code when redeemable NOW, else ''. */
export async function validateCouponParam(kv, code, now = new Date()) {
  if (!code) return '';
  const config = await readCouponsConfig(kv, now);
  return couponByCode(config, code, now)?.code ?? '';
}

/**
 * Redeem `code` for `githubId`. Returns { code, redeemedAt, until, already } on success (already = an
 * existing grant was found, nothing new written), or null when no redemption happened (fail closed).
 */
export async function redeemCoupon({ kv, code, githubId, login = null, now = new Date(), lockSecret = null } = {}) {
  if (!kv || !code || !githubId) return null;
  try {
    // One coupon per member, ever: an existing grant is the idempotency lock (retries, GitHub-then-Discord
    // re-runs of the signup chain, or a second code later all land here).
    const existing = await kv.get(couponGrantKey(githubId), 'json');
    if (existing?.until) return { ...existing, already: true };

    // The MINIMIZED lock (sow-212). After a right-to-erasure the raw-id grant is replaced by a keyed hash of
    // the github_id, because the owner ruled the one-per-member lock survives erasure while the identifying
    // record does not. Without this check the lock would be silently unenforced for exactly those accounts,
    // which is the abuse the ruling exists to prevent. Returns null: no redemption, and signup continues.
    if (lockSecret) {
      const lockKey = await couponLockKey(lockSecret, githubId);
      if (lockKey && (await kv.get(lockKey))) return null;
    }

    const config = await readCouponsConfig(kv, now);
    const coupon = couponByCode(config, code, now);
    if (!coupon) return null;

    if (coupon.maxRedemptions !== null) {
      const count = Number(await kv.get(redemptionCountKey(coupon.code))) || 0;
      if (count >= coupon.maxRedemptions) return null;
    }

    const until = redemptionUntil(now, coupon.freeDays);
    if (!until) return null;

    const record = { code: coupon.code, redeemedAt: now.toISOString(), until, ...(login ? { login: String(login) } : {}) };
    await kv.put(couponGrantKey(githubId), JSON.stringify(record));
    await kv.put(redemptionKey(coupon.code, githubId), JSON.stringify(record));
    const count = Number(await kv.get(redemptionCountKey(coupon.code))) || 0;
    await kv.put(redemptionCountKey(coupon.code), String(count + 1));
    return { ...record, already: false };
  } catch {
    return null; // a KV hiccup never breaks signup
  }
}

/** The fast-path grant: { code, until } while the redemption is still inside its window, else null. */
export async function readCouponGrant(kv, githubId, now = new Date()) {
  try {
    const grant = await kv?.get(couponGrantKey(githubId), 'json');
    if (!grant?.until) return null;
    const until = new Date(grant.until);
    if (Number.isNaN(until.getTime())) return null; // fail closed on a malformed record
    return now.getTime() < until.getTime() ? grant : null;
  } catch {
    return null;
  }
}
