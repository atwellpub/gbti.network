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
    // The item's PUBLIC FRONTMATTER description, straight off the build artifact (`description`, emitted from
    // post.excerpt / product.shortDescription / prompt.shortDescription / share.shortDescription). ABSENT
    // MEANS ABSENT: an entry with no description yields null and the renderer emits a bare row. There is no
    // second source and there must never be one, because the only other text an item has is its body. See
    // publicItem in mail-digest.mjs for why that rule is the security control rather than the field name.
    blurb: str(entry.description).trim() || null,
    // Already public on every activity-index entry since SOW-039 (verified live: 76 of 76 populated).
    thumb: str(entry.thumb).trim() || null,
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
/**
 * A news item's one-line blurb, from feed text that is NOT clean: `summary` is up to 500 characters and
 * routinely carries markup, entities and a trailing "Read more" tail. Strips tags, unescapes the handful of
 * entities that survive that strip, collapses whitespace, then truncates at a WORD boundary so a row never
 * ends mid-word. Returns null for anything that reduces to nothing, so an unusable summary renders no blurb
 * rather than an empty box.
 *
 * Tag stripping here is for LEGIBILITY, not safety. The renderer escapes every value it writes, so a tag that
 * survived would render as visible text, never as markup. Order matters anyway: strip first, unescape second,
 * so an escaped `&lt;script&gt;` in the feed cannot be unescaped into something the stripper already ran past.
 */
export function newsBlurb(raw, { max = 160 } = {}) {
  let t = str(raw).replace(/<[^>]*>/g, ' ');
  // WordPress appends "The post <title> appeared first on <site>." to every feed excerpt, and it is the tail
  // of the SOURCE text, so it has to go before truncation or it simply gets cut mid-phrase instead: a real
  // delivered row read "...for mroe efficient compute The post Samsung Evolving...". Anchored on BOTH halves
  // of the pattern, so a sentence that merely begins "The post" is untouched.
  t = t.replace(/\s*The post\b[\s\S]*?appeared first on[\s\S]*$/i, '');
  t = t.replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (_m, e) => (
    { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'" }[e] ?? ' '
  ));
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return null;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,;:!?-]+$/, '')}...`;
}

/**
 * A source's BRAND name, from the name in the sources config. That config field is the feed's own <title>, and
 * an RSS title is a strap line rather than a brand: "Engadget - Technology News & Expert Reviews", "CoinDesk:
 * Bitcoin, Ethereum, Crypto News and Price Data". Rendered under a headline in a 480px column the second one
 * wraps onto two lines and reads as part of the article. So cut at the first strap-line separator and keep the
 * head, which is the brand in every RSS title shaped this way.
 *
 * TWO GUARDS, because this is a heuristic on other people's text. The head must be at least 3 characters, so a
 * name that merely STARTS with a separator is left alone rather than reduced to nothing; and whatever survives
 * is capped at 40 characters on a word boundary, so a source with no separator at all still cannot run away.
 * Both directions fail toward showing more of the real name, never toward showing nothing.
 */
export function sourceDisplayName(raw) {
  const full = str(raw).replace(/\s+/g, ' ').trim();
  if (!full) return null;
  const m = full.match(/^(.*?)(?:\s+[-–—|]\s+|:\s+)/);
  const head = m && m[1].trim().length >= 3 ? m[1].trim() : full;
  if (head.length <= 40) return head;
  const cut = head.slice(0, 40);
  const sp = cut.lastIndexOf(' ');
  return (sp > 20 ? cut.slice(0, sp) : cut).trim();
}

export function normalizeNewsEntry(entry) {
  if (!entry) return null;
  const title = str(entry.title).trim();
  const url = str(entry.url).trim();
  if (!title || !url) return null;
  return {
    title,
    url,
    source: str(entry.source).trim() || null,
    // The display name the gather resolved from the sources config, e.g. "The Verge" for the id
    // `object-object`. Null when the id is not in the list; the renderer then falls back to the id.
    sourceName: sourceDisplayName(entry.sourceName),
    // PREFER `digest`, the AI-generated one-to-two sentence summary (SOW-046), over the feed's own `summary`.
    // The digest is written to be read on its own; the summary is whatever the publisher put in the RSS,
    // which is often a truncated first paragraph with markup in it. Absent both, no blurb.
    blurb: newsBlurb(entry.digest) || newsBlurb(entry.summary),
    // The source article's image (RSS enclosure/media, or the og:image the 30-past-the-hour backfill scrapes).
    thumb: str(entry.image).trim() || null,
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
  return `weekly-${utcDateStamp(nowMs, 'weeklyIssueId')}`;
}

/** `YYYY-MM-DD` in UTC, shared by every issue-id minter so the shapes cannot drift apart. */
function utcDateStamp(nowMs, who) {
  const n = Number(nowMs);
  if (!Number.isFinite(n)) throw new Error(`${who}: nowMs must be a finite timestamp`);
  const d = new Date(n);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * sow-166: the id of the standing WELCOME issue, `welcome-YYYY-MM-DD`.
 *
 * A welcome issue is the 90-day back catalogue that every subscriber receives as their FIRST email, whenever
 * they join. It is recompiled each cycle so it is never more than a week stale.
 *
 * THE `welcome-` PREFIX IS LOAD-BEARING, and this is the whole reason the feature is safe. listPriorIssueIds
 * (workers/signup/mail-compile.mjs) counts only ids starting with `weekly-`, so a welcome issue:
 *   - never becomes a "prior issue", so it cannot advance the epoch floor;
 *   - never contributes its 90 days of urls to the exclude set, which would otherwise gut the next weekly by
 *     marking a quarter of the catalogue as already mailed.
 * Do not rename this prefix to anything beginning with "weekly", and do not relax that filter. A test pins it.
 */
export function welcomeIssueId(nowMs) {
  return `welcome-${utcDateStamp(nowMs, 'welcomeIssueId')}`;
}

/**
 * sow-166: has this subscriber already been sent their welcome issue?
 *
 * Null, absent, zero and any non-finite value all read as NOT welcomed, which is the fail-safe direction: the
 * worst case is one extra welcome, while the opposite error silently denies somebody the only 90-day view
 * they will ever be offered.
 */
/** Is this the id of a welcome issue? Pure, so the drain can ask without importing the compiler. */
export function isWelcomeIssueId(issueId) {
  return typeof issueId === 'string' && issueId.startsWith('welcome-');
}

export function isWelcomed(sub) {
  const w = Number(sub?.welcomedAt);
  return Number.isFinite(w) && w > 0;
}

/**
 * sow-166: should this subscriber receive the WEEKLY issue being compiled?
 *
 * Two exclusions, and they are different things:
 *
 *   1. Never welcomed. The welcome sweep owns them; putting them in a weekly would make a thin "this week"
 *      email somebody's introduction to the network, which is exactly what this feature exists to prevent.
 *   2. Welcomed during THIS cycle. `previousGeneratedAt` is the newest prior weekly, so it is the moment the
 *      current cycle began. Somebody welcomed at or after it has already had their email for this cycle, and
 *      sending the weekly too would put two overlapping issues in their inbox days apart. They join the normal
 *      cadence at the next one (owner ruling, 2026-08-23).
 *
 * With no prior weekly there is no cycle to double up with, so a welcomed subscriber is eligible.
 */
export function weeklyEligible(sub, previousGeneratedAt) {
  if (!isWelcomed(sub)) return false;
  // `Number(null)` is 0, not NaN, so a bare Number.isFinite check would treat "no prior weekly" as a floor of
  // zero and exclude everybody. Require a positive timestamp before it can gate anything.
  const prev = Number(previousGeneratedAt);
  if (!Number.isFinite(prev) || prev <= 0) return true;
  return Number(sub.welcomedAt) < prev;
}
