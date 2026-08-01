// sow-161: POST /membership/admin/author — server-side admin mutations.
//   Increment 1 (moderator+): content moderation — deplatform (status -> draft), republish (-> published), remove.
//   Increment 2 (admin+):     member status — ban / unban / grandfather / ungrandfather (house/bans.yml,
//                             house/grandfathered.yml), via the pure superadmin-actions cores.
//   Increment 3 (superadmin): role assignment — role (house/roles.yml, the ROOT OF TRUST, Tier S).
//   Increment 4 (admin+):     config managers — quote-add/remove/toggle (house/quotes.yml; leading comment
//                             preserved). More managers extend the CONFIG_OP table. Read: membershipAdminQuotePool.
//
// The cookie session has no GitHub token, so the Worker applies the change and opens the PR with GBTI's
// INSTALLATION token; the SOW-005 gate is the only merger. Two properties keep this safe:
//   1. The mutation is computed SERVER-SIDE. The caller names an ACTION + a target PATH, never file content, so a
//      moderator can only flip status or remove, never rewrite another member's words.
//   2. The PR is committed to `hosted-admin/<callerGithubId>/<action-slug>` with the github_id ALWAYS taken from
//      the verified session/token (never the body). The gate resolves that id -> its git-native role and re-checks
//      it against the touched path (decide()), so even a bug here cannot merge beyond the caller's real role.
//
// CSRF: the cookie path enforces the double-submit token inside resolveIdentity (a POST is a non-safe method); the
// bearer path (extension) needs none. Everything is injectable (fetchImpl, authorize, kv, limiter) for unit tests.

import { authorizeStaff, authorizeAdmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { flipContentStatus } from '../../client/src/content-ops.mjs'; // already in the Worker bundle (membership-shares)
import { isCleanPath } from '../../membership/classify-pr.mjs';
import { adminHostedBranchFor } from '../../membership/hosted-author.mjs';
import { ban, unban, grandfather, revokeGrandfather, grantRole } from '../../membership/superadmin-actions.mjs'; // sow-161 increments 2-3
import { addQuote, removeQuote, setQuoteEnabled } from '../../membership/quote-edits.mjs'; // sow-161 increment 4
import yaml from 'js-yaml'; // already in the Worker bundle (content-ops)

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

// Increment 1: content moderation (moderator+). remove is a delete; the others flip status.
const CONTENT_ACTIONS = new Set(['deplatform', 'republish', 'remove']);
const STATUS_FOR = { deplatform: 'draft', republish: 'published' };
// A content item index.md under a member OR house content folder (posts/products/prompts). The gate re-checks the
// caller's authority over this path; this regex only bounds the shape (a clean content item, never a config file).
const CONTENT_ITEM_RE = /^(?:members\/[a-z0-9][a-z0-9-]*|house)\/(?:posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;

// Increments 2-3: governance mutations. Each action targets a FIXED governance file (never derived from input) and
// applies a pure, node-free core from superadmin-actions.mjs. github_id-keyed. Per-action REQUIRED rank: member
// status is ADMIN+ (Tier A: house/bans.yml, house/grandfathered.yml); ROLE ASSIGNMENT is SUPERADMIN+ (Tier S:
// house/roles.yml, the ROOT OF TRUST). The gate independently re-checks the branch id's role vs the touched Tier,
// so an under-privileged caller cannot mutate even if the endpoint rank check erred (two-authority model).
const GITHUB_ID_RE = /^\d{1,20}$/;
const VALID_ROLES = new Set(['member', 'moderator', 'admin', 'superadmin']);
const GOV_ACTIONS = new Set(['ban', 'unban', 'grandfather', 'ungrandfather', 'role']);
const GOV_OP = {
  ban: { path: 'house/bans.yml', rank: ROLE_RANK.admin, fn: ban, args: (t) => ({ githubId: t.targetId, reason: t.reason }) },
  unban: { path: 'house/bans.yml', rank: ROLE_RANK.admin, fn: unban, args: (t) => ({ githubId: t.targetId }) },
  grandfather: { path: 'house/grandfathered.yml', rank: ROLE_RANK.admin, fn: grandfather, args: (t) => ({ githubId: t.targetId, reason: t.reason }) },
  ungrandfather: { path: 'house/grandfathered.yml', rank: ROLE_RANK.admin, fn: revokeGrandfather, args: (t) => ({ githubId: t.targetId }) },
  role: { path: 'house/roles.yml', rank: ROLE_RANK.superadmin, fn: grantRole, args: (t) => ({ githubId: t.targetId, role: t.role }) },
};
// Increment 4: config-manager mutations. Same fixed-path + pure-core + fail-closed-parse + hosted-admin-branch +
// gate-recheck pattern as the governance actions, with TWO differences: the target is a text/string key (not a
// github_id), and the config file carries a LEADING COMMENT that must be PRESERVED across the edit (governance
// files have none). Sub-slice 1: quotes (house/quotes.yml, admin-tier). More managers extend this table.
const CONFIG_ACTIONS = new Set(['quote-add', 'quote-remove', 'quote-toggle']);
const CONFIG_OP = {
  'quote-add': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: addQuote, args: (p) => ({ text: p.text, author: p.author }) },
  'quote-remove': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: removeQuote, args: (p) => ({ text: p.text }) },
  'quote-toggle': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: setQuoteEnabled, args: (p) => ({ text: p.text, enabled: p.enabled }) },
};
// The minimum role rank an action requires at the endpoint (the gate is the independent backstop).
const requiredRank = (action) =>
  GOV_ACTIONS.has(action) ? GOV_OP[action].rank : CONFIG_ACTIONS.has(action) ? CONFIG_OP[action].rank : ROLE_RANK.moderator;

// Preserve the leading comment block (a run of `#`/blank lines at the top) of a config file across a re-serialize,
// mirroring client/src/admin-ops.mjs leadingComment. Governance files have none, so this is config-only.
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}
// A bounded, git-safe branch slug from a free-text config key (a quote's text). Lowercase alnum + hyphen, capped.
function textSlug(text) {
  const s = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return s || 'item';
}

// Read + parse a house YAML file from canonical main, FAIL CLOSED. Shared by the governance + config branches so
// they cannot disagree about "malformed = 502, not a silent reset". Returns { ok:true, parsed, raw } (raw kept for
// the config leading-comment preserve), or { ok:false, status, body }. A 404 is a legitimate empty fresh start.
async function loadHouseYaml(fetchImpl, instToken, upstream, path) {
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { ok: true, parsed: {}, raw: '' };
  if (!cur.ok) return { ok: false, status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  const raw = decodeContent((await cur.json().catch(() => ({})))?.content) ?? '';
  let loaded;
  try { loaded = raw ? yaml.load(raw) : {}; }
  catch { return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } }; }
  if (loaded === undefined || loaded === null) return { ok: true, parsed: {}, raw };
  if (typeof loaded !== 'object' || Array.isArray(loaded)) return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } };
  return { ok: true, parsed: loaded, raw };
}

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
  const isContent = CONTENT_ACTIONS.has(action);
  const isGov = GOV_ACTIONS.has(action);
  const isConfig = CONFIG_ACTIONS.has(action);
  if (!isContent && !isGov && !isConfig) return { status: 400, body: { error: 'bad_request', message: 'unsupported admin action' } };

  // Per-action tier: content moderation is moderator+ (the endpoint floor), member status + config are admin+, role
  // assignment is superadmin+. Reject an under-privileged caller BEFORE any read/write. The SOW-005 gate re-checks
  // the branch id's role vs the touched Tier, so this is the endpoint half of the two-authority model.
  if ((ROLE_RANK[staff.role] ?? 0) < requiredRank(action)) {
    return { status: 403, body: { error: 'forbidden', message: 'a higher role is required for this action' } };
  }

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // Compute the file change + the branch slug SERVER-SIDE, per action category.
  let file, branchSlug;
  if (isContent) {
    const path = String(payload?.path || '');
    if (!isCleanPath(path) || !CONTENT_ITEM_RE.test(path)) {
      return { status: 400, body: { error: 'bad_request', message: 'a clean content item path is required' } };
    }
    const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
    if (cur.status === 404) return { status: 404, body: { error: 'not_found', message: 'no such content item on the network' } };
    if (!cur.ok) return { status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
    const curData = await cur.json().catch(() => ({}));
    if (action === 'remove') {
      file = { path, content: null };
    } else {
      const text = decodeContent(curData?.content);
      if (text == null) return { status: 502, body: { error: 'read_failed', message: 'could not read the content item' } };
      const flip = flipContentStatus(text, STATUS_FOR[action]);
      if (!flip.changed) return { status: 200, body: { ok: true, noop: true, message: `already ${STATUS_FOR[action]}` } };
      file = { path, content: flip.content };
    }
    branchSlug = actionSlug(action, path);
  } else if (isGov) {
    // Governance (member status + role assignment): the target is a github_id, NEVER a path. The governance file is
    // a FIXED constant per action (no path injection). Read it (fail-closed), apply the pure core, re-serialize; an
    // already-satisfied action is a clean no-op (no PR). Governance files carry no leading comment.
    const targetId = String(payload?.githubId || '');
    if (!GITHUB_ID_RE.test(targetId)) return { status: 400, body: { error: 'bad_request', message: 'a numeric github_id is required' } };
    const reason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 500) : undefined;
    // Role assignment (Tier S) carries a role value; reject anything outside the fixed set before touching roles.yml.
    let roleVal;
    if (action === 'role') {
      roleVal = String(payload?.role || '');
      if (!VALID_ROLES.has(roleVal)) return { status: 400, body: { error: 'bad_request', message: 'an invalid role was requested' } };
    }
    const op = GOV_OP[action];
    const load = await loadHouseYaml(fetchImpl, instToken, upstream, op.path);
    if (!load.ok) return { status: load.status, body: load.body };
    let result;
    try { result = op.fn(load.parsed, op.args({ targetId, reason, role: roleVal }), { actor: { githubId }, now: Date.now() }); }
    catch (e) { return { status: 400, body: { error: 'bad_request', message: e?.message || 'invalid action' } }; }
    if (!result.changed) return { status: 200, body: { ok: true, noop: true, message: `no change (${action})` } };
    file = { path: op.path, content: yaml.dump(result.next, { lineWidth: 100, noRefs: true }) };
    branchSlug = `${action}-${targetId}`;
  } else {
    // Config manager (increment 4): the key is a text string, the file is a FIXED constant per action, and its
    // LEADING COMMENT is preserved across the edit. Read fail-closed, apply the pure core, re-serialize with the
    // comment; an already-satisfied action is a clean no-op.
    const op = CONFIG_OP[action];
    const text = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!text || text.length > 2000) return { status: 400, body: { error: 'bad_request', message: 'a quote text is required' } };
    const author = typeof payload?.author === 'string' ? payload.author.slice(0, 200) : undefined;
    const enabled = payload?.enabled === undefined ? undefined : Boolean(payload.enabled);
    const load = await loadHouseYaml(fetchImpl, instToken, upstream, op.path);
    if (!load.ok) return { status: load.status, body: load.body };
    let result;
    try { result = op.fn(load.parsed, op.args({ text, author, enabled }), { actor: { githubId }, now: Date.now() }); }
    catch (e) { return { status: 400, body: { error: 'bad_request', message: e?.message || 'invalid action' } }; }
    if (!result.changed) return { status: 200, body: { ok: true, noop: true, message: `no change (${action})` } };
    file = { path: op.path, content: leadingComment(load.raw) + yaml.dump(result.next, { lineWidth: 100, noRefs: true }) };
    branchSlug = `${action}-${textSlug(text)}`;
  }

  const branch = adminHostedBranchFor(githubId, branchSlug);
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

  const title = `Admin: ${action} ${branchSlug.slice(action.length + 1)}`.slice(0, 256);
  const body = `Admin action (${action}) by github_id ${githubId} via the GBTI admin surface (sow-161).`;
  const pr = await fetchImpl(`${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  const prData = await pr.json().catch(() => ({}));
  if (pr.status === 422) return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true } };
  if (!pr.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${pr.status}` } };
  return { status: 200, body: { ok: true, branch, number: prData.number, html_url: prData.html_url } };
}

// sow-161 increment 4: the quote-manager pool READ. Admin-gated (cookie or bearer); returns the FULL pool from
// house/quotes.yml (incl. disabled quotes, which the public splash JSON omits) so the manager can toggle them.
// Read-only + fail-closed; a GET carries no CSRF.
export async function membershipAdminQuotePool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/quotes.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  const quotes = Array.isArray(load.parsed?.quotes) ? load.parsed.quotes : [];
  return { status: 200, body: { ok: true, quotes } };
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
