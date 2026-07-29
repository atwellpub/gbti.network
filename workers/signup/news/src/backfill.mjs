// SOW-050 Tier 1: backfill the source-article image for ALREADY-STORED items that carry none.
//
// Tier 0 (the inline-body <img> in feeds.pickImage) only runs at PARSE time on fresh items, and the article body is
// never persisted — so the existing 30-day backlog can only get images by FETCHING each article and scraping its
// og:image (og-image.mjs). This pass scans the stored shards newest-first (the items members see soonest get pictures
// first), takes up to `cap` candidates that have no image yet AND were not already tried, fetches + scrapes each, and
// writes the result back. A per-item `imgTried` flag makes it CONVERGE: a genuinely image-less article is attempted
// once, never refetched. Capped + catch-up across runs so it stays under the free 50-subrequest / 10 ms-CPU budget —
// run it as its own cron schedule (its own budget, separate from collection+AI).

import { loadIndex, loadDay, saveDay, saveIndex } from './store.mjs';
import { fetchOgImage } from './og-image.mjs';

const DEFAULT_CAP = 12;     // article fetches per run; a separate cron gives this its own 50-subrequest budget
const FETCH_CONCURRENCY = 4; // polite to publishers + bounds peak CPU

/** Run `fn` over items with a fixed concurrency limit; preserves order. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * Backfill images for stored items that lack one. `now` is epoch seconds (injected in tests). `fetchImpl` is
 * injectable. Returns a summary (also logged).
 */
export async function backfillImages(env, { now = Math.floor(Date.now() / 1000), cap = Number(env.MAX_IMAGE_BACKFILL) || DEFAULT_CAP, fetchImpl = fetch } = {}) {
  const index = await loadIndex(env);
  const days = [...index.days].sort().reverse(); // newest day first

  // 1. Collect up to `cap` candidates (no image yet, has a link, not previously tried), grouped by day shard. The
  //    picked items are live references into each loaded shard, so mutating them mutates the shard we save in step 3.
  const byDay = new Map(); // day -> { shard, picks: item[] }
  let picked = 0;
  for (const d of days) {
    if (picked >= cap) break;
    const shard = await loadDay(env, d);
    const picks = [];
    for (const it of shard) {
      if (picked >= cap) break;
      if (!it.image && it.link && !it.imgTried) { picks.push(it); picked += 1; }
    }
    if (picks.length) byDay.set(d, { shard, picks });
  }
  if (!picked) return logged({ at: 'backfill-images', now, candidates: 0, fetched: 0, found: 0, shards: 0, scannedDays: days.length });

  // 2. Fetch + scrape each candidate (concurrency-limited). Mark every one tried (so we converge); set image on hit.
  const flat = [...byDay.values()].flatMap((v) => v.picks);
  const hits = await mapLimit(flat, FETCH_CONCURRENCY, async (it) => {
    const img = await fetchOgImage(it.link, { fetchImpl }).catch(() => null);
    it.imgTried = now;
    if (img) { it.image = img; return true; }
    return false;
  });
  const found = hits.filter(Boolean).length;

  // 3. Persist every touched shard, then bump index freshness.
  for (const [d, v] of byDay) await saveDay(env, d, v.shard);
  index.updatedAt = now;
  await saveIndex(env, index);

  return logged({ at: 'backfill-images', now, candidates: picked, fetched: flat.length, found, shards: byDay.size, scannedDays: days.length });
}

function logged(summary) {
  console.log(JSON.stringify(summary));
  return summary;
}
