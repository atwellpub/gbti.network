// SOW-166: the PURE projection behind /shares-index.json (src/pages/shares-index.json.ts). Extracted so the
// public-only leak guard is unit-tested with fixtures rather than only at build time, matching the
// buildActivityIndex pattern. Node-free: no astro imports, so a test drives it with plain { data } objects.
import { isPublicShare, feedTime, decodeEntities } from './home-feed.mjs';

/**
 * Project a list of share collection entries (each `{ data }`) into the newest-first public-shares index.
 *
 * The guard is isPublicShare (status published AND visibility public, fail closed): a members-only share, a
 * Mode B stub, or a draft is EXCLUDED here. This is the first of two guards; the digest composition core drops
 * any item whose visibility is not 'public' as well, so a leak would have to defeat both.
 *
 * @param {Array<{ data: any }>} entries  the `share` collection entries
 * @returns {Array<{ type:'share', slug, title, author, url, publishedAt, visibility:'public' }>}
 */
export function buildSharesIndex(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return list
    .filter((e) => isPublicShare(e?.data))
    .map((e) => {
      const d = e.data;
      const slug = `${d.author}/${d.id}`;
      return {
        type: 'share',
        slug,
        // The site-feed title resolution: the share's title, else its one-line description, else a neutral
        // default. decodeEntities unwinds OG-scraped entities (e.g. "A &#8211; B").
        title: decodeEntities(d.title ?? d.shortDescription ?? 'Shared a link'),
        author: d.author,
        url: `/shares/${slug}/`,
        publishedAt: feedTime(d) || null,
        visibility: 'public',
      };
    })
    .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
}
