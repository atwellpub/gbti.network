// sow-273 follow-up: digest click counting, the PURE half.
//
// WHY THIS EXISTS AT ALL. The digest tags its own links with utm_source/medium/campaign/content, and on
// 2026-08-24 it was established that Cloudflare Web Analytics CANNOT read them: introspecting its GraphQL
// schema across all 38 RUM types and 1,234 field names turned up no query-string field anywhere. A URL is
// stored as host, path and scheme only. The beacon sends the whole address and the query is discarded before
// storage. So the tags are collected and thrown away, and measuring the digest needs our own counter.
//
// THE OWNER DECIDED (2026-08-24) THAT NEWS LINKS ARE COUNTED TOO, not just links back to gbti.network. That
// is the single most useful signal a curated digest produces, because it says which sources earn their
// place. It also means this route redirects to THIRD-PARTY urls, which is what makes the next paragraph the
// most important one in the file.
//
// OPEN REDIRECT IS THE WHOLE THREAT MODEL, AND IT IS CLOSED BY CONSTRUCTION RATHER THAN BY FILTERING.
// A link carries an issue id, a placement, and a SLOT, which is a short hash of the destination. It does not
// carry the destination. The Worker loads the FROZEN issue, recomputes the slot for every url that issue
// legitimately contains, and redirects only to the one that matches. There is no input from which an
// arbitrary target can be constructed, so there is no filter to get wrong and no allowlist to fall behind.
// A tampered slot resolves to nothing and the reader is sent to the site root.
// The hash is therefore NOT a security primitive and does not need to be unguessable or collision-proof: an
// attacker who guesses a slot redirects a reader to another link from the same newsletter. It is a lookup
// key, so it is a plain synchronous FNV-1a, which keeps the renderer synchronous (crypto.subtle is async and
// making the whole template async to hash a string would be a poor trade).
//
// NO RECIPIENT IDENTITY IS RECORDED, EVER. Not a hash, not an address, not an IP, not a user agent. The
// counter answers "how many clicks did this placement get in this issue", which is the question worth
// asking, and refuses to be able to answer "did this person click", which is the one that turns a counter
// into surveillance and drags the whole store into a data-protection question it does not need to be in.

/**
 * Where each section's "see all" link points. THIS IS THE ONE DEFINITION and mail-render imports it from
 * here rather than keeping its own copy. Two copies would drift, and the drift would be silent in the worst
 * possible way: the renderer would emit a link whose target is not in the candidate set, so a perfectly
 * legitimate click would resolve to nothing and bounce the reader to the site root, looking exactly like a
 * tampered link.
 */
export const SECTION_FEED = Object.freeze({
  article: '/feeds/articles/', product: '/feeds/products/', prompt: '/feeds/prompts/',
  share: '/feeds/shares/', news: '/feeds/news/',
});

/** Where a non-item placement points. Fixed, server-side, and part of the candidate set like anything else. */
export const FIXED_TARGETS = Object.freeze({
  masthead: '/',
  archive: '/feeds/',
  'membership-cta': '/membership/',
  'footer-home': '/',
  'footer-feed': '/feeds/',
  'section-feed': '/feeds/',
});

/**
 * FNV-1a, 32-bit, as 8 lowercase hex. A LOOKUP KEY, not a signature; see the header.
 *
 * IT MUST BE FED THE PLAIN ABSOLUTE URL, never the tagged one. The renderer and the route both derive their
 * candidates from the frozen issue via candidateTargets, which yields plain absolute urls; hashing a tagged
 * url on one side would make every internal link unresolvable while every external link kept working, which
 * is a confusing enough half-failure to be worth this note.
 */
export function clickSlot(url) {
  const s = String(url ?? '');
  if (!s) return '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The site the digest links into. ONE EXPRESSION, EVALUATED ON BOTH SIDES OF THE ROUND TRIP.
 *
 * The renderer hashes a destination and the route re-hashes the same destination to find it again, so a base
 * that differs by ONE CHARACTER between them makes every internal link in an issue unresolvable while every
 * external link keeps working. The trailing slash is stripped for exactly that reason: mail-render's absUrl
 * CONCATENATES base and path rather than joining them as URLs, so a base ending in `/` yields `//feeds/`.
 */
export const SITE_URL_DEFAULT = 'https://gbti.network';
export function resolveSiteUrl(env) {
  return String(env?.SITE_URL ?? '').trim().replace(/\/+$/, '') || SITE_URL_DEFAULT;
}

/**
 * The origin serving the click route, or '' when it cannot be built.
 *
 * PUBLIC_BASE_URL, which is the Worker's own origin and is ALREADY a hard precondition of sending at all: the
 * drain refuses to send a single message without it, because that is where the one-click unsubscribe lives.
 * So a message that goes out is guaranteed to have a working click base, and '' here means the drain already
 * refused, never that links silently degraded.
 */
export function resolveClickBase(env) {
  return String(env?.PUBLIC_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

/**
 * Absolute form of a url against the site, or '' when it cannot be one.
 *
 * THE CONCATENATION IS DELIBERATE AND MUST NOT BECOME A `new URL()` JOIN. mail-render's absUrl builds its
 * links by concatenating, and this function's whole job is to reproduce, character for character, the string
 * that the renderer hashed. A URL join is the more correct way to combine a base and a path, and adopting it
 * here would make this function right and the round trip broken, which is the worse outcome and would present
 * as internal links bouncing to the homepage for reasons nobody could see in either file alone.
 */
export function absolute(url, siteUrl) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('/')) return '';
  return `${String(siteUrl ?? '')}${raw}`;
}

/**
 * Every url this issue may legitimately send a reader to.
 *
 * SECTION FEED LINKS ARE INCLUDED PER SECTION, not just as the bare '/feeds/', because sectionHtml points at
 * /feeds/<type>/ and a candidate set that omits them would silently degrade those links to an unresolved
 * bounce, which looks exactly like a tampered link and would be blamed on the reader's mail client.
 */
export function candidateTargets(issue, siteUrl, sectionFeeds = SECTION_FEED) {
  const out = new Set();
  const add = (u) => { const a = absolute(u, siteUrl); if (a) out.add(a); };
  for (const p of Object.values(FIXED_TARGETS)) add(p);
  for (const p of Object.values(sectionFeeds)) add(p);
  // LAYOUT FIRST, because layout is what the renderer actually renders from. sections/topNews are the
  // composition core's inputs and `layout` is derived from them, so today the three agree; walking the derived
  // structure as well as its sources means a future projection step that rewrites a url on the way into layout
  // cannot silently make every item link in an issue unresolvable. It is a set, so the overlap costs nothing.
  for (const s of issue?.layout ?? []) {
    for (const it of s?.items ?? []) add(it?.url);
  }
  for (const items of Object.values(issue?.sections ?? {})) {
    for (const it of items ?? []) add(it?.url);
  }
  for (const n of issue?.topNews ?? []) add(n?.url);
  return out;
}

/**
 * Resolve a slot to a destination, or null.
 *
 * Null is the SAFE answer and callers must treat it as "send them to the site root", never as "use whatever
 * was in the request". Returning null happens for a tampered slot, for an issue pruned out of KV, and for a
 * link in an issue whose content changed, and all three are indistinguishable from here on purpose.
 */
export function resolveClick(issue, siteUrl, slot, sectionFeeds = SECTION_FEED) {
  const want = String(slot ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(want)) return null;
  for (const url of candidateTargets(issue, siteUrl, sectionFeeds)) {
    if (clickSlot(url) === want) return url;
  }
  return null;
}

export const UTM_SOURCE = 'digest';
export const UTM_MEDIUM = 'email';

/**
 * The utm-tagged form of an absolute url.
 *
 * ONE IMPLEMENTATION, USED BY BOTH SIDES. The renderer needs it when no click counter is configured, and the
 * click route needs it to build the destination it finally redirects to. Two copies would drift, and the
 * drift would show up as tags that exist in some issues and not others with nothing to explain why.
 *
 * AN EXTERNAL URL IS RETURNED UNTOUCHED. Stamping our campaign onto a publisher's url writes our attribution
 * into their analytics and tells us nothing. Same-origin is decided against the resolved siteUrl rather than
 * a hardcoded host, so a staging render tags staging links.
 */
export function taggedTarget(abs, { siteUrl, campaign, placement } = {}) {
  const raw = String(abs ?? '');
  if (!raw) return '';
  let u; let site;
  try { u = new URL(raw); site = new URL(String(siteUrl ?? '')); } catch { return raw; }
  if (u.origin !== site.origin) return raw;
  u.searchParams.set('utm_source', UTM_SOURCE);
  u.searchParams.set('utm_medium', UTM_MEDIUM);
  if (campaign) u.searchParams.set('utm_campaign', String(campaign));
  if (placement) u.searchParams.set('utm_content', String(placement));
  return u.toString();
}

/** The path a digest link points at. The destination is deliberately absent from it. */
export function clickPath(issueId, placement, slot) {
  const id = encodeURIComponent(String(issueId ?? '').trim());
  const pl = encodeURIComponent(String(placement ?? '').trim() || 'unknown');
  const sl = encodeURIComponent(String(slot ?? '').trim());
  if (!id || !sl) return '';
  return `/c/${id}/${pl}/${sl}`;
}

/** Parse `/c/<issueId>/<placement>/<slot>`; null when it is not that shape. */
export function parseClickPath(pathname) {
  const m = /^\/c\/([^/]+)\/([^/]+)\/([^/]+)\/?$/.exec(String(pathname ?? ''));
  if (!m) return null;
  try {
    return { issueId: decodeURIComponent(m[1]), placement: decodeURIComponent(m[2]), slot: decodeURIComponent(m[3]) };
  } catch { return null; }
}

export const CLICK_PREFIX = 'mail:clicks:';
export const clickKey = (issueId) => `${CLICK_PREFIX}${issueId}`;

/** An empty aggregate. One record per issue, holding counts and nothing that identifies anybody. */
export function emptyClicks(issueId) {
  return { issueId: String(issueId ?? ''), total: 0, unresolved: 0, byPlacement: {}, bySlot: {}, firstAt: null, lastAt: null };
}

/**
 * Fold one click into the aggregate. Pure, so the race below is the caller's problem and is stated there.
 *
 * `resolved: false` still counts, under `unresolved`. A run of unresolved clicks means either a pruned issue
 * or somebody probing the route, and both are worth being able to see; silently dropping them would make the
 * route's only failure mode invisible.
 */
export function applyClick(record, { placement, slot, resolved = true, now = Date.now } = {}) {
  const at = Number(typeof now === 'function' ? now() : now);
  const r = record && typeof record === 'object'
    ? { ...emptyClicks(record.issueId), ...record, byPlacement: { ...(record.byPlacement ?? {}) }, bySlot: { ...(record.bySlot ?? {}) } }
    : emptyClicks('');
  const pl = String(placement ?? '').trim() || 'unknown';
  const sl = String(slot ?? '').trim();
  r.total += 1;
  if (!resolved) r.unresolved += 1;
  r.byPlacement[pl] = (r.byPlacement[pl] ?? 0) + 1;
  if (sl) r.bySlot[sl] = (r.bySlot[sl] ?? 0) + 1;
  if (!Number.isFinite(r.firstAt)) r.firstAt = at;
  r.lastAt = at;
  return r;
}
