// SOW-166: the PURE core of the weekly compile. It maps the public build-artifact entries (activity-index +
// shares-index, fetched over HTTP by the Worker orchestrator) into composeIssue's member-item input shape, and
// derives the stable weekly issue id. No IO and no clock beyond an injected `nowMs`, so it is fully unit-tested.
//
// THE LOAD-BEARING PROPERTY (PublicationMaster): VISIBILITY SURVIVES THE MAPPING. composeIssue's leak guard is
// `visibility === 'public'`, fail closed, so this normalizer must copy `visibility` VERBATIM. Dropping it (or
// defaulting it) would either leak a member item into a public email or, worse, silently drop every item to
// undefined and empty a whole section with no error. This module NEVER decides public-vs-member; it preserves
// the field and lets composeIssue's single guard decide. That keeps ONE leak guard, not two that can disagree.
//
// It carries NO body or ciphertext: it copies kind/title/url/author/authorName/date/visibility only, so there
// is no field here that could move gated content into the compiled issue.

// activity-index.json uses `type` (post/product/prompt); shares-index.json uses `type: 'share'`. composeIssue
// groups on `kind` (article/product/prompt/share). An unknown type maps to null and the entry is dropped (it
// would land in no section). `post -> article` because the blog's public kind is "article".
const TYPE_TO_KIND = { post: 'article', product: 'product', prompt: 'prompt', share: 'share' };

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const numOrNull = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Normalize ONE build-artifact entry into a composeIssue member item, or null if its type has no section.
 * `displayName(handle)` is an optional resolver (members-index, supplied by the orchestrator) so the byline
 * reads "Hudson Atwell" not "atwellpub"; absent, authorName is null and the renderer falls back to the handle.
 */
export function normalizeContentEntry(entry, { displayName } = {}) {
  if (!entry) return null;
  const kind = TYPE_TO_KIND[str(entry.type)];
  if (!kind) return null;
  const author = str(entry.author).trim();
  return {
    kind,
    title: str(entry.title).trim(),
    url: str(entry.url).trim(),
    author,
    authorName: typeof displayName === 'function' ? (displayName(author) || null) : null,
    // activity-index/shares-index carry `publishedAt` (shares: derived from createdAt); a missing date is 0,
    // which composeIssue sorts to the bottom, never a crash.
    date: numOrNull(entry.publishedAt) ?? 0,
    // VERBATIM. See the header note: this is the field composeIssue's fail-closed guard reads.
    visibility: entry.visibility,
  };
}

/** Normalize a list of activity-index + shares-index entries; unknown types are dropped. */
export function normalizeContent(entries, opts = {}) {
  return (Array.isArray(entries) ? entries : [])
    .map((e) => normalizeContentEntry(e, opts))
    .filter(Boolean);
}

/**
 * Normalize ONE news gather entry into composeIssue's news input { title, url, source?, opens?, date? }. An
 * entry missing a title or url is dropped (unrenderable). `opens` is the SOW-111 distinct-opener count (already
 * wired). The per-guid DISCUSSION count (`comments`) is a LATER gather increment and is intentionally NOT
 * fabricated here: emitting a constant 0 would be a field that always says "no discussion", which is the
 * guards-passing-on-zero trap; it arrives only when a real read populates it.
 */
export function normalizeNewsEntry(entry) {
  if (!entry) return null;
  const title = str(entry.title).trim();
  const url = str(entry.url).trim();
  if (!title || !url) return null;
  return {
    title,
    url,
    source: str(entry.source).trim() || null,
    opens: numOrNull(entry.opens) ?? 0,
    date: numOrNull(entry.date) ?? 0,
  };
}

/** Normalize a list of news gather entries; entries without a title or url are dropped. */
export function normalizeNews(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map(normalizeNewsEntry)
    .filter(Boolean);
}

/**
 * The stable weekly issue id, `weekly-YYYY-MM-DD` from the compile time in UTC. The weekly cron fires once, so
 * the date is deterministic per issue, and a re-run of the same day's compile yields the SAME id, which is what
 * makes enqueueIssue idempotent (compile once, Q12). Throws on a non-finite time rather than minting a
 * `weekly-NaN` id that would silently fork the issue.
 */
export function weeklyIssueId(nowMs) {
  const n = Number(nowMs);
  if (!Number.isFinite(n)) throw new Error('weeklyIssueId: nowMs must be a finite timestamp');
  const d = new Date(n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `weekly-${y}-${m}-${day}`;
}
