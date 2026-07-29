import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanSources, loadSourceList, nextChunk } from '../workers/signup/news/src/sources.mjs';

function kv() {
  const m = new Map();
  return { m, NEWS_KV: { get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } } };
}
const src = (id, extra = {}) => ({ id, name: id, url: `https://${id}.com/feed`, ...extra });

test('cleanSources drops disabled / bad-url / duplicate entries', () => {
  const out = cleanSources([
    src('a'),
    src('b', { enabled: false }),     // disabled
    { id: 'c', url: 'not-a-url' },     // bad url
    src('a'),                          // duplicate id
    src('d'),
  ]);
  assert.deepEqual(out.map((s) => s.id), ['a', 'd']);
});

test('loadSourceList prefers the remote artifact and caches it', async () => {
  const env = kv();
  env.NEWS_SOURCES_URL = 'https://gbti.network/news-sources.json';
  const fetchImpl = async () => ({ ok: true, json: async () => ({ sources: [src('x'), src('y', { enabled: false })] }) });
  const r = await loadSourceList(env, { fetchImpl });
  assert.equal(r.origin, 'remote');
  assert.deepEqual(r.sources.map((s) => s.id), ['x']); // y is disabled
  assert.ok(env.m.get('feed:v2:sources-cache'), 'caches the cleaned list to KV');
});

test('loadSourceList falls back to the KV cache when the fetch fails', async () => {
  const env = kv();
  env.NEWS_SOURCES_URL = 'https://gbti.network/news-sources.json';
  env.m.set('feed:v2:sources-cache', JSON.stringify([src('cached')]));
  const fetchImpl = async () => { throw new Error('network'); };
  const r = await loadSourceList(env, { fetchImpl });
  assert.equal(r.origin, 'cache');
  assert.deepEqual(r.sources.map((s) => s.id), ['cached']);
});

test('loadSourceList times out a HUNG artifact fetch and falls back (SOW-056 outage fix)', async () => {
  const env = kv();
  env.NEWS_SOURCES_URL = 'https://gbti.network/news-sources.json';
  // a fetch that never resolves until its AbortController signal fires — simulates the hang that froze ingest.
  const hung = (_url, opts) => new Promise((_res, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('aborted'))); });
  const r = await loadSourceList(env, { fetchImpl: hung, timeoutMs: 20 });
  assert.equal(r.origin, 'bundled'); // the timeout aborted the hang -> fell through to the bundled seed (ingest proceeds)
  assert.ok(r.sources.length > 50);
});

test('loadSourceList falls back to the bundled seed with no URL / no cache', async () => {
  const env = kv(); // no NEWS_SOURCES_URL
  const r = await loadSourceList(env, { fetchImpl: async () => { throw new Error('unused'); } });
  assert.equal(r.origin, 'bundled');
  assert.ok(r.sources.length > 50, 'bundled config seed is non-trivial');
});

test('nextChunk advances a persisted cursor, strictly sequential, wrapping at the end', async () => {
  const env = kv();
  const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => src(id));
  const ids = async () => (await nextChunk(env, pool, 2)).map((s) => s.id);
  assert.deepEqual(await ids(), ['a', 'b']);       // cursor 0 -> 2
  assert.deepEqual(await ids(), ['c', 'd']);       // 2 -> 4
  assert.deepEqual(await ids(), ['e']);            // 4 -> wraps to 0 (tail chunk is short)
  assert.deepEqual(await ids(), ['a', 'b']);       // back to the start, never repeating the prior run
});

test('nextChunk resets a stale cursor (list shrank) and returns all when chunk >= length', async () => {
  const env = kv();
  env.m.set('feed:v2:source-cursor', '99'); // stale (beyond the new, smaller list)
  const pool = [src('a'), src('b')];
  assert.deepEqual((await nextChunk(env, pool, 2)).map((s) => s.id), ['a', 'b']); // chunk>=len => whole pool
  // a chunk smaller than the (reset) list still starts from 0
  assert.deepEqual((await nextChunk(env, pool, 1, { save: false })).map((s) => s.id), ['a']);
});
