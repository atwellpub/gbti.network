// The CLONE-FREE Reader (SOW-006 v2 P4; moved out of extension/src by sow-193). Content is read over the
// GitHub Contents API with the member's own token, so a host needs no working copy on disk. It implements the
// host-agnostic Reader interface the core depends on ({ list, listMembersOnly, get, readFile }), so
// operations.mjs / api.mjs / role resolution run unchanged.
//
// TWO hosts use it now. The Chrome extension has no filesystem and never had a choice. The npm/MCP host picks
// it when no `repoPath` is configured (client/src/context.mjs), which is what lets an agent drive the MCP
// without cloning the repo. A member who DOES have a clone keeps the faster fs reader (repo-fs.mjs).
// It lives in client/src because it is shared core: `client/src` must never import from a host folder.
// Pure + injectable-fetch (no chrome APIs here), so it is unit-tested in node. The NESTED content layout
// (members/<u>/<sub>/<slug>/index.md) is the canonical on-disk layout reconciled in P5.

import { parseContentFile, shareSummary, byShareNewest, commentSummary, byCommentOldest } from './content-ops.mjs';
import { isReadablePath } from '../../src/lib/content-index.mjs';

const SUBDIR = Object.freeze({ post: 'posts', product: 'products', prompt: 'prompts' });
const TYPES = ['post', 'product', 'prompt', 'profile'];
const SHARE_PATH = /^members\/[^/]+\/shares\/[^/]+\.(md|mdx)$/;
const COMMENT_PATH = /^(members\/[^/]+|house)\/comments\/[^/]+\.(md|mdx)$/;
const basename = (p) => p.slice(p.lastIndexOf('/') + 1);

/** Decode GitHub's base64 (which contains newlines) into a UTF-8 string. */
function decodeBase64Utf8(b64) {
  const clean = String(b64 || '').replace(/\s/g, '');
  const bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function safeRel(relPath) {
  return (
    typeof relPath === 'string' &&
    relPath.length > 0 &&
    !relPath.includes('..') &&
    !relPath.includes('\\') &&
    !relPath.startsWith('/')
  );
}

/**
 * @param {object} a
 * @param {string} a.upstream   "owner/name" of the content repo.
 * @param {string} [a.token]    the member's GitHub token (higher rate limit; the repo is public so reads work
 *                              without it too).
 * @param {string} [a.ref]      branch/ref to read (default the repo default branch via 'HEAD').
 * @param {Function} [a.fetch]  injected for tests.
 */
export function createGithubReader({ upstream, token, ref = 'HEAD', fetch = globalThis.fetch, onAuthError, devlog = () => {} } = {}) {
  const [owner, repo] = String(upstream || '').split('/');
  const headers = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Expired-session detection: GitHub returns 401 ("Bad credentials") for ANY request carrying an invalid/expired
  // token, even on public content. So a 401 WHILE we sent a token means the member's token has died (GitHub App
  // user tokens expire), not that the resource is private. Fire `onAuthError` ONCE so the host can clear the dead
  // session and force re-auth, instead of every read silently failing to null (which reads as "you have no
  // content"). A 401 with NO token is just an auth-required resource, not an expired session, so we never fire then.
  let signaled = false;
  async function ghFetch(url) {
    const res = await fetch(url, { headers });
    // SOW-124: a non-ok GitHub read is the root of the "empty shares / wrong membership" class of bug, so log it
    // (redacted; the URL carries no secret, the token is never logged). A 401 carrying our token = a dead session.
    if (!res.ok) devlog('reader', 'github read not ok', { status: res.status, url, hadToken: !!token });
    if (res.status === 401 && token && onAuthError && !signaled) { signaled = true; devlog('reader', 'onAuthError: token rejected, clearing session', { url }); try { onAuthError(); } catch { /* never let the signal throw */ } }
    return res;
  }

  async function contents(relPath) {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURI(relPath)}?ref=${encodeURIComponent(ref)}`;
    const res = await ghFetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  // SOW-018: the WHOLE repo tree in ONE call (the Git Trees API resolves a branch/HEAD to its tree). Used to
  // enumerate members/*/shares/ across all members without N per-folder Contents calls (the reason
  // listMembersOnly was deferred). Returns { tree: [{ path, type }], truncated } or null.
  async function tree() {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
    const res = await ghFetch(url);
    if (!res.ok) return null;
    return res.json();
  }

  async function readFile(relPath) {
    if (!owner || !repo || !safeRel(relPath)) return null;
    const j = await contents(relPath);
    if (!j || Array.isArray(j) || j.type !== 'file' || typeof j.content !== 'string') return null;
    return decodeBase64Utf8(j.content);
  }

  async function get(username, relPath) {
    if (!username || typeof relPath !== 'string') return null;
    if (relPath.includes('..') || relPath.includes('\\') || !relPath.startsWith(`members/${username}/`)) return null;
    const text = await readFile(relPath);
    if (text == null) return null;
    const { frontmatter, body } = parseContentFile(text);
    return { path: relPath, frontmatter, body };
  }

  function summarize(relPath, frontmatter) {
    // SOW-085: a sortable publish date (ms, or null) matching client/src/repo-fs.mjs readItem (extension parity).
    // 2026-08-07: `updatedAt` too, for the separate "Recently updated" WorkBench sort. Keep both readers in step.
    const pubMs = frontmatter.publishedAt ? new Date(frontmatter.publishedAt).getTime() : NaN;
    const updMs = frontmatter.updatedAt ? new Date(frontmatter.updatedAt).getTime() : NaN;
    return {
      path: relPath,
      type: frontmatter.type ?? null,
      title: frontmatter.title ?? frontmatter.displayName ?? relPath,
      slug: frontmatter.slug ?? null,
      status: frontmatter.status ?? null,
      visibility: frontmatter.visibility ?? null,
      publishedAt: Number.isFinite(pubMs) ? pubMs : null,
      updatedAt: Number.isFinite(updMs) ? updMs : null,
    };
  }

  // SOW-145: `scope` selects the target folder — 'member' -> members/<username>/, 'house' -> the non-member
  // house/ folder (a superadmin surface; profiles are member-only). Mirrors client/src/repo-fs.mjs.
  async function listType(username, type, scope = 'member') {
    const houseScope = scope === 'house';
    if (type === 'profile') {
      if (houseScope) return [];
      const rel = `members/${username}/profile.md`;
      const text = await readFile(rel);
      if (text == null) return [];
      return [summarize(rel, parseContentFile(text).frontmatter)];
    }
    const sub = SUBDIR[type];
    if (!sub) return [];
    const base = houseScope ? `house/${sub}` : `members/${username}/${sub}`;
    const dir = await contents(base);
    if (!Array.isArray(dir)) return [];
    const out = [];
    for (const entry of dir) {
      if (entry.type !== 'dir') continue; // each item is <slug>/index.md
      const rel = `${base}/${entry.name}/index.md`;
      const text = await readFile(rel);
      if (text != null) out.push(summarize(rel, parseContentFile(text).frontmatter));
    }
    return out;
  }

  return {
    readFile,
    get,
    // SOW-031: read ANY member's or house's PUBLISHED content index.md for the in-extension reader. Unlike
    // get() (own-folder-scoped for editing), this is read-only over the public repo, gated by a strict
    // allowlist (only posts/products/prompts index.md, no traversal, no roles.yml / house/pages) so the member
    // token cannot become a general file-exfil oracle. Member-only BODIES are not here: the public teaser comes
    // back as `body`, and frontmatter.encryptedBody points at the .enc the reader decrypts via the Worker.
    async read(relPath) {
      if (!isReadablePath(relPath)) return null;
      const text = await readFile(relPath);
      if (text == null) return null;
      const { frontmatter, body } = parseContentFile(text);
      return { path: relPath, frontmatter, body };
    },
    async list(username, type, scope = 'member') {
      if (scope !== 'house' && !username) return [];
      if (type) return listType(username, type, scope);
      const all = [];
      for (const t of TYPES) all.push(...(await listType(username, t, scope)));
      return all;
    },
    /** Browsing ALL members-only content over the Contents API is too many calls for the live overlay; the npm
     * host portal (local working copy) is the surface for that. Deferred: returns []. */
    async listMembersOnly() {
      return [];
    },

    /**
     * SOW-018: list PUBLISHED Shares across ALL members for the extension Shares feed. ONE recursive Git Trees
     * call enumerates every members/<u>/shares/<id>.md path; because the Share id is a timestamp-slug, sorting
     * by the FILENAME yields newest-first, so we read only the newest `limit` files (bounded API calls), filter
     * drafts, and re-sort by createdAt. A members Share's plaintext is NOT read here (the stub body is empty;
     * its .enc is decrypted client-side via the Worker).
     */
    async listShares(limit = 40) {
      if (!owner || !repo) return [];
      const t = await tree();
      if (!t || !Array.isArray(t.tree)) return [];
      // The recursive Git Trees API truncates at ~100k entries / ~7MB and sets t.truncated; for this co-op's
      // repo that ceiling is years away. If it is ever hit, paths past the cut are dropped and this feed is
      // best-effort (a paginated per-folder fallback would be the future fix). The canonical repo holds only
      // PUBLISHED shares (trial drafts stay on forks), so the read loop below is ~cap reads in practice.
      const paths = t.tree
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && SHARE_PATH.test(e.path))
        .map((e) => e.path)
        .sort((a, b) => basename(b).localeCompare(basename(a))); // timestamp-slug filename -> newest first
      const cap = Math.max(0, limit);
      const out = [];
      // Read newest-first until the cap is met (or paths are exhausted) so filtered drafts never starve the feed
      // below the cap — matching the npm reader's completeness (which reads every file then slices).
      for (const rel of paths) {
        if (out.length >= cap) break;
        const text = await readFile(rel);
        if (text == null) continue;
        const { frontmatter, body } = parseContentFile(text);
        if ((frontmatter?.status ?? 'published') !== 'published') continue; // missing status = published (schema default); only an explicit draft is skipped
        out.push(shareSummary(rel, frontmatter, body));
      }
      out.sort(byShareNewest);
      return out.slice(0, cap);
    },

    /**
     * SOW-032: list PUBLISHED comments for a Share's discussion. ONE recursive Git Trees call enumerates every
     * members/<u>/comments/<id>.md + house/comments/<id>.md; we read the newest `limit` by filename (timestamp
     * stem -> newest first), keep published `targetType:'share'` comments whose targetSlug matches, and return
     * them OLDEST-first (a conversation reads top-down). A members comment's plaintext is NOT read here; its .enc
     * is decrypted client-side via the Worker, exactly like a members Share body.
     */
    // SOW-041: the generic comment-thread reader for ANY content type; listShareComments is a thin alias.
    async listShareComments(targetSlug, limit = 100) { return this.listComments('share', targetSlug, limit); },
    async listComments(targetType, targetSlug, limit = 100, aliases = []) {
      if (!owner || !repo || !targetType || !targetSlug) return [];
      const slugs = new Set([targetSlug, ...(Array.isArray(aliases) ? aliases : [])]); // SOW-112 rename aliases (parity with repo-fs)
      const t = await tree();
      if (!t || !Array.isArray(t.tree)) return [];
      const paths = t.tree
        .filter((e) => e && e.type === 'blob' && typeof e.path === 'string' && COMMENT_PATH.test(e.path))
        .map((e) => e.path)
        .sort((a, b) => basename(b).localeCompare(basename(a)));
      const cap = Math.max(0, limit);
      const out = [];
      for (const rel of paths) {
        if (out.length >= cap) break;
        const text = await readFile(rel);
        if (text == null) continue;
        const { frontmatter, body } = parseContentFile(text);
        if ((frontmatter?.status ?? 'published') !== 'published') continue; // missing status = published (schema default); only an explicit draft is skipped
        if (frontmatter?.targetType !== targetType || !slugs.has(frontmatter?.targetSlug)) continue;
        out.push(commentSummary(rel, frontmatter, body));
      }
      out.sort(byCommentOldest);
      return out.slice(0, cap);
    },
  };
}
