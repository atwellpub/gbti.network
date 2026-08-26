// The weekly-digest stats report: the pure aggregation + copy, and the IO (snapshot, collect, the once-per-issue
// after-send hook). Fake KV, injected sender, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { issueDateStamp, issueRow, rollup, composeStatsReport, statsKey, reportKey } from '../membership/mail-stats.mjs';
import { snapshotIssueStats, collectWeeklyStats, sendStatsReport, maybeSendWeeklyReport } from '../workers/signup/mail-stats-report.mjs';
import { openKey } from '../membership/mail-open.mjs';
import { clickKey } from '../membership/mail-click.mjs';

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      const v = m.get(key);
      if (v == null) return null;
      if (type === 'json') { try { return JSON.parse(v); } catch { return null; } }
      return v;
    },
    async put(key, value) { m.set(key, String(value)); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '', cursor } = {}) { // single-page fake
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}
function sink() {
  const sent = [];
  return { sent, send: async (msg) => { sent.push(msg); return { id: 'x' }; } };
}
const NOW = () => Date.parse('2026-08-26T12:00:00.000Z');
const RECIP = { ADMIN_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'digest@gbti.network' };

// Seed one issue: a frozen issue key, a pending index, N sent records, and open/click aggregates.
function seedIssue(kv, id, { sent = 0, failed = 0, suppressed = 0, pending = [], opens = 0, clicks = 0 } = {}) {
  kv.m.set(`mail:issue:${id}`, JSON.stringify({ issueId: id }));
  kv.m.set(`mail:pending:${id}`, JSON.stringify({ hashes: pending }));
  let n = 0;
  const put = (status, count) => { for (let i = 0; i < count; i++) kv.m.set(`mail:send:${id}:h${n++}`, JSON.stringify({ issueId: id, status })); };
  put('sent', sent); put('failed', failed); put('suppressed', suppressed);
  if (opens) kv.m.set(openKey(id), JSON.stringify({ issueId: id, total: opens }));
  if (clicks) kv.m.set(clickKey(id), JSON.stringify({ issueId: id, total: clicks }));
}

// ---------- pure ----------

test('issueDateStamp extracts the ISO date from an issue id', () => {
  assert.equal(issueDateStamp('weekly-2026-08-25'), '2026-08-25');
  assert.equal(issueDateStamp('welcome-2026-01-04'), '2026-01-04');
  assert.equal(issueDateStamp('nope'), '');
});

test('issueRow computes open rate and CTR against sent, null when sent is 0', () => {
  const r = issueRow({ issueId: 'weekly-2026-08-25', stats: { sent: 100, failed: 2, suppressed: 1 }, opens: { total: 40 }, clicks: { total: 10 } });
  assert.equal(r.sent, 100); assert.equal(r.opens, 40); assert.equal(r.clicks, 10);
  assert.equal(r.openRate, 0.4); assert.equal(r.ctr, 0.1);
  const z = issueRow({ issueId: 'x', stats: { sent: 0 }, opens: { total: 5 } });
  assert.equal(z.openRate, null); assert.equal(z.ctr, null);
});

test('rollup sums rows and rates against summed sent', () => {
  const roll = rollup([{ sent: 100, opens: 40, clicks: 10 }, { sent: 100, opens: 60, clicks: 30 }]);
  assert.equal(roll.sent, 200); assert.equal(roll.opens, 100); assert.equal(roll.openRate, 0.5); assert.equal(roll.ctr, 0.2);
});

test('composeStatsReport names the latest issue and lists the rollup; empty is graceful', () => {
  const rows = [
    issueRow({ issueId: 'weekly-2026-08-18', stats: { sent: 50 }, opens: { total: 20 }, clicks: { total: 5 } }),
    issueRow({ issueId: 'weekly-2026-08-25', stats: { sent: 100 }, opens: { total: 40 }, clicks: { total: 10 } }),
  ];
  const { subject, text } = composeStatsReport(rows, { weeks: 4 });
  assert.ok(subject.includes('100 sent'), 'subject names the newest issue sent count');
  assert.ok(subject.includes('2026-08-25'), 'subject names the newest issue');
  assert.ok(text.includes('2026-08-25'));
  assert.ok(text.includes('2026-08-18'));
  assert.ok(text.includes('Rollup: 150 sent'), 'rollup sums both issues');
  assert.ok(/APPROXIMATE/.test(text), 'the opens caveat is stated');
  const empty = composeStatsReport([], {});
  assert.ok(empty.subject.includes('no issues'));
});

// ---------- snapshot + collect ----------

test('snapshotIssueStats counts sent/failed/suppressed into a durable mail:stats record', async () => {
  const kv = makeKV();
  seedIssue(kv, 'weekly-2026-08-25', { sent: 7, failed: 2, suppressed: 1, pending: [] });
  const rec = await snapshotIssueStats(kv, 'weekly-2026-08-25', { now: NOW });
  assert.deepEqual({ sent: rec.sent, failed: rec.failed, suppressed: rec.suppressed }, { sent: 7, failed: 2, suppressed: 1 });
  const stored = JSON.parse(kv.m.get(statsKey('weekly-2026-08-25')));
  assert.equal(stored.sent, 7);
});

test('collectWeeklyStats reads the trailing N weekly issues through a given id', async () => {
  const kv = makeKV();
  for (const [id, s] of [['weekly-2026-08-04', 30], ['weekly-2026-08-11', 40], ['weekly-2026-08-18', 50], ['weekly-2026-08-25', 60]]) {
    seedIssue(kv, id, { pending: [] });
    kv.m.set(statsKey(id), JSON.stringify({ issueId: id, sent: s }));
  }
  const rows = await collectWeeklyStats(kv, { throughIssueId: 'weekly-2026-08-25', weeks: 4 });
  assert.equal(rows.length, 4);
  assert.equal(rows[0].issueId, 'weekly-2026-08-25', 'newest first');
  assert.equal(rows[0].sent, 60);
  // a window of 2 keeps only the two newest through the given id
  const two = await collectWeeklyStats(kv, { throughIssueId: 'weekly-2026-08-18', weeks: 2 });
  assert.deepEqual(two.map((r) => r.issueId), ['weekly-2026-08-18', 'weekly-2026-08-11']);
});

// ---------- the after-send hook ----------

test('maybeSendWeeklyReport: a completed issue snapshots, flags, and emails once', async () => {
  const kv = makeKV();
  seedIssue(kv, 'weekly-2026-08-25', { sent: 10, pending: [], opens: 4, clicks: 2 });
  const { sent, send } = sink();
  const res = await maybeSendWeeklyReport({ ...RECIP, SIGNUP_KV: kv }, { sendEmail: send, now: NOW });
  assert.equal(res.reported, 'weekly-2026-08-25');
  assert.equal(sent.length, 1, 'one report email');
  assert.equal(sent[0].to, 'owner@example.com');
  assert.ok(sent[0].subject.includes('10 sent'));
  assert.ok(kv.m.get(reportKey('weekly-2026-08-25')), 'the report flag is set');
  assert.ok(kv.m.get(statsKey('weekly-2026-08-25')), 'the snapshot is written');

  // second run is a no-op: no second email
  const { sent: sent2, send: send2 } = sink();
  const res2 = await maybeSendWeeklyReport({ ...RECIP, SIGNUP_KV: kv }, { sendEmail: send2, now: NOW });
  assert.equal(res2.reported, null);
  assert.equal(sent2.length, 0, 'never re-reports a flagged issue');
});

test('maybeSendWeeklyReport: a still-draining issue is not reported or flagged', async () => {
  const kv = makeKV();
  seedIssue(kv, 'weekly-2026-08-25', { sent: 3, pending: ['stillPendingHash'], opens: 1 });
  const { sent, send } = sink();
  const res = await maybeSendWeeklyReport({ ...RECIP, SIGNUP_KV: kv }, { sendEmail: send, now: NOW });
  assert.equal(res.reported, null);
  assert.equal(sent.length, 0);
  assert.equal(kv.m.get(reportKey('weekly-2026-08-25')), undefined, 'no flag while still sending');
});

test('maybeSendWeeklyReport: a frozen-but-not-yet-sent issue (no send records) is not flagged', async () => {
  const kv = makeKV();
  seedIssue(kv, 'weekly-2026-08-25', { pending: [] }); // pending empty AND zero send records (the race window)
  const { sent, send } = sink();
  const res = await maybeSendWeeklyReport({ ...RECIP, SIGNUP_KV: kv }, { sendEmail: send, now: NOW });
  assert.equal(res.reported, null);
  assert.equal(sent.length, 0);
  assert.equal(kv.m.get(reportKey('weekly-2026-08-25')), undefined, 'the freeze/enqueue race does not prematurely flag');
});

test('sendStatsReport is a fail-soft no-op when the recipient is unconfigured', async () => {
  const kv = makeKV();
  seedIssue(kv, 'weekly-2026-08-25', { sent: 5, pending: [] });
  kv.m.set(statsKey('weekly-2026-08-25'), JSON.stringify({ issueId: 'weekly-2026-08-25', sent: 5 }));
  const res = await sendStatsReport({ MAIL_FROM: 'x@gbti.network', SIGNUP_KV: kv }, { throughIssueId: 'weekly-2026-08-25' });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'unconfigured');
});
