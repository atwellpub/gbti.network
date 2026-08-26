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
import { couponsFromParsed, normalizeCouponCode } from '../../membership/coupons.mjs'; // sow-231: campaign terms
import { inviteIsRedeemable, markInviteRedeemed } from '../../membership/invites.mjs'; // sow-231 Phase 2
import { readInvite, writeInvite } from './invites-store.mjs';
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

/**
 * sow-231 Phase 2: resolve a submitted code to the terms it grants.
 *
 * A code is either a CAMPAIGN code from the registry, or a per-invite code minted against a campaign. Both
 * end up as `{ coupon, invite }` where `coupon` is always the CAMPAIGN entry carrying freeDays and tier, so
 * an invite never carries its own terms and there is exactly one place to change them.
 *
 * THE CAMPAIGN IS READ FOR ITS TERMS ONLY, WITHOUT THE REDEEMABILITY GATE, AND THAT IS THE WHOLE TRAP.
 * `couponByCode` returns null for a campaign that is not currently redeemable (inactive, or past its own
 * expiresAt). Phase 4 retires the shared CODEABLEYEAR by setting `active: false`. If invites resolved their
 * terms through that helper, **the moment that flag flipped every outstanding invite would silently stop
 * working**, and those links were hand-issued to named people who were promised a year. `active: false` has
 * to mean "the shared walk-up code is closed", not "every link already sent is void".
 *
 * So the invite's OWN state machine is the control for the link (issued / revoked / expired / redeemed, all
 * checked by inviteIsRedeemable), and the campaign supplies terms regardless of its own redeemability. A
 * WALK-UP campaign code is unchanged: it still goes through couponByCode and is still refused when retired.
 *
 * Fail closed everywhere: unknown, revoked, expired or already-redeemed resolves to `{coupon:null,
 * invite:null}` and the caller proceeds as a plain signup, exactly as an unknown campaign code does today.
 */
export async function resolveRedeemable(kv, code, now = new Date()) {
  const none = { coupon: null, invite: null };
  if (!code) return none;
  const config = await readCouponsConfig(kv, now);

  // A campaign code first: the common path, and it keeps its redeemability gate.
  const campaignHit = couponByCode(config, code, now);
  if (campaignHit) return { coupon: campaignHit, invite: null };

  // Otherwise it may be an issued invite.
  const invite = await readInvite(kv, code);
  if (!invite || !inviteIsRedeemable(invite, now)) return none;

  // Terms come from the campaign the invite was minted against, read WITHOUT the redeemability gate. See
  // the note above: a retired campaign must not void links already in someone's inbox.
  const coupon = couponsFromParsed(config)?.get(normalizeCouponCode(invite.campaign)) ?? null;
  if (!coupon) return none; // the campaign was deleted outright, which IS a reason to refuse: no terms exist
  return { coupon, invite };
}

/** Validate a ?coupon= param for the signed state: the normalized code when redeemable NOW, else ''. */
export async function validateCouponParam(kv, code, now = new Date()) {
  if (!code) return '';
  const { coupon, invite } = await resolveRedeemable(kv, code, now);
  if (!coupon) return '';
  // The INVITE code is what enters the signed state, not the campaign's. It is what identifies this single
  // link at redemption, and what lands in house/grandfathered.yml as `reason: coupon:<CODE>`, which is the
  // provenance join key sow-229's roster reads.
  return invite ? invite.code : coupon.code;
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

    // sow-231 Phase 2: `code` may be a campaign code OR an issued invite. Either way the terms below come
    // from the CAMPAIGN entry, so the rest of this function is unchanged by which one arrived.
    const { coupon, invite } = await resolveRedeemable(kv, code, now);
    if (!coupon) return null;

    // THE CAP COUNTS AGAINST THE CAMPAIGN, NOT THE LINK. Keyed by invite code every invite would have a
    // count of 1 and a campaign cap of 50 would never bind however many links were issued, which is the
    // opposite of what a cap is for. The per-member `redemption:<CODE>:<githubId>` record below still uses
    // the code as submitted, because that is the provenance key.
    if (coupon.maxRedemptions !== null) {
      const count = Number(await kv.get(redemptionCountKey(coupon.code))) || 0;
      if (count >= coupon.maxRedemptions) return null;
    }

    const until = redemptionUntil(now, coupon.freeDays);
    if (!until) return null;

    // sow-185: stamp the tier the coupon conferred AT REDEMPTION TIME. The reconcile fold can already
    // resolve it from house/coupons.yml, so this is not what makes the grant explicit; it closes a narrow
    // drift window. A redemption sits in KV until the next fold, and if an admin retunes the campaign's
    // tier in between, the registry lookup would fold that member under terms they never redeemed. The
    // record is the promise; the registry is the fallback for records written before this field existed.
    // The record carries the code AS REDEEMED (the invite code when there was one), plus `campaign`.
    //
    // WHY `campaign` IS STORED. The reconcile fold resolves a grant's tier as
    // [entry.tier, record.tier, couponTier(registry, record.code)] (scripts/lib/coupon-grants.mjs). For an
    // invite code that third lookup MISSES, because invites live in KV and the registry only knows
    // campaigns, so an invite grant would have exactly one chance at its tier: the stamp on the line above.
    // Storing the campaign gives the fold a registry key it can actually resolve, restoring the fallback
    // rather than depending on a single field never being absent.
    const redeemedCode = invite ? invite.code : coupon.code;
    const record = {
      code: redeemedCode,
      campaign: coupon.code,
      redeemedAt: now.toISOString(),
      until,
      ...(coupon.tier ? { tier: coupon.tier } : {}),
      ...(login ? { login: String(login) } : {}),
    };
    await kv.put(couponGrantKey(githubId), JSON.stringify(record));
    await kv.put(redemptionKey(redeemedCode, githubId), JSON.stringify(record));
    const count = Number(await kv.get(redemptionCountKey(coupon.code))) || 0;
    const redemptionCount = count + 1; // sow-279: THIS redemption's ordinal, carried out on the grant below
    await kv.put(redemptionCountKey(coupon.code), String(redemptionCount));

    // MARK THE INVITE ONLY NOW, AFTER A GRANT WAS ACTUALLY WRITTEN. Every early return above leaves the
    // invite UNUSED on purpose: an existing grant, the post-erasure minimized lock, a hit cap and an
    // unusable `until` all mean this member received nothing, and burning a single-use link for nothing is
    // the worst outcome available. The dangerous case is not hypothetical: the signup chain calls this
    // twice (GitHub, then the deferred Discord link), and a member who redeemed a campaign code months ago
    // and then clicks an invite would otherwise spend a fresh seat and get no grant for it.
    //
    // A FAILED MARK DOES NOT UNDO THE GRANT. markInviteRedeemed is idempotent by contract, and reconcile is
    // not involved here, so the worst case is a used invite that still reads as issued: recoverable by an
    // admin, unlike a member who paid a link for nothing.
    if (invite) {
      const { next, changed } = markInviteRedeemed(invite, { githubId, login, now });
      if (changed) await writeInvite(kv, next);
    }
    // sow-279: the owner notice needs the RUNNING COUNT to make a burst legible at a glance, which
    // house/coupons.yml has required from the start. It rides on the return rather than being re-read later,
    // because it is already in hand here and a second read would be both wasteful and racier.
    //
    // NOT ATOMIC, and that is accepted rather than overlooked. The read-then-write above is the same
    // non-atomic pair that already governs maxRedemptions, so two simultaneous redemptions of one code can
    // report the same ordinal and the stored total can lag by one. For spotting an abusive BURST that is
    // immaterial: the emails still arrive one per redemption, and the count is a convenience on top of them,
    // never the thing being counted on. Do not make a cap decision from this number.
    return { ...record, redemptionCount, already: false };
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
