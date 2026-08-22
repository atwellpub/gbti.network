// SOW-186 phase 1 (the decision-independent leaf): the PURE notification-resolution helper. Given a member's
// global notification defaults and an optional per-follow override for one followed member, plus the event
// kind, it decides which channels fire for a single notification: { api, email }.
//
// This is the ONLY sow-186 piece built ahead of the owner's plan approval. It was built under the owner's
// 2026-08-21 instruction ("keep progressing, build whatever is decision-independent, do not sit idle waiting
// on the Q25 rulings", relayed by SowMaster) because it is decision-INVARIANT:
//   - Correct under BOTH fan-out models. Write-time fan-out and read-time derivation both call this same pure
//     function; it makes no assumption about WHEN it runs, so open question 1 (fan-out on write vs read)
//     does not change it.
//   - OQ4-safe. It is keyed by event kind, so generalising beyond author-follow to categories or replies
//     later needs no rewrite and no stored-shape migration.
//   - It persists NOTHING and delivers NOTHING, so it cannot mis-deliver.
//
// What is deliberately NOT built here, and is HELD for the owner's plan approval plus open question 4 (does
// this generalise beyond author-follow, which shapes the stored field): the per-follow `notify` field on
// `membership/member-follows.mjs`, the global-defaults field on `membership/member-prefs.mjs`, the
// notification store (sow-150's primitive, which this must consume rather than duplicate), the settings
// surface, and every delivery path. Those change LIVE store shapes and the feature's architecture; this
// leaf changes neither.
//
// Precedence per channel, highest wins:
//   per-follow override (for this event) -> global default (for this event) -> SYSTEM_NOTIFY_DEFAULT.
// Resolution is per channel, not per bag: a per-follow override that sets only `email` leaves `api` to fall
// through to the global default (and then the system default), so a partial override never silently blanks
// the channel it did not mention.

export const NOTIFY_CHANNELS = ['api', 'email'];

// Fail closed on the channel that spends money and carries CAN-SPAM weight. The in-app bell (`api`) is ON so
// that following is visibly useful, but EMAIL is OFF unless a member explicitly turns it on, so no existing
// member is ever opted into mail they did not ask for (Q25 item 4). A missing or unreadable preference
// therefore resolves to no email, never to email.
export const SYSTEM_NOTIFY_DEFAULT = Object.freeze({ api: true, email: false });

function isBool(v) {
  return v === true || v === false;
}

// The channel bag a preference contributes for one event. A preference may be a FLAT bag ({ api, email })
// that applies to every event, or an EVENT-KEYED map ({ 'author-publish': { ... }, default: { ... } }). An
// entry for the specific event wins, else an explicit `default` entry, else the object is read as a flat bag.
// Reading event scoping when it is present is what makes the same helper generalise beyond author-follow
// (OQ4) with no rewrite.
function bagFor(pref, event) {
  if (!pref || typeof pref !== 'object') return {};
  if (pref[event] && typeof pref[event] === 'object') return pref[event];
  if (pref.default && typeof pref.default === 'object') return pref.default;
  return pref;
}

/**
 * Resolve which channels fire for one notification, purely and fail-closed.
 *
 * @param {object} [input]
 * @param {string} [input.event='author-publish'] the notification event kind (keeps the helper general).
 * @param {object} [input.follow] the per-follow override for this (follower, followed) pair, or undefined.
 * @param {object} [input.global] the member's global notification defaults, or undefined.
 * @returns {{ api: boolean, email: boolean }} the channels that fire; email defaults OFF.
 */
export function resolveNotify({ event = 'author-publish', follow, global } = {}) {
  const f = bagFor(follow, event);
  const g = bagFor(global, event);
  const out = {};
  for (const channel of NOTIFY_CHANNELS) {
    out[channel] = isBool(f[channel])
      ? f[channel]
      : isBool(g[channel])
        ? g[channel]
        : SYSTEM_NOTIFY_DEFAULT[channel];
  }
  return out;
}
