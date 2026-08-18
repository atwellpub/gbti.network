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
// Item shape IN (the Worker normalizes activity-index entries + public shares to this):
//   { kind: 'article'|'product'|'prompt'|'share', title, url, author, authorName?, date: number,
//     visibility: 'public'|'members', ... (any extra fields are dropped by the projection) }
// News shape IN (the Worker attaches the distinct-opener count):
//   { title, url, source?, opens?: number, date?: number }

export const SECTION_KINDS = ['article', 'product', 'prompt', 'share'];

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
 * Empty-week policy (Q10): if there is NO public member content AND NO news, the issue is marked empty so the
 * compile cron can SKIP it. If member content is empty but news is present, a TOP-NEWS-ONLY issue is still
 * composed and sent (an empty week never means silence unless there is truly nothing public to say).
 *
 * @returns { issueId, generatedAt, sections: {article,product,prompt,share}, topNews, counts, isEmpty }
 */
export function composeIssue({ issueId, items = [], news = [], now = Date.now } = {}, { perSection = 5, maxNews = 5 } = {}) {
  const id = trimOrNull(issueId);
  if (!id) throw new DigestError('issueId is required');
  const cap = Math.max(0, Math.floor(Number(perSection)) || 0);
  const newsCap = Math.max(0, Math.floor(Number(maxNews)) || 0);

  // Layer 1: drop every non-public item. Layer 2: project each survivor to public-safe fields only.
  const publicItems = (Array.isArray(items) ? items : [])
    .filter(isPublicItem)
    .map(publicItem)
    .filter((it) => it.title && it.url); // an item with no title or link is not renderable

  const sections = { article: [], product: [], prompt: [], share: [] };
  for (const it of publicItems) {
    if (Object.prototype.hasOwnProperty.call(sections, it.kind)) sections[it.kind].push(it);
  }
  for (const k of SECTION_KINDS) {
    sections[k] = sections[k].sort(byDateDesc).slice(0, cap);
  }

  const topNews = (Array.isArray(news) ? news : [])
    .map(newsItem)
    .filter((it) => it.title && it.url)
    .sort((a, b) => (b.opens - a.opens) || (b.date - a.date))
    .slice(0, newsCap);

  const counts = {
    article: sections.article.length,
    product: sections.product.length,
    prompt: sections.prompt.length,
    share: sections.share.length,
    news: topNews.length,
  };
  const memberTotal = counts.article + counts.product + counts.prompt + counts.share;
  const isEmpty = memberTotal === 0 && counts.news === 0;

  return {
    issueId: id,
    generatedAt: Number(now()),
    sections,
    topNews,
    counts,
    isEmpty,
  };
}

/** Does this issue have anything worth sending? The compile cron skips only a fully-empty issue. */
export function hasContent(issue) {
  return Boolean(issue) && !issue.isEmpty;
}
