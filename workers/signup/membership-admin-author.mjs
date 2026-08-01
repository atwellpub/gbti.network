// sow-161: POST /membership/admin/author — server-side admin mutations (increment 1: content moderation).
//
// A STAFF member (moderator+) moderates any content item: deplatform (status -> draft), republish (-> published),
// or remove (delete). The cookie session has no GitHub token, so the Worker applies the change and opens the PR
// with GBTI's INSTALLATION token; the SOW-005 gate is the only merger. Two properties keep this safe:
//   1. The mutation is computed SERVER-SIDE. The caller names an ACTION + a target PATH, never file content, so a
//      moderator can only flip status or remove, never rewrite another member's words.
//   2. The PR is committed to `hosted-admin/<callerGithubId>/<action-slug>` with the github_id ALWAYS taken from
//      the verified session/token (never the body). The gate resolves that id -> its git-native role and re-checks
//      it against the touched path (decide()), so even a bug here cannot merge beyond the caller's real role.
//
// CSRF: the cookie path enforces the double-submit token inside resolveIdentity (a POST is a non-safe method); the
// bearer path (extension) needs none. Everything is injectable (fetchImpl, authorize, kv, limiter) for unit tests.

import { authorizeStaff } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { flipContentStatus } from '../../client/src/content-ops.mjs'; // already in the Worker bundle (membership-shares)
import { isCleanPath } from '../../membership/classify-pr.mjs';
import { adminHostedBranchFor } from '../../membership/hosted-author.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

// The moderation actions and the status each sets (remove is a delete, handled separately).
const CONTENT_ACTIONS = new Set(['deplatform', 'republish', 'remove']);
const STATUS_FOR = { deplatform: 'draft', republish: 'published' };
// A content item index.md under a member OR house content folder (posts/products/prompts). The gate re-checks the
// caller's authority over this path; this regex only bounds the shape (a clean content item, never a config file).
const CONTENT_ITEM_RE = /^(?:members\/[a-z0-9][a-z0-9-]*|house)\/(?:posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;

/** Standard base64 of a UTF-8 string, chunked. */
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
/** Decode a GitHub Contents API base64 blob to a UTF-8 string, or null. */
function decodeContent(b64) {
  try {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}
/** A bounded, git-safe action slug for the branch (`deplatform-my-post`), from the item slug. */
function actionSlug(action, path) {
  const m = /\/([a-z0-9][a-z0-9-]*)\/index\.md$/.exec(path);
  return `${action}-${m ? m[1] : 'item'}`.slice(0, 80);
}

export async function membershipAdminAuthor(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeStaff, kv = env?.SIGNUP_KV, limiter = rateLimit,
    allowCookie = false, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;

  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return { status: 403, body: { error: 'author_disabled', message: 'hosted authoring is not enabled' } };
  }

  // Staff gate (moderator+). The cookie path verifies the session HMAC + enforces CSRF (POST) inside resolveIdentity;
  // the bearer path re-verifies the token. Fail-closed: a non-staff caller never reaches the mutation.
  const staff = await authorize(request, env, { ...deps, allowCookie });
  if (!staff.ok) return { status: staff.status, body: staff.body };
  const githubId = String(staff.githubId);

  const rl = await limiter({ kv, ip: githubId, limit: 20, windowSeconds: 600, prefix: 'rl:admin-author:' });
  if (!rl.allowed) return { status: 429, body: { error: 'rate_limited', message: 'too many admin actions; try again shortly' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const action = String(payload?.action || '');
  const path = String(payload?.path || '');
  if (!CONTENT_ACTIONS.has(action)) return { status: 400, body: { error: 'bad_request', message: 'unsupported admin action' } };
  if (!isCleanPath(path) || !CONTENT_ITEM_RE.test(path)) {
    return { status: 400, body: { error: 'bad_request', message: 'a clean content item path is required' } };
  }

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // Read the current file from canonical main. A 404 means nothing to moderate.
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { status: 404, body: { error: 'not_found', message: 'no such content item on the network' } };
  if (!cur.ok) return { status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  const curData = await cur.json().catch(() => ({}));

  // Compute the file change SERVER-SIDE.
  let file;
  if (action === 'remove') {
    file = { path, content: null };
  } else {
    const text = decodeContent(curData?.content);
    if (text == null) return { status: 502, body: { error: 'read_failed', message: 'could not read the content item' } };
    const flip = flipContentStatus(text, STATUS_FOR[action]);
    if (!flip.changed) return { status: 200, body: { ok: true, noop: true, message: `already ${STATUS_FOR[action]}` } };
    file = { path, content: flip.content };
  }

  const branch = adminHostedBranchFor(githubId, actionSlug(action, path));
  if (!branch) return { status: 500, body: { error: 'internal', message: 'could not build the admin branch' } };

  // Fresh-base the branch on live main (create, or force-reset if it exists), then apply the single file, then open
  // the auto-gated PR. Mirrors the membership-author git flow; a later refactor can share it (the security is in the
  // authorize + the branch id + the gate, not this generic plumbing).
  const main = await fetchImpl(`${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainData = await main.json().catch(() => ({}));
  const mainSha = mainData?.object?.sha;
  if (!main.ok || !mainSha) return { status: 502, body: { error: 'git_failed', message: 'could not read the main branch' } };
  const create = await fetchImpl(`${GH}/repos/${upstream}/git/refs`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!create.ok) {
    if (create.status !== 422) return { status: 502, body: { error: 'git_failed', message: 'could not create the branch' } };
    const reset = await fetchImpl(`${GH}/repos/${upstream}/git/refs/heads/${branch}`, {
      method: 'PATCH', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: mainSha, force: true }),
    });
    if (!reset.ok) return { status: 502, body: { error: 'git_failed', message: 'could not reset the branch' } };
  }

  const applied = await applyFile(fetchImpl, instToken, upstream, branch, file);
  if (!applied.ok) return { status: 502, body: { error: 'git_failed', message: `could not write ${file.path}` } };

  const title = `Moderation: ${action} ${path}`.slice(0, 256);
  const body = `Content moderation (${action}) by github_id ${githubId} via the GBTI admin surface (sow-161).`;
  const pr = await fetchImpl(`${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  const prData = await pr.json().catch(() => ({}));
  if (pr.status === 422) return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true } };
  if (!pr.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${pr.status}` } };
  return { status: 200, body: { ok: true, branch, number: prData.number, html_url: prData.html_url } };
}

/** PUT (or DELETE for content:null) one file on the branch; one retry on a 409 sha race. Mirrors membership-author. */
async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
  const url = `${GH}/repos/${upstream}/contents/${f.path}`;
  const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(branch)}`, { headers: GH_HEADERS(instToken) });
  const exData = await existing.json().catch(() => ({}));
  const sha = existing.ok ? exData?.sha : undefined;
  if (f.content === null) {
    if (!sha) return { ok: true, skipped: true }; // deleting a file that is already gone is a no-op
    const res = await fetchImpl(url, {
      method: 'DELETE', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `content: remove ${f.path}`, sha, branch }),
    });
    if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
    return { ok: res.ok };
  }
  const res = await fetchImpl(url, {
    method: 'PUT', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `content: update ${f.path}`, content: b64utf8(f.content), branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
  return { ok: res.ok };
}
