// The weekly-digest stats report, the PURE half (the IO half is workers/signup/mail-stats-report.mjs). Node-free
// so the aggregation math and the owner-facing copy are unit-tested without a network. Mirrors coupon-notify.mjs.
//
// WHAT IS MEASURED, and its honest limits:
//   - sent / failed / suppressed  per issue, snapshotted from the per-recipient send records at completion into a
//     durable mail:stats:<issueId> (the raw records TTL out at 30 days; the snapshot does not).
//   - opens                        from the anonymous per-issue open pixel (mail:opens:<issueId>). APPROXIMATE:
//     image proxies (Apple Mail Privacy Protection, Gmail) pre-fetch and inflate; image blockers never fetch and
//     deflate. A trend, not a headcount.
//   - clicks                       from the anonymous per-issue click counter (mail:clicks:<issueId>). TOTAL
//     clicks, not unique clickers: the click store records no reader identity by design.
// Open rate and CTR are computed against sent, and are null (rendered n/a) when an issue has no snapshot yet
// (an issue that predates this feature, or one still sending).

import { opsEmail } from './mail-ops.mjs';

export const STATS_PREFIX = 'mail:stats:';
export const statsKey = (issueId) => `${STATS_PREFIX}${issueId}`;
export const REPORT_PREFIX = 'mail:report:';
export const reportKey = (issueId) => `${REPORT_PREFIX}${issueId}`;

/** 'weekly-2026-08-25' -> '2026-08-25' (the date label); '' when the id carries no trailing ISO date. */
export function issueDateStamp(issueId) {
  const m = /-(\d{4}-\d{2}-\d{2})$/.exec(String(issueId ?? ''));
  return m ? m[1] : '';
}

/** Project the three per-issue KV records into one flat stats row. Pure. */
export function issueRow({ issueId, stats, opens, clicks } = {}) {
  const sent = Number(stats?.sent) || 0;
  const opensN = Number(opens?.total) || 0;
  const clicksN = Number(clicks?.total) || 0;
  return {
    issueId: String(issueId ?? ''),
    sent,
    failed: Number(stats?.failed) || 0,
    suppressed: Number(stats?.suppressed) || 0,
    opens: opensN,
    clicks: clicksN,
    openRate: sent ? opensN / sent : null,
    ctr: sent ? clicksN / sent : null,
  };
}

/** Sum a set of rows into a rollup, with rates computed against the summed sent. */
export function rollup(rows) {
  const t = (Array.isArray(rows) ? rows : []).reduce((a, r) => {
    a.sent += r.sent || 0; a.opens += r.opens || 0; a.clicks += r.clicks || 0;
    a.failed += r.failed || 0; a.suppressed += r.suppressed || 0;
    return a;
  }, { sent: 0, opens: 0, clicks: 0, failed: 0, suppressed: 0 });
  return { ...t, openRate: t.sent ? t.opens / t.sent : null, ctr: t.sent ? t.clicks / t.sent : null };
}

const pct = (x) => (x == null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

// The two standing caveats. They live in one place because the plain-text body and the html body must say the
// same thing: a reader who trusts a number in one and not the other has been told two different stories.
const OPENS_CAVEAT = 'Opens are APPROXIMATE (image proxies inflate, blockers deflate). Clicks are TOTAL, not unique.';
const OPENS_NOTE = 'Opens are approximate. Image proxies (Apple Mail Privacy Protection, Gmail) pre-fetch the '
  + 'pixel and inflate the count, and image blockers never fetch it and deflate the count. Read the trend, not '
  + 'the headcount.';
const CLICKS_NOTE = 'Clicks are total clicks, not unique clickers: the click store records no reader identity. '
  + 'Over a small send that makes a click rate above 100% ordinary rather than an error.';
const WHERE_NOTE = 'Per-link and per-placement clicks are in mail:clicks:<issueId>. Notes: .data/ops/mail-ops/.';

// sow-283: TWO tables, not one eight-column table, and this was measured rather than guessed. Eight columns is
// too many for an email: at a 375px viewport the numeric columns hold their width, the only column that can give
// is the left-aligned one, and `2026-08-24` collapsed into a 206px-tall stack while the table still ran 231px off
// the screen. Splitting on the natural seam fixes it and reads better anyway, because delivery and engagement
// answer two different questions and nobody compares a bounce count against a click rate.
const DELIVERY_COLUMNS = ['Issue', 'Sent', 'Failed', 'Suppressed'];
const ENGAGEMENT_COLUMNS = ['Issue', 'Opens', 'Open %', 'Clicks', 'Click %'];

/**
 * The html body. A REAL table, not the whitespace-aligned block the plain-text body still carries: that block
 * only lines up in a monospace font, and an email client renders it in a proportional one, where the columns
 * collapse into each other and the report becomes unreadable. The numeric columns are right-aligned, which is
 * the shared layout's default for every column after the first, so no `align` override is needed here.
 *
 * This changes PRESENTATION only. Every number comes from the same rows and the same rollup as the text body,
 * and nothing on this path computes a rate.
 */
function statsHtml(ordered, roll, weeks) {
  const sections = [];

  if (ordered.length) {
    const stamp = (r) => issueDateStamp(r.issueId) || r.issueId;
    sections.push({ kind: 'paragraph', text: 'Delivery' });
    sections.push({
      kind: 'table',
      columns: DELIVERY_COLUMNS,
      rows: ordered.map((r) => [stamp(r), r.sent, r.failed, r.suppressed]),
    });
    sections.push({ kind: 'paragraph', text: 'Engagement' });
    sections.push({
      kind: 'table',
      columns: ENGAGEMENT_COLUMNS,
      rows: ordered.map((r) => [stamp(r), r.opens, pct(r.openRate), r.clicks, pct(r.ctr)]),
    });
  } else {
    sections.push({ kind: 'paragraph', text: 'No issues in the window.' });
  }

  // The rollup as label/value pairs rather than a second table: it is one issue-less summary, so a reader scans
  // it across, not down. Failed and suppressed are included because the per-issue table shows both, and a rollup
  // that omitted them would leave the owner adding two columns by hand.
  sections.push({
    kind: 'fields',
    rows: [
      ['Sent', String(roll.sent)],
      ['Opens', `${roll.opens} (${pct(roll.openRate)})`],
      ['Clicks', `${roll.clicks} (${pct(roll.ctr)})`],
      ['Failed', String(roll.failed)],
      ['Suppressed', String(roll.suppressed)],
    ],
  });

  sections.push({ kind: 'note', text: OPENS_NOTE });
  sections.push({ kind: 'note', text: CLICKS_NOTE });

  return opsEmail({
    title: 'Weekly digest performance',
    lead: `The last ${ordered.length} issue(s), against a target window of ${weeks} weeks.`,
    sections,
    footer: WHERE_NOTE,
  }).html;
}

/**
 * The owner-facing performance email. Pure projection of the stats rows.
 * @param rows  issueRow[] (any order; sorted newest-first here).
 * @returns `{ subject, text, html }`
 *
 * BOTH bodies are returned and BOTH must be sent. The plain-text body is the fallback for a client that refuses
 * html, and the html body is what the owner actually reads. The caller
 * (workers/signup/mail-stats-report.mjs) passes both to sendEmail; dropping either one there is the failure this
 * split is most exposed to, so a test at that call site asserts on the message that reaches the sender.
 */
export function composeStatsReport(rows, { weeks = 4 } = {}) {
  const ordered = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => (a.issueId < b.issueId ? 1 : -1));
  const latest = ordered[0] || null;
  const roll = rollup(ordered);

  const subject = latest
    ? `GBTI digest stats: ${latest.sent} sent, ${pct(latest.openRate)} open (${issueDateStamp(latest.issueId) || latest.issueId})`
    : 'GBTI digest stats: no issues yet';

  const lines = [];
  lines.push(`Weekly digest performance, last ${ordered.length} issue(s) (target ${weeks} weeks).`);
  lines.push('');
  lines.push(OPENS_CAVEAT);
  lines.push('');
  lines.push('issue        sent   opens  open%    clicks  click%   failed  suppr');
  for (const r of ordered) {
    lines.push([
      (issueDateStamp(r.issueId) || r.issueId).padEnd(12),
      String(r.sent).padEnd(6),
      String(r.opens).padEnd(6),
      pct(r.openRate).padEnd(8),
      String(r.clicks).padEnd(7),
      pct(r.ctr).padEnd(8),
      String(r.failed).padEnd(7),
      String(r.suppressed),
    ].join(' '));
  }
  if (!ordered.length) lines.push('(no issues in the window)');
  lines.push('');
  lines.push(`Rollup: ${roll.sent} sent, ${roll.opens} opens (${pct(roll.openRate)}), ${roll.clicks} clicks (${pct(roll.ctr)}).`);
  lines.push('');
  lines.push(WHERE_NOTE);
  return { subject, text: lines.join('\n'), html: statsHtml(ordered, roll, weeks) };
}
