// sow-179: pure helpers for the three switchable article layouts (Editorial, Journal, Card). Mirrors
// src/lib/product-page.mjs's naming and shape for the same content-type-per-file convention, but kept as an
// independent module rather than extending product-page.mjs: the two content types diverge enough (no
// gallery/specs/pricing concept on an article, a different synthetic-anchor id) that sharing one function
// would mean threading product-only options through an article call site, or the reverse. Duplication here is
// deliberate, matching the same "new namespace over touching shared, tested, live code" call already made for
// the .art-* CSS prefix (see .data/sow/1_progressing/website/sow-179-article-switchable-layouts.md).

/** Below this many entries, a contents rail is not worth showing (matches product-page.mjs's own threshold). */
export const TOC_MIN_ENTRIES = 3;

/**
 * Build the Editorial/Journal contents-rail entries from a rendered article's H2 headings, the same shape
 * Astro's render() already returns for the published page. An "Overview" entry is prepended for the body
 * itself (pointing at ART_OVERVIEW_ID, the id every article layout puts on its body wrapper), and a
 * "Discussion" entry appended when the page has a comment thread, matching product-page.mjs's buildToc()
 * pattern minus the gallery concept an article does not have.
 *
 * Returns an empty list when the result would be too short to be worth a rail (the handoff's "under three
 * headings the contents rail collapses" behaviour, same rule as products).
 *
 * @param {{depth:number, slug:string, text:string}[]} headings  from Astro's render()
 * @param {{hasBody?:boolean, hasDiscussion?:boolean}} opts
 * @returns {{id:string, label:string}[]}
 */
export const ART_OVERVIEW_ID = 'art-overview';

export function buildArticleToc(headings, opts = {}) {
  const { hasBody = true, hasDiscussion = true } = opts;
  const body = (headings ?? [])
    .filter((h) => h && h.depth === 2 && h.slug && String(h.text ?? '').trim())
    .map((h) => ({ id: String(h.slug), label: String(h.text).trim() }));

  const taken = new Set(body.map((e) => e.id));
  const entries = [];
  if (hasBody) entries.push({ id: ART_OVERVIEW_ID, label: 'Overview' });
  entries.push(...body);
  if (hasDiscussion && !taken.has('comments')) entries.push({ id: 'comments', label: 'Discussion' });

  return entries.length >= TOC_MIN_ENTRIES ? entries : [];
}

/**
 * Which of an article's two cover crops a layout wants. Editorial runs the cover as a 16:7 hero; Journal and
 * Card both keep 16:9. One source image serves both ratios (request 1200x675 and let Astro's <Image> crop),
 * so this is just the width/height pair each layout passes to <Image>, not a second asset.
 * @param {'editorial'|'journal'|'card'} layout
 * @returns {{width:number, height:number}}
 */
export function coverDimensions(layout) {
  return layout === 'editorial' ? { width: 1200, height: 525 } : { width: 1200, height: 675 };
}
