// sow-224: the "in the publishing queue" pending-share stub.
//
// After a member posts a Share it moves through fork -> PR -> the sow-005 gate auto-merge -> the Cloudflare
// Pages deploy, which is a few minutes end to end. The feed must say so honestly rather than presenting the
// Share as already live (the sow-092 auto-open-reader did the latter). This module is the SHARED, pure core:
// the copy, the per-host "Pull requests" link, and a small sessionStorage-backed store so the stub survives a
// reload and is evicted when the published item lands. Node-free and dependency-free so BOTH the client-ui
// shares feed AND the build-time site feed hook use it, and so it is unit-testable with an injected clock and
// store.

export const PENDING_KEY = 'gbti-pending-shares';
export const PENDING_MAX_AGE_MS = 15 * 60 * 1000; // backstop: drop a stub after about 15 minutes even if never evicted

// The copy lives in ONE place, mirrored from the gbti-discussion tombstone so every "it is queued" surface
// reads the same. No numeric promise beyond the deploy's real two to three minutes.
export const PENDING_NOTE = 'In the publishing queue. It publishes to the site in about 2 to 3 minutes.';
export const PENDING_LINK_TEXT = 'Track it under Pull requests';

/** The per-host PRs-section link. Website: /workbench/#tab=prs. Extension pages: workspace.html#tab=prs. */
export function prsHrefFor(host) {
  return host === 'extension' ? 'workspace.html#tab=prs' : '/workbench/#tab=prs';
}

/** The composite slug for a Share item: "<author>/<id>". Empty string when either part is missing. */
export function shareSlug(item) {
  const author = item && item.author;
  const id = item && item.id;
  return author && id ? `${author}/${id}` : '';
}

/** A readable title for the stub: the Share title, then its short description, then a neutral fallback. */
export function pendingTitle(item) {
  return (item && (item.title || item.shortDescription)) || 'Your share';
}

/** The display data for one pending stub, resolved per host. Pure. */
export function pendingStubView(entry, { host } = {}) {
  return {
    slug: entry.slug,
    title: entry.title || 'Your share',
    note: PENDING_NOTE,
    linkText: PENDING_LINK_TEXT,
    prsHref: prsHrefFor(host),
    prUrl: entry.prUrl || '',
  };
}

// ---- the sessionStorage-backed store (the store + clock are injectable, so the logic is pure in tests) ----

function defaultStore() {
  try { return typeof sessionStorage !== 'undefined' ? sessionStorage : null; } catch { return null; }
}

function read(store) {
  const s = store ?? defaultStore();
  if (!s) return {};
  try {
    const raw = s.getItem(PENDING_KEY);
    const o = raw ? JSON.parse(raw) : {};
    return o && typeof o === 'object' ? o : {};
  } catch { return {}; }
}

function write(store, map) {
  const s = store ?? defaultStore();
  if (!s) return;
  try {
    if (!Object.keys(map).length) s.removeItem(PENDING_KEY);
    else s.setItem(PENDING_KEY, JSON.stringify(map));
  } catch { /* private mode or quota: fail soft, the stub is optional */ }
}

/** Record a just-posted Share as pending. `item` is the composer's optimistic item; `prUrl` is its GitHub PR. */
export function rememberPending({ item, prNumber = null, prUrl = '' } = {}, { store, now = Date.now() } = {}) {
  const slug = shareSlug(item);
  if (!slug) return null;
  const map = read(store);
  // `visibility` is carried so the PUBLIC-only build-time feed hook can show a stub only for a public Share
  // (a members Share never lands in the public feed, so its stub belongs only to the member stream).
  const entry = { slug, author: item.author, id: item.id, title: pendingTitle(item), visibility: item.visibility || 'members', prNumber, prUrl, at: now };
  map[slug] = entry;
  write(store, map);
  return entry;
}

/** The live (non-expired) pending entries, newest first. Prunes expired entries from the store as it goes. */
export function livePending({ store, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  const map = read(store);
  const live = {};
  for (const slug of Object.keys(map)) {
    const e = map[slug];
    if (e && typeof e.at === 'number' && now - e.at < maxAgeMs) live[slug] = e;
  }
  if (Object.keys(live).length !== Object.keys(map).length) write(store, live);
  return Object.values(live).sort((a, b) => b.at - a.at);
}

/** Drop any pending entry whose slug now appears in the published stream (it has gone live), then return the
 *  remaining live entries. This is how the merged item evicts its own stub once the deploy lands. */
export function dropPublished(publishedSlugs, { store, now = Date.now(), maxAgeMs = PENDING_MAX_AGE_MS } = {}) {
  const published = new Set(publishedSlugs || []);
  const map = read(store);
  let changed = false;
  for (const slug of Object.keys(map)) {
    if (published.has(slug)) { delete map[slug]; changed = true; }
  }
  if (changed) write(store, map);
  return livePending({ store, now, maxAgeMs });
}

/** Remove one pending entry outright (a manual dismiss). */
export function clearPending(slug, { store } = {}) {
  const map = read(store);
  if (map[slug]) { delete map[slug]; write(store, map); }
}
