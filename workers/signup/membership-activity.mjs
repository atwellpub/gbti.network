// SOW-024: the member ACTIVITY endpoint (favorites + collections) over the deletable edge store (KV).
//   GET  /membership/activity                 -> { ok, activity }   (the caller's own favorites + collections)
//   POST /membership/activity { action, ... } -> { ok, activity }   (mutates the caller's own activity)
//     actions: favorite | collection.create | collection.rename | collection.delete | collection.item
//
// Auth = the GitHub bearer token resolved to the immutable github_id (any signed-in member; trial + paid can
// favorite and collect, consistent with SOW-013). Data is keyed `activity:<github_id>` in SIGNUP_KV, so it is
// per-member, private, and ERASABLE (eraseMemberActivity = a hard KV delete; SOW-024 right-to-erasure runbook).
//
// The store is NOT in the public git repo: it is behavioral/relational personal data, kept deletable per
// SOW-024. The transforms are the pure membership/member-activity.mjs core; this handler only does auth + the
// KV read-modify-write, so it is unit-tested with a fake KV + fake token verifier (no network, no secrets).

import { githubFetchUser } from './oauth.mjs';
import { authorizeMemberCheap } from './membership-content.mjs';
import {
  ActivityError, normalizeActivity,
  applyFavorite, createCollection, renameCollection, deleteCollection, setCollectionItem,
} from '../../membership/member-activity.mjs';

export const ACTIVITY_KEY = (githubId) => `activity:${githubId}`;

export async function handleActivity(request, env, {
  fetchImpl = globalThis.fetch,
  fetchUser = githubFetchUser,
  kv = env?.SIGNUP_KV,
  now = Date.now,
  genId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : String(now()) + Math.random().toString(36).slice(2)),
} = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the activity store is not configured' } };

  // SOW-077/078: a ban is ZERO KV. authorizeMemberCheap denies a banned account (and fails closed on a
  // missing/stale/incomplete overrides mirror) WITHOUT a Stripe call, matching the follows/prefs gate — closing
  // the gap where the old identity-only auth let a banned member keep writing favorites/collections. The activity
  // store and the overrides mirror share the SAME SIGNUP_KV namespace, so the mirror is read through `kv`.
  const a = await authorizeMemberCheap(request, env, { fetchImpl, fetchUser, kv, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!a.ok) return { status: a.status, body: a.body };
  const key = ACTIVITY_KEY(a.githubId);
  const method = request.method;

  if (method === 'GET') {
    const stored = await kv.get(key, 'json');
    return { status: 200, body: { ok: true, activity: normalizeActivity(stored) } };
  }

  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } };
  }

  const stored = normalizeActivity(await kv.get(key, 'json'));
  let next;
  const extra = {};
  try {
    switch (payload?.action) {
      case 'favorite':
        next = applyFavorite(stored, payload, { now });
        break;
      case 'collection.create': {
        const r = createCollection(stored, payload, { now, genId });
        next = r.activity;
        extra.id = r.id;
        break;
      }
      case 'collection.rename':
        next = renameCollection(stored, payload, { now });
        break;
      case 'collection.delete':
        next = deleteCollection(stored, payload, { now });
        break;
      case 'collection.item':
        next = setCollectionItem(stored, payload, { now });
        break;
      default:
        return { status: 400, body: { error: 'unknown_action', message: 'unknown activity action' } };
    }
  } catch (err) {
    if (err instanceof ActivityError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }

  await kv.put(key, JSON.stringify(next));
  return { status: 200, body: { ok: true, activity: next, ...extra } };
}

/** SOW-024 right-to-erasure: hard-delete a member's activity from the deletable store. */
export async function eraseMemberActivity(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the activity store is not configured' };
  const key = ACTIVITY_KEY(String(githubId));
  await kv.delete(key);
  return { ok: true, key };
}
