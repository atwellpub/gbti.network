// Operations core (SOW-006): the typed OperationError and the guards every other operations-*.mjs module
// builds on (requireIdentity / requireRepo / requireAdmin / requireSuperadminForHouse / membershipOf), plus
// getStatus. Depends on NO sibling: it is the bottom of the layering, and must stay that way.
//
// Error codes: no-identity | not-authenticated | not-found | bad-request | invalid-content | forbidden.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { NETWORK_CONTENT_OWNER } from './content-ops.mjs';
import { canPublish, canStageDrafts, canSeeNews, canFollow, canSave, canBrowse } from './membership.mjs';
import yaml from 'js-yaml';
import { rolesFromParsed, roleOf, isAdminRole } from '../../membership/overrides-core.mjs';

export const CLIENT_VERSION = '0.1.0';


export class OperationError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'OperationError';
    this.code = code;
    this.details = details;
  }
}


export function requireIdentity(ctx) {
  const id = ctx.identity?.();
  if (!id?.username) throw new OperationError('no-identity', 'no signed-in identity; run `gbti login`');
  return id;
}


export function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'not authenticated; run `gbti login` first');
  return repo;
}


// SOW-145: authoring HOUSE content (list/read-for-edit/publish/status-flip of house/) is superadmin-only.
// Re-derive the caller's role from house/roles.yml via the host-agnostic reader (fail-closed: a missing/
// unreadable file leaves everyone a plain member), and require superadmin. The client toggle is hidden for
// non-superadmins, but this is the server-side re-check; the SOW-005 metadata-only gate + SOW-108 superadmin
// auto-merge stay the REAL enforcement (a forged non-superadmin house/** PR is Tier A -> rejected + closed).
export async function requireSuperadminForHouse(ctx) {
  const id = requireIdentity(ctx);
  let rolesParsed = {};
  try { rolesParsed = yaml.load((await ctx.reader?.readFile?.('house/roles.yml')) || '') || {}; } catch { rolesParsed = {}; }
  const role = roleOf(String(id.githubId), rolesFromParsed(rolesParsed));
  if (role !== 'superadmin') throw new OperationError('forbidden', `house content is superadmin-only (you are ${role})`);
  return { id, role };
}


// SOW-145, retargeted by sow-195: a valid NETWORK content path (the superadmin surface). Posts/products/
// prompts only, one nested item folder, no traversal. The leading-anchored, char-classed pattern is what
// rejects `members/gbtilabs/../roles.yml` and anything else that is not a content item, so keep that shape.
// It used to match `house/<sub>/...`; those folders no longer exist, which is why the WorkBench network
// scope listed nothing and opening an item failed until this moved.
export const NETWORK_CONTENT_PATH_RE = new RegExp(`^members/${NETWORK_CONTENT_OWNER}/(posts|products|prompts)/[a-z0-9][a-z0-9-]*/index\\.md$`);


/** True for a path inside the network's own content folder (the superadmin-gated target). */
export const isNetworkContentPath = (p) => String(p || '').startsWith(`members/${NETWORK_CONTENT_OWNER}/`);


export function getStatus(ctx) {
  const id = ctx.identity?.() ?? null;
  // SOW-011: the cached membership (paid/trialing/...) drives the "membership required to publish" notice in
  // the UI and gates publish below. 'unknown' until the status oracle has been fetched at login.
  const membership = ctx.membership?.() ?? 'unknown';
  return {
    version: CLIENT_VERSION,
    identity: id,
    role: ctx.role?.() ?? 'member',
    authenticated: Boolean(ctx.store?.get('githubToken')),
    repoPath: ctx.store?.get('repoPath') ?? null,
    mcpEnabled: ctx.store?.get('mcpEnabled') ?? null,
    membership,
    couponUntil: ctx.store?.get('couponUntil') ?? null, // SOW-119 QA: the coupon-grant end date (the expiry countdown)
    paidTier: ctx.store?.get('paidTier') ?? 'none', // sow-185: the resolved paid TIER (presentation-only; authorizeCreator is the real gate)
    canPublish: canPublish(membership),
    canStageDrafts: canStageDrafts(membership), // SOW-082: Save-draft is trial+paid (broader than canPublish)
    // SOW-060: the free-tier perks (browse / news / save / follow) need only a signed-in identity, not paid.
    canSeeNews: canSeeNews(membership),
    canFollow: canFollow(membership),
    canSave: canSave(membership),
    canBrowse: canBrowse(membership),
    canCurate: ctx.canCurate?.() ?? false, // SOW-046 C: news -> Discord publish (UX hint; Worker re-checks)
  };
}


/** SOW-089 fix: the awaited membership for read gating. Prefers ctx.membershipResolved (self-heals an
 *  'unknown' login-time cache from the oracle) and falls back to the sync cache; absent = 'unknown'. */
export async function membershipOf(ctx) {
  const m = await (ctx.membershipResolved ? ctx.membershipResolved() : ctx.membership?.());
  return m ?? 'unknown';
}


// SOW-038 P2: the superadmin dashboard roster. Reads the four PUBLIC override files via the host reader (sync on
// the npm host, async on the extension; `await` handles both) and returns every known member with their
// OVERRIDE-derived effective status (ban > staff > grandfather). ADMIN-gated: the caller's own role is derived
// from the roles.yml this op already reads, so it needs no host role() and works in both hosts. Governance status
// (who is banned/grandfathered) is sensitive, so it is never published — it only flows to an admin+ caller here.
// The live per-member Stripe status + tier and any pending KV coupon grant come from the admin Worker endpoint
// below (best-effort); without it the override-derived status still renders and the Stripe status is 'unknown'.
// Admin gate for the superadmin surfaces. Derives the caller's OWN role from the roles.yml it reads (no
// dependency on a host-provided role(), so it works identically in both hosts), fail-closed. Returns the parsed
// roles + a reader so a caller that also needs the other house files does not re-read roles.yml.
export async function requireAdmin(ctx) {
  const id = requireIdentity(ctx);
  const readText = async (p) => { try { return (await ctx.reader?.readFile?.(p)) || ''; } catch { return ''; } };
  const rolesParsed = yaml.load(await readText('house/roles.yml')) || {};
  const role = roleOf(String(id.githubId), rolesFromParsed(rolesParsed));
  if (!isAdminRole(role)) throw new OperationError('forbidden', `this requires admin (you are ${role})`);
  return { id, role, rolesParsed, readText };
}

