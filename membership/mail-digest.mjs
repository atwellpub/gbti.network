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
//      authorName/date, plus blurb/thumb since 2026-08-23). There is deliberately no body/encryptedBody
//      field, so a caller that wrongly passes a member body cannot leak it into a compiled issue (the
//      leak-guard test asserts this). `blurb` is public frontmatter ONLY and has NO body fallback; see the
//      note on publicItem for why the rule, rather than the field name, is the control.
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
// `since` AND `exclude` ARE TWO REGIMES, NOT TWO FILTERS TO STACK. `since` windows on publishedAt, which is
// only a PROXY for "new to the reader": publishedAt is stamped in the client when the PR is OPENED
// (client/src/operations.mjs), while the item reaches activity-index.json only after merge plus deploy. An item
// whose publishedAt predates the last compile but which first became visible AFTER it is dropped by `since` and
// never mailed at all: a held contribution PR, or a deliberately backdated date. `exclude` is the real semantic,
// the set of urls already mailed, and it cannot lose an item that way.
//
// CORRECTED 2026-08-21, same day, and the first version of this note caused a live defect. It said to pass ONE
// of them per issue and never both, and the orchestrator implemented exactly that: `since = null` from issue two
// onward. With no floor the pool is the WHOLE artifact, so issue two mails the pre-newsletter back catalogue as
// if it were this week's news, ordered newest-unmailed-first so it walks backwards in time week by week, and the
// empty-section notes are unreachable again for as long as the archive takes to drain. That is the same
// hollowing-out the window was added to fix, arrived at from the other side.
//
// THEY ARE A FILTER AND A FLOOR, AND THE FLOOR IS NOT OPTIONAL:
//   FIRST ISSUE   since = now - 7d,             exclude = null          bounds the launch issue
//   THEREAFTER    since = the newsletter EPOCH, exclude = mailed urls   everything unmailed since it began
//
// The epoch is the first issue's own `window.since`, already recorded on that frozen issue, so it needs no new
// constant and nothing to tune. It means the newsletter covers its own lifetime and never its pre-history: an
// item published before the newsletter existed is never mailed, and an item published since is mailed exactly
// once however late it arrives. What re-opens the loss is stacking `exclude` with a TIGHT `since` (a per-issue
// window), not with a floor: a floor months in the past cannot cut off a contribution held for review for days.
//
// The one case the floor does exclude is an item published BEFORE the first issue and merged after it. That is a
// launch-boundary case, it happens once, and treating a newsletter's second issue as not carrying things from
// before it existed is the right reading of it rather than a loss.
//
// The frozen issue records both, so which regime produced it is readable rather than inferred.
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
// ORDER, and it REVERSED on 2026-08-23 after the owner read the first delivered issue. It was "the types
// that have content first, news especially", which put curated third-party links above everything the
// members wrote. The owner's ruling is that NEWS GOES LAST, and the member types run in the newsletter
// design handoff's own order (Articles, Prompts, Products, Shares). That is the design and the owner
// agreeing, where before they disagreed: `sow-166-assets/SOURCE.md` register item 1 recorded the conflict
// as unresolved precisely because nobody could tell whether the design predated the earlier ruling.
//
// `layout` splits on this order: filled sections in it, then empty sections collapsed into ONE trailing
// line. So the relative order never changes week to week (a reader learns where Prompts sits), News is last
// among everything visible, and the only thing that moves is the line between published and not.
export const SECTION_ORDER = ['article', 'prompt', 'product', 'share', 'news'];

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

// THE LAUNCH ISSUE says two things that are false on issue one, and both are only ever wrong once.
//
// The notes above are anchored to "since the last issue", which is exactly right from issue two onward and
// reads as a mistake to somebody opening their FIRST issue: there was no last one. And the first issue's
// window bootstraps to seven days rather than reaching back over everything published before it, so a reader
// who knows the network may wonder where an article from last month went.
//
// One sentence covers both. It states the issue is the first, which retires "the last issue", and states the
// span it covers, which explains the absence rather than leaving it to be noticed. The section notes swap the
// cadence clause for the span in the same breath, so nothing below the line contradicts the line.
//
// The swap is DERIVED rather than a second hand-written table, so the two sets cannot drift apart when the
// copy is edited. It is safe to derive because every note contains the phrase verbatim and a test upstream of
// this one already asserts that for all five; if that invariant ever breaks, the test breaks with it rather
// than the substitution silently doing nothing.
// sow-166: the WELCOME issue's own header copy.
//
// It lives here with the other member-facing strings, for the same reason they do: the template is
// design-gated and swaps in behind the renderIssue seam, and the words somebody reads should not move when
// the visual design does.
//
// It is passed through `ctx.greeting` and `ctx.headerLine`, which already existed with defaults and which
// NOTHING has ever set. That is deliberate reuse rather than a new branch in the template: a welcome issue
// differs from a weekly only in its window and its two header lines, so it should not need a second render
// path that can drift from the first.
//
export const WELCOME_GREETING = 'Welcome to the GBTI Network';
export const WELCOME_HEADER_LINE = 'Here is what members have been publishing lately.';

// The welcome's own note, replacing the newsletter's launch note.
//
// OWNER RULING, 2026-08-24: this is a THANK YOU, not an explanation of the window. It used to say "this is
// your first issue, so it covers the past 90 days", which was a mechanical fact about the compiler dressed as
// a greeting. The first thing a new subscriber reads should thank them for subscribing and for the work they
// do, not apologise in advance for the date range.
//
// The span is still stated where it earns its place: the preheader and the empty-section line both name the
// 90 days, so nothing is hidden, it just stops being the opening sentence.
//
// It has to remain a NOTE rather than fold into the header line, because the renderer derives `firstIssue`
// from the presence of a launch note (mail-render.mjs) and uses that to pick the empty-section wording and
// the preheader span. Suppressing the note would silently switch a 90-day welcome back to "since the last
// issue" and "this week", which are the two phrases that cannot be true for somebody's first email.
export const WELCOME_NOTE =
  "Thank you for subscribing to the weekly digest. Here's a quick look at what you might have missed over the past quarter.";

// CORRECTED 2026-08-23: this said "the past week" while the bootstrap window has been NINETY days since the
// owner widened it on 2026-08-22. The copy was written when the window really was a week and did not travel
// with the constant, so the launch issue that shipped told its readers it covered a week and then listed items
// from two months earlier. Both spans below are tied to BOOTSTRAP_MS in workers/signup/mail-compile.mjs; if
// that constant moves again, these two strings move with it.
export const FIRST_ISSUE_NOTE =
  'This is the first issue, so it covers the past 90 days rather than everything published before it.';

const LAST_ISSUE_PHRASE = 'since the last issue';
const FIRST_ISSUE_PHRASE = 'in the past 90 days';

export const FIRST_ISSUE_SECTION_NOTES = Object.fromEntries(
  Object.entries(EMPTY_SECTION_NOTES).map(([key, note]) => [key, note.replace(LAST_ISSUE_PHRASE, FIRST_ISSUE_PHRASE)]),
);

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
    // TWO NAMES ADDED 2026-08-23, AND THE GUARD IS NOT WIDENED BEYOND THEM.
    //
    // `blurb` is the item's PUBLIC FRONTMATTER description and nothing else: post.excerpt,
    // product.shortDescription, prompt.shortDescription, share.shortDescription. It is author-written, length
    // capped by the content schema, and already served in the HTML of every item page. It is NOT derived from
    // a body, and there is deliberately no fallback that could reach one.
    //
    // THE FIELD NAME IS NOT THE CONTROL. post.excerpt is OPTIONAL (src/content.config.ts:126), so the day an
    // article lands without one, the obvious repair is to fall back to the body, and that fallback would leak
    // a member body into an email the moment a Mode B stub slipped past layer one. The control is the rule
    // that a MISSING blurb renders NO blurb, pinned by a test where an item carries a body and no excerpt and
    // the row comes out bare. Read that test before touching this.
    blurb: trimOrNull(it.blurb),
    // `thumb` is a URL, not content, and it is already public: activity-index.json has shipped it on every
    // entry since SOW-039. The renderer fails an unsafe value closed to no image (safeUrl).
    thumb: trimOrNull(it.thumb),
  };
}


/** The public-safe projection of a news item (top-performing by distinct-opener count). */
function newsItem(it) {
  return {
    title: trimOrNull(it.title),
    url: trimOrNull(it.url),
    source: trimOrNull(it.source),
    // The source's DISPLAY name, resolved from the sources config at gather time. `source` stays the id
    // because it is the stored key (the store's per-source counts are keyed on it); this is the one a reader
    // sees. The renderer falls back to `source` when no name resolves, so an unlisted source still renders.
    sourceName: trimOrNull(it.sourceName),
    // News blurbs and images come from the feed itself, not from anything member-authored, so they cross no
    // membership boundary. They are projected here rather than passed through so a news gather cannot smuggle
    // an unexpected field into a frozen issue either.
    blurb: trimOrNull(it.blurb),
    thumb: trimOrNull(it.thumb),
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
 * `firstIssue` swaps the empty-section notes for their launch wording and attaches `launchNote`. Only ever
 * true once, and the caller already knows it: it is the same condition that made `resolveSince` bootstrap.
 *
 * `exclude` is the set of urls already mailed, and it is the semantic `since` only approximates. From issue two
 * onward pass BOTH: `exclude` is the filter and `since` is the newsletter's epoch floor. `exclude` alone mails
 * the pre-newsletter back catalogue; a PER-ISSUE `since` alongside it re-opens the loss `exclude` closes. See
 * the header note, which said the wrong thing first and explains why.
 *
 * `maxNewsThin` OPTIONALLY lifts the news cap on a week with NO member content, so a news-led issue is a
 * real issue rather than a stub. It applies only when every member section is empty, it can only raise the
 * cap and never lower it, and it defaults to no lift, so an explicit maxNews is always a real ceiling. The
 * compile cron is where to set it; 8 is the suggested value.
 *
 * @returns { issueId, generatedAt, sections, topNews, layout, counts, isEmpty, window, launchNote }
 */
export function composeIssue(
  { issueId, items = [], news = [], now = Date.now } = {},
  { perSection = 5, maxNews = 5, maxNewsThin, since, exclude, firstIssue = false, launchNote } = {},
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
  // Resolved ONCE, up front, because the projection clamps item dates against it and the returned issue reports
  // it. Reading the injected clock twice could hand the two different values.
  const generatedAt = Number(now());
  // The already-mailed set. Accepts a Set or any iterable of urls; anything else (including a bare object, a
  // string, or nothing) means NO exclusion. `null` is kept distinct from an EMPTY set on purpose: an empty set
  // is a real answer on the first issue, and a caller that forgot to pass one is not, so the two must not look
  // alike in the frozen issue. Bounding the set is the CALLER's job and it is safe to bound: the artifacts cap
  // at 40 per type, so a url that has aged out of them can never reappear and never needs remembering.
  const excluded = (() => {
    if (exclude == null) return null;
    if (exclude instanceof Set) return new Set([...exclude].map((u) => str(u).trim()).filter(Boolean));
    if (typeof exclude?.[Symbol.iterator] === 'function' && typeof exclude !== 'string') {
      return new Set([...exclude].map((u) => str(u).trim()).filter(Boolean));
    }
    return null;
  })();

  // Layer 1: drop every non-public item. Layer 2: project each survivor to public-safe fields only.
  const publicItems = (Array.isArray(items) ? items : [])
    .filter(isPublicItem)
    .map(publicItem)
    .filter((it) => it.title && it.url) // an item with no title or link is not renderable
    // NOT YET DUE. A publishedAt in the FUTURE is reachable (`isListed` is a visibility check with no date
    // test; validate-content has no date logic at all), and an item dated ahead of the compile must not be
    // mailed at all, which is both the right product answer and what the compile's floor coupling requires.
    //
    // AN EARLIER VERSION OF THIS CLAMPED THE DATE TO THE COMPILE TIME INSTEAD, AND THAT DID NOT WORK. Clamping
    // re-projects the item to `now` on EVERY weekly compile, so its effective date is perpetually the newest
    // and perpetually above a floor that lags by historyDepth: it ages out of the mailed set and is mailed
    // again, on exactly the cycle the clamp was supposed to close. UnifiedWorker caught it by simulating the
    // merged code forward, which is the only thing that can see it: "published no later than THIS compile" is
    // trivially true after a clamp, while the floor proof needs "no later than the compile that FIRST mailed
    // it". A perpetually-now item is structurally incompatible with a lagging floor.
    //
    // Dropping it until due satisfies both. It is withheld each week, then enters at its REAL date once that
    // date passes, mails once, and is then below every later floor. The failure direction is right too: a
    // mistyped year withholds an item until the typo is fixed, and the corrected date is in the past so it
    // mails normally. The clamp's failure direction was subscribers receiving it four times, which no later
    // fix can take back.
    .filter((it) => it.date <= generatedAt)
    // Windowed AFTER the projection, so it reads the already-normalized numeric `date` rather than whatever
    // shape the caller passed. An undated item has date 0 and therefore never survives a window, which is the
    // right way round: an item with no publication date cannot be shown to be new.
    .filter((it) => sinceMs === null || it.date >= sinceMs)
    // Matched on the projected `url`, which is the same field the caller records when it mails an item, so the
    // two sides cannot drift into comparing different strings. Trimmed on both sides and otherwise EXACT: the
    // urls come from one generator, and normalizing case or trailing slashes here would be inventing a
    // tolerance the producer does not need and quietly excluding a near-miss that is a different item.
    .filter((it) => excluded === null || !excluded.has(it.url));

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
    generatedAt,
    sections,
    topNews,
    layout: buildLayout(sections, topNews, Boolean(firstIssue)),
    counts,
    isEmpty,
    // The frozen issue records its OWN window, so a compile that forgot to pass one is visible in the stored
    // artifact instead of invisible. `null` here means the issue is a best-of rather than a what-is-new, and
    // that is a bug in the caller every time. News is deliberately not windowed: it is ranked by distinct
    // openers rather than recency, and the gather already returns a bounded recent set, so a story that
    // ingested nine days ago and was opened all week is exactly what belongs at the top.
    window: { since: sinceMs, excluded: excluded === null ? null : excluded.size, appliesTo: 'members' },
    // null on every issue but the first, so the template renders the line by its presence and never has to
    // know which issue number it is holding.
    // sow-166: `launchNote` is an explicit override, and `undefined` (not passed) keeps the original behaviour.
    // The WELCOME issue passes null: it is the reader's first email but NOT the newsletter's first issue, and
    // its own header line already states the 90-day span, so the launch note would both contradict the claim
    // and repeat the span. It still wants firstIssue:true for the empty-section wording, which is why the two
    // are separable at all.
    launchNote: launchNote !== undefined ? launchNote : (firstIssue ? FIRST_ISSUE_NOTE : null),
  };
}

/**
 * The render-ready section ordering. Every section in SECTION_ORDER appears exactly once: the ones with
 * items first (in canonical order), then the empty ones (in that same canonical order) carrying their note.
 * PURE, and it reads only the already-projected public-safe items, so it cannot widen the leak guard.
 */
function buildLayout(sections, topNews, firstIssue = false) {
  const notes = firstIssue ? FIRST_ISSUE_SECTION_NOTES : EMPTY_SECTION_NOTES;
  const itemsFor = (key) => (key === 'news' ? topNews : sections[key] ?? []);
  const entry = (key) => {
    const items = itemsFor(key);
    const empty = items.length === 0;
    return {
      key,
      label: SECTION_LABELS[key] ?? key,
      items,
      empty,
      note: empty ? notes[key] ?? null : null,
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
