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

// ---------------------------------------------------------------------------
// sow-214: the article SHELL, owned in one place so the published page and the WorkBench preview cannot
// drift into different layouts again.
//
// They had. preview.astro rendered every content type through the product Doc Shell (.pd-*), never read
// `layout`, and imported one component from the article side, so an article preview was a different page
// from the article. The editor's layout picker changed nothing on screen.
//
// WHAT IS SHARED AND WHAT IS NOT, because the split is not obvious and the next person deserves it stated:
//   - The CSS is already shared. `.art-*` lives in gbti-v3.css, which global.css imports and BaseLayout
//     loads, so the preview page already ships these styles. Adopting the class names costs nothing.
//   - The STRUCTURE is shared here: the class names, the element order, the ids.
//   - The COVER MARKUP is injected, because the two hosts cannot produce the same element. The published
//     page uses Astro's <Image>, which resolves assets at build time; the preview renders on the client
//     from fetched JSON and must emit a plain <img> pointing at the CDN.
//   - The live-data components (byline, actions, favorite counts, discussion) are NOT in the shell. They
//     are Astro components on the published side and deliberately omitted from a draft preview.
//
// The Astro component keeps its own markup, because it composes real components into this structure and
// cannot be rendered on the client. That duplication is made safe by the drift test in
// test/article-page.test.mjs, which compares the two skeletons and fails when one side moves alone.

/**
 * The class + id contract for each article layout, read by both hosts rather than typed as strings twice.
 *
 * sow-214 stage two: Editorial and Card joined Journal here, each read off its own component rather than
 * written from memory. Stage one deliberately shipped Journal alone after a first draft of all three turned
 * out to be invented, so the shape below is deliberately NOT a single template with three prefixes. The three
 * layouts differ structurally, and the fields say how:
 *
 *   - `leadIn` is where the title/cover block belongs. Journal and Card put it inside the reading column;
 *     Editorial hoists it above the grid as a full-bleed hero with the title overlaid on the image.
 *   - `rail` is null for Card, which has no contents rail at all on the published page.
 *   - `spacer` names the grid child Editorial needs but the preview cannot fill. `art-e-grid` is a THREE
 *     column grid (actions strip, column, aside) and grid children take columns in source order, so a host
 *     rendering only two of them would slot the aside into the 60px actions strip. The preview emits an empty
 *     one rather than pretending the grid is two columns.
 *   - `railLast` records that Editorial's aside is the LAST grid child while Journal's rail is the first.
 *   - `overviewId` is false for Card, whose body wrapper carries no id because it has no rail to anchor.
 */
export const ARTICLE_SHELL = Object.freeze({
  journal: Object.freeze({
    section: 'art-shell band',
    grid: 'art-j-grid art-wrap',
    rail: 'art-j-rail art-rail',
    column: 'art-j-col',
    title: 'art-j-title',
    cover: 'art-j-cover',
    caption: 'art-j-cap',
    coverBeforeTitle: false, // Journal puts the title first, then the cover inset in the column
    leadIn: 'column',
    spacer: null,
    railLast: false,
    overviewId: true,
  }),
  editorial: Object.freeze({
    section: 'art-shell band',
    grid: 'art-e-grid art-wrap',
    rail: 'art-e-aside',
    column: 'art-e-col',
    title: 'art-e-title',
    cover: 'art-e-hero',
    caption: 'art-e-cap',
    // The title is nested INSIDE the hero rather than sequenced against it, so "cover before title" is true in
    // the only sense a host needs: the image element opens the lead.
    coverBeforeTitle: true,
    leadIn: 'section',
    spacer: 'art-e-actions-rail',
    railLast: true,
    overviewId: true,
    // Editorial-only parts of the lead, named here because the preview builds the same markup.
    coverInner: 'art-e-hero-in',
    flatHeader: 'art-e-header-flat', // the no-cover variant: the same header without the image behind it
    eyebrow: 'art-e-cats',
    eyebrowItem: 'art-e-cat',
  }),
  card: Object.freeze({
    section: 'band art-c-band',
    grid: 'wrap',
    rail: null,
    column: 'card mx-auto art-c-card',
    title: 'h1 mt-8',
    cover: 'art-c-cover mt-32 w-full object-cover',
    caption: 'mt-8 body-sm muted tcenter',
    coverBeforeTitle: false,
    leadIn: 'column',
    spacer: null,
    railLast: false,
    overviewId: false,
    header: 'tcenter',
    eyebrow: 'eyebrow',
  }),
});

/** The layouts an article may declare. Anything else falls back to journal, matching [slug].astro:52. */
export const ARTICLE_LAYOUTS = Object.freeze(['journal', 'editorial', 'card']);

/**
 * Resolve a layout name to its shell contract, defaulting exactly as the published page does: an unknown or
 * absent layout is a journal, matching [slug].astro's own fallback.
 */
export function articleShell(layout) {
  return ARTICLE_SHELL[layout] ?? ARTICLE_SHELL.journal;
}

/** Minimal HTML escape for text interpolated into the shell (titles and captions are author-supplied). */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Build an article's LEAD (eyebrow, title, cover, caption) in the shape its layout uses, for a host that
 * cannot render Astro components.
 *
 * The lead rather than the whole page, deliberately. The preview's rail, body injection, contents rail and
 * member toggle already work and are bound to existing elements, so replacing the whole document would
 * break working behaviour to share markup that is not where the drift actually hurts. What made the two
 * layouts look like different pages was the lead: a full-bleed product hero with the title over it, versus
 * a heading followed by an inset cover and its caption. That is what is shared here, and the surrounding
 * geometry comes from ARTICLE_SHELL's class names, which both hosts read.
 *
 * Three small builders rather than one parameterized template, because the three leads are genuinely three
 * shapes: Journal sequences a heading then an inset cover, Card centres a header block above a plain image,
 * and Editorial nests the heading INSIDE the cover as an overlay. Folding those into one function would mean
 * a flag per difference, which is the config-blob version of the duplication this is meant to remove.
 *
 * `coverHtml` is INJECTED because the hosts cannot emit the same element: the published page uses Astro's
 * build-time <Image>, the preview a plain <img> at a CDN URL.
 *
 * @param {object} args
 * @param {string} args.layout      'journal' | 'editorial' | 'card' (anything else is a journal)
 * @param {string} args.title
 * @param {string} [args.coverHtml] the caller's cover element, or '' for none
 * @param {string} [args.caption]   rendered under the cover, as coverAlt is on the page
 * @param {string} [args.eyebrow]   the category breadcrumb; Journal has no eyebrow in its lead (it sits in
 *                                  the rail instead), so it is ignored there rather than silently appearing
 * @returns {string}
 */
export function buildArticleLeadHtml({ layout, title, coverHtml = '', caption = '', eyebrow = '' } = {}) {
  const s = articleShell(layout);
  if (s === ARTICLE_SHELL.editorial) return editorialLead(s, { title, coverHtml, caption, eyebrow });
  if (s === ARTICLE_SHELL.card) return cardLead(s, { title, coverHtml, caption, eyebrow });
  return journalLead(s, { title, coverHtml, caption });
}

/** Journal: the title, then the cover inset in the reading column with its caption under it. */
function journalLead(s, { title, coverHtml, caption }) {
  const cover = coverHtml
    ? `<div class="${s.cover}">${coverHtml}</div>${caption ? `<p class="${s.caption}">${esc(caption)}</p>` : ''}`
    : '';
  const heading = `<h1 data-gbti-region="title" class="${s.title}">${esc(title)}</h1>`;
  // Whether the cover leads is the single thing that makes a layout look different at a glance, so it
  // belongs in the shared contract rather than in a template where one host can change it alone.
  return s.coverBeforeTitle ? cover + heading : heading + cover;
}

/**
 * Editorial: a full-bleed hero carrying the image with the eyebrow and title overlaid, then the caption as a
 * SIBLING below it rather than inside. With no cover the component swaps to a flat header of the same parts,
 * and so does this: the hero treatment needs an image behind it to be legible.
 */
function editorialLead(s, { title, coverHtml, caption, eyebrow }) {
  const cats = eyebrow ? `<div class="${s.eyebrow}"><span class="${s.eyebrowItem}">${esc(eyebrow)}</span></div>` : '';
  const heading = `<h1 data-gbti-region="title" class="${s.title}">${esc(title)}</h1>`;
  if (!coverHtml) return `<div class="${s.flatHeader}">${cats}${heading}</div>`;
  return `<div class="${s.cover}">${coverHtml}<div class="${s.coverInner}">${cats}${heading}</div></div>`
    + (caption ? `<p class="${s.caption}">${esc(caption)}</p>` : '');
}

/**
 * Card: a centred header (eyebrow, title) inside the reading card, then a plain full-width image with no
 * wrapper element, then a centred caption. The cover carries its classes directly, which is why the
 * contract's `cover` is a class list for a bare <img> here and a wrapper class in the other two.
 */
function cardLead(s, { title, coverHtml, caption, eyebrow }) {
  const cats = eyebrow ? `<p class="${s.eyebrow}">${esc(eyebrow)}</p>` : '';
  const header = `<header class="${s.header}">${cats}<h1 data-gbti-region="title" class="${s.title}">${esc(title)}</h1></header>`;
  if (!coverHtml) return header;
  return header + coverHtml + (caption ? `<p class="${s.caption}">${esc(caption)}</p>` : '');
}
