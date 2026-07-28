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
import { FollowError, normalizeFollows, applyFollow } from '../../membership/member-follows.mjs';

export const FOLLOWS_KEY = (githubId) => `follows:${githubId}`;

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
