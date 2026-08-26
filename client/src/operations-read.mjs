// Operations, READ side (SOW-006): listing and reading content, shares and comments, plus the cached
// comments index. Nothing here mutates the repo. Gated bodies come back locked; decryption is the caller's
// step (see operations-drafts.mjs decryptMemberAsset).
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildContentFile, parseContentFile, ContentValidationError, byCommentOldest, NETWORK_CONTENT_OWNER } from './content-ops.mjs';
import { canSeeShares } from './membership.mjs';
import { getCommentEchoes as workerGetCommentEchoes, reapCommentEchoes as workerReapCommentEchoes } from './member-comment-echo-client.mjs';
import { mergeCommentEchoes } from '../../membership/comment-echo.mjs';
import { SIGNUP_BASE } from './signup-base.mjs';
import { NETWORK_CONTENT_PATH_RE, OperationError, isNetworkContentPath, membershipOf, requireIdentity, requireSuperadminForHouse } from './operations-core.mjs';

// SOW-145: `scope` selects which folder the WorkBench lists. 'member' (default) lists the caller's own
// members/<username>/; 'house' lists the NETWORK's own folder, members/gbtilabs/ since sow-195 (a superadmin
// surface, re-checked). Async so the one op serves the sync npm reader and the async extension reader.
export async function listContent(ctx, { type, scope = 'member' } = {}) {
  const id = requireIdentity(ctx);
  if (scope === 'house') {
    await requireSuperadminForHouse(ctx);
    // sow-195: the network's content is an ORDINARY member folder now, so it lists through the ordinary
    // member reader with gbtilabs as the username. The readers' old 'house' scope pointed at house/<sub>,
    // which no longer exists, so this branch returned an empty list and the WorkBench showed "No articles yet".
    return { items: await ctx.reader.list(NETWORK_CONTENT_OWNER, type || undefined, 'member') };
  }
  return { items: await ctx.reader.list(id.username, type || undefined, 'member') };
}


/** List members-only content (visibility: members) across all folders, for the members-only portal.
 *  sow-193: AWAIT the reader. This was the one call site in the core that did not, which was harmless only
 *  while the node host was guaranteed a SYNCHRONOUS fs reader. The extension papered over it by bypassing this
 *  operation entirely and awaiting the reader itself; that bypass is now gone and both hosts run this path. */
export async function listMembersOnly(ctx) {
  requireIdentity(ctx);
  return { items: (await ctx.reader.listMembersOnly()) ?? [] };
}


/**
 * SOW-018: list PUBLISHED Shares across all members for the extension/client Shares feed (newest-first, capped).
 * Returns metadata + the PUBLIC body only; a members Share's body is decrypted client-side via decryptMemberAsset
 * (the Worker allows an active trial to read a Share, paid too; lapsed/banned are denied). Async so the SAME op
 * works over the sync npm reader and the async extension (GitHub) reader. requireIdentity only: the listed
 * metadata is public-repo stub data; the Worker gates the encrypted bodies.
 */
export async function listShares(ctx, { limit } = {}) {
  requireIdentity(ctx);
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : 40;
  if (typeof ctx.reader?.listShares !== 'function') return { items: [] };
  const items = (await ctx.reader.listShares(n)) ?? [];
  // SOW-078: the public-vs-member visibility split is enforced HERE (host-side), not only in the client's mergeAll.
  // A caller who cannot see the members-only stream (not paid/trialing) receives ONLY public shares, so the raw op
  // can no longer be called directly to harvest member-share stubs (title/url/description). Paid/trial see all.
  // (Per-tier completeness past the read cap is a SOW-077 concern; this is the no-leak guarantee.)
  const membership = await membershipOf(ctx);
  if (canSeeShares(membership)) return { items };
  return { items: items.filter((s) => String(s?.visibility || 'members').toLowerCase() === 'public') };
}


// SOW-078: drop MEMBER-visibility comment stubs (author / timestamp / thread placement) for a caller who cannot read
// member content (not paid/trialing). The body is already gated to '' in the summary, but the metadata of the
// members-only conversation should not be served below the seeing tier. Public comments are kept for everyone.
export function gateMemberComments(items, membership) {
  if (canSeeShares(membership ?? 'unknown')) return items ?? [];
  return (items ?? []).filter((c) => String(c?.visibility || 'public').toLowerCase() !== 'members');
}


// SOW-076: merge the caller's OWN optimistic comment echoes (read-your-writes) onto the deployed comments, reaping
// any that have landed (now deployed) or been declined. Best-effort + signed-in only: any failure (or a target the
// echo store does not handle) falls back cleanly to the deployed comments. News echoes work (2026-07-09).
export async function mergeCommentEchoesFor(ctx, { targetType, targetSlug, deployed }) {
  const token = ctx.store?.get?.('githubToken');
  if (!token || !targetType || !targetSlug) return deployed;
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  let echoes = [];
  try { echoes = (await workerGetCommentEchoes({ targetType, targetSlug, ...opts }))?.echoes ?? []; }
  catch { return deployed; }
  if (!echoes.length) return deployed;
  const { comments, reap } = mergeCommentEchoes({ deployed, echoes });
  if (reap.length) workerReapCommentEchoes({ targetType, targetSlug, ids: reap, ...opts }).catch(() => {}); // fire-and-forget
  return comments;
}


/**
 * SOW-032: list PUBLISHED comments for one Share's discussion thread (oldest-first). targetSlug is the composite
 * "<author>/<shareId>" the share carries. Like listShares, this returns public-repo stub metadata + the PUBLIC
 * body only; a members comment's body is decrypted client-side via decryptMemberAsset (Worker-gated). Async so
 * the SAME op serves the sync npm reader and the async extension (GitHub) reader. requireIdentity only.
 */
export async function listShareComments(ctx, { targetSlug, limit } = {}) {
  // SOW-089: delegate to listComments so share discussions ride the SAME comments-index fast path (one CDN
  // fetch) instead of the per-file reader walk; gating, echoes, and the fallback come along for free.
  return listComments(ctx, { targetType: 'share', targetSlug, limit });
}


// SOW-041: the generic comment thread for ANY content type (post/product/prompt/share). Powers the shared
// <gbti-discussion> in the expanded reader; listShareComments is the 'share' specialization. Same read surface
// (the COMMENT_PATH enumeration + the published filter), just parameterized on targetType.
export const COMMENT_TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share', 'news']); // SOW-046 D: 'news' enables news discussion

// SOW-014 + 2026-08-11: the content types that MAY carry a from-the-author note. NOT the types that REQUIRE
// one (product/prompt, enforced in validate-content.mjs) -- an article's note is optional. Mirrors
// workbench-client-core.mjs AUTHOR_NOTE_TYPES; a drift test asserts every copy agrees.
export const AUTHOR_NOTE_TYPES = new Set(['post', 'product', 'prompt']);

// SOW-089: the comments INDEX fast path. /comments-index.json is one CDN fetch carrying every published
// comment (public bodies inline; members rows pointer-only) — replacing the reader walk that downloaded
// every comment file sequentially (~12s on a real thread). A short-lived module cache avoids refetching per
// discussion within a session; the SOW-076 echoes keep read-your-writes freshness (a new comment echoes
// until deployed, so index + echoes is complete). The reader walk remains ONLY as the fetch-failure fallback.
export const COMMENTS_INDEX_URL = 'https://gbti.network/comments-index.json';

export const COMMENTS_INDEX_TTL_MS = 60_000;

export let commentsIndexCache = null; // { at, items }


export async function fetchCommentsIndex(ctx) {
  const now = Date.now();
  if (commentsIndexCache && now - commentsIndexCache.at < COMMENTS_INDEX_TTL_MS) return commentsIndexCache.items;
  const f = ctx.fetch ?? globalThis.fetch;
  const res = await f(COMMENTS_INDEX_URL, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`comments index ${res.status}`);
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  commentsIndexCache = { at: now, items };
  return items;
}


export function _resetCommentsIndexCache() { commentsIndexCache = null; } // tests


export async function listComments(ctx, { targetType, targetSlug, limit, aliases } = {}) {
  requireIdentity(ctx);
  if (!COMMENT_TARGET_TYPES.has(targetType)) throw new OperationError('bad-request', 'a valid targetType is required');
  if (!targetSlug || typeof targetSlug !== 'string') throw new OperationError('bad-request', 'targetSlug is required');
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  let items = null;
  try {
    const all = await fetchCommentsIndex(ctx);
    const slugs = new Set([targetSlug, ...(Array.isArray(aliases) ? aliases : [])]);
    items = all
      .filter((c) => c?.targetType === targetType && slugs.has(c?.targetSlug) && (c?.status ?? 'published') === 'published')
      .sort(byCommentOldest)
      .slice(0, n);
  } catch {
    // The index is unreachable (offline build, a brand-new deploy mid-flight): the reader walk still works.
    if (typeof ctx.reader?.listComments !== 'function') return { items: [] };
    items = (await ctx.reader.listComments(targetType, targetSlug, n, Array.isArray(aliases) ? aliases : [])) ?? [];
  }
  const gated = gateMemberComments(items, await membershipOf(ctx)); // SOW-078: member comment stubs are tier-gated
  return { items: await mergeCommentEchoesFor(ctx, { targetType, targetSlug, deployed: gated }) }; // SOW-076
}


/**
 * SOW-031: read ANY published content index.md for the in-extension reader (cross-member, allowlist-gated),
 * unlike getContentItem which is own-folder-scoped for editing. The reader's `read` enforces isReadablePath
 * (only posts/products/prompts index.md, no traversal), so the member token / local clone cannot become a
 * general file-exfil oracle. Async so the SAME op serves the sync npm reader (repo-fs) and the async extension
 * (github) reader. requireIdentity only: the body is public-repo content (a members body comes back gated, its
 * .enc decrypted client-side via the Worker), but gating on a signed-in identity matches the extension dispatch.
 */
export async function readContent(ctx, { path } = {}) {
  requireIdentity(ctx);
  if (!path || typeof path !== 'string') throw new OperationError('bad-request', 'path is required');
  if (typeof ctx.reader?.read !== 'function') throw new OperationError('not-found', 'no such readable content');
  const item = await ctx.reader.read(path);
  if (!item) throw new OperationError('not-found', 'no such readable content');
  return item;
}


export async function getContentItem(ctx, { path } = {}) {
  const id = requireIdentity(ctx);
  if (!path) throw new OperationError('bad-request', 'path is required');
  // SOW-145, retargeted by sow-195: a NETWORK content item opens for a superadmin (re-checked) via the
  // general readFile, because reader.get is own-folder-scoped (it requires members/<caller>/) and would
  // reject members/gbtilabs/ for anyone who is not gbtilabs. That rejection is what surfaced in the
  // WorkBench as "Could not open that draft." once sow-195 moved the content out of house/.
  // A superadmin editing their OWN folder never reaches here; this branch is only the network folder.
  if (isNetworkContentPath(path) && id.username !== NETWORK_CONTENT_OWNER) {
    if (!NETWORK_CONTENT_PATH_RE.test(path)) throw new OperationError('bad-request', 'invalid network content path');
    await requireSuperadminForHouse(ctx);
    const text = await ctx.reader?.readFile?.(path);
    if (text == null) throw new OperationError('not-found', 'no such network content item');
    const { frontmatter, body } = parseContentFile(text);
    return { path, frontmatter, body };
  }
  const item = await ctx.reader.get(id.username, path);
  if (!item) throw new OperationError('not-found', 'no such item in your folder');
  return item;
}


/** Validate WITHOUT publishing. Never throws on a content error: returns { valid:false, ... } so a UI/agent can show it. */
export function validateContent(ctx, { type, input, body } = {}) {
  const id = requireIdentity(ctx);
  try {
    const built = buildContentFile({ type, username: id.username, input, body });
    return { valid: true, path: built.path };
  } catch (err) {
    if (err instanceof ContentValidationError) return { valid: false, error: err.message, issues: err.issues };
    return { valid: false, error: err.message };
  }
}

