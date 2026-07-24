// SOW-017 + SOW-039: the new-tab page logic. The shared member-hub shell (top bar + left rail + account menu) is
// injected + wired by shell.mjs; this module owns the "Latest Activity" feed (three persisted view modes +
// per-item content thumbnails), the search filter, the Latest/Following tabs (SOW-023), the onboarding setup
// banner (SOW-026/029), and the lapsed-member lock (SOW-018). Fetches the public activity index over the
// extension's gbti.network host permission. CSP-safe (no inline handlers).

import { canSeeNews, canSeeShares, upgradePromptKind } from '../../client/src/membership.mjs'; // SOW-060/077: free-tier read perks + the read-only upgrade prompt
import { devlog } from './devlog.mjs'; // SOW-124: the page realm's devlog (superadmin + Debug-flag gated; inert otherwise)
import { BUNDLED_QUOTES, pickQuote, shouldShowSplash, splashDestHash, normalizeBgMode, normalizeBgOpacity, normalizeBgPattern, splashShowsCards, splashShowsQuote, splashKeepsDarkCards, normalizePatternGap, normalizeCardBlur, asciiAnchor, GBTI_ASCII } from '../../client-ui/src/splash.mjs'; // SOW-063 landing splash + SOW-074 background
import { mergeAll, toMs } from '../../client-ui/src/all-merge.mjs'; // SOW-042: the All merge + Shares policy (per-share visibility filter is inside mergeAll)
import { newsToItem } from '../../client-ui/src/news.mjs'; // SOW-043: blend members-only news into the feed
import { parseBrowseHash, stripDoParam, parseMemberHash } from '../../client-ui/src/browse-hash.mjs'; // the activity bell's deep-link (tab=<type>&read=<path>); SOW-143 the member deep-link (tab=member&member=<u>)
import { initShell, setRailActive } from './shell.mjs';
import { TYPE_FILTERS, typeForHash, railKeyForType, feedSources } from '../../client-ui/src/feed-route.mjs';
import { viewKey, viewModeFor, landingType, LAST_SECTION_KEY, LEGACY_MODE_KEY } from '../../client-ui/src/newtab-prefs.mjs'; // SOW-105: last-section + per-section view-mode memory
import { mountPageClient } from './page-client.mjs'; // SOW-041 P5: a GbtiClient so the top-bar "+" composer works here (also defines <gbti-card-list>)

const SITE = 'https://gbti.network';

const $ = (sel) => document.querySelector(sel);
const authorName = (a) => (a === 'gbti' || a === 'house' ? 'GBTI Network' : a);

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
function longDate() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

// SOW-118: fill the bottom-right version indicator. The installed version comes from the manifest (always
// available); the build number comes from the public changelog artifact (fail-soft, so an offline tab still
// shows the version). The whole control links to /changelog.
async function initVersionIndicator() {
  const el = $('[data-version]');
  const txt = el?.querySelector('[data-version-text]');
  if (!el || !txt) return;
  let version = '';
  try { version = chrome.runtime?.getManifest?.().version || ''; } catch { version = ''; }
  if (!version) return; // nothing meaningful to show
  const paint = (build) => {
    txt.textContent = build > 0 ? `v${version} · build ${build}` : `v${version}`;
    el.classList.add('show');
  };
  paint(0); // show the version immediately; the build number lands after the fetch
  try {
    const res = await fetch(`${SITE}/changelog.json`, { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      const build = Number(data?.build);
      if (Number.isFinite(build) && build > 0) paint(build);
    }
  } catch { /* offline or the artifact is unreachable: the version-only label is fine */ }
}

let ENTRIES = [];
// SOW-111 QA fix: the single-type views are the UNCAPPED directories, but /activity-index.json is a capped
// river (40 newest), so filtering it silently dropped older items (e.g. only 8 of 46 articles). Each content
// type lazily loads its full per-type index (SOW-031) and the narrow view renders from THAT.
const DIRECTORY_URL = { post: 'blog-index.json', product: 'products-index.json', prompt: 'prompts-index.json' };
const DIRECTORY = { post: null, product: null, prompt: null };
const DIRECTORY_LOADING = new Set();
// SOW-023: the personalized "Following" view. FOLLOWING is a Set of followed usernames once loaded for an
// effective-paid member, or null when unknown (not signed in, trial, or the paid-only Worker denied the read).
let VIEW = 'latest';
let FOLLOWING = null;
let FOLLOWS_LOADED = false;
// SOW-046 E: the member's followed NEWS CHANNELS (source ids); the Following view drills into these for news.
let FOLLOWED_CHANNELS = null; // a Set of lowercased source ids, or null when not loaded / not a paid member
let PREFS_LOADED = false;
// SOW-039/105: the feed view mode (compact | detailed | card), persisted PER SECTION (gbti-nt-view-<type>)
// with per-type defaults. Resolved in init() once the landing TYPE is final, and re-resolved on every
// selectType switch; this placeholder only covers the window before init runs.
let MODE = 'compact';
// SOW-042/043: the active type filter (all | post | product | prompt | share | news). 'all' blends the
// activity-index with the member's Shares + members-only News (capped river). MEMBERSHIP gates both; SHARES + NEWS
// are the raw lists, loaded once on demand. News is PAID-only; Shares are paid-or-trial. (TYPE_FILTERS,
// parseTypeFromHash, typeForHash, railKeyForType live in client-ui/src/feed-route.mjs so they are node-testable.)
// The feed IS the unified content browser; the rail's Browse items are shortcuts that open it pre-filtered via
// the hash (newtab.html#type=<X>). SOW-105: a genuinely BARE newtab.html (a fresh Chrome tab or the brand logo)
// lands on the REMEMBERED last section (gbti-nt-last-section, written in selectType); the Activity rail item
// stays deterministic because it carries an explicit #type=all (shell.mjs), and any explicit hash outranks the
// memory. The activity bell deep-links here too, in the legacy Browse hash shape
// (#tab=<type>&read=<repo path>); the hash parser accepts `type=` OR `tab=`, and readFromHash pulls the optional
// path that auto-opens the in-place reader.
const hashStr = () => (typeof location !== 'undefined' && location.hash) || '';
const readFromHash = () => { const { read } = parseBrowseHash(hashStr()); return read || null; };
// SOW-143: the member-detail deep-link (#tab=member&member=<username>) -> the username, or null.
const memberFromHash = () => parseMemberHash(hashStr());
// SOW-114: the deep-link force-action (do=favorite|collect, sent by the public content pages through the
// relay). Consumed ONE-SHOT: the hash is replaced without do= so a refresh or hashchange never re-runs it.
const doFromHash = () => parseBrowseHash(hashStr()).action || null;
function consumeDo() {
  if (typeof location === 'undefined' || typeof history === 'undefined') return;
  const rest = stripDoParam(location.hash);
  try { history.replaceState(null, '', location.pathname + location.search + (rest ? '#' + rest : '')); } catch { /* fail-soft */ }
}
let TYPE = typeForHash(hashStr()); // bare newtab.html -> 'all' here; init() re-resolves a bare tab via landingType (SOW-105)
// SOW-105: the device-local prefs reads (try/catch per the file convention; a blocked store = today's behavior).
const storedView = (t) => { try { return localStorage.getItem(viewKey(t)); } catch (e) { return null; } };
const storedLastSection = () => { try { return localStorage.getItem(LAST_SECTION_KEY); } catch (e) { return null; } };
const resolveMode = () => { MODE = viewModeFor(TYPE, storedView(TYPE)); };
let MEMBERSHIP = 'unknown';
let SHARES = null;
let SHARES_LOADED = false;
let SHARES_LOADED_AT = null; // the MEMBERSHIP the loaded SHARES were fetched under, so an upgrade re-fetches
let NEWS = null;
let NEWS_LOADED = false;
// SOW-111 QA follow-up (owner-refined): every view renders in 40-item chunks and AUTO-LOADS the next chunk as
// the reader nears the bottom (an IntersectionObserver sentinel with a 600px pre-load margin, so scrolling
// feels continuous; the rows are already in memory, only the DOM grows). The window resets when the
// view/type/search changes.
const PAGE_SIZE = 40;
let VISIBLE = PAGE_SIZE;
let PAGE_KEY = '';
let MORE_IO = null; // the active bottom sentinel observer (disconnected on every re-render)

// The per-mode row/card markup + its atoms (thumb, chip, lock, meta) live in the shared <gbti-card-list>
// (SOW-042), so the activity feed and Browse render through ONE source of truth. Content + Shares open IN PLACE
// in the page reader (openReader); only News carries an outbound openHref (its UTM source link).

// Project a merged feed item (an activity-index entry OR a Share, both already carrying a normalized shape) onto the
// <gbti-card-list> item shape. The RAW type ('post'/'share') is preserved so the card glyph + label resolve the same
// way Browse does. A content item deep-links into the in-extension reader; a Share has no path-addressed reader, so
// it routes to the Shares stream tab.
const toCardItem = (e) => ({
  ...e, // pass the reader fields through: gbti-reader.open needs `path` for content, author+id+body for a Share
  excerpt: e.excerpt || '',
  createdAt: e.createdAt ?? e.publishedAt,
  // No openHref: content + Shares open IN PLACE in the page reader (the card emits card-open). Only News keeps an
  // openHref (its outbound UTM link, set by newsToItem), so the feed is the one browser — no Browse-page bounce.
});

function renderFeed(filter = '') {
  const feed = $('[data-feed]');
  if (!feed) return;
  const q = filter.trim().toLowerCase();

  if (VIEW === 'following') {
    const noChannels = !FOLLOWED_CHANNELS || FOLLOWED_CHANNELS.size === 0;
    if (FOLLOWING === null && noChannels) {
      feed.innerHTML = `<p class="muted">Follow people and news channels to build your own feed. Subscribe to a member's activity, or follow a channel from the News section.</p>`;
      return;
    }
    if ((!FOLLOWING || FOLLOWING.size === 0) && noChannels) {
      feed.innerHTML = `<p class="muted">You are not following anyone or any news channel yet. Subscribe to a member's activity, or follow a channel from the News section, to build your feed.</p>`;
      return;
    }
  }

  // SOW-042/043: the "All" filter blends content + the member's Shares (the ONE shared mergeAll, Shares omitted for
  // a non-member) with members-only News (supplementary, paid-only). A specific type filter narrows to that type.
  // Content + Shares are projected by toCardItem; News (a different source) by newsToItem; both are card items.
  // The per-view source matrix (pure, node-tested): Activity ('all') = member content + Shares, NO news; News
  // ('news') = news BLENDED with member content + Shares; the single-type directories narrow to their type.
  const { wantNews, wantShares, narrow } = feedSources(TYPE);
  // A single content-type view renders from its full directory once loaded (the capped river is the fallback
  // until the fetch lands, so the switch is instant and then fills in).
  const directory = narrow ? DIRECTORY[TYPE] : null;
  let rows = mergeAll({ items: directory ?? ENTRIES, shares: wantShares ? SHARES : null, membership: MEMBERSHIP }).map(toCardItem);
  // SOW-046 G: strip openHref so a news card opens the in-extension expanded reader (card-open) instead of bouncing
  // to the source; the reader still offers an "Open source" link (it rebuilds the UTM link from item.link).
  if (wantNews && canSeeNews(MEMBERSHIP) && Array.isArray(NEWS)) rows = rows.concat(NEWS.map(newsToItem).map(({ openHref, ...n }) => n)); // SOW-060: news is a free-tier (signed-in) perk
  if (narrow) rows = rows.filter((e) => e.type === TYPE);
  // SOW-046 E: the Following view drills into followed MEMBERS' content/shares AND followed NEWS CHANNELS' news
  // (a news item is kept when its source is in the member's followedChannels).
  if (VIEW === 'following') {
    rows = rows.filter((e) => (e.type === 'news'
      ? (FOLLOWED_CHANNELS && FOLLOWED_CHANNELS.has(String(e.source ?? e.author).toLowerCase()))
      : (FOLLOWING && FOLLOWING.has(String(e.author).toLowerCase()))));
  }
  rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)); // newest-first across all three sources
  if (q) rows = rows.filter((e) => `${e.title} ${authorName(e.author)}`.toLowerCase().includes(q));
  // Pagination window: reset on a view/type/search change, widen via the Show more button below the list.
  const pageKey = `${VIEW}|${TYPE}|${q}`;
  if (pageKey !== PAGE_KEY) { PAGE_KEY = pageKey; VISIBLE = PAGE_SIZE; }
  const total = rows.length;
  rows = rows.slice(0, VISIBLE);

  if (!rows.length) {
    // Cold start: if this view is still fetching news (nothing cached yet), say "loading", not "no news" — the
    // list refreshes in place once it lands (avoids a "no news" flash that then fills in).
    const newsLoading = wantNews && canSeeNews(MEMBERSHIP) && !NEWS_LOADED;
    const empty = VIEW === 'following'
      ? (q ? 'No followed activity matches that filter.' : 'No recent activity from the members you follow.')
      : (q ? 'No activity matches that filter.' : newsLoading ? 'Loading the latest news…' : (TYPE === 'share' ? 'No Shares yet.' : (TYPE === 'news' ? 'No news right now. Check back soon.' : 'No activity yet.')));
    feed.innerHTML = `<p class="muted">${empty}</p>`;
    return;
  }
  // The shared card-list owns the markup, the three density modes, and the CSP-safe broken-image fallback.
  const list = document.createElement('gbti-card-list');
  list.mode = MODE;
  list.items = rows; // already card items (toCardItem / newsToItem)
  list.addEventListener('card-open', (e) => openReader(e.detail?.item)); // content + Shares open IN PLACE
  feed.replaceChildren(list);
  if (MORE_IO) { MORE_IO.disconnect(); MORE_IO = null; }
  if (total > rows.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'nt-more';
    sentinel.textContent = `Showing ${rows.length} of ${total}…`;
    feed.appendChild(sentinel);
    MORE_IO = new IntersectionObserver((ents) => {
      if (!ents.some((x) => x.isIntersecting)) return;
      MORE_IO.disconnect();
      MORE_IO = null;
      VISIBLE += PAGE_SIZE;
      renderFeed($('[data-filter]')?.value || '');
    }, { rootMargin: '600px' });
    MORE_IO.observe(sentinel);
  }
}

/** Open an item IN the page reader, hiding the feed; Back restores it. The feed IS the browser now (no Browse-page
 *  bounce). content/Share -> <gbti-reader>; News -> <gbti-news-reader> (SOW-046 G: the expanded news view with
 *  publisher detail + Follow-publisher + discussion). Both are defined by mountPageClient (client-ui), called in init(). */
// SOW-143: when an item is opened FROM a member view, Back should return to that member view, not the feed. This
// is carried as an explicit openReader option (never ambient state), so the three existing callers clear it by
// omission and a stale return target can never leak.
let RETURN_MEMBER = null;
function openReader(item, { returnTo = null } = {}) {
  if (!item) return;
  RETURN_MEMBER = returnTo;
  hideSplash(); // opening a reader IN PLACE (post-share redirect, card-open, first-load deep link) dismisses the
                // splash: those callers bypass the hashchange handler that would otherwise clear it (replaceState
                // writes the deep-link hash without firing hashchange). Idempotent when the splash is already gone.
  writeReadHash(item); // SOW-092: the address bar carries a copyable deep link while reading
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (!fv || !rv || !host) return;
  const r = document.createElement(item.type === 'news' ? 'gbti-news-reader' : 'gbti-reader');
  host.replaceChildren(r);
  r.open(item);
  const back = $('[data-reader-back]');
  if (back) back.textContent = returnTo ? `← Back to @${returnTo}` : '← Back to the feed';
  fv.hidden = true;
  rv.hidden = false;
  window.scrollTo(0, 0);
}

// SOW-143: render a member's profile detail IN the reader shell (reusing the same host), addressed by
// #tab=member&member=<username>. Self-loading, so no async retry loop is needed (unlike the share resolver).
function openMember(username) {
  const u = String(username || '');
  if (!u) return;
  RETURN_MEMBER = null;
  hideSplash();
  writeMemberHash(u);
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (!fv || !rv || !host) return;
  const el = document.createElement('gbti-member-view');
  el.setAttribute('data-gbti-username', u);
  el.addEventListener('member-open-item', (e) => { const it = e.detail?.item; if (it) openReader(it, { returnTo: u }); });
  host.replaceChildren(el);
  const back = $('[data-reader-back]');
  if (back) back.textContent = '← Back to the feed';
  fv.hidden = true;
  rv.hidden = false;
  window.scrollTo(0, 0);
}
function writeMemberHash(username) {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  try { history.replaceState(null, '', location.pathname + location.search + `#tab=member&member=${encodeURIComponent(username)}`); } catch { /* fail-soft */ }
}
// SOW-092: reflect the open item in the hash so every reader view is a copyable deep link. A share keys on
// <author>/<id>; content types key on the repo path. replaceState adds no history entry + no hashchange.
function writeReadHash(item) {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  let key = null;
  let tab = item.type;
  if (item.type === 'share') key = item.author && item.id ? `${item.author}/${item.id}` : null;
  else if (item.type !== 'news' && item.path) key = item.path;
  if (!key || !tab) return;
  try { history.replaceState(null, '', location.pathname + location.search + `#tab=${tab}&read=${encodeURIComponent(key)}`); } catch { /* fail-soft */ }
}
function stripReadHash() {
  if (typeof history === 'undefined' || typeof location === 'undefined') return;
  try {
    const { tab } = parseBrowseHash(location.hash);
    // SOW-143: a member hash carries no browse `tab`, so fall back to the current feed type rather than a bare
    // fragment, keeping the rail highlight coherent after Back.
    const frag = tab ? `#tab=${tab}` : (parseMemberHash(location.hash) ? `#type=${TYPE}` : '');
    history.replaceState(null, '', location.pathname + location.search + frag);
  } catch { /* fail-soft */ }
}

// Restore the FEED from the reader. Used both by the Back button (via onReaderBack) and by selectType when a
// filter switch dismisses the reader. SOW-143: clear any pending member-return here, so a subsequent Back never
// resurrects a stale member view after the user navigated away (the return-to-member logic lives ONLY in
// onReaderBack, so a programmatic close from selectType honors the requested navigation instead of bouncing back).
function closeReader() {
  RETURN_MEMBER = null;
  stripReadHash();
  const fv = $('[data-feedview]');
  const rv = $('[data-readerview]');
  const host = $('[data-reader]');
  if (rv) rv.hidden = true;
  if (host) host.replaceChildren();
  if (fv) fv.hidden = false;
}

// SOW-143: the explicit Back button. If this reader was opened FROM a member view, return to that member view
// (one-deep stack); otherwise restore the feed. This is the ONLY path that honors the member-return.
function onReaderBack() {
  if (RETURN_MEMBER) { const u = RETURN_MEMBER; RETURN_MEMBER = null; openMember(u); return; }
  closeReader();
}

// SOW-063: the new-tab landing splash. A BARE tab (no hash) lands on the splash unless snoozed within the window;
// clicking a card snoozes that destination and switches the main column IN PLACE (WorkBench navigates away). The
// pure decision/rotation helpers live in client-ui/src/splash.mjs; this owns the DOM + the localStorage state. The
// forced-sign-in gate (SOW-048, data-unauth) is a fixed overlay that covers this, so it is safe to show the splash
// before that async check resolves. (SOW-077 removed the lapsed lock wall; a signed-in member browses read-only.)
const SPLASH_DECISION_KEY = 'gbti-splash-decision';
const SPLASH_WINDOW_KEY = 'gbti-splash-window-min'; // a client preference set in account.html; minutes, 0 = always show
let QUOTES = null; // P2: the git-native /quotes.json once loaded; null -> the bundled set
function readSplashDecision() { try { return JSON.parse(localStorage.getItem(SPLASH_DECISION_KEY) || 'null'); } catch { return null; } }
function splashWindowMs() {
  try { const m = parseInt(localStorage.getItem(SPLASH_WINDOW_KEY) ?? '30', 10); return Number.isFinite(m) && m >= 0 ? m * 60000 : 30 * 60000; }
  catch { return 30 * 60000; }
}
function renderSplashQuote() {
  const fig = $('[data-splash-quote]');
  const q = pickQuote(QUOTES || BUNDLED_QUOTES, Date.now());
  if (!fig || !q) return;
  const t = fig.querySelector('[data-splash-quote-text]');
  const a = fig.querySelector('[data-splash-quote-author]');
  if (t) t.textContent = q.text;
  if (a) a.textContent = q.author;
  fig.hidden = false;
}
function showSplash() {
  const sv = $('[data-splashview]');
  if (!sv) return;
  const fv = $('[data-feedview]'); const rv = $('[data-readerview]');
  if (fv) fv.hidden = true;
  if (rv) rv.hidden = true;
  sv.hidden = false;
  const root = document.documentElement;
  // SOW-048 precedence: sign-in overrules the splash. The gate mounts async, so the CSS also pins the
  // splash hidden under html[data-unauth]; this guard just avoids doing the work when the wall is already up.
  if (root.hasAttribute('data-unauth')) { sv.hidden = true; return; }
  root.setAttribute('data-splash', '1');
  // SOW-074: the standalone splash-content toggles (any mode). No cards -> the splash is a click-anywhere screen.
  root.toggleAttribute('data-splash-nocards', !splashShowsCards(lsItem('gbti-splash-show-cards')));
  root.toggleAttribute('data-splash-noquote', !splashShowsQuote(lsItem('gbti-splash-show-quote')));
  // SOW-074 follow-up: when the member disables "keep dark cards", light theme uses frosted LIGHT quick-launch cards.
  root.toggleAttribute('data-splash-lightcards', !splashKeepsDarkCards(lsItem('gbti-splash-dark-cards')));
  renderSplashQuote();
  applySplashBg(); // SOW-074: apply the uploaded background (no-op until the image is read; off -> plain splash)
  window.scrollTo(0, 0);
}
function hideSplash() {
  const sv = $('[data-splashview]'); const fv = $('[data-feedview]');
  if (sv) sv.hidden = true;
  if (fv) fv.hidden = false;
  const root = document.documentElement;
  root.removeAttribute('data-splash');
  root.removeAttribute('data-splash-nocards');
  root.removeAttribute('data-splash-noquote');
  root.removeAttribute('data-splash-lightcards');
  clearSplashBg(); // SOW-074: drop the background so it never bleeds onto the feed
}
function snoozeSplash(dest) {
  try { localStorage.setItem(SPLASH_DECISION_KEY, JSON.stringify({ dest, at: Date.now() })); } catch { /* storage unavailable */ }
}

// SOW-063 P2: the git-native quote pool (gbti.network/quotes.json, built from house/quotes.yml). Like the news
// cache, it is the SAME curated set for everyone, so persist the last good fetch + re-hydrate it for an instant
// quote; the live fetch then refreshes it. Fail-soft: cache -> the bundled BUNDLED_QUOTES, so the splash always has
// a quote even offline or before the first fetch.
const QUOTES_CACHE_KEY = 'gbti-quotes-cache';
async function readQuotesCache() {
  try { const r = await chrome.storage?.local?.get?.(QUOTES_CACHE_KEY); const c = r?.[QUOTES_CACHE_KEY]; return Array.isArray(c?.quotes) ? c.quotes : null; }
  catch { return null; }
}
function writeQuotesCache(quotes) {
  try { chrome.storage?.local?.set?.({ [QUOTES_CACHE_KEY]: { quotes, at: Date.now() } }); } catch { /* storage unavailable */ }
}
const reRenderQuoteIfVisible = () => { if (!$('[data-splashview]')?.hidden) renderSplashQuote(); };
async function loadQuotes() {
  const cached = await readQuotesCache();
  if (Array.isArray(cached) && cached.length) { QUOTES = cached; reRenderQuoteIfVisible(); }
  try {
    const res = await fetch(`${SITE}/quotes.json`, { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    const quotes = Array.isArray(data?.quotes) ? data.quotes : null;
    if (quotes && quotes.length) { QUOTES = quotes; writeQuotesCache(quotes); reRenderQuoteIfVisible(); }
  } catch { /* keep the cache / the bundled fallback */ }
}

// SOW-074: the user-uploaded splash background. Mode / opacity / pattern are SYNC localStorage prefs; the (downscaled)
// image is ASYNC in chrome.storage.local. The bg is applied to the splash element when it is shown; the image fills
// in once read (a brief fade). Off / no image -> the plain SOW-063 splash. Content + full are the placement modes;
// opacity + the pattern overlay (incl. the GBTI ASCII art, image bleeding through) are full-mode only.
const SPLASH_BG_IMAGE_KEY = 'gbti:splash-bg-image';
let SPLASH_BG_IMG = null; // the image data URL once read (null = none / not yet read)
const lsItem = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

function clearSplashBg() {
  // Only the BACKGROUND state; the content toggles (data-splash-nocards/noquote) are owned by showSplash/hideSplash.
  const root = document.documentElement;
  root.removeAttribute('data-splash-bg');
  root.style.removeProperty('--splash-bg');
  root.style.removeProperty('--splash-bg-dim');
  root.style.removeProperty('--card-op');
  root.style.removeProperty('--card-blur');
  const pat = $('[data-splash-pattern]');
  if (pat) { pat.className = 'splash-pattern'; pat.removeAttribute('style'); pat.replaceChildren(); }
}

function applySplashBg() {
  clearSplashBg();
  const mode = normalizeBgMode(lsItem('gbti-splash-bg-mode'));
  if (mode === 'off') return; // off -> the plain splash
  // content/fill PLACE an image, so with no image there is nothing to show: fall back to the plain splash.
  // full is a LAYOUT (a fixed full-viewport curtain that covers the rail), so it applies even with NO image,
  // so the sidebar is hidden whether or not a background image is set (owner-requested). The CSS gives the
  // full curtain an opaque background so it covers the app even without an image.
  if (!SPLASH_BG_IMG && mode !== 'full') return;
  // Drive the placement off html[data-splash-bg] (+ --splash-bg on :root) so the CSS can target the splash block
  // (content), the whole content column (fill), or a fixed full-viewport overlay (full) from one switch.
  const root = document.documentElement;
  root.setAttribute('data-splash-bg', mode);
  // full-mode curtain with no image: the layout + the card/pattern appearance still apply; only the image
  // var is skipped (leaving it unset also invalidates the dim gradient declaration, so nothing darkens the
  // opaque curtain color). content/fill never reach here without an image (the early return above).
  if (SPLASH_BG_IMG) {
    root.style.setProperty('--splash-bg', `url("${SPLASH_BG_IMG}")`);
    const dim = (100 - normalizeBgOpacity(lsItem('gbti-splash-bg-opacity'))) / 100; // higher opacity = brighter image
    root.style.setProperty('--splash-bg-dim', `rgba(0,0,0,${dim.toFixed(2)})`);
  }
  root.style.setProperty('--card-op', (normalizeBgOpacity(lsItem('gbti-splash-bg-card-op'), 70) / 100).toFixed(2));
  root.style.setProperty('--card-blur', `${normalizeCardBlur(lsItem('gbti-splash-bg-card-blur'))}px`);
  const pattern = normalizeBgPattern(lsItem('gbti-splash-bg-pattern'));
  const pat = $('[data-splash-pattern]');
  if (pat && pattern !== 'none') {
    pat.classList.add(`p-${pattern}`);
    // The pattern opacity (--pat-op, 0..1; default 3%) + the dots/scanlines spacing (--pat-gap, px) are tunable.
    pat.style.setProperty('--pat-op', (normalizeBgOpacity(lsItem('gbti-splash-bg-pattern-op'), 3) / 100).toFixed(2));
    pat.style.setProperty('--pat-gap', `${normalizePatternGap(lsItem('gbti-splash-bg-pattern-gap'))}px`);
    if (pattern === 'ascii') {
      const pre = document.createElement('pre');
      pre.textContent = (lsItem('gbti-splash-bg-ascii-text') || '').trim() || GBTI_ASCII; // custom text, else the GBTI logo
      pat.appendChild(pre);
      const anchor = asciiAnchor(lsItem('gbti-splash-bg-ascii-pos')); // cardinal position (default bottom-right)
      pat.style.alignItems = anchor.alignItems;
      pat.style.justifyContent = anchor.justifyContent;
    }
  }
}

async function loadSplashBg() {
  try { const r = await chrome.storage?.local?.get?.(SPLASH_BG_IMAGE_KEY); SPLASH_BG_IMG = r?.[SPLASH_BG_IMAGE_KEY] || null; }
  catch { SPLASH_BG_IMG = null; }
  if (!$('[data-splashview]')?.hidden) applySplashBg(); // re-apply if the splash is already up (the image just landed)
}

/** Reflect the active view mode onto the switcher buttons. */
function syncModeButtons() {
  document.querySelectorAll('.nt-mode').forEach((b) => b.classList.toggle('on', b.dataset.mode === MODE));
}

/** Reflect the active type filter onto the chip-row (SOW-042). */
function syncTypeButtons() {
  document.querySelectorAll('.nt-type').forEach((b) => b.classList.toggle('on', b.dataset.type === TYPE));
}

/** Switch the active type filter (shared by the chip-row clicks AND the rail's #type=<X> hash shortcuts). Lazily
 *  loads Shares/News the first time they are needed, then re-renders. A no-op if the filter is unchanged. */
function selectType(next) {
  if (!TYPE_FILTERS.has(next) || next === TYPE) return;
  TYPE = next;
  // SOW-105: remember the section (the guard above keeps junk + no-ops out) and re-resolve its view mode.
  try { localStorage.setItem(LAST_SECTION_KEY, next); } catch (e) { /* storage unavailable */ }
  resolveMode();
  syncTypeButtons();
  syncModeButtons(); // each section shows its OWN remembered mode the moment you switch
  setRailActive(railKeyForType(TYPE)); // keep the left rail in lockstep with the chips + feed
  closeReader(); // switching filter returns from the reader to the feed
  // Render IMMEDIATELY with whatever is already loaded (member activity + any cached news) — no blank "Loading...".
  renderFeed($('[data-filter]')?.value || '');
  // Then refresh the sources this view needs in the BACKGROUND; each re-renders (re-sorts) the list when it lands.
  ensureSharesForFilter();
  ensureNewsForFilter();
  ensureDirectoryForFilter();
}

/** SOW-111 QA fix: lazily load the ACTIVE content type's full per-type index (uncapped, SOW-031) so the
 *  Articles/Products/Prompts views show everything, not the capped river's slice. Cached per type; a failed
 *  fetch leaves the capped fallback in place and retries on the next visit to that view. */
async function ensureDirectoryForFilter() {
  const t = TYPE;
  if (!(t in DIRECTORY) || DIRECTORY[t] || DIRECTORY_LOADING.has(t)) return;
  DIRECTORY_LOADING.add(t);
  try {
    const res = await fetch(`${SITE}/${DIRECTORY_URL[t]}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    DIRECTORY[t] = Array.isArray(data?.items) ? data.items : [];
    if (TYPE === t) renderFeed($('[data-filter]')?.value || '');
  } catch { /* keep the capped fallback; the next visit retries */ }
  finally { DIRECTORY_LOADING.delete(t); }
}

/** Load Shares for any caller and let the SERVER be the boundary (SOW-077 + the build-22 fix). The op + mergeAll
 *  filter by tier: paid/trial see member + public shares; a free/banned/UNKNOWN reader gets PUBLIC shares only
 *  (never a hard [] while membership is still resolving). May re-load: a membership upgrade re-fetches to fold in
 *  the member stream, and a failed/non-array fetch leaves it unloaded so the next ensure retries. A truly
 *  signed-out caller (no identity) simply gets no items. */
async function loadShares() {
  // ALWAYS fetch: the SERVER is the visibility boundary (operations.listShares requires an identity, then returns
  // only PUBLIC shares to a non-paid/unknown session and the full stream to paid/trialing). Fetching while
  // MEMBERSHIP is still 'unknown' therefore shows the PUBLIC shares immediately rather than a blank feed, and the
  // membership-resolved retry re-fetches to fold in the member-only stream. Mark loaded (and record the tier it
  // was loaded under) only on a SUCCESSFUL fetch, so a transient failure or a later upgrade re-fetches.
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/shares', query: {} } });
    if (!Array.isArray(r?.json?.items)) { devlog('shares', 'fetch returned no items array, keeping prior + retrying', { membership: MEMBERSHIP, error: r?.json?.error }); SHARES = SHARES ?? []; return; } // failure/no identity -> keep any prior, allow retry
    SHARES = r.json.items;
    SHARES_LOADED = true;
    SHARES_LOADED_AT = MEMBERSHIP;
    devlog('shares', 'loaded', { count: SHARES.length, membership: MEMBERSHIP });
  } catch (e) { devlog('shares', 'fetch threw, will retry', { error: e?.message }); /* leave SHARES_LOADED false so the next ensure re-fetches */ }
}

/** If the active filter needs Shares and they are not loaded (or were loaded under a lower tier than the now
 *  resolved one, so the member-only stream is still missing), fetch them, then re-render the feed. */
async function ensureSharesForFilter() {
  if (!feedSources(TYPE).wantShares) return;
  const stale = SHARES_LOADED && SHARES_LOADED_AT !== MEMBERSHIP && canSeeShares(MEMBERSHIP);
  if (SHARES_LOADED && !stale) return;
  await loadShares();
  renderFeed($('[data-filter]')?.value || '');
}

// News cache (chrome.storage.local): news is the SAME curated feed for every paid member (not per-member), so we
// persist the last good fetch and re-hydrate it on the next new tab for an INSTANT first paint — the network
// refresh then re-sorts the list in place instead of showing a blank "Loading...". Render stays paid-gated.
const NEWS_CACHE_KEY = 'gbti-news-cache';
async function readNewsCache() {
  try { const r = await chrome.storage?.local?.get?.(NEWS_CACHE_KEY); const c = r?.[NEWS_CACHE_KEY]; return Array.isArray(c?.items) ? c.items : null; }
  catch { return null; }
}
function writeNewsCache(items) {
  try { chrome.storage?.local?.set?.({ [NEWS_CACHE_KEY]: { items, at: Date.now() } }); } catch { /* storage unavailable */ }
}

/** Load the member's News once (SOW-043 / SOW-060). News is a FREE-tier perk: the Worker allows any signed-in,
 *  non-banned member, so attempt for any signed-in member (canSeeNews); a locked/banned account fails-closed to [].
 *  Rides /api/news via the background (the key stays in the Worker). A successful fetch updates the cache; an
 *  empty/failed fetch KEEPS the already-hydrated cache (no blanking). */
async function loadNews() {
  NEWS_LOADED = true;
  if (!canSeeNews(MEMBERSHIP)) { NEWS = []; return; }
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/news', query: { limit: 60 } } });
    const items = Array.isArray(r?.json?.items) ? r.json.items : [];
    if (items.length) { NEWS = items; writeNewsCache(items); }
    else if (!Array.isArray(NEWS)) NEWS = []; // empty AND no cache hydrated -> []
  } catch {
    if (!Array.isArray(NEWS)) NEWS = []; // network failure AND no cache -> []; otherwise keep the cached items
  }
}

/** If the active filter needs News and it is not loaded yet, fetch it, then re-render the feed. */
async function ensureNewsForFilter() {
  if (feedSources(TYPE).wantNews && !NEWS_LOADED) {
    await loadNews();
    renderFeed($('[data-filter]')?.value || '');
  }
}

/** Load the caller's follow list from the background worker (SOW-060: a free-tier perk, signed-in). Sets FOLLOWING to a Set, or null. */
async function loadFollows() {
  FOLLOWS_LOADED = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/follows', query: {} } });
    const list = Array.isArray(r?.json) ? r.json : (Array.isArray(r?.json?.following) ? r.json.following : null);
    FOLLOWING = list ? new Set(list.map((f) => String(f?.username || '').toLowerCase()).filter(Boolean)) : null;
  } catch {
    FOLLOWING = null;
  }
}

/** SOW-046 E / SOW-060: load the member's followed news channels (source ids) from prefs (a free-tier perk, signed-in). Set, or null. */
async function loadPrefs() {
  PREFS_LOADED = true;
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/prefs', query: {} } });
    const chans = Array.isArray(r?.json?.followedChannels) ? r.json.followedChannels : null;
    FOLLOWED_CHANNELS = chans ? new Set(chans.map((c) => String(c).toLowerCase())) : null;
  } catch { FOLLOWED_CHANNELS = null; }
}

async function loadActivity() {
  const status = $('[data-feed-status]');
  try {
    const res = await fetch(`${SITE}/activity-index.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    ENTRIES = Array.isArray(data?.entries) ? data.entries : [];
    renderFeed($('[data-filter]')?.value || '');
  } catch {
    if (status) status.innerHTML = `Could not load the latest activity. <a href="${SITE}/" style="color:var(--green-700)">Open the co-op</a> instead.`;
  }
}

/** GET /api/* via the background worker; null on any failure. (The setup banner needs status + onboarding.) */
async function api(pathname) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query: {} } });
    return r?.json ?? null;
  } catch { return null; }
}

const WELCOME_SEEN_KEY = 'gbti-welcome-seen';
// SOW-029 fix: the post-setup welcome (join Discord + follow members) was reachable ONLY via the onboarding wizard's
// "Complete Integration" click, so a member who reached the new tab any other way never saw it. Show it ONCE on the
// first new-tab open for ANY signed-in member -- it is COMMUNITY onboarding (Discord + follow), so it is NOT gated on
// the publish setup (fork + install). The flag is set on SHOW (so it never nags and survives an abandon); the
// onboarding-wizard path checks + sets the same flag, so the two never double up.
function maybeShowWelcome(signedIn) {
  let seen = false;
  try { seen = localStorage.getItem(WELCOME_SEEN_KEY) === '1'; } catch { /* no storage */ }
  if (!signedIn || seen || document.querySelector('.nt-welcome-overlay')) return;
  try { localStorage.setItem(WELCOME_SEEN_KEY, '1'); } catch { /* no storage */ }
  const overlay = document.createElement('div');
  overlay.className = 'nt-welcome-overlay';
  overlay.style.cssText = 'position:fixed; inset:0; z-index:1200; overflow:auto; background:var(--bg,#0d1117); display:flex; justify-content:center; padding:48px 16px;';
  const w = document.createElement('gbti-welcome');
  w.style.cssText = 'width:100%; max-width:1080px; align-self:center;'; // the redesigned two-pane welcome panel
  // Finish on the Profile page (banner + staged-socials prefill), matching the onboarding-wizard path.
  w.addEventListener('gbti:welcome-done', () => { window.location.href = chrome.runtime.getURL('profile.html') + '?welcome=1'; });
  overlay.appendChild(w);
  document.body.appendChild(overlay);
}

// SOW-026/029: the onboarding setup banner. Shown until the member is signed in AND set up (fork + GBTI App
// install). The shell owns the account control + identity; this only drives the banner.
async function loadSetupBanner() {
  const [status, ob] = await Promise.all([api('/api/status'), api('/api/onboarding-status')]);
  const signedIn = Boolean(status?.authenticated && status?.identity?.login);
  const ready = ob ? (ob.ready || (ob.appMode === false && signedIn)) : signedIn;
  maybeShowWelcome(signedIn); // first-run welcome, independent of the wizard's button + the publish setup
  const setup = $('[data-setup]');
  if (!setup) return;
  if (ready) { setup.classList.remove('show'); return; }
  const txt = setup.querySelector('[data-setup-txt]');
  const go = setup.querySelector('[data-setup-go]');
  if (!signedIn) {
    if (txt) txt.innerHTML = `<b>Sign in to publish</b><span>Connect GitHub to write and publish your work on GBTI Network.</span>`;
    if (go) go.textContent = 'Get started';
  } else {
    const step = ob?.activeStep === 'fork' ? 2 : ob?.activeStep === 'install' ? 3 : 1;
    if (txt) txt.innerHTML = `<b>Finish setting up publishing</b><span>Step ${step} of 3. Make your copy and give access to start publishing.</span>`;
    if (go) go.textContent = 'Finish setup';
  }
  setup.classList.add('show');
}

// SOW-077: resolve the member's effective tier, then drive the read-only upgrade prompt. A ban is a COMMUNITY ban,
// not total, so EVERY signed-in account (free / lapsed / banned) now BROWSES the read-only feed; the old full-screen
// renew wall is gone. The server is the boundary (KV writes + member content are still denied below the right tier);
// the per-action controls hide off their predicates, and a free/lapsed tier additionally sees a soft upgrade banner.
async function applyMembershipState() {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/status', query: {} } });
    MEMBERSHIP = r?.json?.membership ?? 'unknown'; // SOW-042: drives the feed's Shares (public-vs-member) + News visibility
    devlog('membership', 'applied to the feed', { membership: MEMBERSHIP, role: r?.json?.role });
  } catch (e) { MEMBERSHIP = 'unknown'; devlog('membership', 'status fetch failed, read-only feed', { error: e?.message }); /* worker unreachable -> fail open to a read-only feed */ }
  showUpgradeBanner();
}

// SOW-077: the read-only upgrade banner. Shown only for the free ('join') / lapsed ('renew') tier; banned + active
// members see nothing. Dismiss snoozes it for a week so it stays a prompt, not a nag.
const UPGRADE_SNOOZE_KEY = 'gbti-upgrade-snooze';
const UPGRADE_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
function showUpgradeBanner() {
  const el = $('[data-upgrade]');
  if (!el) return;
  const kind = upgradePromptKind(MEMBERSHIP);
  if (!kind) { el.classList.remove('show'); return; }
  let snoozedUntil = 0;
  try { snoozedUntil = Number(localStorage.getItem(UPGRADE_SNOOZE_KEY)) || 0; } catch (e) {}
  if (Date.now() < snoozedUntil) return;
  const txt = $('[data-upgrade-txt]');
  const cta = $('[data-upgrade-cta]');
  if (kind === 'renew') {
    if (txt) txt.textContent = 'Your membership has lapsed, so you are browsing in read-only mode. Renew to save, follow, unlock member-only content, and publish again.';
    if (cta) cta.textContent = 'Renew membership';
  } else {
    if (txt) txt.textContent = 'You are browsing in read-only mode. Join GBTI to save, follow, unlock member-only content, and publish.';
    if (cta) cta.textContent = 'Join GBTI';
  }
  el.classList.add('show');
  el.querySelector('[data-upgrade-dismiss]')?.addEventListener('click', () => {
    el.classList.remove('show');
    try { localStorage.setItem(UPGRADE_SNOOZE_KEY, String(Date.now() + UPGRADE_SNOOZE_MS)); } catch (e) {}
  }, { once: true });
}

// One-time tip about Chrome's own new-tab footer (Chrome 138+). CSP-safe (no inline handler).
const FOOTERTIP_KEY = 'gbti-footertip-dismissed';
function initFooterTip() {
  const el = $('[data-footertip]');
  if (!el) return;
  let dismissed = false;
  try { dismissed = localStorage.getItem(FOOTERTIP_KEY) === '1'; } catch (e) {}
  if (dismissed) return;
  el.classList.add('show');
  el.querySelector('[data-footertip-dismiss]')?.addEventListener('click', () => {
    el.classList.remove('show');
    try { localStorage.setItem(FOOTERTIP_KEY, '1'); } catch (e) {}
  });
}

function init() {
  // Register the messaging-backed GbtiClient so the shell's "+" composer (and any client-ui element) works on the
  // new tab too; the feed itself still talks to the background worker directly.
  mountPageClient();
  // SOW-063: resolve the landing BEFORE initShell (so the rail highlight matches). A bare tab (no hash) shows the
  // splash unless snoozed within the window. SOW-105: the landing section obeys one precedence everywhere,
  // explicit hash > remembered last section > snoozed splash dest > 'all', and applies even when the splash will
  // show (the feed renders BEHIND the overlay, so lifting the splash reveals the remembered section already there).
  const splashBare = !hashStr();
  const splashDecision = readSplashDecision();
  const wantSplash = splashBare && shouldShowSplash(splashDecision, Date.now(), splashWindowMs());
  TYPE = landingType({ hash: hashStr(), remembered: storedLastSection(), splashDest: splashDecision?.dest });
  try { localStorage.removeItem(LEGACY_MODE_KEY); } catch (e) { /* storage unavailable */ }
  resolveMode(); // SOW-105: per-section MODE, now that the landing TYPE is final
  // The shared shell injects the left rail (feed variant: search + Latest/Following on top) + the control cluster
  // (theme, apps, account, "+") into the greeting's top-right, and fills the page's [data-ico] glyphs. The rail
  // item highlighted is derived from the active TYPE (railKeyForType); selectType keeps it in sync thereafter.
  initShell({ active: railKeyForType(TYPE), nav: 'feed' });
  // SOW-052: relocate the view-mode switch into the control cluster's slot (a DOM move; the .nt-mode click wiring
  // below still finds it by selector).
  const modesEl = $('.nt-greet .nt-modes');
  const modesSlot = $('[data-modes-slot]');
  if (modesEl && modesSlot) modesSlot.appendChild(modesEl);

  const greetEl = $('[data-greeting]');
  if (greetEl) greetEl.textContent = greeting();
  const dateEl = $('[data-date]');
  if (dateEl) dateEl.textContent = longDate();

  syncModeButtons();
  syncTypeButtons();
  initFooterTip();
  initVersionIndicator();
  // SOW-077: status drives the read-only upgrade banner + the feed's Shares (public-vs-member) + News visibility;
  // once it resolves, pull whatever the default/persisted filter needs and re-render. No hard lock anymore.
  applyMembershipState().then(() => { ensureSharesForFilter(); ensureNewsForFilter(); });
  ensureDirectoryForFilter(); // a #type=<content> deep link starts on a directory view
  // Hydrate the news cache for an INSTANT first paint (a #type=news tab shows the last-known news while the live
  // fetch runs); skip if a fresh fetch already landed. Render gating is canSeeNews (SOW-077: any signed-in member,
  // including banned), and a signed-out visitor is held by the forced-sign-in gate. The live loadNews re-sorts in place.
  readNewsCache().then((cached) => { if (cached && !NEWS_LOADED) { NEWS = cached; renderFeed($('[data-filter]')?.value || ''); } });
  loadSetupBanner();

  // The setup banner opens the onboarding tab (sign in -> fork -> install).
  $('[data-setup]')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs?.create
      ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
      : window.open(chrome.runtime.getURL('onboarding.html'), '_blank');
  });

  // SOW-039/105: the view-mode switcher. Persists PER SECTION, so a change sticks to the section it was
  // made in (Prompts can stay compact while Articles stay cards). Re-renders in place.
  document.querySelectorAll('.nt-mode').forEach((b) => b.addEventListener('click', () => {
    MODE = b.dataset.mode;
    try { localStorage.setItem(viewKey(TYPE), MODE); } catch (e) {}
    syncModeButtons();
    renderFeed($('[data-filter]')?.value || '');
  }));

  // SOW-042/043: the type filter chip-row (All / Articles / Products / Prompts / Shares / News). Persist +
  // re-render; selecting All/Shares lazily loads Shares, All/News lazily loads News, the first time.
  document.querySelectorAll('.nt-type').forEach((b) => b.addEventListener('click', () => selectType(b.dataset.type)));

  // SOW-063: the landing splash cards. Activity/News switch the main column IN PLACE (snoozing that destination so
  // the next bare tab skips straight to it); WorkBench navigates to its own page (it leaves the new tab, so it does
  // not become a new-tab default). Setting the hash drives the existing hashchange handler (selectType + rail).
  document.querySelectorAll('[data-splash-go]').forEach((b) => b.addEventListener('click', () => {
    const dest = b.dataset.splashGo;
    if (dest === 'workbench') { window.location.href = chrome.runtime.getURL('workspace.html'); return; }
    snoozeSplash(dest);
    hideSplash();
    location.hash = splashDestHash(dest);
  }));
  // SOW-074: in the full-screen NO-CARDS curtain, a click ANYWHERE on the splash enters the app (the activity feed).
  // When cards are shown they are display:none-free and handle their own clicks, and this guard is a no-op.
  $('[data-splashview]')?.addEventListener('click', () => {
    if (!document.documentElement.hasAttribute('data-splash-nocards')) return;
    snoozeSplash('activity');
    hideSplash();
    location.hash = splashDestHash('activity');
  });
  loadQuotes(); // SOW-063 P2: hydrate + refresh the git-native quote pool (the splash shows a bundled quote until it lands)
  loadSplashBg(); // SOW-074: read the uploaded splash background (applied when the splash is shown)
  if (wantSplash) showSplash();

  // The rail's Browse shortcuts (newtab.html#type=<X>) switch the filter when clicked while already on the feed; a
  // bell deep-link (#tab=<type>&read=<path>) also auto-opens that item in the in-place reader. A hash that drops
  // the type (back to a bare or typeless fragment) resets to 'all' (typeForHash), so the river is reachable
  // without a full reload too.
  window.addEventListener('hashchange', () => {
    const h = hashStr();
    if (!h) { showSplash(); return; } // SOW-063: Back to the bare tab returns to the splash
    hideSplash();
    // SOW-143: a member deep link opens the member view and RETURNS EARLY, so the feed underneath never re-narrows.
    const mem = parseMemberHash(h);
    if (mem) { openMember(mem); return; }
    const t = typeForHash(h);
    selectType(t);
    const rd = readFromHash();
    if (rd) {
      const act = doFromHash();
      if (act) consumeDo();
      if (t === 'share') window.gbtiOpenShareBySlug(rd);
      else openReader({ type: t, path: rd, doAction: act });
    }
  });

  // SOW-092: a SHARE deep link (#tab=share&read=<author>/<id>) resolves against the Shares stream, which loads
  // async; retry briefly until it lands (fail-soft to the filtered feed when the share is gone). DEFINED HERE,
  // before the first-load deep-read block below that may call it immediately: it was previously assigned AFTER
  // that call, so opening the new tab on a share deep-link threw "gbtiOpenShareBySlug is not a function".
  window.gbtiOpenShareBySlug = (slug, tries = 20) => {
    const found = Array.isArray(SHARES) ? SHARES.find((x) => `${x.author}/${x.id}` === slug) : null;
    if (found) { openReader({ ...found, type: 'share' }); return; }
    if (tries > 0) setTimeout(() => window.gbtiOpenShareBySlug(slug, tries - 1), 300);
  };

  // A bell deep-link present on first load opens that item straight into the in-place reader (the feed still
  // renders underneath, so Back reveals it). The reader resolves the title/body from the path via the client.
  // SOW-143: a member deep link (the site's follow relay) opens the member view instead. It is self-loading, so
  // unlike the share resolver it needs no retry loop against an async array.
  const deepMember = memberFromHash();
  if (deepMember) {
    openMember(deepMember);
  } else {
    const deepRead = readFromHash();
    if (deepRead) {
      const act = doFromHash();
      if (act) consumeDo();
      if (TYPE === 'share') window.gbtiOpenShareBySlug(deepRead);
      else openReader({ type: TYPE, path: deepRead, doAction: act });
    }
  }

  // SOW-052: the feed search is now a persistent input in the left rail (shell-rendered). Filter the feed in place
  // on input; Escape clears it. No collapse toggle anymore.
  const srchIn = $('[data-filter]');
  srchIn?.addEventListener('input', (e) => renderFeed(e.target.value));
  srchIn?.addEventListener('keydown', (e) => { if (e.key === 'Escape') { srchIn.value = ''; renderFeed(''); srchIn.blur(); } });

  // The in-place reader's Back button returns to the feed.
  $('[data-reader-back]')?.addEventListener('click', onReaderBack);

  // SOW-023: Latest / Following tabs.
  document.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const view = btn.getAttribute('data-tab');
      if (view === VIEW) return;
      VIEW = view;
      document.querySelectorAll('[data-tab]').forEach((b) => {
        const on = b === btn;
        b.classList.toggle('on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      const q = $('[data-filter]')?.value || '';
      // News only appears in the News view now, so Following loads news ONLY when the current view wants it
      // (TYPE==='news'); on Activity it loads just the followed members + channels for the member-content filter.
      const wantN = feedSources(TYPE).wantNews;
      if (VIEW === 'following' && (!FOLLOWS_LOADED || !PREFS_LOADED || (wantN && !NEWS_LOADED))) {
        const feed = $('[data-feed]');
        if (feed) feed.innerHTML = '<p class="muted">Loading the people + channels you follow...</p>';
        await Promise.all([FOLLOWS_LOADED ? null : loadFollows(), PREFS_LOADED ? null : loadPrefs(), (wantN && !NEWS_LOADED) ? loadNews() : null]);
      }
      renderFeed(q);
    });
  });

  if (document.documentElement.getAttribute('data-off') !== '1') loadActivity();

  // Re-check the setup banner when the member returns to this tab (e.g. after forking in another tab).
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loadSetupBanner(); });
  // SOW-092: a share posted from the shell "+" modal opens IMMEDIATELY in the page reader (the composer
  // emits a reader-ready optimistic item; SOW-076 instant-feel). Claiming the event stops the shell's
  // no-reader fallback from also navigating to shares.html.
  document.addEventListener('gbti-share-posted', (e) => {
    const item = e?.detail?.item;
    if (!item) return;
    if (e.detail) e.detail.handled = true;
    openReader(item);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
