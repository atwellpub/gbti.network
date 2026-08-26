#!/usr/bin/env node
// Weekly KV usage report. Pulls Workers KV operations from Cloudflare's GraphQL analytics (by namespace, by
// day) and emails a short digest to the admin address, so we can see where KV writes are going and catch a
// trend before it matters. Also prints the report to stdout, so the Actions log always carries it even if
// email is unconfigured. See .data/ops/cloudflare-ops/kv-worker-ops.md.
//
// WHY THIS EXISTS: KV free-tier writes are ACCOUNT-LEVEL (1,000/day shared across every namespace). The
// account blew that on 2026-08-25 and we moved to Workers Paid (1,000,000/day). We keep no itemized KV usage
// store of our own; Cloudflare's analytics is the source, and this is the recurring read of it.
//
// ENV:
//   CF_ANALYTICS_TOKEN   REQUIRED. A Cloudflare token with "Account Analytics: Read". (CF_API_TOKEN, the
//                        reconcile KV token, does NOT have analytics scope; confirmed 2026-08-26.)
//   CF_ACCOUNT_ID        optional, defaults to the GBTI account tag.
//   KV_REPORT_DAYS       optional, days of history to report (default 8, clamped 1..90). A manual run may
//                        pass --days N on the command line, which overrides this.
//   KV_WRITE_WARN        optional, per-day write threshold to flag as elevated (default 1000, the old free cap
//                        that a paid-plan day still worth noticing would cross).
//   RESEND_API_KEY       the Resend key. Email is OPT-IN: it sends ONLY with the --email flag (or
//                        KV_REPORT_SEND=true), so a manual run just prints. The scheduled workflow passes it.
//   ALERT_EMAIL          the recipient (the admin address). Reuses the credential-health alert var.
//   RESEND_FROM / MAIL_FROM  the verified from-address.
//
// Exit code: 1 on a hard failure (no analytics token, or a GraphQL/auth error) so a scheduled run goes RED as
// a backstop signal. An email-send failure is soft (logged, never fatal): the numbers are already in the log.

import { createResendClient } from '../clients/resend.mjs';

const TOKEN = process.env.CF_ANALYTICS_TOKEN || '';
const ACCT = process.env.CF_ACCOUNT_ID || 'd42b12e969229c5187ad0f7289536487';
// Days of history: --days N (a manual run) overrides KV_REPORT_DAYS (the workflow) overrides 8. Clamp 1..90.
const daysArgIdx = process.argv.indexOf('--days');
const daysArg = daysArgIdx !== -1 ? process.argv[daysArgIdx + 1] : '';
const DAYS = Math.max(1, Math.min(90, parseInt(daysArg || process.env.KV_REPORT_DAYS || '8', 10) || 8));
const WARN = Math.max(1, parseInt(process.env.KV_WRITE_WARN || '1000', 10) || 1000);
const NAMED = { '49432379e11844ac81b6fdaf22d3937a': 'SIGNUP_KV', '64b09b4d03764c979447cc008ffe528c': 'NEWS_KV' };

function die(msg) { console.error('kv-usage-report: ' + msg); process.exit(1); }
if (!TOKEN) die('CF_ANALYTICS_TOKEN is not set (needs Account Analytics Read). No report produced.');

const fmt = (d) => d.toISOString().slice(0, 10);
const geq = fmt(new Date(Date.now() - DAYS * 864e5));
const leq = fmt(new Date());

const query = `query($tag:String!,$geq:Date!,$leq:Date!){
  viewer{accounts(filter:{accountTag:$tag}){
    kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$geq,date_leq:$leq}){
      sum{requests} dimensions{actionType namespaceId date}
    }
  }}
}`;

let j;
try {
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { tag: ACCT, geq, leq } }),
  });
  j = JSON.parse(await res.text());
} catch (err) {
  die('the analytics request failed: ' + (err?.message || err));
}
if (j.errors && j.errors.length) die('GraphQL error: ' + JSON.stringify(j.errors).slice(0, 400));

const rows = j.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];

const byDay = {}, byNs = {};
for (const r of rows) {
  const { date: d, actionType: a, namespaceId: ns } = r.dimensions;
  const n = r.sum.requests;
  (byDay[d] ||= { read: 0, write: 0, delete: 0, list: 0 });
  byDay[d][a] = (byDay[d][a] || 0) + n;
  if (a === 'write' || a === 'delete') { (byNs[ns] ||= { write: 0, delete: 0 }); byNs[ns][a] += n; }
}

const dayKeys = Object.keys(byDay).sort();
const wd = (x) => (x.write || 0) + (x.delete || 0);
const lastDay = dayKeys[dayKeys.length - 1];
const peak = dayKeys.reduce((m, d) => Math.max(m, wd(byDay[d])), 0);
const elevated = dayKeys.filter((d) => wd(byDay[d]) >= WARN);

const lines = [];
lines.push(`GBTI Workers KV usage, ${geq} to ${leq} (account ${ACCT}).`);
lines.push(`Plan: Workers Paid, write cap 1,000,000/day. The old free cap was 1,000/day.`);
lines.push('');
lines.push('per DAY (write + delete both draw on the cap):');
lines.push('date         read      write     delete    list      WRITE+DEL');
for (const d of dayKeys) {
  const x = byDay[d];
  const t = wd(x);
  const flag = t >= WARN ? `  <- >= ${WARN}` : '';
  lines.push([d.padEnd(12), String(x.read || 0).padEnd(9), String(x.write || 0).padEnd(9),
    String(x.delete || 0).padEnd(9), String(x.list || 0).padEnd(9), String(t).padEnd(9) + flag].join(' '));
}
lines.push('');
lines.push('per NAMESPACE (write + delete, whole range):');
for (const [ns, x] of Object.entries(byNs).sort((a, b) => wd(b[1]) - wd(a[1]))) {
  lines.push(`  ${ns}${NAMED[ns] ? ' (' + NAMED[ns] + ')' : ''}  write=${x.write}  delete=${x.delete}  total=${wd(x)}`);
}
lines.push('');
lines.push(elevated.length
  ? `NOTE: ${elevated.length} day(s) at or above ${WARN} writes: ${elevated.join(', ')}. On the free plan those would have 429'd. Worth a look at what ran.`
  : `All days under ${WARN} writes. Peak ${peak}. Comfortably inside the free line, far inside the paid one.`);

const report = lines.join('\n');
console.log(report);

// Email is OPT-IN, so a manual run just prints. The scheduled workflow passes --email (or KV_REPORT_SEND=true).
const wantEmail = process.argv.includes('--email') || process.env.KV_REPORT_SEND === 'true';
if (!wantEmail) { console.log('\n(print only; pass --email to send)'); process.exit(0); }

// Email (soft): only when a key, a from, and a recipient are all present.
const apiKey = process.env.RESEND_API_KEY || '';
const from = process.env.RESEND_FROM || process.env.MAIL_FROM || '';
const to = process.env.ALERT_EMAIL || '';
if (!apiKey || !from || !to) {
  console.log(`\n(email skipped: ${!apiKey ? 'no RESEND_API_KEY' : !from ? 'no RESEND_FROM/MAIL_FROM' : 'no ALERT_EMAIL'})`);
  process.exit(0);
}
const subject = `GBTI KV usage: ${wd(byDay[lastDay] || {})} writes on ${lastDay}${elevated.length ? ` (${elevated.length} elevated day[s])` : ''}`;
const html = `<p>Weekly Workers KV usage. Numbers below; details in <code>.data/ops/cloudflare-ops/kv-worker-ops.md</code>.</p><pre style="font:13px/1.5 ui-monospace,Menlo,Consolas,monospace">${report.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
try {
  await createResendClient({ apiKey }).sendEmail({ from, to, subject, text: report, html });
  console.log(`\n(emailed to ${to})`);
} catch (err) {
  console.error(`\n(email failed, not fatal: ${err?.message || err})`);
}
process.exit(0);
