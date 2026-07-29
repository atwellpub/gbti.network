// SOW-043 / UnifiedWorker: the NEWS surface now reads NEWS_KV IN-PROCESS (workers/signup/membership-news.mjs) —
// no cross-worker HTTP hop, no NEWS_API_KEY. These tests inject the store reads (queryItems / loadIndex) and the
// authorize gate, so they run with no network and no KV: they prove the gating, the shaping, the filter
// sanitization, and fail-closed-when-unbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipNews, membershipNewsCategories, membershipNewsSources, findNewsItemByGuid, publicNews } from '../workers/signup/membership-news.mjs';

const ENV = { NEWS_KV: {} }; // a bound (truthy) NEWS_KV; the reads are injected, so the object is never used directly
const req = (url = 'https://signup.gbti.network/membership/news') => new Request(url, { headers: { Authorization: 'Bearer tok' } });
const paid = () => ({ ok: true, githubId: '1' });
const denied = () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'an active paid membership is required' } });
// A fake store read that records the filter it was handed and returns a fixed feed.
const feedReader = (items, updatedAt = 1) => { const calls = []; const fn = async (_env, filter) => { calls.push(filter); return { items, updatedAt }; }; fn.calls = calls; return fn; };
const indexReader = (counts) => async () => ({ counts, updatedAt: 1, total: 0, days: [] });

test('news: a non-paid caller is denied (the store is never read)', async () => {
  const queryItems = feedReader([{ guid: 'g1', title: 'A' }]);
  const r = await membershipNews(req(), ENV, { authorize: denied, queryItems });
  assert.equal(r.status, 403);
  assert.equal(queryItems.calls.length, 0, 'a denied member must not trigger a store read');
});

// SOW-077: news READ is open to any signed-in account INCLUDING banned (the gate is authorizeSignedIn).
test('news: a BANNED reader is served (read-only, non-KV); the news_view is recorded as the banned tier', async () => {
  const bannedOk = () => ({ ok: true, githubId: '1', status: 'banned' });
  let recordedTier = null;
  const env = { ...ENV, EXT_ANALYTICS: { writeDataPoint: (p) => { recordedTier = p?.blobs?.[0]; } } };
  const r = await membershipNews(req(), env, { authorize: bannedOk, queryItems: feedReader([{ guid: 'g1', title: 'A' }]) });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 1);
  assert.equal(recordedTier, 'banned', 'the news_view analytics event is bucketed as banned, not dropped');
});

test('news: a paid caller gets the in-process items, shaped; the sanitized filter reaches the store', async () => {
  const queryItems = feedReader([{ guid: 'g1', title: 'A', category: 'ai', internalFlag: true }], 123);
  const r = await membershipNews(req('https://x/membership/news?limit=5&category=ai'), ENV, { authorize: paid, queryItems });
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1);
  assert.equal(r.body.updatedAt, 123);
  assert.equal(r.body.items[0].title, 'A');
  assert.equal(r.body.items[0].internalFlag, undefined, 'publicItem drops internal fields');
  assert.deepEqual({ limit: queryItems.calls[0].limit, category: queryItems.calls[0].category }, { limit: 5, category: 'ai' });
});

test('news: 502 when NEWS_KV is not bound (no crash, no store read)', async () => {
  const queryItems = feedReader([]);
  const r = await membershipNews(req(), {}, { authorize: paid, queryItems });
  assert.equal(r.status, 502);
  assert.equal(queryItems.calls.length, 0);
});

test('news: a junk/oversized category or limit is sanitized, not passed verbatim to the store', async () => {
  const queryItems = feedReader([]);
  await membershipNews(req('https://x/membership/news?category=' + encodeURIComponent('../evil?x=1') + '&limit=99999'), ENV, { authorize: paid, queryItems });
  assert.equal(queryItems.calls[0].category, undefined, 'an unsafe category is dropped');
  assert.equal(queryItems.calls[0].limit, 100, 'limit is clamped to 100');
});

test('news-sources / news-categories: shaped from the KV index counts; non-paid denied; unbound 502', async () => {
  const cats = await membershipNewsCategories(req(), ENV, { authorize: paid, loadIndex: indexReader({ category: { ai: 3 }, source: {} }) });
  assert.equal(cats.status, 200);
  assert.ok(Array.isArray(cats.body.categories) && cats.body.categories.length > 0);
  assert.ok(cats.body.categories.every((c) => typeof c.name === 'string' && typeof c.count === 'number'));
  const srcs = await membershipNewsSources(req(), ENV, { authorize: paid, loadIndex: indexReader({ category: {}, source: { 'bleeping-computer': 12 } }) });
  assert.equal(srcs.status, 200);
  assert.ok(Array.isArray(srcs.body.sources) && srcs.body.sources.length > 0);
  assert.ok(srcs.body.sources.every((s) => typeof s.id === 'string' && typeof s.count === 'number'));
  assert.equal((await membershipNewsSources(req(), ENV, { authorize: denied, loadIndex: indexReader({}) })).status, 403);
  assert.equal((await membershipNewsCategories(req(), {}, { authorize: paid, loadIndex: indexReader({}) })).status, 502);
});

test('findNewsItemByGuid (SOW-046 C): resolves the canonical item by guid; fail-closed on miss/unbound', async () => {
  const items = [{ guid: 'g1', title: 'One', category: 'ai', source: 'Example' }, { guid: 'g2', title: 'Two', category: 'devops' }];
  const hit = await findNewsItemByGuid(ENV, { guid: 'g2', queryItems: feedReader(items) });
  assert.equal(hit.title, 'Two');
  assert.equal(hit.category, 'devops'); // the canonical category drives the channel route, not anything client-supplied
  assert.equal(await findNewsItemByGuid(ENV, { guid: 'ghost', queryItems: feedReader(items) }), null); // miss -> null
  assert.equal(await findNewsItemByGuid({}, { guid: 'g1', queryItems: feedReader(items) }), null); // unbound -> null
  // a forged/unsafe source hint is dropped, not passed to the store
  const qi = feedReader(items);
  await findNewsItemByGuid(ENV, { guid: 'g1', source: '../evil?x=1', queryItems: qi });
  assert.equal(qi.calls[0].source, undefined, 'an unsafe source hint is dropped');
});

// sow-139: the PUBLIC news list. No auth; capped tighter (default 40, max 60); unbound fails closed with a 502.
test('public news: an anonymous request is served with the capped default limit (40)', async () => {
  const queryItems = feedReader([{ guid: 'g1', title: 'A' }], 9);
  const r = await publicNews(new Request('https://signup.gbti.network/news/feed'), ENV, { queryItems });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.items.length, 1);
  assert.equal(queryItems.calls[0].limit, 40, 'the anonymous default is 40');
});

test('public news: limit clamps to 60 and category/since/source are sanitized', async () => {
  const queryItems = feedReader([]);
  await publicNews(new Request('https://x/news/feed?limit=500&category=../evil&since=abc&source=..%2Fevil'), ENV, { queryItems });
  const f = queryItems.calls[0];
  assert.equal(f.limit, 60);
  assert.equal(f.category, undefined); // the unsafe category token is dropped
  assert.equal(f.since, undefined); // the non-numeric since is dropped
  assert.equal(f.source, undefined); // the unsafe source is dropped
});

test('public news: unbound NEWS_KV returns 502 without a store read', async () => {
  const queryItems = feedReader([]);
  const r = await publicNews(new Request('https://x/news/feed'), {}, { queryItems });
  assert.equal(r.status, 502);
  assert.equal(queryItems.calls.length, 0);
});
