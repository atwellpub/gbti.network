// SOW-056: resolve the live news source pool + drive sequential rotation.
//
// Git-native + portable: the canonical pool is house/news-sources.yml, published by the site build as
// /news-sources.json. This worker fetches that artifact (NEWS_SOURCES_URL) each cron — a public, CDN-cached URL, so
// no GitHub token is needed and a fork just repoints NEWS_SOURCES_URL at its own site. Fail-soft: remote -> KV cache
// -> the bundled config seed, so a deploy/network blip can never blank the pool.
//
// Rotation: a persisted KV cursor advances by chunkSize each run, so coverage is strictly SEQUENTIAL (every source
// polled over one cycle, never the same chunk two runs running) and stays correct as the list grows or shrinks —
// which it will, once superadmins curate house/news-sources.yml. Replaces the old wall-clock `now/3600` scheme.

import { SOURCES } from '../config/sources.mjs';

const PREFIX = 'feed:v2';
const K_CURSOR = `${PREFIX}:source-cursor`;
const K_CACHE = `${PREFIX}:sources-cache`;

/** Normalize a raw source list to enabled, well-formed, de-duped entries. */
export function cleanSources(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const id = String(s?.id || '').trim();
    const url = String(s?.url || '').trim();
    if (!id || !/^https?:\/\//i.test(url) || s?.enabled === false || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: s?.name || id, url, description: s?.description || '' });
  }
  return out;
}

/**
 * Resolve the live source pool. Prefers the published artifact (NEWS_SOURCES_URL), caches it to KV for fail-soft,
 * then falls back to the last cache, then the bundled config seed. Returns { sources, origin }.
 */
export async function loadSourceList(env, { fetchImpl = fetch, timeoutMs = 8000 } = {}) {
  const url = env?.NEWS_SOURCES_URL;
  if (url) {
    try {
      // SOW-056 FIX: the artifact fetch MUST be timed out (like fetchSource), or a slow/hung response blocks the
      // whole ingest forever (the cron never reaches the feed fetches -> zero new items). On abort/timeout this
      // throws and we fall through to the KV cache, then the bundled seed.
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let res;
      try { res = await fetchImpl(url, { signal: controller.signal, cf: { cacheTtl: 300, cacheEverything: true } }); }
      finally { clearTimeout(timer); }
      if (res && res.ok) {
        const data = await res.json();
        const list = cleanSources(data?.sources);
        if (list.length) {
          try { await env.NEWS_KV.put(K_CACHE, JSON.stringify(list)); } catch { /* cache is best-effort */ }
          return { sources: list, origin: 'remote' };
        }
      }
    } catch { /* fall through to cache/bundled */ }
    try {
      const raw = await env.NEWS_KV.get(K_CACHE);
      const cached = raw ? JSON.parse(raw) : null;
      if (Array.isArray(cached) && cached.length) return { sources: cleanSources(cached), origin: 'cache' };
    } catch { /* fall through to bundled */ }
  }
  return { sources: cleanSources(SOURCES), origin: 'bundled' };
}

/**
 * Pick the next chunk to poll, advancing a persisted cursor. Strictly sequential across runs; wraps at the end;
 * resets if the cursor is unset or out of range (list shrank). chunkSize<=0 or >= length => poll the whole pool.
 * `save:false` lets tests inspect the pick without mutating the cursor.
 */
export async function nextChunk(env, sources, chunkSize, { save = true } = {}) {
  const n = sources.length;
  if (!n) return [];
  if (!chunkSize || chunkSize <= 0 || chunkSize >= n) return sources;
  let cursor = 0;
  try { cursor = Number(await env.NEWS_KV.get(K_CURSOR)); } catch { cursor = 0; } // a KV read error must not abort ingest
  if (!Number.isInteger(cursor) || cursor < 0 || cursor >= n) cursor = 0; // unset or stale
  const picked = sources.slice(cursor, cursor + chunkSize);
  const next = cursor + chunkSize >= n ? 0 : cursor + chunkSize;
  if (save) { try { await env.NEWS_KV.put(K_CURSOR, String(next)); } catch { /* best-effort */ } }
  return picked;
}
