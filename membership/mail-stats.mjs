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

/**
 * The owner-facing performance email. Pure projection of the stats rows.
 * @param rows  issueRow[] (any order; sorted newest-first here).
 * @returns `{ subject, text }`
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
  lines.push('Opens are APPROXIMATE (image proxies inflate, blockers deflate). Clicks are TOTAL, not unique.');
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
  lines.push('Per-link and per-placement clicks are in mail:clicks:<issueId>. Notes: .data/ops/mail-ops/.');
  return { subject, text: lines.join('\n') };
}
