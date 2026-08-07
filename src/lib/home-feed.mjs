// SOW-136: pure helpers behind the feed homepage (New & Popular ranking, the unified feed order,
// trending tags, relative time). Node-testable, no Astro imports; src/pages/index.astro maps the
// content collections to plain items and delegates the ordering decisions here.

/** The sort timestamp for a feed item: content uses publishedAt, shares use createdAt. 0 when undated. */
export function feedTime(data) {
  const d = data?.publishedAt ?? data?.createdAt ?? data?.updatedAt;
  return d ? new Date(d).valueOf() : 0;
}

/** Newest first; undated items sink. Stable for equal timestamps. Returns a new array. */
export function sortByNewest(items) {
  return [...items].sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
}

/**
 * SOW-018 scoped reversal (elected by sow-131, first applied here): ONLY a published, visibility:public
 * share may reach a public artifact. Fail closed: any missing/other value excludes the share. Members-only
 * shares (including Mode B stub metadata) stay extension-only.
 */
export function isPublicShare(data) {
  return data?.status === 'published' && data?.visibility === 'public';
}

/**
 * New & Popular: favorites weigh 3, comments 2, newest breaks ties. Pre-launch (all counts zero) this
 * degrades to pure recency. Items carry {favorites, comments, date, kind}. To keep the grid from
 * collapsing into one content type (six prompts in a row), each kind is capped at `maxPerKind`; when
 * the cap leaves slots unfilled (too few kinds), the remainder backfills by plain score order.
 */
export function rankNewAndPopular(items, n = 6, maxPerKind = 2) {
  const score = (it) => (it.favorites ?? 0) * 3 + (it.comments ?? 0) * 2;
  const ranked = [...items].sort((a, b) => score(b) - score(a) || (b.date ?? 0) - (a.date ?? 0));
  const picked = [];
  const perKind = new Map();
  for (const it of ranked) {
    if (picked.length >= n) break;
    const k = it.kind ?? '';
    if ((perKind.get(k) ?? 0) >= maxPerKind) continue;
    perKind.set(k, (perKind.get(k) ?? 0) + 1);
    picked.push(it);
  }
  for (const it of ranked) {
    if (picked.length >= n) break;
    if (!picked.includes(it)) picked.push(it);
  }
  return picked;
}

/**
 * Decode the HTML entities that ride in on scraped share metadata (OG titles like "A &#8211; B" or
 * "Q&amp;A"). Numeric forms first, then the common named set; ampersand last so "&amp;" itself does
 * not spawn new matches for the earlier rules.
 */
export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * Trending tags: free-form `tags` counted across the listed items, top N by count (ties alphabetical).
 * Tags are lowercased for counting so "AI" and "ai" merge.
 */
export function aggregateTags(items, n = 9) {
  const counts = new Map();
  for (const it of items) {
    for (const raw of it.tags ?? []) {
      const tag = String(raw).trim().toLowerCase();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, n);
}

/** The public feed narrows (sow-131 + sow-139 news): route segment -> predicate over a normalized feed item. */
export const FEED_NARROWS = ['all', 'news', 'network', 'articles', 'products', 'prompts', 'shares'];

/**
 * Does a feed item belong to a narrow? `all` = everything; `network` = the PUBLICATIONS from across
 * the whole network, member and house alike (articles/products/prompts, no shares; owner QA
 * 2026-07-21 redefined this from the house-only reading); `news` matches NO static item (the News
 * view is client-rendered from the worker, sow-139); the rest match the item's kind. Unknown narrows
 * match nothing (fail closed).
 */
export function matchesNarrow(item, narrow) {
  switch (narrow) {
    case 'all': return true;
    case 'news': return false;
    case 'network': return item?.kind === 'article' || item?.kind === 'product' || item?.kind === 'prompt';
    case 'articles': return item?.kind === 'article';
    case 'products': return item?.kind === 'product';
    case 'prompts': return item?.kind === 'prompt';
    case 'shares': return item?.kind === 'share';
    default: return false;
  }
}

/**
 * sow-192 (homepage v2): the per-tab counts the tabbed feed shows beside each label. Derived purely from
 * the build-time arrays, so counts reflect only what a visitor can open: `contentItems` are the listed
 * articles/products/prompts, `shareItems` are the PUBLIC shares only (members-only shares are aggregated
 * elsewhere and never reach this array), so members-only content is excluded by construction. `news` is
 * deliberately null: the news tab is runtime worker data (sow-139) with no build-time count. `network` is
 * the publications total (no shares), matching matchesNarrow('network').
 */
export function feedCounts(contentItems = [], shareItems = []) {
  const c = { article: 0, product: 0, prompt: 0 };
  for (const it of contentItems) {
    if (it && (it.kind === 'article' || it.kind === 'product' || it.kind === 'prompt')) c[it.kind]++;
  }
  const shares = Array.isArray(shareItems) ? shareItems.length : 0;
  const network = c.article + c.product + c.prompt;
  return { all: network + shares, news: null, network, articles: c.article, products: c.product, prompts: c.prompt, shares };
}

/**
 * sow-192 (homepage v2): bucket a set of day-stamps (epoch ms) into `cells` heatmap cells across the
 * min..max span, returning a level per cell: 0 for an empty cell, else 1..4 scaled RELATIVE to the busiest
 * cell (so a dense commit history reads as a proper contribution graph rather than saturating every cell at
 * 4). Pure and testable; the homepage feeds it git commit dates (see git-history.commitsByDate). An empty
 * input returns all zeros, so a shallow clone with no history renders a blank band.
 */
export function heatCells(stamps, cells) {
  const n = Math.max(0, cells | 0);
  const clean = (stamps || []).filter((t) => typeof t === 'number' && t > 0).sort((a, b) => a - b);
  const out = new Array(n).fill(0);
  if (!clean.length || n === 0) return out;
  const min = clean[0];
  const span = Math.max(1, clean[clean.length - 1] - min);
  const counts = new Array(n).fill(0);
  for (const t of clean) counts[Math.min(n - 1, Math.floor(((t - min) / span) * n))]++;
  const max = Math.max(...counts);
  if (max === 0) return out;
  return counts.map((c) => (c === 0 ? 0 : Math.max(1, Math.ceil((c / max) * 4))));
}

/**
 * sow-192 Phase D (Personalize): re-order + filter the homepage feed for a signed-in member. Pure and
 * testable; the client builds a plain row descriptor per rendered feed row ({index, kind, author, tags,
 * comments, date, read}) and applies the returned display order (rows not returned are hidden). Rules:
 * - scope 'followed' keeps only rows authored by a followed member (drops news + unfollowed);
 * - !sharesInline drops share rows; hideRead drops rows the member has read;
 * - order is newest-first (default) or most-discussed (comments desc, date breaks ties);
 * - a followed tag floats its rows to the top (a boost, applied before the base order).
 * Everything defaults to the unchanged newest-first feed, so an empty/absent opts is a no-op ordering.
 */
export function personalizeOrder(rows, opts = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const scope = opts.scope === 'followed' ? 'followed' : 'everything';
  const followed = new Set((opts.followedAuthors || []).map((a) => String(a).toLowerCase()));
  const followedTags = new Set((opts.followedTags || []).map((t) => String(t).toLowerCase()));
  const rules = opts.rules || {};
  const newestFirst = rules.newestFirst !== false;
  const sharesInline = rules.sharesInline !== false;
  const hideRead = rules.hideRead === true;

  const visible = list.filter((r) => {
    if (scope === 'followed' && !followed.has(String(r.author).toLowerCase())) return false;
    if (!sharesInline && r.kind === 'share') return false;
    if (hideRead && r.read) return false;
    return true;
  });
  const hasFollowedTag = (r) => (r.tags || []).some((t) => followedTags.has(String(t).toLowerCase()));
  visible.sort((a, b) => {
    const ta = hasFollowedTag(a) ? 1 : 0;
    const tb = hasFollowedTag(b) ? 1 : 0;
    if (ta !== tb) return tb - ta;
    if (newestFirst) return (b.date || 0) - (a.date || 0);
    const ca = a.comments || 0;
    const cb = b.comments || 0;
    if (ca !== cb) return cb - ca;
    return (b.date || 0) - (a.date || 0);
  });
  return visible.map((r) => r.index);
}

/** Split items into page chunks of `size` (the ladder pager renders one pager row per chunk). */
export function chunkPages(items, size = 10) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * sow-145: append the GBTI UTM params to an outbound source link so publications can attribute the
 * referred traffic. Mirrors client-ui/src/news.mjs utmLink semantics: existing query params survive,
 * a non-URL falls through unchanged. utm_source is the brand; medium names the surface.
 */
export function utmUrl(link, { campaign, medium = 'website' } = {}) {
  if (typeof link !== 'string' || !link) return '';
  try {
    const u = new URL(link);
    u.searchParams.set('utm_source', 'gbti-network');
    u.searchParams.set('utm_medium', medium);
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch { return link; }
}

/** Estimated reading time in whole minutes (220 wpm), minimum 1. 0 for an empty/absent body. */
export function readMinutes(text) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean).length;
  return words === 0 ? 0 : Math.max(1, Math.round(words / 220));
}

/**
 * The news comment-thread key: "news-<FNV-1a 32-bit base36><len%36>". A byte-exact port of
 * client-ui/src/news.mjs newsTargetSlug, so the site's gated news discussion reads the same thread the
 * extension writes. Keep the two implementations in lockstep (the unit test pins known values).
 */
export function newsTargetSlug(guid) {
  const s = String(guid ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `news-${(h >>> 0).toString(36)}${(s.length % 36).toString(36)}`;
}

/** Short relative time for feed metadata: "just now", "5m ago", "3h ago", "2d ago", "4mo ago", "1y ago". */
export function relativeTime(date, now = Date.now()) {
  const t = date ? new Date(date).valueOf() : NaN;
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  if (d < 365) return `${Math.max(1, Math.round(d / 30))}mo ago`;
  return `${Math.max(1, Math.round(d / 365))}y ago`;
}

/**
 * sow-141 QA (2026-07-24): where to pepper worker news into the homepage feed. Returns the 0-based
 * MEMBER-row indices after which to insert one news item, on a (ratio-1)-members : 1-news rhythm
 * (ratio 3 = after rows 1, 3, 5, ...), capped so news never exceeds 1/(ratio) of the blended feed
 * and never runs consecutively. Positions index the ORIGINAL member row list, so a DOM consumer can
 * hold the row references first and insert after them in any order.
 */
export function newsInsertionPlan(memberCount, newsCount, ratio = 3) {
  const per = Math.max(1, (ratio | 0) - 1);
  const m = Math.max(0, memberCount | 0);
  const n = Math.max(0, newsCount | 0);
  const max = Math.min(Math.floor(m / per), n);
  const plan = [];
  for (let i = 0; i < max; i++) plan.push(per * (i + 1) - 1);
  return plan;
}
