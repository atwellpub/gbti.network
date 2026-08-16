// SOW-119: fold coupon redemptions (KV) into house/grandfathered.yml as until-bounded grants, so git is
// the durable record and the standard override machinery (mirror, gate, reconcile lapse) takes over from
// the Worker's fast-path KV grant. Mirrors the favorite-counts KV -> git model: read the edge store via
// the Cloudflare KV REST API (creds-gated, reported no-op without them), diff against the current file,
// and write ONE auto-merged house PR when something is missing.
//
// The file is APPENDED textually, never re-dumped: grandfathered.yml carries hand-written comments the
// yaml dumper would destroy. A new entry block parses as part of the existing `grandfathered:` list even
// after the trailing template comments; the result is re-parsed and verified before any PR opens.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { grandfathersFromParsed } from '../../membership/overrides-core.mjs';
import { PAID_GRANT_TIERS } from '../../membership/tier-gate.mjs'; // sow-185: the paid tiers a grant may carry
import { couponTier } from '../../membership/coupons.mjs'; // sow-185: the tier a coupon confers

export const GRANDFATHERED_PATH = 'house/grandfathered.yml';
export const COUPONS_PATH = 'house/coupons.yml';
export const COUPON_REASON_PREFIX = 'coupon:';

const KEY_RE = /^redemption:([A-Z0-9]{3,32}):(\d+)$/;

/** List every redemption:<CODE>:<githubId> record from KV. Creds absent -> { available:false }. */
export async function listCouponRedemptions({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { available: false, reason: 'CF credentials not set (CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN)' };
  }
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };

  const names = [];
  let cursor = '';
  do {
    const url = `${apiBase}/keys?prefix=${encodeURIComponent('redemption:')}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers });
    if (!res?.ok) return { available: false, reason: `KV key list failed (${res?.status})` };
    const data = await res.json();
    for (const k of data?.result ?? []) names.push(k.name);
    cursor = data?.result_info?.cursor || '';
  } while (cursor);

  const redemptions = [];
  for (const name of names) {
    const m = KEY_RE.exec(name);
    if (!m) continue; // an unexpected key shape contributes nothing (fail closed)
    try {
      const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(name)}`, { headers });
      if (!res?.ok) continue;
      const value = await res.json().catch(() => null);
      if (!value?.until) continue;
      // sow-185: `tier` is present only on records written after the Worker began stamping it. An older
      // record carries none and falls back to the registry lookup in planCouponGrants.
      redemptions.push({ code: m[1], githubId: m[2], login: value.login ?? null, redeemedAt: value.redeemedAt ?? null, until: value.until, tier: value.tier ?? null });
    } catch {
      // one bad record never aborts the sweep
    }
  }
  return { available: true, redemptions };
}

/**
 * Pure: which redemptions need a git grant, and how? Per redemption id, the existing entry decides:
 *   - a `coupon:` entry        -> SKIP (already folded; idempotent re-runs, and a folded grant is final)
 *   - a permanent comp entry   -> REPLACE (SOW-142, owner-elected 2026-07-22: redeeming the invite
 *     (non-coupon, until null)    CONVERTS a permanently grandfathered co-op member to the standard
 *                                 free-year-then-pay deal; the coupon entry supersedes the permanent one)
 *   - a BOUNDED non-coupon     -> SKIP + surface in `skippedBounded` (a hand-set temporary grant is
 *     entry                       never silently rewritten; the owner decides)
 *   - no entry                 -> ADD (the normal SOW-119 fold)
 * Expired redemptions, malformed records, and duplicate ids are dropped as before.
 * Returns { grants, skippedBounded }; a grant carries `replaces: true` when it supersedes an entry.
 *
 * sow-185, owner ruling "TIER IS EXPLICIT, NOT INHERITED": every grant this plans NAMES its paid tier,
 * resolved in strict precedence and never invented:
 *   1. the existing entry's hand-set tier  (an owner decision outranks a campaign default; SOW-142)
 *   2. the redemption record's stamped tier (what the coupon promised when it was actually redeemed)
 *   3. the coupon registry's declared tier (house/coupons.yml, for records predating the stamp)
 *   4. nothing                             (no tier is written; grantTier's creator default applies, the
 *                                           exact pre-sow-185 behaviour, so this can only ADD explicitness)
 */
export function planCouponGrants({ redemptions = [], grandfatheredParsed = null, couponsParsed = null, now = new Date() } = {}) {
  const existing = grandfathersFromParsed(grandfatheredParsed);
  const grants = [];
  const skippedBounded = [];
  const seen = new Set();
  for (const r of redemptions) {
    const githubId = String(r?.githubId ?? '');
    const until = r?.until ? new Date(r.until) : null;
    if (!githubId || !r?.code || !until || Number.isNaN(until.getTime())) continue;
    if (seen.has(githubId)) continue;
    if (until.getTime() <= now.getTime()) continue; // already over: nothing to grant
    const entry = existing.get(githubId);
    let replaces = false;
    if (entry) {
      const reason = String(entry.reason ?? '');
      if (reason.startsWith(COUPON_REASON_PREFIX)) continue; // already folded
      const bounded = entry.until !== null && entry.until !== undefined && String(entry.until).trim() !== '';
      if (bounded) {
        skippedBounded.push({ githubId, reason, until: entry.until });
        continue;
      }
      replaces = true;
    }
    seen.add(githubId);
    // sow-185: the four-step precedence documented above. A hand-set tier on the existing entry wins because
    // converting a permanent comp changes only the time BOUND (permanent -> free year); the owner's tier
    // choice is orthogonal and must survive the conversion, else renderGrantBlock would drop it and
    // grantTier would silently revert the grant to the creator default. Only ever a real paid tier.
    // sow-231 Phase 2 adds the FOURTH step, and it exists because of a gap the first three do not cover for
    // an invite. A per-invite code (CODEABLE-7F3Q) is not in the registry, so `couponTier(registry, r.code)`
    // MISSES for it, leaving an invite grant with only the redemption record's own stamp between it and no
    // tier at all. `r.campaign` is the campaign the invite was minted against, which the registry CAN
    // resolve, so the registry fallback works again for invites as it always has for campaign codes.
    const tier = [entry?.tier, r?.tier, couponTier(couponsParsed, r.code), couponTier(couponsParsed, r.campaign)]
      .find((t) => PAID_GRANT_TIERS.includes(t)) ?? null;
    grants.push({
      githubId,
      login: typeof r.login === 'string' && /^[a-z0-9-]+$/i.test(r.login) ? r.login.toLowerCase() : null,
      code: r.code,
      until: until.toISOString(),
      ...(replaces ? { replaces: true } : {}),
      ...(tier ? { tier } : {}),
    });
  }
  grants.sort((a, b) => a.githubId.localeCompare(b.githubId));
  return { grants, skippedBounded };
}

/** Render one grant as a YAML list-item block matching the file's hand-written style. */
function renderGrantBlock(a, stamp) {
  const who = a.login ? `github.com/${a.login}` : 'coupon redemption';
  const comment = a.replaces ? `# ${who} (converted from permanent comp ${stamp}, SOW-142)` : `# ${who}`;
  const lines = [
    `  - github_id: "${a.githubId}"${' '.repeat(Math.max(1, 15 - a.githubId.length))}${comment}`,
  ];
  if (a.login) lines.push(`    login: ${a.login}`);
  lines.push(`    reason: ${COUPON_REASON_PREFIX}${a.code}`);
  lines.push(`    until: "${a.until}"`);
  if (a.tier) lines.push(`    tier: ${a.tier}`); // sow-185: preserve a converted comp's hand-set tier
  return lines.join('\n');
}

/**
 * Pure: locate one member's entry block (the `  - github_id: ...` list-item line plus its 4-space
 * continuation lines) in the split file text. Returns { start, end } (end exclusive) or null.
 * ONE place owns the block-matching regex, so the throwing and non-throwing removals below can never
 * disagree about what an entry block is.
 */
function findGrantEntryBlock(lines, githubId) {
  const startRe = new RegExp(`^  - github_id: "?${githubId}"?(\\s|$)`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && /^    \S/.test(lines[end])) end++;
  return { start, end };
}

/**
 * Pure: remove one member's entry block from the file text. Comments outside the block are untouched.
 * Throws when the block cannot be found (a replacement must never silently no-op into a duplicate).
 */
export function removeGrantEntry(text, githubId) {
  const lines = text.split('\n');
  const at = findGrantEntryBlock(lines, githubId);
  if (!at) throw new Error(`coupon-grants: cannot find the entry block for ${githubId} to replace`);
  lines.splice(at.start, at.end - at.start);
  return lines.join('\n');
}

/**
 * Pure: the non-throwing removal, for callers where an ABSENT entry is a normal outcome rather than a
 * bug (SOW-024 erasure and the sow-212 test reset both run against members who may hold no grant at
 * all). Returns { text, removed }. Deliberately a sibling of removeGrantEntry rather than a second
 * implementation: an entry block is defined once, in findGrantEntryBlock.
 *
 * Text-based on purpose. A yaml.dump round-trip would reformat the whole file and destroy the
 * per-person `# github.com/<login>` comments and the header, so every removal here is a line splice.
 */
export function removeGrantEntryIfPresent(text, githubId) {
  const lines = text.split('\n');
  const at = findGrantEntryBlock(lines, String(githubId));
  if (!at) return { text, removed: false };
  lines.splice(at.start, at.end - at.start);
  return { text: lines.join('\n'), removed: true };
}

/**
 * Pure: apply the planned grants to the current file text (removing any superseded permanent entries
 * first, then appending the coupon blocks) and VERIFY the result: it parses, every grant resolves to
 * its coupon entry, and no github_id appears twice. Throws on a verification miss (the PR must never
 * carry a file that silently drops or shadows a grant).
 */
export function appendGrantEntries(text, grants, now = new Date()) {
  if (!grants.length) return text;
  const stamp = now.toISOString().slice(0, 10);
  let base = text;
  for (const g of grants) {
    if (g.replaces) base = removeGrantEntry(base, g.githubId);
  }
  const block = [
    '',
    `  # SOW-119: coupon grants folded in from KV redemptions by reconcile (${stamp}). Auto-appended.`,
    ...grants.map((g) => renderGrantBlock(g, stamp)),
    '',
  ].join('\n');
  const next = base.replace(/\n*$/, '\n') + block;
  const parsed = yaml.load(next);
  const map = grandfathersFromParsed(parsed);
  for (const g of grants) {
    const e = map.get(g.githubId);
    if (!e) throw new Error(`coupon-grants: appended grant for ${g.githubId} did not parse back`);
    if (String(e.reason ?? '') !== `${COUPON_REASON_PREFIX}${g.code}`) {
      throw new Error(`coupon-grants: the entry for ${g.githubId} did not resolve to its coupon grant (shadowed by another block?)`);
    }
  }
  const ids = (parsed?.grandfathered ?? []).map((e) => String(e?.github_id ?? '')).filter(Boolean);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`coupon-grants: duplicate github_id ${dup} after the fold`);
  return next;
}

/** Read the current grandfathered.yml (text + parsed) from disk. */
export function readGrandfatheredFromDisk(root) {
  const text = fs.readFileSync(path.join(root, GRANDFATHERED_PATH), 'utf8');
  return { text, parsed: yaml.load(text) };
}

/**
 * sow-185: read the coupon registry (parsed) from disk, for the fold's tier lookup. Returns null rather
 * than throwing when the file is missing or unparseable: a coupon registry we cannot read must not abort
 * the fold, it just costs the registry fallback, and the grant then folds exactly as it did before this
 * field existed. Fails toward the OLD behaviour, never toward a wrong tier.
 */
export function readCouponsFromDisk(root) {
  try {
    return yaml.load(fs.readFileSync(path.join(root, COUPONS_PATH), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The sync: list redemptions, plan the missing grants, and write them via ONE auto-merged house PR
 * (the reconcile bot is admin; house/** admin CODEOWNERS + the gate stay the boundary).
 */
export async function syncCouponGrants({
  env = process.env,
  fetchImpl = globalThis.fetch,
  github = null,
  base = 'main',
  now = new Date(),
  listRedemptions = listCouponRedemptions,
  readGrandfathered = null,
  readCoupons = null,
} = {}) {
  const kv = await listRedemptions({ env, fetchImpl });
  if (!kv.available) return { synced: false, reason: kv.reason };
  if (!kv.redemptions?.length) return { synced: false, reason: 'no redemptions in KV' };

  const current = readGrandfathered ? await readGrandfathered() : null;
  if (!current?.text) return { synced: false, reason: 'cannot read house/grandfathered.yml' };

  // sow-185: an unreadable coupon registry is NOT fatal here (see readCouponsFromDisk). It costs the
  // registry step of the tier precedence, not the fold.
  const couponsParsed = readCoupons ? await readCoupons() : null;

  const { grants, skippedBounded } = planCouponGrants({ redemptions: kv.redemptions, grandfatheredParsed: current.parsed, couponsParsed, now });
  if (!grants.length) return { synced: false, reason: 'all redemptions already granted', redemptions: kv.redemptions.length, skippedBounded };
  if (!github) return { synced: false, reason: 'no github client to write the grants PR', additions: grants.length, skippedBounded };

  const nextText = appendGrantEntries(current.text, grants, now);
  const conversions = grants.filter((g) => g.replaces).length;
  const branch = `gbti/coupon-grants-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`coupon-grants sync: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);
  const existing = await github.getContent(GRANDFATHERED_PATH, branch);
  await github.putContent(GRANDFATHERED_PATH, {
    message: 'reconcile: fold coupon redemptions into grandfather grants (SOW-119)',
    content: Buffer.from(nextText, 'utf8').toString('base64'),
    branch,
    sha: existing?.sha,
  });
  const pull = await github.createPull({
    title: 'reconcile: coupon grants (SOW-119)',
    head: branch,
    base,
    body:
      `Folds ${grants.length} coupon redemption${grants.length === 1 ? '' : 's'} from KV into until-bounded grandfather grants.` +
      (conversions ? `\n\n${conversions} of these CONVERT a permanent comp member to the standard free-year deal (redeeming the invite is the conversion; SOW-142, owner-elected 2026-07-22).` : ''),
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, additions: grants.length, conversions, skippedBounded };
}
