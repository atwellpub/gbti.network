// SOW-156 (spike): the pure core of hosted authoring. A paid member with NO fork and NO App install hands
// authored files to the signup Worker, which commits them to a per-member branch on the CANONICAL repo and
// opens the auto-merging PR (the SOW-005 gate stays the only merger). This module is the fail-closed wall
// between a member request and GBTI's canonical-repo installation token, so every check here is
// security-critical (see the SOW-078-grade review notes in the SOW).
//
// Node-free on purpose: it runs inside the Cloudflare Worker and in the unit suite, and it reuses the
// classify-pr path hygiene so the endpoint and the merge gate cannot disagree about what a clean
// own-folder path is.

import { isCleanPath } from './classify-pr.mjs';

export const HOSTED_MAX_FILES = 20;
export const HOSTED_MAX_FILE_BYTES = 100_000;
export const HOSTED_MAX_TOTAL_BYTES = 300_000;
export const HOSTED_BRANCH_PREFIX = 'hosted/';
// sow-158 image upload: a BINARY image entry ({ path, contentBase64 }) has its OWN budget, separate from the
// text caps above, so a 1 MB cover image never counts against the 100 KB text limit. 1 MB matches the
// check-media.mjs MAX_BYTES cap, so an uploaded image never fails media-check on the auto-merged PR.
export const HOSTED_MAX_IMAGE_BYTES = 1_048_576; // 1 MB per image (== check-media MAX_BYTES)
export const HOSTED_MAX_IMAGE_TOTAL_BYTES = 4_194_304; // 4 MB of images per request (a hard abuse bound)
// A binary image must be an own-folder images/ file with a WEB-IMAGE extension. NO svg (an uploaded svg is a
// navigation-XSS vector when opened directly); the web upload is raster-only, the extension host keeps svg.
const IMAGE_PATH_TAIL_RE = /^images\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp|gif)$/i;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** The exact decoded byte length of a base64 string, or -1 if it is not well-formed base64. Node-free (no atob):
 *  length math + a charset/padding check, so the Worker validates size WITHOUT decoding a megabyte into memory. */
export function base64DecodedBytes(b64) {
  if (typeof b64 !== 'string' || b64.length === 0) return -1;
  if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) return -1;
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return (b64.length / 4) * 3 - pad;
}

// The item id becomes a branch segment AFTER the server-inserted github_id, so it must never be able to
// shift the id parse or produce an illegal git ref: lowercase alphanumeric + hyphen only, bounded length.
// SOW-157: bounded at 80 (was 64) so a share itemId fits: share-<14-digit stamp>-<slug up to 48> = 69.
const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const GITHUB_ID_RE = /^\d{1,20}$/;
// Folder names are the members-index usernames (lowercase folder/username per house/members-index.yml).
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Parse house/members-index.yml (the flat, reconcile-maintained `"github_id": username` map) WITHOUT a
 * YAML library (the Worker carries none by design; the file is admin-owned and trivially line-shaped).
 * Returns a Map<github_id string, username string>. Unrecognized lines (comments, the `members:` header)
 * are skipped; a malformed value line is skipped rather than guessed at (fail closed: an absent entry
 * denies, it never mis-scopes).
 */
export function parseMembersIndex(text) {
  const map = new Map();
  if (typeof text !== 'string') return map;
  for (const line of text.split('\n')) {
    const m = /^\s*"?(\d{1,20})"?\s*:\s*([a-z0-9][a-z0-9-]{0,63})\s*$/.exec(line);
    if (m) map.set(m[1], m[2]);
  }
  return map;
}

/** The per-member canonical branch. The github_id segment is ALWAYS server-inserted from the verified
 * identity (never from the request body); callers must validate itemId via validateHostedRequest first. */
export function hostedBranchFor(githubId, itemId) {
  if (!GITHUB_ID_RE.test(String(githubId ?? ''))) return null;
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return null;
  return `${HOSTED_BRANCH_PREFIX}${githubId}/${itemId}`;
}

/**
 * The gate-side inverse: resolve the member github_id from a hosted branch ref, or null. Used by
 * scripts/pr-gate.mjs for a bot-opened PR whose head lives on the CANONICAL repo (no fork owner to read).
 * Sharing the regex with hostedBranchFor keeps the write path and the merge gate on one contract.
 * Fail closed: anything that does not match exactly returns null (the gate hard-fails a null author).
 */
export function parseHostedRef(ref) {
  const m = /^hosted\/(\d{1,20})\/[a-z0-9][a-z0-9-]{0,79}$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

// sow-161 server-side admin authoring: a DISTINCT branch prefix for a Worker-opened ADMIN mutation PR
// (moderation, ban/grandfather, role assignment, config), so it is not confused with own-folder member
// content (`hosted/...`). Like the member case, the github_id is ALWAYS server-inserted from the verified
// session identity, never the request body, and the action slug names what the PR does. The gate resolves
// this id -> the git-native role and runs the SAME decide() anti-escalation: the id must independently hold
// the role for every touched path tier (moderator to touch others' content, admin for Tier A house/**,
// superadmin for Tier S roles.yml), so a wrong/forged id cannot escalate. Members cannot mint this branch:
// only the Worker (installation token) pushes canonical branches and opens the bot PR.
export const ADMIN_HOSTED_BRANCH_PREFIX = 'hosted-admin/';
// The action slug is a bounded lowercase token (e.g. `deplatform-my-post`, `ban-12345`, `role-12345`); it is
// cosmetic for the gate (the touched PATHS + the id's role decide the merge), but it is validated so it can
// never shift the id parse or produce an illegal git ref.
const ADMIN_ACTION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

/** The per-admin canonical mutation branch. The github_id segment is ALWAYS server-inserted from the verified
 *  identity (never the request body). Returns null if the id or the action slug is not well-formed. */
export function adminHostedBranchFor(githubId, actionSlug) {
  if (!GITHUB_ID_RE.test(String(githubId ?? ''))) return null;
  if (!ADMIN_ACTION_SLUG_RE.test(String(actionSlug ?? ''))) return null;
  return `${ADMIN_HOSTED_BRANCH_PREFIX}${githubId}/${actionSlug}`;
}

/** The gate-side inverse of adminHostedBranchFor: resolve the requesting admin github_id from a
 *  `hosted-admin/<github_id>/<action-slug>` ref, or null. Fail closed (a non-match hard-fails the author). */
export function parseAdminHostedRef(ref) {
  const m = /^hosted-admin\/(\d{1,20})\/[a-z0-9][a-z0-9-]{0,79}$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

function utf8Bytes(s) {
  return new TextEncoder().encode(s).length;
}

// sow-183: a content path lives under SOME member's folder or house/. Shape-only (isCleanPath already ruled
// out traversal/unclean segments by the time this runs) -- it does not confirm the folder is a REAL
// registered member, matching the fact that a superadmin can already reach any path via the fork+gate path
// today (classify-pr.mjs's decide() auto-merges a superadmin on any path); this is not a NEW ceiling, just
// the hosted-authoring endpoint's own shape check, same rigor as its existing own-folder-only pattern.
const ANY_MEMBER_FOLDER_RE = /^members\/[a-z0-9][a-z0-9-]{0,63}\//;
// EXPLICIT house CONTENT subdirectories only -- never a bare 'house/' prefix. house/ also holds Tier-S/A
// governance (roles.yml, bans.yml, grandfathered.yml, members-index.yml, taxonomy.yml, ...), and a bare
// prefix match would treat 'house/roles.yml' as a valid content path too. Mirrors reviewFileContent's own
// HOUSE_CONTENT allowlist (workers/signup/github-app.mjs) for the read side, plus the two sidecar dirs a
// content write also needs: comments/ (the from-the-author intro) and _enc/ (an encrypted body envelope).
const HOUSE_CONTENT_PREFIXES = ['house/posts/', 'house/products/', 'house/prompts/', 'house/comments/', 'house/_enc/'];

/**
 * Validate a hosted author request against the caller's OWNED folder (resolved by the caller from the
 * members-index by github_id, exactly as the gate does; never from the current GitHub login). Returns
 * { ok: true, paths } or { ok: false, error, status } with a member-safe error string. Fail closed:
 * any doubt rejects the whole request.
 *
 * sow-183: `allowAnyFolder` additionally permits the house CONTENT subdirectories (HOUSE_CONTENT_PREFIXES,
 * never house/roles.yml or any other governance file) or ANY OTHER member's folder, for a content
 * authorship reassignment. The CALLER (membershipAuthor) sets this ONLY after an independent superadmin
 * check (authorizeSuperadmin, resolved from the SIGNUP_KV roles mirror) -- never from anything in the
 * request body itself, so a non-superadmin cannot self-grant it by simply asking. Every other check
 * (clean paths, size caps, file count, duplicates) is unchanged and applies identically either way.
 */
export function validateHostedRequest({ files, itemId, folder, allowAnyFolder = false } = {}) {
  const bad = (error, status = 400) => ({ ok: false, error, status });
  if (!FOLDER_RE.test(String(folder ?? ''))) return bad('no member folder resolved for this account', 409);
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return bad('itemId must be lowercase letters, digits, and hyphens (max 64)');
  if (!Array.isArray(files) || files.length === 0) return bad('files must be a non-empty array');
  if (files.length > HOSTED_MAX_FILES) return bad(`too many files (max ${HOSTED_MAX_FILES})`);
  const ownPrefix = `members/${folder}/`;
  const paths = [];
  let totalBytes = 0;
  let imageBytes = 0;
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== 'string') return bad('every file needs a path');
    if (!isCleanPath(f.path)) return bad('a file path is not a clean repo-relative path');
    const inOwnFolder = f.path.startsWith(ownPrefix) && f.path.length > ownPrefix.length;
    // sow-183: which folder prefix actually matched -- own, house/, or (allowAnyFolder only) another
    // member's -- so the image-tail check below (own-folder "images/x.png") is computed against the RIGHT
    // folder for a cross-folder write, not always the caller's own.
    let matchedPrefix = null;
    if (inOwnFolder) matchedPrefix = ownPrefix;
    else if (allowAnyFolder) {
      const housePrefix = HOUSE_CONTENT_PREFIXES.find((p) => f.path.startsWith(p) && f.path.length > p.length);
      if (housePrefix) matchedPrefix = housePrefix;
      else {
        const m = ANY_MEMBER_FOLDER_RE.exec(f.path);
        if (m) matchedPrefix = m[0];
      }
    }
    if (!matchedPrefix) {
      return bad(allowAnyFolder ? 'every file must live under a member folder or house/' : 'every file must live inside your own member folder');
    }
    if (seen.has(f.path)) return bad('duplicate file path');
    seen.add(f.path);
    const isBinary = f.contentBase64 !== undefined && f.contentBase64 !== null;
    if (isBinary) {
      // sow-158 image upload: a binary entry is a base64-encoded raster image, own-folder images/ only, capped.
      if (typeof f.content === 'string') return bad('a file cannot carry both content and contentBase64');
      const tail = f.path.slice(matchedPrefix.length);
      if (!IMAGE_PATH_TAIL_RE.test(tail)) return bad('an uploaded image must be a png, jpg, webp, or gif under your images/ folder');
      const bytes = base64DecodedBytes(f.contentBase64);
      if (bytes < 0) return bad('an uploaded image is not valid base64');
      if (bytes === 0) return bad('an uploaded image is empty');
      if (bytes > HOSTED_MAX_IMAGE_BYTES) return bad(`an image exceeds ${HOSTED_MAX_IMAGE_BYTES} bytes (1 MB)`);
      imageBytes += bytes;
      if (imageBytes > HOSTED_MAX_IMAGE_TOTAL_BYTES) return bad(`the request exceeds ${HOSTED_MAX_IMAGE_TOTAL_BYTES} image bytes total`);
    } else if (f.content !== null) {
      if (typeof f.content !== 'string') return bad('file content must be a string (or null to delete)');
      const bytes = utf8Bytes(f.content);
      if (bytes > HOSTED_MAX_FILE_BYTES) return bad(`a file exceeds ${HOSTED_MAX_FILE_BYTES} bytes`);
      totalBytes += bytes;
      if (totalBytes > HOSTED_MAX_TOTAL_BYTES) return bad(`the request exceeds ${HOSTED_MAX_TOTAL_BYTES} bytes total`);
    }
    paths.push(f.path);
  }
  return { ok: true, paths };
}
