// SOW-166: the PURE mail send-pacing core for the weekly digest. No IO, no Date.now() inside (callers inject
// `now`), so it is fully unit-tested with fakes. It is the deliberate twin of membership/syndication-queue.mjs:
// the digest reuses the same claim-before-send, per-recipient sent-marker, and attempts-cap discipline the
// syndication drain already runs in production, so the two share one mental model. The Worker drain
// (workers/signup/mail-drain.mjs) does the KV read-modify-write around these transforms and the Resend send.
//
// One record is one RECIPIENT'S delivery of one ISSUE, keyed `mail:send:<issueId>:<recipientHash>`. The record
// is KV-only runtime state, never committed to git. It deliberately carries NO email address and NO issue body:
// only the issueId, the recipientHash (an HMAC of the lowercased address under a standing Worker secret, computed
// by the caller, never reversible here), and the Stripe customerId the drain resolves the address from at send
// time. So the send-state store can never leak a subscriber's raw email (data-protection.md:49 stands unamended:
// the platform stores no raw email of its own; the address only ever lives on Stripe), and the leak-guard test
// asserts a stored record serializes without any '@'.
//
// Shape (mail:send:<issueId>:<recipientHash>):
//   { issueId, recipientHash, customerId, order, status, enqueuedAt, availableAt, claimedAt, attempts,
//     sentAt, failedAt }
//
// The per-recipient-per-issue KEY is itself the idempotency guarantee: one recipient can hold at most one record
// per issue, so a re-run of the weekly compile finds the record already present and does not enqueue a second.

export const MAIL_STATUS = new Set(['pending', 'claimed', 'sent', 'failed']);
export const DEFAULT_MAX_ATTEMPTS = 5;

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class MailQueueError extends Error {}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s === '' ? null : s;
};
const num = (v) => {
  if (v == null) return null; // preserve null (Number(null) === 0 would wrongly stamp a timestamp)
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** The KV key for one recipient's delivery of one issue. One logical send maps to exactly one key. */
export function sendKey(issueId, recipientHash) {
  const id = trimOrNull(issueId);
  const rh = trimOrNull(recipientHash);
  if (!id) throw new MailQueueError('issueId is required');
  if (!rh) throw new MailQueueError('recipientHash is required');
  return `mail:send:${id}:${rh}`;
}

/**
 * Build a canonical, pending send record for one recipient of one issue. PURE. Validates the identifiers and
 * stamps enqueuedAt. `availableAt` is when the record first becomes eligible to send (the issue's send-start,
 * so a Tuesday-morning compile can enqueue records that only begin draining at the send window); it defaults to
 * enqueuedAt. `order` is the recipient's position in the per-issue fairness rotation (see rotateOrder), used by
 * planDrain to release the queue in a stable, rotated order so the same subscribers are not always last.
 */
export function buildMailSend(input = {}, { now = Date.now, availableAt = null } = {}) {
  const issueId = trimOrNull(input.issueId);
  if (!issueId) throw new MailQueueError('issueId is required');
  const recipientHash = trimOrNull(input.recipientHash);
  if (!recipientHash) throw new MailQueueError('recipientHash is required');
  // customerId is OPTIONAL (store decision 2026-08-17: self-managed KV, not Stripe). An ANONYMOUS subscriber
  // has no Stripe Customer; the drain resolves its address from the mail:subscriber:<recipientHash> record. A
  // caller MAY denormalize a member's customerId here to save a lookup, but it is never required.
  const customerId = trimOrNull(input.customerId);

  const enqueuedAt = Number(now());
  const avail = num(availableAt);
  return {
    issueId,
    recipientHash,
    customerId,
    order: Number.isFinite(Number(input.order)) ? Math.floor(Number(input.order)) : 0,
    status: 'pending',
    enqueuedAt,
    availableAt: avail == null ? enqueuedAt : avail,
    claimedAt: null,
    attempts: 0,
    sentAt: null,
    failedAt: null,
  };
}

/** Defensive: coerce a stored value into the canonical shape, or null when it is not a usable record. */
export function normalizeMailSend(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const issueId = trimOrNull(raw.issueId);
  const recipientHash = trimOrNull(raw.recipientHash);
  const customerId = trimOrNull(raw.customerId); // optional (see buildMailSend)
  if (!issueId || !recipientHash) return null;
  const status = MAIL_STATUS.has(raw.status) ? raw.status : 'pending';
  const enqueuedAt = num(raw.enqueuedAt) ?? 0;
  return {
    issueId,
    recipientHash,
    customerId,
    order: num(raw.order) ?? 0,
    status,
    enqueuedAt,
    availableAt: num(raw.availableAt) ?? enqueuedAt,
    claimedAt: num(raw.claimedAt),
    attempts: num(raw.attempts) ?? 0,
    sentAt: num(raw.sentAt),
    failedAt: num(raw.failedAt),
  };
}

/**
 * Is this record due to send now? A record is due only while it is 'pending' (a 'claimed' record is owned by an
 * in-flight tick, a 'sent' record is the per-recipient sent marker and must never send again, a 'failed' record
 * is terminal) and its send window has opened. A record whose availableAt is in the future is HOLDING, not due.
 */
export function isDue(item, now = Date.now()) {
  if (!item || item.status !== 'pending') return false;
  return Number(now) >= Number(item.availableAt);
}

/** Partition the not-terminal records into { due, holding } at `now`. `due` is sorted by the fairness `order`
 *  (then recipientHash as a stable tiebreak) so a capped drain always releases the same rotated prefix. Terminal
 *  records (sent/failed) and in-flight (claimed) records are excluded from both lists. */
export function planDrain(items, now = Date.now()) {
  const due = [];
  const holding = [];
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.status !== 'pending') continue;
    (isDue(it, now) ? due : holding).push(it);
  }
  due.sort((a, b) => (a.order - b.order) || String(a.recipientHash).localeCompare(String(b.recipientHash)));
  return { due, holding };
}

/** A pending record may be retried while it has not exhausted its attempt budget. */
export function canRetry(item, maxAttempts = DEFAULT_MAX_ATTEMPTS) {
  return Boolean(item) && item.status === 'pending' && (item.attempts || 0) < Math.max(1, Number(maxAttempts) || DEFAULT_MAX_ATTEMPTS);
}

/** Mark a record claimed by a drain tick AND burn one attempt in the same transition (the compare-and-set guard
 *  against a cron overlap). A HOLDING record is never claimed, so a holding tick never burns an attempt. */
export function markClaimed(item, { now = Date.now } = {}) {
  return { ...item, status: 'claimed', claimedAt: Number(now()), attempts: (item.attempts || 0) + 1 };
}

/** Release a claim back to pending (a retryable send failure, or an over-budget tick that claimed then backed
 *  off). Leaves attempts as-is. */
export function releaseClaim(item) {
  return { ...item, status: 'pending', claimedAt: null };
}

/** The per-recipient sent marker: terminal, and the reason a re-read before send can never double-send. */
export function markSent(item, { now = Date.now } = {}) {
  return { ...item, status: 'sent', sentAt: Number(now()) };
}

/** Terminal failure after the attempt budget is spent. */
export function markFailed(item, { now = Date.now } = {}) {
  return { ...item, status: 'failed', failedAt: Number(now()) };
}

// ----- Rate budget (a HARD, FAIL-CLOSED ceiling; the drain checks it before every release) -----

/** The rolling-counter KV keys. The caller derives the date strings in the operator timezone (impure), so this
 *  stays clock-agnostic. */
export function budgetDayKey(dateStr) {
  return `mail:budget:day:${str(dateStr)}`;
}
export function budgetMonthKey(monthStr) {
  return `mail:budget:month:${str(monthStr)}`;
}

/**
 * May one more send go out under the daily and monthly caps? FAIL-CLOSED: an unreadable or missing counter
 * (null / undefined / non-finite / negative) returns false, so a lost counter read sends NOTHING this tick rather
 * than sending freely. A cap that is null/undefined is treated as unlimited on THAT axis only (an explicit
 * config choice), but a null COUNTER is never trusted.
 */
export function withinBudget({ daily, monthly } = {}, { dailyCap = null, monthlyCap = null } = {}) {
  const d = num(daily); // num() returns null for null/undefined/NaN; Number(null) would be 0 and fail OPEN
  const m = num(monthly);
  if (d == null || d < 0) return false; // fail-closed on an unreadable daily counter
  if (m == null || m < 0) return false; // fail-closed on an unreadable monthly counter
  if (dailyCap != null && Number.isFinite(Number(dailyCap)) && d >= Number(dailyCap)) return false;
  if (monthlyCap != null && Number.isFinite(Number(monthlyCap)) && m >= Number(monthlyCap)) return false;
  return true;
}

/** How many more sends the tighter of the two caps still allows, given the current counters. FAIL-CLOSED: an
 *  unreadable counter returns 0. Used to cap a single tick's releases (min of this and the per-tick cap). */
export function budgetRemaining({ daily, monthly } = {}, { dailyCap = null, monthlyCap = null } = {}) {
  const d = num(daily); // fail-closed: a null/undefined counter must not read as 0 (Number(null) === 0)
  const m = num(monthly);
  if (d == null || d < 0 || m == null || m < 0) return 0;
  let remaining = Infinity;
  if (dailyCap != null && Number.isFinite(Number(dailyCap))) remaining = Math.min(remaining, Math.max(0, Number(dailyCap) - d));
  if (monthlyCap != null && Number.isFinite(Number(monthlyCap))) remaining = Math.min(remaining, Math.max(0, Number(monthlyCap) - m));
  return remaining;
}

// ----- Fairness rotation + backlog measurement -----

/** A small, pure, deterministic string hash (djb2). Used to derive a per-issue rotation offset from the issueId
 *  without any clock or randomness, so the rotation is reproducible and testable. */
export function hashString(s) {
  let h = 5381;
  const t = str(s);
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/**
 * Assign the per-issue fairness order. PURE and deterministic: sort the recipient hashes into a stable canonical
 * order, then rotate the list by an offset derived from the issueId, so a different cohort leads each issue and
 * the subscribers who drained last this week are near the front next week. Returns the hashes in send order; the
 * caller stamps each record's `order` from the returned index.
 */
export function rotateOrder(recipientHashes, issueId) {
  const list = (Array.isArray(recipientHashes) ? recipientHashes : []).map(str).filter(Boolean);
  list.sort((a, b) => a.localeCompare(b));
  const n = list.length;
  if (n === 0) return [];
  const offset = hashString(issueId) % n;
  return list.slice(offset).concat(list.slice(0, offset));
}

/** The count of still-pending recipients for an issue (the backlog). Reported, never silently dropped. */
export function backlogCount(items) {
  return (Array.isArray(items) ? items : []).filter((it) => it && it.status === 'pending').length;
}

/** The age in ms of the OLDEST still-pending record (max(now - availableAt) over pending records), or 0 when the
 *  queue is drained. The drain compares this to the staleness cap to decide whether to ALERT the owner and HOLD
 *  (the measured upgrade trigger), rather than silently degrading. */
export function oldestPendingAgeMs(items, now = Date.now()) {
  let oldest = 0;
  for (const it of Array.isArray(items) ? items : []) {
    if (!it || it.status !== 'pending') continue;
    const age = Number(now) - Number(it.availableAt);
    if (Number.isFinite(age) && age > oldest) oldest = age;
  }
  return oldest;
}
