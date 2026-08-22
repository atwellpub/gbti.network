// SOW-046 (B/E): the member-prefs model — category interests + FOLLOWED NEWS CHANNELS (news source ids) — for the
// deletable edge store (prefs:<github_id> in SIGNUP_KV). Pure + node-free, like member-follows.mjs: the Worker
// handler does the KV read-modify-write; these transforms validate / dedupe / cap. GDPR-erasable (a hard KV delete
// of the key; wired into sop-member-erasure.md alongside activity + follows).

import { normalizeNotify } from './notify-resolve.mjs';

export class PrefsError extends Error {}

const MAX_CATEGORIES = 200; // raised from 40 for the topic picker's Select all (the vocabulary is 85 topics today)
const MAX_CHANNELS = 300;
// A category label or a news source id (both config-defined in the news worker): a bounded token set so a stored
// pref can never smuggle anything unexpected into a query or the UI.
const TOKEN = /^[a-z0-9][a-z0-9 ._/+-]{0,60}$/i;

function cleanList(v, max) {
  const out = [];
  const seen = new Set();
  for (const x of Array.isArray(v) ? v : []) {
    if (typeof x !== 'string') continue; // stored prefs are JSON string arrays; drop anything non-string
    const s = x.trim();
    if (!s || !TOKEN.test(s)) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Normalize a stored prefs record to { categories, followedChannels, publicFavorites } (arrays deduped +
 *  capped; publicFavorites strictly boolean, default false = SOW-114 opt-in consent to appear in the public
 *  "Favorited by" aggregate). */
export function normalizePrefs(stored) {
  const p = stored && typeof stored === 'object' ? stored : {};
  const out = {
    categories: cleanList(p.categories, MAX_CATEGORIES),
    followedChannels: cleanList(p.followedChannels, MAX_CHANNELS),
    publicFavorites: p.publicFavorites === true,
  };
  // SOW-186: the member's GLOBAL notification defaults, the (content-type x channel) matrix that applies to
  // any followed member without a per-follow override. Only present when set, so a member who never touched it
  // keeps the record's prior shape and resolveNotify falls through to SYSTEM_NOTIFY_DEFAULT (email OFF).
  const notify = normalizeNotify(p.notify);
  if (notify) out.notify = notify;
  return out;
}

/**
 * Apply a prefs patch and return the new normalized prefs. Patch shapes:
 *  - { categories: string[] }                 replace the category interests
 *  - { followChannel: { id, on } }            follow (on!==false) / unfollow a news source id
 *  - { publicFavorites: boolean }             SOW-114: opt in/out of the public "Favorited by" list
 *  - { notify: { [type]: { api?, email? } } } SOW-186: set the global notification defaults matrix
 *                                             (null or {} clears it, falling back to the system default)
 * Throws PrefsError on an invalid patch. Idempotent (re-following a channel is a no-op).
 */
export function applyPrefs(stored, patch = {}) {
  const next = normalizePrefs(stored);
  if (patch.categories !== undefined) {
    if (!Array.isArray(patch.categories)) throw new PrefsError('categories must be an array');
    next.categories = cleanList(patch.categories, MAX_CATEGORIES);
  }
  if (patch.notify !== undefined) {
    if (patch.notify !== null && (typeof patch.notify !== 'object' || Array.isArray(patch.notify))) {
      throw new PrefsError('notify must be an object');
    }
    const n = normalizeNotify(patch.notify);
    if (n) next.notify = n; else delete next.notify;
  }
  if (patch.publicFavorites !== undefined) {
    if (typeof patch.publicFavorites !== 'boolean') throw new PrefsError('publicFavorites must be a boolean');
    next.publicFavorites = patch.publicFavorites;
  }
  if (patch.followChannel) {
    const id = String(patch.followChannel.id ?? '').trim();
    if (!id || !TOKEN.test(id)) throw new PrefsError('a valid channel id is required');
    const on = patch.followChannel.on !== false;
    const lc = id.toLowerCase();
    const has = next.followedChannels.some((c) => c.toLowerCase() === lc);
    if (on && !has) {
      if (next.followedChannels.length >= MAX_CHANNELS) throw new PrefsError('too many followed channels');
      next.followedChannels.push(id);
    } else if (!on && has) {
      next.followedChannels = next.followedChannels.filter((c) => c.toLowerCase() !== lc);
    }
  }
  return next;
}
