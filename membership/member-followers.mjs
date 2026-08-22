// SOW-186 phase 3 (REWORKED 2026-08-22): the REVERSE follower index -- "who follows member <github_id>". The
// forward store (membership/member-follows.mjs, follows:<github_id>) answers "who does this member follow"; it
// CANNOT answer "who follows this author" without scanning every member. The per-event-immediate follow-publish
// email (SOW-186 phase 4) needs exactly that enumeration, once per publish, so this derived index makes it an
// O(1) lookup instead of an O(all-members) scan. It EARNS its place by making delivery-time enumeration cheap,
// NOT by paying for eager fan-out at follow time.
//
// Keyed by the FOLLOWED member's IMMUTABLE github_id (followers:<github_id>), NEVER by their username.
// GENERAL PRINCIPLE (SOW-186 KEY DECISION): anything the DELIVERY path depends on is keyed by an immutable
// identifier (github_id), never by a mutable username. A username belongs in a value or a display field, never
// in a key a delivery step must look up. The earlier username-keyed version (b103f609) was rename-broken and
// unfixable by a rebuild, because the forward values are stale on a rename too; keying by github_id makes the
// index rename-PROOF. The VALUES are follower github_ids (the erasable identities); the KEY is the followed
// member's public numeric github_id.
//
// This index is DERIVED state, and reconcile is its SOLE owner and healer: it is BUILT/reconverged from the
// forward graph on every reconcile run (scripts/lib/follower-index.mjs), a full recompute with stale-key
// deletion, so additions, unfollows, renames and erasures all self-heal. The follow hot path writes ONLY the
// forward store (membership-follows.mjs no longer mirrors here at follow time). RESIDUAL: rename-proof is not
// rename-harmless -- reconcile resolves each stored followed-username to a github_id and skips the one member
// who just renamed until members-index is repaired, so a renamed author misses email fan-out in the meantime
// (the in-app bell reads the forward graph directly, so it is never stale). See sow-186 and Q30.
//
// Pure, node-free: each function takes a plain store + a command and returns a NEW store. No IO, no Date.now()
// inside (callers inject now). The reconcile builder (scripts/lib/follower-index.mjs) and the erasure sweep
// (scripts/lib/erase-member.mjs) wrap these with IO.

export const FOLLOWERS_KEY = (githubId) => `followers:${githubId}`;

// Bounds the KV value size defensively. A follower entry is a few dozen bytes, so this is megabytes of headroom
// and realistically never reached in a co-op; past it a new follower's forward follow still works (the feed
// shows the author) but they are not recorded here, so they would miss follow-publish notifications.
export const MAX_FOLLOWERS = 100000;

// A github_id is an immutable numeric identifier (Stripe metadata primary key). This validator matches the
// house numeric-id standard (clients/stripe.mjs numericGithubId): a char-by-char digit scan with an explicit
// length bound. Two reasons it earns its place over a bare regex here: (1) this id becomes the reverse-index
// KEY (followers:<github_id>), so an absurdly long or non-numeric value must never reach a key, and the length
// bound caps it; (2) a char scan rejects ANY non-digit (whitespace, punctuation, a stray control character)
// rather than only the shapes a regex author remembered. Fail-closed: a bad value returns null / throws / is
// dropped. (Note: /^[0-9]+$/ WITHOUT the `m` flag already rejects a trailing newline in JS -- `$` matches only
// the true end of string there, not before a line break -- so the newline is not the reason; the length bound
// and the shared house shape are.)
export function normalizeGithubId(v) {
  if (v == null) return null;
  const s = String(v);
  if (s.length < 1 || s.length > 20) return null; // bounded: current GitHub ids are ~9-10 digits, 20 is generous
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c < 48 || c > 57) return null; }
  return s;
}

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
      const githubId = normalizeGithubId(f.githubId);
      if (githubId == null || seen.has(githubId)) continue;
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
  const id = normalizeGithubId(githubId);
  if (id == null) throw new FollowersError('a numeric github_id is required');
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
