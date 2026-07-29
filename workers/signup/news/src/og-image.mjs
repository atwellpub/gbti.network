// SOW-050 Tier 1: scrape a source article's lead image from its HTML <head> (og:image, then twitter:image, then
// <link rel="image_src">). The regex-only scraper now lives in the SHARED module workers/lib/og-scrape.mjs (also
// used by the SOW-057 share OG-preview endpoint); this file re-exports it and keeps the news-bot fetch wrapper.

export { scrapeOgImage } from '../../../lib/og-scrape.mjs';
import { scrapeOgImage } from '../../../lib/og-scrape.mjs';

/** Fetch an article page (bounded, timed out) and scrape its og:image. Returns the URL or null. Never throws.
 *  `fetchImpl` is injectable for tests. `maxBytes` caps the body we scan (og tags are near the top). */
export async function fetchOgImage(link, { fetchImpl = fetch, timeoutMs = 8000, maxBytes = 60000 } = {}) {
  const url = String(link || '');
  if (!/^https?:\/\//i.test(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'gbti-news-bot/0.1 (+https://gbti.network)', Accept: 'text/html,application/xhtml+xml' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res || !res.ok) return null;
    const ct = res.headers?.get?.('content-type') || '';
    if (ct && !/html|xml/i.test(ct)) return null; // not an HTML page (e.g. a PDF/feed) -> nothing to scrape
    let html = await res.text();
    if (typeof html === 'string' && html.length > maxBytes) html = html.slice(0, maxBytes);
    return scrapeOgImage(html, url) || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
