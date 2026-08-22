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
import { makeUnsubToken } from '../../membership/mail-unsub-token.mjs';
import { canReceive } from '../../membership/mail-subscriber.mjs';
import {
  getIssue, getSend, putSend, readPendingIndex, removeFromPending, getSubscriber,
  readBudget, bumpBudget, activeIssueIds,
} from './mail-store.mjs';

// A claim older than this is from a tick that died before terminalizing the record; reclaim it so one crash
// cannot strand a recipient forever. Three `*/5` ticks.
const CLAIM_STALE_MS = 15 * 60 * 1000;

// CODE-SIDE rate-cap FLOORS (owner ruling 2026-08-22, QAmaster finding). The wrangler MAIL_DAILY_CAP /
// MAIL_MONTHLY_CAP / MAIL_MAX_PER_TICK vars are for TUNING; these constants are for CORRECTNESS. An UNSET var
// used to resolve to null through numOrNull, and null means UNBOUNDED: with only the per-tick 10 as a live
// ceiling, the `*/5` tick could send 2,880 a day against a 100-a-day free tier. That was a FAIL-OPEN cap, unlike
// the fail-closed COUNTER (an unreadable counter sends nothing). So the caps now fall back to these bounded
// defaults, never to null. Sized under Resend's free tier (100/day, 3,000/month) with headroom for retries. A
// var set to 0 is still honored as a deliberate kill switch (numOrNull(0) === 0, and 0 ?? default === 0).
const DEFAULT_DAILY_CAP = 90;
const DEFAULT_MONTHLY_CAP = 2500;
const DEFAULT_MAX_PER_TICK = 10;
export const MAIL_CAP_DEFAULTS = Object.freeze({ daily: DEFAULT_DAILY_CAP, monthly: DEFAULT_MONTHLY_CAP, perTick: DEFAULT_MAX_PER_TICK });

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
 * fail-closed launch send gate. Returns { issueId, sent, failed, suppressed, dropped, refused, deferred,
 * backlog, gate, reason }, where `refused` counts recipients the send gate did not permit and `deferred`
 * counts recipients whose suppression marker was unreadable this tick; both are left pending with no attempt.
 *
 * The cap defaults here are the SAME bounded constants the outer drainMail resolves, NOT null. This is
 * exported and will grow a second direct caller (a per-event notification sender), so an omitted cap must
 * mean the ceiling, not unbounded: closing the fail-open class one layer in, where the future caller cannot
 * be reviewed yet. A direct caller that genuinely wants no ceiling has to pass dailyCap: null on purpose.
 */
export async function drainMailIssue(env, {
  kv = env?.SIGNUP_KV,
  issueId,
  now = Date.now,
  cap = DEFAULT_MAX_PER_TICK,
  dailyCap = DEFAULT_DAILY_CAP,
  monthlyCap = DEFAULT_MONTHLY_CAP,
  dayStr = null,
  monthStr = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  resolveAddress,
  renderIssue,
  sendEmail,
  from = env?.MAIL_FROM || env?.RESEND_FROM || null,
} = {}) {
  const zero = { issueId, sent: 0, failed: 0, suppressed: 0, dropped: 0, refused: 0, deferred: 0, backlog: 0 };
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

  // ONE-CLICK UNSUBSCRIBE, minted per recipient below (RFC 8058). Both inputs are issue-wide, so verify them
  // ONCE here: the signing key MAIL_UNSUB_KEY, and PUBLIC_BASE_URL (the origin that also serves the
  // /mail/unsubscribe route). Missing either => send NOTHING and hold the whole backlog pending (claim
  // nothing, burn no attempt), because an email with no working opt-out must never go out: it is unlawful, it
  // fails Gmail/Yahoo bulk-sender rules, and it lands us in spam. Fail-closed, the same shape as the gate
  // above. postalAddress is DELIBERATELY not built or passed (owner withdrew it 2026-08-21, CAN-SPAM
  // primary-purpose position); renderIssue renders no postal line when it is absent, which is the intended state.
  const unsubBase = String(env?.PUBLIC_BASE_URL ?? '').trim().replace(/\/$/, '');
  if (!env?.MAIL_UNSUB_KEY || !unsubBase) return { ...zero, reason: 'unsubscribe not configured', backlog: pending.length };

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
  let deferred = 0; // suppression marker unreadable this tick: left PENDING, no attempt burned, retried next tick
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
    //
    // THREE outcomes, not two, and the third is the whole point (SecurityMaster, 2026-08-21). A KV read ERROR is
    // NOT knowledge that the person is un-suppressed, so we must NOT send: mailing someone who opted out is
    // exactly what the auto-enrolment rider exists to prevent, and it is invisible after the fact (the record
    // terminalizes as a normal send). But we must NOT terminalize either: markSuppressed writes a TERMINAL
    // record, so a transient blip would permanently unsubscribe a legitimate subscriber and nothing would retry.
    // The correct third outcome is DEFERRED: leave the record pending, claim nothing, count it, retry next tick.
    // (This mirrors mail-store readBudget: absent means zero, error means unknown, and unknown is fail-closed.)
    let supp; // true = suppressed, false = definitely absent, null = unreadable
    try { supp = Boolean(await kv.get(suppressKey(hash))); } catch { supp = null; }
    if (supp === null) { deferred++; continue; } // unreadable marker: fail-closed, no send, no attempt burned
    if (supp) {
      await putSend(kv, markSuppressed(rec, { now }));
      await removeFromPending(kv, issueId, hash);
      suppressed++;
      continue;
    }

    // LAUNCH SEND GATE, per recipient. A hash the gate does not permit this phase is REFUSED: left PENDING,
    // NOT claimed, so it burns no attempt and consumes no budget slot, and it waits for the gate to open for it.
    // Placed AFTER the suppression gate so an unsubscribe is still honored for a not-yet-permitted recipient.
    if (!sendGate.allows(hash)) { refused++; continue; }

    // Mint THIS recipient's one-click unsubscribe URL (RFC 8058: /mail/unsubscribe?h=<mailHash>&t=<token>, the
    // hash is the pseudonymous recipient id, never the address). The issue-wide key/base are checked above, so a
    // null token here is a per-recipient crypto or hash-shape failure: REFUSE (leave pending, burn no attempt,
    // count it, the same shape as the suppression defer and the send-gate refusal). Minted BEFORE the claim so a
    // recipient with no mintable opt-out never even consumes an attempt.
    const unsubToken = await makeUnsubToken(env.MAIL_UNSUB_KEY, hash);
    if (!unsubToken) { refused++; continue; }
    const unsubscribeUrl = `${unsubBase}/mail/unsubscribe?h=${encodeURIComponent(hash)}&t=${encodeURIComponent(unsubToken)}`;

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

    // Render from the FROZEN issue (same content for everyone; the renderer personalizes the unsubscribe link
    // off the per-recipient url built above). A render throw is treated as retryable rather than dropping the
    // recipient.
    //
    // SEND-CAPABILITY (sow-166, wired 2026-08-22): the ctx carries `unsubscribeUrl`, and a recipient for whom it
    // could not be built was already refused above (never reaching here), so the renderer never falls back to its
    // no-url "manage your subscription" footer on a real send. renderIssue DEFAULTS a missing url to that
    // fallback, which is a safe RENDERING choice but an unsafe SENDING one; the drain, not the renderer, is what
    // makes the SENDING choice, which is why the guard lives here and the seam is covered by a drain-output test.
    // postalAddress is DELIBERATELY not passed (owner withdrew it 2026-08-21); renderIssue then renders no postal
    // line, the intended CAN-SPAM primary-purpose state.
    let message;
    try {
      message = renderIssue(issue, { recipientHash: hash, subscriber, from, unsubscribeUrl });
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
  return { issueId, sent, failed, suppressed, dropped, refused, deferred, backlog, allowance, gate: sendGate.mode };
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
  perTickCap = numOrNull(env?.MAIL_MAX_PER_TICK) ?? DEFAULT_MAX_PER_TICK,
  dailyCap = numOrNull(env?.MAIL_DAILY_CAP) ?? DEFAULT_DAILY_CAP,
  monthlyCap = numOrNull(env?.MAIL_MONTHLY_CAP) ?? DEFAULT_MONTHLY_CAP,
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

  // Log the three resolved bounds on ONE line whenever the gate is open and there is work, so an operator sees
  // them in RELATION: a magnitude/paste error (a 2500 daily sitting next to a 2500 monthly, or 9000 typed for
  // 90) is only obvious side by side, and it is the one error class no parse guard catches. Logged, never
  // clamped. Gated on an open send gate so the default closed gate (pre-launch) does not log every */5 tick
  // against a permanently pending issue.
  if (resolveSendGate(env).mode !== 'closed') {
    console.log(JSON.stringify({ evt: 'mail-drain-bounds', perTickCap, dailyCap, monthlyCap, activeIssues: ids.length }));
  }

  let tickCapLeft = Math.max(0, Number(perTickCap) || 0);
  let sent = 0;
  let failed = 0;
  let suppressed = 0;
  let refused = 0;
  let deferred = 0;
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
    deferred += r.deferred || 0;
    issues.push(r);
  }
  return { drained: sent, failed, suppressed, refused, deferred, issues };
}

// Coerce a wrangler var to a cap number, else null so the caller's `?? DEFAULT` binds. Empty and
// whitespace-only are treated as ABSENT (a declared-but-blank var, or a never-created secret read as ""),
// NOT as an explicit 0: Number("") is 0, which would be a silent permanent stop indistinguishable from the
// documented "0" pause. Negatives are rejected the same way. So an explicit "0" is the ONLY value that pauses.
// A trailing-space "90 " is trimmed, not rejected (dashboard pastes carry one). "1e9" is finite and passes
// UNCLAMPED on purpose (an operator upgrading Resend must be able to raise the cap); a wrong-magnitude but
// well-formed value is the one class no parse guard can catch, so drainMail LOGS the resolved bounds instead.
export function numOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
