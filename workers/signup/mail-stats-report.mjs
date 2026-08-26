// The weekly-digest stats report, the IO half. Snapshots a completed issue's send totals into a durable record,
// reads the anonymous open + click aggregates, and emails the owner a 4-week performance summary AFTER the
// Tuesday send finishes. FAIL-SOFT throughout, like coupon-alert.mjs: it runs on the drain tick and must never
// throw or gate the send path.
//
// WHY A SNAPSHOT. The per-recipient send records (mail:send:<issueId>:<hash>) self-prune at ~30 days, so a naive
// "count them at report time" loses the oldest week of a 4-week window. Snapshotting the sent/failed/suppressed
// totals into mail:stats:<issueId> (no TTL) at completion makes the history durable and the weekly read cheap.
//
// WHY IT FIRES FROM THE DRAIN. There is no native "issue finished" event. Completion = the weekly issue's pending
// index is empty. maybeSendWeeklyReport detects that transition once per issue (guarded by a mail:report:<id>
// flag so it fires exactly once) and reports.
import { createResendClient } from '../../clients/resend.mjs';
import { readPendingIndex } from './mail-store.mjs';
import { openKey } from '../../membership/mail-open.mjs';
import { clickKey } from '../../membership/mail-click.mjs';
import { statsKey, reportKey, issueRow, composeStatsReport } from '../../membership/mail-stats.mjs';

const MAIL_ISSUE_PREFIX = 'mail:issue:';
const num = (v) => (typeof v === 'function' ? v() : v);

/** Scan a completed issue's per-recipient send records and write a durable mail:stats:<issueId> snapshot. Done
 *  once per issue (the report flag prevents a re-scan). Returns the snapshot, or null when KV cannot list. */
export async function snapshotIssueStats(kv, issueId, { now = Date.now } = {}) {
  if (!kv?.list) return null;
  let sent = 0; let failed = 0; let suppressed = 0;
  let cursor;
  for (let page = 0; page < 100; page++) {
    let res;
    try { res = await kv.list({ prefix: `mail:send:${issueId}:`, cursor }); } catch { break; }
    for (const k of res?.keys ?? []) {
      let rec = null;
      try { rec = await kv.get(k.name, 'json'); } catch { rec = null; }
      const s = rec?.status;
      if (s === 'sent') sent += 1;
      else if (s === 'failed') failed += 1;
      else if (s === 'suppressed') suppressed += 1;
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  const record = { issueId: String(issueId), sent, failed, suppressed, snapshotAt: Number(num(now)) };
  try { await kv.put(statsKey(issueId), JSON.stringify(record)); } catch { /* best effort */ }
  return record;
}

/** Every frozen weekly issue id (canonical weekly-YYYY-MM-DD only), newest-first. One key per week fits a page. */
async function listWeeklyIssueIds(kv) {
  if (!kv?.list) return [];
  const ids = [];
  let cursor;
  for (let page = 0; page < 50; page++) {
    let res;
    try { res = await kv.list({ prefix: MAIL_ISSUE_PREFIX, cursor }); } catch { break; }
    for (const k of res?.keys ?? []) {
      const id = k.name.slice(MAIL_ISSUE_PREFIX.length);
      if (id.startsWith('weekly-')) ids.push(id);
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return ids.sort().reverse();
}

async function readIssueRow(kv, issueId) {
  const get = (key) => kv.get(key, 'json').catch(() => null);
  const [stats, opens, clicks] = await Promise.all([get(statsKey(issueId)), get(openKey(issueId)), get(clickKey(issueId))]);
  return issueRow({ issueId, stats, opens, clicks });
}

/** The trailing `weeks` weekly issues up to and including throughIssueId (chronological string order), each read
 *  into a stats row. */
export async function collectWeeklyStats(kv, { throughIssueId, weeks = 4 } = {}) {
  const ids = (await listWeeklyIssueIds(kv))
    .filter((id) => !throughIssueId || id <= throughIssueId)
    .slice(0, weeks);
  const rows = [];
  for (const id of ids) rows.push(await readIssueRow(kv, id));
  return rows;
}

/** Compose and send the 4-week report to the admin. Fail-soft: unprovisioned or a send error is a no-op, never a
 *  throw. Recipient is ADMIN_ALERT_EMAIL, falling back to COUPON_ALERT_EMAIL. */
export async function sendStatsReport(env, { kv = env?.SIGNUP_KV, sendEmail, throughIssueId, weeks = 4 } = {}) {
  try {
    const to = String(env?.ADMIN_ALERT_EMAIL || env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    if (!to || !from) return { sent: false, reason: 'unconfigured' };
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };
    const rows = await collectWeeklyStats(kv, { throughIssueId, weeks });
    const { subject, text } = composeStatsReport(rows, { weeks });
    await send({ from, to, subject, text });
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'error', message: err?.message ?? String(err) };
  }
}

/**
 * Detect a weekly issue that has finished sending (its pending index is empty) and, once per issue, snapshot its
 * totals and email the 4-week report. Runs every drain tick; cheap because only RECENT weekly issues are checked
 * and each is short-circuited by its mail:report:<id> flag after the first completion. Fail-soft.
 *
 * @returns `{ checked, reported, send? }`
 */
export async function maybeSendWeeklyReport(env, { kv = env?.SIGNUP_KV, sendEmail, now = Date.now, recentDays = 14, weeks = 4 } = {}) {
  if (!kv?.list) return { checked: 0, reported: null };
  const cutoff = new Date(Number(num(now)) - recentDays * 86400000).toISOString().slice(0, 10);
  const recent = (await listWeeklyIssueIds(kv)).filter((id) => id.slice('weekly-'.length) >= cutoff); // already newest-first

  let checked = 0;
  let newestCompleted = null;
  for (const id of recent) {
    // Already reported once: skip (this is the cheap common path for a completed week).
    let flag = null;
    try { flag = await kv.get(reportKey(id)); } catch { flag = null; }
    if (flag) continue;
    checked += 1;

    // Still draining (or unreadable): try again next tick.
    let pending;
    try { pending = await readPendingIndex(kv, id); } catch { continue; }
    if (pending.length > 0) continue;

    // Pending empty: snapshot. Guard the freeze/enqueue race: an issue frozen but not yet enqueued has NO send
    // records (0/0/0), so do not flag it as done, let a later tick catch it once it has actually sent.
    const stats = await snapshotIssueStats(kv, id, { now });
    if (!stats || (stats.sent + stats.failed + stats.suppressed) === 0) continue;

    try { await kv.put(reportKey(id), JSON.stringify({ reportedAt: Number(num(now)) })); } catch { /* best effort */ }
    // The newest completed issue with real sends drives the one report this tick (recent is newest-first).
    if (stats.sent > 0 && !newestCompleted) newestCompleted = id;
  }

  if (!newestCompleted) return { checked, reported: null };
  const send = await sendStatsReport(env, { kv, sendEmail, throughIssueId: newestCompleted, weeks });
  return { checked, reported: newestCompleted, send };
}
