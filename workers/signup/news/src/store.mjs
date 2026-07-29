// Persistence for the polled news collection — day-sharded KV.
//
// "No database", and built for the free tier: instead of one ever-growing JSON blob (which would blow
// the free plan's 10ms-CPU-per-request budget once it hit several MB), items are sharded by UTC day:
//
//   feed:v2:day:<YYYY-MM-DD>  -> item[] for that day (sorted newest-first)
//   feed:v2:guids             -> { "<guid>": "<YYYY-MM-DD>" }  dedupe map across the whole window
//   feed:v2:index             -> { days:[...], counts:{category:{},source:{}}, total, updatedAt }
//
// 30-day retention = keep the last 30 day-shards (prune older). /feed reads newest shards first and
// stops once it has enough items, so the common case parses only a shard or two. All KV access is
// isolated here, so swapping to R2 later is a one-file change. Pure helpers are exported for tests.

import { matchesFilter } from './api.mjs';

const PREFIX = 'feed:v2';
const K_INDEX = `${PREFIX}:index`;
const K_GUIDS = `${PREFIX}:guids`;
const kDay = (d) => `${PREFIX}:day:${d}`;

/** UTC day string (YYYY-MM-DD) for an epoch-seconds timestamp. */
export const dayOf = (epochSec) => new Date(epochSec * 1000).toISOString().slice(0, 10);

const ts = (it) => it.publishedAt ?? it.fetchedAt ?? 0;

async function getJSON(env, key, fallback) {
  const raw = await env.NEWS_KV.get(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

// contentStats (SOW-046 A diagnostics): cumulative per-source { full, thin } content-richness tallies, so /diag can
// report how many feeds are blurb-only (the Readability go/no-go signal). Defensive everywhere (older indexes lack it).
export const emptyIndex = () => ({ days: [], counts: { category: {}, source: {} }, contentStats: {}, total: 0, updatedAt: 0 });

export const loadIndex = (env) => getJSON(env, K_INDEX, emptyIndex());
export const loadGuids = (env) => getJSON(env, K_GUIDS, {});
export const loadDay = (env, d) => getJSON(env, kDay(d), []);

// Exported so the SOW-050 image backfill can rewrite a shard in place (image/imgTried fields) + bump freshness,
// keeping ALL KV access isolated in this module (the R2-swap-is-one-file invariant).
export const saveIndex = (env, index) => env.NEWS_KV.put(K_INDEX, JSON.stringify(index));
const saveGuids = (env, guids) => env.NEWS_KV.put(K_GUIDS, JSON.stringify(guids));
export const saveDay = (env, d, items) => env.NEWS_KV.put(kDay(d), JSON.stringify(items));

/** Merge incoming items into a day's array, dedupe by guid (incoming wins), sort newest-first. Pure. */
export function mergeDayItems(existing, incoming) {
  const m = new Map();
  for (const it of existing) m.set(it.guid, it);
  for (const it of incoming) m.set(it.guid, it);
  return [...m.values()].sort((a, b) => ts(b) - ts(a));
}

/** Increment/decrement a counts map in place. Pure. */
export function applyCounts(counts, item, delta) {
  counts.category[item.category] = Math.max(0, (counts.category[item.category] || 0) + delta);
  counts.source[item.source] = Math.max(0, (counts.source[item.source] || 0) + delta);
}

/** Day strings strictly older than the retention window (given current index.days). Pure. */
export function expiredDays(days, retentionDays, now) {
  const cutoff = dayOf(now - retentionDays * 86400);
  return days.filter((d) => d < cutoff);
}

/**
 * Persist a freshly-ingested batch into today's shard and update the guid map + index, then prune
 * day-shards outside the retention window. `items` already have a final category + fetchedAt.
 * `changedCategories` is an optional list of { guid, from, to } for items reclassified this run
 * (their counts are adjusted). Returns the updated index.
 */
export async function commitIngest(env, { freshItems = [], updatedItems = [], changedCategories = [], contentStatsDelta = {}, retentionDays, now, index, guids }) {
  const today = dayOf(now);
  index = index ?? (await loadIndex(env));
  guids = guids ?? (await loadGuids(env));

  // 1. Write fresh (new) + updated (reclassified, already-stored) items into today's shard.
  //    Only fresh items add to the guid map and counts; updated items are re-written in place.
  if (freshItems.length || updatedItems.length) {
    const shard = await loadDay(env, today);
    await saveDay(env, today, mergeDayItems(shard, [...freshItems, ...updatedItems]));
    if (!index.days.includes(today)) index.days.push(today);
    for (const it of freshItems) {
      guids[it.guid] = today;
      applyCounts(index.counts, it, +1);
      index.total += 1;
    }
  }

  // 2. Adjust counts for items whose category changed during this run's reclassification.
  for (const c of changedCategories) {
    if (c.from === c.to) continue;
    index.counts.category[c.from] = Math.max(0, (index.counts.category[c.from] || 0) - 1);
    index.counts.category[c.to] = (index.counts.category[c.to] || 0) + 1;
  }

  // 3. Prune expired day-shards (subtract their counts, drop their guids, delete the shard).
  for (const d of expiredDays(index.days, retentionDays, now)) {
    const shard = await loadDay(env, d);
    for (const it of shard) { applyCounts(index.counts, it, -1); index.total = Math.max(0, index.total - 1); }
    for (const g of Object.keys(guids)) if (guids[g] === d) delete guids[g];
    await env.NEWS_KV.delete(kDay(d));
    index.days = index.days.filter((x) => x !== d);
  }

  // 4. Merge this run's content-richness tallies (SOW-046 A diagnostics) into the cumulative per-source stats.
  index.contentStats = index.contentStats || {};
  for (const [src, d] of Object.entries(contentStatsDelta)) {
    const prev = index.contentStats[src] || { full: 0, thin: 0 };
    index.contentStats[src] = { full: prev.full + (d.full || 0), thin: prev.thin + (d.thin || 0) };
  }

  index.updatedAt = now;
  await saveGuids(env, guids);
  await saveIndex(env, index);
  return index;
}

/**
 * Read items newest-first across day shards, applying filters, stopping once `limit` are collected.
 * Common (recent) queries parse only a shard or two. Returns { items, updatedAt }.
 */
export async function queryItems(env, filter = {}) {
  const { limit = 50 } = filter;
  const index = await loadIndex(env);
  const days = [...index.days].sort().reverse(); // newest day first
  const out = [];
  for (const d of days) {
    const shard = await loadDay(env, d);
    for (const it of shard) if (matchesFilter(it, filter)) out.push(it);
    if (out.length >= limit) break; // enough recent matches; deeper shards not needed
  }
  out.sort((a, b) => ts(b) - ts(a));
  return { items: out.slice(0, limit), updatedAt: index.updatedAt };
}
