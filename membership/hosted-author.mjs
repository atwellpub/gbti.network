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

// The item id becomes a branch segment AFTER the server-inserted github_id, so it must never be able to
// shift the id parse or produce an illegal git ref: lowercase alphanumeric + hyphen only, bounded length.
const ITEM_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
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
  const m = /^hosted\/(\d{1,20})\/[a-z0-9][a-z0-9-]{0,63}$/.exec(String(ref ?? ''));
  return m ? m[1] : null;
}

function utf8Bytes(s) {
  return new TextEncoder().encode(s).length;
}

/**
 * Validate a hosted author request against the member's OWNED folder (resolved by the caller from the
 * members-index by github_id, exactly as the gate does; never from the current GitHub login). Returns
 * { ok: true, paths } or { ok: false, error, status } with a member-safe error string. Fail closed:
 * any doubt rejects the whole request.
 */
export function validateHostedRequest({ files, itemId, folder } = {}) {
  const bad = (error, status = 400) => ({ ok: false, error, status });
  if (!FOLDER_RE.test(String(folder ?? ''))) return bad('no member folder resolved for this account', 409);
  if (!ITEM_ID_RE.test(String(itemId ?? ''))) return bad('itemId must be lowercase letters, digits, and hyphens (max 64)');
  if (!Array.isArray(files) || files.length === 0) return bad('files must be a non-empty array');
  if (files.length > HOSTED_MAX_FILES) return bad(`too many files (max ${HOSTED_MAX_FILES})`);
  const prefix = `members/${folder}/`;
  const paths = [];
  let totalBytes = 0;
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== 'string') return bad('every file needs a path');
    if (!isCleanPath(f.path)) return bad('a file path is not a clean repo-relative path');
    if (!f.path.startsWith(prefix) || f.path.length <= prefix.length) {
      return bad('every file must live inside your own member folder');
    }
    if (seen.has(f.path)) return bad('duplicate file path');
    seen.add(f.path);
    if (f.content !== null) {
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
