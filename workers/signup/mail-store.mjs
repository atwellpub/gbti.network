// SOW-166: the KV persistence layer for the weekly digest send engine. Wraps the pure cores (mail-queue.mjs,
// mail-digest.mjs, mail-subscriber.mjs, mail-suppress.mjs) with read-modify-write against SIGNUP_KV. All state
// is KV-only runtime state, NEVER git. Keys (all in SIGNUP_KV, prefix-namespaced like synd:item: / activity:):
//   mail:issue:<issueId>                    one FROZEN compiled issue (the archive + the render source). No TTL:
//                                           the public per-issue archive (Q9) keeps it.
//   mail:send:<issueId>:<recipientHash>     one recipient's delivery state for one issue. A terminal record
//                                           (sent/failed/suppressed) self-prunes after ~30 days.
//   mail:pending:<issueId>                  { hashes: [...] } the fairness-ordered index of not-yet-terminal
//                                           recipients, so the drain lists a small front window instead of a
//                                           whole-prefix scan.
//   mail:subscriber:<hash>                  the subscriber record (mail-subscriber.mjs). Read here to resolve.
//   mail:budget:day:<dayStr>                the rolling sends-today counter (fail-closed hard ceiling).
//   mail:budget:month:<monthStr>            the rolling sends-this-month counter.
//
// Pure over an injected kv + now, so it is unit-tested with a fake KV (no network, no secrets).

import { issueKey } from '../../membership/mail-digest.mjs';
import {
  sendKey, buildMailSend, normalizeMailSend, rotateOrder, budgetDayKey, budgetMonthKey,
} from '../../membership/mail-queue.mjs';
import { subscriberKey } from '../../membership/mail-suppress.mjs';
import { normalizeSubscriber } from '../../membership/mail-subscriber.mjs';

export const MAIL_PENDING_KEY = (issueId) => `mail:pending:${issueId}`;

const SEND_TERMINAL_TTL_SECONDS = 30 * 24 * 60 * 60; // a sent/failed/suppressed record self-prunes after ~30 days
const DAY_COUNTER_TTL_SECONDS = 3 * 24 * 60 * 60; // a day counter is only read on its own day; prune after a few
const MONTH_COUNTER_TTL_SECONDS = 40 * 24 * 60 * 60; // a month counter spans the month; prune shortly after

// ---------- the frozen issue ----------

/** Read a frozen issue (the composeIssue projection), or null. It is already a public-safe projection, so it is
 *  returned as stored (no re-normalization); a missing/unreadable issue is null so the drain can skip it. */
export async function getIssue(kv, issueId) {
  if (!kv || !issueId) return null;
  try { return (await kv.get(issueKey(issueId), 'json')) || null; } catch { return null; }
}

/** Freeze one issue. No TTL: the per-issue public archive keeps it. */
export async function putIssue(kv, issue) {
  await kv.put(issueKey(issue.issueId), JSON.stringify(issue));
  return issue;
}

// ---------- per-recipient send records ----------

export async function getSend(kv, issueId, recipientHash) {
  if (!kv || !issueId || !recipientHash) return null;
  let raw = null;
  try { raw = await kv.get(sendKey(issueId, recipientHash), 'json'); } catch { raw = null; }
  return normalizeMailSend(raw);
}

/** Write a send record; a TERMINAL record (sent/failed/suppressed) gets a TTL so the store self-prunes, while a
 *  pending/claimed record persists with no TTL (it still has work to do). */
export async function putSend(kv, item) {
  const terminal = item.status === 'sent' || item.status === 'failed' || item.status === 'suppressed';
  const opts = terminal ? { expirationTtl: SEND_TERMINAL_TTL_SECONDS } : undefined;
  await kv.put(sendKey(item.issueId, item.recipientHash), JSON.stringify(item), opts);
  return item;
}

// ---------- the pending index ----------

export async function readPendingIndex(kv, issueId) {
  let raw = null;
  try { raw = await kv.get(MAIL_PENDING_KEY(issueId), 'json'); } catch { raw = null; }
  const hashes = raw && Array.isArray(raw.hashes) ? raw.hashes.filter((x) => typeof x === 'string' && x) : [];
  return [...new Set(hashes)];
}

async function writePendingIndex(kv, issueId, hashes) {
  await kv.put(MAIL_PENDING_KEY(issueId), JSON.stringify({ hashes: [...new Set(hashes)] }));
}

/** Remove one recipient from an issue's pending index once its record is terminal. Read-modify-write; a lost
 *  update is self-healing because the next tick re-reads the (still-terminal) record and re-removes it. */
export async function removeFromPending(kv, issueId, recipientHash) {
  const hashes = await readPendingIndex(kv, issueId);
  const next = hashes.filter((h) => h !== recipientHash);
  if (next.length !== hashes.length) await writePendingIndex(kv, issueId, next);
}

/** The issueIds that still have a non-empty pending index (usually one). The drain iterates these. Bounded by a
 *  page cap; a launch never has more than a handful of in-flight issues. */
export async function activeIssueIds(kv, { limit = 50 } = {}) {
  if (!kv?.list) return [];
  const out = [];
  let cursor;
  for (let page = 0; page < 100 && out.length < limit; page++) {
    const res = await kv.list({ prefix: 'mail:pending:', cursor });
    for (const k of res?.keys ?? []) {
      const issueId = k.name.slice('mail:pending:'.length);
      const hashes = await readPendingIndex(kv, issueId);
      if (hashes.length) out.push(issueId);
      if (out.length >= limit) break;
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return out;
}

/**
 * Enqueue one frozen issue for delivery: freeze the issue, then create one pending send record per recipient in
 * a per-issue fairness rotation (rotateOrder), and write the pending index. IDEMPOTENT: a recipient whose send
 * record already exists is left as-is (a re-run of the weekly compile does not double-enqueue or resurrect a
 * terminal record). `sendStartAt` is the send-window open time (records HOLD until then); default = now.
 *
 * NOTE ON SCALE: this writes one KV put per NEW recipient plus the index, in a single call. At the launch free
 * tier (a few hundred subscribers) that is well inside the Worker subrequest ceiling. A list large enough to
 * approach the ceiling needs a batched compile across ticks; the drain side is already incremental and unchanged.
 */
export async function enqueueIssue(kv, issue, recipientHashes, { now = Date.now, sendStartAt = null } = {}) {
  await putIssue(kv, issue);
  const ordered = rotateOrder(recipientHashes, issue.issueId); // canonical + rotated send order
  const pending = [];
  let enqueued = 0;
  for (let idx = 0; idx < ordered.length; idx++) {
    const recipientHash = ordered[idx];
    const existing = await getSend(kv, issue.issueId, recipientHash);
    if (existing) {
      // Idempotent re-run: keep a record that is still working; do not resurrect a terminal one into pending.
      if (existing.status === 'pending' || existing.status === 'claimed') pending.push(recipientHash);
      continue;
    }
    const rec = buildMailSend({ issueId: issue.issueId, recipientHash, order: idx }, { now, availableAt: sendStartAt });
    await putSend(kv, rec);
    pending.push(recipientHash);
    enqueued++;
  }
  await writePendingIndex(kv, issue.issueId, pending);
  return { issueId: issue.issueId, enqueued, pending: pending.length, total: ordered.length };
}

// ---------- subscriber resolution ----------

/** Read + normalize a subscriber record by its hash, or null. The drain uses this to resolve the address (a
 *  member from Stripe, an anon by decrypting emailEnc). */
export async function getSubscriber(kv, hash) {
  if (!kv || !hash) return null;
  let raw = null;
  try { raw = await kv.get(subscriberKey(hash), 'json'); } catch { raw = null; }
  return normalizeSubscriber(raw);
}

/**
 * Write a subscriber record (built via buildSubscriber / claimForMember). Normalizes FIRST, so a malformed record
 * never persists and a record with no resolvable address/identity is refused (returns null) rather than stored as a
 * dead row the drain would later skip. Keyed by the subscriber's own hash. Returns the stored record, or null.
 */
export async function putSubscriber(kv, record) {
  const rec = normalizeSubscriber(record);
  if (!kv || !rec || !rec.hash) return null;
  await kv.put(subscriberKey(rec.hash), JSON.stringify(rec));
  return rec;
}

/**
 * Delete a subscriber record by hash. This is the ERASURE channel: an anonymous subscriber who never signed in
 * cannot authenticate, so the one-click unsubscribe link is their only capability and it must also erase them. It
 * deliberately does NOT touch the suppression marker (mail:suppress:<hash>): the marker is a bare hash with no
 * address, and it must OUTLIVE the record so that a later re-add cannot silently un-suppress someone who opted out.
 * Idempotent: deleting an absent record is a success.
 */
export async function eraseSubscriber(kv, hash) {
  const key = subscriberKey(hash); // null when hash is blank; never hand a bad key to kv.delete
  if (!kv || !key) return false;
  try { await kv.delete(key); return true; } catch { return false; }
}

// ---------- the rate budget (fail-closed) ----------

/** Read one counter. Distinguishes ABSENT (a legitimate zero, e.g. the first send of the day) from an ERROR or
 *  a corrupt value (null, which the pure withinBudget/budgetRemaining treat as fail-closed). This distinction is
 *  load-bearing: reading an absent counter as null would freeze the very first tick of every day. */
async function readCounter(kv, key) {
  let v;
  try { v = await kv.get(key); } catch { return null; } // an error is fail-closed, never a free send
  if (v == null) return 0; // absent -> legitimately zero (the counter has not been created yet today/this month)
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null; // a corrupt counter is fail-closed
}

/** Read the day + month send counters ({ daily, monthly }); either may be null (fail-closed) on a read error. */
export async function readBudget(kv, dayStr, monthStr) {
  const daily = await readCounter(kv, budgetDayKey(dayStr));
  const monthly = await readCounter(kv, budgetMonthKey(monthStr));
  return { daily, monthly };
}

/** Increment both counters by n (after n sends actually left). Read-modify-write, TTL'd so counters self-prune.
 *  Single drain per tick means no concurrent writer under normal operation; a cron overlap is rare and only
 *  UNDER-counts (never over-sends) because the claim guard already bounds a tick's sends. */
export async function bumpBudget(kv, dayStr, monthStr, n) {
  if (!(n > 0)) return;
  const dayKey = budgetDayKey(dayStr);
  const monthKey = budgetMonthKey(monthStr);
  const day = (await readCounter(kv, dayKey)) || 0;
  const month = (await readCounter(kv, monthKey)) || 0;
  await kv.put(dayKey, String(day + n), { expirationTtl: DAY_COUNTER_TTL_SECONDS });
  await kv.put(monthKey, String(month + n), { expirationTtl: MONTH_COUNTER_TTL_SECONDS });
}
