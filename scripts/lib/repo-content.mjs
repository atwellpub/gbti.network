// SOW-005 reconcile: read the working tree into a repoIndex the pure planner consumes.
// For each member username we collect every content file with its current `status`
// (published|draft) and `visibility` (public|members), parsed from frontmatter with a simple
// line scan (the same style as scripts/validate-content.mjs, no YAML parser needed for two fields).
//
// We index ONLY member-owned content (members/<username>/{profile.md, posts, products, prompts}).
// house/** is GBTI-Network's own content and is not membership-gated, so the reconcile leaves it
// alone.
//
// buildRepoIndex returns { byUsername, byGithubLogin, byGithubId }:
//   byUsername:    map <username> -> { files: [{ path, status, visibility }] } (the planner shape).
//   byGithubLogin: map <lowercased github login> -> <username>, derived from each profile.md
//                  links.github URL (the trailing path segment). This makes lapse-time folder
//                  resolution authoritative even when a Stripe metadata.github_login does NOT equal
//                  the on-disk folder name (for example folder 'hudson' whose github login is
//                  'atwellpub'). Without it a lapsed member's content would stay published, which is
//                  a fail-OPEN bug.
//   byGithubId:    map <profile github_id> -> <username> for any profile that carries github_id
//                  today (most do not yet; that is fine, the map is simply sparse).

import fs from 'node:fs';
import path from 'node:path';

const CONTENT_DIRS = ['posts', 'products', 'prompts'];

/** Read one frontmatter scalar by key (first match), tolerant of optional quotes. Mirrors validate-content.mjs. */
function field(txt, key) {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm').exec(txt);
  return m ? m[1].trim() : null;
}

const has = (p) => fs.existsSync(p);

/** Convert an absolute path under root into a repo-relative forward-slash path. */
function relPath(root, abs) {
  return path.relative(root, abs).split(path.sep).join('/');
}

/**
 * Extract a lowercased GitHub login from a links.github URL such as
 * "https://github.com/atwellpub" or "https://github.com/atwellpub/" -> "atwellpub".
 * Returns null when the value is missing or has no usable trailing segment. The github URL lives
 * under a nested `links:` block in the profile frontmatter, so we read the indented `github:` line.
 */
export function githubLoginFromProfile(txt) {
  if (!txt) return null;
  // Match the indented `github:` line inside the links block (allow leading whitespace).
  const m = /^\s+github:\s*"?([^"\n]+?)"?\s*$/m.exec(txt);
  const raw = m ? m[1].trim() : null;
  if (!raw) return null;
  return githubLoginFromUrl(raw);
}

/** Pull the trailing path segment out of a github URL (or a bare login) and lowercase it. */
export function githubLoginFromUrl(value) {
  if (!value) return null;
  // Strip a protocol + host if present, then take the first non-empty path segment.
  const withoutProtocol = value.replace(/^[a-z]+:\/\//i, '');
  const afterHost = withoutProtocol.replace(/^github\.com\//i, '');
  // afterHost is now "<login>" or "<login>/..." or, for a bare login, just "<login>".
  const segment = afterHost.split(/[/?#]/).filter(Boolean)[0] ?? null;
  if (!segment) return null;
  return segment.toLowerCase();
}

/** Parse a single content file into { path, status, visibility }. Defaults: status 'published', visibility 'public'. */
function readContentFile(root, abs) {
  const txt = fs.readFileSync(abs, 'utf8');
  const status = field(txt, 'status') ?? 'published';
  const visibility = field(txt, 'visibility') ?? 'public';
  return { path: relPath(root, abs), status, visibility };
}

/**
 * Collect content files for one member folder (profile.md plus posts/products/prompts/<slug>/index.md)
 * and the profile-derived identity ({ githubLogin, githubId }). The identity is read from profile.md
 * (links.github URL for the login, an optional top-level github_id field).
 */
function readMemberFiles(root, memberDir) {
  const files = [];
  let githubLogin = null;
  let githubId = null;
  const profile = path.join(memberDir, 'profile.md');
  if (has(profile)) {
    files.push(readContentFile(root, profile));
    const txt = fs.readFileSync(profile, 'utf8');
    githubLogin = githubLoginFromProfile(txt);
    githubId = field(txt, 'github_id');
  }
  for (const sub of CONTENT_DIRS) {
    const dir = path.join(memberDir, sub);
    if (!has(dir)) continue;
    for (const slug of fs.readdirSync(dir).sort()) {
      const idx = path.join(dir, slug, 'index.md');
      if (has(idx)) files.push(readContentFile(root, idx));
    }
  }
  return { files, githubLogin, githubId };
}

/**
 * Build the repoIndex from the working tree.
 * @param {string} root repo root (the directory holding `members/`).
 * @returns {{ byUsername: object, byGithubLogin: Map<string,string>, byGithubId: Map<string,string> }}
 */
export function buildRepoIndex(root) {
  const byUsername = {};
  const byGithubLogin = new Map();
  const byGithubId = new Map();
  const membersDir = path.join(root, 'members');
  if (!has(membersDir)) return { byUsername, byGithubLogin, byGithubId };
  for (const user of fs.readdirSync(membersDir).sort()) {
    const memberDir = path.join(membersDir, user);
    if (!fs.statSync(memberDir).isDirectory()) continue;
    const { files, githubLogin, githubId } = readMemberFiles(root, memberDir);
    byUsername[user] = { files };
    if (githubLogin) byGithubLogin.set(githubLogin, user);
    if (githubId) byGithubId.set(String(githubId), user);
  }
  return { byUsername, byGithubLogin, byGithubId };
}

export { field, CONTENT_DIRS };
