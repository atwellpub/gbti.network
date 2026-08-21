// SOW-166: the weekly-digest send engine, drained on the shared `*/5` cron tick alongside the syndication drain
// (index.mjs composes both). The deliberate twin of workers/signup/syndication-drain.mjs: claim-before-send,
// a per-recipient sent marker, and an attempts cap, all over the pure core membership/mail-queue.mjs. What the
// mail drain adds over syndication:
//   - a HARD, FAIL-CLOSED rate budget (sends-today + sends-this-month), so a lost counter read sends NOTHING
//     this tick rather than freely (the free-tier caps are the whole reason the send is smoothed);
//   - a SEND-TIME suppression gate: an unsubscribe that lands mid-window (between the weekly compile and this
//     recipient's tick) is honored before the email goes out, because the marker is checked on every record;
//   - address resolution deferred to send time (a member from Stripe, an anon by decrypting emailEnc), so the
//     queue never stores a raw address (data-protection.md:49).
//
// PURE over injected kv/now/resolveAddress/renderIssue/sendEmail, so the whole engine is unit-tested with fakes
// (no network, no Resend, no Stripe). The Worker wiring supplies the real resolver, renderer and Resend send.

import {
  planDrain, markClaimed, releaseClaim, markSent, markFailed, markSuppressed, canRetry,
  budgetRemaining, DEFAULT_MAX_ATTEMPTS,
} from '../../membership/mail-queue.mjs';
import { suppressKey } from '../../membership/mail-suppress.mjs';
import { canReceive } from '../../membership/mail-subscriber.mjs';
import {
  getIssue, getSend, putSend, readPendingIndex, removeFromPending, getSubscriber,
  readBudget, bumpBudget, activeIssueIds,
} from './mail-store.mjs';

// A claim older than this is from a tick that died before terminalizing the record; reclaim it so one crash
// cannot strand a recipient forever. Three `*/5` ticks.
const CLAIM_STALE_MS = 15 * 60 * 1000;

/** UTC day (YYYY-MM-DD) and month (YYYY-MM) strings from a ms timestamp. The Worker wiring MAY pass operator-
 *  timezone strings instead (so the daily window rolls at Central midnight); the counter only needs the compile
 *  and the drain to agree, and UTC is the safe default. Kept out of the pure core (it reads the calendar). */
export function budgetDateStrings(ms) {
  const d = new Date(Number(ms));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return { dayStr: `${y}-${m}-${day}`, monthStr: `${y}-${m}` };
}

// A returned value from sendEmail is a success unless it explicitly reports { ok: false }; a THROW is a failure.
// This accepts both the resend client (which returns the parsed { id } and throws on error) and an { ok } fake.
const sendSucceeded = (res) => res == null || res.ok !== false;

/**
 * The LAUNCH SEND GATE, fail-closed by default. QAMaster's requirement: with a population-scale backfill sitting
 * next to a live send path, care is not a control, so the cap lives IN the send path, not in a runbook step.
 *   - DEFAULT (neither var set) is CLOSED: the drain sends to NOBODY. Forgetting to configure the gate fails safe,
 *     and a test that does not open it proves that by sending zero.
 *   - MAIL_SEND_ALLOWLIST: a comma/space-separated list of recipient hashes. ONLY those hashes send; every other
 *     recipient is REFUSED (left pending, never claimed, so it burns no attempt or budget slot) until the gate
 *     opens for it. This is the launch/test posture: a real send to a bounded, named set.
 *   - MAIL_SEND_UNRESTRICTED === 'true': full send. A deliberate, explicit post-launch flip, never a default.
 * Returns { mode, allows(hash) }.
 */
export function resolveSendGate(env = {}) {
  if (String(env?.MAIL_SEND_UNRESTRICTED ?? '').trim() === 'true') return { mode: 'unrestricted', allows: () => true };
  const raw = String(env?.MAIL_SEND_ALLOWLIST ?? '').trim();
  if (raw) {
    const set = new Set(raw.split(/[\s,]+/).filter(Boolean));
    return { mode: 'allowlist', size: set.size, allows: (h) => set.has(String(h)) };
  }
  return { mode: 'closed', allows: () => false };
}

/**
 * Drain ONE issue for at most `cap` sends this tick, inside the fail-closed rate budget and behind the
 * fail-closed launch send gate. Returns { issueId, sent, failed, suppressed, dropped, refused, backlog,
 * gate, reason }, where `refused` counts recipients the send gate did not permit (left pending, no attempt).
 */
export async function drainMailIssue(env, {
  kv = env?.SIGNUP_KV,
  issueId,
  now = Date.now,
  cap = 10,
  dailyCap = null,
  monthlyCap = null,
  dayStr = null,
  monthStr = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  resolveAddress,
  renderIssue,
  sendEmail,
  from = env?.MAIL_FROM || env?.RESEND_FROM || null,
} = {}) {
  const zero = { issueId, sent: 0, failed: 0, suppressed: 0, dropped: 0, refused: 0, backlog: 0 };
  if (!kv) return { ...zero, reason: 'no kv' };
  if (!issueId) return { ...zero, reason: 'no issue id' };
  if (typeof resolveAddress !== 'function' || typeof renderIssue !== 'function' || typeof sendEmail !== 'function') {
    return { ...zero, reason: 'send deps not wired' };
  }
  if (!from) return { ...zero, reason: 'no from address' };

  const issue = await getIssue(kv, issueId);
  if (!issue) return { ...zero, reason: 'issue not found' };

  const pending = await readPendingIndex(kv, issueId);
  if (!pending.length) return { ...zero, reason: 'drained', backlog: 0 };

  // LAUNCH SEND GATE (fail-closed), resolved once per issue. A globally-CLOSED gate is the default: it sends
  // nothing this tick and leaves the entire backlog pending (nothing is claimed, so no attempt is burned). A
  // launch allowlist restricts sends to named recipient hashes; unrestricted is the deliberate full-send flip.
  const sendGate = resolveSendGate(env);
  if (sendGate.mode === 'closed') return { ...zero, reason: 'send gate closed', backlog: pending.length };

  // The tick allowance: the tighter of the per-tick cap and the remaining rate budget. FAIL-CLOSED: an
  // unreadable counter makes budgetRemaining 0, so nothing sends this tick.
  const { dayStr: d0, monthStr: m0 } = budgetDateStrings(Number(now()));
  const day = dayStr || d0;
  const month = monthStr || m0;
  const budget = await readBudget(kv, day, month);
  const allowance = Math.min(Number(cap) || 0, budgetRemaining(budget, { dailyCap, monthlyCap }));
  if (allowance <= 0) return { ...zero, reason: 'budget', backlog: pending.length };

  // Read only a front window of the fairness-ordered index (never the whole prefix): enough to fill `allowance`
  // even when some records are claimed/holding/lingering. A crashed-tick 'claimed' record does not permanently
  // block a slot because it is reclaimed once stale.
  const windowSize = Math.min(pending.length, Math.max(allowance * 3, allowance + 20));
  const windowHashes = pending.slice(0, windowSize);

  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let dropped = 0; // a hash in the index whose record is gone: pruned from the index, not a failure
  let refused = 0; // a hash the launch send gate does not permit yet: left PENDING, no attempt burned
  let budgetLeft = allowance;
  const nowMs = () => Number(now());

  for (const hash of windowHashes) {
    if (budgetLeft <= 0) break;

    let rec = await getSend(kv, issueId, hash);
    if (!rec) { await removeFromPending(kv, issueId, hash); dropped++; continue; } // record expired/deleted

    // Terminal record lingering in the index (a lost removal): prune it, do not send.
    if (rec.status === 'sent' || rec.status === 'failed' || rec.status === 'suppressed') {
      await removeFromPending(kv, issueId, hash);
      continue;
    }

    // Is this record actionable now? Pending+due, or a stale claim from a crashed tick. A fresh claim (another
    // tick owns it) and a holding record (send window not open) are skipped this tick.
    const t = nowMs();
    const staleClaim = rec.status === 'claimed' && Number(rec.claimedAt || 0) < t - CLAIM_STALE_MS;
    const { due } = planDrain([rec], t);
    const actionable = due.length > 0 || staleClaim;
    if (!actionable) continue;

    // SEND-TIME SUPPRESSION GATE. Checked BEFORE claiming so an unsubscribe never even consumes an attempt or a
    // budget slot. The recipientHash IS the suppression hash (mailHash(secret,email)), so the marker is found by
    // key with no address and no secret needed here.
    let isSuppressed = false;
    try { isSuppressed = Boolean(await kv.get(suppressKey(hash))); } catch { isSuppressed = false; }
    if (isSuppressed) {
      await putSend(kv, markSuppressed(rec, { now }));
      await removeFromPending(kv, issueId, hash);
      suppressed++;
      continue;
    }

    // LAUNCH SEND GATE, per recipient. A hash the gate does not permit this phase is REFUSED: left PENDING,
    // NOT claimed, so it burns no attempt and consumes no budget slot, and it waits for the gate to open for it.
    // Placed AFTER the suppression gate so an unsubscribe is still honored for a not-yet-permitted recipient.
    if (!sendGate.allows(hash)) { refused++; continue; }

    // Claim (burns one attempt) and persist BEFORE any external work, so a cron overlap cannot double-send.
    const claimed = markClaimed(rec, { now });
    await putSend(kv, claimed);

    // Resolve the address at send time. A member resolves from Stripe, an anon by decrypting emailEnc; both are
    // the injected resolver's job. A THROW is transient (retry); a null return is permanent (no recipient).
    const subscriber = await getSubscriber(kv, hash);
    if (!subscriber || !canReceive(subscriber)) {
      await putSend(kv, markFailed(claimed, { now })); // no active subscriber record: terminal, not retried
      await removeFromPending(kv, issueId, hash);
      failed++;
      continue;
    }
    let address = null;
    try {
      address = await resolveAddress(subscriber);
    } catch {
      // Transient resolution error (Stripe/crypto): retry next tick until the attempt budget is spent.
      await retryOrFail(kv, claimed, maxAttempts, now, issueId, () => { failed++; });
      continue;
    }
    if (!address) {
      await putSend(kv, markFailed(claimed, { now })); // resolved but no address: terminal, not retried
      await removeFromPending(kv, issueId, hash);
      failed++;
      continue;
    }

    // Render from the FROZEN issue (same content for everyone; the renderer may personalize the unsubscribe
    // link off the recipientHash). A render throw is treated as retryable rather than dropping the recipient.
    let message;
    try {
      message = renderIssue(issue, { recipientHash: hash, subscriber, from });
    } catch {
      await retryOrFail(kv, claimed, maxAttempts, now, issueId, () => { failed++; });
      continue;
    }

    // Send. On success: the per-recipient sent marker terminalizes the record and it leaves the pending index.
    let res;
    let threw = false;
    try {
      res = await sendEmail({ from, to: address, subject: message.subject, html: message.html, text: message.text });
    } catch { threw = true; }

    if (!threw && sendSucceeded(res)) {
      await putSend(kv, markSent(claimed, { now }));
      await removeFromPending(kv, issueId, hash);
      sent++;
      budgetLeft--;
    } else {
      await retryOrFail(kv, claimed, maxAttempts, now, issueId, () => { failed++; });
    }
  }

  // Record the sends against the rate budget ONCE (after the fact). Under-counting on a rare cron overlap is
  // safe (it never over-sends, because the claim guard already bounds a tick); over-counting never happens.
  if (sent > 0) await bumpBudget(kv, day, month, sent);

  const backlog = (await readPendingIndex(kv, issueId)).length;
  return { issueId, sent, failed, suppressed, dropped, refused, backlog, allowance, gate: sendGate.mode };
}

/** A retryable failure: leave the record pending for the next tick if it still has attempts, else terminalize it
 *  as failed and drop it from the index. The claim already burned the attempt, so canRetry reflects the spend. */
async function retryOrFail(kv, claimed, maxAttempts, now, issueId, onTerminalFail) {
  if (canRetry(releaseClaim(claimed), maxAttempts)) {
    await putSend(kv, releaseClaim(claimed)); // back to pending; retried next tick
  } else {
    await putSend(kv, markFailed(claimed, { now }));
    await removeFromPending(kv, issueId, claimed.recipientHash);
    onTerminalFail();
  }
}

/**
 * Drain every active issue on this tick, sharing ONE per-tick cap and ONE rate budget. Usually there is a single
 * active issue. The per-tick cap is threaded across issues so two in-flight issues cannot together exceed it; the
 * daily/monthly budget is re-read per issue, so issue 2 already sees issue 1's sends.
 */
export async function drainMail(env, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  issueId = null,
  perTickCap = Number(env?.MAIL_MAX_PER_TICK ?? 10),
  dailyCap = numOrNull(env?.MAIL_DAILY_CAP),
  monthlyCap = numOrNull(env?.MAIL_MONTHLY_CAP),
  dayStr = null,
  monthStr = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  resolveAddress,
  renderIssue,
  sendEmail,
  from = env?.MAIL_FROM || env?.RESEND_FROM || null,
} = {}) {
  if (!kv) return { drained: 0, reason: 'no kv' };
  const ids = issueId ? [issueId] : await activeIssueIds(kv);
  if (!ids.length) return { drained: 0, reason: 'no active issue' };

  let tickCapLeft = Math.max(0, Number(perTickCap) || 0);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let refused = 0;
  const issues = [];
  for (const id of ids) {
    if (tickCapLeft <= 0) break;
    const r = await drainMailIssue(env, {
      kv, issueId: id, now, cap: tickCapLeft, dailyCap, monthlyCap, dayStr, monthStr, maxAttempts,
      resolveAddress, renderIssue, sendEmail, from,
    });
    tickCapLeft -= r.sent;
    sent += r.sent;
    failed += r.failed;
    suppressed += r.suppressed;
    refused += r.refused || 0;
    issues.push(r);
  }
  return { drained: sent, failed, suppressed, refused, issues };
}

function numOrNull(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
