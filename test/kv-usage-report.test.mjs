// The weekly KV usage report: the aggregation, both email bodies, and THE SEND ITSELF. Fake fetch, no
// network, no email, no process.exit.
//
// The send tests below are the point of this file. A report body that renders beautifully and never reaches
// sendEmail is the failure this project keeps repeating, and a test of the builder alone cannot see it: it
// sits one layer under the defect. So the tests that matter here drive main() and assert on the request body
// that actually goes to Resend. Delete `html` from the call site and they go red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveConfig, summarize, reportText, reportHtml, buildEmail, main } from '../scripts/kv-usage-report.mjs';

const SIGNUP = '49432379e11844ac81b6fdaf22d3937a';
const NEWS = '64b09b4d03764c979447cc008ffe528c';

const row = (date, actionType, namespaceId, requests) => ({ sum: { requests }, dimensions: { date, actionType, namespaceId } });

const ROWS = [
  row('2026-08-24', 'read', SIGNUP, 51234),
  row('2026-08-24', 'write', SIGNUP, 812),
  row('2026-08-24', 'delete', NEWS, 17),
  row('2026-08-25', 'write', SIGNUP, 1450),
  row('2026-08-25', 'write', NEWS, 60),
  row('2026-08-25', 'list', SIGNUP, 9),
  row('2026-08-26', 'read', NEWS, 12),
];

// A fixed clock, so the range in the subject and the bodies is the same on every run.
const NOW = Date.parse('2026-08-26T09:00:00Z');
const RANGE = { geq: '2026-08-18', leq: '2026-08-26', account: 'acct-test', warn: 1000 };

const ENV = {
  CF_ANALYTICS_TOKEN: 'cf-test',
  CF_ACCOUNT_ID: 'acct-test',
  RESEND_API_KEY: 're-test',
  RESEND_FROM: 'ops@gbti.network',
  ALERT_EMAIL: 'owner@example.com',
};
const ARGV = ['node', 'kv-usage-report.mjs', '--email'];
const QUIET = { log: () => {}, errorLog: () => {} };

/** A fetch that answers the analytics query and records anything posted to Resend. */
function fakeNet({ rows = ROWS, graphql = null, resendStatus = 200, analyticsThrows = false } = {}) {
  const calls = { analytics: [], resend: [] };
  const fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('api.cloudflare.com')) {
      if (analyticsThrows) throw new Error('socket hang up');
      calls.analytics.push(JSON.parse(init.body));
      const payload = graphql || { data: { viewer: { accounts: [{ kvOperationsAdaptiveGroups: rows }] } } };
      return { ok: true, status: 200, text: async () => JSON.stringify(payload) };
    }
    if (target.includes('api.resend.com')) {
      calls.resend.push(JSON.parse(init.body));
      const ok = resendStatus < 400;
      return { ok, status: resendStatus, text: async () => (ok ? '{"id":"eml_1"}' : 'resend is down') };
    }
    throw new Error('unexpected fetch to ' + target);
  };
  return { fetch, calls };
}

// ---------- configuration ----------

test('resolveConfig: --days beats KV_REPORT_DAYS beats the default, and clamps to 1..90', () => {
  assert.equal(resolveConfig({ env: {}, argv: [] }).days, 8);
  assert.equal(resolveConfig({ env: { KV_REPORT_DAYS: '30' }, argv: [] }).days, 30);
  assert.equal(resolveConfig({ env: { KV_REPORT_DAYS: '30' }, argv: ['--days', '3'] }).days, 3);
  assert.equal(resolveConfig({ env: {}, argv: ['--days', '900'] }).days, 90);
  assert.equal(resolveConfig({ env: {}, argv: ['--days', '0'] }).days, 8);
  assert.equal(resolveConfig({ env: { KV_WRITE_WARN: '250' }, argv: [] }).warn, 250);
});

test('resolveConfig: email is opt-in, by flag or by KV_REPORT_SEND', () => {
  assert.equal(resolveConfig({ env: {}, argv: [] }).wantEmail, false);
  assert.equal(resolveConfig({ env: {}, argv: ['--email'] }).wantEmail, true);
  assert.equal(resolveConfig({ env: { KV_REPORT_SEND: 'true' }, argv: [] }).wantEmail, true);
  assert.equal(resolveConfig({ env: { KV_REPORT_SEND: 'yes' }, argv: [] }).wantEmail, false);
});

// ---------- aggregation (the arithmetic must not drift) ----------

test('summarize: folds per day and per namespace, and write plus delete is what counts', () => {
  const s = summarize(ROWS, { warn: 1000 });
  assert.deepEqual(s.dayKeys, ['2026-08-24', '2026-08-25', '2026-08-26']);
  assert.deepEqual(s.byDay['2026-08-24'], { read: 51234, write: 812, delete: 17, list: 0 });
  assert.equal(s.lastDay, '2026-08-26');
  assert.equal(s.peak, 1510);
  // Per namespace, reads are ignored: only write and delete draw on the cap.
  assert.deepEqual(s.byNs[SIGNUP], { write: 2262, delete: 0 });
  assert.deepEqual(s.byNs[NEWS], { write: 60, delete: 17 });
  assert.deepEqual(s.nsKeys.map(([ns]) => ns), [SIGNUP, NEWS]);
});

test('summarize: elevated is at or above the threshold, never above it only', () => {
  assert.deepEqual(summarize(ROWS, { warn: 1000 }).elevated, ['2026-08-25']);
  assert.deepEqual(summarize(ROWS, { warn: 1510 }).elevated, ['2026-08-25']);
  assert.deepEqual(summarize(ROWS, { warn: 1511 }).elevated, []);
  assert.deepEqual(summarize([], { warn: 1000 }).elevated, []);
});

// ---------- the two bodies ----------

test('reportText: keeps the fixed-width report and the elevated flag', () => {
  const text = reportText(summarize(ROWS, { warn: 1000 }), RANGE);
  assert.match(text, /^GBTI Workers KV usage, 2026-08-18 to 2026-08-26 \(account acct-test\)\./);
  assert.match(text, /date {9}read {6}write {5}delete {4}list {6}WRITE\+DEL/);
  assert.match(text, /2026-08-25 {3}0 {9}1510 {6}0 {9}9 {9}1510 {7}<- >= 1000/);
  assert.match(text, new RegExp(`  ${SIGNUP} \\(SIGNUP_KV\\) {2}write=2262 {2}delete=0 {2}total=2262`));
  assert.match(text, /NOTE: 1 day\(s\) at or above 1000 writes: 2026-08-25\./);
});

test('reportHtml: a real layout, both per-day tables, and the namespace names', () => {
  const html = reportHtml(summarize(ROWS, { warn: 1000 }), RANGE);
  assert.match(html, /<table role="presentation"/);
  assert.ok(!html.includes('<pre'), 'the console dump must not come back');
  assert.match(html, /<title>Workers KV usage<\/title>/);
  // The cap-draw table and the read table are separate, because six numeric columns do not fit a phone.
  assert.match(html, />Write \+ delete<|>Total</);
  assert.match(html, />Read</);
  assert.match(html, />List</);
  assert.match(html, /Per day, writes and deletes/);
  assert.match(html, /Per day, reads and lists/);
  assert.match(html, /SIGNUP_KV \(49432379e11844ac81b6fdaf22d3937a\)/);
  assert.match(html, /NEWS_KV \(64b09b4d03764c979447cc008ffe528c\)/);
  assert.match(html, /2026-08-25 \(elevated\)/);

  // THE FIGURES THEMSELVES, and this is the point of the test rather than a flourish on it. Everything asserted
  // above survives the numbers being wrong: a table renders its header row even with no rows at all, and the
  // date label and the alert copy come from summarize rather than from the cells. Both were demonstrated, with
  // the read table emptied and with every numeric cell forced to zero, and the suite stayed green at 19 of 19
  // in each case. The html is the part a person actually reads on a phone, so it could have disagreed with the
  // text part in every single figure with nothing going red.
  for (const n of ['>1510<', '>2262<', '>9<']) {
    assert.ok(html.includes(n), `the html body lost the figure ${n}`);
  }
});

test('reportHtml: an elevated range gets the alert band, a calm one gets the note', () => {
  const hot = reportHtml(summarize(ROWS, { warn: 1000 }), RANGE);
  assert.match(hot, /1 day\(s\) at or above 1000 writes: 2026-08-25\./);
  assert.ok(!hot.includes('Comfortably inside the free line'), 'the calm note must not run alongside the alert');

  const calm = reportHtml(summarize(ROWS, { warn: 5000 }), { ...RANGE, warn: 5000 });
  assert.match(calm, /All days under 5000 writes\. Peak 1510\./);
  assert.ok(!calm.includes('at or above'), 'no alert when nothing is elevated');
});

test('reportHtml: an empty range says so rather than showing an empty table', () => {
  const html = reportHtml(summarize([], { warn: 1000 }), RANGE);
  assert.match(html, /Cloudflare reported no KV operations between 2026-08-18 and 2026-08-26\./);
  assert.match(html, /All days under 1000 writes\. Peak 0\./);
});

test('reportHtml: every interpolated value is escaped', () => {
  const hostile = '<script>alert("x" & \'y\')</script>';
  const html = reportHtml(summarize([row('2026-08-25', 'write', hostile, 5)], { warn: 1000 }),
    { ...RANGE, account: hostile });
  assert.ok(!html.includes('<script>'), 'a raw script tag reached the body');
  assert.ok(!html.includes('alert("x"'), 'a raw attribute-breaking quote reached the body');
  assert.match(html, /&lt;script&gt;alert\(&quot;x&quot; &amp; /);
});

test('buildEmail: subject names the last day, the count, and any elevated days', () => {
  const hot = buildEmail(summarize(ROWS, { warn: 1000 }), RANGE);
  assert.equal(hot.subject, 'GBTI KV usage: 0 writes on 2026-08-26 (1 elevated day[s])');
  const calm = buildEmail(summarize(ROWS, { warn: 5000 }), { ...RANGE, warn: 5000 });
  assert.equal(calm.subject, 'GBTI KV usage: 0 writes on 2026-08-26');
});

// ---------- the send: what actually reaches Resend ----------

test('main: the html body reaches sendEmail, alongside the plain-text fallback', async () => {
  const net = fakeNet();
  const out = await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });

  assert.equal(out.code, 0);
  assert.equal(out.sent, true);
  assert.equal(net.calls.resend.length, 1, 'exactly one message should be sent');

  const msg = net.calls.resend[0];
  assert.equal(msg.from, 'ops@gbti.network');
  assert.equal(msg.to, 'owner@example.com');
  assert.equal(msg.subject, 'GBTI KV usage: 0 writes on 2026-08-26 (1 elevated day[s])');

  // The html part must be PRESENT and must be the shared ops layout, not the old <pre> dump.
  assert.ok(msg.html, 'the send call dropped the html body');
  assert.match(msg.html, /<table role="presentation"/);
  assert.ok(!msg.html.includes('<pre'), 'the console dump came back');

  // And it must be exactly the body the builder produces for this run, so a call site that builds one body
  // and sends another is caught too.
  const expected = buildEmail(summarize(ROWS, { warn: 1000 }), RANGE);
  assert.equal(msg.html, expected.html);
  assert.equal(msg.text, expected.text, 'the plain-text fallback must survive');
});

test('main: the analytics query carries the account, the range, and the token', async () => {
  const net = fakeNet();
  await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(net.calls.analytics.length, 1);
  assert.deepEqual(net.calls.analytics[0].variables, { tag: 'acct-test', geq: '2026-08-18', leq: '2026-08-26' });
});

test('main: without --email it prints and sends nothing', async () => {
  const net = fakeNet();
  const out = await main({ env: ENV, argv: ['node', 'kv-usage-report.mjs'], fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 0);
  assert.equal(out.sent, false);
  assert.equal(net.calls.resend.length, 0);
});

test('main: --email with no recipient or key is skipped, not fatal', async () => {
  for (const missing of ['RESEND_API_KEY', 'RESEND_FROM', 'ALERT_EMAIL']) {
    const net = fakeNet();
    const env = { ...ENV };
    delete env[missing];
    const out = await main({ env, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
    assert.equal(out.code, 0, `${missing} missing should not be fatal`);
    assert.equal(net.calls.resend.length, 0);
  }
});

test('main: a Resend failure is soft, because the numbers are already in the log', async () => {
  const net = fakeNet({ resendStatus: 500 });
  const out = await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 0);
  assert.equal(out.sent, false);
  assert.equal(net.calls.resend.length, 1, 'it should still have tried');
});

test('main: no analytics token is a hard failure, and nothing is fetched', async () => {
  const net = fakeNet();
  const out = await main({ env: { ...ENV, CF_ANALYTICS_TOKEN: '' }, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 1);
  assert.equal(net.calls.analytics.length, 0);
  assert.equal(net.calls.resend.length, 0);
});

test('main: a GraphQL error is a hard failure and sends no report', async () => {
  const net = fakeNet({ graphql: { errors: [{ message: 'Authentication error' }] } });
  const out = await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 1);
  assert.equal(net.calls.resend.length, 0);
});

test('main: a dead analytics endpoint is a hard failure, not a crash', async () => {
  const net = fakeNet({ analyticsThrows: true });
  const out = await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 1);
  assert.equal(net.calls.resend.length, 0);
});

test('main: an empty analytics result still reports and still sends', async () => {
  const net = fakeNet({ rows: [] });
  const out = await main({ env: ENV, argv: ARGV, fetch: net.fetch, now: NOW, ...QUIET });
  assert.equal(out.code, 0);
  assert.equal(net.calls.resend.length, 1);
  assert.match(net.calls.resend[0].html, /Cloudflare reported no KV operations/);
  assert.ok(net.calls.resend[0].text.includes('per DAY'), 'the text fallback is still built');
});
