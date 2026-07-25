// SOW-026: the server-side PR-opener. A member's fork-scoped GitHub App token can PUSH to their fork but
// CANNOT open the PR into the canonical repo (the create-PR call is evaluated against the upstream owner, and
// fine-grained / App tokens cannot open outside-contributor PRs; GitHub closed that as "not planned"). So the
// Worker, authenticating as GBTI's OWN App installation on the canonical repo, opens the PR on the member's
// behalf. The App private key never leaves the Worker. The member's token only AUTHORIZES + IDENTIFIES them;
// it is never used to open the PR.
//
// Everything is injectable (fetch, now, kv, signJwt, the authorizer), so it unit-tests with fakes: no real key,
// no network, no secrets.

import { githubFetchUser } from './oauth.mjs';
import { authorizePaid } from './membership-content.mjs';
import { parseHostedRef } from '../../membership/hosted-author.mjs'; // SOW-157: hosted PR ownership match

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const INSTALL_TOKEN_KEY = 'gh-app:installation-token';
// Must match scripts/pr-gate.mjs STATUS_CONTEXT + client/src/github-repo.mjs GATE_CONTEXT.
const GATE_CONTEXT = 'membership-gate';

/** Map the gate's combined-status state to a member-facing meaning (mirrors github-repo.mjs interpretGateState). */
function interpretGateState(state) {
  switch (state) {
    case 'success': return 'mergeable';
    case 'pending': return 'checking';
    case 'failure': return 'held';
    case 'error': return 'error';
    default: return 'unknown';
  }
}

/** The fork owner (lowercased) a PR's head lives on; in the hybrid flow the App opens the PR, so the member is
 *  identified by their FORK, not by the PR author. */
const headOwnerOf = (pr) => String(pr?.head?.repo?.owner?.login || pr?.head?.user?.login || '').toLowerCase();

function b64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const b64url = (input) => b64urlBytes(typeof input === 'string' ? new TextEncoder().encode(input) : input);
// NOTE: WebCrypto importKey('pkcs8') needs a PKCS#8 key ("BEGIN PRIVATE KEY"). GitHub downloads the App key as
// PKCS#1 ("BEGIN RSA PRIVATE KEY"), so convert it once before setting the secret:
//   openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in app.private-key.pem -out app.pkcs8.pem
function pemToPkcs8(pem) {
  const b64 = String(pem).replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Sign a short-lived GitHub App JWT (RS256) with the App private key (PEM PKCS8). The Worker holds the key. */
export async function signAppJwt(env, { now = Date.now, subtle = globalThis.crypto?.subtle } = {}) {
  if (!env?.GITHUB_APP_ID || !env?.GITHUB_APP_PRIVATE_KEY) throw new Error('GitHub App is not configured (GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY)');
  const iat = Math.floor(now() / 1000) - 30; // clock-skew slack
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat, exp: iat + 9 * 60, iss: String(env.GITHUB_APP_ID) }));
  const input = `${head}.${body}`;
  const key = await subtle.importKey('pkcs8', pemToPkcs8(env.GITHUB_APP_PRIVATE_KEY), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(input));
  return `${input}.${b64urlBytes(new Uint8Array(sig))}`;
}

/** Mint (or reuse from KV, refreshed ~hourly) an installation access token for the canonical-repo installation. */
export async function getInstallationToken(env, { fetchImpl = globalThis.fetch, now = Date.now, kv = env?.SIGNUP_KV, signJwt = signAppJwt } = {}) {
  if (!env?.GITHUB_APP_INSTALLATION_ID) throw new Error('GitHub App installation is not configured (GITHUB_APP_INSTALLATION_ID)');
  if (kv) {
    const cached = await kv.get(INSTALL_TOKEN_KEY, 'json').catch(() => null);
    if (cached?.token && cached.expiresAt - now() > 5 * 60 * 1000) return cached.token; // reuse until ~5min before expiry
  }
  const jwt = await signJwt(env, { now });
  const res = await fetchImpl(`${GH}/app/installations/${env.GITHUB_APP_INSTALLATION_ID}/access_tokens`, { method: 'POST', headers: GH_HEADERS(jwt) });
  if (!res || !res.ok) throw new Error(`installation token mint failed: ${res ? res.status : 'no response'}`);
  const data = await res.json();
  const expiresAt = Date.parse(data.expires_at) || now() + 55 * 60 * 1000;
  if (kv) await kv.put(INSTALL_TOKEN_KEY, JSON.stringify({ token: data.token, expiresAt }), { expirationTtl: 3000 }).catch(() => {});
  return data.token;
}

// SOW-106 Phase A: the publisher App is ALSO installed on each member's fork (the onboarding install step),
// so the Worker can mint a FORK-scoped installation token and perform fork maintenance the member's own token
// cannot (merge-upstream needs the workflows permission, which the App carries once the owner expands it).
const FORK_TOKEN_KEY = (login) => `gh-app:fork-token:${login}`;

/**
 * Mint (or reuse from KV) an installation access token for the App installation on ONE member's fork.
 * Fail-soft: returns null when the App is not configured, not installed on that fork, or GitHub errors —
 * callers treat null as "sync unavailable", never a hard failure.
 */
export async function getForkInstallationToken(env, login, { fetchImpl = globalThis.fetch, now = Date.now, kv = env?.SIGNUP_KV, signJwt = signAppJwt, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = {}) {
  const who = String(login || '').toLowerCase();
  if (!who || !env?.GITHUB_APP_ID || !env?.GITHUB_APP_PRIVATE_KEY) return null;
  const repoName = String(upstream).split('/')[1] || 'gbti.network';
  if (kv) {
    const cached = await kv.get(FORK_TOKEN_KEY(who), 'json').catch(() => null);
    if (cached?.token && cached.expiresAt - now() > 5 * 60 * 1000) return cached.token;
  }
  try {
    const jwt = await signJwt(env, { now });
    const ins = await fetchImpl(`${GH}/repos/${who}/${repoName}/installation`, { headers: GH_HEADERS(jwt) });
    if (!ins || !ins.ok) return null; // no fork, or the App is not installed on it
    const inst = await ins.json();
    if (!inst?.id) return null;
    const res = await fetchImpl(`${GH}/app/installations/${inst.id}/access_tokens`, { method: 'POST', headers: GH_HEADERS(jwt) });
    if (!res || !res.ok) return null;
    const data = await res.json();
    const expiresAt = Date.parse(data.expires_at) || now() + 55 * 60 * 1000;
    if (kv) await kv.put(FORK_TOKEN_KEY(who), JSON.stringify({ token: data.token, expiresAt }), { expirationTtl: 3000 }).catch(() => {});
    return data.token;
  } catch {
    return null;
  }
}

/**
 * Open the publish PR for an EFFECTIVE-PAID member. The member's token authorizes (paid, fail-closed) and
 * identifies them; the PR is opened with the canonical-repo installation token. A member may only open a PR
 * whose HEAD is their OWN fork (head = "<their-login>:<branch>"); anything else is rejected.
 */
export async function openPullForMember(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, authorize = authorizePaid,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;

  const paid = await authorize(request, env, deps); // fail-closed: only paid members publish (SOW-011)
  if (!paid.ok) return { status: paid.status, body: paid.body };

  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  let user;
  try { user = await fetchUser(token, fetchImpl); } catch { return { status: 401, body: { error: 'unauthorized' } }; }
  // githubFetchUser returns { githubId, githubLogin } (oauth.mjs); read githubLogin (the `login` fallback keeps
  // any other-shaped caller working). Reading the wrong key silently emptied the login and 401'd every app-mode
  // publish/read in production while test stubs that used `login` masked it.
  const login = String(user?.githubLogin || user?.login || '').toLowerCase();
  if (!login || String(user?.githubId) !== String(paid.githubId)) return { status: 401, body: { error: 'unauthorized', message: 'could not verify the member identity' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const head = String(payload?.head || '');
  const base = String(payload?.base || 'main');
  const headOwner = head.includes(':') ? head.split(':')[0].toLowerCase() : '';
  if (headOwner !== login) return { status: 403, body: { error: 'forbidden', message: 'the PR head must be your own fork' } };
  if (!/^[\w.\/-]{1,100}$/.test(base)) return { status: 400, body: { error: 'bad_request', message: 'invalid base branch' } };

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls`, {
    method: 'POST',
    headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: String(payload?.title || 'GBTI content').slice(0, 256), head, base, body: String(payload?.body || '').slice(0, 60000), maintainer_can_modify: false }),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 422) return { status: 200, body: { ok: true, number: null, html_url: null, already: true, message: data?.errors?.[0]?.message || 'a pull request already exists for this branch' } };
  if (!res.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${res.status}` } };
  return { status: 200, body: { ok: true, number: data.number, html_url: data.html_url } };
}

/**
 * Resolve the caller's GitHub login (lowercased) from their bearer token. Reads of the public canonical repo
 * are benign, so this needs only a VALID member token (no paid gate) -- but every read below is then SCOPED to
 * the caller's own fork, so the installation token can never be used to surface another member's PRs.
 */
async function authMemberLogin(request, { fetchImpl, fetchUser }) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'a GitHub bearer token is required' } };
  let user;
  try { user = await fetchUser(token, fetchImpl); } catch { return { ok: false, status: 401, body: { error: 'unauthorized', message: 'could not verify the GitHub token' } }; }
  // githubFetchUser returns { githubId, githubLogin }; read githubLogin (with a `login` fallback). See the same
  // note in openPullForMember: the prior user?.login read 401'd every app-mode my-pulls/pr-status in production.
  const login = String(user?.githubLogin || user?.login || '').toLowerCase();
  if (!login) return { ok: false, status: 401, body: { error: 'unauthorized', message: 'the token has no user login' } };
  // SOW-157: the hosted PR match keys on the immutable github_id (the hosted branch carries it).
  return { ok: true, login, githubId: user?.githubId != null ? String(user.githubId) : null };
}

/**
 * SOW-157: does this PR belong to the caller as a HOSTED PR? True only when the head lives on the CANONICAL
 * repo itself (same-repo head) AND the branch parses to the caller's github_id. The same-repo guard is
 * security-load-bearing: without it a member could push a branch named hosted/<victim_id>/x to their OWN
 * fork and plant PRs in the victim's workspace. Fork heads always fall to the headOwnerOf filter instead,
 * so the two matchers are disjoint (a canonical head's owner is the org, which is no member's login).
 */
function isCallerHostedPull(pr, githubId) {
  if (!githubId) return false;
  const headRepoId = pr?.head?.repo?.id ?? null;
  const baseRepoId = pr?.base?.repo?.id ?? null;
  if (headRepoId == null || String(headRepoId) !== String(baseRepoId)) return false;
  return parseHostedRef(pr?.head?.ref) === String(githubId);
}

/**
 * GET /membership/my-pulls -> { ok, items: [{ number, title, html_url }] }: the caller's OPEN PRs on the
 * canonical repo. A fork-scoped member token cannot read the upstream, and in the hybrid flow GBTI's App (not
 * the member) opens the PRs, so this reads with the installation token and filters by the PR HEAD fork owner ==
 * the member's login (never by author).
 */
export async function listMemberPulls(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  // SOW-033 P4: state=all (open + closed + merged) sorted by recent activity, capped, so the workspace can show
  // Accepted (merged) and Declined (closed). The headOwnerOf == who.login filter is UNCHANGED, so a member still
  // only ever sees PRs opened from their own fork. The pulls-list object carries merged_at (set only when merged).
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls?state=all&sort=updated&direction=desc&per_page=100`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) return { status: 502, body: { error: 'list_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => []);
  const items = (Array.isArray(list) ? list : [])
    .filter((pr) => headOwnerOf(pr) === who.login || isCallerHostedPull(pr, who.githubId))
    .map((pr) => ({ number: pr.number, title: pr.title, html_url: pr.html_url, state: pr.state, merged: Boolean(pr.merged_at) }));
  return { status: 200, body: { ok: true, items } };
}

/**
 * GET /membership/pr-status?number=N -> { ok, state, meaning, sha, description }: the gate status of ONE of the
 * caller's PRs. Verifies the PR head fork owner == the member's login FIRST (so a member can only read their
 * OWN PR's status, never an arbitrary number), then reads the head commit's combined status filtered to the
 * gate context. Installation-token reads; the member token identifies + scopes.
 */
export async function memberPrStatus(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const number = Number(new URL(request.url).searchParams.get('number'));
  if (!Number.isInteger(number) || number <= 0) return { status: 400, body: { error: 'bad_request', message: 'a positive PR number is required' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // A PR that does not exist AND a PR that is not the caller's both return the SAME 404, so this endpoint never
  // reveals (via a 403-vs-404 distinction) which PR numbers exist on the canonical repo.
  const notYours = { status: 404, body: { error: 'not_found', message: 'no such pull request (or not yours)' } };
  const prRes = await fetchImpl(`${GH}/repos/${upstream}/pulls/${number}`, { headers: GH_HEADERS(instToken) });
  if (prRes && prRes.status === 404) return notYours;
  if (!prRes || !prRes.ok) return { status: 502, body: { error: 'status_failed', message: `GitHub returned ${prRes ? prRes.status : 'no response'}` } };
  const pr = await prRes.json().catch(() => ({}));
  if (headOwnerOf(pr) !== who.login && !isCallerHostedPull(pr, who.githubId)) return notYours; // exists but not the caller's: indistinguishable from not-found
  const sha = pr?.head?.sha;
  if (!sha) return { status: 200, body: { ok: true, state: 'unknown', meaning: 'unknown', sha: null, description: null } };

  const stRes = await fetchImpl(`${GH}/repos/${upstream}/commits/${encodeURIComponent(sha)}/status`, { headers: GH_HEADERS(instToken) });
  if (!stRes || !stRes.ok) return { status: 502, body: { error: 'status_failed', message: `GitHub returned ${stRes ? stRes.status : 'no response'}` } };
  const status = await stRes.json().catch(() => ({}));
  const gate = (status.statuses ?? []).find((s) => s.context === GATE_CONTEXT);
  const state = gate?.state ?? status.state ?? 'unknown';
  return { status: 200, body: { ok: true, state, meaning: interpretGateState(state), sha, description: gate?.description ?? null } };
}

// ----- SOW-028: read proxies for the in-client contribution review INBOX (app mode) -----
//
// Unlike my-pulls / pr-status (which scope to the caller's OWN fork), the contribution inbox is about OTHER
// members' PRs opened against the caller's folder, so the contributor's fork (not the caller's) owns the head.
// These endpoints therefore CANNOT scope by head owner. That is safe: the canonical repo is PUBLIC, so every PR,
// diff, and file these return is already world-readable on github.com. The installation token only stands in for
// the fork-scoped member token's inability to reach the upstream; it surfaces nothing private. The CLIENT filters
// the list to the caller's own folder (isContributionToFolder). A valid member token is required (no paid gate;
// reads only). NOTE: there is deliberately no app-mode WRITE proxy. An approval must be authored by the owner's
// github_id for the SOW-005 gate to honor it; a fork-scoped token cannot post to the upstream and the
// installation token would author as GBTI's app (which the gate must never trust as a universal approver), so in
// app mode the owner approves on github.com. Classic mode posts the review directly with the member's
// account-wide token.

const authorOf = (pr) => ({ login: pr?.user?.login ?? null, id: pr?.user?.id != null ? String(pr.user.id) : null });

/** GET /membership/open-pulls -> { ok, items }: ALL open PRs on the canonical repo (public), newest first. */
export async function listOpenPullsForReview(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls?state=open&sort=created&direction=desc&per_page=100`, { headers: GH_HEADERS(instToken) });
  if (!res || !res.ok) return { status: 502, body: { error: 'list_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => []);
  const items = (Array.isArray(list) ? list : []).map((pr) => ({
    number: pr.number, title: pr.title, html_url: pr.html_url, author: authorOf(pr),
    headSha: pr.head?.sha ?? null, createdAt: pr.created_at ?? null, updatedAt: pr.updated_at ?? null,
  }));
  return { status: 200, body: { ok: true, items } };
}

/** GET /membership/pr?number=N -> the PR ({ number, title, body, html_url, state, headSha, author }). */
export async function reviewPrDetail(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const number = Number(new URL(request.url).searchParams.get('number'));
  if (!Number.isInteger(number) || number <= 0) return { status: 400, body: { error: 'bad_request', message: 'a positive PR number is required' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls/${number}`, { headers: GH_HEADERS(instToken) });
  if (res && res.status === 404) return { status: 404, body: { error: 'not_found', message: 'no such pull request' } };
  if (!res || !res.ok) return { status: 502, body: { error: 'pr_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const pr = await res.json().catch(() => ({}));
  return { status: 200, body: { ok: true, number: pr.number, title: pr.title, body: pr.body ?? '', html_url: pr.html_url, state: pr.state, headSha: pr.head?.sha ?? null, author: authorOf(pr) } };
}

/** GET /membership/pr-files?number=N[&patch=1] -> { ok, files }: a PR's changed files (with patch when asked). */
export async function reviewPrFiles(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const url = new URL(request.url);
  const number = Number(url.searchParams.get('number'));
  if (!Number.isInteger(number) || number <= 0) return { status: 400, body: { error: 'bad_request', message: 'a positive PR number is required' } };
  const wantPatch = url.searchParams.get('patch') === '1';
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/pulls/${number}/files?per_page=100`, { headers: GH_HEADERS(instToken) });
  if (res && res.status === 404) return { status: 404, body: { error: 'not_found', message: 'no such pull request' } };
  if (!res || !res.ok) return { status: 502, body: { error: 'files_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const list = await res.json().catch(() => []);
  const files = (Array.isArray(list) ? list : []).map((f) => ({
    filename: f.filename, status: f.status, additions: f.additions ?? 0, deletions: f.deletions ?? 0,
    ...(wantPatch ? { patch: f.patch ?? null } : {}),
  }));
  return { status: 200, body: { ok: true, files } };
}

/** GET /membership/file?path=P&ref=R -> { ok, text }: a content file at a ref (the PR head), for preview-as-merged.
 *  Restricted to clean members/** paths so it can never be a general repo-file oracle (even though the repo is
 *  public). Returns text:null for a missing file. */
export async function reviewFileContent(request, env, deps = {}) {
  const { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network' } = deps;
  const who = await authMemberLogin(request, { fetchImpl, fetchUser });
  if (!who.ok) return { status: who.status, body: who.body };
  const url = new URL(request.url);
  const path = String(url.searchParams.get('path') || '');
  const ref = String(url.searchParams.get('ref') || '');
  const clean = path.length > 0 && !path.startsWith('/') && !path.includes('\\') && !path.includes('\0') &&
    path.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
  if (!clean || !path.startsWith('members/')) return { status: 400, body: { error: 'bad_request', message: 'path must be a clean members/ content path' } };
  if (!ref) return { status: 400, body: { error: 'bad_request', message: 'a ref is required' } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const res = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=${encodeURIComponent(ref)}`, { headers: GH_HEADERS(instToken) });
  if (res && res.status === 404) return { status: 200, body: { ok: true, text: null } };
  if (!res || !res.ok) return { status: 502, body: { error: 'file_failed', message: `GitHub returned ${res ? res.status : 'no response'}` } };
  const data = await res.json().catch(() => ({}));
  if (Array.isArray(data) || !data?.content) return { status: 200, body: { ok: true, text: null } };
  let text = null;
  try {
    const bin = atob(String(data.content).replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    text = new TextDecoder().decode(bytes);
  } catch { text = null; }
  return { status: 200, body: { ok: true, text } };
}
