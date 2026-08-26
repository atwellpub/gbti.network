// Operations, ADMIN + CONTRIBUTIONS (SOW-006 / SOW-009 / SOW-038): the admin-gated reads and actions
// (roster, coupons, invites, Discord channels), the PR/contribution review flow, and image staging.
// requireAdmin is the gate, but CODEOWNERS + the SOW-005 PR gate remain the real boundary.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { parseContentFile, NETWORK_CONTENT_OWNER } from './content-ops.mjs';
import { fetchStripeStatus } from './membership.mjs';
import { SIGNUP_BASE, authModeFor } from './signup-base.mjs';
import { isContributionToFolder } from '../../membership/classify-pr.mjs';
import yaml from 'js-yaml';
import { buildRoster } from '../../membership/superadmin-roster.mjs';
import { getRosterStatuses as workerGetRosterStatuses, getDiscordChannels as workerGetDiscordChannels, triggerAdminOp as workerTriggerAdminOp, getCouponUsage as workerGetCouponUsage, inviteAdminRequest } from './member-admin-client.mjs';
import { OperationError, requireAdmin, requireIdentity, requireRepo } from './operations-core.mjs';

export async function getOverridesRoster(ctx) {
  const { rolesParsed, readText } = await requireAdmin(ctx);
  const [bansParsed, gfParsed, idxParsed] = await Promise.all([
    readText('house/bans.yml').then((t) => yaml.load(t) || {}),
    readText('house/grandfathered.yml').then((t) => yaml.load(t) || {}),
    readText('house/members-index.yml').then((t) => yaml.load(t) || {}),
  ]);
  // Best-effort: merge the live Stripe status + tier (sow-185/sow-229) and any pending KV coupon grant (sow-229)
  // from the admin Worker endpoint. On any failure (the Worker is down, test mode, or the caller is not admin to
  // it) the roster still renders with 'unknown' Stripe status and no tier/pending annotation — the
  // override-derived status (the authoritative part) never depends on this call.
  let stripeStatuses = null;
  let stripeLogins = null; // SOW-091: the github_id -> github_login map, to name a member with no content
  let stripeTiers = null;   // sow-229: the live Stripe tier per member
  let pendingGrants = null; // sow-229: redeemed-but-unfolded coupon grants (KV), a display annotation only
  try {
    const token = ctx.store?.get?.('githubToken');
    if (token) {
      const r = await workerGetRosterStatuses({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
      stripeStatuses = r?.statuses ?? null;
      stripeLogins = r?.logins ?? null;
      stripeTiers = r?.tiers ?? null;
      pendingGrants = r?.pendingGrants ?? null;
    }
  } catch { stripeStatuses = null; stripeLogins = null; stripeTiers = null; pendingGrants = null; }
  return buildRoster({ roles: rolesParsed, bans: bansParsed, grandfathered: gfParsed, membersIndex: idxParsed, stripeStatuses, stripeLogins, stripeTiers, pendingGrants });
}


// SOW-038 P2: the open content-PR queue for the superadmin dashboard. Admin-gated. Lists every OPEN upstream PR
// (newest first) so an admin sees what is awaiting the gate / review at a glance. Open PRs are public on the
// repo, but this lives behind the admin gate alongside the roster. Returns { pulls: [{number, title, html_url,
// author, createdAt, ...}] } from the repo client (classic reads the upstream; app mode via the Worker proxy).
export async function getOpenPulls(ctx) {
  await requireAdmin(ctx);
  const repo = requireRepo(ctx);
  return { pulls: await repo.listOpenPulls() };
}


// SOW-038 P3: trigger an allow-listed superadmin OPERATION (reconcile / e2e) via the Worker's dispatch endpoint.
// Admin-gated locally (UX, fail-closed) AND by the Worker (the authority + the dispatch token). Returns
// { ok, triggered } or throws OperationError.
// SOW-100: the guild's Discord channel names, for the categories workspace (Worker admin-gated + cached).
export async function listDiscordChannels(ctx) {
  const token = ctx.store?.get?.('githubToken');
  const channels = await workerGetDiscordChannels({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  return { channels };
}


/** SOW-119: per-coupon usage (the Worker is the authority; admin-gated there). Sharing is the plain
 *  visible /codeable-invite/?coupon=<CODE> URL since the 2026-07-18 QA feedback; no link state exists. */
export async function getCouponUsageOp(ctx) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  try {
    return await workerGetCouponUsage({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not read coupon usage');
  }
}


/**
 * sow-231 Phase 3: the issued-invite admin ops. All three share one Worker route and one gate, so they
 * share one client call and differ only by verb and body.
 *
 * requireAdmin runs HERE as well as at the Worker on purpose: the local gate gives a useful error to a
 * non-admin instead of a 403 from a network call, and the Worker remains the real boundary.
 */
export async function listInvitesOp(ctx) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  try {
    return await inviteAdminRequest({ token, signupBase: SIGNUP_BASE, method: 'GET', fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not list invites');
  }
}


export async function createInviteOp(ctx, body = {}) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  if (!body?.campaign) throw new OperationError('bad-request', 'a campaign is required');
  try {
    return await inviteAdminRequest({ token, signupBase: SIGNUP_BASE, method: 'POST', body, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not mint the invite');
  }
}


export async function updateInviteOp(ctx, body = {}) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  if (!body?.code) throw new OperationError('bad-request', 'an invite code is required');
  try {
    return await inviteAdminRequest({ token, signupBase: SIGNUP_BASE, method: 'PATCH', body, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not update the invite');
  }
}


/** SOW-119 QA: re-verify the coupon grant against the live status oracle just before the expiry popup
 *  shows. The store's couponUntil is seeded at sign-in and never re-resolved while membership stays paid,
 *  so a member who converted to a real subscription mid-grant would keep the stale date (and the nag)
 *  until a re-login. The oracle suppresses couponUntil for Stripe-paid, so one fresh read both corrects
 *  the store and answers "is the grant still the paid source?". An unreachable oracle throws WITHOUT
 *  touching the store (the popup skips that page load and retries on the next); the store is rewritten
 *  only when the oracle actually answered. */
export async function refreshCouponUntil(ctx) {
  const token = ctx.store?.get?.('githubToken');
  if (!token) return { couponUntil: null };
  const { status, couponUntil } = await fetchStripeStatus({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  if (status === 'unknown') throw new OperationError('oracle-unreachable', 'the membership oracle did not answer');
  ctx.store?.set?.({ couponUntil: couponUntil ?? null });
  return { couponUntil: couponUntil ?? null };
}


export async function triggerAdminOp(ctx, { action, params } = {}) {
  await requireAdmin(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  try {
    return await workerTriggerAdminOp({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, action, params }); // SOW-055: params for category-migrate
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not trigger the operation');
  }
}


export async function listPRs(ctx) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  return { prs: await repo.listMyPulls(id.login) };
}


export async function prStatus(ctx, { number } = {}) {
  requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
  return repo.gateStatus(n);
}


/**
 * SOW-028 P1: the signed-in member's contribution inbox. Returns the OPEN upstream PRs that another member
 * opened against THIS member's folder (the gate's `contribution-pending-owner` set), awaiting this owner's
 * review. It reuses the gate's own owner-side classifier (isContributionToFolder), so the inbox shows exactly
 * the PRs the gate treats as a contribution to this folder, never a mixed or privilege-escalating PR. The
 * owner's own PRs are excluded (those are the workspace "Pull requests" tab). Fail-soft per PR: a PR whose
 * files cannot be read is skipped, not fatal. Read-only; approve/request-changes/decline is P3.
 */
export async function listIncomingContributions(ctx) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const open = await repo.listOpenPulls();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || '').toLowerCase();
  const out = [];
  for (const pr of open) {
    // Exclude the owner's own PRs (own-folder edits live in the workspace PR tab, not the review inbox).
    const aId = pr.author?.id != null ? String(pr.author.id) : null;
    const aLogin = String(pr.author?.login || '').toLowerCase();
    if ((myId && aId && aId === myId) || (myLogin && aLogin && aLogin === myLogin)) continue;
    let files;
    try {
      files = await repo.listPullFiles(pr.number);
    } catch {
      continue; // cannot read this PR's files -> skip it rather than fail the whole inbox
    }
    const paths = files.map((f) => f.filename);
    if (!isContributionToFolder(paths, id.username)) continue;
    out.push({
      number: pr.number,
      title: pr.title,
      html_url: pr.html_url,
      author: pr.author ?? null,
      headSha: pr.headSha ?? null,
      createdAt: pr.createdAt ?? null,
      updatedAt: pr.updatedAt ?? null,
      files,
      fileCount: files.length,
      additions: files.reduce((s, f) => s + (f.additions || 0), 0),
      deletions: files.reduce((s, f) => s + (f.deletions || 0), 0),
    });
  }
  return { contributions: out };
}


/**
 * SOW-028 P2/P3: load ONE incoming contribution, fail-closed. Resolves the PR by number and confirms it is a
 * reviewable contribution to the signed-in owner: another member opened it (not the owner) AND every changed
 * path sits inside members/<owner>/ (isContributionToFolder, the gate's own classifier). Anything else throws
 * `forbidden`, so the client review/decide path can only ever touch the owner's legitimate inbox items, never
 * an arbitrary PR. Returns { id, repo, n, pr, files } (files carry the unified patch).
 */
export async function loadOwnContribution(ctx, number) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const n = Number(number);
  if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
  const pr = await repo.getPull(n);
  const aId = pr.author?.id != null ? String(pr.author.id) : null;
  const aLogin = String(pr.author?.login || '').toLowerCase();
  const myId = id.githubId != null ? String(id.githubId) : null;
  const myLogin = String(id.login || '').toLowerCase();
  if ((myId && aId && aId === myId) || (myLogin && aLogin && aLogin === myLogin)) {
    throw new OperationError('forbidden', 'this is your own pull request, not an incoming contribution');
  }
  const files = await repo.getPullDiffFiles(n);
  if (!isContributionToFolder(files.map((f) => f.filename), id.username)) {
    throw new OperationError('forbidden', 'this pull request is not a contribution to your folder');
  }
  return { id, repo, n, pr, files };
}


/**
 * SOW-028 P2: the full review payload for one incoming contribution: its metadata, the per-file unified diff,
 * and the proposed NEW body of each changed markdown file at the PR head (so the owner can "preview as merged"
 * by passing `proposed[].body` to client.preview(), the same renderer the editor uses). Fail-closed via
 * loadOwnContribution.
 */
export async function getContributionReview(ctx, { number } = {}) {
  const { repo, n, pr, files } = await loadOwnContribution(ctx, number);
  const proposed = [];
  for (const f of files) {
    if (!/\.md$/i.test(f.filename) || f.status === 'removed') continue;
    let text = null;
    try { text = await repo.getFileContent(f.filename, pr.headSha); } catch { text = null; }
    if (text == null) continue;
    const { body } = parseContentFile(text);
    proposed.push({ filename: f.filename, body });
  }
  return {
    number: n,
    title: pr.title,
    html_url: pr.html_url,
    headSha: pr.headSha,
    author: pr.author,
    files: files.map((f) => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch ?? null })),
    proposed,
    // SOW-028: only the classic account-wide token can post a review the gate honors by the member's
    // github_id. App mode (fork-scoped) and hosted mode (SOW-157, identity-only) both decide on github.com.
    canActInClient: authModeFor(ctx) === 'classic',
  };
}


export const DECLINE_NOTE =
  'Thank you for the contribution. The folder owner has decided not to merge this change right now. You are welcome to discuss it here or open a revised proposal.';


/**
 * SOW-028 P3: the owner's decision on an incoming contribution. The client NEVER merges directly: an APPROVE is
 * a GitHub PR review on the current head SHA, which the SOW-005 gate reads (by the owner's github_id) and then
 * auto-merges + runs the SOW-008 award. `request-changes` is a REQUEST_CHANGES review with a message. `decline`
 * posts a note and closes the PR (the draft stays on the contributor's fork). Fail-closed via loadOwnContribution.
 */
export async function reviewContribution(ctx, { number, decision, message } = {}) {
  // App mode (SOW-026): a fork-scoped token cannot post a review the gate would honor by the owner's github_id,
  // and the installation token must not act as a universal approver, so the decision is taken on github.com.
  // Hosted mode (SOW-157) has an identity-only token, so the same applies. Fail fast with a clear message
  // (the UI hides the decide buttons via canActInClient; this guards the MCP/agent path).
  if (authModeFor(ctx) !== 'classic') {
    throw new OperationError('forbidden', 'approve or decline this contribution on github.com (the gate records your GitHub identity as the reviewer)');
  }
  const { repo, n, pr } = await loadOwnContribution(ctx, number);
  const msg = typeof message === 'string' ? message.trim() : '';
  switch (decision) {
    case 'approve':
      // The gate only honors an approval whose commit_id is the CURRENT head SHA, so use the freshly-read head.
      await repo.submitReview(n, { event: 'APPROVE', body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case 'request-changes':
      if (!msg) throw new OperationError('bad-request', 'request-changes needs a message describing what to change');
      await repo.submitReview(n, { event: 'REQUEST_CHANGES', body: msg, commitId: pr.headSha });
      return { ok: true, decision, number: n };
    case 'decline':
      // The owner cannot merge-close another member's PR (they are not a collaborator), so decline is a
      // REQUEST_CHANGES review carrying the decline note (authored by the owner, which the contributor sees), plus
      // a best-effort close. A close failure is non-fatal: the declining review stands and the contributor can
      // close their own PR or revise it.
      await repo.submitReview(n, { event: 'REQUEST_CHANGES', body: msg || DECLINE_NOTE, commitId: pr.headSha });
      try { await repo.closePull(n); } catch { /* owner lacks permission to close a non-own PR; the review stands */ }
      return { ok: true, decision, number: n };
    default:
      throw new OperationError('bad-request', `unknown decision "${decision}" (approve | request-changes | decline)`);
  }
}


export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;


/**
 * sow-165 (Option 3, hybrid): derive the co-located `images/` directory for an item from its index.md path,
 * or null when we cannot SAFELY target one. The item folder is the itemPath minus its last segment (matching
 * resolveMarkdownAssets / resolveContentAsset in client-ui/src/assets.mjs). Only the caller's OWN member folder
 * (`members/<username>/...`) or `house/...` is allowed; a traversal, a backslash, an empty path, or another
 * member's folder returns null, so a bad or unauthorized itemPath falls back to the per-user library copy
 * rather than writing outside the owner's tree. Pure + node-testable.
 */
export function itemImagesDir(itemPath, username) {
  const p = String(itemPath || '').replace(/^\/+/, '');
  if (!p || p.includes('..') || p.includes('\\')) return null;
  const folder = p.replace(/\/[^/]*$/, ''); // strip the trailing index.md (or any filename), like the resolvers
  if (!folder || folder === p) return null; // no slash means it is not an item path: nothing to co-locate into
  const inOwn = !!username && folder.startsWith(`members/${username}/`);
  // sow-195: the network's content moved from house/ into members/gbtilabs/, so co-located images resolve
  // there now. The old house/ arm is kept for anything still pointing at the pre-migration layout.
  const inNetwork = folder.startsWith(`members/${NETWORK_CONTENT_OWNER}/`) || folder === 'house' || folder.startsWith('house/');
  if (!inOwn && !inNetwork) return null;
  return `${folder}/images`;
}


/**
 * Stage an image (base64) via the host Stager.
 *
 * sow-165: when a usable `itemPath` is supplied, the image is CO-LOCATED in that item's `images/` folder and
 * the returned `path` is the canonical repo-relative `./images/<filename>`. That reference resolves natively in
 * the Astro build (the earlier per-user `members/<u>/images/x` path could not be resolved by `image()` and broke
 * the site build) and resolves in the editor preview against the item folder. Without a usable itemPath (for
 * example a new item that has no slug yet) it falls back to the per-user `members/<username>/images/` path,
 * exactly as before, so existing callers are unchanged.
 *
 * Pure: the actual write is delegated to ctx.stager (node = working copy, extension = GitHub Contents API). */
export function stageImage(ctx, { filename, dataBase64, itemPath } = {}) {
  const id = requireIdentity(ctx);
  if (!ctx.stager) throw new OperationError('bad-request', 'Image upload is not available in this client yet.');
  if (!filename || /[\\/]/.test(filename) || filename.includes('..')) throw new OperationError('bad-request', 'invalid filename');
  if (!IMAGE_EXT.test(filename)) throw new OperationError('bad-request', 'unsupported image type (png/jpg/gif/webp/svg)');
  if (!dataBase64) throw new OperationError('bad-request', 'no image data');
  const dir = itemImagesDir(itemPath, id.username);
  if (dir) {
    const rel = `${dir}/${filename}`;
    ctx.stager.writeImage(rel, dataBase64);
    return { ok: true, path: `./images/${filename}`, repoPath: rel };
  }
  const rel = `members/${id.username}/images/${filename}`;
  ctx.stager.writeImage(rel, dataBase64);
  return { ok: true, path: rel, repoPath: rel };
}

