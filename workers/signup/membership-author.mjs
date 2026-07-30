// SOW-156 (spike): POST /membership/author — hosted authoring. A paid member with NO fork and NO App
// install hands the Worker a set of own-folder files; the Worker validates them fail-closed (the pure
// membership/hosted-author.mjs wall), commits them to a per-member branch on the CANONICAL repo with
// GBTI's installation token, and opens the PR. The Worker NEVER merges: the SOW-005 gate stays the only
// merger, so even a validation bug lands as a rejected PR, not a merged write (defense in depth).
//
// The member's folder is resolved from house/members-index.yml read LIVE from canonical main by
// github_id — the SAME mapping the merge gate uses (classify-pr ownedFolderFor) — never from the
// current GitHub login, so a rename or case mismatch cannot mis-scope a write. A member with no index
// entry gets a clear 409 (folder not provisioned), exactly the fork path's behavior today.
//
// Everything is injectable (fetch, fetchUser, authorize, kv, signJwt, limiter) so it unit-tests with
// fakes: no network, no secrets.

import { githubFetchUser } from './oauth.mjs';
import { authorizePaid } from './membership-content.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { kickDispatch } from './checkout.mjs';
import { parseMembersIndex, validateHostedRequest, hostedBranchFor } from '../../membership/hosted-author.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

/** Standard base64 of a UTF-8 string, chunked (btoa on a spread blows the stack at ~100KB). */
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

async function ghJson(fetchImpl, url, init) {
  const res = await fetchImpl(url, init);
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

export async function membershipAuthor(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, authorize = authorizePaid,
    kv = env?.SIGNUP_KV, limiter = rateLimit,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;

  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return { status: 403, body: { error: 'author_disabled', message: 'hosted authoring is not enabled' } };
  }

  const paid = await authorize(request, env, deps); // fail-closed: only paid members publish (SOW-011)
  if (!paid.ok) return { status: paid.status, body: paid.body };

  // Identity re-check: the branch name carries the github_id the gate trusts, so it is ALWAYS the verified id,
  // never anything from the request body. sow-158 Phase 3a: a website (cookie) caller already carries the
  // HMAC-verified github_id in the signed session (identity.mjs) and holds no bearer token, so the token
  // re-check is skipped for it; the bearer path (extension/npm) keeps its re-verification unchanged.
  let githubId = String(paid.githubId ?? '');
  if (paid.via !== 'cookie') {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    let user;
    try { user = await fetchUser(token, fetchImpl); } catch { return { status: 401, body: { error: 'unauthorized' } }; }
    const bearerId = String(user?.githubId ?? '');
    if (!bearerId || bearerId !== githubId) {
      return { status: 401, body: { error: 'unauthorized', message: 'could not verify the member identity' } };
    }
  }
  if (!githubId) return { status: 401, body: { error: 'unauthorized', message: 'could not verify the member identity' } };

  const rl = await limiter({ kv, ip: githubId, limit: 10, windowSeconds: 600, prefix: 'rl:author:' });
  if (!rl.allowed) return { status: 429, body: { error: 'rate_limited', message: 'too many publish requests; try again in a few minutes' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // Resolve the member's folder from the LIVE members-index on canonical main (what the gate reads).
  const idx = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, { headers: GH_HEADERS(instToken) });
  if (!idx.res.ok) return { status: 502, body: { error: 'index_unavailable', message: 'could not read the member index' } };
  let indexText = '';
  try { indexText = atob(String(idx.data?.content || '').replace(/\n/g, '')); } catch { /* fail closed below */ }
  const folder = parseMembersIndex(indexText).get(githubId) ?? null;
  if (!folder) {
    // SOW-157: this caller is a VERIFIED effective-paid member missing only their index entry, so fire the
    // 'enroll' repository_dispatch (the reconcile writes + merges the entry within minutes) — rate-limited
    // to one nudge per hour per member; the daily reconcile sweep heals any missed dispatch. Fail soft.
    const { dispatch = kickDispatch } = deps;
    const enrollRl = await limiter({ kv, ip: githubId, limit: 1, windowSeconds: 3600, prefix: 'rl:enroll:' });
    let provisioning = false;
    if (enrollRl.allowed) {
      provisioning = await dispatch({
        eventType: 'enroll', githubId,
        dispatchToken: env?.REGATE_DISPATCH_TOKEN, contentRepo: env?.GITHUB_CONTENT_REPO || upstream,
      }, fetchImpl);
    }
    return { status: 409, body: { error: 'folder_not_provisioned', provisioning, message: 'your member folder is being provisioned — try publishing again in a few minutes' } };
  }

  const itemId = String(payload?.itemId ?? '');
  const check = validateHostedRequest({ files: payload?.files, itemId, folder });
  if (!check.ok) return { status: check.status ?? 400, body: { error: 'bad_request', message: check.error } };
  const branch = hostedBranchFor(githubId, itemId);
  if (!branch) return { status: 400, body: { error: 'bad_request', message: 'invalid itemId' } };

  // Fresh-base the branch on live main (create, or force-reset if it exists): each request carries the
  // item's full file set, so a reset never loses work, and stale-base conflicts (SOW-152) cannot occur.
  const main = await ghJson(fetchImpl, `${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainSha = main.data?.object?.sha;
  if (!main.res.ok || !mainSha) return { status: 502, body: { error: 'git_failed', message: 'could not read the main branch' } };
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

  // Apply each file via the contents API on the branch. One retry on a 409 (concurrent sha race).
  for (const f of payload.files) {
    const applied = await applyFile(fetchImpl, instToken, upstream, branch, f);
    if (!applied.ok) return { status: 502, body: { error: 'git_failed', message: `could not write ${f.path}` } };
  }

  // Open the PR (canonical-head: head is just the branch name). The gate resolves the member from the
  // hosted/<github_id>/ ref, gates paid + own-folder, and auto-merges; the Worker never merges.
  const title = String(payload?.title || `Content update from ${folder}`).slice(0, 256);
  const body = `Hosted authoring: published on behalf of @${folder} (github_id ${githubId}) via the GBTI publishing app.`;
  const pr = await ghJson(fetchImpl, `${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  if (pr.res.status === 422) return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true } };
  if (!pr.res.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${pr.res.status}` } };
  return { status: 200, body: { ok: true, branch, number: pr.data.number, html_url: pr.data.html_url } };
}

/** PUT (or DELETE for content: null) one file on the branch; retries once on a 409 sha race. */
async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
  const url = `${GH}/repos/${upstream}/contents/${f.path}`;
  const existing = await ghJson(fetchImpl, `${url}?ref=${encodeURIComponent(branch)}`, { headers: GH_HEADERS(instToken) });
  const sha = existing.res.ok ? existing.data?.sha : undefined;
  const isBinary = f.contentBase64 !== undefined && f.contentBase64 !== null;
  if (f.content === null && !isBinary) {
    if (!sha) return { ok: true, skipped: true }; // deleting a file that does not exist is a no-op
    const res = await fetchImpl(url, {
      method: 'DELETE', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `content: remove ${f.path}`, sha, branch }),
    });
    if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
    return { ok: res.ok };
  }
  // sow-158 image upload: a binary entry is ALREADY base64 (a raster image, validated own-folder + capped in
  // validateHostedRequest); the Contents API takes base64 bytes directly, so pass it through un-re-encoded. A
  // text entry base64-encodes its UTF-8 string as before.
  const encoded = isBinary ? String(f.contentBase64) : b64utf8(f.content);
  const res = await fetchImpl(url, {
    method: 'PUT', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `content: update ${f.path}`, content: encoded, branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
  return { ok: res.ok };
}
