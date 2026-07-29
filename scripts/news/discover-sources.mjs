// Discover real publisher RSS feeds from daily.dev's "Happening Now" highlights, and write them into
// config/sources.mjs. This is a one-off dev tool (NOT part of the Worker) — it uses a headless browser
// because the highlights are client-rendered. It never makes daily.dev a source; it extracts the
// ORIGINAL publishers daily.dev links to and subscribes us to their own public RSS feeds.
//
// Proven pipeline (verified end-to-end):
//   highlight  --expand-->  /posts/<slug>  --on post page-->  api.daily.dev/r/<id>  --302-->
//   publisher domain  --autodiscover-->  <link rel="alternate" type="application/rss+xml">
//
// Prereqs:  npm i -D playwright && npx playwright install chromium
// Run:      node scripts/discover-sources.mjs                 # default category tabs
//           node scripts/discover-sources.mjs security rust   # specific highlight tabs
//           node scripts/discover-sources.mjs --merge         # keep existing config, add new
//
// Output: rewrites config/sources.mjs (review the diff before deploying). Confirms each feed parses.

import { chromium } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import { writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(here, '../config/sources.mjs');

const rawArgs = process.argv.slice(2);
const merge = rawArgs.includes('--merge');
const tabArgs = rawArgs.filter((a) => !a.startsWith('--'));
// Highlight tab slugs ('' = Headlines). Default to a spread covering the GBTI categories.
const TABS = tabArgs.length ? tabArgs : ['', 'security', 'webdev', 'backend', 'rust', 'golang', 'python', 'opensource', 'vibes'];

const UA = 'Mozilla/5.0 (gbti-news source discovery)';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const looksLikeFeed = (xml) => /<(rss|feed|rdf:RDF)\b/i.test(xml) && /<(item|entry)\b/i.test(xml);

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// Like mapLimit, but each concurrent worker gets its OWN browser page (concurrent page.goto on a
// single shared page cancel each other — that's why a shared page resolves almost nothing).
async function crawlWithPages(browser, items, concurrency, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    const pg = await browser.newPage({ userAgent: UA });
    while (i < items.length) { const idx = i++; out[idx] = await fn(pg, items[idx], idx); }
    await pg.close();
  }));
  return out;
}

const PER_TAB_CAP = 60; // highlights are ~50/tab; cap guards against over-harvest

// Resolve a daily.dev click-redirect to the publisher URL without loading the heavy article page.
async function resolveRedirect(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA } });
    const loc = res.headers.get('location');
    if (loc) return loc;
    // Some redirects are 200 + meta refresh; fall back to following.
    const followed = await fetch(url, { headers: { 'User-Agent': UA } });
    return followed.url || null;
  } catch { return null; }
}

// Find a publisher's feed: autodiscovery on the homepage, then common fallback paths. Confirm it parses.
async function findFeed(origin) {
  const candidates = [];
  try {
    const res = await fetch(origin, { headers: { 'User-Agent': UA } });
    const html = await res.text();
    for (const m of html.matchAll(/<link\b[^>]*rel=["']alternate["'][^>]*>/gi)) {
      const tag = m[0];
      if (/type=["']application\/(rss|atom)\+xml["']|type=["']application\/xml["']/i.test(tag)) {
        const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
        if (href) candidates.push(new URL(href, origin).href);
      }
    }
  } catch { /* ignore */ }
  candidates.push(`${origin}/feed/`, `${origin}/rss`, `${origin}/rss.xml`, `${origin}/index.xml`, `${origin}/feed`, `${origin}/atom.xml`);
  for (const url of [...new Set(candidates)]) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA } });
      if (r.ok && looksLikeFeed(await r.text())) return url;
    } catch { /* try next */ }
  }
  return null;
}

const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: UA });

// 1. Harvest post URLs from each highlight tab.
const postUrls = new Set();
for (const tab of TABS) {
  const url = `https://app.daily.dev/highlights${tab ? '/' + tab : ''}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    // Expand only the highlight accordions (buttons with aria-expanded), then collect the "Read more"
    // links from WITHIN those accordion <article>s — not post cards elsewhere on the page.
    const expanders = await page.$$('article button[aria-expanded]');
    for (const b of expanders) { await b.click().catch(() => {}); }
    await page.waitForTimeout(2500);
    const links = await page.$$eval('article', (arts) =>
      arts
        .filter((a) => a.querySelector('button[aria-expanded]'))
        .flatMap((a) => [...a.querySelectorAll('a[href*="/posts/"]')].map((x) => x.href)),
    );
    links.slice(0, PER_TAB_CAP).forEach((l) => postUrls.add(l.split('?')[0]));
    console.log(`tab ${tab || 'headlines'}: ${links.length} highlight posts (running unique total ${postUrls.size})`);
  } catch (e) {
    console.error(`tab ${tab} failed: ${e.message}`);
  }
}

// 2. For each post, read the exact click-redirect + the daily.dev source name. Each worker uses its
// own page so concurrent navigations don't cancel each other.
const posts = await crawlWithPages(browser, [...postUrls], 4, async (pg, postUrl) => {
  try {
    await pg.goto(postUrl, { waitUntil: 'domcontentloaded' });
    await pg.waitForTimeout(1200);
    const redirect = await pg.$eval('a[href^="https://api.daily.dev/r/"]', (a) => a.href).catch(() => null);
    const sourceName = await pg.$eval('a[href*="/sources/"]', (a) => a.textContent.trim()).catch(() => null);
    return redirect ? { postUrl, redirect, sourceName } : null;
  } catch { return null; }
});
await browser.close();

// 3. Resolve redirects -> publisher origins (dedupe by host). Network only, no browser.
const resolved = await mapLimit(posts.filter(Boolean), 6, async (p) => {
  const target = await resolveRedirect(p.redirect);
  if (!target) return null;
  try { return { ...p, origin: new URL(target).origin, host: new URL(target).host }; } catch { return null; }
});

const byHost = new Map();
for (const r of resolved.filter(Boolean)) if (!byHost.has(r.host)) byHost.set(r.host, r);
console.log(`\n${byHost.size} unique publishers found. Resolving feeds...`);

// 4. Find + confirm a feed per publisher.
const found = await mapLimit([...byHost.values()], 6, async (p) => {
  const feed = await findFeed(p.origin);
  console.log(`  ${feed ? 'OK ' : '-- '} ${p.host}${feed ? ' -> ' + feed : ' (no feed found)'}`);
  return feed ? { name: p.sourceName || p.host.replace(/^www\./, ''), host: p.host, url: feed } : null;
});

// 5. Build config/sources.mjs (merge optional).
const used = new Set();
const slug = (name, host) => {
  let base = (name || host).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'source';
  let id = base, n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
};

let existing = [];
if (merge && existsSync(SOURCES_PATH)) {
  try { ({ SOURCES: existing = [] } = await import(SOURCES_PATH)); existing.forEach((s) => used.add(s.id)); } catch { /* fresh */ }
}
const seenUrl = new Set(existing.map((s) => s.url));
const imported = found.filter(Boolean).filter((f) => !seenUrl.has(f.url)).map((f) => ({
  id: slug(f.name, f.host),
  name: f.name,
  description: f.host, // the source domain (we poll the feed directly); no attribution prefix
  url: f.url,
}));
const all = [...existing, ...imported];

const header = `// SOURCE DEFINITIONS — managed here at the filesystem level (no database).
//
// The RSS/Atom feeds the hourly cron polls. Edit by hand, import an OPML
// (\`node scripts/import-opml.mjs\`), or discover from daily.dev highlights
// (\`node scripts/discover-sources.mjs\`). Each entry: { id, name, description, url }.
//
// ${all.length} sources => suggested SOURCE_CHUNK ~= ${Math.min(30, all.length)} in wrangler.toml (rotate within the free tier).
`;
writeFileSync(SOURCES_PATH, header + `\nexport const SOURCES = ${JSON.stringify(all, null, 2)};\n`);
console.log(`\nWrote ${all.length} sources (${imported.length} new) to config/sources.mjs`);
if (all.length > 45) console.log(`Set SOURCE_CHUNK = "${Math.min(30, all.length)}" in wrangler.toml to rotate within the free tier.`);
