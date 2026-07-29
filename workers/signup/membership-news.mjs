// SOW-043 / UnifiedWorker: the NEWS surface. The news ingest engine (RSS fetch + AI classify + og:image backfill)
// is now folded into THIS Worker (workers/signup/news/), writing the polled collection to NEWS_KV. These handlers
// serve that collection by reading NEWS_KV IN-PROCESS (no cross-worker HTTP hop, no NEWS_API_KEY): the day-sharded
// store (news/src/store.mjs) + the pure shapers (news/src/api.mjs). The route table + gating in index.mjs is
// unchanged; only the data source moved from an authed fetch to a KV read.
//
// SOW-060/077: reading NEWS is a READ-only perk for ANY signed-in account, INCLUDING a banned one (a ban is a
// COMMUNITY ban, not total; news is non-KV member data). It is gated by authorizeSignedIn (verify the token + the
// fail-closed mirror, but admit banned), NOT effective-paid. Following channels / prefs (the KV write) stays on
// authorizeMember (denies banned); member-only content (decrypt/encrypt/Shares/publishing) stays on authorizePaid.
import { authorizeSignedIn } from './membership-content.mjs';
import { recordAuthedUsage } from './analytics.mjs'; // SOW-061 P3: news_view usage by tier
import { queryItems as kvQueryItems, loadIndex as kvLoadIndex } from './news/src/store.mjs';
import { publicItem, categoriesWithCounts, sourcesWithCounts } from './news/src/api.mjs';

// A category label is config-defined (news/config/categories.mjs); a source id is config-defined
// (news/config/sources.mjs). Bound the query tokens to a safe set (defense in depth; the store filter is
// case-insensitive on category and exact on source).
const SAFE_CATEGORY = /^[a-z0-9][a-z0-9 &/+.-]{0,40}$/i;
const SAFE_SOURCE = /^[a-z0-9][a-z0-9 _.-]{0,60}$/i;

function clampLimit(raw, def = 50, max = 100) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** The news store is ready when NEWS_KV is bound to this Worker (post-merge it always is; a test/dev env without
 *  the binding still degrades gracefully to "news unavailable" rather than throwing). */
const newsReady = (env) => !!env?.NEWS_KV;
const unavailable = () => ({ status: 502, body: { error: 'news_unavailable', message: 'the news service is not configured yet' } });

/** Build the day-shard query filter from the request, sanitizing each token. */
function feedFilter(url, def, max) {
  const filter = { limit: clampLimit(url.searchParams.get('limit'), def, max) };
  const cat = url.searchParams.get('category');
  if (cat && SAFE_CATEGORY.test(cat)) filter.category = cat;
  const src = url.searchParams.get('source');
  if (src && SAFE_SOURCE.test(src)) filter.source = src;
  const since = url.searchParams.get('since');
  if (since && /^[0-9]{1,12}$/.test(since)) filter.since = since;
  return filter;
}

/** Read the feed from NEWS_KV, newest-first, and shape it exactly as the old proxy returned it. */
async function readFeed(request, env, queryItems, def, max) {
  const { items, updatedAt } = await queryItems(env, feedFilter(new URL(request.url), def, max));
  const shaped = (Array.isArray(items) ? items : []).map(publicItem);
  return { status: 200, body: { ok: true, updatedAt: updatedAt ?? null, count: shaped.length, items: shaped } };
}

/**
 * SOW-046 C: resolve a news item to its CANONICAL stored record by guid, so the news->Discord publish posts the
 * real feed metadata (title/link/source/category) rather than anything the client supplied. Reads the store
 * (newest-first, capped) and matches by the globally-unique guid; an optional source hint narrows the window (a
 * wrong/forged source just yields a miss -> fail closed). Returns the canonical (public-shaped) item or null.
 */
export async function findNewsItemByGuid(env, { guid, source, limit = 100, queryItems = kvQueryItems } = {}) {
  if (!newsReady(env) || !guid) return null;
  const filter = { limit };
  if (source && SAFE_SOURCE.test(source)) filter.source = source;
  const { items } = await queryItems(env, filter);
  const found = (Array.isArray(items) ? items : []).find((it) => String(it?.guid) === String(guid));
  return found ? publicItem(found) : null;
}

/** GET /membership/news?category&since&limit -> { items } for any signed-in member (SOW-060). */
export async function membershipNews(request, env, { authorize = authorizeSignedIn, queryItems = kvQueryItems, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!newsReady(env)) return unavailable();
  recordAuthedUsage(env, auth, 'news_view', request); // SOW-061 P3: a news feed view, recorded by effective tier
  return readFeed(request, env, queryItems, 50, 100);
}

/** GET /news/feed -> { items } with NO auth (sow-139): the curated news LIST is public metadata for the site's
 *  /feeds/news/ view. The interactive layer (prefs, follows, hearts, discussion) stays gated. Tighter limit
 *  (default 40, max 60); the route serves it Cache-Control: public so anonymous traffic is browser-cached. */
export async function publicNews(request, env, { queryItems = kvQueryItems } = {}) {
  if (!newsReady(env)) return unavailable();
  return readFeed(request, env, queryItems, 40, 60);
}

/** GET /membership/news-categories -> { categories } (the classifier label set + live counts). */
export async function membershipNewsCategories(request, env, { authorize = authorizeSignedIn, loadIndex = kvLoadIndex, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!newsReady(env)) return unavailable();
  const index = await loadIndex(env);
  return { status: 200, body: { ok: true, categories: categoriesWithCounts(index?.counts?.category || {}) } };
}

/** GET /membership/news-sources -> { sources } (the channels a member can follow: id, name, description, count). */
export async function membershipNewsSources(request, env, { authorize = authorizeSignedIn, loadIndex = kvLoadIndex, ...authDeps } = {}) {
  const auth = await authorize(request, env, authDeps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!newsReady(env)) return unavailable();
  const index = await loadIndex(env);
  return { status: 200, body: { ok: true, sources: sourcesWithCounts(index?.counts?.source || {}) } };
}
