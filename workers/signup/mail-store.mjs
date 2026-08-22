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

/** Read + normalize one per-recipient send record. THROWS on an unreadable key; returns null only for a genuine
 *  miss. The swallow this replaced conflated the two, so a transient read blip looked identical to a deleted
 *  record and the drain PRUNED a live recipient permanently (booked as `dropped`, an orphan send record left
 *  behind, indistinguishable from the case the suite certifies as correct). The drain now defers an unreadable
 *  read (fail-closed, retry) and prunes only a genuine null. Same three-state model as readCounter below. */
export async function getSend(kv, issueId, recipientHash) {
  if (!kv || !issueId || !recipientHash) return null;
  return normalizeMailSend(await kv.get(sendKey(issueId, recipientHash), 'json'));
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

/** Read an issue's fairness-ordered pending index (deduped). Empty for a genuinely empty or absent index; THROWS
 *  on an unreadable key. The swallow this replaced lived in this SHARED helper, so an unreadable index looked
 *  identical to a drained one at every caller at once: the drain's main window read reported "drained" and sent
 *  nothing with no signal, activeIssueIds silently dropped the issue, and removeFromPending silently skipped its
 *  write. Each caller now owns its disposition (drain: fail-closed with a reason; activeIssueIds: include it so the
 *  drain re-attempts; removeFromPending: an explicit, observable, self-healing no-op). */
export async function readPendingIndex(kv, issueId) {
  const raw = await kv.get(MAIL_PENDING_KEY(issueId), 'json');
  const hashes = raw && Array.isArray(raw.hashes) ? raw.hashes.filter((x) => typeof x === 'string' && x) : [];
  return [...new Set(hashes)];
}

async function writePendingIndex(kv, issueId, hashes) {
  await kv.put(MAIL_PENDING_KEY(issueId), JSON.stringify({ hashes: [...new Set(hashes)] }));
}

/** Remove one recipient from an issue's pending index once its record is terminal. Read-modify-write. An
 *  unreadable index is a self-healing no-op BY DESIGN: the next tick re-reads the still-terminal record and
 *  re-removes it, so this one caller catches the read here rather than let it abort a drain tick that has already
 *  sent. The self-heal is now EXPLICIT and OBSERVABLE (it was a silent swallow inside the shared read): the return
 *  says whether the removal applied and whether the index was unreadable, so a caller that needs completeness (the
 *  erasure path) can tell a real no-op from a skipped one instead of reading the success shape over an unread index. */
export async function removeFromPending(kv, issueId, recipientHash) {
  let hashes;
  try { hashes = await readPendingIndex(kv, issueId); }
  catch { return { removed: false, indexUnreadable: true }; }
  const next = hashes.filter((h) => h !== recipientHash);
  if (next.length === hashes.length) return { removed: false, indexUnreadable: false };
  await writePendingIndex(kv, issueId, next);
  return { removed: true, indexUnreadable: false };
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
      // readPendingIndex now THROWS on an unreadable index. INCLUDE such an issue so the drain re-attempts it and
      // fail-closes there (with a visible reason), never silently dropping an issue we simply could not inspect.
      let hashes;
      try { hashes = await readPendingIndex(kv, issueId); }
      catch { hashes = null; }
      if (hashes == null || hashes.length) out.push(issueId);
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
  let readErrors = 0;
  for (let idx = 0; idx < ordered.length; idx++) {
    const recipientHash = ordered[idx];
    let existing;
    try {
      existing = await getSend(kv, issue.issueId, recipientHash);
    } catch {
      // getSend now THROWS on an unreadable existing record (was a swallow-to-null that let a read blip look like a
      // fresh recipient and buildMailSend a SECOND record over a terminal one -> a re-send). We cannot tell pending
      // from terminal here, so fail-closed BOTH ways: do NOT create a new record (never resurrect a terminal one),
      // and KEEP the recipient in the index (never drop a live one; a genuinely terminal record is pruned by the
      // drain next tick). Count it so the caller can surface an incomplete enqueue. Stays non-throwing for
      // compileWeeklyIssue's "never throws" contract.
      readErrors++;
      pending.push(recipientHash);
      continue;
    }
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
  return { issueId: issue.issueId, enqueued, pending: pending.length, total: ordered.length, readErrors };
}

// ---------- subscriber resolution ----------

/** Read + normalize a subscriber record by its hash. THROWS on an unreadable key; returns null only for a genuine
 *  miss. The swallow this replaced collapsed the two into null: the drain's own comment one line above its call
 *  says a throw is transient and a null is permanent, yet the swallow handed it the permanent value on a transient
 *  fault, so a POST-claim read blip terminalized a claimed recipient as `failed` (a permanent drop, one attempt
 *  already burned). Callers now separate the states: the drain retries an unreadable read and terminalizes only a
 *  genuine null; mail-compile counts it as a read error; mail-subscribe treats it as "no existing record". Same
 *  three-state model as getSend above and readCounter below. */
export async function getSubscriber(kv, hash) {
  if (!kv || !hash) return null;
  return normalizeSubscriber(await kv.get(subscriberKey(hash), 'json'));
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

/**
 * The COMPLETE mail-side erasure for one subscriber hash: the counterpart to eraseSubscriber that also removes the
 * per-recipient SEND state. Deletes mail:subscriber:<hash>, deletes mail:send:<issueId>:<hash> across EVERY issue
 * (enumerated from mail:issue:, so a terminal send record in an already-drained issue is gone now rather than in up
 * to 30 days on its TTL), and removes the hash from each issue's pending index. Deliberately LEAVES the suppression
 * marker mail:suppress:<hash>: a bare hash with no address that must outlive erasure so a later re-add cannot
 * silently re-contact someone who opted out (the same minimized keyed-hash survival coupon-lock.mjs carries).
 *
 * Takes a HASH, not a github_id, and the ordering is load-bearing for the SCRIPT-SIDE member erasure. The mail
 * keyspace is derived from the EMAIL via mailHash, and a github_id cannot reach it. The erase-member script must
 * compute the hash from the Stripe customer's address and call this BEFORE it deletes the Stripe customer; run
 * afterward, the address (the only input that derives this key) is gone and the record is unreachable by any run.
 * Both callers share it: the erase-member script (a member) and the one-click unsubscribe route (an anon).
 * Idempotent + re-runnable; returns { subscriber, sends, issues, ok, errors }.
 *
 * OK IS THE CONTRACT (SecurityMaster, 2026-08-22). This is a GDPR erasure, so it must NEVER return the success
 * shape while personal data is still in KV. Every failure that could leave a record behind is CAPTURED, not
 * swallowed: the identity-record delete outcome (eraseSubscriber returns false only when kv.delete threw), a
 * list read that loses remaining pages, and a per-send read or delete failure. `ok` is false whenever anything
 * was captured; a caller (the erase-member report, a re-run) treats !ok as "not proven complete, retry". The send
 * DELETE is now UNCONDITIONAL (idempotent): a read blip counts an error but never leaves the send record behind.
 * The subscriber-COUNT read stays best-effort (a failed read under-reports, the safe direction, and the delete
 * after it is unconditional), so it is deliberately NOT an error.
 */
export async function eraseSubscriberMail(kv, hash) {
  const h = String(hash ?? '').trim();
  const subKey = subscriberKey(h);
  if (!kv || !subKey) return { subscriber: 0, sends: 0, issues: 0, ok: false, errors: ['bad hash'] };
  const errors = [];

  let subscriber = 0;
  try { if (await kv.get(subKey)) subscriber = 1; } catch { /* count is best-effort; the delete below is unconditional */ }
  // CAPTURE the identity-record delete outcome: false means kv.delete threw and the primary subscriber record of a
  // GDPR erasure is STILL in KV. Discarding this (the old code did) returned the success shape over a live record.
  if (!(await eraseSubscriber(kv, h))) errors.push('subscriber-delete');

  let sends = 0;
  let issues = 0;
  if (!kv.list) {
    errors.push('no-list-binding'); // cannot enumerate send state at all, so completeness cannot be claimed
  } else {
    let cursor;
    for (let page = 0; page < 100; page++) {
      let res;
      // A list read that throws loses every REMAINING page. Record it (erasure is incomplete) rather than break
      // into a success shape indistinguishable from a member who genuinely had no mail.
      try { res = await kv.list({ prefix: 'mail:issue:', cursor }); }
      catch { errors.push('issue-list'); break; }
      for (const k of res?.keys ?? []) {
        const issueId = k.name.slice('mail:issue:'.length);
        if (!issueId) continue;
        issues++;
        const sk = sendKey(issueId, h);
        // Count presence best-effort, but DELETE UNCONDITIONALLY (idempotent): a read blip must never leave a
        // personal send record behind. A read or delete throw is an erasure error, not a swallowed success.
        let existed = false;
        try { existed = Boolean(await kv.get(sk)); } catch { errors.push(`send-read:${issueId}`); }
        try { await kv.delete(sk); if (existed) sends++; } catch { errors.push(`send-delete:${issueId}`); }
        const rm = await removeFromPending(kv, issueId, h);
        if (rm.indexUnreadable) errors.push(`pending-index:${issueId}`);
      }
      if (res?.list_complete || !res?.cursor) break;
      cursor = res.cursor;
    }
  }
  return { subscriber, sends, issues, ok: errors.length === 0, errors };
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
 *  UNDER-counts (never over-sends) because the claim guard already bounds a tick's sends.
 *
 *  FAIL-CLOSED on an unreadable base. readCounter returns 0 for ABSENT (a legitimate first-of-the-day) and null
 *  for an ERROR or a corrupt value. The `|| 0` this replaced collapsed the two, so a transient read blip turned a
 *  base of, say, 89 into 0 and wrote `0 + n`: that does not under-count, it RESETS the ceiling downward, and the
 *  cap the owner's send gate depends on is then blown by roughly a full window before the counter catches up. On a
 *  null base we now SKIP that counter's write entirely (leaving the true value in place, at worst under-counting
 *  this one tick's n, the safe direction) and report it in `skipped` so the drain can surface it. */
export async function bumpBudget(kv, dayStr, monthStr, n) {
  if (!(n > 0)) return { skipped: [] };
  const dayKey = budgetDayKey(dayStr);
  const monthKey = budgetMonthKey(monthStr);
  const day = await readCounter(kv, dayKey);
  const month = await readCounter(kv, monthKey);
  const skipped = [];
  if (day === null) skipped.push('daily');
  else await kv.put(dayKey, String(day + n), { expirationTtl: DAY_COUNTER_TTL_SECONDS });
  if (month === null) skipped.push('monthly');
  else await kv.put(monthKey, String(month + n), { expirationTtl: MONTH_COUNTER_TTL_SECONDS });
  return { skipped };
}
