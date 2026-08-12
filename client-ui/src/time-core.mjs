// The canonical "time ago" for client-ui, plus the absolute stamp that accompanies it in a tooltip.
//
// sow-221: three near-identical relTime copies already existed (gbti-card-list exported one, gbti-discussion
// and gbti-shares-feed each kept a private one). Adding a fourth for the pull request rows would have been the
// same mistake this codebase kept paying for elsewhere, so the definition moved HERE and gbti-card-list now
// re-exports it, which keeps its existing importers and tests working unchanged. The two private copies are
// left alone deliberately: consolidating them touches the comment thread and the shares feed, which is a
// bigger change than this feature justifies, and test/workspace-pr-events.test.mjs pins their agreement so a
// future divergence surfaces instead of hiding.
//
// Elapsed-since is inherently in the viewer's OS clock and timezone (Date.now() is local epoch), so there is
// no timezone handling to do. Node-free and pure.

/** Relative age: "just now", "5 minutes ago", "3 days ago". Empty string for a missing or unparseable value. */
export function relTime(v, now = Date.now()) {
  if (!v) return '';
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!ms) return '';
  const diff = now - ms;
  if (diff < 60000) return 'just now'; // < 1 min (also covers small clock skew / future stamps)
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hrs = Math.floor(diff / 3600000);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const d = Math.floor(diff / 86400000);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;
  return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? '' : 's'} ago`;
}

/**
 * The absolute stamp for a title tooltip, so "3 months ago" is still answerable without leaving the page.
 * Locale-formatted in the viewer's own timezone, which is the only timezone they can reason about. Empty
 * string for a missing or unparseable value, so a caller can drop the attribute entirely.
 */
export function absTime(v) {
  if (!v) return '';
  const ms = typeof v === 'number' ? v : Date.parse(v);
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return new Date(ms).toISOString();
  }
}
