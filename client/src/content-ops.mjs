// Content operations (SOW-006): the managed-abstraction core that both the CMS UI and the MCP tools call
// to author content. It resolves the member's own folder from their immutable github_id, builds + validates
// frontmatter against the canonical schema, FORCES the gated fields (author/username, system-managed
// fields stripped), and serializes a content file. It never decides privilege: it scopes writes to the
// member's own folder so the client does not open PRs the SOW-005 gate would reject, but the gate remains
// the real boundary.

import yaml from 'js-yaml';
import { AUTHORABLE_TYPES, SYSTEM_MANAGED, schemaFor, shareSchema, commentSchema } from './schemas.mjs';
import { encAssetFor } from './member-content.mjs';

const SUBDIR = Object.freeze({ post: 'posts', product: 'products', prompt: 'prompts' });
const MAX_BODY_BYTES = 1_000_000; // 1MB cap on a content body (well under GitHub's per-file limit + the 2MB HTTP cap)

/** Resolve a github_id to its folder username via the members-index (Map or plain object). */
export function resolveUsername(githubId, membersIndex) {
  const id = String(githubId);
  if (membersIndex instanceof Map) return membersIndex.get(id) ?? null;
  if (membersIndex && typeof membersIndex === 'object') return membersIndex[id] ?? null;
  return null;
}

// SOW-145: the content TARGET, decoupled from the ACTOR. A member scope writes members/<username>/ with the
// member as author; a house scope writes the non-member house/ folder with the fixed pseudo-author 'gbti'
// (rendered "GBTI Network"). The actor's identity (for the fork + the superadmin gate) is separate. Pure.
export function resolveTarget({ scope = 'member', username } = {}) {
  if (scope === 'house') return { scope: 'house', folder: 'house', author: 'gbti' };
  if (!username) throw new Error('resolveTarget: username is required for the member scope');
  return { scope: 'member', folder: `members/${username}`, author: username };
}

/** The repo path for a content item of the given type. Member scope -> members/<username>/…; house scope ->
 *  house/… (SOW-145; a superadmin-only target, gated by the caller). Profiles are member-only. */
export function contentPath(type, username, slug, scope = 'member') {
  if (type === 'profile') {
    if (!username) throw new Error('contentPath: username is required');
    return `members/${username}/profile.md`;
  }
  const sub = SUBDIR[type];
  if (!sub) throw new Error(`contentPath: unknown type ${type}`);
  if (!slug) throw new Error(`contentPath: ${type} requires a slug`);
  // NESTED layout (matches the SOW-001 migration + validate-content + the Astro glob): one folder per item
  // (so assets can co-locate); the slug folder name == the slug.
  const { folder } = resolveTarget({ scope, username });
  return `${folder}/${sub}/${slug}/index.md`;
}

export function ownFolderPrefix(username) {
  return `members/${username}/`;
}

/** A member may author ONLY inside their own folder. Rejects traversal + other folders (UX scoping). SOW-145:
 *  a superadmin (allowHouse) may additionally author under house/ (the server gate is the real enforcement). */
export function canAuthorPath(path, username, { allowHouse = false } = {}) {
  if (typeof path !== 'string') return false;
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false;
  if (allowHouse && (path === 'house' || path.startsWith('house/'))) return true;
  return !!username && path.startsWith(ownFolderPrefix(username));
}

/**
 * Remove system-managed fields and FORCE owner-controlled ones. The client must never let a member set
 * `contributors` (merge automation owns it), their `tier`/`joinedAt` (membership system owns it), or claim
 * a different `author`/`username` than themselves.
 */
export function sanitizeInput(type, input, username, { author } = {}) {
  const out = { ...(input ?? {}) };
  for (const field of SYSTEM_MANAGED[type] ?? []) delete out[field];
  out.type = type;
  // SOW-145: `author` decouples the stamped author from the folder username. House content keeps author 'gbti'
  // while living under house/; member content keeps author == the folder username.
  if (type === 'profile') out.username = username;
  else out.author = author || username;
  return out;
}

export class ContentValidationError extends Error {
  constructor(type, issues) {
    const detail = issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    super(`invalid ${type}: ${detail}`);
    this.name = 'ContentValidationError';
    this.contentType = type;
    this.issues = issues;
  }
}

function stripUndefined(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out;
}

/**
 * Build a validated content file for a member's own folder.
 * @returns {{ path, frontmatter, markdown, type, username, slug }}
 * @throws ContentValidationError on schema failure; Error on a non-authorable type / missing username.
 */
export function buildContentFile({ type, username, input, body = '', scope = 'member' }) {
  if (!AUTHORABLE_TYPES.includes(type)) throw new Error(`buildContentFile: ${type} is not an authorable type`);
  // SOW-145: the member scope needs a username (folder + author); the house scope does not (folder 'house',
  // author 'gbti'). The actor's username is still carried on the result for the fork/commit context.
  const target = resolveTarget({ scope, username });
  if (scope !== 'house' && !username) throw new Error('buildContentFile: username is required');

  const schema = schemaFor(type);
  const cleaned = sanitizeInput(type, input, username, { author: target.author });

  const result = schema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError(type, result.error.issues);

  // Bound the body so a single publish cannot stage a runaway file (well under GitHub's per-file limit).
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError(type, [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }

  const slug = type === 'profile' ? null : cleaned.slug;
  const path = contentPath(type, username, slug, scope);

  // Serialize the cleaned input (validity already proven) so we preserve the author's original date
  // strings and omit defaulted noise; the gate / CI apply schema defaults at build time.
  // SOW-100 tag policy: tags are the one field whose PARSED (normalized) form ships — member input like
  // "Claude Code" serializes as the dash-connected "claude-code" the schema transformed it into.
  const frontmatter = stripUndefined(cleaned);
  if (result.data && Array.isArray(result.data.tags) && 'tags' in frontmatter) frontmatter.tags = result.data.tags;
  if (Array.isArray(frontmatter.tags) && !frontmatter.tags.length) delete frontmatter.tags;
  const markdown = serializeContentFile(frontmatter, body);

  // `username` stays the ACTOR (the fork/commit context); `scope` + `path` carry the TARGET (member or house).
  return { path, frontmatter, markdown, type, username, slug, scope };
}

/**
 * SOW-183: plan a cross-folder AUTHORSHIP move for an existing item -- reassigning it from one (scope,
 * username) target to another (house -> a specific member, member -> house, or member -> a different
 * member), keyed by the SAME (type, slug) throughout, since the public URL is built from slug alone and
 * never depends on author (src/lib/content-index.mjs toIndexItem/contentItemPath). This is the same shape as
 * the existing SOW-112 slug-rename (delete-old + write-new + move the intro comment + re-derive the .enc
 * sibling), generalized from "same folder, new slug" to "any folder, same slug" -- the two are really one
 * operation (a full identity move), just keyed on a different field. Privilege-free like every other builder
 * in this file: the CALLER enforces who may invoke this (superadmin-only, per SOW-183); this function only
 * computes the resulting file set.
 *
 * A content item's path is DERIVED from its target (scope + username), never read from disk, so a bare
 * frontmatter `author:` edit with no file move would leave the item unreachable at its new author's computed
 * path. This function always produces both the delete of the old path and the write of the new one together.
 *
 * @param {'post'|'product'|'prompt'} type
 * @param {string} slug                                unchanged across the move
 * @param {{scope:'member'|'house', username?:string}} from   the item's CURRENT target
 * @param {{scope:'member'|'house', username?:string}} to     the NEW target
 * @param {object} oldFrontmatter                       the item's current, already-parsed frontmatter
 * @param {string} oldBody                               the item's current, already-parsed body (the public
 *                                                        part only; an encryptedBody pointer travels via
 *                                                        oldFrontmatter, not through this body string)
 * @param {string|null} [oldEncText]     the current .enc envelope's raw text; REQUIRED when
 *                                       oldFrontmatter.encryptedBody is set (throws otherwise, fail closed
 *                                       rather than silently dropping a gated body)
 * @param {string|null} [introText]      the current from-the-author intro comment's raw text, product/prompt
 *                                       only; null/omitted when the item has none
 * @returns {{ path: string, noop?: boolean, files: Array<{path:string, content:string|null}>, frontmatter: object }}
 */
export function planAuthorshipMove({ type, slug, from, to, oldFrontmatter, oldBody, oldEncText = null, introText = null }) {
  if (!AUTHORABLE_TYPES.includes(type)) throw new Error(`planAuthorshipMove: ${type} is not an authorable type`);
  if (!slug) throw new Error('planAuthorshipMove: slug is required');
  const fromTarget = resolveTarget(from);
  const toTarget = resolveTarget(to);
  const oldPath = contentPath(type, from?.username, slug, fromTarget.scope);
  const newPath = contentPath(type, to?.username, slug, toTarget.scope);
  if (oldPath === newPath) return { path: oldPath, noop: true, files: [], frontmatter: oldFrontmatter ?? {} };

  const fm = { ...(oldFrontmatter ?? {}), author: toTarget.author };
  const files = [];

  if (typeof fm.encryptedBody === 'string' && fm.encryptedBody) {
    if (oldEncText == null) throw new Error('planAuthorshipMove: the item has an encryptedBody but oldEncText was not provided');
    const oldEnc = fm.encryptedBody;
    const { path: newEnc } = encAssetFor(type, to?.username, slug, toTarget.scope);
    fm.encryptedBody = newEnc;
    files.push({ path: newEnc, content: oldEncText }, { path: oldEnc, content: null });
  }

  files.push({ path: newPath, content: serializeContentFile(fm, oldBody) }, { path: oldPath, content: null });

  // The from-the-author intro comment (product/prompt only) moves + re-stamps its author; the slug (and so
  // its id/targetSlug, both keyed on slug) is unchanged by an authorship-only move, unlike a slug rename.
  if (['product', 'prompt'].includes(type) && introText != null) {
    const oldIntroPath = `${fromTarget.folder}/comments/intro-${slug}.md`;
    const newIntroPath = `${toTarget.folder}/comments/intro-${slug}.md`;
    const intro = parseContentFile(introText);
    const introFm = { ...(intro.frontmatter ?? {}), author: toTarget.author };
    files.push({ path: newIntroPath, content: serializeContentFile(introFm, intro.body) }, { path: oldIntroPath, content: null });
  }

  return { path: newPath, files, frontmatter: fm };
}

/** SOW-018: derive a filesystem-safe, sortable Share id (a timestamp-slug) from its createdAt + optional title.
 *  e.g. ("2026-06-10T13:22:09Z", "Astro is great") -> "20260610132209-astro-is-great". Pure (no clock). */
export function shareId(createdAt, title) {
  const ts = String(createdAt ?? '').replace(/[^0-9]/g, '').slice(0, 14);
  const slug = String(title ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  const stamp = ts || '00000000000000';
  return slug ? `${stamp}-${slug}` : `${stamp}-share`;
}

/**
 * Build a validated Share file (SOW-018) for a member's own shares/ folder. A Share is one flat file with a
 * dedicated layout (members/<username>/shares/<id>.md), NOT the generic <slug>/index.md form, so it has its own
 * builder. FORCES author = the owner and type = 'share'. Returns the buildContentFile-compatible shape so the
 * SOW-016 member-only encrypt path (planMemberFiles) and publishFiles can consume it unchanged.
 * @returns {{ path, frontmatter, markdown, type:'share', username, slug, id }}
 * @throws ContentValidationError on schema failure; Error on a missing username.
 */
/**
 * SOW-106 Phase B: flip a content file's `status` frontmatter (published <-> draft), leaving every other field
 * (including visibility) untouched. Returns { changed, current, content } where `content` is the re-serialized
 * file (null when already in the requested state). Shared by the moderator Hide/Unhide (admin-ops) and the
 * member self-unpublish (operations.setOwnContentStatus).
 */
/** SOW-100 tag curation: replace tag `tag` with `to` (or remove it when `to` is null) in a content file's
 *  frontmatter. Dedupes (a rename onto an existing tag merges). Returns { changed, content }. Pure. */
export function retagContent(text, { tag, to = null } = {}) {
  const { frontmatter, body } = parseContentFile(text);
  const fm = { ...(frontmatter ?? {}) };
  const tags = Array.isArray(fm.tags) ? fm.tags.map((t) => String(t)) : [];
  const target = String(tag).toLowerCase();
  if (!tags.some((t) => t.toLowerCase() === target)) return { changed: false, content: text };
  let next = tags.filter((t) => t.toLowerCase() !== target);
  if (to && !next.some((t) => t.toLowerCase() === String(to).toLowerCase())) next.push(String(to));
  fm.tags = next;
  if (!next.length) delete fm.tags;
  return { changed: true, content: serializeContentFile(fm, body) };
}

export function flipContentStatus(text, status) {
  const { frontmatter, body } = parseContentFile(text);
  const current = frontmatter?.status ?? null;
  if (current === status) return { changed: false, current, content: null };
  const updated = { ...(frontmatter ?? {}), status };
  const content = `---\n${yaml.dump(updated, { lineWidth: 100, noRefs: true }).trimEnd()}\n---\n\n${String(body).trim()}\n`;
  return { changed: true, current, content };
}

export function buildShareFile({ username, input, body = '' }) {
  if (!username) throw new Error('buildShareFile: username is required');
  // A published share must carry status:published in its frontmatter, or the readers (which filter on
  // status === 'published') skip it. Default to published; an explicit input.status still wins.
  const cleaned = stripUndefined({ status: 'published', ...(input ?? {}), type: 'share', author: username });
  const result = shareSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError('share', result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError('share', [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `members/${username}/shares/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  // slug = id so planMemberFiles (which keys encryption on built.slug + built.type) treats the Share like a
  // body-bearing item; encAssetFor('share', username, id) puts the .enc under members/<u>/_enc/ (SOW-016).
  return { path, frontmatter: cleaned, markdown, type: 'share', username, slug: id, id };
}

/**
 * SOW-018: summarize a Share file (frontmatter + body) into the feed item the Shares reading feed renders.
 * Shared by BOTH readers (repo-fs + github-reader) so they emit an identical shape. The `body` field carries
 * the PUBLIC markdown for a public Share only; a members Share's body lives in its `.enc` (and its stub `.md`
 * body is empty anyway), so the plaintext never travels through the list — the client decrypts `encryptedBody`
 * via the Worker. createdAt is normalized to an ISO string (yaml may parse it to a Date).
 */
export function shareSummary(relPath, frontmatter = {}, body = '') {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== 'members';
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    title: fm.title ?? null,
    shortDescription: fm.shortDescription ?? null, // SOW-032
    url: fm.url ?? null,
    image: typeof fm.image === 'string' && fm.image.trim() ? fm.image.trim() : null, // SOW-057: featured image
    tags: Array.isArray(fm.tags) ? fm.tags : [],
    visibility: fm.visibility ?? 'members',
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === 'string' ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? '') : '', // members body is gated; never surfaced here
  };
}

/** SOW-032: a comment summary for the in-extension discussion (the Shares discussion thread). Like shareSummary,
 *  a members comment's plaintext is NOT surfaced here (the .enc is decrypted client-side via the Worker); only a
 *  public comment carries its body. The from-the-author authorNote flag is passed through so a thread can style
 *  it if needed (not used for Shares, which have no intro requirement). */
export function commentSummary(relPath, frontmatter = {}, body = '') {
  const fm = frontmatter || {};
  const isPublic = fm.visibility !== 'members';
  let createdAt = null;
  if (fm.createdAt != null) {
    const d = fm.createdAt instanceof Date ? fm.createdAt : new Date(fm.createdAt);
    createdAt = Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return {
    path: relPath,
    id: fm.id ?? null,
    author: fm.author ?? null,
    targetType: fm.targetType ?? null,
    targetSlug: fm.targetSlug ?? null,
    parentId: fm.parentId ?? null,
    authorNote: fm.authorNote === true,
    visibility: fm.visibility ?? 'public',
    status: fm.status ?? null,
    encryptedBody: typeof fm.encryptedBody === 'string' ? fm.encryptedBody : null,
    createdAt,
    body: isPublic ? String(body ?? '') : '', // members body is gated; decrypted client-side via the Worker
  };
}

/** Oldest-first for a discussion thread (conversations read top-down). Deterministic id/path tie-break. */
export function byCommentOldest(a, b) {
  const t = String(a?.createdAt ?? '').localeCompare(String(b?.createdAt ?? ''));
  if (t !== 0) return t;
  return String(a?.id ?? a?.path ?? '').localeCompare(String(b?.id ?? b?.path ?? ''));
}

/** Sort Share summaries newest-first by createdAt (ISO strings compare lexically), undated last. A deterministic
 *  id/path tie-break keeps BOTH hosts (npm fs order vs extension tree order) ordering identical-timestamp shares
 *  the same way (stable-sort input order would otherwise differ between hosts). */
export function byShareNewest(a, b) {
  const t = String(b?.createdAt ?? '').localeCompare(String(a?.createdAt ?? ''));
  if (t !== 0) return t;
  return String(b?.id ?? b?.path ?? '').localeCompare(String(a?.id ?? a?.path ?? ''));
}

/** SOW-027: a sortable comment id = a timestamp stem + a short suffix (the spec's "sortable ULID/timestamp",
 *  no new dependency; same family as shareId). Pure given createdAt + an injected suffix. */
export function commentId(createdAt, suffix) {
  const ts = String(createdAt ?? '').replace(/[^0-9]/g, '').slice(0, 14) || '00000000000000';
  const s = String(suffix ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8) || 'c';
  return `${ts}-${s}`;
}

/**
 * Build a validated comment file (SOW-027) for a member's own comments/ folder. One flat file per comment
 * (members/<username>/comments/<id>.md), NOT the generic <slug>/index.md form, so it has its own builder.
 * FORCES author = the owner and type = 'comment'. Returns the buildContentFile-compatible shape so the SOW-016
 * member-only encrypt path (planMemberFiles) and publishFiles can consume it unchanged.
 * @returns {{ path, frontmatter, markdown, type:'comment', username, slug, id }}
 */
export function buildCommentFile({ username, input, body = '', scope = 'member' } = {}) {
  if (!username) throw new Error('buildCommentFile: username is required');
  // SOW-145: a house comment (e.g. a house product/prompt author intro) lives at house/comments/<id>.md with
  // author 'gbti', while the actor's username stays on the result (fork/commit context). Member scope is
  // unchanged (folder members/<username>, author == username).
  const target = resolveTarget({ scope, username });
  const cleaned = stripUndefined({ ...(input ?? {}), type: 'comment', author: target.author });
  const result = commentSchema.safeParse(cleaned);
  if (!result.success) throw new ContentValidationError('comment', result.error.issues);
  const id = cleaned.id;
  const bodyStr = String(body ?? '').trim();
  if (bodyStr.length > MAX_BODY_BYTES) {
    throw new ContentValidationError('comment', [{ path: ['body'], message: `body exceeds ${MAX_BODY_BYTES} bytes` }]);
  }
  const path = `${target.folder}/comments/${id}.md`;
  const markdown = serializeContentFile(cleaned, body);
  // slug = id so planMemberFiles (which keys encryption on built.slug + built.type) treats a members comment
  // like a body-bearing item; encAssetFor('comment', username, id) puts the .enc under members/<u>/_enc/.
  return { path, frontmatter: cleaned, markdown, type: 'comment', username, slug: id, id, scope: target.scope };
}

/** Serialize a frontmatter object + body into a content file string (the same shape buildContentFile emits).
 *  Exported so the SOW-016 member-only publish path can rebuild index.md with a public teaser + encryptedBody. */
export function serializeContentFile(frontmatter, body) {
  const front = yaml.dump(stripUndefined(frontmatter), { lineWidth: 100, noRefs: true }).trimEnd();
  return `---\n${front}\n---\n\n${String(body ?? '').trim()}\n`;
}

/** Split a content file into { frontmatter, body } for editing an existing item. */
export function parseContentFile(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(String(text ?? ''));
  if (!m) return { frontmatter: {}, body: String(text ?? '') };
  return { frontmatter: yaml.load(m[1]) ?? {}, body: (m[2] ?? '').replace(/^\n+/, '') };
}
