// Add a curated set of feeds (frameworks, libraries, blockchain, technology, hardware, energy) to
// config/sources.mjs, VALIDATING each one first (fetch + confirm it parses as RSS/Atom) so we never
// add a dead feed. Merges with the existing sources, deduping by URL.
//
// Run:  node scripts/add-curated.mjs            # add the built-in curated list
//       node scripts/add-curated.mjs <feedUrl>  # also validate + add extra URLs you pass
//
// Re-run anytime; already-present feeds are skipped.

import { XMLParser } from 'fast-xml-parser';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(here, '../config/sources.mjs');
const UA = 'Mozilla/5.0 (compatible; gbti-news/0.1)';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const looksLikeFeed = (xml) => /<(rss|feed|rdf:RDF)\b/i.test(xml) && /<(item|entry)\b/i.test(xml);

// Topic-tagged candidates. Validation drops any that 403/404 or don't parse.
const CANDIDATES = [
  // Frameworks & libraries
  'https://react.dev/rss.xml',
  'https://blog.vuejs.org/feed.rss',
  'https://svelte.dev/blog/rss.xml',
  'https://nextjs.org/feed.xml',
  'https://www.djangoproject.com/rss/weblog/',
  'https://laravel-news.com/feed',
  'https://spring.io/blog.atom',
  'https://kubernetes.io/feed.xml',
  'https://deno.com/feed',
  'https://astro.build/rss.xml',
  'https://css-tricks.com/feed/',
  'https://www.smashingmagazine.com/feed/',
  'https://stackoverflow.blog/feed/',
  // Blockchain
  'https://www.coindesk.com/arc/outboundfeeds/rss/',
  'https://cointelegraph.com/rss',
  'https://decrypt.co/feed',
  'https://www.theblock.co/rss.xml',
  'https://blog.ethereum.org/feed.xml',
  'https://bitcoinmagazine.com/feed',
  // Technology (general)
  'https://www.theverge.com/rss/index.xml',
  'https://www.wired.com/feed/rss',
  'https://www.engadget.com/rss.xml',
  'https://www.technologyreview.com/feed/',
  'https://www.techspot.com/backend.xml',
  // Hardware
  'https://www.tomshardware.com/feeds/all',
  'https://www.servethehome.com/feed/',
  'https://spectrum.ieee.org/feeds/feed.rss',
  'https://www.anandtech.com/rss/',
  // Energy
  'https://electrek.co/feed/',
  'https://cleantechnica.com/feed/',
  'https://www.pv-magazine.com/feed/',
  'https://www.canarymedia.com/feed',
  'https://insideevs.com/rss/articles/all/',
];

const urls = [...new Set([...CANDIDATES, ...process.argv.slice(2).filter((a) => a.startsWith('http'))])];

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

// Validate a feed and pull a human title from it.
async function validate(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, */*' } });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!looksLikeFeed(xml)) return null;
    let name = '';
    try {
      const d = parser.parse(xml);
      let t = d?.rss?.channel?.title ?? d?.feed?.title ?? d?.['rdf:RDF']?.channel?.title ?? '';
      if (t && typeof t === 'object') t = t['#text'] ?? '';
      name = String(t).trim();
    } catch { /* name optional */ }
    if (!name) name = new URL(url).host.replace(/^www\./, '');
    return { name, url, host: new URL(url).host };
  } catch { return null; }
}

console.log(`Validating ${urls.length} candidate feeds...`);
const results = await mapLimit(urls, 8, validate);
const valid = results.filter(Boolean);
for (const u of urls) {
  const ok = valid.find((v) => v.url === u);
  console.log(`  ${ok ? 'OK ' : '-- '} ${u}${ok ? ` (${ok.name})` : ' (dropped)'}`);
}

// Merge into existing config/sources.mjs (dedupe by URL).
let existing = [];
const used = new Set();
if (existsSync(SOURCES_PATH)) {
  try { ({ SOURCES: existing = [] } = await import(SOURCES_PATH)); existing.forEach((s) => used.add(s.id)); } catch { /* fresh */ }
}
const seenUrl = new Set(existing.map((s) => s.url));
const slug = (name, host) => {
  let base = (name || host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'source';
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
};
const added = valid.filter((v) => !seenUrl.has(v.url)).map((v) => ({
  id: slug(v.name, v.host),
  name: v.name,
  description: `Curated feed — ${v.host}`,
  url: v.url,
}));
const all = [...existing, ...added];

const header = `// SOURCE DEFINITIONS — managed here at the filesystem level (no database).
//
// The RSS/Atom feeds the hourly cron polls. Edit by hand, import an OPML
// (\`node scripts/import-opml.mjs\`), discover from daily.dev (\`node scripts/discover-sources.mjs\`),
// or add curated feeds (\`node scripts/add-curated.mjs\`). Each entry: { id, name, description, url }.
//
// ${all.length} sources => suggested SOURCE_CHUNK ~= ${Math.min(20, all.length)} in wrangler.toml (rotate within the free tier).
`;
writeFileSync(SOURCES_PATH, header + `\nexport const SOURCES = ${JSON.stringify(all, null, 2)};\n`);
console.log(`\nAdded ${added.length} new feed(s); ${all.length} total in config/sources.mjs`);
