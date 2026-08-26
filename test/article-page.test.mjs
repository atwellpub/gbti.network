// sow-179: the three switchable article layouts' pure helpers (src/lib/article-page.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildArticleToc, coverDimensions, TOC_MIN_ENTRIES, ART_OVERVIEW_ID, ARTICLE_SHELL, articleShell, buildArticleLeadHtml } from '../src/lib/article-page.mjs';
import fs from 'node:fs';

const h = (text, slug, depth = 2) => ({ depth, slug, text });

test('buildArticleToc: brackets the body headings with Overview and Discussion, no gallery concept', () => {
  const toc = buildArticleToc([h('Pricing details remain limited', 'pricing-details-remain-limited'), h('Options for .fm domain holders', 'options-for-fm-domain-holders')]);
  assert.deepEqual(
    toc.map((e) => e.label),
    ['Overview', 'Pricing details remain limited', 'Options for .fm domain holders', 'Discussion'],
  );
  assert.deepEqual(
    toc.map((e) => e.id),
    [ART_OVERVIEW_ID, 'pricing-details-remain-limited', 'options-for-fm-domain-holders', 'comments'],
  );
});

test('buildArticleToc: only h2s become entries', () => {
  const toc = buildArticleToc([h('Top', 'top', 1), h('Real', 'real', 2), h('Nested', 'nested', 3), h('Also real', 'also-real', 2)]);
  assert.deepEqual(toc.map((e) => e.label), ['Overview', 'Real', 'Also real', 'Discussion']);
});

test('buildArticleToc: collapses rather than showing a stub list', () => {
  // A gated item has no public prose, so nothing is left worth a rail.
  assert.deepEqual(buildArticleToc([], { hasBody: false, hasDiscussion: false }), []);
  // Overview + Discussion alone is under the minimum.
  assert.deepEqual(buildArticleToc([]), []);
  assert.ok(TOC_MIN_ENTRIES === 3);
  // One real heading tips it over.
  assert.equal(buildArticleToc([h('Sources', 'sources')]).length, 3);
});

test('buildArticleToc: a body heading owning the Discussion id wins, so no anchor is ambiguous', () => {
  const toc = buildArticleToc([h('Comments', 'comments'), h('Setup', 'setup')]);
  assert.equal(toc.filter((e) => e.id === 'comments').length, 1);
  assert.deepEqual(toc.map((e) => e.label), ['Overview', 'Comments', 'Setup']);
});

test('buildArticleToc: survives a missing or malformed headings list', () => {
  assert.deepEqual(buildArticleToc(undefined), []);
  assert.deepEqual(buildArticleToc([null, { depth: 2 }, h('  ', 'blank')]), []);
});

test('buildArticleToc: a gated stub with no discussion and no headings shows no rail', () => {
  assert.deepEqual(buildArticleToc([], { hasBody: true, hasDiscussion: false }), []); // Overview alone: 1 entry
  assert.deepEqual(buildArticleToc([], { hasBody: false, hasDiscussion: true }), []); // Discussion alone: 1 entry
});

test('coverDimensions: editorial crops to 16:7 for its hero, journal and card keep 16:9', () => {
  assert.deepEqual(coverDimensions('editorial'), { width: 1200, height: 525 });
  assert.deepEqual(coverDimensions('journal'), { width: 1200, height: 675 });
  assert.deepEqual(coverDimensions('card'), { width: 1200, height: 675 });
  // 1200x525 is exactly 16:7 and 1200x675 is exactly 16:9 -- guard the ratio itself, not just the numbers.
  const editorial = coverDimensions('editorial');
  assert.equal(editorial.width / editorial.height, 16 / 7);
  const journal = coverDimensions('journal');
  assert.equal(journal.width / journal.height, 16 / 9);
});

// ---------------------------------------------------------------------------
// sow-214: the shared article shell, and the DRIFT TEST that is the actual point of it.
//
// The WorkBench preview rendered every content type through the PRODUCT Doc Shell, so an article preview
// was a different layout from its published page, and the editor's layout picker changed nothing. Nobody
// noticed for months because every check we own inspects inputs or counts pages; none reads rendered
// output. These tests read rendered output.

test('buildArticleLeadHtml: journal leads with the title, then the inset cover and its caption', () => {
  const html = buildArticleLeadHtml({ layout: 'journal', title: 'Hello', coverHtml: '<img src="x.webp">', caption: 'A cap' });
  assert.ok(html.indexOf('art-j-title') < html.indexOf('art-j-cover'), 'journal leads with the title, not a hero');
  assert.match(html, /<h1 data-gbti-region="title" class="art-j-title">Hello<\/h1>/);
  assert.match(html, /<div class="art-j-cover"><img src="x.webp"><\/div>/);
  assert.match(html, /<p class="art-j-cap">A cap<\/p>/);
});

test('buildArticleLeadHtml: no cover means no cover div and no caption, not an empty frame', () => {
  const html = buildArticleLeadHtml({ layout: 'journal', title: 'T' });
  assert.ok(!html.includes('art-j-cover'));
  assert.ok(!html.includes('art-j-cap'));
});

test('buildArticleLeadHtml: a cover with no caption renders the image and no empty paragraph', () => {
  const html = buildArticleLeadHtml({ layout: 'journal', title: 'T', coverHtml: '<img>' });
  assert.ok(html.includes('art-j-cover'));
  assert.ok(!html.includes('art-j-cap'));
});

test('buildArticleLeadHtml: author text is escaped, since titles and captions are author-supplied', () => {
  const html = buildArticleLeadHtml({ layout: 'journal', title: '<script>x</script>', coverHtml: '<img>', caption: 'a & b' });
  assert.ok(!html.includes('<script>x</script>'), 'a title cannot inject markup');
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /a &amp; b/);
});

test('articleShell: an unknown or absent layout falls back to journal, matching [slug].astro', () => {
  assert.equal(articleShell('journal'), ARTICLE_SHELL.journal);
  assert.equal(articleShell('nonsense'), ARTICLE_SHELL.journal);
  assert.equal(articleShell(undefined), ARTICLE_SHELL.journal);
});

// The drift test. It reads the LIVE component source rather than a copy, so the two cannot be edited apart
// without this failing. Source-reading is deliberate: the alternative is rendering Astro in node, which the
// suite cannot do, and a hand-copied expectation here would be a third implementation to keep in sync.
test('DRIFT: every class in the shared journal contract still appears in ArticleJournal.astro', () => {
  const src = fs.readFileSync(new URL('../src/components/blog/ArticleJournal.astro', import.meta.url), 'utf8');
  const shell = ARTICLE_SHELL.journal;
  for (const key of ['section', 'grid', 'rail', 'column', 'title', 'cover', 'caption']) {
    assert.ok(
      src.includes(`class="${shell[key]}"`),
      `ArticleJournal.astro no longer contains class="${shell[key]}" for '${key}'. Either the layout moved `
      + 'and ARTICLE_SHELL.journal must follow it, or the shared contract is now wrong. Do not delete this '
      + 'assertion: the preview renders from that contract and will silently diverge from the page.',
    );
  }
});

test('DRIFT: ArticleJournal still orders the title before the cover, as the shared contract claims', () => {
  const src = fs.readFileSync(new URL('../src/components/blog/ArticleJournal.astro', import.meta.url), 'utf8');
  const title = src.indexOf(`class="${ARTICLE_SHELL.journal.title}"`);
  const cover = src.indexOf(`class="${ARTICLE_SHELL.journal.cover}"`);
  assert.ok(title > -1 && cover > -1);
  assert.equal(title < cover, ARTICLE_SHELL.journal.coverBeforeTitle === false,
    'the component and the shared contract disagree about whether the cover leads');
});

test('DRIFT: the component uses the shared body-id constant rather than a literal', () => {
  const src = fs.readFileSync(new URL('../src/components/blog/ArticleJournal.astro', import.meta.url), 'utf8');
  assert.ok(src.includes('ART_OVERVIEW_ID'), 'the component must use the shared id constant, not a string');
});

// ---------------------------------------------------------------------------
// sow-214 stage two: Editorial and Card. Stage one shipped Journal alone because a first draft of all three
// was written from memory and was wrong, so each contract below was read off its own component and each is
// pinned to that component the same way Journal is.

const componentSrc = (name) => fs.readFileSync(new URL(`../src/components/blog/${name}.astro`, import.meta.url), 'utf8');

test('buildArticleLeadHtml: editorial nests the title INSIDE the hero, with the caption as a sibling below', () => {
  const html = buildArticleLeadHtml({ layout: 'editorial', title: 'Hello', coverHtml: '<img src="x.webp">', caption: 'A cap', eyebrow: 'Design › UI' });
  // The overlay is the whole point of this layout: title inside the hero div, not sequenced against it.
  assert.match(html, /<div class="art-e-hero"><img src="x\.webp"><div class="art-e-hero-in">/);
  assert.ok(html.indexOf('art-e-title') < html.indexOf('</div></div>'), 'the title sits inside the hero');
  assert.match(html, /<div class="art-e-cats"><span class="art-e-cat">Design › UI<\/span><\/div>/);
  // The caption is OUTSIDE the hero on the published page, which is easy to get wrong when overlaying.
  assert.ok(html.indexOf('art-e-cap') > html.indexOf('art-e-hero-in'));
  assert.match(html, /<\/div><p class="art-e-cap">A cap<\/p>$/);
});

test('buildArticleLeadHtml: editorial with no cover swaps to the flat header, not an empty hero', () => {
  const html = buildArticleLeadHtml({ layout: 'editorial', title: 'T', eyebrow: 'Dev' });
  assert.match(html, /^<div class="art-e-header-flat">/);
  assert.ok(!html.includes('art-e-hero'), 'an overlay with no image behind it is unreadable, so there is none');
  assert.ok(!html.includes('art-e-cap'), 'no cover means no caption');
});

test('buildArticleLeadHtml: card centres a header then a bare image, with no wrapper div', () => {
  const html = buildArticleLeadHtml({ layout: 'card', title: 'Hello', coverHtml: '<img class="art-c-cover" src="x.webp">', caption: 'A cap', eyebrow: 'Dev' });
  assert.match(html, /^<header class="tcenter"><p class="eyebrow">Dev<\/p><h1 data-gbti-region="title" class="h1 mt-8">Hello<\/h1><\/header>/);
  // Card's cover carries its classes on the <img> itself. A wrapper here would break the centred card rhythm.
  assert.match(html, /<\/header><img class="art-c-cover" src="x\.webp">/);
  assert.match(html, /<p class="mt-8 body-sm muted tcenter">A cap<\/p>$/);
});

test('buildArticleLeadHtml: an eyebrow is omitted entirely when absent, in both layouts that show one', () => {
  assert.ok(!buildArticleLeadHtml({ layout: 'editorial', title: 'T', coverHtml: '<img>' }).includes('art-e-cats'));
  assert.ok(!buildArticleLeadHtml({ layout: 'card', title: 'T' }).includes('eyebrow'));
});

test('buildArticleLeadHtml: journal ignores an eyebrow, because its category lives in the rail', () => {
  const html = buildArticleLeadHtml({ layout: 'journal', title: 'T', eyebrow: 'Dev' });
  assert.ok(!html.includes('Dev'), 'a journal lead showing a category would not match the published page');
});

test('buildArticleLeadHtml: author text is escaped in every layout, not just the one that was tested first', () => {
  for (const layout of ['journal', 'editorial', 'card']) {
    const html = buildArticleLeadHtml({ layout, title: '<script>x</script>', coverHtml: '<img>', caption: 'a & b', eyebrow: '<b>c</b>' });
    assert.ok(!html.includes('<script>x</script>'), `${layout}: a title cannot inject markup`);
    assert.ok(!html.includes('<b>c</b>'), `${layout}: an eyebrow cannot inject markup`);
  }
});

test('DRIFT: every class in the editorial contract still appears in ArticleEditorial.astro', () => {
  const src = componentSrc('ArticleEditorial');
  const s = ARTICLE_SHELL.editorial;
  for (const key of ['section', 'grid', 'rail', 'column', 'title', 'cover', 'caption', 'coverInner', 'flatHeader', 'eyebrow', 'eyebrowItem', 'spacer']) {
    assert.ok(src.includes(`class="${s[key]}"`), `ArticleEditorial.astro no longer contains class="${s[key]}" for '${key}'`);
  }
});

test('DRIFT: every class in the card contract still appears in ArticleCard.astro', () => {
  const src = componentSrc('ArticleCard');
  const s = ARTICLE_SHELL.card;
  for (const key of ['section', 'column', 'title', 'cover', 'caption', 'header', 'eyebrow']) {
    assert.ok(src.includes(`class="${s[key]}"`), `ArticleCard.astro no longer contains class="${s[key]}" for '${key}'`);
  }
});

// The regression this guards is specific: the card's max-width, padding and background used to be inline
// style attributes, which the preview could only match by copying the string. They moved into gbti-v3.css so
// both hosts get them from the class. An inline style creeping back would silently un-share the geometry.
test('DRIFT: the card layout carries no inline geometry, and gbti-v3.css owns it instead', () => {
  const src = componentSrc('ArticleCard');
  assert.ok(!/style="max-width:820px/.test(src), 'the card width belongs to .art-c-card in gbti-v3.css');
  assert.ok(!/style="background:var\(--paper-2\)"/.test(src), 'the band background belongs to .art-c-band');
  assert.ok(!/style="border-radius:var\(--r-lg\)"/.test(src), 'the cover radius belongs to .art-c-cover');
  const css = fs.readFileSync(new URL('../src/styles/gbti-v3.css', import.meta.url), 'utf8');
  assert.match(css, /\.art-c-card \{[^}]*max-width: 820px/);
  assert.match(css, /\.art-c-card \{[^}]*padding: clamp\(28px, 5vw, 56px\)/);
  assert.match(css, /\.art-c-band \{[^}]*background: var\(--paper-2\)/);
  assert.match(css, /\.art-c-cover \{[^}]*border-radius: var\(--r-lg\)/);
});

// Card is the one layout with no contents rail and no body id. Both are recorded in the contract because the
// preview reads them to decide whether to render a rail at all, and a wrong value here shows as a phantom
// empty sidebar rather than as an error.
test('DRIFT: the contract agrees with each component about rails and the body id', () => {
  assert.equal(ARTICLE_SHELL.card.rail, null);
  assert.ok(!componentSrc('ArticleCard').includes('ART_OVERVIEW_ID'), 'Card has no rail to anchor, so no body id');
  assert.equal(ARTICLE_SHELL.card.overviewId, false);

  assert.ok(componentSrc('ArticleEditorial').includes('ART_OVERVIEW_ID'), 'Editorial anchors its rail to the body');
  assert.equal(ARTICLE_SHELL.editorial.overviewId, true);
  // Editorial's aside is the LAST grid child; the preview reorders to match, and gets it wrong if this lies.
  const ed = componentSrc('ArticleEditorial');
  assert.ok(ed.indexOf(`class="${ARTICLE_SHELL.editorial.column}"`) < ed.indexOf(`class="${ARTICLE_SHELL.editorial.rail}"`),
    'the contract says railLast, so the aside must follow the column in the component too');
  assert.equal(ARTICLE_SHELL.editorial.railLast, true);
});

// The three-column grid is the reason the preview emits an empty actions strip. If the CSS ever collapses to
// two columns the spacer becomes a visible empty gap, so the contract and the stylesheet are pinned together.
test('DRIFT: art-e-grid is still three columns, which is what the spacer exists for', () => {
  const css = fs.readFileSync(new URL('../src/styles/gbti-v3.css', import.meta.url), 'utf8');
  const rule = css.match(/\.art-e-grid \{[^}]*\}/)?.[0] ?? '';
  const cols = rule.match(/grid-template-columns:([^;]*);/)?.[1] ?? '';
  assert.equal(cols.split(/\s+(?![^(]*\))/).filter(Boolean).length, 3, `art-e-grid is no longer 3 columns: "${cols}"`);
  assert.equal(ARTICLE_SHELL.editorial.spacer, 'art-e-actions-rail');
});

test('DRIFT: the preview reads the layout from the contract rather than hard-coding one', () => {
  // The reshape moved out of preview.astro into src/lib/preview-shells.mjs when the prompt branch joined it
  // and the page hit its line cap. Assert the branch in its new home, AND the one call that runs it, so the
  // reshape cannot be orphaned: this guard already caught the move once, which is the point of it.
  const src = fs.readFileSync(new URL('../src/lib/preview-shells.mjs', import.meta.url), 'utf8');
  for (const token of ['articleShell', 'buildArticleLeadHtml', 'shell.spacer', 'shell.railLast', 'shell.leadIn', 'shell.rail']) {
    assert.ok(src.includes(token), `preview-shells.mjs stopped reading ${token}, so a layout can drift again`);
  }
  const preview = fs.readFileSync(new URL('../src/pages/workbench/preview.astro', import.meta.url), 'utf8');
  assert.match(preview, /^\s*applyPreviewShell\(document,/m, 'preview.astro no longer runs the reshape at all');
});
