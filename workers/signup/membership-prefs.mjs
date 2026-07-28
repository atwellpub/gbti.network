// SOW-046 (B/E): the member-prefs endpoint (category interests + followed news channels) over the deletable edge
// store (KV).
//   GET  /membership/prefs                          -> { ok, prefs: { categories, followedChannels } }
//   POST /membership/prefs { categories }           -> replace category interests
//   POST /membership/prefs { followChannel:{id,on} } -> follow/unfollow a news source id
//
// SOW-060: prefs (category interests + followed news channels) personalize the FREE-tier news feed; the gate is
// SIGNED-IN, non-banned (NOT effective-paid). SOW-078: prefs records NO usage analytics (unlike news/follows, which
// keep the Stripe-derived tier for per-tier insights), and its decision is identity + the ban mirror only, so it uses
// the Stripe-FREE authorizeMemberCheap: same fail-closed contract (401 no/bad token, 403 missing/stale/incomplete
// mirror, 403 banned) with no live Stripe round-trip on a hot, every-new-tab path. Keyed `prefs:<github_id>` in
// SIGNUP_KV: per-member, private, ERASABLE (eraseMemberPrefs = a hard KV delete; SOW-024 right-to-erasure runbook).
// The transforms are the pure membership/member-prefs.mjs core; this handler only does auth + the KV RMW.

import { authorizeMemberCheap } from './membership-content.mjs';
import { PrefsError, normalizePrefs, applyPrefs } from '../../membership/member-prefs.mjs';

export const PREFS_KEY = (githubId) => `prefs:${githubId}`;

export async function handlePrefs(request, env, { kv = env?.SIGNUP_KV, authorize = authorizeMemberCheap, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the prefs store is not configured' } };

  // Pass kv so the (default) Stripe-free authorizer reads the overrides mirror from the SAME namespace as the prefs store.
  const auth = await authorize(request, env, { ...authDeps, kv, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const key = PREFS_KEY(auth.githubId);

  if (request.method === 'GET') {
    const stored = await kv.get(key, 'json');
    return { status: 200, body: { ok: true, prefs: normalizePrefs(stored) } };
  }
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let patch;
  try { patch = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  let next;
  try { next = applyPrefs(await kv.get(key, 'json'), patch); }
  catch (err) {
    if (err instanceof PrefsError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }
  await kv.put(key, JSON.stringify(next));
  return { status: 200, body: { ok: true, prefs: next } };
}

/** SOW-024 right-to-erasure: hard-delete a member's prefs (category interests + followed channels). */
export async function eraseMemberPrefs(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv || githubId == null) return { ok: false };
  await kv.delete(PREFS_KEY(String(githubId)));
  return { ok: true };
}
