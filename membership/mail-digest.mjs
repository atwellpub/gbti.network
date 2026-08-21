// SOW-166: the PURE digest composition core for the weekly newsletter. No IO, no Date.now() inside (callers
// inject `now`), so it is fully unit-tested with fakes. The Worker's weekly compile cron gathers the inputs
// (the public activity build-artifact over HTTP, plus the SOW-111 news-open counts from KV), normalizes them
// to the item shapes below, and calls composeIssue ONCE to freeze one issue (`mail:issue:<issueId>`); every
// recipient's email then renders from that single frozen object, so the newsletter has a stable archive and a
// stable permalink (Q12: compile once).
//
// THE LEAK GUARD IS STRUCTURAL, not a filter a caller can forget. Two layers:
//   1. Any member item is EXCLUDED: an item is kept only if visibility === 'public'. Missing/other -> dropped
//      (fail closed), matching src/lib/home-feed.mjs isPublicShare and the activity-index Mode B stubs.
//   2. Even a public item is copied field-by-field into a PUBLIC-SAFE projection (kind/title/url/author/
//      authorName/date only). There is deliberately no body/encryptedBody field, so a caller that wrongly
//      passes a member body cannot leak it into a compiled issue (the leak-guard test asserts this).
//
// THE WINDOW IS PART OF THE SECTION CONTRACT, not an optimization. `since` drops member items older than the
// previous issue, and WITHOUT it the whole contract is silently hollow: the input artifacts are the site's
// entire published history (activity-index.json filters on isListed only and caps at 40 PER TYPE;
// shares-index filters on isPublicShare only), so an unwindowed compile emits the newest 5 of each type ever
// published, and emits the SAME 5 again next week. Every empty-section note below then becomes unreachable
// code, because a section on a site with five published articles is never empty again, and `maxNewsThin`
// dies with it (it triggers on memberItemCount === 0). The owner's empty-section ruling presupposes a window:
// a note renders "because a visible gap is an invitation to fill it", and there is no gap without a window.
//
// Item shape IN (the Worker normalizes activity-index entries + public shares to this):
//   { kind: 'article'|'product'|'prompt'|'share', title, url, author, authorName?, date: number,
//     visibility: 'public'|'members', ... (any extra fields are dropped by the projection) }
// News shape IN (the Worker attaches the distinct-opener count):
//   { title, url, source?, opens?: number, date?: number }

export const SECTION_KINDS = ['article', 'product', 'prompt', 'share'];

// THE SECTION CONTRACT (owner ruling, sow-166, 2026-08-21). An issue ALWAYS carries every section. A
// section with nothing in it is not dropped: it is rendered with a note saying no new member items were
// published in that category, because a visible gap is an invitation to fill it and a missing section is
// not. The owner chose this over skipping silently, which was the other recommendation on the table.
//
// ORDER is "the types that have content first, news especially". SECTION_ORDER is the canonical priority,
// and `layout` splits on it: filled sections in that order, then empty sections in that SAME order. So the
// relative order never changes week to week (a reader learns where Prompts sits), and the only thing that
// moves is the line between what was published and what was not.
export const SECTION_ORDER = ['news', 'article', 'product', 'prompt', 'share'];

export const SECTION_LABELS = {
  news: 'News',
  article: 'Articles',
  product: 'Products',
  prompt: 'Prompts',
  share: 'Shares',
};

// The empty-section notes. This copy is member-facing and it lives HERE rather than in the template,
// because the template is design-gated (it swaps in behind the injected renderIssue seam) and the words a
// member reads should not move when the visual design does.
//
// Each note is worded differently on purpose. On a genuinely thin week a reader sees four of these at once,
// and four sentences built to the same pattern read as generated filler, which is the opposite of an
// invitation.
//
// THEY SAY "SINCE THE LAST ISSUE", NOT "THIS WEEK", and that is not a style preference. The issue is
// compiled once and frozen, then the send SMOOTHS across a rate budget, so the last recipient may open the
// same frozen issue days after the first. "This week" is true for whoever reads it on Tuesday morning and
// drifts for everyone behind them in the queue. "Since the last issue" is anchored to the cadence rather
// than to the reading date, so it stays true across the whole spread.
//
// Plain sentences, no markdown. The renderer is a table-based HTML email, and a stray asterisk or bracket
// would reach the reader as an asterisk or bracket. A test enforces it.
export const EMPTY_SECTION_NOTES = {
  news: 'No news items have been added since the last issue.',
  article:
    'No new articles have been published since the last issue. The blog runs on what members write, so a draft you have been sitting on would land well here.',
  product:
    'No new products since the last issue. If you have shipped something recently, adding it to the directory takes a few minutes.',
  prompt:
    'No new prompts since the last issue. If you have one you reach for often, it will probably work for somebody else too.',
  share:
    'No shares since the last issue. A share is the cheapest thing to post here: a link and a sentence about why it is worth reading.',
};

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class DigestError extends Error {}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s === '' ? null : s;
};
const numOr0 = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** The KV key for a frozen issue. */
export function issueKey(issueId) {
  const id = trimOrNull(issueId);
  if (!id) throw new DigestError('issueId is required');
  return `mail:issue:${id}`;
}

/** Is an item public? Fail closed: only an explicit visibility:'public' qualifies (missing/other excluded). */
export function isPublicItem(it) {
  return Boolean(it) && it.visibility === 'public';
}

/** The public-safe projection of a member item. Copies ONLY public metadata; there is no field that could
 *  carry a body or ciphertext, so this is structurally incapable of leaking member content. */
function publicItem(it) {
  return {
    kind: str(it.kind),
    title: trimOrNull(it.title),
    url: trimOrNull(it.url),
    author: trimOrNull(it.author),
    authorName: trimOrNull(it.authorName),
    date: numOr0(it.date),
  };
}

/** The public-safe projection of a news item (top-performing by distinct-opener count). */
function newsItem(it) {
  return {
    title: trimOrNull(it.title),
    url: trimOrNull(it.url),
    source: trimOrNull(it.source),
    opens: numOr0(it.opens),
    date: numOr0(it.date),
  };
}

const byDateDesc = (a, b) => (b.date - a.date);

/**
 * Compose ONE frozen weekly issue. PURE. Enforces the public-only leak guard, groups the surviving member
 * items into the four sections (each newest-first, capped at `perSection`), and ranks the news by
 * distinct-opener count (`opens`, then newest) capped at `maxNews`.
 *
 * Empty-week policy (owner ruling 2026-08-21): the issue ALWAYS carries every section, and an empty one
 * gets its note instead of being dropped. `layout` is the render-ready ordering, filled sections first.
 *
 * `isEmpty` still means "nothing public at all, member or news", and `hasContent` still reports it, but it
 * is no longer a send gate: the owner ruled literal always-send on 2026-08-21 and `shouldSend` is the gate.
 * The flag stays because the template and the logs still want to know.
 *
 * `since` is the member-content window: items older than it are dropped before grouping (see the header note,
 * where the reason it is load-bearing lives). Absent means no window, which is what every caller written before
 * this option got, and it is never the right thing for the weekly compile.
 *
 * `maxNewsThin` OPTIONALLY lifts the news cap on a week with NO member content, so a news-led issue is a
 * real issue rather than a stub. It applies only when every member section is empty, it can only raise the
 * cap and never lower it, and it defaults to no lift, so an explicit maxNews is always a real ceiling. The
 * compile cron is where to set it; 8 is the suggested value.
 *
 * @returns { issueId, generatedAt, sections, topNews, layout, counts, isEmpty, window }
 */
export function composeIssue(
  { issueId, items = [], news = [], now = Date.now } = {},
  { perSection = 5, maxNews = 5, maxNewsThin, since } = {},
) {
  const id = trimOrNull(issueId);
  if (!id) throw new DigestError('issueId is required');
  const cap = Math.max(0, Math.floor(Number(perSection)) || 0);
  const newsCap = Math.max(0, Math.floor(Number(maxNews)) || 0);
  // The thin-week news cap is OPT IN and defaults to no lift at all. An earlier draft defaulted it to 8 and
  // a caller passing maxNews: 3 got 4 items back: a parameter named "max" that a default can exceed is a
  // trap, and the existing cap test caught it. Unset means maxNews, so nothing ever overrides an explicit
  // ceiling; set it and it can only ever raise, never lower.
  const thinCap =
    maxNewsThin == null ? newsCap : Math.max(newsCap, Math.max(0, Math.floor(Number(maxNewsThin)) || 0));
  // The member-content window. Only a finite number applies; absent, null or unparseable means NO window, which
  // preserves the behaviour of every caller written before this option existed. The boundary is INCLUSIVE
  // (date >= since) so an item published at the exact instant of the previous compile lands in exactly one
  // issue: this one. Excluding it would drop it forever, since next week's window starts later still.
  const sinceMs = Number.isFinite(Number(since)) && since != null ? Number(since) : null;

  // Layer 1: drop every non-public item. Layer 2: project each survivor to public-safe fields only.
  const publicItems = (Array.isArray(items) ? items : [])
    .filter(isPublicItem)
    .map(publicItem)
    .filter((it) => it.title && it.url) // an item with no title or link is not renderable
    // Windowed AFTER the projection, so it reads the already-normalized numeric `date` rather than whatever
    // shape the caller passed. An undated item has date 0 and therefore never survives a window, which is the
    // right way round: an item with no publication date cannot be shown to be new.
    .filter((it) => sinceMs === null || it.date >= sinceMs);

  const sections = { article: [], product: [], prompt: [], share: [] };
  for (const it of publicItems) {
    if (Object.prototype.hasOwnProperty.call(sections, it.kind)) sections[it.kind].push(it);
  }
  for (const k of SECTION_KINDS) {
    sections[k] = sections[k].sort(byDateDesc).slice(0, cap);
  }

  // The member total decides the news cap, so rank first and slice after (slicing to the small cap and then
  // trying to widen it would have already thrown away the extra items).
  const rankedNews = (Array.isArray(news) ? news : [])
    .map(newsItem)
    .filter((it) => it.title && it.url)
    .sort((a, b) => (b.opens - a.opens) || (b.date - a.date));

  const memberItemCount = SECTION_KINDS.reduce((n, k) => n + sections[k].length, 0);
  const topNews = rankedNews.slice(0, memberItemCount === 0 ? thinCap : newsCap);

  const counts = {
    article: sections.article.length,
    product: sections.product.length,
    prompt: sections.prompt.length,
    share: sections.share.length,
    news: topNews.length,
  };
  const isEmpty = memberItemCount === 0 && counts.news === 0;

  return {
    issueId: id,
    generatedAt: Number(now()),
    sections,
    topNews,
    layout: buildLayout(sections, topNews),
    counts,
    isEmpty,
    // The frozen issue records its OWN window, so a compile that forgot to pass one is visible in the stored
    // artifact instead of invisible. `null` here means the issue is a best-of rather than a what-is-new, and
    // that is a bug in the caller every time. News is deliberately not windowed: it is ranked by distinct
    // openers rather than recency, and the gather already returns a bounded recent set, so a story that
    // ingested nine days ago and was opened all week is exactly what belongs at the top.
    window: { since: sinceMs, appliesTo: 'members' },
  };
}

/**
 * The render-ready section ordering. Every section in SECTION_ORDER appears exactly once: the ones with
 * items first (in canonical order), then the empty ones (in that same canonical order) carrying their note.
 * PURE, and it reads only the already-projected public-safe items, so it cannot widen the leak guard.
 */
function buildLayout(sections, topNews) {
  const itemsFor = (key) => (key === 'news' ? topNews : sections[key] ?? []);
  const entry = (key) => {
    const items = itemsFor(key);
    const empty = items.length === 0;
    return {
      key,
      label: SECTION_LABELS[key] ?? key,
      items,
      empty,
      note: empty ? EMPTY_SECTION_NOTES[key] ?? null : null,
    };
  };
  const all = SECTION_ORDER.map(entry);
  return [...all.filter((s) => !s.empty), ...all.filter((s) => s.empty)];
}

/**
 * Does this issue actually have anything in it? PURELY FACTUAL, and deliberately NOT the send gate: see
 * shouldSend below. Kept honest because a subject line, a log line and a quiet-week template variant all
 * want to know the difference, and a predicate that answers "yes" for an empty issue would mislead every
 * one of them.
 */
export function hasContent(issue) {
  return Boolean(issue) && !issue.isEmpty;
}

/**
 * THE SEND GATE. Always true.
 *
 * Owner ruling, sow-166, 2026-08-21: literal always-send. The digest goes out on its Tuesday cadence
 * regardless of what a given week produced, and a thin week shows the sections with their notes rather than
 * being skipped. Both @SowMaster and I recommended keeping a floor that skipped a fully-empty issue, and the
 * owner overruled it on the ground that it is not a reachable state: the news worker ingests daily, so every
 * issue carries news by construction. Recorded because the reasoning is what makes the "always" safe, and if
 * news ingest ever stops being daily this decision is worth revisiting rather than inheriting.
 *
 * It takes the issue it ignores on purpose. The gate is a policy decision that currently has one answer, and
 * a caller reading `shouldSend(issue)` can see where the policy lives; a bare `true` at the call site could
 * not be found again.
 */
// eslint-disable-next-line no-unused-vars
export function shouldSend(issue) {
  return true;
}
