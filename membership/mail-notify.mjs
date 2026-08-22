// SOW-186 phase 4 (DELIVERY): the PURE core of follow-the-author email fan-out. No IO, no Date.now, no network,
// so the whole decision is unit-tested with plain objects. The runner (scripts/enqueue-notifications.mjs) wraps
// these with KV REST reads (the reverse follower index, each follower's follows + prefs, the subscriber scan) and
// the eager enqueue.
//
// WHY FAN-OUT AT PUBLISH, NOT IN THE DRAIN (the design that retires SowMaster's no-hoist tension by construction,
// 2026-08-22): the notification is resolved and ENQUEUED here, at publish time, into a NORMAL eager mail issue
// (mail:issue: + mail:pending: + mail:send:, via workers/signup/mail-store.mjs enqueueIssue). The existing */5
// drain then drains it byte-for-byte the same as a weekly digest, because the drain reads only issueId from the
// issue and never a kind-specific field. So the leak guard, the fail-closed send gate, the rate budget, the
// per-recipient suppression re-check, and the one-click unsubscribe are all shared with the digest not by a
// hoisted helper but because BOTH kinds flow through the one unchanged drain. Nothing on the lazy/eager fork of
// the drain is touched.
//
// LEAK GUARD (SOW-186 B3): a notification carries ONLY public metadata (author, display name, type, title, and a
// PUBLIC url). The runner gates on publicUrlFor (null for a members-only / Mode A item and for a share), so a
// gated item is never even enqueued; buildNotificationIssue below carries no body/blurb field at all, and the
// renderer reads a fixed allow-list. Three independent layers, none of which reads a body.
//
// EMAIL FAILS CLOSED: selectEmailRecipients resolves each follower through resolveNotify, whose email channel is
// OFF unless the member explicitly turned it on (membership/notify-resolve.mjs SYSTEM_NOTIFY_DEFAULT). Until the
// settings surface ships and a member opts in AND has a mailable subscriber record AND the owner opens the send
// gate AND the MAIL_* secrets are provisioned, this fan-out resolves to zero recipients and the drain sends
// nothing. That is the intended dormant state, not a bug.

import { resolveNotify } from './notify-resolve.mjs';

// The syndication content type -> the notify EVENT KEY resolveNotify reads. A post's reader-facing kind is
// 'article' (matching the feed and the global-defaults matrix, membership/notify-resolve.mjs NOTIFY_EVENTS); the
// others are 1:1. A share has no email notification in this cut (publicUrlFor returns null for a share, so the
// runner never reaches this map for one), so it is intentionally absent.
export const NOTIFY_EVENT_FOR_TYPE = Object.freeze({
  post: 'article',
  article: 'article',
  product: 'product',
  prompt: 'prompt',
});

/** The notify event key for a syndication item type, or null when the type has no email notification. */
export function eventForType(type) {
  return NOTIFY_EVENT_FOR_TYPE[String(type)] || null;
}

/**
 * The DETERMINISTIC issue id for one published item: `notify:<type>:<author>:<slug>`. Stable across Action
 * retries (it carries no timestamp), so re-running the publish job never double-notifies: enqueueIssue is
 * idempotent per (issueId, recipientHash) and keeps a terminal send record rather than resurrecting it. It also
 * means an item notifies its followers AT MOST ONCE, ever, which is the desired "author published X" behaviour
 * (a later re-publish of the same slug does not re-blast). generatedAt is a display-only field, never part of
 * the id, precisely so retries stay idempotent.
 */
export function notificationIssueId({ type, author, slug }) {
  return `notify:${String(type)}:${String(author)}:${String(slug)}`;
}

/**
 * Build a frozen notification issue from an item's PUBLIC metadata. Metadata only: there is deliberately no body,
 * blurb, or ciphertext field. `kind:'notification'` is what the Worker's renderIssue seam dispatches on.
 *
 * @param item { type, author, authorName?, title, url, slug, generatedAt? }
 */
export function buildNotificationIssue(item = {}) {
  const type = String(item.type || '');
  const author = String(item.author || '');
  const slug = String(item.slug || '');
  return {
    issueId: notificationIssueId({ type, author, slug }),
    kind: 'notification',
    author,
    authorName: item.authorName != null ? String(item.authorName) : null,
    type,
    event: eventForType(type),
    title: item.title != null ? String(item.title) : '',
    url: item.url != null ? String(item.url) : null,
    generatedAt: Number.isFinite(item.generatedAt) ? Number(item.generatedAt) : 0,
  };
}

/**
 * From an assembled list of per-follower context, the recipient HASHES whose email channel fires for this event.
 * Pure: the runner does the KV reads and hands each follower's own follow-override, global prefs, and mail hash.
 *
 * A follower is included IFF:
 *   - resolveNotify({ event, follow, global }).email === true (fail-closed OFF; the per-follow override wins over
 *     the global default wins over the system default), AND
 *   - they have a mailable subscriber hash, AND
 *   - they are not the author themselves (an author following their own folder never self-notifies).
 *
 * @param perFollower [{ githubId, mailHash, followNotify?, globalNotify? }]
 * @param opts        { event, authorId? } event is the notify event key; authorId excludes a self-follow
 * @returns string[] deduped recipient hashes (canonical order = input order; the eager enqueue rotates fairly)
 */
export function selectEmailRecipients(perFollower = [], { event = 'author-publish', authorId = null } = {}) {
  const out = [];
  const seen = new Set();
  const author = authorId == null ? null : String(authorId);
  for (const f of perFollower) {
    if (!f || typeof f !== 'object') continue;
    const githubId = f.githubId == null ? null : String(f.githubId);
    const hash = typeof f.mailHash === 'string' ? f.mailHash.trim() : '';
    if (!hash || seen.has(hash)) continue;
    if (author && githubId === author) continue; // no self-notification
    const decision = resolveNotify({ event, follow: f.followNotify, global: f.globalNotify });
    if (decision.email !== true) continue;
    seen.add(hash);
    out.push(hash);
  }
  return out;
}
