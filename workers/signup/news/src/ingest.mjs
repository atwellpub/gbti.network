// Hourly ingest pipeline: fetch the configured sources -> parse -> dedupe against the stored
// collection -> classify NEW items with Workers AI -> merge/prune -> save. Shared by the cron
// (scheduled handler) and the POST /refresh endpoint.
//
// Resilience: each source is fetched with a timeout and via Promise.allSettled, so one slow or broken
// feed can never abort the run. Classification failures fall back gracefully (see classify.mjs) and
// leave the item flagged `classified:false` so a later run retries it.

import { DEFAULT_CATEGORY } from '../config/categories.mjs';
import { parseFeed, contentRichness } from './feeds.mjs';
import { classifyItem, analyzeItem, keywordCategory } from './classify.mjs';
import { loadIndex, loadGuids, loadDay, dayOf, commitIngest } from './store.mjs';
import { loadSourceList, nextChunk } from './sources.mjs'; // SOW-056: git-native pool + sequential KV cursor

const FETCH_TIMEOUT_MS = 8000;
// Free Workers plan allows 50 subrequests per invocation, and fetches + AI calls + KV ops all count.
// Budget: SOURCE_CHUNK fetches (~20) + MAX_CLASSIFY AI calls (~16) + ~9 KV ops stays under 50.
// Leftover new items are stored with a fallback label and reclassified on later hourly runs.
const DEFAULT_MAX_CLASSIFY = 16;
const CLASSIFY_CONCURRENCY = 5;

/** Fetch + parse one source. Never throws; returns [] on any failure. */
async function fetchSource(src) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(src.url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'gbti-news-bot/0.1 (+https://gbti.network)',
        Accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8',
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    if (!res.ok) {
      console.error(JSON.stringify({ at: 'fetchSource', source: src.id, status: res.status }));
      return [];
    }
    return parseFeed(await res.text(), src.id);
  } catch (err) {
    console.error(JSON.stringify({ at: 'fetchSource', source: src.id, error: String(err?.message || err) }));
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Run async fn over items with a fixed concurrency limit; preserves order. */
async function mapWithConcurrency(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Run one ingest cycle. `now` is epoch seconds (inject in tests; defaults to wall clock).
 * Returns a summary object (also logged) describing what happened.
 */
export async function ingest(env, { now = Math.floor(Date.now() / 1000) } = {}) {
  const retentionDays = Number(env.RETENTION_DAYS) || 30;
  const chunkSize = Number(env.SOURCE_CHUNK) || 0;
  const maxClassify = Number(env.MAX_CLASSIFY) || DEFAULT_MAX_CLASSIFY;

  // Load index + guid map once; pass both to commitIngest so it doesn't re-read them (subrequest budget).
  const index = await loadIndex(env);
  const guids = await loadGuids(env); // { guid: dayString } across the whole retention window

  // 1. Resolve the live pool (git-native artifact -> KV cache -> bundled seed) and pick the next sequential chunk
  //    via the persisted cursor, then fetch + parse in parallel (allSettled => one failure can't abort).
  const { sources: pool, origin: sourcesOrigin } = await loadSourceList(env);
  const sources = await nextChunk(env, pool, chunkSize);
  const settled = await Promise.allSettled(sources.map((s) => fetchSource(s)));
  const parsed = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));

  // 2. Keep only items we've never seen (dedupe against the window + within this batch).
  const localSeen = new Set();
  const fresh = [];
  for (const it of parsed) {
    if (it.guid in guids || localSeen.has(it.guid)) continue;
    localSeen.add(it.guid);
    fresh.push({ ...it, fetchedAt: now });
  }

  // 2b. SOW-046 A diagnostics: tally how many fresh items arrived with FULL inline article text vs only a THIN
  //     blurb (per source + overall), BEFORE contentText is stripped. This measures the blurb-only gap that a
  //     future Readability fetch would close, so the owner can decide from data, not a guess (see /diag).
  const contentStatsDelta = {};
  let contentFull = 0;
  let contentThin = 0;
  for (const it of fresh) {
    const r = contentRichness(it);
    if (r === 'full') contentFull += 1; else contentThin += 1;
    const d = (contentStatsDelta[it.source] ||= { full: 0, thin: 0 });
    d[r] += 1;
  }

  // 3. Classify + SUMMARIZE fresh items up to the per-run AI budget (one combined AI call each, SOW-046 A); the
  //    overflow gets a cheap keyword label + no digest now (the feed excerpt is its display fallback). The
  //    transient contentText (the article body fed to the summarizer) is STRIPPED here so it is never persisted.
  const toClassify = fresh.slice(0, maxClassify);
  const classified = await mapWithConcurrency(toClassify, CLASSIFY_CONCURRENCY, async (it) => {
    const { category, classified: ok, digest, summarized } = await analyzeItem(env, it);
    const { contentText, ...rest } = it;
    return { ...rest, category, classified: ok, summarized, ...(digest ? { digest } : {}) };
  });
  const overflowFresh = fresh.slice(toClassify.length).map((it) => {
    const { contentText, ...rest } = it;
    return { ...rest, category: keywordCategory(it) || DEFAULT_CATEGORY, classified: false, summarized: false };
  });
  const freshItems = [...classified, ...overflowFresh];

  // 4. If AI budget remains, retry today's still-unclassified items (recorded as category changes).
  const updatedItems = [];
  const changedCategories = [];
  let remaining = maxClassify - toClassify.length;
  if (remaining > 0) {
    const pending = (await loadDay(env, dayOf(now))).filter((it) => it.classified === false).slice(0, remaining);
    const redone = await mapWithConcurrency(pending, CLASSIFY_CONCURRENCY, async (it) => {
      const { category, classified: ok } = await classifyItem(env, it);
      return { item: it, category, ok };
    });
    for (const r of redone) {
      if (!r.ok) continue;
      if (r.category !== r.item.category) changedCategories.push({ guid: r.item.guid, from: r.item.category, to: r.category });
      updatedItems.push({ ...r.item, category: r.category, classified: true });
    }
  }

  // 5. Commit: write today's shard, update guid map + counts, prune shards outside retention.
  const updatedIndex = await commitIngest(env, { freshItems, updatedItems, changedCategories, contentStatsDelta, retentionDays, now, index, guids });

  const summary = {
    at: 'ingest',
    now,
    sources: sources.length,
    pool: pool.length, // SOW-056: total live pool size + where it came from (remote artifact / KV cache / bundled)
    sourcesOrigin,
    parsed: parsed.length,
    new: fresh.length,
    classifiedOk: classified.filter((it) => it.classified).length,
    summarizedOk: classified.filter((it) => it.summarized).length,
    contentFull, // SOW-046 A: fresh items that arrived with full inline article text
    contentThin, // SOW-046 A: fresh items that arrived with only a short blurb (Readability-fetch candidates)
    reclassified: updatedItems.length,
    overflow: overflowFresh.length,
    total: updatedIndex.total,
    days: updatedIndex.days.length,
  };
  console.log(JSON.stringify(summary));
  return summary;
}
