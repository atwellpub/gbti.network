/**
 * Reshape the workbench preview's product Doc Shell into the page a given content type actually publishes as.
 *
 * The preview page (src/pages/workbench/preview.astro) ships ONE document, the product detail shell, and
 * injects a staged draft into it. That was fine while products were the only authorable type. It stopped
 * being fine the moment articles and prompts existed: a post preview showed a product hero, and a prompt
 * preview showed a Contents rail, a sticky spec bar and a pricing badge, none of which those pages have.
 *
 * Every branch here RESHAPES rather than re-emits. The preview's rail wiring, body injection, contents
 * scroll-spy, as-a-member toggle and the sow-235 edit path are bound to the elements already in that
 * document, so replacing it would break working behaviour in order to share markup that is not where the
 * drift hurt. What made the previews look like different pages is the geometry and the lead, and those come
 * from the per-type contracts in article-page.mjs and prompt-page.mjs, each held to its published page by a
 * drift test.
 *
 * Lifted out of preview.astro so that file stays inside the 900-line cap with room to work in; it was at 896
 * with both branches inline. This module is where the NEXT type's reshape goes.
 *
 * DOM-dependent by nature, so it is exercised through the preview rather than in the node suite; what IS
 * unit-tested is the contract each branch reads.
 */
import { ARTICLE_LAYOUTS, articleShell, buildArticleLeadHtml } from './article-page.mjs';
import {
  PROMPT_SHELL, buildPromptHeadHtml, buildPromptResultHtml, buildPromptBlockHtml, promptImageFraming,
} from './prompt-page.mjs';

/**
 * @param {Document} document the preview document to reshape in place
 * @param {object} ctx
 * @param {string} ctx.type      'post' | 'prompt' | anything else (a product, which needs no reshape)
 * @param {object} ctx.fm        the draft's frontmatter
 * @param {string} ctx.slug      used as the title fallback
 * @param {string[]} ctx.cats    category keys, in breadcrumb order
 * @param {Record<string,string>} ctx.labels  category key to display label
 * @param {string} ctx.catPath   the same categories already joined for an eyebrow
 * @param {{image: any, alt: string}} ctx.hero  resolveHeroForType's answer for this type
 * @param {(s: string) => string} ctx.esc       the caller's HTML escape
 * @param {(v: any, itemPath: string) => string} ctx.asset  resolves a repo-relative image to a URL
 * @param {string} ctx.itemPath  the draft's repo path, for `asset`
 */
export function applyPreviewShell(document, { type, fm, slug, cats, labels, catPath, hero, esc, asset, itemPath }) {
  // sow-214: an ARTICLE is not a product, and until now the preview rendered it as one. The published
  // page picks ArticleJournal / ArticleEditorial / ArticleCard from `layout`; this preview rendered every
  // type through the product Doc Shell, so an article preview was a different page from the article and
  // the editor's layout picker changed nothing on screen.
  //
  // Reshaped rather than rebuilt: the rail, the body injection, the contents scroll-spy and the
  // as-a-member toggle are already wired to these elements, so replacing the document would break
  // working behaviour to share markup that is not where the drift hurt. What made the two look like
  // different pages was the LEAD (a full-bleed hero with the title over it, versus a heading followed by
  // an inset cover and caption) and the grid geometry. Both now come from the shared contract in
  // article-page.mjs, which ArticleJournal.astro is held to by the drift test in test/article-page.test.mjs.
  if (type === 'post') {
    const layout = ARTICLE_LAYOUTS.includes(fm.layout) ? fm.layout : 'journal';
    const shell = articleShell(layout);
    // The product chrome has no article equivalent: no hero band, no sticky spec bar.
    (document.querySelector('.pd-hero'))?.setAttribute('hidden', '');
    (document.querySelector('.pd-bar'))?.setAttribute('hidden', '');
    // Adopt the real article geometry. These classes already ship on this page: .art-* lives in
    // gbti-v3.css, which global.css imports and BaseLayout loads, so this needs no new CSS.
    const grid = document.querySelector('.pd-grid');
    const rail = document.querySelector('.pd-rail');
    const col = document.querySelector('.pd-col');
    if (grid) grid.className = shell.grid;
    if (col) (col).className = shell.column;
    // Card has no contents rail on the published page, so the preview must not invent one. Hiding rather
    // than removing keeps the element for the toc wiring below, which queries it unconditionally.
    if (rail) {
      if (shell.rail) { rail.className = shell.rail; rail.hidden = false; }
      else { rail.hidden = true; }
    }
    // sow-214 stage two: Editorial's grid is THREE columns (a narrow actions strip, the reading column,
    // then the aside) and grid children take columns in source order. The preview has only two of those
    // three, so without this the aside would land in the ~60px actions strip and the column would sit
    // where the aside belongs. Emit the missing strip empty (the published page fills it with the
    // save/share controls, which a draft preview deliberately omits) and move the rail to last.
    if (grid && shell.spacer && !grid.querySelector(`.${shell.spacer}`)) {
      const strip = document.createElement('div');
      strip.className = shell.spacer;
      grid.insertBefore(strip, grid.firstChild);
    }
    if (grid && rail && shell.railLast) grid.appendChild(rail);
    // The lead, built from the shared helper so its shape cannot diverge from the published layout.
    // Card carries its classes on the <img> itself; the other two wrap it, hence shell.cover here.
    const coverCls = layout === 'card' ? ` class="${shell.cover}"` : '';
    const coverHtml = hero.image ? `<img${coverCls} src="${esc(asset(hero.image, itemPath))}" alt="${esc(hero.alt || fm.title || '')}" />` : '';
    const lead = buildArticleLeadHtml({
      layout, title: fm.title || slug, coverHtml, caption: hero.alt || '', eyebrow: catPath,
    });
    // Editorial hoists its lead ABOVE the grid as a full-bleed hero, a sibling of it exactly as the
    // published section has it; the other two open the reading column with it. `leadIn` is the contract's
    // own record of which, so the two hosts cannot disagree about it.
    const anchor = shell.leadIn === 'section' ? grid : document.getElementById('pd-overview');
    if (anchor && lead) anchor.insertAdjacentHTML('beforebegin', lead);
  } else if (type === 'prompt') {
    // sow-214 fixed the ARTICLE preview and left every other type on the product Doc Shell. A prompt is
    // the next worst fit: the product hero, the sticky spec bar, the Contents rail and the pricing badge
    // are chrome a prompt page does not have, and the one thing it does have, the enclosed prompt block,
    // was missing entirely. Same treatment and the same reason as sow-214: RESHAPE rather than re-emit,
    // so the body injection, the sow-235 edit path and the member toggle stay bound to the elements they
    // already know. Every class below comes from PROMPT_SHELL, which test/prompt-page.test.mjs holds
    // against the published page.
    const pg = document.querySelector('.pd-grid');
    const prail = document.querySelector('.pd-rail');
    const pcol = document.querySelector('.pd-col');
    (document.querySelector('.pd-hero'))?.setAttribute('hidden', '');
    (document.querySelector('.pd-bar'))?.setAttribute('hidden', '');
    // The published page sits its header and grid inside one tinted band. The preview has no such
    // element, so wrap the content column in one rather than leaving the header on a bare background.
    const pwrap = pg?.parentElement;
    if (pwrap?.parentElement && !pwrap.parentElement.classList.contains('band')) {
      const band = document.createElement('section');
      band.className = PROMPT_SHELL.section;
      pwrap.parentElement.insertBefore(band, pwrap);
      band.appendChild(pwrap);
    }
    // The published page lays the prompt out inside the site .wrap; .pd-wrap is the narrower product
    // measure (1000px), which made the preview's reading column ~20% narrower than the real one and so
    // wrapped the prompt's lines somewhere else. Line breaks are one of the things an author previews.
    if (pwrap) pwrap.className = PROMPT_SHELL.wrap;
    if (pg) { pg.className = PROMPT_SHELL.grid; pg.removeAttribute('data-side'); }
    if (pcol) (pcol).className = PROMPT_SHELL.main;
    // The reading column comes FIRST on the published page and grid children take columns in source
    // order, so the rail moves last; without this the sidebar would take the wide track.
    if (prail && pg) { prail.className = PROMPT_SHELL.aside; pg.appendChild(prail); }
    // A prompt page has no Contents rail, so the preview must not invent one. Hidden rather than
    // removed, because the toc wiring further down queries it unconditionally.
    const ptoc = document.querySelector('[data-pd-toc]');
    if (ptoc) ptoc.hidden = true;
    // The header, above the grid and full width, exactly where the page has it. The inert byline notice
    // MOVES into it rather than being duplicated: a draft has no publication date and no price, so the
    // preview says so where the real byline would be instead of inventing one.
    const pbyline = document.querySelector('.pd-byline');
    const head = buildPromptHeadHtml({
      title: fm.title || slug,
      crumbs: [{ label: 'AI Prompts', href: '/prompts/' },
        ...cats.map((c) => ({ label: labels[c] || c, href: `/prompts/?cat=${encodeURIComponent(c)}` }))],
      metaHtml: pbyline ? pbyline.innerHTML : '',
      lead: fm.shortDescription || fm.exampleOutput || '',
    });
    if (pbyline) pbyline.remove();
    if (pg) pg.insertAdjacentHTML('beforebegin', head);
    // Enclose the body in the prompt block. The block is emitted EMPTY and the existing #pd-overview is
    // moved inside it, so every listener already attached to that element survives the reshape. The mode
    // switch and Copy act on a published prompt, so the preview asks for the bar without them.
    const povw = document.getElementById('pd-overview');
    if (povw?.parentElement) {
      povw.insertAdjacentHTML('beforebegin', buildPromptBlockHtml({ interactive: false }));
      const pbody = document.querySelector(`.${PROMPT_SHELL.body}`);
      if (pbody) {
        const view = document.createElement('div');
        view.className = PROMPT_SHELL.view;
        view.setAttribute('data-view', 'visual');
        pbody.appendChild(view);
        view.appendChild(povw);
      }
      // The lead image, above the block. resolveHeroForType already resolved fm.image into hero.image for
      // a prompt, and the hero band it would otherwise have filled is hidden above.
      const framing = promptImageFraming(fm);
      const fig = buildPromptResultHtml({
        imgHtml: hero.image ? `<img src="${esc(asset(hero.image, itemPath))}" alt="${esc(framing.alt)}" />` : '',
        caption: framing.caption,
      });
      const pblock = document.querySelector(`.${PROMPT_SHELL.block}`);
      if (fig && pblock) pblock.insertAdjacentHTML('beforebegin', fig);
    }
  }}
