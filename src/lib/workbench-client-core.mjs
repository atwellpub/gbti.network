// sow-158 Phase 3b: the PURE, node-testable core of the website WorkBench adapter (src/lib/workbench-client.ts).
// The .ts adapter is the browser transport (cookie fetch + CSRF); the logic that has no network — the members-only
// file-set planning, the discussion filter/sort/tier-gate, the comment-input coercion, the favorite derivation —
// lives here so `node --test` (which has no TS loader) can exercise it. Node-free: it imports only the shared pure
// builders. Mirrors the member-signal.ts / member-signal-core.mjs split.

import { serializeContentFile, byCommentOldest } from '../../client/src/content-ops.mjs';
import { splitMemberMarkdown, encAssetFor, MEMBER_MARKER } from '../../client/src/member-content.mjs';

// SOW-027: the valid comment targets (mirrors operations.listComments' COMMENT_TARGET_TYPES).
// sow-158 News track: 'news' enables the shared <gbti-discussion> news thread on the website (read is public;
// posting stays paid-gated via postComment's membership check). The comments-index already carries news rows.
export const COMMENT_TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share', 'news']);

// sow-158 image upload: the frontmatter keys that hold an uploaded image path (per the editor RAIL_SCHEMA:
// coverImage on a post; icon/featuredImage/banner on a product; image on a prompt). coverAlt is text, not a path.
export const IMAGE_FIELD_KEYS = ['coverImage', 'image', 'banner', 'featuredImage', 'icon'];
const WEB_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/;

/**
 * Sanitize an uploaded image filename to a clean own-folder leaf: lowercase, only [a-z0-9._-], no path segments,
 * no leading dot/hyphen, and it MUST end in a web-image extension (png/jpg/jpeg/webp/gif — NO svg on web upload).
 * Returns the clean name or null (reject). Mirrors the Worker gate (validateHostedRequest IMAGE_PATH_TAIL_RE), so
 * the client and the security wall agree on what an image filename is.
 */
export function sanitizeImageName(filename) {
  const base = String(filename ?? '').trim().toLowerCase().split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/-+/g, '-');
  if (!/^[a-z0-9]/.test(cleaned) || !WEB_IMAGE_EXT_RE.test(cleaned)) return null;
  return cleaned;
}

/** The set of own-folder image paths a content item's frontmatter references (members/<login>/images/...). Used to
 *  flush ONLY the pending images the content actually uses into the publish PR (never an unreferenced upload). */
export function referencedImagePaths(frontmatter, login) {
  const prefix = `members/${login}/images/`;
  const out = new Set();
  for (const k of IMAGE_FIELD_KEYS) {
    const v = frontmatter?.[k];
    if (typeof v === 'string' && v.startsWith(prefix)) out.add(v);
  }
  return out;
}

/** The decoded byte length of a base64 payload (padding-aware), for the client-side 1 MB pre-check. */
export function base64Bytes(b64) {
  const s = String(b64 ?? '');
  if (!s) return 0;
  const pad = s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0;
  return Math.floor((s.length / 4) * 3 - pad);
}
// SOW-078: who may READ a members-visibility comment stub (an active trial OR a paid member). Mirrors the
// server's READ_TRIAL tier, applied here as the presentation-side gate; the Worker decrypt is authoritative.
export const MEMBER_READ_TIER = new Set(['paid', 'trialing', 'trial']);

/**
 * Plan the file set for a members-or-public comment/content write — a browser-safe reimplementation of
 * operations.planMemberFiles (importing operations.mjs would drag fork-mode + 15 REST clients into the page
 * bundle). A members item encrypts its whole body to a sibling .enc (via the injected async `encrypt`, which the
 * adapter wires to the Worker); a public item with no marker returns null (the caller commits built.markdown).
 * Pure over `encrypt`, so it unit-tests with a fake. Returns { files, encPath } | null.
 */
export async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null;
  const vis = built.frontmatter?.visibility ?? 'public';
  let publicPart = '';
  let memberPart = null;
  if (vis === 'members') {
    memberPart = String(body ?? '').trim(); // whole item: the entire body is gated
    if (!memberPart) return null;
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null; // plain public content: no encryption
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope);
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return { files: [{ path: built.path, content: markdown }, { path: encPath, content: JSON.stringify(envelope) }], encPath };
}

/**
 * Filter a full comments-index item list to one discussion thread: matching targetType + targetSlug (or a rename
 * alias) + published, oldest-first, capped. A viewer who cannot see members rows (`canSeeMembers:false`) gets only
 * the public rows — the member stub carries no body, so this never leaks gated text. Pure.
 */
export function filterThreadComments(all, { targetType, targetSlug, aliases = [], limit = 100, canSeeMembers = true } = {}) {
  if (!COMMENT_TARGET_TYPES.has(targetType) || !targetSlug) return [];
  const slugs = new Set([targetSlug, ...(Array.isArray(aliases) ? aliases : [])]);
  let items = (Array.isArray(all) ? all : [])
    .filter((c) => c?.targetType === targetType && slugs.has(c?.targetSlug) && (c?.status ?? 'published') === 'published')
    .sort(byCommentOldest);
  if (!canSeeMembers) items = items.filter((c) => (c?.visibility ?? 'public') !== 'members');
  const n = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  return items.slice(0, n);
}

/**
 * Assemble the buildCommentFile input, coercing visibility the SAME way operations.publishComment/editComment do:
 * a comment is public ONLY as a from-the-author intro (authorNote) on a post/product/prompt; everything else
 * (a discussion reply, ANY comment on a share) is coerced to members, so its body is encrypted, never plaintext.
 * The id + timestamps are passed in (impure clock/random stays in the .ts adapter). Pure.
 */
export function coerceCommentInput({ id, targetType, targetSlug, createdAt, updatedAt, authorNote, parentId, visibility } = {}) {
  const isPublicIntro = authorNote === true && ['post', 'product', 'prompt'].includes(targetType);
  const input = { id, targetType, targetSlug, status: 'published', visibility: (visibility === 'public' && isPublicIntro) ? 'public' : 'members' };
  if (createdAt) input.createdAt = createdAt;
  if (updatedAt) input.updatedAt = updatedAt;
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  return input;
}

/** Derive `favorited` for a target from the activity store's favorites list (matches the client contract). Pure. */
export function favoritedFrom(activity, targetType, targetSlug) {
  const favs = (activity && activity.favorites) || [];
  return favs.some((f) => f.type === targetType && f.slug === targetSlug);
}

/**
 * sow-158 Phase 3c: rebuild the FULL authoring body of a members-only item from its committed `index.md` body plus
 * the DECRYPTED members text, so the editor shows everything and a re-publish re-splits identically. The exact
 * inverse of planMemberFiles' split:
 *   - Mode A/B (visibility: members): the whole body was gated, so the decrypted memberText IS the body.
 *   - Mode C (visibility: public): the public part (the committed index.md body) + the `<!-- members-only -->`
 *     marker + the members part.
 * Pure. Used only when frontmatter.encryptedBody is set (the caller decrypts, then calls this).
 */
export function reassembleMemberBody(frontmatter, indexBody, memberText) {
  const gated = String(memberText ?? '');
  if ((frontmatter?.visibility ?? 'public') === 'members') return gated; // whole-item members: memberText is all
  const pub = String(indexBody ?? '').trim();
  return pub ? `${pub}\n\n${MEMBER_MARKER}\n\n${gated}` : `${MEMBER_MARKER}\n\n${gated}`;
}
