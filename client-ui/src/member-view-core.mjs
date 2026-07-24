// SOW-143: pure helpers for the in-extension member profile detail view. No DOM, unit-tested. The element
// (gbti-member-view.mjs) fetches the three public per-type index JSONs (/blog,products,prompts-index.json) and
// filters each to the member's own content with these helpers, then hands the result to <gbti-card-list>.

const lc = (s) => String(s || '').toLowerCase();

// The content sections rendered on a member profile, in order. `type` matches the index-item `type` field and
// the reader/card `type`; `json` is the public index endpoint; `label` heads the section.
export const MEMBER_SECTIONS = Object.freeze([
  { type: 'post', json: 'blog-index.json', label: 'Articles' },
  { type: 'product', json: 'products-index.json', label: 'Products' },
  { type: 'prompt', json: 'prompts-index.json', label: 'Prompts' },
]);

/**
 * Filter a per-type index item list to a single member's content, newest-first, capped. Pure.
 * - Matches on `author` case-insensitively (the index `author` is the member-folder username).
 * - `gbti` / `house` never match a member username (house content is authored as 'gbti'); an empty username
 *   matches nothing.
 * - A dateless item (null/absent `publishedAt`) sorts LAST rather than producing NaN comparisons.
 * - The cap applies AFTER the sort, so the newest `cap` items survive.
 * @param {Array} items  raw index items ({ author, publishedAt, ... })
 * @param {string} username  the member folder username
 * @param {number} [cap=24]
 */
export function memberContent(items, username, cap = 24) {
  const u = lc(username);
  if (!u || u === 'gbti' || u === 'house' || !Array.isArray(items)) return [];
  const mine = items.filter((it) => it && lc(it.author) === u);
  mine.sort((a, b) => {
    const av = Number.isFinite(a?.publishedAt) ? a.publishedAt : -Infinity;
    const bv = Number.isFinite(b?.publishedAt) ? b.publishedAt : -Infinity;
    if (bv !== av) return bv - av; // newest first; dateless (-Infinity) sinks to the bottom
    return String(a?.title || '').localeCompare(String(b?.title || ''));
  });
  return mine.slice(0, Math.max(0, cap));
}
