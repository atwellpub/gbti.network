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
// SHAPE OF THIS FILE: the logic lives in exported, dependency-injected functions and the top-level run is
// guarded at the bottom, the same arrangement scripts/check-credentials.mjs uses. That guard is what lets the
// test suite drive main() with a fake fetch and assert on the message that actually reaches Resend, rather
// than testing a body builder that nothing is proven to call. The email carries BOTH a plain-text part (the
// fixed-width report, unchanged) and an html part rendered through the shared ops layout.
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
import { opsEmail } from '../membership/mail-ops.mjs';

// The GBTI account tag. Not a secret (it appears in every dashboard url); the token beside it is.
const DEFAULT_ACCOUNT = 'd42b12e969229c5187ad0f7289536487';

// Namespace ids are opaque hex. This is the local map to the names we actually say out loud.
const NAMED = { '49432379e11844ac81b6fdaf22d3937a': 'SIGNUP_KV', '64b09b4d03764c979447cc008ffe528c': 'NEWS_KV' };

const DOC = '.data/ops/cloudflare-ops/kv-worker-ops.md';

const QUERY = `query($tag:String!,$geq:Date!,$leq:Date!){
  viewer{accounts(filter:{accountTag:$tag}){
    kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$geq,date_leq:$leq}){
      sum{requests} dimensions{actionType namespaceId date}
    }
  }}
}`;

const fmtDate = (d) => d.toISOString().slice(0, 10);

// Write and delete both draw on the account write cap, so the number that matters is their sum.
const wd = (x) => (x.write || 0) + (x.delete || 0);

/**
 * Everything the run needs, read from env and argv in one place so a test can hand main() a whole
 * configuration without touching the real process. Precedence is unchanged: --days N (a manual run) beats
 * KV_REPORT_DAYS (the workflow) beats the default of 8, clamped to 1..90.
 */
export function resolveConfig({ env = {}, argv = [] } = {}) {
  const daysArgIdx = argv.indexOf('--days');
  const daysArg = daysArgIdx !== -1 ? argv[daysArgIdx + 1] : '';
  return {
    token: env.CF_ANALYTICS_TOKEN || '',
    account: env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT,
    days: Math.max(1, Math.min(90, parseInt(daysArg || env.KV_REPORT_DAYS || '8', 10) || 8)),
    warn: Math.max(1, parseInt(env.KV_WRITE_WARN || '1000', 10) || 1000),
    wantEmail: argv.includes('--email') || env.KV_REPORT_SEND === 'true',
    apiKey: env.RESEND_API_KEY || '',
    from: env.RESEND_FROM || env.MAIL_FROM || '',
    to: env.ALERT_EMAIL || '',
  };
}

/**
 * Fold the analytics rows into the two views the report shows: per day (all four action types) and per
 * namespace (writes and deletes only, since a read costs nothing against the cap). Pure, so the arithmetic
 * is testable without a network call. The numbers here are unchanged from the first version of this script.
 */
export function summarize(rows, { warn = 1000 } = {}) {
  const byDay = {}, byNs = {};
  for (const r of rows) {
    const { date: d, actionType: a, namespaceId: ns } = r.dimensions;
    const n = r.sum.requests;
    (byDay[d] ||= { read: 0, write: 0, delete: 0, list: 0 });
    byDay[d][a] = (byDay[d][a] || 0) + n;
    if (a === 'write' || a === 'delete') { (byNs[ns] ||= { write: 0, delete: 0 }); byNs[ns][a] += n; }
  }
  const dayKeys = Object.keys(byDay).sort();
  const nsKeys = Object.entries(byNs).sort((a, b) => wd(b[1]) - wd(a[1]));
  return {
    byDay,
    byNs,
    dayKeys,
    nsKeys,
    lastDay: dayKeys[dayKeys.length - 1],
    peak: dayKeys.reduce((m, d) => Math.max(m, wd(byDay[d])), 0),
    elevated: dayKeys.filter((d) => wd(byDay[d]) >= warn),
  };
}

/**
 * The plain-text report. It is BOTH the stdout copy (so the Actions log always carries the numbers, even
 * when email is off or fails) and the text part of the email, which is why it keeps its fixed-width columns
 * rather than following the html. Do not reflow it to match the html body; the two parts are read in
 * different places by different tools.
 */
export function reportText(summary, { geq, leq, account, warn }) {
  const { byDay, dayKeys, nsKeys, peak, elevated } = summary;
  const lines = [];
  lines.push(`GBTI Workers KV usage, ${geq} to ${leq} (account ${account}).`);
  lines.push(`Plan: Workers Paid, write cap 1,000,000/day. The old free cap was 1,000/day.`);
  lines.push('');
  lines.push('per DAY (write + delete both draw on the cap):');
  lines.push('date         read      write     delete    list      WRITE+DEL');
  for (const d of dayKeys) {
    const x = byDay[d];
    const t = wd(x);
    const flag = t >= warn ? `  <- >= ${warn}` : '';
    lines.push([d.padEnd(12), String(x.read || 0).padEnd(9), String(x.write || 0).padEnd(9),
      String(x.delete || 0).padEnd(9), String(x.list || 0).padEnd(9), String(t).padEnd(9) + flag].join(' '));
  }
  lines.push('');
  lines.push('per NAMESPACE (write + delete, whole range):');
  for (const [ns, x] of nsKeys) {
    lines.push(`  ${ns}${NAMED[ns] ? ' (' + NAMED[ns] + ')' : ''}  write=${x.write}  delete=${x.delete}  total=${wd(x)}`);
  }
  lines.push('');
  lines.push(elevated.length
    ? `NOTE: ${elevated.length} day(s) at or above ${warn} writes: ${elevated.join(', ')}. On the free plan those would have 429'd. Worth a look at what ran.`
    : `All days under ${warn} writes. Peak ${peak}. Comfortably inside the free line, far inside the paid one.`);
  return lines.join('\n');
}

/**
 * The html body, through the shared ops layout. Real tables rather than the console dump this used to paste
 * into a <pre>: the point of a table is that the owner can compare DOWN a column on a phone, which
 * fixed-width text in a proportional mail font cannot do.
 *
 * WHY THE PER-DAY FIGURES ARE SPLIT ACROSS TWO TABLES rather than reproducing the six columns of the text
 * report. An email table cannot scroll sideways, so every column has to fit the narrowest screen it will be
 * read on. At 375px the card is about 297px wide, and six columns leave roughly twelve pixels of content
 * each: the shared layout then wraps inside the number itself, and "42434" renders as three stacked
 * fragments that a reader can easily take for three separate figures. Four columns leave about thirty four
 * pixels and three leave about sixty, which is why the wide read counts sit in the three-column table and
 * the cap draw, the actual subject of this report, gets its own four-column one. Do not merge them back
 * into one table without re-checking it at 375px.
 *
 * The elevated marker rides in the DATE cell, not next to the total, for the same width reason: a
 * parenthetical in a numeric column would wrap in the middle of a number. The alert band below names the
 * same days again.
 */
export function reportHtml(summary, { geq, leq, account, warn }) {
  const { byDay, dayKeys, nsKeys, peak, elevated } = summary;
  const sections = [];

  if (dayKeys.length) {
    sections.push({ kind: 'paragraph', text: 'Per day, writes and deletes. Both draw on the account write cap.' });
    sections.push({
      kind: 'table',
      columns: ['Date', 'Write', 'Delete', 'Total'],
      rows: dayKeys.map((d) => {
        const x = byDay[d];
        const total = wd(x);
        return [total >= warn ? `${d} (elevated)` : d, x.write || 0, x.delete || 0, total];
      }),
    });
    sections.push({ kind: 'paragraph', text: 'Per day, reads and lists. Neither draws on the write cap.' });
    sections.push({
      kind: 'table',
      columns: ['Date', 'Read', 'List'],
      rows: dayKeys.map((d) => [d, byDay[d].read || 0, byDay[d].list || 0]),
    });
  } else {
    // A bare header row with nothing under it reads as a broken report, so say plainly that the range was
    // empty. An empty range is normal for a narrow --days window, not a failure.
    sections.push({ kind: 'paragraph', text: `Cloudflare reported no KV operations between ${geq} and ${leq}.` });
  }

  if (nsKeys.length) {
    sections.push({ kind: 'paragraph', text: 'Per namespace, writes and deletes across the whole range.' });
    sections.push({
      kind: 'table',
      columns: ['Namespace', 'Write', 'Delete', 'Total'],
      // Friendly name first, opaque id in parentheses: the name is what identifies the namespace to a
      // reader, and the id is only needed when it is one we have not mapped.
      rows: nsKeys.map(([ns, x]) => [NAMED[ns] ? `${NAMED[ns]} (${ns})` : ns, x.write, x.delete, wd(x)]),
    });
  }

  sections.push(elevated.length
    ? {
      kind: 'alert',
      text: `${elevated.length} day(s) at or above ${warn} writes: ${elevated.join(', ')}. `
        + 'On the free plan those days would have been rejected with a 429. Worth a look at what ran.',
    }
    : {
      kind: 'note',
      text: `All days under ${warn} writes. Peak ${peak}. Comfortably inside the free line, far inside the paid one.`,
    });

  const { html } = opsEmail({
    title: 'Workers KV usage',
    lead: `${geq} to ${leq}, account ${account}. Plan: Workers Paid, with a write cap of 1,000,000 a day. `
      + 'The old free cap was 1,000 a day.',
    sections,
    footer: `Weekly report from the kv-usage-report workflow. Details in ${DOC}.`,
  });
  return html;
}

/** The whole message: subject, the plain-text fallback, and the html body. */
export function buildEmail(summary, cfg) {
  const { byDay, lastDay, elevated } = summary;
  return {
    subject: `GBTI KV usage: ${wd(byDay[lastDay] || {})} writes on ${lastDay}`
      + `${elevated.length ? ` (${elevated.length} elevated day[s])` : ''}`,
    text: reportText(summary, cfg),
    html: reportHtml(summary, cfg),
  };
}

/**
 * Fetch, report, and (opt-in) email. Returns the process exit code rather than calling process.exit, so the
 * test suite can run it; the guard at the bottom of the file does the exiting for a real invocation.
 *
 * `fetch` is injected all the way through, including into the Resend client, so a test observes the actual
 * outbound request instead of a stub standing in for the send.
 */
export async function main({
  env = process.env,
  argv = process.argv,
  fetch = globalThis.fetch,
  now = Date.now(),
  log = console.log,
  errorLog = console.error,
} = {}) {
  const cfg = resolveConfig({ env, argv });
  if (!cfg.token) {
    errorLog('kv-usage-report: CF_ANALYTICS_TOKEN is not set (needs Account Analytics Read). No report produced.');
    return { code: 1, sent: false };
  }

  const geq = fmtDate(new Date(now - cfg.days * 864e5));
  const leq = fmtDate(new Date(now));

  let j;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { tag: cfg.account, geq, leq } }),
    });
    j = JSON.parse(await res.text());
  } catch (err) {
    errorLog('kv-usage-report: the analytics request failed: ' + (err?.message || err));
    return { code: 1, sent: false };
  }
  if (j.errors && j.errors.length) {
    errorLog('kv-usage-report: GraphQL error: ' + JSON.stringify(j.errors).slice(0, 400));
    return { code: 1, sent: false };
  }

  const rows = j.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
  const summary = summarize(rows, { warn: cfg.warn });
  const { subject, text, html } = buildEmail(summary, { geq, leq, account: cfg.account, warn: cfg.warn });
  log(text);

  // Email is OPT-IN, so a manual run just prints. The scheduled workflow passes --email (or KV_REPORT_SEND=true).
  if (!cfg.wantEmail) {
    log('\n(print only; pass --email to send)');
    return { code: 0, sent: false };
  }
  if (!cfg.apiKey || !cfg.from || !cfg.to) {
    const missing = !cfg.apiKey ? 'no RESEND_API_KEY' : !cfg.from ? 'no RESEND_FROM/MAIL_FROM' : 'no ALERT_EMAIL';
    log(`\n(email skipped: ${missing})`);
    return { code: 0, sent: false };
  }
  try {
    await createResendClient({ apiKey: cfg.apiKey, fetch })
      .sendEmail({ from: cfg.from, to: cfg.to, subject, text, html });
    log(`\n(emailed to ${cfg.to})`);
    return { code: 0, sent: true };
  } catch (err) {
    errorLog(`\n(email failed, not fatal: ${err?.message || err})`);
    return { code: 0, sent: false };
  }
}

// Only run when invoked directly, so the tests can import main and the helpers without fetching or emailing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(({ code }) => process.exit(code))
    .catch((err) => { console.error('kv-usage-report: crashed: ' + (err?.message || err)); process.exit(1); });
}
