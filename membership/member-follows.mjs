// SOW-023: the member FOLLOW graph (subscriptions). Who a member follows is behavioral/relational personal
// data, so per SOW-024 it lives in the deletable edge store (Cloudflare KV), NOT the public git repo: the
// graph is private by default and a member's right to erasure is a hard delete, never immutable history.
//
// This is the PURE, node-free core (mirrors membership/member-activity.mjs): each function takes a plain
// follows object and a command and returns a NEW follows object. No IO, no Date.now() inside (callers inject
// `now`), so it is fully unit-tested. The Worker handler (workers/signup/membership-follows.mjs) does the KV
// read-modify-write and the effective-paid auth around these transforms.
//
// Shape (one KV value per follower, key `follows:<github_id>`):
//   { following: [{ username, addedAt }], updatedAt }
//
// We store the FOLLOWED member's username (the folder name), not their github_id, because the activity index
// and profiles are keyed by username; the feed resolves a follow against published works, so a follow whose
// username has no published profile simply yields nothing (fail-safe, no Worker-side member lookup needed).

import { normalizeNotify } from './notify-resolve.mjs';

export const MAX_FOLLOWING = 5000;
// GitHub-username shaped: 1-39 chars, alphanumeric or single internal hyphens. We lowercase first (member
// folder names are lowercase), so a stored value can never carry casing or path characters.
const USERNAME_RE = /^[a-z0-9](?:-?[a-z0-9])*$/;

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class FollowError extends Error {}

export function emptyFollows() {
  return { following: [], updatedAt: null };
}

/** Normalize an incoming username to the stored form, or return null if it is not a valid username. */
export function normalizeUsername(raw) {
  if (typeof raw !== 'string') return null;
  const u = raw.trim().toLowerCase();
  if (u.length < 1 || u.length > 39 || !USERNAME_RE.test(u)) return null;
  return u;
}

/** Defensive: coerce any stored/incoming value into the canonical shape, dropping malformed or duplicate
 *  entries, so a hand-edited or partially-written KV value can never crash a read or a transform. */
export function normalizeFollows(raw) {
  const f = emptyFollows();
  if (!raw || typeof raw !== 'object') return f;
  if (Array.isArray(raw.following)) {
    const seen = new Set();
    for (const e of raw.following) {
      const u = normalizeUsername(e && e.username);
      if (!u || seen.has(u)) continue;
      seen.add(u);
      const entry = { username: u, addedAt: Number(e.addedAt) || 0 };
      // SOW-186: an optional per-follow notification preference, the (content-type x channel) matrix scoped to
      // this followed member. normalizeNotify keeps only well-formed entries, so a malformed value is dropped
      // rather than crashing the transform or surviving in a shape resolveNotify cannot read.
      const notify = normalizeNotify(e.notify);
      if (notify) entry.notify = notify;
      f.following.push(entry);
    }
  }
  f.updatedAt = Number(raw.updatedAt) || null;
  return f;
}

/** Toggle following `username` on/off. Returns a NEW follows object. An optional `notify` payload sets the
 *  per-follow notification matrix in the same call, for the "the follow button opens the notification modal"
 *  flow (Q25): following someone and choosing what to receive is one action, not a later settings errand.
 *  On an already-followed member, a provided `notify` UPDATES the prefs (an absent/empty one clears them);
 *  omitting `notify` leaves them untouched, so a plain re-follow never wipes a member's chosen prefs. */
export function applyFollow(follows, { username, on = true, notify } = {}, { now = Date.now } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new FollowError('a valid username is required');
  const f = normalizeFollows(follows);
  const idx = f.following.findIndex((e) => e.username === u);
  if (on) {
    if (idx === -1) {
      if (f.following.length >= MAX_FOLLOWING) throw new FollowError('following limit reached');
      const entry = { username: u, addedAt: now() };
      const n = normalizeNotify(notify);
      if (n) entry.notify = n;
      f.following.push(entry);
    } else if (notify !== undefined) {
      const n = normalizeNotify(notify);
      const entry = { ...f.following[idx] };
      if (n) entry.notify = n; else delete entry.notify;
      f.following[idx] = entry;
    }
  } else if (idx !== -1) {
    f.following = f.following.filter((e) => e.username !== u);
  }
  f.updatedAt = now();
  return f;
}

/** Set the per-follow notification matrix for a member you ALREADY follow. Returns a NEW follows object.
 *  Throws if you are not following `username`: the modal is reached from a follow, so a missing follow is a
 *  real error, not a silent no-op that would drop the member's chosen prefs. A null/empty `notify` clears it
 *  (fall back to the global default). */
export function applyFollowNotify(follows, { username, notify } = {}, { now = Date.now } = {}) {
  const u = normalizeUsername(username);
  if (!u) throw new FollowError('a valid username is required');
  const f = normalizeFollows(follows);
  const idx = f.following.findIndex((e) => e.username === u);
  if (idx === -1) throw new FollowError('not following that member');
  const n = normalizeNotify(notify);
  const entry = { ...f.following[idx] };
  if (n) entry.notify = n; else delete entry.notify;
  f.following[idx] = entry;
  f.updatedAt = now();
  return f;
}

/** Just the followed usernames (for the feed filter). */
export function followingUsernames(follows) {
  return normalizeFollows(follows).following.map((e) => e.username);
}

/** The stored per-follow notify preference for one followed member, or undefined. This is the value passed as
 *  `follow` to resolveNotify when deciding whether a publish by that member reaches this follower. */
export function followNotify(follows, username) {
  const u = normalizeUsername(username);
  if (!u) return undefined;
  const e = normalizeFollows(follows).following.find((x) => x.username === u);
  return e ? e.notify : undefined;
}
