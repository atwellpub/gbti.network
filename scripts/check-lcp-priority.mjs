#!/usr/bin/env node
// sow-278 build guard: EXACTLY ONE image per page may be promoted out of lazy loading.
//
// WHY THIS EXISTS. Cloudflare RUM field data showed the site's two slowest painted elements were both
// lazy-loaded hero images: the homepage feed card cover at p75 2,840ms and the article cover at 2,244ms.
// Astro's <Image> and the raw <img> in FeedList both default to loading="lazy", and across every LCP sample
// the site had ever recorded, lcpFetchPriority was only ever `n/a` or `auto`, never `high`. Nothing had ever
// told the browser which image mattered.
//
// THE FIX IS ONLY A FIX WHILE IT STAYS NARROW. Priority is zero-sum: promoting one image tells the browser
// to fetch it before the other 290 on the page, and promoting a hundred tells it nothing at all. The
// homepage renders 293 <img> tags, so "eager on the covers" is one careless refactor away from being eager
// on all of them, at which point the metric quietly gets worse and every other check still passes.
//
// SO THIS GUARD IS TWO-SIDED ON PURPOSE, and the positive half is the important one. A guard that only
// forbids too many eager images passes perfectly on a build with ZERO, which is the exact state before the
// fix. It therefore also REQUIRES the promotion to be present on the pages that need it, so that losing the
// fix fails the build rather than silently returning to the defect.
//   node scripts/check-lcp-priority.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listBuiltDetailPages, distHasHtml } from './lib/dist-pages.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = path.join(ROOT, 'dist');

/** Every built .html file under dist, relative to dist. */
function walkHtml(dir, base = dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(p, base, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(path.relative(base, p));
  }
  return out;
}

const EAGER = /<img\b[^>]*\bloading=["']eager["']/gi;
const HIGH = /<img\b[^>]*\bfetchpriority=["']high["']/gi;

function countIn(html) {
  return { eager: (html.match(EAGER) || []).length, high: (html.match(HIGH) || []).length };
}

const problems = [];
const pages = walkHtml(DIST);

// A run with no subjects proves nothing, and saying so is the whole point: an empty dist would otherwise
// report a clean bill of health for a site that was never built.
if (!distHasHtml(DIST) || pages.length < 50) {
  console.error(`check-lcp-priority: dist has ${pages.length} html pages, which is too few to be a real build.`);
  console.error('Run `npm run build` first. Refusing to report a pass on a build that does not exist.');
  process.exit(1);
}

// NEGATIVE HALF: nobody may promote more than one image on a page.
for (const rel of pages) {
  const html = fs.readFileSync(path.join(DIST, rel), 'utf8');
  const { eager, high } = countIn(html);
  if (eager > 1) problems.push(`${rel}: ${eager} images with loading="eager"; at most 1 may be promoted`);
  if (high > 1) problems.push(`${rel}: ${high} images with fetchpriority="high"; at most 1 may be promoted`);
}

// POSITIVE HALF: the pages the field data named must actually carry the promotion.
const REQUIRED = [];
if (fs.existsSync(path.join(DIST, 'index.html'))) REQUIRED.push(['index.html', 'the homepage feed, whose first card cover is the slowest element the site measures']);
const articles = listBuiltDetailPages(DIST, 'articles');
// Only an article that HAS a cover can carry the promotion, so pick a subject by that property rather than
// asserting it of every article and failing on the coverless ones.
const withCover = articles.map((s) => `articles/${s}/index.html`)
  .filter((rel) => /class="art-j-cover"/.test(fs.readFileSync(path.join(DIST, rel), 'utf8')));
if (withCover.length) REQUIRED.push([withCover[0], 'an article cover, the largest single bucket in the field data']);

for (const [rel, why] of REQUIRED) {
  const html = fs.readFileSync(path.join(DIST, rel), 'utf8');
  const { eager, high } = countIn(html);
  if (eager !== 1) problems.push(`${rel}: expected exactly 1 loading="eager" image (${why}), found ${eager}`);
  if (high !== 1) problems.push(`${rel}: expected exactly 1 fetchpriority="high" image (${why}), found ${high}`);
}

// Report what was and was not covered, rather than implying the whole site was proven.
console.log(`check-lcp-priority: scanned ${pages.length} built pages.`);
console.log(`  required-promotion subjects: ${REQUIRED.length ? REQUIRED.map(([r]) => r).join(', ') : 'NONE'}`);
if (!withCover.length) console.log(`  note: ${articles.length} article page(s) built, none with a cover image, so the article half is UNCOVERED this run.`);

if (problems.length) {
  console.error(`\ncheck-lcp-priority FAILED with ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('check-lcp-priority: OK (exactly one promoted image on each required page, none over the cap).');
