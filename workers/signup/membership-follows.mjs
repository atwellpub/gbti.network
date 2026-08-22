// SOW-023: the member FOLLOW endpoint (the subscription graph) over the deletable edge store (KV).
//   GET  /membership/follows               -> { ok, following: [{ username, addedAt }] }   (the caller's own list)
//   POST /membership/follows { username, on } -> { ok, following }   (on:true follow, on:false unfollow)
//
// SOW-060: following is a FREE-tier perk. Auth = SIGNED-IN, non-banned (authorizeMember: ban > staff > grandfather
// > Stripe, fail-closed from the KV overrides mirror), NOT effective-paid. Both READ and WRITE work for any signed-in
// member (the follow graph needs an identity but not a subscription). Data is keyed `follows:<github_id>` in
// SIGNUP_KV, so it is per-member, private, and ERASABLE (eraseMemberFollows = a hard KV delete; SOW-024 right-to-
// erasure runbook). The transforms are the pure membership/member-follows.mjs core; this handler only does auth +
// the KV read-modify-write, so it is unit-tested with a fake KV + a stubbed authorizer (no network, no secrets).

import { authorizeMember } from './membership-content.mjs';
import { recordAuthedUsage } from './analytics.mjs'; // SOW-061 P3: follow usage by tier
import { FollowError, normalizeFollows, applyFollow, normalizeUsername } from '../../membership/member-follows.mjs';
import { FOLLOWERS_KEY, normalizeFollowers, applyFollower } from '../../membership/member-followers.mjs'; // SOW-186 phase 3: reverse index

export const FOLLOWS_KEY = (githubId) => `follows:${githubId}`;

/** SOW-186 phase 3: keep the reverse follower index (followers:<followedUsername>) in step with a follow /
 *  unfollow, so the follow-publish delivery can enumerate an author's followers cheaply. BEST-EFFORT: the
 *  forward store (follows:<github_id>) is the source of truth and has ALREADY been written when this runs, so a
 *  reverse-index hiccup logs and returns rather than failing an otherwise-good follow. applyFollower is
 *  idempotent, so a later follow/unfollow of the same author self-corrects any drift, and reconcile can rebuild
 *  the index from the forward graph (a follow-up). */
async function maintainFollowerIndex(kv, { followedUsername, followerGithubId, on, now }) {
  try {
    const key = FOLLOWERS_KEY(followedUsername);
    const stored = normalizeFollowers(await kv.get(key, 'json'));
    const next = applyFollower(stored, { githubId: followerGithubId, on }, { now });
    await kv.put(key, JSON.stringify(next));
  } catch (err) {
    // Drift is observable and self-healing; never fail the follow for it.
    console.warn(JSON.stringify({ evt: 'follower-index-drift', on, error: err?.message || String(err) }));
  }
}

export async function handleFollows(request, env, { kv = env?.SIGNUP_KV, now = Date.now, authorize = authorizeMember, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the follow store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const key = FOLLOWS_KEY(auth.githubId);
  const method = request.method;

  if (method === 'GET') {
    const stored = await kv.get(key, 'json');
    return { status: 200, body: { ok: true, following: normalizeFollows(stored).following } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } };
  }

  const stored = normalizeFollows(await kv.get(key, 'json'));
  let next;
  try {
    next = applyFollow(stored, { username: payload?.username, on: payload?.on !== false }, { now });
  } catch (err) {
    if (err instanceof FollowError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }
  await kv.put(key, JSON.stringify(next));
  // SOW-186 phase 3: mirror into the reverse follower index for cheap drain-time enumeration. Keyed by the
  // FOLLOWED username (already validated by applyFollow above); the forward write is the source of truth, so
  // this is best-effort and never fails the request.
  const followedUsername = normalizeUsername(payload?.username);
  if (followedUsername) {
    await maintainFollowerIndex(kv, { followedUsername, followerGithubId: auth.githubId, on: payload?.on !== false, now });
  }
  recordAuthedUsage(env, auth, 'follow', request); // SOW-061 P3: a follow/unfollow write, recorded by effective tier
  return { status: 200, body: { ok: true, following: next.following } };
}

/** SOW-024 right-to-erasure: hard-delete a member's OUTBOUND follow list. Inbound follows (other members who
 *  follow this member) reference the username and self-heal, because the feed drops a followed username that
 *  has no published profile after erasure. */
export async function eraseMemberFollows(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the follow store is not configured' };
  const key = FOLLOWS_KEY(String(githubId));
  await kv.delete(key);
  return { ok: true, key };
}
