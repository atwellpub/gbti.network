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
