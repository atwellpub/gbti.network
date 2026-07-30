// sow-158 Part 3: the tier-gated community Shares feed for the website /account hub. The members-only Shares
// stream can NEVER be a public build artifact (the build guard forbids members-share titles/metadata in dist),
// so it is served HERE, gated server-side: a paid or trialing caller sees the members + public stream; every
// other signed-in tier (free / expired / banned) sees ONLY public shares. Members bodies stay POINTER-ONLY
// (encryptedBody); the client decrypts on expand via /membership/decrypt, so the AES key never leaves the
// Worker. Enumeration is one GitHub Trees call (the share id is a timestamp-slug, lexically = chronologically
// sortable) + reading the newest N stub files, cached ~60s in SIGNUP_KV so repeat loads are cheap.
//
// Returns { status, body } for the router. Pure over injected fetch + kv, so it is unit-tested with fakes.

import { getInstallationToken } from './github-app.mjs';
import { authorizeSignedIn } from './membership-content.mjs';
import { parseContentFile, shareSummary, byShareNewest } from '../../client/src/content-ops.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const SHARE_PATH = /^members\/[^/]+\/shares\/([^/]+)\.(?:md|mdx)$/;
const READ_MEMBERS = new Set(['paid', 'trialing']); // who may see the members-only stream (mirror READ_TRIAL_OK)
const CACHE_KEY = 'shares:feed:v1';
const CACHE_TTL_SECONDS = 60;
const CACHE_N = 60; // cache the newest N summaries (3 pages of 20); older pages read live
const MAX_LIMIT = 40;

/** Decode a GitHub Contents API base64 blob to a UTF-8 string (mirrors reviewFileContent). */
function decodeContent(b64) {
  const bin = atob(String(b64).replace(/\s+/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Enumerate + read the newest shares across every member folder, newest-first. Returns share SUMMARIES (public
 * bodies inline; a members share's body is '' with an encryptedBody pointer — the plaintext never travels here).
 * One Trees call selects the files (id desc = newest), then the newest `cacheN` stub files are read. Cached in
 * SIGNUP_KV for CACHE_TTL_SECONDS. Throws on a Trees failure so the route can 502 (never a partial silent open).
 */
export async function enumerateShares(env, { fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network', cacheN = CACHE_N, useCache = true, getToken = getInstallationToken } = {}) {
  if (useCache && kv) {
    try { const cached = await kv.get(CACHE_KEY, 'json'); if (cached && Array.isArray(cached.items)) return cached.items; } catch { /* cold read */ }
  }
  const instToken = await getToken(env, { fetchImpl, kv });
  const treeRes = await fetchImpl(`${GH}/repos/${upstream}/git/trees/main?recursive=1`, { headers: GH_HEADERS(instToken) });
  if (!treeRes || !treeRes.ok) throw new Error(`git trees ${treeRes ? treeRes.status : 'no response'}`);
  const tree = await treeRes.json().catch(() => null);
  const nodes = Array.isArray(tree?.tree) ? tree.tree : [];
  const files = nodes
    .filter((n) => n && n.type === 'blob' && typeof n.path === 'string' && SHARE_PATH.test(n.path))
    .map((n) => ({ path: n.path, id: n.path.match(SHARE_PATH)[1] }))
    .sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)) // id desc = newest first (the id is a timestamp-slug)
    .slice(0, Math.max(0, cacheN));

  const items = [];
  for (const f of files) {
    let res;
    try { res = await fetchImpl(`${GH}/repos/${upstream}/contents/${f.path}?ref=main`, { headers: GH_HEADERS(instToken) }); } catch { continue; }
    if (!res || !res.ok) continue;
    const data = await res.json().catch(() => null);
    if (!data || Array.isArray(data) || !data.content) continue;
    let text;
    try { text = decodeContent(data.content); } catch { continue; }
    let parsed;
    try { parsed = parseContentFile(text); } catch { continue; }
    if ((parsed.frontmatter?.status ?? 'published') !== 'published') continue; // missing status = published (schema default)
    items.push(shareSummary(f.path, parsed.frontmatter, parsed.body));
  }
  items.sort(byShareNewest);

  if (useCache && kv) {
    try { await kv.put(CACHE_KEY, JSON.stringify({ generatedAt: new Date().toISOString(), items }), { expirationTtl: CACHE_TTL_SECONDS }); } catch { /* best-effort */ }
  }
  return items;
}

/**
 * GET /membership/shares?limit=20&before=<id> — the tier-gated community Shares feed. Cookie-or-bearer via
 * authorizeSignedIn (admits every signed-in tier, INCLUDING banned, so free/banned still read PUBLIC shares).
 * A paid/trialing caller additionally sees the members-only stream; everyone else is filtered to public shares.
 * `before` is a share id cursor (return strictly-older items) for the "load older" pager.
 */
export async function listSharesFeed(request, env, deps = {}) {
  const { authorize = authorizeSignedIn } = deps;
  const auth = await authorize(request, env, { ...deps, allowCookie: true });
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : 20;
  const before = url.searchParams.get('before') || null;

  let all;
  try { all = await enumerateShares(env, deps); } catch { return { status: 502, body: { error: 'shares_failed', message: 'could not load shares right now' } }; }

  const canSeeMembers = READ_MEMBERS.has(auth.status);
  let items = canSeeMembers ? all : all.filter((s) => String(s?.visibility || 'members').toLowerCase() === 'public');
  if (before) items = items.filter((s) => String(s?.id || '') < before); // strictly older than the cursor
  const page = items.slice(0, limit);
  const nextBefore = page.length === limit ? String(page[page.length - 1]?.id || '') || null : null;
  return { status: 200, body: { ok: true, items: page, canSeeMembers, nextBefore } };
}
