// Bulk-import RSS sources from an OPML file into config/sources.mjs.
//
// OPML is the universal "list of feeds" format that every RSS reader exports (Feedly, Inoreader,
// NetNewsWire, daily.dev Plus, etc.). This avoids hand-copying feeds: export an OPML from any reader
// (or grab a curated dev-feeds OPML), then run:
//
//   node scripts/import-opml.mjs path/to/feeds.opml
//   node scripts/import-opml.mjs path/to/feeds.opml --merge   # keep existing sources, add new ones
//
// It collects every <outline> that has an xmlUrl (the RSS/Atom feed), dedupes by feed URL, generates
// stable slugs, and rewrites config/sources.mjs. Review the diff before deploying.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { XMLParser } from 'fast-xml-parser';

const here = dirname(fileURLToPath(import.meta.url));
const SOURCES_PATH = resolve(here, '../config/sources.mjs');

const args = process.argv.slice(2);
const merge = args.includes('--merge');
const opmlPath = args.find((a) => !a.startsWith('--'));
if (!opmlPath) {
  console.error('Usage: node scripts/import-opml.mjs <feeds.opml> [--merge]');
  process.exit(1);
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
const xml = readFileSync(resolve(opmlPath), 'utf8');
const doc = parser.parse(xml);

// Walk the (possibly nested) outline tree, collecting feed outlines (those with an xmlUrl).
const feeds = [];
(function walk(node) {
  if (!node) return;
  const outlines = Array.isArray(node) ? node : node.outline ? (Array.isArray(node.outline) ? node.outline : [node.outline]) : [];
  for (const o of outlines) {
    const xmlUrl = o['@_xmlUrl'] || o['@_xmlurl'];
    if (xmlUrl) {
      feeds.push({
        name: (o['@_title'] || o['@_text'] || xmlUrl).trim(),
        url: xmlUrl.trim(),
        site: (o['@_htmlUrl'] || '').trim(),
      });
    }
    if (o.outline) walk(o); // recurse into categories
  }
})(doc.opml?.body ?? doc.body ?? doc);

if (feeds.length === 0) {
  console.error('No feed outlines (elements with xmlUrl) found in that OPML.');
  process.exit(1);
}

// Slugify a name into a stable, unique id.
const used = new Set();
function slug(name, url) {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!base) {
    try { base = new URL(url).hostname.replace(/^www\./, '').replace(/[^a-z0-9]+/g, '-'); } catch { base = 'source'; }
  }
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

// Optionally merge with the existing config.
let existing = [];
if (merge && existsSync(SOURCES_PATH)) {
  try {
    ({ SOURCES: existing = [] } = await import(SOURCES_PATH));
    for (const s of existing) used.add(s.id);
  } catch { /* ignore, start fresh */ }
}

const seenUrl = new Set(existing.map((s) => s.url));
const imported = [];
for (const f of feeds) {
  if (seenUrl.has(f.url)) continue;
  seenUrl.add(f.url);
  imported.push({
    id: slug(f.name, f.url),
    name: f.name,
    description: f.site ? `Imported from OPML — ${f.site}` : 'Imported from OPML.',
    url: f.url,
  });
}

const all = [...existing, ...imported];

const header = `// SOURCE DEFINITIONS — managed here at the filesystem level (no database).
//
// The list of RSS/Atom feeds the hourly cron polls. Edit by hand, or bulk-import with
// \`node scripts/import-opml.mjs <feeds.opml>\`. Each entry:
//   id          short stable slug stored on every item (the API filters by it). Must be unique and
//               must NOT change once items exist, or dedupe history for that source resets.
//   name        human-readable source name, surfaced by GET /sources.
//   description what this source covers — shown by GET /sources.
//   url         the RSS or Atom feed URL. parseFeed() handles both formats.
//
// With many sources, set SOURCE_CHUNK in wrangler.toml so each hourly run polls a rotating subset
// (stays under the free 50-subrequest budget). ${all.length} sources => suggested SOURCE_CHUNK ~= ${Math.min(30, all.length)}.
`;

const body = `\nexport const SOURCES = ${JSON.stringify(all, null, 2)};\n`;
writeFileSync(SOURCES_PATH, header + body);

console.log(`Imported ${imported.length} new feed(s); ${all.length} total written to config/sources.mjs`);
if (all.length > 45) console.log(`Tip: set SOURCE_CHUNK = "${Math.min(30, all.length)}" in wrangler.toml to rotate within the free tier.`);
