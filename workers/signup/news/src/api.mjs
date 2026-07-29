// Pure query/shaping helpers for the JSON API. No I/O — easy to unit-test.

import { CATEGORIES } from '../config/categories.mjs';
import { SOURCES } from '../config/sources.mjs';

/** Clamp a user-supplied limit to [1, max], defaulting when absent/invalid. */
export function clampLimit(raw, def = 50, max = 100) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

/** Does an item match the given /feed filters? Pure; shared by the store's shard scan. */
export function matchesFilter(item, { category, source, since } = {}) {
  if (category && String(item.category || '').toLowerCase() !== String(category).toLowerCase()) return false;
  if (source && item.source !== source) return false;
  const sinceN = Number.parseInt(since, 10);
  if (Number.isFinite(sinceN) && (item.publishedAt ?? item.fetchedAt ?? 0) < sinceN) return false;
  return true;
}

/** Public item view (drop the internal `classified` flag). */
export function publicItem(i) {
  return {
    guid: i.guid,
    source: i.source,
    title: i.title,
    link: i.link,
    image: i.image ?? null, // source article image (RSS enclosure/media), or null when the feed carried none
    summary: i.summary,
    digest: i.digest, // SOW-046 A: the AI-generated 1-2 sentence summary (absent until analyzed; falls back to summary)
    category: i.category,
    publishedAt: i.publishedAt,
    fetchedAt: i.fetchedAt,
  };
}

/** Categories (from config) joined with current counts (from the store index's counts.category map). */
export function categoriesWithCounts(countsByCategory = {}) {
  return CATEGORIES.map((c) => ({
    name: c.name,
    description: c.description,
    count: countsByCategory[c.name] || 0,
  }));
}

/**
 * SOW-046 A diagnostics: aggregate the cumulative per-source content-richness stats (index.contentStats) into a
 * report for the /diag route — overall full-vs-thin, plus the sources that are mostly blurb-only (a meaningful
 * sample and >=60% thin) which a Readability fetch would most help. Pure; defensive against an older index.
 */
export function contentDiagnostics(index = {}) {
  const stats = index.contentStats || {};
  let full = 0;
  let thin = 0;
  const perSource = SOURCES.map((s) => {
    const d = stats[s.id] || { full: 0, thin: 0 };
    const f = d.full || 0;
    const t = d.thin || 0;
    full += f;
    thin += t;
    const seen = f + t;
    return { id: s.id, name: s.name, full: f, thin: t, thinPct: seen ? Math.round((t / seen) * 100) : null };
  });
  const seen = full + thin;
  const readabilityCandidates = perSource
    .filter((s) => s.full + s.thin >= 5 && s.thinPct !== null && s.thinPct >= 60)
    .sort((a, b) => b.thinPct - a.thinPct)
    .map((s) => s.id);
  return {
    totals: { full, thin, seen, thinPct: seen ? Math.round((thin / seen) * 100) : null },
    readabilityCandidates,
    perSource: perSource.sort((a, b) => b.thin - a.thin),
  };
}

/** Sources (from config) joined with current counts (from the store index's counts.source map). */
export function sourcesWithCounts(countsBySource = {}) {
  return SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    url: s.url,
    count: countsBySource[s.id] || 0,
  }));
}
