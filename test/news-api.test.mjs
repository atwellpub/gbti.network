import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampLimit, matchesFilter, publicItem, categoriesWithCounts, sourcesWithCounts, contentDiagnostics } from '../workers/signup/news/src/api.mjs';
import { SOURCES } from '../workers/signup/news/config/sources.mjs';

const item = { guid: '1', source: 'hn', title: 'A', link: 'l', summary: '', category: 'Security', classified: true, publishedAt: 200, fetchedAt: 200 };

test('clampLimit defaults, floors, and caps', () => {
  assert.equal(clampLimit(undefined), 50);
  assert.equal(clampLimit('0'), 50);
  assert.equal(clampLimit('abc'), 50);
  assert.equal(clampLimit('10'), 10);
  assert.equal(clampLimit('9999'), 100);
});

test('matchesFilter on category (case-insensitive), source, and since', () => {
  assert.equal(matchesFilter(item, { category: 'security' }), true);
  assert.equal(matchesFilter(item, { category: 'ai/ml' }), false);
  assert.equal(matchesFilter(item, { source: 'hn' }), true);
  assert.equal(matchesFilter(item, { source: 'other' }), false);
  assert.equal(matchesFilter(item, { since: '100' }), true);
  assert.equal(matchesFilter(item, { since: '300' }), false);
  assert.equal(matchesFilter(item, {}), true);
});

test('contentDiagnostics aggregates full-vs-thin and flags blurb-only sources (SOW-046 A)', () => {
  const [a, b] = SOURCES;
  const diag = contentDiagnostics({ contentStats: { [a.id]: { full: 8, thin: 2 }, [b.id]: { full: 1, thin: 9 } } });
  assert.equal(diag.totals.full, 9);
  assert.equal(diag.totals.thin, 11);
  assert.equal(diag.totals.thinPct, Math.round((11 / 20) * 100));
  // b is mostly blurb-only (>=60% thin, >=5 sample) -> a Readability candidate; a (mostly full) is not
  assert.ok(diag.readabilityCandidates.includes(b.id));
  assert.ok(!diag.readabilityCandidates.includes(a.id));
});

test('contentDiagnostics is defensive on an empty / pre-upgrade index', () => {
  const diag = contentDiagnostics({});
  assert.equal(diag.totals.seen, 0);
  assert.equal(diag.totals.thinPct, null);
  assert.deepEqual(diag.readabilityCandidates, []);
});

test('publicItem drops the internal classified flag', () => {
  assert.ok(!('classified' in publicItem(item)));
  assert.equal(publicItem(item).category, 'Security');
});

test('categoriesWithCounts joins config with a counts map', () => {
  const cats = categoriesWithCounts({ Security: 3, 'AI/ML': 1 });
  assert.equal(cats.find((c) => c.name === 'Security').count, 3);
  assert.equal(cats.find((c) => c.name === 'AI/ML').count, 1);
  assert.equal(cats.find((c) => c.name === 'Other').count, 0);
});

test('sourcesWithCounts lists every configured source with counts', () => {
  const first = SOURCES[0].id;
  const srcs = sourcesWithCounts({ [first]: 5 });
  assert.equal(srcs.length, SOURCES.length);
  assert.equal(srcs.find((s) => s.id === first).count, 5);
});
