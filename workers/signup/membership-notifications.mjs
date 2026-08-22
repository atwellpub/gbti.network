// SOW-150 / SOW-186: the member NOTIFICATION endpoint over the deletable edge store (KV).
//   GET  /membership/notifications        -> { ok, notifications, unseen }   (the caller's OWN list)
//   POST /membership/notifications/seen   -> { ok, notifications, unseen }   (mark the caller's own seen)
//     body { ids?: [id] }  -- an absent/empty ids list marks ALL of the caller's notifications seen
//
// SOW-060: reading your own notifications is a FREE-tier perk. Auth = SIGNED-IN, non-banned (authorizeMember:
// ban > staff > grandfather > Stripe, fail-closed from the KV overrides mirror), NOT effective-paid. Data is
// keyed notifications:<github_id> in SIGNUP_KV, so it is per-member, private, and ERASABLE
// (eraseMemberNotifications = a hard KV delete; SOW-024 right-to-erasure runbook). The caller only ever
// reads/mutates THEIR OWN key (the authorized github_id), so there is no cross-member read or write here.
//
// The WRITE (append) path is deliverNotification below, called SERVER-SIDE by a trusted trigger (the SOW-150
// mention endpoint; the SOW-186 follow-publish delivery), NEVER by the recipient over HTTP. It is deliberately
// not an HTTP endpoint: a member cannot post arbitrary rows into their own bell or anyone else's.
//
// The transforms are the pure membership/member-notifications.mjs core; this handler only does auth + the KV
// read-modify-write, so it is unit-tested with a fake KV + a stubbed authorizer (no network, no secrets).

import { authorizeMember } from './membership-content.mjs';
import {
  normalizeNotifications, appendNotification, markSeen, unseenCount,
} from '../../membership/member-notifications.mjs';

export const NOTIFICATIONS_KEY = (githubId) => `notifications:${githubId}`;

const genIdDefault = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : String(Date.now()) + Math.random().toString(36).slice(2));

export async function handleNotifications(request, env, { kv = env?.SIGNUP_KV, now = Date.now, authorize = authorizeMember, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the notification store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const key = NOTIFICATIONS_KEY(auth.githubId);
  const method = request.method;

  if (method === 'GET') {
    const stored = normalizeNotifications(await kv.get(key, 'json'));
    return { status: 200, body: { ok: true, notifications: stored.items, unseen: unseenCount(stored) } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  // POST is the mark-seen action (routed only from /membership/notifications/seen). An absent or unparseable
  // body means "mark everything seen" -- marking your own notifications seen is idempotent and low-stakes, so an
  // empty-body request is the intended default rather than a 400.
  let payload;
  try { payload = await request.json(); } catch { payload = {}; }

  const stored = normalizeNotifications(await kv.get(key, 'json'));
  const next = markSeen(stored, { ids: Array.isArray(payload?.ids) ? payload.ids : undefined, now });
  await kv.put(key, JSON.stringify(next));
  return { status: 200, body: { ok: true, notifications: next.items, unseen: unseenCount(next) } };
}

/**
 * Append ONE notification to a RECIPIENT's store -- the shared server-side WRITE primitive. Called by a trusted
 * trigger only (SOW-150 mention; SOW-186 follow-publish delivery), never by the recipient. The write ALWAYS
 * targets the RECIPIENT's own key, never the actor's and never an arbitrary key.
 *
 * Fail-safe: a missing store or a blank recipient is a reported no-op (a delivery failure must never take down
 * the triggering publish/mention). A malformed record throws NotificationError -- the record is built once by
 * the trigger and is the same for every recipient of a follow-publish issue, so a bad record is surfaced to the
 * caller to fix, not silently swallowed per recipient.
 */
export async function deliverNotification(env, recipientGithubId, record, { kv = env?.SIGNUP_KV, now = Date.now, genId = genIdDefault } = {}) {
  if (!kv) return { ok: false, error: 'the notification store is not configured' };
  const id = String(recipientGithubId || '');
  if (!id) return { ok: false, error: 'a recipient github_id is required' };
  const key = NOTIFICATIONS_KEY(id);
  const stored = normalizeNotifications(await kv.get(key, 'json'));
  const next = appendNotification(stored, record, { now, genId });
  await kv.put(key, JSON.stringify(next));
  return { ok: true, unseen: unseenCount(next) };
}

/** SOW-024 right-to-erasure: hard-delete a member's notification store from the deletable edge store. */
export async function eraseMemberNotifications(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the notification store is not configured' };
  const key = NOTIFICATIONS_KEY(String(githubId));
  await kv.delete(key);
  return { ok: true, key };
}
