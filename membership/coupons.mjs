// SOW-119: the coupon registry core. Pure over the PARSED house/coupons.yml ({ coupons: [{ code, freeDays,
// active, tier, note?, maxRedemptions?, expiresAt? }] }), like the other membership cores: callers (the CI
// validator, the signup Worker via the coupons:config KV mirror, the admin edit core) parse or fetch the
// yaml/mirror and pass the object. Everything FAILS CLOSED: a malformed entry never grants time, an unknown
// or inactive or expired code resolves to null, and a bad freeDays yields no `until`.
// Node-free (no fs / no yaml).
//
// sow-185 / owner ruling 2026-08-11: TIER IS EXPLICIT, NOT INHERITED. A coupon NAMES the paid tier it
// confers, and the reconcile fold writes that name into the grandfather grant. `grantTier`'s creator
// default still exists, but it is there to preserve LEGACY flat grants, not to decide what a live campaign
// hands out. Leaning on it means the tier is silently re-decided on every future redemption, and a later
// change to that default would move everyone already folded. See house/coupons.yml for the ruling itself.

import { PAID_GRANT_TIERS } from './tier-gate.mjs'; // sow-185: the paid tiers a grant (and so a coupon) may name

/** Normalize a coupon code for lookup: trim + uppercase (codes are case-insensitive at entry). */
export function normalizeCouponCode(code) {
  return String(code ?? '').trim().toUpperCase();
}

/** Coupon codes are 3-32 chars of A-Z 0-9 (post-normalization). Anything else is rejected everywhere. */
export const COUPON_CODE_RE = /^[A-Z0-9]{3,32}$/;

/** One parsed entry -> a normalized coupon object, or null when structurally unusable (fail closed). */
function normalizeEntry(e) {
  const code = normalizeCouponCode(e?.code);
  const freeDays = Number(e?.freeDays);
  if (!COUPON_CODE_RE.test(code)) return null;
  if (!Number.isInteger(freeDays) || freeDays < 1 || freeDays > 3650) return null;
  const maxRedemptions = e?.maxRedemptions === undefined || e?.maxRedemptions === null
    ? null
    : Number(e.maxRedemptions);
  if (maxRedemptions !== null && (!Number.isInteger(maxRedemptions) || maxRedemptions < 1)) return null;
  return {
    code,
    freeDays,
    active: e?.active === true,
    // sow-185: only a real PAID tier survives. An absent, misspelled or `none` tier normalizes to null,
    // which the fold reads as "this coupon names no tier" and leaves the grant tierless, exactly as it
    // behaved before this field existed. A typo therefore costs the explicitness, never a wrong grant.
    tier: PAID_GRANT_TIERS.includes(e?.tier) ? e.tier : null,
    note: typeof e?.note === 'string' ? e.note : '',
    maxRedemptions,
    expiresAt: typeof e?.expiresAt === 'string' && e.expiresAt ? e.expiresAt : null,
  };
}

/** Parsed yaml/mirror -> Map(code -> coupon), skipping malformed entries (first write wins on a dup). */
export function couponsFromParsed(parsed) {
  const out = new Map();
  const list = Array.isArray(parsed?.coupons) ? parsed.coupons : [];
  for (const e of list) {
    const c = normalizeEntry(e);
    if (c && !out.has(c.code)) out.set(c.code, c);
  }
  return out;
}

/** True when the coupon itself is redeemable at `now` (active and not past its own expiresAt). */
export function couponIsRedeemable(coupon, now = new Date()) {
  if (!coupon || coupon.active !== true) return false;
  if (!coupon.expiresAt) return true;
  const exp = new Date(coupon.expiresAt);
  if (Number.isNaN(exp.getTime())) return false; // FAIL CLOSED: unparseable expiry disables the coupon
  return now.getTime() < exp.getTime();
}

/** Resolve a redeemable coupon by (case-insensitive) code, or null. */
export function couponByCode(parsed, code, now = new Date()) {
  const c = couponsFromParsed(parsed).get(normalizeCouponCode(code));
  return c && couponIsRedeemable(c, now) ? c : null;
}

/**
 * sow-185: the paid tier a coupon confers, or null when it names none. The ONE place the reconcile fold
 * and any other reader agree on how a code resolves to a tier. Deliberately does NOT fall back to creator:
 * that fallback lives in grantTier, downstream, and duplicating it here would reintroduce the implicitness
 * this field exists to remove.
 *
 * Reads the registry rather than the coupon's own redeemability, on purpose. A grant is folded from a
 * redemption that ALREADY happened, so a coupon since deactivated or expired must still resolve to the
 * tier it was redeemed under; gating this on couponIsRedeemable would silently downgrade a pending fold
 * the moment a campaign is switched off.
 */
export function couponTier(parsed, code) {
  return couponsFromParsed(parsed).get(normalizeCouponCode(code))?.tier ?? null;
}

/** The grant end date for a redemption at `now`: now + freeDays, as an ISO string (UTC). */
export function redemptionUntil(now, freeDays) {
  const days = Number(freeDays);
  if (!Number.isInteger(days) || days < 1) return null; // fail closed
  const t = new Date(now instanceof Date ? now.getTime() : new Date(now).getTime());
  if (Number.isNaN(t.getTime())) return null;
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString();
}

/** The KV key the coupons:config mirror lives under (written by reconcile + sync-overrides-mirror). */
export const COUPONS_MIRROR_KEY = 'coupons:config';

/** The KV keys for a redemption record and a per-code counter (one place, so every reader agrees). */
export function redemptionKey(code, githubId) {
  return `redemption:${normalizeCouponCode(code)}:${String(githubId)}`;
}
export function redemptionCountKey(code) {
  return `redemptions:${normalizeCouponCode(code)}`;
}
/** Structural validation for CI. An absent config (null) is valid. Returns an array of error strings. */
export function validateCoupons(parsed, { file = 'coupons.yml' } = {}) {
  const errors = [];
  if (parsed === null || parsed === undefined) return errors;
  const list = parsed?.coupons;
  if (!Array.isArray(list)) {
    errors.push(`${file}: \`coupons\` must be a list`);
    return errors;
  }
  const seen = new Set();
  list.forEach((e, i) => {
    const code = normalizeCouponCode(e?.code);
    if (!COUPON_CODE_RE.test(code)) errors.push(`${file}: coupons[${i}] code must be 3-32 chars A-Z 0-9 (got "${e?.code ?? ''}")`);
    else if (seen.has(code)) errors.push(`${file}: duplicate coupon code ${code}`);
    else seen.add(code);
    const days = Number(e?.freeDays);
    if (!Number.isInteger(days) || days < 1 || days > 3650) errors.push(`${file}: coupons[${i}] freeDays must be an integer 1-3650`);
    if (typeof e?.active !== 'boolean') errors.push(`${file}: coupons[${i}] active must be true or false`);
    if (e?.maxRedemptions !== undefined && e?.maxRedemptions !== null && (!Number.isInteger(Number(e.maxRedemptions)) || Number(e.maxRedemptions) < 1)) {
      errors.push(`${file}: coupons[${i}] maxRedemptions must be a positive integer when set`);
    }
    if (e?.expiresAt !== undefined && e?.expiresAt !== null && Number.isNaN(new Date(e.expiresAt).getTime())) {
      errors.push(`${file}: coupons[${i}] expiresAt must be an ISO date when set`);
    }
    // sow-185, enforcing the owner's "TIER IS EXPLICIT, NOT INHERITED" ruling in CI rather than restating it
    // in a comment. A LIVE campaign must name what it hands out; an inactive or fully-expired coupon is not
    // handing anything out, so it is only held to naming a valid tier IF it names one at all.
    if (e?.tier !== undefined && e?.tier !== null && !PAID_GRANT_TIERS.includes(e.tier)) {
      errors.push(`${file}: coupons[${i}] tier must be one of ${PAID_GRANT_TIERS.join(', ')} when set (got "${e.tier}")`);
    } else if (e?.active === true && (e?.tier === undefined || e?.tier === null)) {
      errors.push(`${file}: coupons[${i}] (${code || 'unnamed'}) is active and must name the tier it confers (tier: ${PAID_GRANT_TIERS.join(' or ')}); a fold must never inherit it from grantTier's default`);
    }
  });
  return errors;
}

/** The coupons:config mirror blob shape ({ generatedAt, coupons }), from the raw parsed yaml. */
export function toCouponsMirror(raw, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    coupons: [...couponsFromParsed(raw).values()],
  };
}
