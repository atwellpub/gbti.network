// SOW-119: the PURE coupon-pool edit core. Given the PARSED house/coupons.yml plus an action, each
// function returns { next, changed, audit } exactly like news-source-edits.mjs: `next` is the new parsed
// doc (the caller serializes + commits it via the SOW-005 PR flow), `changed` is false when the action is
// already satisfied (idempotent), `audit` is an identity-minimal log entry for the PR body. Node-free.
//
// SECURITY: this only COMPUTES the file edit. Authorization is CODEOWNERS (house/** is admin-owned) +
// no-bypass branch protection + the metadata-only gate; a non-admin PR touching house/coupons.yml is
// auto-rejected regardless of what this computes.

import { normalizeCouponCode, COUPON_CODE_RE } from './coupons.mjs';
import { PAID_GRANT_TIERS } from './tier-gate.mjs'; // sow-185: the paid tiers a coupon may confer

export class CouponEditError extends Error {}

const MAX_NOTE = 160;

/**
 * sow-185: the tier a newly added coupon confers when the caller names none. This DEFAULT is not the
 * implicitness the owner's ruling forbids, and the difference is the whole point: it is resolved once,
 * here, and WRITTEN INTO THE FILE as a value. grantTier's identical-looking default is applied at every
 * read, forever, so changing it would move every grant that ever leaned on it. A written value cannot be
 * retroactively re-decided.
 *
 * Member (owner decision, 2026-08-19, flipped from creator). Past campaigns all conferred full
 * complimentary access, and the three CODEABLEYEAR grants carry `tier: creator` as written values, so
 * they are unaffected. The default now names the LOWER tier so a coupon added without the field grants
 * the smaller thing: an admin who means Content Creator says so, rather than an omission deciding it.
 */
export const DEFAULT_COUPON_TIER = 'member';

function checkTier(tier) {
  if (tier === undefined || tier === null || tier === '') return DEFAULT_COUPON_TIER;
  if (!PAID_GRANT_TIERS.includes(tier)) throw new CouponEditError(`tier must be one of ${PAID_GRANT_TIERS.join(', ')}`);
  return tier;
}

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new CouponEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, action, code, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { code },
    detail: detail ?? null,
  };
}

function listOf(parsed) {
  return Array.isArray(parsed?.coupons) ? parsed.coupons.map((c) => ({ ...c })) : [];
}

function checkDays(freeDays) {
  const days = Number(freeDays);
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new CouponEditError('freeDays must be an integer 1-3650');
  return days;
}
function checkMax(maxRedemptions) {
  if (maxRedemptions === undefined || maxRedemptions === null || maxRedemptions === '') return null;
  const n = Number(maxRedemptions);
  if (!Number.isInteger(n) || n < 1) throw new CouponEditError('maxRedemptions must be a positive integer or empty (unlimited)');
  return n;
}
function checkExpires(expiresAt) {
  if (expiresAt === undefined || expiresAt === null || expiresAt === '') return null;
  if (Number.isNaN(new Date(expiresAt).getTime())) throw new CouponEditError('expiresAt must be an ISO date or empty');
  return String(expiresAt);
}

/** Add a coupon. Errors on a duplicate code (updating is its own explicit action). */
export function addCouponEdit(parsed, { code, freeDays, note, maxRedemptions, expiresAt, tier } = {}, ctx) {
  const c = normalizeCouponCode(code);
  if (!COUPON_CODE_RE.test(c)) throw new CouponEditError('a coupon code is 3-32 chars A-Z 0-9');
  const days = checkDays(freeDays);
  const t = checkTier(tier);
  const coupons = listOf(parsed);
  if (coupons.some((e) => normalizeCouponCode(e?.code) === c)) throw new CouponEditError(`coupon ${c} already exists`);
  coupons.push({
    code: c,
    freeDays: days,
    active: true,
    // sow-185: always written, never omitted. A coupon added here is `active: true`, and validateCoupons
    // rejects an active coupon that names no tier, so omitting it would hand the admin UI a PR that fails CI.
    tier: t,
    note: String(note ?? '').slice(0, MAX_NOTE),
    maxRedemptions: checkMax(maxRedemptions),
    expiresAt: checkExpires(expiresAt),
  });
  return { next: { ...parsed, coupons }, changed: true, audit: auditEntry(ctx, 'coupon-add', c, { freeDays: days, tier: t }) };
}

/**
 * Update a coupon: any of { freeDays, active, tier, note, maxRedemptions, expiresAt }. Idempotent: a patch that
 * changes nothing returns changed:false. An existing redemption keeps its original grant; edits shape
 * FUTURE redemptions only.
 */
export function updateCouponEdit(parsed, { code, patch } = {}, ctx) {
  const c = normalizeCouponCode(code);
  const coupons = listOf(parsed);
  const idx = coupons.findIndex((e) => normalizeCouponCode(e?.code) === c);
  if (idx === -1) throw new CouponEditError(`no such coupon: ${c}`);
  const cur = coupons[idx];
  const nextEntry = { ...cur };
  const p = patch || {};
  const detail = {};
  if (p.freeDays !== undefined) { nextEntry.freeDays = checkDays(p.freeDays); detail.freeDays = nextEntry.freeDays; }
  if (p.tier !== undefined) { nextEntry.tier = checkTier(p.tier); detail.tier = nextEntry.tier; }
  if (p.active !== undefined) { nextEntry.active = p.active === true || p.active === 'true'; detail.active = nextEntry.active; }
  if (p.note !== undefined) { nextEntry.note = String(p.note ?? '').slice(0, MAX_NOTE); detail.note = true; }
  if (p.maxRedemptions !== undefined) { nextEntry.maxRedemptions = checkMax(p.maxRedemptions); detail.maxRedemptions = nextEntry.maxRedemptions; }
  if (p.expiresAt !== undefined) { nextEntry.expiresAt = checkExpires(p.expiresAt); detail.expiresAt = nextEntry.expiresAt; }
  if (Object.keys(detail).length === 0) throw new CouponEditError('nothing to update');
  // sow-185: AFTER the empty-patch guard on purpose. Leaving an ACTIVE coupon with no tier writes a file
  // validateCoupons rejects, so the admin's edit would come back as a red CI check rather than an applied
  // change. Only a hand-written legacy entry can be in that state (addCouponEdit always writes one). Heal it
  // as part of a real edit and SAY SO in the audit, rather than erroring into a dead end the UI has no field
  // to escape from. Running it BEFORE the guard would turn an empty patch into a silent tier write.
  if (nextEntry.active === true && !PAID_GRANT_TIERS.includes(nextEntry.tier)) {
    nextEntry.tier = DEFAULT_COUPON_TIER;
    detail.tier = nextEntry.tier;
    detail.tierDefaulted = true;
  }
  const changed = JSON.stringify(nextEntry) !== JSON.stringify(cur);
  if (!changed) return { next: parsed, changed: false, audit: auditEntry(ctx, 'coupon-update', c, detail) };
  coupons[idx] = nextEntry;
  return { next: { ...parsed, coupons }, changed: true, audit: auditEntry(ctx, 'coupon-update', c, detail) };
}
