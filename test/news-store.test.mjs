import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayOf, mergeDayItems, applyCounts, expiredDays, commitIngest, emptyIndex } from '../workers/signup/news/src/store.mjs';

const NOW = 1_750_000_000;
const day = 86400;
const item = (guid, publishedAt, extra = {}) => ({ guid, source: 's', category: 'Other', publishedAt, fetchedAt: publishedAt, ...extra });

test('dayOf returns a UTC YYYY-MM-DD string', () => {
  assert.match(dayOf(NOW), /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(dayOf(0), '1970-01-01');
});

test('mergeDayItems dedupes by guid (incoming wins) and sorts newest-first', () => {
  const existing = [item('a', NOW - day, { category: 'Other' })];
  const incoming = [item('a', NOW - day, { category: 'Security' }), item('b', NOW)];
  const out = mergeDayItems(existing, incoming);
  assert.deepEqual(out.map((i) => i.guid), ['b', 'a']);
  assert.equal(out.find((i) => i.guid === 'a').category, 'Security');
});

test('applyCounts increments and decrements, flooring at 0', () => {
  const counts = { category: {}, source: {} };
  applyCounts(counts, item('a', NOW, { category: 'Security', source: 'x' }), +1);
  assert.equal(counts.category.Security, 1);
  assert.equal(counts.source.x, 1);
  applyCounts(counts, item('a', NOW, { category: 'Security', source: 'x' }), -1);
  applyCounts(counts, item('a', NOW, { category: 'Security', source: 'x' }), -1); // floor
  assert.equal(counts.category.Security, 0);
});

test('expiredDays returns day strings older than the retention window', () => {
  const days = [dayOf(NOW), dayOf(NOW - 10 * day), dayOf(NOW - 40 * day)];
  const expired = expiredDays(days, 30, NOW);
  assert.deepEqual(expired, [dayOf(NOW - 40 * day)]);
});

test('commitIngest accumulates per-source content-richness stats across runs (SOW-046 A)', async () => {
  const m = new Map();
  const env = { NEWS_KV: { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } } };
  const index = emptyIndex();
  const guids = {};
  await commitIngest(env, { freshItems: [], contentStatsDelta: { s: { full: 2, thin: 1 } }, retentionDays: 30, now: NOW, index, guids });
  assert.deepEqual(index.contentStats.s, { full: 2, thin: 1 });
  // a second run adds to the running totals (and a new source appears)
  await commitIngest(env, { freshItems: [], contentStatsDelta: { s: { full: 1, thin: 3 }, t: { thin: 2 } }, retentionDays: 30, now: NOW, index, guids });
  assert.deepEqual(index.contentStats.s, { full: 3, thin: 4 });
  assert.deepEqual(index.contentStats.t, { full: 0, thin: 2 });
});
