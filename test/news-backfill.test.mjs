import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfillImages } from '../workers/signup/news/src/backfill.mjs';

const NOW = 1_750_000_000;

// In-memory NEWS_KV seeded with an index (days) + one item array per day shard, mirroring store.mjs key shapes.
function makeEnv(shards) {
  const m = new Map();
  const days = Object.keys(shards);
  m.set('feed:v2:index', JSON.stringify({ days, counts: { category: {}, source: {} }, total: 0, updatedAt: 0 }));
  for (const [d, items] of Object.entries(shards)) m.set(`feed:v2:day:${d}`, JSON.stringify(items));
  const env = { NEWS_KV: { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } } };
  return { env, m };
}
const readDay = (m, d) => JSON.parse(m.get(`feed:v2:day:${d}`));
// og:image keyed off the article URL so each fetch returns a distinct, predictable image.
const fetchImpl = async (url) => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => `<meta property="og:image" content="${url}/og.jpg">` });

test('backfillImages fills missing images, marks tried, respects the cap, and converges', async () => {
  const d = '2026-06-19';
  const { env, m } = makeEnv({ [d]: [
    { guid: 'a', link: 'https://ex.com/a', image: null },
    { guid: 'b', link: 'https://ex.com/b', image: null },
    { guid: 'c', link: 'https://ex.com/c', image: 'https://cdn/existing.jpg' }, // already imaged -> skipped
    { guid: 'e', link: '', image: null }, // no link -> skipped
  ] });

  const s1 = await backfillImages(env, { now: NOW, cap: 1, fetchImpl });
  assert.equal(s1.candidates, 1); // cap=1 takes only the first eligible item
  assert.equal(s1.found, 1);
  let after = readDay(m, d);
  assert.equal(after.find((x) => x.guid === 'a').image, 'https://ex.com/a/og.jpg');
  assert.equal(after.find((x) => x.guid === 'a').imgTried, NOW);
  assert.equal(after.find((x) => x.guid === 'b').image, null); // left for the next run
  assert.equal(after.find((x) => x.guid === 'c').image, 'https://cdn/existing.jpg'); // untouched

  const s2 = await backfillImages(env, { now: NOW + 1, cap: 10, fetchImpl });
  assert.equal(s2.candidates, 1); // only b remains (a tried, c imaged, e no link)
  after = readDay(m, d);
  assert.equal(after.find((x) => x.guid === 'b').image, 'https://ex.com/b/og.jpg');

  const s3 = await backfillImages(env, { now: NOW + 2, cap: 10, fetchImpl });
  assert.equal(s3.candidates, 0); // fully converged
});

test('backfillImages marks an image-less article tried so it is never refetched', async () => {
  const d = '2026-06-18';
  const { env, m } = makeEnv({ [d]: [{ guid: 'x', link: 'https://ex.com/x', image: null }] });
  const noImg = async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => '<p>no og tags</p>' });

  const s = await backfillImages(env, { now: NOW, cap: 5, fetchImpl: noImg });
  assert.equal(s.found, 0);
  const it = readDay(m, d)[0];
  assert.equal(it.image, null);
  assert.equal(it.imgTried, NOW); // attempted even on a miss

  const s2 = await backfillImages(env, { now: NOW + 1, cap: 5, fetchImpl: noImg });
  assert.equal(s2.candidates, 0); // not retried
});

test('backfillImages spans multiple day shards newest-first and reports nothing to do', async () => {
  const { env, m } = makeEnv({
    '2026-06-19': [{ guid: 'n', link: 'https://ex.com/n', image: null }],
    '2026-06-17': [{ guid: 'o', link: 'https://ex.com/o', image: null }],
  });
  const s = await backfillImages(env, { now: NOW, cap: 10, fetchImpl });
  assert.equal(s.candidates, 2);
  assert.equal(s.shards, 2);
  assert.equal(readDay(m, '2026-06-19')[0].image, 'https://ex.com/n/og.jpg');
  assert.equal(readDay(m, '2026-06-17')[0].image, 'https://ex.com/o/og.jpg');

  const empty = await backfillImages(env, { now: NOW + 1, cap: 10, fetchImpl });
  assert.equal(empty.candidates, 0);
  assert.equal(empty.shards, 0);
});
