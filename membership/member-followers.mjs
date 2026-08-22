// SOW-186 phase 3: the REVERSE follower index -- "who follows member <username>". The forward store
// (membership/member-follows.mjs, follows:<github_id>) answers "who does this member follow"; it CANNOT answer
// "who follows this author" without scanning every member. The follow-publish delivery (SOW-186 phase 4) needs
// exactly that enumeration, once per issue, so this derived index makes it an O(1) lookup instead of an
// O(all-members) scan. It EARNS its place by making drain-time enumeration cheap, NOT by paying for eager
// fan-out at follow time.
//
// Keyed by the FOLLOWED member's USERNAME (followers:<username>), mirroring the forward store, which also keys
// the followed by username (a follow record stores { username }). Keeping both indexes on the same handle means
// follow-time writes need NO username->github_id resolution (pure, never lossy), and a rename is handled by the
// SAME reconcile mechanism that already fixes username references in the forward graph. The VALUES are follower
// github_ids (the erasable identities); the KEY is a public username (not sensitive).
//
// Pure, node-free: each function takes a plain store + a command and returns a NEW store. No IO, no Date.now()
// inside (callers inject now). The Worker glue (membership-follows.mjs) and the erasure sweep
// (scripts/lib/erase-member.mjs) wrap these with IO.

export const FOLLOWERS_KEY = (username) => `followers:${username}`;

// Bounds the KV value size defensively. A follower entry is a few dozen bytes, so this is megabytes of headroom
// and realistically never reached in a co-op; past it a new follower's forward follow still works (the feed
// shows the author) but they are not recorded here, so they would miss follow-publish notifications.
export const MAX_FOLLOWERS = 100000;

// A github_id is an immutable numeric identifier (Stripe metadata primary key). Enforcing the shape here keeps
// junk out of the index and matches the numeric-id validation the Stripe lookup already relies on.
const GITHUB_ID_RE = /^[0-9]+$/;

/** Thrown for a bad follower id on the WRITE path. A malformed STORED entry never throws: normalizeFollowers
 *  drops it, so a read can never crash. */
export class FollowersError extends Error {}

export function emptyFollowers() {
  return { followers: [], updatedAt: null };
}

/** Coerce any stored/incoming value into the canonical shape, dropping malformed + duplicate entries and
 *  enforcing the cap, so a hand-edited or partially-written KV value can never crash a read or a transform. */
export function normalizeFollowers(raw) {
  const out = emptyFollowers();
  if (!raw || typeof raw !== 'object') return out;
  if (Array.isArray(raw.followers)) {
    const seen = new Set();
    for (const f of raw.followers) {
      if (!f || typeof f !== 'object') continue;
      const githubId = f.githubId == null ? '' : String(f.githubId);
      if (!GITHUB_ID_RE.test(githubId) || seen.has(githubId)) continue;
      seen.add(githubId);
      out.followers.push({ githubId, addedAt: Number(f.addedAt) || 0 });
    }
  }
  if (out.followers.length > MAX_FOLLOWERS) out.followers = out.followers.slice(0, MAX_FOLLOWERS);
  out.updatedAt = Number(raw.updatedAt) || null;
  return out;
}

/** Add (on:true) or remove (on:false) a follower github_id. Idempotent: adding an existing / removing an absent
 *  id is a no-op that leaves updatedAt untouched, so the Worker glue can skip a redundant KV write. */
export function applyFollower(store, { githubId, on = true }, { now = Date.now } = {}) {
  const id = githubId == null ? '' : String(githubId);
  if (!GITHUB_ID_RE.test(id)) throw new FollowersError('a numeric github_id is required');
  const s = normalizeFollowers(store);
  const exists = s.followers.some((f) => f.githubId === id);
  if (on && !exists) {
    if (s.followers.length >= MAX_FOLLOWERS) throw new FollowersError('follower limit reached');
    s.followers.push({ githubId: id, addedAt: now() });
  } else if (!on && exists) {
    s.followers = s.followers.filter((f) => f.githubId !== id);
  } else {
    return s; // idempotent no-op: no updatedAt bump
  }
  s.updatedAt = now();
  return s;
}

/** The follower github_ids the follow-publish delivery enumerates. */
export function followerIds(store) {
  return normalizeFollowers(store).followers.map((f) => f.githubId);
}
