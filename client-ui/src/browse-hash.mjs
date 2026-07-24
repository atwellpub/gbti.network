// SOW-031: pure helpers for the in-extension Browse deep-link hash (browse.html#tab=<type>&read=<encoded path>).
// The new-tab Latest/Following feed rows BUILD the hash (so a click opens the in-extension reader instead of
// navigating out to gbti.network); <gbti-browse> PARSES it on load to auto-open that item. No DOM, unit-tested so
// the build/parse round-trip stays in lockstep across the two call sites (newtab.mjs + gbti-browse.mjs).

// SOW-042: 'all' is the cross-type directory tab (browse.html#tab=all). buildReadHash is never called with 'all'
// (feed rows always deep-link a concrete type), so its 'post' fallback is unaffected; parseBrowseHash recognizing
// 'all' lets the rail's "All" link + the gbti-browse All tab round-trip.
const TAB_IDS = new Set(['all', 'post', 'product', 'prompt', 'share', 'news']);

// SOW-114: the bounded force-action set a deep-link may carry (do=). The public content pages send
// do=favorite|collect through the SOW-036 relay so a click on the site's inert Favorite/Save lands in the
// reader AND performs the action there. Anything outside the set parses to null (ignored).
const DO_ACTIONS = new Set(['favorite', 'collect']);

/** Build the location.hash fragment (WITHOUT the leading '#') for opening `path` of `type` in the reader.
 *  Falls back to a tab-only hash when there is no path (so the row still lands on the right Browse tab).
 *  SOW-114: an optional third arg appends a bounded force-action (do=favorite|collect). */
export function buildReadHash(type, path, doAction) {
  const t = TAB_IDS.has(type) ? type : 'post';
  if (!path) return `tab=${t}`;
  const act = DO_ACTIONS.has(doAction) ? `&do=${doAction}` : '';
  return `tab=${t}&read=${encodeURIComponent(path)}${act}`;
}

/** Parse a location.hash (with or without the leading '#') into { tab, read, action }. tab is null when
 *  absent/unknown (the caller defaults to 'post'); read is the decoded repo path or null; action is the
 *  bounded do= force-action (favorite|collect) or null. Malformed encoding falls back to the raw token
 *  rather than throwing. */
export function parseBrowseHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const tabM = s.match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
  const readM = s.match(/(?:^|&)read=([^&]+)/);
  const doM = s.match(/(?:^|&)do=([a-z]+)(?:&|$)/);
  const tab = tabM && TAB_IDS.has(tabM[1]) ? tabM[1] : null;
  let read = null;
  if (readM) {
    try { read = decodeURIComponent(readM[1]); } catch { read = readM[1]; }
  }
  const action = doM && DO_ACTIONS.has(doM[1]) ? doM[1] : null;
  return { tab, read, action };
}

/** SOW-114: the same hash with any do= force-action removed (one-shot semantics: the consumer replaces
 *  location.hash after acting so a refresh or hashchange never re-runs the action). Returns the fragment
 *  WITHOUT the leading '#'. */
export function stripDoParam(hash) {
  const s = String(hash || '').replace(/^#/, '');
  return s.split('&').filter((p) => !/^do=/.test(p)).join('&');
}

// SOW-143: the in-extension member profile DETAIL view is addressed by a DISTINCT `member=<username>` key, NOT
// `read=` (which everywhere else means "a repo path to read"). A username is not a path, and the separate key
// keeps the route self-describing AND skew-safe: an extension build that predates this route finds no `read=`
// and no tab it recognizes, so it falls through to the normal feed instead of erroring in the content reader.
// `member` is deliberately kept OUT of TAB_IDS/TYPE_FILTERS so parseBrowseHash(...) still returns all-null for a
// member hash (every existing feed/browse consumer no-ops on it).
const USERNAME_RE = /^[a-z0-9](?:-?[a-z0-9]){0,38}$/; // kebab, matches the member-folder / gbti-subscribe rule

/** Build the member-detail deep-link fragment (WITHOUT the leading '#') for `username`, or '' when the
 *  username is invalid (so a caller can fall back rather than emit a broken hash). Pure. */
export function buildMemberHash(username) {
  const u = String(username || '').trim().toLowerCase();
  return USERNAME_RE.test(u) ? `tab=member&member=${u}` : '';
}

/** The member username a hash targets, or null. Requires BOTH `tab=member` AND a valid `member=<u>`, so a
 *  stray `member=` on some other tab can never hijack the view. Accepts an optional leading '#'. Pure. */
export function parseMemberHash(hash) {
  const s = String(hash || '').replace(/^#/, '');
  if (!/(?:^|&)tab=member(?:&|$)/.test(s)) return null;
  const m = s.match(/(?:^|&)member=([^&]+)/);
  if (!m) return null;
  let u;
  try { u = decodeURIComponent(m[1]); } catch { u = m[1]; }
  u = u.toLowerCase();
  return USERNAME_RE.test(u) ? u : null;
}
