#!/usr/bin/env node
// sow-230: print every coupon invite link, ready to send.
//
// WHY THIS EXISTS AS A SCRIPT RATHER THAN A NOTE SOMEWHERE. An invite link is a coupon code paired with the
// lander that describes the tier that coupon grants, and getting that pairing wrong is not cosmetic: it is
// the defect that retired /linkedin-invite/, where a member-tier code sat under prose selling the creator
// tier. Assembling the URL by hand is how that recurs. Here the code, the tier and the lander are resolved
// from the registry together, and a mismatch is REPORTED rather than silently rendered.
//
// READS origin/main BY DEFAULT, NOT THE WORKING TREE. This repo is worked by several sessions sharing one
// clone that regularly runs dozens of commits behind, so the working copy of house/coupons.yml is routinely
// stale. A stale read here hands somebody a link for a coupon that no longer exists, or omits one that does.
// `--local` opts into the working tree, and the output always says which source it used.
//
// Usage:
//   node scripts/invite-links.mjs              every ACTIVE coupon, from origin/main
//   node scripts/invite-links.mjs --all        include inactive / expired / exhausted, with the reason
//   node scripts/invite-links.mjs --local      read the working tree instead of origin/main
//   node scripts/invite-links.mjs --json       machine-readable
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { couponsFromParsed } from '../membership/coupons.mjs';
import { landerFor, LANDER_BY_TIER, LANDER_BY_CAMPAIGN } from '../membership/invites.mjs'; // sow-231 P3: ONE mapping

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = process.env.SITE_BASE_URL || 'https://gbti.network';

const args = new Set(process.argv.slice(2));
const useLocal = args.has('--local');
const showAll = args.has('--all');
const asJson = args.has('--json');

// The tier -> lander mapping now lives in membership/invites.mjs (`landerFor`), shared with the browser
// coupon manager. It was duplicated here first; that duplication is removed rather than kept in sync,
// because a second copy of this particular mapping drifts silently and the symptom is somebody being sent
// a page describing a tier they were not given.

function readRegistry() {
  const rel = 'house/coupons.yml';
  if (useLocal) {
    return { source: `working tree (${rel})`, raw: yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) };
  }
  // Fail LOUDLY rather than silently falling back to the working tree: a quiet fallback would reintroduce
  // exactly the stale read this defaults away from, and the caller would never know which they got.
  const text = execFileSync('git', ['show', `origin/main:${rel}`], { cwd: ROOT, encoding: 'utf8' });
  return { source: `origin/main (${rel})`, raw: yaml.load(text) };
}

/** The lander that describes what `coupon` grants, or null when nothing does. Pure. */
export function resolveLander(coupon) {
  if (!coupon || !coupon.code) return null;
  return landerFor({ code: coupon.code, tier: coupon.tier });
}

/** Why a coupon is not sendable right now, or null when it is. Mirrors couponIsRedeemable plus the cap. */
export function blockedReason(c, now = new Date()) {
  if (c.active !== true) return 'inactive';
  if (c.expiresAt) {
    const t = new Date(c.expiresAt);
    if (Number.isNaN(t.getTime())) return 'unreadable expiresAt (treated as expired)';
    if (now.getTime() >= t.getTime()) return `expired ${c.expiresAt}`;
  }
  return null;
}

/** Build the row for one coupon: the link, whether it is sendable, and anything wrong with the pairing. */
export function inviteRow(c, now = new Date()) {
  const blocked = blockedReason(c, now);
  const lander = resolveLander(c);
  const warnings = [];
  // The pairing check. A coupon with no tier cannot be matched to a lander at all, and validateCoupons
  // already rejects that for an ACTIVE coupon, so reaching it here means an inactive one or a registry
  // edited around the validator.
  if (!c.tier) warnings.push('no tier: cannot resolve a lander, and an active coupon naming no tier is rejected by validateCoupons');
  else if (!lander) warnings.push(`tier "${c.tier}" has no lander in membership/invites.mjs LANDER_BY_TIER: nothing describes what this grants`);
  return {
    code: c.code,
    tier: c.tier ?? null,
    freeDays: c.freeDays ?? null,
    maxRedemptions: c.maxRedemptions ?? null,
    note: c.note ?? '',
    sendable: !blocked && Boolean(lander),
    blocked,
    url: lander ? `${SITE}${lander}?coupon=${c.code}` : null,
    warnings,
  };
}

// ---- CLI below. Importing this module runs nothing. ----------------------------------------------------
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) main();

function main() {
const now = new Date();
const { source, raw } = readRegistry();
const coupons = [...couponsFromParsed(raw).values()];

const rows = coupons.map((c) => inviteRow(c, now));

const visible = showAll ? rows : rows.filter((r) => r.sendable);

if (asJson) {
  console.log(JSON.stringify({ source, generatedAt: now.toISOString(), coupons: visible }, null, 2));
} else {
  console.log(`Invite links, read from ${source}\n`);
  if (!visible.length) {
    console.log(showAll ? '  (no coupons in the registry)' : '  (no sendable coupons; re-run with --all to see why)');
  }
  for (const r of visible) {
    const years = r.freeDays ? `${r.freeDays} days` : 'no free period';
    console.log(`  ${r.code}  [tier: ${r.tier ?? 'NONE'} · ${years}${r.maxRedemptions === null ? ' · uncapped' : ` · max ${r.maxRedemptions}`}]`);
    if (r.note) console.log(`    ${r.note}`);
    console.log(`    ${r.url ?? '(no lander: not sendable)'}`);
    if (r.blocked) console.log(`    NOT SENDABLE: ${r.blocked}`);
    for (const w of r.warnings) console.log(`    WARNING: ${w}`);
    console.log('');
  }
  const uncapped = visible.filter((r) => r.sendable && r.maxRedemptions === null);
  if (uncapped.length) {
    console.log(`Note: ${uncapped.length} sendable code${uncapped.length === 1 ? ' is' : 's are'} UNCAPPED and there is no redemption`);
    console.log('notification, so nothing reports a redemption as it happens. These are bearer codes: whoever holds');
    console.log('the link can redeem it, and a forwarded link is a transferred free year.');
  }
}
}
