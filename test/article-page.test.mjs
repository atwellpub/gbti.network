// sow-179: the three switchable article layouts' pure helpers (src/lib/article-page.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildArticleToc, coverDimensions, TOC_MIN_ENTRIES, ART_OVERVIEW_ID } from '../src/lib/article-page.mjs';

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
