// Shared operations core (SOW-006). The managed abstractions, transport-agnostic: the CMS HTTP API
// (api.mjs) and the MCP tools (mcp-tools.mjs) both call these, so the human UI and a member's agents drive
// the EXACT same content-ops + publish flow. None of this decides privilege: it scopes to the member's own
// folder and forces the gated fields (via content-ops), but the SOW-005 gate remains authoritative.
//
// Errors are typed OperationError(code, ...) so each transport can map a code to its own shape (HTTP status
// or MCP isError). Codes: no-identity | not-authenticated | not-found | bad-request | invalid-content.

import { buildContentFile, flipContentStatus, buildShareFile, shareId as makeShareId, buildCommentFile, commentId as makeCommentId, serializeContentFile, parseContentFile, contentPath, ContentValidationError, byCommentOldest, NETWORK_CONTENT_OWNER } from './content-ops.mjs';
import { publishContent, publishFiles, commitToBranchOnFork, branchName } from './publish.mjs';
import { canPublish, canStageDrafts, isBlockedFromPublishing, canSeeNews, canFollow, canSave, canBrowse, canSeeShares, fetchStripeStatus } from './membership.mjs';
import { splitMemberMarkdown, encAssetFor, encryptViaWorker, decryptViaWorker, MemberContentLockedError } from './member-content.mjs';
import {
  getActivity as workerGetActivity, setFavorite as workerSetFavorite, createCollection as workerCreateCollection,
  renameCollection as workerRenameCollection, deleteCollection as workerDeleteCollection,
  setCollectionItem as workerSetCollectionItem, ActivityClientError,
} from './member-activity-client.mjs';
import { getEarnings as workerGetEarnings } from './member-earnings-client.mjs'; // SOW-083 P2: the member's own earnings ledger
import { getCommentEchoes as workerGetCommentEchoes, addCommentEcho as workerAddCommentEcho, reapCommentEchoes as workerReapCommentEchoes } from './member-comment-echo-client.mjs'; // SOW-076
import { mergeCommentEchoes } from '../../membership/comment-echo.mjs'; // SOW-076
import { getFollows as workerGetFollows, setFollow as workerSetFollow, FollowsClientError } from './member-follows-client.mjs';
import { upvote as workerUpvote, UpvoteClientError } from './member-upvote-client.mjs'; // SOW-057
import { ogPreview as workerOgPreview, OgClientError } from './member-og-client.mjs'; // SOW-057
import { workerSyncFork } from './fork-sync-client.mjs'; // SOW-106 Phase A: the Worker-side fork-main sync
import { getDiscordInvite as workerGetDiscordInvite, InviteClientError } from './member-invite-client.mjs';
import { workerGetNews, workerGetNewsSources, workerGetPrefs, workerSetPrefs, workerPublishNews, workerNewsDiscussed, workerNewsOpened, workerContentOpened, NewsClientError } from './news-client.mjs'; // SOW-043/046: members-only news proxy + prefs + curator publish + discussion reflect; SOW-126 content-open beacon
import { probeReadiness } from './github-app-probe.mjs';
import {
  nextStep as onboardingNextStep, STEPS as ONBOARDING_STEPS, forkFullName,
  deviceVerificationUrl, forkUrl, appInstallUrl, manageInstallsUrl,
} from './onboarding.mjs';
import { SIGNUP_BASE, GITHUB_APP_SLUG, UPSTREAM_REPO, authModeFor, isHostedCtx } from './signup-base.mjs';
import { hostedAuthor, hostedItemId, hostedPublishFiles } from './hosted-publish.mjs'; // SOW-156/157: hosted-mode publish transport
import { workerListDrafts, workerPutDraft, workerDeleteDraft } from './drafts-client.mjs'; // SOW-157: the hosted draft store
import { workerListRepoDrafts } from './repo-drafts-client.mjs'; // sow-194: the committed repo-drafts listing
import { mergeRepoDrafts } from './repo-drafts-core.mjs'; // sow-194: shared repo-draft mapping + dedup
import { isContributionToFolder } from '../../membership/classify-pr.mjs';
import yaml from 'js-yaml';
import { rolesFromParsed, roleOf, isAdminRole } from '../../membership/overrides-core.mjs';
import { buildRoster } from '../../membership/superadmin-roster.mjs';
import { filterActivity } from '../../membership/member-activity.mjs';
import { getRosterStatuses as workerGetRosterStatuses, getDiscordChannels as workerGetDiscordChannels, triggerAdminOp as workerTriggerAdminOp, getSyndicationQueue as workerGetSyndicationQueue, cancelSyndication as workerCancelSyndication, approveSyndication as workerApproveSyndication, getSyndicateNow as workerGetSyndicateNow, syndicateNow as workerSyndicateNow, getSocialQueue as workerGetSocialQueue, socialQueueAction as workerSocialQueueAction, getCouponUsage as workerGetCouponUsage } from './member-admin-client.mjs';

export const CLIENT_VERSION = '0.1.0';

export class OperationError extends Error {
  constructor(code, message, details) {
    super(message || code);
    this.name = 'OperationError';
    this.code = code;
    this.details = details;
  }
}

function requireIdentity(ctx) {
  const id = ctx.identity?.();
  if (!id?.username) throw new OperationError('no-identity', 'no signed-in identity; run `gbti login`');
  return id;
}

function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'not authenticated; run `gbti login` first');
  return repo;
}

// SOW-145: authoring HOUSE content (list/read-for-edit/publish/status-flip of house/) is superadmin-only.
// Re-derive the caller's role from house/roles.yml via the host-agnostic reader (fail-closed: a missing/
// unreadable file leaves everyone a plain member), and require superadmin. The client toggle is hidden for
// non-superadmins, but this is the server-side re-check; the SOW-005 metadata-only gate + SOW-108 superadmin
// auto-merge stay the REAL enforcement (a forged non-superadmin house/** PR is Tier A -> rejected + closed).
async function requireSuperadminForHouse(ctx) {
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
const NETWORK_CONTENT_PATH_RE = new RegExp(`^members/${NETWORK_CONTENT_OWNER}/(posts|products|prompts)/[a-z0-9][a-z0-9-]*/index\\.md$`);

/** True for a path inside the network's own content folder (the superadmin-gated target). */
const isNetworkContentPath = (p) => String(p || '').startsWith(`members/${NETWORK_CONTENT_OWNER}/`);

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

/** SOW-089 fix: the awaited membership for read gating. Prefers ctx.membershipResolved (self-heals an
 *  'unknown' login-time cache from the oracle) and falls back to the sync cache; absent = 'unknown'. */
async function membershipOf(ctx) {
  const m = await (ctx.membershipResolved ? ctx.membershipResolved() : ctx.membership?.());
  return m ?? 'unknown';
}

// SOW-078: drop MEMBER-visibility comment stubs (author / timestamp / thread placement) for a caller who cannot read
// member content (not paid/trialing). The body is already gated to '' in the summary, but the metadata of the
// members-only conversation should not be served below the seeing tier. Public comments are kept for everyone.
function gateMemberComments(items, membership) {
  if (canSeeShares(membership ?? 'unknown')) return items ?? [];
  return (items ?? []).filter((c) => String(c?.visibility || 'public').toLowerCase() !== 'members');
}

// SOW-076: merge the caller's OWN optimistic comment echoes (read-your-writes) onto the deployed comments, reaping
// any that have landed (now deployed) or been declined. Best-effort + signed-in only: any failure (or a target the
// echo store does not handle) falls back cleanly to the deployed comments. News echoes work (2026-07-09).
async function mergeCommentEchoesFor(ctx, { targetType, targetSlug, deployed }) {
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
const COMMENT_TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share', 'news']); // SOW-046 D: 'news' enables news discussion
// SOW-014 + 2026-08-11: the content types that MAY carry a from-the-author note. NOT the types that REQUIRE
// one (product/prompt, enforced in validate-content.mjs) -- an article's note is optional. Mirrors
// workbench-client-core.mjs AUTHOR_NOTE_TYPES; a drift test asserts every copy agrees.
export const AUTHOR_NOTE_TYPES = new Set(['post', 'product', 'prompt']);
// SOW-089: the comments INDEX fast path. /comments-index.json is one CDN fetch carrying every published
// comment (public bodies inline; members rows pointer-only) — replacing the reader walk that downloaded
// every comment file sequentially (~12s on a real thread). A short-lived module cache avoids refetching per
// discussion within a session; the SOW-076 echoes keep read-your-writes freshness (a new comment echoes
// until deployed, so index + echoes is complete). The reader walk remains ONLY as the fetch-failure fallback.
const COMMENTS_INDEX_URL = 'https://gbti.network/comments-index.json';
const COMMENTS_INDEX_TTL_MS = 60_000;
let commentsIndexCache = null; // { at, items }

async function fetchCommentsIndex(ctx) {
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

/**
 * SOW-106: the MCP author entry. The caller MUST declare intent via `status`: "published" publishes (merge into
 * the network repo, which is public) and "draft" stages on the member fork for review. The status is the INTENT
 * and is NOT written into the content input (publish/saveDraft set the content status themselves, defaulting to
 * published), so nothing silently drafts. Throws `status-required` if the caller omits or mis-spells it.
 *
 * sow-193: `path` and `scope` are FORWARDED now. Before this they were simply absent from the signature while
 * publish() accepted both, and the three consequences were all silent:
 *   - a RENAME was impossible. publish() derives one from `path` via renameOriginOf, so with `path` undefined
 *     an agent re-publishing under a changed slug created a SECOND item and left the old page live.
 *   - `redirectFrom` was dropped, because the merge only happens inside the `if (oldFm)` branch that `path`
 *     unlocks, so the old URL never got its 301.
 *   - `scope: 'house'` could not be expressed at all from this entry point.
 * saveDraft takes `path` too (it stages a pending rename on the item's own branch) but has no house scope by
 * design (sow-145: house content publishes directly), so `scope` is only meaningful on the publish arm.
 */
export async function authorContent(ctx, { type, input, body, status, message, title, prBody, authorNote, path, scope } = {}) {
  if (status !== 'draft' && status !== 'published') {
    throw new OperationError('status-required', 'Specify status: "published" to publish (merge and go live on the network) or "draft" to stage on your fork for review before publishing.');
  }
  if (status === 'draft') return saveDraft(ctx, { type, input, body, message, path });
  return publish(ctx, { type, input, body, message, title, prBody, authorNote, path, scope });
}

/** Build + publish a content change as (or into) a PR through the gate. */
// SOW-112: the TRUE permalink rename. One PR moves the item to the new slug (redirectFrom carries the old
// public URL so the build emits a 301 and every slug-keyed reader aliases the old slug), deletes the old
// path, byte-moves the .enc sibling (the envelope AAD is self-referential, never path-bound), and moves +
// retargets the author's intro comment (the SOW-014 diff-scoped check demands it at the new slug). Blocked
// while a staged draft or an open PR exists for either slug (v1 safety), and fail-CLOSED when the old file
// cannot resolve on the branch base (the delete half needs it; the SOW-106 fork sync provides it) — never a
// half-move. Paid-only, own-folder, post/product/prompt only. publishedAt is preserved (feeds stay stable).
const RENAME_URL_BASE = { post: '/articles', product: '/products', prompt: '/prompts' };
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

// SOW-112 v2: resolve the ORIGIN of an edit — the canonical own-folder item the editor loaded (`path` in the
// publish/saveDraft payload). Returns { oldSlug, oldPath } when the path is the member's own item of the same
// type, else null. Identity threading: the slug in the FORM is the (possibly new) value; the path names what
// it was.
export function renameOriginOf({ path, username, type }) {
  const m = OWN_STATUS_PATH_RE.exec(String(path || ''));
  if (!m) return null;
  if (m[1] !== String(username).toLowerCase()) return null;
  if (m[2].slice(0, -1) !== type) return null;
  return { oldSlug: m[3], oldPath: String(path) };
}

// SOW-112 v2: the intro-comment move files (product/prompt): read intro-<old>.md, rewrite id + targetSlug to
// the new slug, emit the new file + the old delete. Empty when no intro exists. Shared by renameContent and
// the publish-time rename.
async function introMoveFiles(ctx, { username, type, oldSlug, newSlug }) {
  if (!['product', 'prompt'].includes(type)) return [];
  const oldIntro = `members/${username}/comments/intro-${oldSlug}.md`;
  const introText = await ctx.reader?.readFile?.(oldIntro);
  if (introText == null) return [];
  const intro = parseContentFile(introText);
  const introFm = { ...(intro.frontmatter ?? {}), id: `intro-${newSlug}`, targetSlug: newSlug };
  return [
    { path: `members/${username}/comments/intro-${newSlug}.md`, content: serializeContentFile(introFm, intro.body) },
    { path: oldIntro, content: null },
  ];
}

export async function renameContent(ctx, { path: rel, newSlug } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
  if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|products|prompts)/<slug>/index.md');
  if (m[1] !== String(id.username).toLowerCase()) {
    throw new OperationError('forbidden', 'you may only rename your own content');
  }
  const type = m[2].slice(0, -1);
  const oldSlug = m[3];
  const slug = String(newSlug || '').trim();
  if (!SLUG_RE.test(slug)) throw new OperationError('bad-request', 'the new permalink must be lowercase letters, digits, and hyphens');
  if (slug === oldSlug) return { ok: true, noop: true, slug };
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Renaming a published item requires a paid membership.', { membership });
  }

  // SOW-157: hosted mode has no fork; the staged-work safety loop and the fork base checks below are
  // fork-mode-only (the hosted branch is always fresh-based on live main, so the SOW-112 stale-base
  // failure cannot occur and the old file is verified via the canonical reader read further down).
  const hosted = isHostedCtx(ctx);
  if (!hosted) {
    const fork = await repo.ensureFork();
    // v1 safety: no rename while staged work or an open PR exists for either slug (the rename would strand them).
    for (const s of [oldSlug, slug]) {
      const branch = branchName(type, s);
      const staged = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
      if (staged) throw new OperationError('bad-request', `a staged draft exists for "${s}" — publish or discard it first`);
      const pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }).catch(() => null);
      if (pull) throw new OperationError('bad-request', `an open pull request exists for "${s}" — wait for it to merge or close it first`);
    }
  }

  const newPath = contentPath(type, id.username, slug);
  const collision = await repo.getFileContent(newPath).catch(() => null);
  if (collision != null) throw new OperationError('bad-request', `the permalink "${slug}" is already taken`);
  const oldText = await ctx.reader?.readFile?.(rel);
  if (oldText == null) throw new OperationError('not-found', `no such file: ${rel}`);

  const { frontmatter, body } = parseContentFile(oldText);
  const fm = { ...(frontmatter ?? {}) };
  const oldUrl = `${RENAME_URL_BASE[type]}/${oldSlug}/`;
  fm.slug = slug;
  fm.redirectFrom = [...new Set([...(Array.isArray(fm.redirectFrom) ? fm.redirectFrom : []), oldUrl])];
  fm.updatedAt = ctx.now?.() ?? new Date().toISOString(); // publishedAt is deliberately untouched

  const files = [];
  // The .enc sibling byte-moves (the envelope decrypts anywhere; nothing cross-checks its aad).
  if (typeof fm.encryptedBody === 'string' && fm.encryptedBody) {
    const oldEnc = fm.encryptedBody;
    const encText = await ctx.reader?.readFile?.(oldEnc);
    if (encText == null) throw new OperationError('not-found', `the encrypted body is missing: ${oldEnc}`);
    const { path: newEnc } = encAssetFor(type, id.username, slug);
    fm.encryptedBody = newEnc;
    files.push({ path: newEnc, content: encText }, { path: oldEnc, content: null });
  }
  files.push({ path: newPath, content: serializeContentFile(fm, body) }, { path: rel, content: null });
  // The from-the-author intro comment (product/prompt) moves + retargets in the same PR.
  files.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug, newSlug: slug }));

  const branch = `gbti/rename-${type}-${oldSlug}`;
  if (hosted) {
    const pr = await hostedPublishFiles(ctx, { branch, files, title: `Rename: ${oldSlug} -> ${slug}` });
    return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  // The delete half needs the old file ON the branch base; without it the move would half-apply. Fail closed.
  const fork = await repo.ensureFork();
  const base = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base).catch(() => null);
  const oldOnBase = baseSha ? await repo.getFileSha(fork.full_name, rel, base).catch(() => null) : null;
  if (!oldOnBase) {
    throw new OperationError('bad-request', 'the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — try again later or contact the co-op');
  }

  const pr = await publishFiles({
    repo, branch, files,
    message: `Rename ${type} ${oldSlug} -> ${slug}`,
    title: `Rename: ${oldSlug} -> ${slug}`,
    body: `Permalink rename (SOW-112). ${oldUrl} redirects to ${RENAME_URL_BASE[type]}/${slug}/ after the next deploy.`,
  });
  return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
}

// SOW-106 Phase B: a member's reversible self-unpublish/republish. Only their OWN post/product/prompt, only a
// status flip (visibility and every other field untouched), through the normal gated own-folder PR so the
// SOW-005 gate stays the authority. Idempotent: already in the requested state = a clean no-op, no PR.
const OWN_STATUS_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;

export async function setOwnContentStatus(ctx, { path: rel, status } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (status !== 'published' && status !== 'draft') {
    throw new OperationError('bad-request', 'status must be "published" or "draft"');
  }
  // SOW-145: a house/ status flip is superadmin-only (re-checked); the house branch is prefixed so it cannot
  // collide with a member item of the same slug. Otherwise the path must be the caller's own member folder.
  const houseTarget = isNetworkContentPath(rel);
  let type, slug, branch;
  if (houseTarget) {
    // Validate the content-path shape BEFORE the role gate: a non-content house path (house/roles.yml, a
    // traversal) is a plain bad-request for everyone, and only a well-formed house item reaches the superadmin
    // check, so a non-superadmin cannot probe which house paths exist via the error.
    const hm = NETWORK_CONTENT_PATH_RE.exec(String(rel || ''));
    if (!hm) throw new OperationError('bad-request', 'invalid house content path');
    await requireSuperadminForHouse(ctx);
    type = hm[1].slice(0, -1);
    slug = String(rel).split('/')[2];
    branch = `gbti/status-house-${type}-${slug}`;
  } else {
    const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
    if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|products|prompts)/<slug>/index.md');
    if (m[1] !== String(id.username).toLowerCase()) {
      throw new OperationError('forbidden', 'you may only change the status of your own content');
    }
    type = m[2].slice(0, -1);
    slug = m[3];
    branch = `gbti/status-${type}-${slug}`;
  }
  // The publishing lifecycle is paid-only (SOW-011); the gate is the real authority (unknown fails open to it).
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Changing a published item requires a paid membership.', { membership });
  }
  const text = await ctx.reader?.readFile?.(rel); // fresh canonical read (async-safe; preserves concurrent fields)
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const flip = flipContentStatus(text, status);
  if (!flip.changed) return { ok: true, noop: true, status };
  const verb = status === 'draft' ? 'Unpublish' : 'Republish';
  if (isHostedCtx(ctx)) {
    const pr = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: flip.content }], title: `${verb}: ${slug}` });
    return { ...pr, ok: true, status };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch); // SOW-106 Phase A: fresh-base the flip branch
  const pr = await publishFiles({
    repo, branch, files: [{ path: rel, content: flip.content }],
    message: `${verb} ${slug}`, title: `${verb}: ${slug}`,
    body: status === 'draft'
      ? 'Member unpublish: a reversible status flip to draft (SOW-106). The file stays in the repo; republishing reverses it.'
      : 'Member republish: the status flips back to published (SOW-106).',
  });
  return { ...pr, ok: true, status };
}

/**
 * SOW-106 Phase A: when the publish path is about to CREATE the per-item branch, first sync the fork's main
 * with upstream via the Worker (fork-installation token), so the new branch bases on a main that CONTAINS the
 * member's already-merged files and the PR is a clean modify diff instead of an add/add conflict. An EXISTING
 * branch is NEVER synced or moved (the SOW-053 stale-base protection for in-flight edits stays intact), and
 * every failure is a silent miss: the publish proceeds exactly as before, with the needs-rebase surfacing as
 * the backstop. Exported for unit tests.
 */
export async function syncForkIfCreatingBranch(ctx, repo, branch, { sync = workerSyncFork } = {}) {
  try {
    const fork = await repo.ensureFork();
    const exists = await repo.getBranchSha(fork.full_name, branch).then((sha) => Boolean(sha)).catch(() => false);
    // A branch WITH an open PR carries in-flight edits: never sync under it (SOW-053; the stale base is
    // what protects concurrent edits). A LEFTOVER branch (exists, but its PR already merged/closed) gets
    // the sync anyway: publish is about to force-reset it to the fork main (2026-07-09, PRs 95-97), and
    // resetting onto an UNSYNCED main would re-create the very conflict the reset exists to prevent.
    if (exists) {
      let open = null;
      try { open = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { open = { number: -1 }; }
      if (open) return { synced: false, reason: 'branch-exists' };
    }
    const token = ctx.store?.get?.('githubToken');
    return await sync({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch {
    return { synced: false, reason: 'error' };
  }
}

export async function publish(ctx, { type, input, body, message, title, prBody, authorNote, path, scope } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  // SOW-145: a house publish targets the non-member house/ folder (author stays 'gbti'). The scope is declared
  // by the caller (a NEW house item) or inferred from `path` (editing an existing house item). It is
  // superadmin-only, RE-CHECKED here server-side (never trust the client); the SOW-108 gate auto-merges a
  // superadmin house/** PR, and a forged non-superadmin one is Tier A -> rejected + closed by the gate.
  // sow-195: infer the network target from the members/gbtilabs/ prefix. Without this an edit loaded from
  // the network scope would publish into the ACTOR's own folder, silently misfiling the item instead of
  // failing visibly, so it has to move in the same change as the read side.
  const houseTarget = scope === 'house' || isNetworkContentPath(path);
  const targetScope = houseTarget ? 'house' : 'member';
  if (houseTarget) await requireSuperadminForHouse(ctx);
  // SOW-011: publishing to the canonical repo is paid-only. Block a KNOWN non-paid (trial / lapsed) member
  // BEFORE opening any PR, so their draft stays on their own fork and nothing reaches the canonical repo.
  // 'unknown' (oracle unreachable) fails OPEN to the SOW-005 gate, which is the real authority and rejects a
  // genuinely non-paid PR anyway, so a paid member is never wrongly blocked when the oracle is down.
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError(
      'membership-required',
      'Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.',
      { membership },
    );
  }
  // SOW-112 v2 (owner-directed): the rename happens AT THE PUBLISH EVENT. `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs from it makes this publish a RENAME (one PR: the new
  // path, the old path deleted, the old URL in redirectFrom so the build 301s and readers alias). Even without
  // a slug change, the old file's redirectFrom entries are merged in (a plain re-publish used to drop them).
  // House rename is deferred (SOW-145 v1): a house target never enters the rename path (origin stays null), so a
  // house edit is always a plain re-publish of the same slug. Member content keeps the full SOW-112 rename flow.
  const origin = houseTarget ? null : renameOriginOf({ path, username: id.username, type });
  let oldFm = null;
  if (origin) {
    const oldText = await ctx.reader?.readFile?.(origin.oldPath);
    if (oldText != null) oldFm = parseContentFile(oldText).frontmatter ?? {};
  }
  const effInput = { ...(input ?? {}) };
  const renaming = Boolean(oldFm) && typeof effInput.slug === 'string' && effInput.slug !== origin.oldSlug;
  if (oldFm) {
    const keep = Array.isArray(oldFm.redirectFrom) ? oldFm.redirectFrom : [];
    const oldUrl = renaming ? `${RENAME_URL_BASE[type]}/${origin.oldSlug}/` : null;
    const merged = [...new Set([...keep, ...(Array.isArray(effInput.redirectFrom) ? effInput.redirectFrom : []), ...(oldUrl ? [oldUrl] : [])])];
    if (merged.length) effInput.redirectFrom = merged;
    // A rename must not re-stamp publishedAt (feeds stay stable; the item is not new). The editor stamps it on
    // every publish, so restore the original here for the rename case only.
    if (renaming && oldFm.publishedAt) effInput.publishedAt = oldFm.publishedAt;
  }
  // Date parity with the WorkBench editor (SOW-062 P6), which stamps publishedAt/updatedAt at publish. The
  // MCP/API path never did, so an add_* item landed DATELESS: bottom of every feed, no date chip (hit live
  // 2026-07-09 with the /ci prompt). Preserve an existing item's publishedAt on a re-publish (read the
  // canonical file when the caller sent no `path`); stamp now for a genuinely new item; updatedAt bumps
  // whenever the item already existed.
  if (['post', 'product', 'prompt'].includes(type) && !effInput.publishedAt) {
    const nowIso = new Date().toISOString();
    let priorFm = oldFm;
    if (!priorFm && typeof effInput.slug === 'string' && effInput.slug) {
      const canonical = contentPath(type, id.username, effInput.slug, targetScope); // SOW-145: house -> house/<sub>/…
      let text = null;
      try { text = (await ctx.reader?.readFile?.(canonical)) ?? null; } catch { text = null; }
      // The MCP host without a local repoPath has no working reader (hit live 2026-07-10: a re-publish
      // stamped publishedAt to now); the repo client reads the canonical upstream file instead.
      if (text == null) { try { text = (await repo.getFileContent(canonical)) ?? null; } catch { text = null; } }
      if (text != null) { try { priorFm = parseContentFile(text).frontmatter ?? {}; } catch { priorFm = null; } }
    }
    effInput.publishedAt = priorFm?.publishedAt ?? nowIso;
    if (priorFm) effInput.updatedAt = nowIso;
  }
  let built;
  try {
    // SOW-106: publishing merges into the network repo, and merged content is PUBLIC. Force status: published (an
    // explicit caller status still wins), so a publish can never silently produce a hidden merged draft.
    built = buildContentFile({ type, username: id.username, input: { ...effInput, status: effInput.status || 'published' }, body, scope: targetScope });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  if (renaming) {
    // Collision pre-check (CI's unique-slug guard is the backstop) — the new path must not exist upstream.
    const collision = await repo.getFileContent(built.path).catch(() => null);
    if (collision != null) throw new OperationError('bad-request', `the permalink "${built.slug}" is already taken`);
  }

  // SOW-016: if the content is whole-item members-only or has a `<!-- members-only -->` section, encrypt the
  // gated markdown SERVER-SIDE (the Worker holds the key; it never reaches us) and commit the ciphertext plus
  // the public stub as ONE PR. Plain public content takes the unchanged single-file path.
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    // The Worker rejected encrypt with 401/403 (the author is not effective-paid). This is the fail-CLOSED
    // path when the local oracle was 'unknown': surface a clean upgrade nudge, and NO PR is opened.
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing member-only content requires a paid membership. Your draft is saved; upgrade at https://gbti.network and publish.', { membership });
    }
    throw err;
  }
  // SOW-014: a published product/prompt must carry a from-the-author intro comment IN THE SAME PR. When authorNote
  // is provided, seed intro-<slug>.md (public, authorNote:true) into this same publish, so validate-content's
  // diff-scoped intro check passes and a compliant prompt/product ships in ONE PR (deterministic id -> a re-publish
  // updates the same comment, never duplicating it).
  const introFile = buildIntroCommentFile({ username: id.username, built, authorNote, now: ctx.now?.() });
  // A descriptive PR title / commit message / body (used only when the caller gave none), so the pull request
  // reads clearly and the activity feed (which shows the PR title) is not a bare "Update".
  const desc = describeContentPublish(built, { hasIntro: Boolean(introFile) });
  const msg = message ?? desc.message;
  const ttl = title ?? desc.title;
  const bdy = prBody ?? desc.body;
  // SOW-156/157: hosted mode hands the file set to the Worker (no fork, no local commit); the Worker
  // commits to a canonical hosted branch and opens the auto-merging PR. A hosted RENAME needs none of the
  // SOW-112 fork dance below (that dance exists because fork branches base stale; the hosted branch is
  // ALWAYS fresh-based on live main), so it is just the old-path deletes + the intro move in the same
  // files[] — every path is own-folder, verified against the canonical reader.
  if (isHostedCtx(ctx)) {
    // sow-203: the NETWORK's content publishes from a hosted host like any other member folder. The refusal
    // that used to sit here (SOW-157, 2026-07-25) predated sow-195 and was broader than the rule it guarded.
    // Nothing special is needed: the Worker authorises a superadmin to write any member folder
    // (allowAnyFolder, sow-183) and the SOW-108 gate auto-merges the PR. The hosted image rule does not apply
    // either, because it is checked only against BINARY entries and a website upload is staged flat under the
    // acting caller's own folder (src/lib/workbench-client.ts stageImage), which that rule already accepts.
    const hostedRenameFiles = [];
    if (renaming) {
      const onMain = (await ctx.reader?.readFile?.(origin.oldPath)) != null;
      if (!onMain) throw new OperationError('bad-request', 'the original item could not be found on the network — refresh and try the rename again');
      hostedRenameFiles.push({ path: origin.oldPath, content: null });
      if (typeof oldFm?.encryptedBody === 'string' && oldFm.encryptedBody) hostedRenameFiles.push({ path: oldFm.encryptedBody, content: null });
      if (!introFile) {
        hostedRenameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
      } else {
        const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
        if ((await ctx.reader?.readFile?.(oldIntro)) != null) hostedRenameFiles.push({ path: oldIntro, content: null });
      }
    }
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(hostedRenameFiles);
    const r = await hostedAuthor({
      token: ctx.store?.get?.('githubToken'), itemId: hostedItemId(built.type, renaming ? origin.oldSlug : built.slug),
      files, title: ttl, signupBase: SIGNUP_BASE, fetchImpl: ctx.fetch ?? globalThis.fetch,
    });
    return renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r;
  }
  // SOW-112 v2: a rename rides the item's OWN branch (the staged-draft identity), carries the deletes of the
  // old path (+ its .enc; the new one was freshly encrypted above), and moves the intro comment — unless this
  // publish writes a fresh authorNote intro at the new slug already.
  const branch = branchName(built.type, renaming ? origin.oldSlug : built.slug, built.scope); // SOW-145: house prefix
  // SOW-106 Phase A: fresh-base a branch that is about to be created (best-effort; a miss changes nothing).
  await syncForkIfCreatingBranch(ctx, repo, branch);
  let renameFiles = [];
  if (renaming) {
    // The delete half must survive the PR DIFF, which is computed against the branch's MERGE BASE — not the
    // branch tip and not today's fork main. A draft branch cut from a stale base ADDS the old-path file (the
    // staged pending rename lives there), so deleting it on that branch nets to NOTHING in the diff and the
    // merged PR leaves the old page live (exactly how PR #67 half-landed). The only safe shape: verify the
    // old file on a FRESH fork main, then ALWAYS rebuild the branch from it — this publish rebuilds every
    // file from the submitted content, so the branch carries nothing worth keeping. An open PR blocks (the
    // rebuild would close it); the fail-closed message stays when the sync cannot provide the file.
    const fork = await repo.ensureFork();
    const base = await repo.getDefaultBranch(repo.upstream);
    const token = ctx.store?.get?.('githubToken');
    await workerSyncFork({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const onMain = await repo.getFileSha(fork.full_name, origin.oldPath, base).catch(() => null);
    if (!onMain) {
      throw new OperationError('bad-request', 'the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — your draft is saved; try publishing again later or contact the co-op');
    }
    const branchSha = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (branchSha) {
      const pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }).catch(() => null);
      if (pull) throw new OperationError('bad-request', `an open pull request exists for this item (#${pull.number}) — wait for it to merge or close it, then publish the rename`);
      await repo.deleteBranch(fork.full_name, branch).catch(() => {});
    }
    renameFiles.push({ path: origin.oldPath, content: null });
    if (typeof oldFm.encryptedBody === 'string' && oldFm.encryptedBody) renameFiles.push({ path: oldFm.encryptedBody, content: null });
    if (!introFile) {
      renameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
    } else {
      // A fresh authorNote intro ships at the new slug in this same publish; the OLD intro must still be
      // deleted or it survives as an orphan the alias union surfaces as a duplicate author note (hit in PR #68:
      // the editor prefills the note field from the existing intro, so renames practically always take this arm).
      const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
      if ((await ctx.reader?.readFile?.(oldIntro)) != null) renameFiles.push({ path: oldIntro, content: null });
    }
  }
  const withRename = (r) => (renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r);
  if (introFile || renaming) {
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(renameFiles);
    return withRename(await publishFiles({ repo, branch, files, message: msg, title: ttl, body: bdy }));
  }
  if (plan) {
    return withRename(await publishFiles({ repo, branch, files: plan.files, message: msg, title: ttl, body: bdy }));
  }
  return publishContent({ repo, change: built, message: msg, title: ttl, body: bdy });
}

/**
 * A descriptive PR title, commit message, and PR body for a content publish, built from the human title (not the
 * slug) plus the one-line description and category. Fixes the bare "Update" PR + the identical activity-feed entry
 * (gbti-activity-bell reads the PR title). Pure + exported for unit tests.
 */
export function describeContentPublish(built, { hasIntro } = {}) {
  const LABEL = { post: 'article', product: 'product', prompt: 'prompt', profile: 'profile' };
  const label = LABEL[built?.type] ?? built?.type ?? 'content';
  if (built?.type === 'profile') {
    const t = `Update the ${built.username} member profile`;
    return { title: t, message: t, body: `Update the ${built.username} member profile.` };
  }
  const name = built?.frontmatter?.title || built?.slug || label;
  const title = `Publish ${label}: ${name}`;
  const blurb = built?.frontmatter?.shortDescription || built?.frontmatter?.excerpt || '';
  const cats = Array.isArray(built?.frontmatter?.categories) ? built.frontmatter.categories.join(' > ') : '';
  const lines = [`## ${name}`, ''];
  if (blurb) lines.push(blurb, '');
  lines.push(`- Type: ${label}`);
  if (cats) lines.push(`- Category: ${cats}`);
  lines.push(`- Path: \`${built?.path ?? ''}\``);
  if (hasIntro) lines.push('- Includes the from-the-author intro comment.');
  lines.push('', '_Published through the GBTI Network client._');
  return { title, message: title, body: lines.join('\n') };
}

/**
 * SOW-014: build the from-the-author intro comment file, to commit in the SAME publish PR. Returns
 * { path, content } or null (no note, or a type that cannot carry one). Pure + exported for unit tests. The id
 * is deterministic (intro-<slug>) so a re-publish updates the same comment file, never duplicating it.
 * 2026-08-11: posts included. The note stays OPTIONAL for a post (validate-content requires one only for a
 * product/prompt); this returning null for a post is what silently discarded a note typed on an article.
 */
export function buildIntroCommentFile({ username, built, authorNote, now } = {}) {
  const note = String(authorNote ?? '').trim();
  if (!note || !built?.slug || !AUTHOR_NOTE_TYPES.has(built.type)) return null;
  const introBuilt = buildCommentFile({
    username,
    // SOW-145: a house product/prompt intro lands at house/comments/ with author 'gbti' (mirrors the item scope).
    scope: built.scope || 'member',
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: now ?? new Date().toISOString(),
      status: 'published',
      visibility: 'public',
      authorNote: true,
    },
    body: note,
  });
  return { path: introBuilt.path, content: introBuilt.markdown };
}

/**
 * SOW-016: plan the files for a member-only publish. Whole-item members-only, or a `<!-- members-only -->`
 * section, has its gated markdown encrypted (via the injected `encrypt`, which calls the Worker) and committed
 * as a sibling .enc, while index.md keeps only the public teaser plus an `encryptedBody` reference. Returns
 * { files, encPath, assetId } or null for plain public content. Pure over `encrypt`, so it is unit-testable.
 */
export async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null; // profiles + slugless types are never body-gated
  const vis = built.frontmatter?.visibility ?? 'public';
  let publicPart = '';
  let memberPart = null;
  if (vis === 'members') {
    memberPart = String(body ?? '').trim(); // whole-item: the ENTIRE body is gated (Mode A or B)
    if (!memberPart) return null; // a members item with an empty body: nothing to encrypt (plain publish)
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null; // plain public content (no marker): no encryption
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) {
      // The marker is present but the gated tail is empty. STRIP the marker (publicPart already excludes it)
      // and publish the public part as a plain post, so the literal `<!-- members-only -->` never reaches index.md.
      return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
    }
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope); // SOW-145: house -> house/_enc/
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return {
    files: [
      { path: built.path, content: markdown },
      { path: encPath, content: JSON.stringify(envelope) },
    ],
    encPath,
    assetId,
  };
}

// ----- SOW-082: universal draft staging. A draft is the item committed to its per-item branch gbti/<type>-<slug>
// on the member's FORK with NO open PR. Save commits there (no PR); Publish opens the PR from that same branch.
// Save is trial+paid (canStageDrafts); Publish stays paid-only (the SOW-005 gate is the backstop). -----

/** Parse a draft branch (gbti/<type>-<slug>, or gbti/profile) back to { type, slug }. Returns null for a branch
 *  that is not a draftable content item (e.g. gbti/share-*, gbti/comment-*), so those are skipped by listDrafts. */
function draftMetaFromBranch(branch) {
  if (branch === 'gbti/profile') return { type: 'profile', slug: null };
  const m = String(branch || '').match(/^gbti\/(post|product|prompt)-(.+)$/);
  return m ? { type: m[1], slug: m[2] } : null;
}

/** Save (stage) a content draft to the member's OWN fork on its deterministic branch, WITHOUT opening a PR.
 *  Trial + paid may stage (canStageDrafts); 'unknown' fails open (the fork write is the member's own repo).
 *  Members-only content needs the Worker to encrypt (paid only), so a trial member's members-only draft is
 *  refused with a clean upgrade nudge and NO branch is created. */
export async function saveDraft(ctx, { type, input, body, message, path } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (membership !== 'unknown' && !canStageDrafts(membership)) {
    throw new OperationError('forbidden', 'Saving drafts requires an active trial or paid membership.', { membership });
  }
  let built;
  try {
    // SOW-106: a fork-staged draft carries status: published (it is ready to publish; the "draft" is the fork
    // LOCATION, and the Drafts tab derives Staged/Submitted from the PR, not this field). So it merges public with
    // no publishDraft content rewrite. status: draft is reserved for the unpublish/disable state in the canonical repo.
    built = buildContentFile({ type, username: id.username, input: { ...(input ?? {}), status: (input && input.status) || 'published' }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  // SOW-112 v2: a permalink change stages ON THE ITEM'S OWN branch at its OLD path (the frontmatter slug is
  // the pending new value; the folder names what the item still is). Identity stays with the item — no silent
  // fork — and the publish event performs the actual move.
  const origin = renameOriginOf({ path, username: id.username, type: built.type });
  const staging = origin && built.slug !== origin.oldSlug ? origin : null;
  const branch = branchName(built.type, staging ? staging.oldSlug : built.slug);
  // SOW-157: a hosted member has no fork; drafts stage in the private, erasable KV store instead (which
  // also serves trial members: nothing staged here ever touches the canonical repo). The body is stored
  // plain (the store is per-member private); encryption happens at PUBLISH time via the normal plan.
  if (isHostedCtx(ctx)) {
    let fm = {};
    try { fm = parseContentFile(built.markdown).frontmatter ?? {}; } catch { fm = {}; }
    await workerPutDraft({
      draft: {
        type: built.type, slug: staging ? staging.oldSlug : built.slug,
        pendingSlug: staging ? built.slug : null,
        path: staging ? staging.oldPath : built.path, frontmatter: fm, body,
      },
      token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
    });
    return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: 'staged', hosted: true, ...(staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {}) };
  }
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Staging members-only content requires a paid membership. Save it as public, or upgrade to a paid membership.', { membership });
    }
    throw err;
  }
  let files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  if (staging) files = files.map((f) => (f.path === built.path ? { ...f, path: staging.oldPath } : f)); // the index stays at the old path
  // SOW-106 Phase A: fresh-base a branch that is about to be created (best-effort; a miss changes nothing).
  await syncForkIfCreatingBranch(ctx, repo, branch);
  await commitToBranchOnFork({ repo, branch, files, message: message ?? `Draft: ${built.slug ?? built.type}` });
  return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: 'staged', ...(staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {}) };
}

/** List the member's fork-staged drafts (the gbti/* branches on their fork). Each draft carries enough to render
 *  a row + open the editor; `pull` is the matched OPEN PR (or null) so the UI computes the lifecycle state via
 *  classifyDraft. Fail-soft per draft (an unreadable branch is skipped). */
/**
 * SOW-106 Phase 2: is a fork-staged file byte-identical to the LIVE network version (fully merged, nothing
 * pending)? Reads the live content via the reader (upstream is public) and compares the parsed frontmatter + body.
 * ANY difference, an unreadable live file, or a member-only item (encrypted body, which the stub alone cannot
 * compare) returns false, so a pending edit is NEVER mistaken for merged. Read-only; never throws.
 */
export async function forkContentMatchesLive(ctx, path, forkText) {
  try {
    const staged = parseContentFile(forkText);
    if (staged.frontmatter?.encryptedBody) return false; // member-only: the stub cannot prove the .enc is unchanged
    const live = await ctx.reader?.read?.(path);
    if (!live) return false;
    return String(staged.body ?? '').trim() === String(live.body ?? '').trim()
      && JSON.stringify(staged.frontmatter ?? {}) === JSON.stringify(live.frontmatter ?? {});
  } catch { return false; }
}

/**
 * sow-194: fetch the caller's committed repo drafts (status:draft items in the public repo) and merge them into
 * the fork/KV draft rows. FAIL-SOFT: a repo-drafts error (route down, not signed in) must NOT blank the Drafts
 * list, so a member still sees their fork/KV drafts. mergeRepoDrafts drops a repo row whose (type,slug) already
 * has a fork/KV draft (the editable copy wins) and filters repo rows to `type` when one is given.
 */
async function foldRepoDrafts(ctx, drafts, type) {
  let items = [];
  try {
    const token = ctx.store?.get?.('githubToken');
    const r = await workerListRepoDrafts({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    items = Array.isArray(r?.items) ? r.items : [];
  } catch { items = []; }
  return mergeRepoDrafts(drafts, items, { type });
}

export async function listDrafts(ctx, { type } = {}) {
  const id = requireIdentity(ctx);
  // SOW-157: hosted drafts come from the KV store; the same row shape, with no PR (drafts never open one).
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const drafts = [];
    for (const r of recs ?? []) {
      if (type && r.type !== type) continue;
      let valid = true;
      let invalidReason = null;
      try {
        buildContentFile({ type: r.type, username: id.username, input: r.frontmatter ?? {}, body: r.body ?? '' });
      } catch (err) {
        valid = false;
        invalidReason = err?.message || 'this draft no longer matches the current schema';
      }
      let rowPath = r.path;
      if (!rowPath) { try { rowPath = contentPath(r.type, id.username, r.slug); } catch { rowPath = null; } }
      drafts.push({
        type: r.type, slug: r.slug, branch: branchName(r.type, r.slug), path: rowPath,
        pendingSlug: r.pendingSlug ?? null,
        title: r.frontmatter?.title || r.frontmatter?.displayName || r.slug || r.type,
        visibility: r.frontmatter?.visibility || 'public',
        status: r.frontmatter?.status || 'draft',
        valid, invalidReason, pull: null,
        store: 'kv', // sow-194: the store discriminator, so a repo draft never collides with a KV draft
      });
    }
    return { drafts: await foldRepoDrafts(ctx, drafts, type) };
  }
  const repo = requireRepo(ctx);
  const fork = await repo.ensureFork();
  const refs = await repo.listMatchingRefs(fork.full_name, 'gbti/');
  const drafts = [];
  for (const { branch, sha } of refs) {
    const meta = draftMetaFromBranch(branch);
    if (!meta) continue;
    if (type && meta.type !== type) continue;
    let path;
    try { path = contentPath(meta.type, id.username, meta.slug); } catch { continue; }
    // Read by the ref's TIP SHA (immutable, never stale), NOT the branch name: a by-name contents read can lag
    // a just-pushed commit and serve the branch's CREATION state. A branch cut from a freshly SYNCED main is
    // live-identical at creation, so that stale read made the merged-branch cleanup below eat a brand-new
    // draft seconds after it was saved (hit in the wild 2026-07-06).
    let text = null;
    try { text = await repo.getForkFileContent(fork.full_name, path, sha || branch); } catch { text = null; }
    if (!text) continue;
    let fm = {};
    let draftBody = '';
    try { const parsed = parseContentFile(text); fm = parsed.frontmatter ?? {}; draftBody = parsed.body ?? ''; } catch { fm = {}; }
    // SOW-106 Phase C: schema-drift check. A draft saved under an older schema may no longer validate; surface
    // that on the row (and the editor prompts on open) instead of failing at publish time. One extra safeParse
    // on data already in hand; never throws the listing.
    let valid = true;
    let invalidReason = null;
    try {
      buildContentFile({ type: meta.type, username: id.username, input: fm, body: draftBody });
    } catch (err) {
      valid = false;
      invalidReason = err?.message || 'this draft no longer matches the current schema';
    }
    let pull = null;
    try { pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { pull = null; }
    // SOW-106 Phase 2: a staged draft with NO open PR whose content EXACTLY matches the LIVE network version is
    // fully merged (nothing pending). Clean up the lingering fork branch (member token; the content is preserved on
    // the network, so this loses nothing) and drop it, so a published item never lingers as a "Staged" draft.
    // Conservative: any pending edit, an open PR, or a member-only item keeps the draft.
    if (!pull && (await forkContentMatchesLive(ctx, path, text))) {
      try { await repo.deleteBranch(fork.full_name, branch); } catch { /* best-effort; a stale fork branch is harmless */ }
      continue;
    }
    drafts.push({
      type: meta.type,
      slug: meta.slug,
      branch,
      path,
      // SOW-112 v2: a frontmatter slug that differs from the branch identity is a PENDING RENAME (it applies
      // when the draft publishes). Surfaced so same-titled drafts are tellable apart in the Drafts tab.
      pendingSlug: typeof fm.slug === 'string' && fm.slug !== meta.slug ? fm.slug : null,
      title: fm.title || fm.displayName || meta.slug || meta.type,
      visibility: fm.visibility || 'public',
      status: fm.status || 'draft',
      valid,
      invalidReason,
      pull: pull ? { number: pull.number, html_url: pull.html_url } : null,
      store: 'fork', // sow-194: the store discriminator, so a repo draft never collides with a fork draft
    });
  }
  return { drafts: await foldRepoDrafts(ctx, drafts, type) };
}

/** Read one fork-staged draft (frontmatter + body) for the editor prefill. A members-only draft stores its body
 *  in the sibling .enc; decrypt it (the author is paid) so a re-save never replaces the gated text with a stub. */
export async function readDraft(ctx, { type, slug, store, path: repoPath } = {}) {
  const id = requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is a committed status:draft item at its canonical path in the PUBLIC repo. Read it via
  // the reader (upstream/canonical, not a fork branch or the KV store), decrypting a members-only body like a
  // fork draft. Route it BEFORE the hosted/fork branches so a repo draft never reads the wrong record. (The
  // canonical path arrives as `repoPath` to avoid shadowing the fork branch's own `let path` below.)
  if (store === 'repo') {
    let rel = repoPath;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path');
    let text = null;
    try { text = await ctx.reader?.readFile?.(rel); } catch { text = null; }
    if (text == null) throw new OperationError('not-found', `could not read the repo draft: ${rel}`);
    const { frontmatter, body } = parseContentFile(text);
    if (frontmatter?.encryptedBody) {
      try {
        const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
        return { path: rel, branch: null, store: 'repo', frontmatter, body: plain };
      } catch { /* the decrypt is unavailable (not paid): fall through to the public part */ }
    }
    return { path: rel, branch: null, store: 'repo', frontmatter, body };
  }
  // SOW-157: a hosted draft's restore state (frontmatter + plain body) comes straight from the KV record.
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
    if (!rec) throw new OperationError('not-found', 'no such draft');
    let recPath = rec.path;
    if (!recPath) { try { recPath = contentPath(type, id.username, slug); } catch { recPath = null; } }
    return { path: recPath, branch: branchName(type, slug), frontmatter: rec.frontmatter ?? {}, body: rec.body ?? '' };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let path;
  try { path = contentPath(type, id.username, slug); } catch (err) { throw new OperationError('bad-request', err.message); }
  const text = await repo.getForkFileContent(fork.full_name, path, branch);
  if (!text) throw new OperationError('not-found', 'no such draft on your fork');
  const { frontmatter, body } = parseContentFile(text);
  if (frontmatter?.encryptedBody) {
    try {
      const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
      return { path, branch, frontmatter, body: plain };
    } catch { /* the decrypt is unavailable (not paid): fall through to the public part */ }
  }
  return { path, branch, frontmatter, body };
}

/** Discard a fork-staged draft (delete its branch). Refuses when an open PR exists (deleting the branch would
 *  abruptly close the PR + lose the review thread); the member withdraws the PR first. */
export async function discardDraft(ctx, { type, slug, store } = {}) {
  requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is committed to the public repo; discarding it is a delete request, not a from-here
  // action. Refuse with a recognizable code (never a silent no-op, and never a KV/fork delete of the wrong
  // record). Route BEFORE the hosted/fork branches.
  if (store === 'repo') throw new OperationError('unsupported', 'This draft is committed to the network and cannot be discarded here. Publish it, or open a removal request.');
  // SOW-157: a hosted discard is a KV delete (idempotent; no branch, no PR to strand).
  if (isHostedCtx(ctx)) {
    await workerDeleteDraft({ type, slug, token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { ok: true, branch: branchName(type, slug), hosted: true };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let pull = null;
  try { pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { pull = null; }
  if (pull) throw new OperationError('bad-request', 'This draft has an open pull request; withdraw it from review before discarding.', { prNumber: pull.number });
  try {
    await repo.deleteBranch(fork.full_name, branch);
  } catch (err) {
    // SOW-112 QA fix: the branch may already be gone (the merged-branch cleanup runs during any drafts
    // listing, so a stale row can outlive its branch). An already-deleted branch IS the discarded state —
    // verify and succeed instead of surfacing GitHub's 422 "Reference does not exist" for a done deed.
    const still = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (still) throw err; // the branch exists but the delete failed: a real error
    return { ok: true, branch, alreadyGone: true };
  }
  return { ok: true, branch };
}

/** Publish a staged draft to the network: open the canonical PR from the branch Save already created (no rebuild,
 *  so a members-only draft's encrypted files round-trip untouched). Paid-only — the gate stays the backstop. */
export async function publishDraft(ctx, { type, slug, title, prBody, store, path } = {}) {
  const id = requireIdentity(ctx);
  // sow-194: publishing a repo draft is the draft->published status flip on the canonical item, NOT a fork PR.
  // setOwnContentStatus handles hosted-vs-fork AND member-vs-house scope AND the paid gate, so route to it BEFORE
  // requireRepo/the fork path (the 5th short-circuit site PublicationMaster flagged is covered inside it).
  if (store === 'repo') {
    let rel = path;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path to publish');
    return setOwnContentStatus(ctx, { path: rel, status: 'published' });
  }
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.', { membership });
  }
  // SOW-157: a hosted draft publishes through the normal publish op (validation + member-content encryption
  // + the hosted Worker commit), then leaves the staging store — its content now lives on the network and
  // the submitted PR shows in the workspace via the hosted my-pulls match.
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
    if (!rec) throw new OperationError('not-found', 'no such draft');
    const r = await publish(ctx, {
      type, input: rec.frontmatter ?? {}, body: rec.body ?? '', title, prBody,
      ...(rec.pendingSlug && rec.path ? { path: rec.path } : {}), // a pending rename applies at the publish event (SOW-112)
    });
    try { await workerDeleteDraft({ type, slug, ...opts }); } catch { /* best-effort; a stale staged copy is harmless */ }
    return { ...r, ok: true, hosted: true };
  }
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  const head = `${fork.owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, updated: true };
  // SOW-112 v2: a PENDING-RENAME draft (frontmatter slug differs from the branch identity) must NOT ship the
  // raw branch (its file sits at the old path with the new slug — a half-rename). Route it through the full
  // publish, which performs the move (deletes + intro + redirectFrom) from this same branch. The draft's
  // frontmatter is input-shaped (the same round-trip the schema-drift check uses).
  if (type !== 'profile') {
    const oldPath = contentPath(type, id.username, slug);
    const text = await repo.getForkFileContent(fork.full_name, oldPath, branch).catch(() => null);
    if (text != null) {
      const parsed = parseContentFile(text);
      const fm = parsed.frontmatter ?? {};
      if (typeof fm.slug === 'string' && fm.slug !== slug) {
        // Publishing IS the publish event: force status published (the staged file may carry status draft).
        return publish(ctx, { type, input: { ...fm, status: 'published' }, body: parsed.body, path: oldPath, title, prBody });
      }
    }
  }
  const base = await repo.getDefaultBranch(repo.upstream);
  const titleText = title ?? (type === 'profile' ? `Update ${id.username}'s profile` : `${type}: ${slug}`);
  const pull = await repo.openPull({ title: titleText, head, base, body: prBody ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, updated: false };
}

/**
 * SOW-016 read path: decrypt a member-only .enc asset for the signed-in member. The host reads the ciphertext
 * via its reader (fs / GitHub Contents API) and asks the Worker to decrypt it; the AES key never reaches the
 * client. Returns { text } (the plaintext markdown). A non-effective-paid member -> membership-required.
 */
// A member-only asset path is ALWAYS members/<owner>/_enc/<name>.enc or house/_enc/<name>.enc (encAssetFor).
// Validate it so the decrypt route cannot be pointed at an arbitrary repo file (a member can hand-edit their
// frontmatter encryptedBody): only an .enc under an _enc/ dir, no traversal. SOW-031 hardening.
const ENC_PATH_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/_enc\/[a-z0-9][a-z0-9._-]*\.enc$/;

export async function decryptMemberAsset(ctx, { encPath } = {}) {
  requireIdentity(ctx);
  if (!encPath || typeof encPath !== 'string') throw new OperationError('bad-request', 'encPath is required');
  if (!ENC_PATH_RE.test(encPath)) throw new OperationError('bad-request', 'invalid encrypted-asset path');
  let raw;
  try {
    raw = await ctx.reader.readFile(encPath);
  } catch {
    throw new OperationError('not-found', `could not read the encrypted asset: ${encPath}`);
  }
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new OperationError('bad-request', 'the encrypted asset is not a valid envelope'); }
  const token = ctx.store?.get?.('githubToken');
  try {
    const text = await decryptViaWorker({ envelope, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { text };
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'This content is for paid members. Upgrade at https://gbti.network to unlock.');
    }
    throw new OperationError('decrypt-failed', err?.message || 'could not decrypt the asset');
  }
}

/**
 * SOW-018: publish a member "Share" (a status update) into the member's own shares/ folder. A members Share
 * (the default) has its body encrypted SERVER-SIDE (the Worker holds the key, SOW-016) and is committed as a
 * stub .md + a sibling .enc in ONE PR; a public Share is a single plain .md. Paid-only (SOW-011): a known
 * non-paid member is blocked BEFORE any PR opens. The id is a sortable timestamp-slug derived from createdAt.
 */
export async function publishShare(ctx, { input = {}, body = '', message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Posting Shares on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to post your Share.', { membership });
  }
  // INVARIANT (SOW-018): a Share's id ENCODES its createdAt (makeShareId derives the timestamp-slug from it),
  // and Shares are append-only — never re-timestamped after publish. So the id-filename order always tracks the
  // createdAt order, which is what lets the extension feed select the newest Shares by filename before reading.
  const createdAt = input.createdAt ?? (ctx.now?.() ?? new Date().toISOString());
  const id_ = input.id ?? makeShareId(createdAt, input.title);
  let built;
  try {
    built = buildShareFile({ username: id.username, input: { ...input, id: id_, createdAt }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members Share -> encrypts the whole body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing a members-only Share requires a paid membership. Upgrade at https://gbti.network.', { membership });
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  const shareTitle = title ?? `New Share${built.frontmatter.title ? `: ${built.frontmatter.title}` : ''}`;
  const pr = isHostedCtx(ctx)
    ? await hostedPublishFiles(ctx, { branch: `gbti/share-${id_}`, files, title: shareTitle }) // SOW-157: no fork
    : await publishFiles({
        repo,
        branch: `gbti/share-${id_}`, // idempotent by branch: re-publishing the same id updates the same PR
        files,
        message: message ?? `Share: ${built.frontmatter.title || id_}`,
        title: shareTitle,
        body: prBody,
      });
  // SOW-092: spread the PR handle (prNumber/prUrl/updated) like the comment op does, so the composer ack
  // can cite the real PR (it used to read an undefined prNumber). The explicit fields win on collision.
  return { ...pr, id: id_, path: built.path, visibility: built.frontmatter.visibility ?? 'members', encrypted: Boolean(plan?.encPath) };
}

// SOW-027: member comment authoring. Comments are one flat file per comment in the member's own comments/
// folder (auto-merge own-folder, SOW-005), paid-only to publish (SOW-011). A public comment is plain; a members
// comment encrypts its body (SOW-016, like shares). Editing re-publishes the same id with `updatedAt` set, so
// the SOW-014 "edited . view history" link (the git history) appears. The data model + render already exist.
const commentSuffix = () => Math.random().toString(36).slice(2, 8); // short collision-avoidance suffix for the id

async function planAndPublishComment(ctx, repo, built, body, { message, title, prBody }) {
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members comment -> encrypt the body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Posting a members-only comment requires a paid membership. Upgrade at https://gbti.network.');
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  // Idempotent by branch: re-editing the same comment id updates the same PR (hosted reuses one hosted branch).
  const pr = isHostedCtx(ctx)
    ? await hostedPublishFiles(ctx, { branch: `gbti/comment-${built.id}`, files, title })
    : await publishFiles({ repo, branch: `gbti/comment-${built.id}`, files, message, title, body: prBody });
  // SOW-072 P2: spread the PR handle (prNumber/prUrl/updated) so the comment ack + the MCP post_comment can report
  // it (publishFiles returns it; this op used to discard it). The explicit fields win on any key collision.
  return { ...pr, id: built.id, path: built.path, visibility: built.frontmatter.visibility ?? 'public', encrypted: Boolean(plan?.encPath) };
}

export async function publishComment(ctx, { targetType, targetSlug, body, authorNote, parentId, visibility, message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Commenting on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to join the conversation.', { membership });
  }
  const createdAt = ctx.now?.() ?? new Date().toISOString();
  const cid = makeCommentId(createdAt, commentSuffix());
  const input = { id: cid, targetType, targetSlug, createdAt, status: 'published' };
  // SOW-044: comments are members-only + encrypted. The ONLY public comment is a from-the-author intro
  // (authorNote) on a post/product/prompt; a discussion reply, and ANY comment on a Share, is always members. The
  // server is the boundary: coerce anything that is not a legitimate public intro to members, regardless of what
  // the client sent (a members body is then encrypted by planMemberFiles, never committed plaintext).
  const isPublicIntro = authorNote === true && ['post', 'product', 'prompt'].includes(targetType);
  input.visibility = (visibility === 'public' && isPublicIntro) ? 'public' : 'members';
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  let built;
  try {
    built = buildCommentFile({ username: id.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: message ?? `Comment on ${targetType} ${targetSlug}`,
    title: title ?? `Comment on ${targetType}: ${targetSlug}`,
    prBody,
  });
  const out = { ...r, targetType: built.frontmatter.targetType, targetSlug: built.frontmatter.targetSlug };
  // SOW-076: optimistic echo so the AUTHOR's own comment appears instantly (read-your-writes) while the SOW-072 PR
  // auto-merges + the site rebuilds behind it. Best-effort + fire-and-forget; the durable PR is the source of truth.
  const echoToken = ctx.store?.get?.('githubToken');
  if (echoToken && out.prNumber) {
    workerAddCommentEcho({
      echo: { id: cid, targetType: out.targetType, targetSlug: out.targetSlug, body, prNumber: out.prNumber, createdAt },
      token: echoToken, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
    }).catch(() => {});
  }
  return out;
}

/** Read one of the member's OWN comments (frontmatter + body), for the edit-form prefill. A members comment
 *  stores its body in the .enc (the stub .md body is EMPTY), so decrypt it for the prefill — otherwise editing
 *  would start from a blank textarea and a save would replace the gated text (silent data loss). The signed-in
 *  author IS the owner + effective-paid, so the Worker decrypt succeeds. */
// SOW-112 QA: a member deletes their OWN comment — an own-folder file delete whose PR auto-merges through
// the gate. Paid-gated like publishComment (the gate is the backstop); the comment leaves the site at the
// next deploy. Hard delete by owner intent; git history retains it (the moderation-ops caveat applies).
export async function deleteComment(ctx, { id } = {}) {
  const identity = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const cid = String(id || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(cid)) throw new OperationError('bad-request', 'a comment id is required');
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Managing comments on the network requires a paid membership.', { membership });
  }
  const rel = `members/${identity.username}/comments/${cid}.md`;
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such comment: ${cid}`);
  const fm = parseContentFile(text).frontmatter ?? {};
  if (String(fm.author || '').toLowerCase() !== String(identity.username).toLowerCase()) {
    throw new OperationError('forbidden', 'you may only delete your own comments');
  }
  const branch = `gbti/comment-delete-${cid}`;
  if (isHostedCtx(ctx)) {
    const pr = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: null }], title: `Delete comment: ${cid}` });
    return { ...pr, ok: true, id: cid, path: rel };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  const pr = await publishFiles({
    repo, branch,
    files: [{ path: rel, content: null }],
    message: `Delete comment ${cid}`,
    title: `Delete comment: ${cid}`,
    body: 'The author removed their own comment.',
  });
  return { ...pr, ok: true, id: cid, path: rel };
}

export async function getComment(ctx, { id } = {}) {
  const idn = requireIdentity(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const item = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!item) throw new OperationError('not-found', 'no such comment in your folder');
  const enc = item.frontmatter?.encryptedBody;
  if (enc) {
    const { text } = await decryptMemberAsset(ctx, { encPath: enc }); // reads the .enc + Worker-decrypts; key stays in the Worker
    return { ...item, body: text };
  }
  return item;
}

export async function editComment(ctx, { id, body, authorNote } = {}) {
  const idn = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Editing a comment on gbti.network requires a paid membership. Upgrade at https://gbti.network.', { membership });
  }
  const existing = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!existing) throw new OperationError('not-found', 'no such comment in your folder');
  // Own-folder scope is enforced by reader.get (rejects out-of-folder paths) AND re-checked here.
  if (existing.frontmatter?.author && existing.frontmatter.author !== idn.username) {
    throw new OperationError('not-authorized', 'you can only edit your own comments');
  }
  const fm = existing.frontmatter ?? {};
  const updatedAt = ctx.now?.() ?? new Date().toISOString();
  // SOW-044: re-derive visibility the SAME way publishComment does, so an edit can NEVER strand a comment as a
  // public non-intro (or a public Share comment) with a plaintext body. A comment is public only as a
  // from-the-author intro (authorNote) on a post/product/prompt; anything else is coerced to members and its body
  // is re-encrypted on re-publish. Symmetric with publishComment (the CI guards are the backstop, not the boundary).
  const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
  const isPublicIntro = effAuthorNote && ['post', 'product', 'prompt'].includes(fm.targetType);
  // Preserve identity-defining fields; set updatedAt so the "edited . view history" link renders.
  const input = {
    id,
    targetType: fm.targetType,
    targetSlug: fm.targetSlug,
    status: fm.status ?? 'published',
    visibility: (fm.visibility === 'public' && isPublicIntro) ? 'public' : 'members',
    authorNote: effAuthorNote,
    parentId: fm.parentId,
    createdAt: fm.createdAt,
    updatedAt,
  };
  let built;
  try {
    built = buildCommentFile({ username: idn.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: `Edit comment ${id}`,
    title: `Edit comment on ${fm.targetType}: ${fm.targetSlug}`,
    prBody: undefined,
  });
  // Carry the target back (mirrors publishComment) so the gbti-comment-edited event can refresh the right open
  // thread (e.g. the SOW-032 Shares discussion, keyed on the composite targetSlug).
  return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
}

// SOW-024: member activity (favorites + collections) in the deletable edge store, via the signup Worker.
// Collections let a member organize prompts (and posts/products) into named lists, in addition to favoriting.
// The host holds the member's GitHub token; signupBase is the Worker. Errors map to OperationError codes.
function mapActivityError(err) {
  if (err instanceof ActivityClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to manage favorites and collections.');
  }
  return new OperationError('activity-failed', err?.message || 'the activity request failed');
}

// SOW-050 P2: an optional `types` filter (a list of content types) narrows the returned favorites + collection
// items server-side. Omitted/empty -> the full activity, unchanged (additive; no storage migration).
export async function getMemberActivity(ctx, { types } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetActivity({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const activity = r?.activity ?? { favorites: [], collections: [] };
    return Array.isArray(types) && types.length ? filterActivity(activity, types) : activity;
  } catch (err) {
    throw mapActivityError(err);
  }
}

/** SOW-083 P2: the signed-in member's own earnings ledger (the SOW-059 revenue dashboard data), via the Worker. */
export async function getMemberEarnings(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerGetEarnings({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new Error(err?.message || 'could not load earnings');
  }
}

export async function mutateMemberActivity(ctx, payload = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  try {
    switch (payload.action) {
      case 'favorite': return await workerSetFavorite({ ...payload, ...opts });
      case 'collection.create': return await workerCreateCollection({ ...payload, ...opts });
      case 'collection.rename': return await workerRenameCollection({ ...payload, ...opts });
      case 'collection.delete': return await workerDeleteCollection({ ...payload, ...opts });
      case 'collection.item': return await workerSetCollectionItem({ ...payload, ...opts });
      default: throw new OperationError('bad-request', 'unknown activity action');
    }
  } catch (err) {
    if (err instanceof OperationError) throw err;
    throw mapActivityError(err);
  }
}

// SOW-023: the follow graph (subscriptions). Effective-paid only (the Worker is the authority, fail-closed);
// a follow writes the private, erasable edge store, never a PR.
function mapFollowsError(err) {
  if (err instanceof FollowsClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to follow members.');
  }
  return new OperationError('follows-failed', err?.message || 'the follows request failed');
}

/** The signed-in member's follow list ({ following: [{ username, addedAt }] }). */
export async function getFollows(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetFollows({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}

/** Follow (on:true) or unfollow (on:false) a member by username. Returns the updated following list. */
export async function setFollow(ctx, { username, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerSetFollow({ username, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}

/** SOW-057: toggle the caller's upvote on a share (effective-paid; the Worker enqueues syndication at the
 *  threshold). Returns { upvoted, upvoteCount, enqueued }. */
export async function upvoteContent(ctx, { type = 'share', slug, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerUpvote({ type, slug, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { upvoted: !!r?.upvoted, upvoteCount: r?.upvoteCount, enqueued: !!r?.enqueued };
  } catch (err) {
    if (err instanceof UpvoteClientError) throw new OperationError('upvote-failed', err.message);
    throw err;
  }
}

/** SOW-057: fetch a link's OpenGraph preview ({ image, title, description }) via the Worker (SSRF-guarded). */
export async function ogPreview(ctx, { url } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerOgPreview({ url, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    if (err instanceof OgClientError) throw new OperationError('og-preview-failed', err.message);
    throw err;
  }
}

/** SOW-058: the superadmin syndication queue (admin-gated; the Worker enforces). Returns { pending, sent, cancelled, failed }. */
export async function getSyndicationQueue(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSyndicationQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-058: cancel/reject a pending or approved syndication item (SUPERADMIN only; the Worker enforces). */
export async function cancelSyndication(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerCancelSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-058: approve a pending syndication item (SUPERADMIN only; the Worker enforces) so the drain posts it. */
export async function approveSyndication(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerApproveSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-121: the superadmin Social Queue read (manual-assist tasks: pending + done). */
export async function getSocialQueue(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSocialQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-121: mark a manual-assist task done or delete it (SUPERADMIN only; the Worker enforces). */
export async function socialQueueAction(ctx, { action, id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerSocialQueueAction({ action, id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-088: the Manually Syndicate readiness read (SUPERADMIN only; the Worker enforces). */
export async function getSyndicateNowInfo(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSyndicateNow({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/** SOW-088: post one item to one destination NOW (SUPERADMIN only; the Worker renders + sanitizes). */
export async function syndicateNow(ctx, { destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerSyndicateNow({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}

/**
 * The on-demand Discord invite for the welcome view. The bot mints/caches the invite in the Worker (token never
 * leaves it); this returns { url, source }. requireIdentity only; the Worker re-verifies the token. Failures map
 * to an OperationError so the welcome view can fall back to the static DISCORD_INVITE_URL.
 */
// SOW-043: the members-only news feed (proxied through the signup Worker, which holds NEWS_API_KEY). Effective-paid
// gated server-side; a non-paid/locked caller -> membership-required. Returns { items, updatedAt }.
export async function getNews(ctx, { category, since, limit } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerGetNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, category, since, limit });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in to read the news.');
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', 'News is a members-only perk. Upgrade at https://gbti.network.');
    throw new OperationError('news-failed', err?.message || 'the news request failed');
  }
}

// SOW-046 E: the followable news channels (sources) + the member's prefs (categories + followed channels). All
// paid-gated server-side; map the client errors to the standard codes.
function mapNewsErr(err, what) {
  if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', `Sign in to ${what}.`);
  if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', `${what} is a members-only perk. Upgrade at https://gbti.network.`);
  throw new OperationError('news-failed', err?.message || `the ${what} request failed`);
}
export async function getNewsSources(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerGetNewsSources({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch }); }
  catch (err) { mapNewsErr(err, 'browse news channels'); }
}
export async function getPrefs(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerGetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch }); }
  catch (err) { mapNewsErr(err, 'read your preferences'); }
}
export async function setPrefs(ctx, { categories, followChannel, publicFavorites } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  // SOW-114: publicFavorites = the member's opt-in to the public "Favorited by" list. JSON.stringify drops
  // undefined keys, so an absent field never touches the stored value.
  try { return await workerSetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, patch: { categories, followChannel, publicFavorites } }); }
  catch (err) { mapNewsErr(err, 'save your preferences'); }
}

// SOW-046 C: curator-only "Add to Discord". The Worker holds the bot token + re-checks the curator capability, so
// a non-curator member gets a clean membership-required-style error rather than a generic failure.
export async function publishNews(ctx, { item } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerPublishNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, item }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in to publish to Discord.');
    if (err instanceof NewsClientError && /curator/i.test(err.message)) throw new OperationError('forbidden', 'Publishing news to Discord requires a curator role.');
    throw new OperationError('news-failed', err?.message || 'could not publish to Discord');
  }
}

// SOW-046 D: best-effort reflect of a news discussion onto Discord (the Worker appends a one-time notice to the
// curator-posted message). Fire-and-forget from the UI after a comment posts; an error here never blocks the
// comment, so map failures to a soft news-failed and let the caller ignore it.
export async function reflectNewsDiscussion(ctx, { guid } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerNewsDiscussed({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', 'News discussion is a members-only perk.');
    throw new OperationError('news-failed', err?.message || 'could not reflect the discussion');
  }
}

// SOW-111: best-effort record of a news detail-open (the engagement beacon). Fire-and-forget from the reader;
// the Worker answers { counted:false } for out-of-tier or disabled config, so only auth/transport errors reach
// here and the reader swallows them (an open must never surface an error).
export async function recordNewsOpen(ctx, { guid, source } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerNewsOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid, source }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    throw new OperationError('news-failed', err?.message || 'could not record the open');
  }
}

// SOW-126: best-effort record of a member-content detail-open (the engagement beacon). Fire-and-forget from the
// reader; the Worker answers { counted:false } for out-of-tier or a disabled config, so only auth/transport
// errors reach here and the reader swallows them (an open must never surface an error).
export async function recordContentOpen(ctx, { type, slug } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerContentOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, type, slug }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    throw new OperationError('news-failed', err?.message || 'could not record the open');
  }
}

export async function getDiscordInvite(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetDiscordInvite({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { url: r?.url ?? null, source: r?.source ?? null };
  } catch (err) {
    if (err instanceof InviteClientError && /not signed in/i.test(err.message)) {
      throw new OperationError('not-authenticated', 'Sign in to get a Discord invite.');
    }
    throw new OperationError('invite-failed', err?.message || 'the Discord invite request failed');
  }
}

// SOW Part C: ask the Worker (with the member's GitHub App token) for a one-time SIGNED Discord-link URL the host
// opens in a tab. Token-bound (not website-session-bound), so it works for any signed-in extension member.
export async function getDiscordLinkUrl(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'Sign in to connect Discord.');
  const fetch = ctx.fetch ?? globalThis.fetch;
  let res;
  try { res = await fetch(`${SIGNUP_BASE}/discord/link/init`, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (err) { throw new OperationError('discord-link-failed', err?.message || 'the Discord link request failed'); }
  if (!res.ok) throw new OperationError('discord-link-failed', `the Discord link request failed (${res.status})`);
  const data = await res.json().catch(() => null);
  if (!data || !data.url) throw new OperationError('discord-link-failed', 'no link URL returned');
  return { url: data.url };
}

// sow-218: disconnect the member's Discord account. Unlike the status poll above this WRITES, so it reports
// failure honestly rather than fail-closing to a default: the member is about to be told their account is
// disconnected, and a swallowed error would leave them believing it when it is not. The Worker strips the
// managed roles BEFORE clearing the link, so a partial failure never strands guild access reconcile cannot see.
export async function discordUnlink(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'Sign in to disconnect Discord.');
  const fetch = ctx.fetch ?? globalThis.fetch;
  let res;
  try { res = await fetch(`${SIGNUP_BASE}/discord/unlink`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }
  catch (err) { throw new OperationError('discord-unlink-failed', err?.message || 'the Discord disconnect request failed'); }
  if (!res.ok) throw new OperationError('discord-unlink-failed', `the Discord disconnect failed (${res.status})`);
  const data = await res.json().catch(() => null);
  return { ok: Boolean(data && data.ok), unlinked: Boolean(data && data.unlinked) };
}

// SOW: the welcome polls this after opening the Discord OAuth tab, to auto-detect the link and advance. Read-only
// and fail-closed: any error / no token -> { linked: false } (never throws, so a poll loop never crashes).
export async function getDiscordLinkStatus(ctx) {
  const token = ctx.store?.get?.('githubToken');
  if (!token) return { linked: false };
  const fetch = ctx.fetch ?? globalThis.fetch;
  try {
    const res = await fetch(`${SIGNUP_BASE}/discord/link/status`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { linked: false };
    const data = await res.json().catch(() => null);
    return { linked: Boolean(data && data.linked) };
  } catch { return { linked: false }; }
}

// SOW-026: first-run onboarding readiness. Reads durable GitHub state (token, fork, App install) and returns the
// first not-yet-done step, so the wizard never loops on a cleared store. Only meaningful in app-mode (classic
// has no fork/install onboarding); in classic mode the wizard is dormant (ready once signed in).
export async function getOnboardingStatus(ctx) {
  const token = ctx.store?.get?.('githubToken');
  const mode = authModeFor(ctx); // SOW-157: the per-member runtime mode, falling back to the baked constant
  if (mode !== 'app') {
    // Classic + hosted: there is no fork/install step. Signed-in = ready (hosted is the 1-click default:
    // the Worker does the git work, so sign-in is the whole onboarding).
    return { appMode: false, mode, signedIn: !!token, forkReady: true, installReady: true, activeStep: token ? 'ready' : 'signin', ready: !!token, reachedGithub: true };
  }
  const r = await probeReadiness({ token, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM_REPO, fetch: ctx.fetch ?? globalThis.fetch });
  // Self-heal a DEAD token: if GitHub reached us and rejected the token (reachedGithub && !signedIn) while a token
  // was stored, the App user token is expired/revoked and the public client cannot refresh it. Clear the stale
  // token + identity so the UI shows ONE clean "sign in" prompt instead of "Signed in as @x" alongside "0 of 3".
  // probeReadiness sets reachedGithub on a definitive 401 only, never a transient error, so this never signs a
  // member out on a GitHub blip. (The ROOT fix is the App's "Expire user authorization tokens" = OFF.)
  if (token && r.reachedGithub && !r.signedIn) {
    try { ctx.store?.set?.({ githubToken: null, identity: null }); } catch { /* best-effort */ }
  }
  const activeStep = onboardingNextStep(r);
  // Enrich with the step copy + the resolved deep-links so the UI component is purely data-driven (no
  // cross-package import). The install link preselects the member account via their numeric id.
  return {
    appMode: true, mode, ...r, activeStep, ready: activeStep === 'ready',
    forkName: r.login ? forkFullName(r.login) : null,
    steps: ONBOARDING_STEPS,
    links: { device: deviceVerificationUrl(), fork: forkUrl(), install: appInstallUrl({ targetId: r.githubId }), manage: manageInstallsUrl() },
  };
}

// SOW-024: favorites are RETIRED from git. A favorite used to be written to members/<me>/favorites.yml via an
// auto-merged PR (SOW-013), but that put behavioral personal data (who-favorited-what) into the immutable public
// repo, which cannot honor a right-to-erasure. Favorites now flow through mutateMemberActivity (action
// 'favorite') into the deletable edge store (KV), keyed by github_id; the public site only ever sees the
// member-identity-free aggregate counts in house/favorite-counts.yml (synced KV -> git by reconcile). There is
// no longer a git favorites write path here, no favorites gate carve-out, and no favorites.yml validation.

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
async function requireAdmin(ctx) {
  const id = requireIdentity(ctx);
  const readText = async (p) => { try { return (await ctx.reader?.readFile?.(p)) || ''; } catch { return ''; } };
  const rolesParsed = yaml.load(await readText('house/roles.yml')) || {};
  const role = roleOf(String(id.githubId), rolesFromParsed(rolesParsed));
  if (!isAdminRole(role)) throw new OperationError('forbidden', `this requires admin (you are ${role})`);
  return { id, role, rolesParsed, readText };
}

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
async function loadOwnContribution(ctx, number) {
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

const DECLINE_NOTE =
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

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg)$/i;

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
