// sow-194: build the "repo drafts" index -- every content item committed with `status: draft` in the PUBLIC
// canonical repo -- so the signup Worker can serve an owner-scoped Drafts listing in the WorkBench WITHOUT
// scanning the repo live (86 content items would blow the Worker's 50-subrequest limit). CI reads the repo
// LOCALLY (no API, no limit), extracts the draft items, and PUTs the index to SIGNUP_KV; the Worker reads that
// one key. This mirrors the git-native index pattern (house/favorite-counts.yml, the overrides mirror): CI
// computes, the edge reads. Pure builder (fs only, node-testable) + a creds-gated KV PUT (reuses putKvJson).
//
// The repo is PUBLIC, so a draft is world-readable on GitHub regardless; this index only makes it VISIBLE in the
// tool, scoped server-side to the author (+ superadmins). No secret is created here.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { putKvJson } from './kv-mirror.mjs';

export const REPO_DRAFTS_KV_KEY = 'repo-drafts:index';

const TYPE_DIRS = Object.freeze({ posts: 'post', products: 'product', prompts: 'prompt' });

/** Read + parse ONLY the YAML frontmatter block of a content file, tolerant of a not-fully-valid draft. */
function readFrontmatter(abs) {
  let txt;
  try { txt = fs.readFileSync(abs, 'utf8'); } catch { return null; }
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(txt);
  if (!m) return null;
  try {
    const fm = yaml.load(m[1]);
    return fm && typeof fm === 'object' && !Array.isArray(fm) ? fm : null;
  } catch { return null; }
}

/** The index.md or index.mdx inside a content-item folder, or null. */
function itemFile(dir) {
  for (const name of ['index.md', 'index.mdx']) {
    const abs = path.join(dir, name);
    try { if (fs.statSync(abs).isFile()) return abs; } catch { /* not there */ }
  }
  return null;
}

/**
 * Load the lowercased-username -> IMMUTABLE github_id map from house/members-index.yml (the reconcile-maintained
 * `{ members: { "<github_id>": "<username>" } }`). The Worker scopes on this github_id, NOT the folder name / a
 * caller's login, because the codebase keys ownership on the immutable id everywhere (a rename migrates the
 * folder; a login can be renamed or reused). A member not yet in the index resolves to null -> fail closed (only
 * a superadmin, or the member once reconcile indexes them, sees the row), never a login match.
 */
function loadMemberIds(root) {
  const byLogin = new Map();
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(root, 'house', 'members-index.yml'), 'utf8'));
    const members = parsed?.members;
    if (members && typeof members === 'object' && !Array.isArray(members)) {
      for (const [id, username] of Object.entries(members)) {
        if (id && typeof username === 'string' && username) byLogin.set(username.toLowerCase(), String(id));
      }
    }
  } catch { /* absent -> no ids; member rows get githubId null (fail closed) */ }
  return byLogin;
}

/**
 * Collect status:draft items from one content BASE (members/<owner> or house) into `out`. Each row carries the
 * folder `owner` (for display + the path) AND the immutable `githubId` the Worker scopes on. House content has
 * NO github_id (githubId null), so a member can never match it (a member's login being literally 'house' cannot
 * collide with the sentinel because the match is by id, not by owner string).
 */
function collectDrafts(root, base, owner, githubId, out) {
  for (const [dirName, type] of Object.entries(TYPE_DIRS)) {
    const typeDir = path.join(base, dirName);
    let slugs;
    try { slugs = fs.readdirSync(typeDir).sort(); } catch { continue; } // type dir absent -> nothing
    for (const slug of slugs) {
      const abs = itemFile(path.join(typeDir, slug));
      if (!abs) continue;
      const fm = readFrontmatter(abs);
      if (!fm) continue;
      if ((fm.status ?? 'published') !== 'draft') continue; // missing status = published (schema default)
      out.push({
        path: path.relative(root, abs).split(path.sep).join('/'),
        type,
        slug,
        owner,
        githubId, // immutable id for scoping; null for house or an un-indexed member (fail closed)
        title: typeof fm.title === 'string' && fm.title ? fm.title : slug,
        visibility: fm.visibility === 'members' ? 'members' : 'public',
      });
    }
  }
}

/**
 * Walk the repo for every `status: draft` content item. Returns a stable, path-sorted array of
 * { path, type, slug, owner, title, visibility }. `owner` is the member login (lowercased) or 'house'.
 * Governance / non-content paths never match (only posts/products/prompts item folders are walked). Pure.
 */
export function buildRepoDraftsIndex(root) {
  const out = [];
  const byLogin = loadMemberIds(root);
  const membersDir = path.join(root, 'members');
  let owners = [];
  try { owners = fs.readdirSync(membersDir).sort(); } catch { owners = []; }
  for (const owner of owners) {
    const base = path.join(membersDir, owner);
    try { if (!fs.statSync(base).isDirectory()) continue; } catch { continue; }
    const login = owner.toLowerCase();
    collectDrafts(root, base, login, byLogin.get(login) ?? null, out);
  }
  collectDrafts(root, path.join(root, 'house'), 'house', null, out); // house has no github_id
  out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return out;
}

/**
 * PUT the built index to KV `repo-drafts:index` as { generatedAt, items }. Creds-gated no-op (reported, not a
 * throw) when CF_* is absent, exactly like the overrides mirror. Throws only on a real API error.
 */
export async function mirrorRepoDraftsToKv({ root, env = process.env, fetchImpl = globalThis.fetch, now = new Date(), key = REPO_DRAFTS_KV_KEY } = {}) {
  const items = buildRepoDraftsIndex(root);
  const body = JSON.stringify({ generatedAt: now.toISOString(), items });
  return putKvJson({ label: 'repo drafts index', body, env, fetchImpl, key });
}
