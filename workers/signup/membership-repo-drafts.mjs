// sow-194: GET /membership/repo-drafts. Serve the owner-scoped repo-draft listing from the CI-built KV index
// (repo-drafts:index, written by scripts/index-repo-drafts.mjs), NEVER from a public build artifact. A member
// sees ONLY their own folder's status:draft items; a re-verified superadmin sees every folder + house. The
// canonical repo is PUBLIC, so a draft is world-readable on GitHub regardless -- this route only makes it
// VISIBLE in the WorkBench, scoped server-side. The UI states it is not private review. Fail closed on identity,
// a missing/stale overrides mirror, or a ban.

import { resolveIdentity } from './identity.mjs';
import { OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from './membership-content.mjs';
import { bansFromParsed, rolesFromParsed, roleOf, isBanned } from '../../membership/overrides-core.mjs';

// MUST equal scripts/lib/repo-drafts-index.mjs REPO_DRAFTS_KV_KEY (a test asserts they do not drift).
export const REPO_DRAFTS_KV_KEY = 'repo-drafts:index';

const deny = (status, message) => ({ status, body: { ok: false, error: status === 401 ? 'unauthorized' : 'forbidden', message } });

/**
 * List the caller's repo drafts. Returns { status, body:{ ok, items, generatedAt } }. Items are
 * { type, slug, path, owner, title, visibility, status:'draft', store:'repo' }. Scope: own folder for a member,
 * every folder for a superadmin. Pure over injected deps (fetch, kv, fetchUser, verifyCookie), unit-tested.
 */
export async function listRepoDrafts(request, env, { fetchImpl = globalThis.fetch, fetchUser, verifyCookie, now = new Date(), kv = env?.SIGNUP_KV } = {}) {
  // 1. Identity: a valid member bearer OR the website session cookie. GET -> no CSRF (resolveIdentity SAFE_METHODS).
  const id = await resolveIdentity(request, env, { fetchImpl, fetchUser, ...(verifyCookie ? { verifyCookie } : {}), now, allowCookie: true });
  if (!id.ok) return { status: id.status, body: id.body };
  const login = String(id.login || '').toLowerCase();
  const githubId = id.githubId != null ? String(id.githubId) : null;
  if (!login) return deny(401, 'the token has no user login');

  // 2. The overrides-mirror gate, fail closed (same posture as resolveEffective / resolveCaller): a banned caller
  //    is denied; the superadmin role widens the scope. A missing/stale/incomplete mirror denies (never opens the
  //    all-folder scope on an unverifiable role).
  let mirror = null;
  try { mirror = await kv?.get(OVERRIDES_KV_KEY, 'json'); } catch { mirror = null; }
  if (!mirror || !mirror.generatedAt) return deny(403, 'member overrides are unavailable right now');
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return deny(403, 'member overrides are stale right now');
  const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!isSection(mirror.roles) || !isSection(mirror.bans)) return deny(403, 'member overrides are incomplete right now');
  if (githubId && isBanned(githubId, bansFromParsed(mirror.bans))) return deny(403, 'this account is not permitted');
  const isSuperadmin = githubId ? roleOf(githubId, rolesFromParsed(mirror.roles)) === 'superadmin' : false;

  // 3. Read the CI-built draft index (one KV read). Missing / not-yet-built -> empty list, not an error.
  let index = null;
  try { index = await kv?.get(REPO_DRAFTS_KV_KEY, 'json'); } catch { index = null; }
  const all = Array.isArray(index?.items) ? index.items : [];

  // 4. Scope, FAIL CLOSED: a superadmin sees every draft; everyone else only rows whose IMMUTABLE githubId equals
  //    the caller's github_id. Keying on the id (not the mutable login / the folder name) is what the rest of the
  //    codebase does: a rename or username reuse cannot map a caller onto a departed member's folder, and a
  //    member whose login happens to be 'house' cannot collide with house content (house rows carry githubId
  //    null, which matches no caller). A member not yet in members-index.yml has null-id rows -> sees nothing
  //    until reconcile indexes them (safe direction).
  const scoped = isSuperadmin
    ? all
    : all.filter((it) => it && it.githubId != null && githubId != null && String(it.githubId) === githubId);
  const items = scoped
    .filter((it) => it && typeof it.path === 'string' && typeof it.slug === 'string')
    .map((it) => ({
      type: it.type,
      slug: it.slug,
      path: it.path,
      owner: it.owner,
      title: typeof it.title === 'string' && it.title ? it.title : it.slug,
      visibility: it.visibility === 'members' ? 'members' : 'public',
      status: 'draft',
      store: 'repo',
    }));
  return { status: 200, body: { ok: true, items, generatedAt: index?.generatedAt ?? null } };
}
