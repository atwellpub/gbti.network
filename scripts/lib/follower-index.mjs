// SOW-186 phase 3 (REWORKED 2026-08-22): BUILD/heal the REVERSE follower index (followers:<github_id>) in
// reconcile from the forward follow graph (follows:<github_id>). The reverse index is DERIVED state and
// reconcile is its SOLE owner and healer: the follow hot path (workers/signup/membership-follows.mjs) writes
// ONLY the forward store, and this recompute converges the reverse index on every run, so additions, unfollows,
// renames and erasures all self-heal (it is a FULL recompute with stale-key deletion, not an incremental add).
//
// Keyed by the FOLLOWED member's IMMUTABLE github_id, because the phase-4 per-event email fan-out looks it up by
// the publishing author's github_id, and a delivery key must be immutable so a rename cannot orphan it (the
// sow-186 KEY DECISION). Resolving each stored followed-USERNAME to a github_id needs the members-index reconcile
// already maintains (github_id -> username; this inverts it). An unresolvable username (a non-directory member,
// one not yet enrolled, or one mid-rename) is SKIPPED fail-safe: the reverse edge is simply not built this run,
// and the miss self-heals once members-index carries the mapping. It NEVER guesses.
//
// This is a KV -> KV sync (private follower github_ids stay in the deletable edge store per the storage boundary;
// unlike the favorite/upvote counts, nothing reaches git). It mirrors scripts/lib/favorite-counts.mjs for the
// Cloudflare KV REST access (CF creds -> a real sync; no creds -> a reported no-op, never a throw), and the pure
// projection is unit-tested with plain objects (no network, no secrets).

import { normalizeFollows } from '../../membership/member-follows.mjs';
import { normalizeUsername } from '../../membership/member-follows.mjs';
import { FOLLOWERS_KEY, normalizeFollowers, normalizeGithubId, MAX_FOLLOWERS } from '../../membership/member-followers.mjs';

/**
 * Pure: project the forward follow graph into the reverse index. Takes:
 *   - forwardEntries: [{ githubId, follows }] -- the follower's github_id + their raw follows:<id> store value.
 *   - membersIndex: a github_id -> username map (object or Map), the reconcile-maintained members-index.
 * Returns { index, unresolved }, where index is { "<followedGithubId>": { followers: [{githubId, addedAt}],
 * updatedAt } } (each value already in the canonical normalizeFollowers shape), and unresolved counts the
 * followed-username edges skipped because no github_id resolved for them (logged by the caller). A follower's
 * own github_id is never recorded as following itself.
 */
export function buildReverseIndex(forwardEntries, membersIndex, { now = Date.now } = {}) {
  // Invert members-index (github_id -> username) into username(lowercased) -> github_id. Usernames in the forward
  // store are already normalized (lowercased) by normalizeFollows; normalize here too so the join is exact.
  const inverse = new Map();
  const pairs = membersIndex instanceof Map ? membersIndex.entries() : Object.entries(membersIndex || {});
  for (const [gid, uname] of pairs) {
    const id = normalizeGithubId(gid); // becomes the followers:<github_id> KEY, so reject a newline-suffixed id
    if (id == null || typeof uname !== 'string') continue;
    const u = normalizeUsername(uname);
    if (u) inverse.set(u, id);
  }

  // followedGithubId -> Map(followerGithubId -> addedAt). A Map dedupes followers and preserves the earliest
  // addedAt seen (a follower appears once per followed target).
  const reverse = new Map();
  let unresolved = 0;
  for (const entry of Array.isArray(forwardEntries) ? forwardEntries : []) {
    const followerId = normalizeGithubId(entry?.githubId);
    if (followerId == null) continue;
    for (const rec of normalizeFollows(entry?.follows).following) {
      const followedId = inverse.get(rec.username);
      if (!followedId) { unresolved++; continue; } // fail-safe skip: no github_id for this followed username
      if (followedId === followerId) continue; // never record a self-follow edge
      if (!reverse.has(followedId)) reverse.set(followedId, new Map());
      const set = reverse.get(followedId);
      if (!set.has(followerId)) set.set(followerId, Number(rec.addedAt) || 0);
    }
  }

  const t = now();
  const index = {};
  for (const [followedId, set] of reverse) {
    const followers = [...set.entries()].slice(0, MAX_FOLLOWERS).map(([githubId, addedAt]) => ({ githubId, addedAt }));
    // normalizeFollowers gives the canonical, capped, deduped shape the Worker + erasure read back.
    index[followedId] = normalizeFollowers({ followers, updatedAt: t });
  }
  return { index, unresolved };
}

/** Compare two follower stores by their github_id SETS only (ignoring addedAt + updatedAt), so a stable index
 *  is a no-op write rather than churn on every reconcile run. */
export function sameFollowerSet(a, b) {
  const sa = new Set(normalizeFollowers(a).followers.map((f) => f.githubId));
  const sb = new Set(normalizeFollowers(b).followers.map((f) => f.githubId));
  if (sa.size !== sb.size) return false;
  for (const id of sa) if (!sb.has(id)) return false;
  return true;
}

// ---- Cloudflare KV REST access (mirrors scripts/lib/favorite-counts.mjs + erase-member.mjs) ----

function cfBase(env) {
  const accountId = env.CF_ACCOUNT_ID, namespaceId = env.CF_KV_NAMESPACE_ID, apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return null;
  return {
    apiBase: `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`,
    headers: { Authorization: `Bearer ${apiToken}` },
  };
}

/** List a prefix and read every value (cursor-paginated). Returns { available, reason, entries:[{key,value}] };
 *  a key that vanished mid-list or holds non-JSON is skipped so it never crashes the sync. */
export async function listPrefixFromKv({ env = process.env, fetchImpl = globalThis.fetch, prefix } = {}) {
  const cf = cfBase(env);
  if (!cf) return { available: false, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set', entries: [] };
  const keys = [];
  let cursor = '';
  for (let page = 0; page < 100000; page++) {
    const url = `${cf.apiBase}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers: cf.headers });
    if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
    const json = await res.json();
    for (const k of json?.result ?? []) if (k?.name) keys.push(k.name);
    cursor = json?.result_info?.cursor || '';
    if (!cursor) break;
  }
  const entries = [];
  for (const key of keys) {
    const res = await fetchImpl(`${cf.apiBase}/values/${encodeURIComponent(key)}`, { headers: cf.headers });
    if (!res || !res.ok) continue;
    let value = null;
    try { value = await res.json(); } catch { value = null; }
    if (value && typeof value === 'object') entries.push({ key, value });
  }
  return { available: true, entries };
}

/** Read the forward follow graph (follows:*) as [{ githubId, follows }] (githubId from the key suffix). */
export async function listAllFollowsFromKv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const listed = await listPrefixFromKv({ env, fetchImpl, prefix: 'follows:' });
  if (!listed.available) return { available: false, reason: listed.reason, entries: [] };
  return { available: true, entries: listed.entries.map((e) => ({ githubId: e.key.slice('follows:'.length), follows: e.value })) };
}

/** Read the existing reverse index (followers:*) as [{ key, value }] for the diff. */
export async function listAllFollowersFromKv({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  return listPrefixFromKv({ env, fetchImpl, prefix: 'followers:' });
}

/** PUT one reverse-index value. Missing creds = a reported no-op. */
export async function putFollowersValue({ env = process.env, fetchImpl = globalThis.fetch, key, value } = {}) {
  const cf = cfBase(env);
  if (!cf) return { written: false, reason: 'CF creds not set' };
  const res = await fetchImpl(`${cf.apiBase}/values/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: cf.headers, body: typeof value === 'string' ? value : JSON.stringify(value),
  });
  if (!res || !res.ok) throw new Error(`KV put failed: ${res ? res.status : 'no response'}`);
  return { written: true, key };
}

/** DELETE one stale reverse-index key. Missing creds = a reported no-op. */
export async function deleteFollowersKey({ env = process.env, fetchImpl = globalThis.fetch, key } = {}) {
  const cf = cfBase(env);
  if (!cf) return { deleted: false, reason: 'CF creds not set' };
  const res = await fetchImpl(`${cf.apiBase}/values/${encodeURIComponent(key)}`, { method: 'DELETE', headers: cf.headers });
  if (!res || !res.ok) throw new Error(`KV delete failed: ${res ? res.status : 'no response'}`);
  return { deleted: true, key };
}

/**
 * Reconverge followers:<github_id> from follows:<github_id>. Reads the whole forward graph, projects it with
 * buildReverseIndex, then reconciles against the existing followers:* keys: writes only the targets whose
 * follower SET changed (no churn), and DELETES any followers:* key not in the recomputed map (heals unfollows,
 * erasures, renames, and the retired username-keyed entries from b103f609). Idempotent. Returns a status object;
 * throws only on a real KV error so the reconcile run can go red.
 */
export async function syncFollowerIndex({
  env = process.env,
  fetchImpl = globalThis.fetch,
  membersIndex = {},
  now = Date.now,
  listForward = listAllFollowsFromKv,
  listReverse = listAllFollowersFromKv,
  writeReverse = putFollowersValue,
  deleteReverse = deleteFollowersKey,
} = {}) {
  const fwd = await listForward({ env, fetchImpl });
  if (!fwd.available) return { synced: false, reason: fwd.reason };

  const { index, unresolved } = buildReverseIndex(fwd.entries, membersIndex, { now });
  const desired = new Map(); // key -> store value
  for (const [followedId, store] of Object.entries(index)) desired.set(FOLLOWERS_KEY(followedId), store);

  const rev = await listReverse({ env, fetchImpl });
  const existing = new Map((rev.available ? rev.entries : []).map((e) => [e.key, e.value]));

  let written = 0, unchanged = 0, deleted = 0;
  for (const [key, store] of desired) {
    if (existing.has(key) && sameFollowerSet(existing.get(key), store)) { unchanged++; continue; }
    await writeReverse({ env, fetchImpl, key, value: JSON.stringify(store) });
    written++;
  }
  for (const key of existing.keys()) {
    if (!desired.has(key)) { await deleteReverse({ env, fetchImpl, key }); deleted++; }
  }
  return { synced: true, followedTargets: desired.size, written, unchanged, deleted, unresolved };
}
