#!/usr/bin/env node
// sow-215 Check A: does the rendered byline EQUAL the profile it claims to show?
//
// Every other dist guard we have asks whether the output is HAZARDOUS: nothing leaked, the CSP is present,
// nothing overflows, every redirect resolves, a slot is not empty. None of them asks whether the output is
// RIGHT. Defect 1 of sow-215 was exactly that gap: after sow-195 the raw username rendered as the byline on
// 29 published pages, and CI, the full unit suite and a 163-page build all passed, because the HTML was
// well-formed, leaked nothing, overflowed nothing, and was simply wrong.
//
// WHAT THIS PROVES, AND NOTHING BROADER: for the pages that exist in dist/ at the moment it runs, every
// rendered byline matches what the author's profile says their name is. It proves nothing about pages that
// were not built, about drafts, or about any other rendered value. That boundary is the honest scope, not a
// disclaimer.
//
// WHY THERE IS NO COVERAGE ADVISORY, DELIBERATELY. The sibling guard check-article-closing-slot.mjs prints a
// zero-coverage note on every run, and everyone read past it for weeks, which is how the Editorial and Card
// layouts shipped with no live coverage at all. A guard that reports a gap nobody acts on fails more quietly
// than one that goes red. So here, finding NOTHING TO CHECK is a FAILURE, not a note: a run that scanned no
// bylines has proved nothing, and it says so by exiting non-zero.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Mirrors src/lib/authors.ts. The two network pseudo-authors render as the brand rather than as a username.
const NETWORK_AUTHORS = new Set(['gbti', 'gbtilabs']);

// Mirrors ContentMeta.astro: `prof?.displayName ?? authorDisplay(author)`.
const expectedName = (username, displayName) =>
  displayName != null && displayName !== ''
    ? displayName
    : (NETWORK_AUTHORS.has(username) ? 'GBTI Network' : username);

const decode = (s) => String(s)
  .replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .trim();

const frontmatterField = (txt, key) => {
  const m = new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm').exec(txt);
  if (!m) return null;
  return m[1].replace(/^["']|["']$/g, '').trim();
};

function walkHtml(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkHtml(p, out);
    else if (e.isFile() && e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

// Attribute ORDER is not guaranteed across Astro versions, so match the anchor and read its attributes
// rather than pinning `href="..." class="cm-name"` as one literal string.
const ANCHOR = /<a\s([^>]*?)>([\s\S]*?)<\/a>/g;
const HREF = /href="([^"]*)"/;
const MEMBER_HREF = /^\/members\/([^/]+)\/$/;

export function checkBylineEquivalence({ root }) {
  const errors = [];

  // username -> displayName (only for profiles that define one)
  const profiles = new Map();
  const membersDir = path.join(root, 'members');
  for (const owner of (fs.existsSync(membersDir) ? fs.readdirSync(membersDir) : [])) {
    const f = path.join(membersDir, owner, 'profile.md');
    if (!fs.existsSync(f)) continue;
    const txt = fs.readFileSync(f, 'utf8');
    const username = frontmatterField(txt, 'username') ?? owner;
    profiles.set(username, frontmatterField(txt, 'displayName'));
  }

  const distDir = path.join(root, 'dist');
  const files = walkHtml(distDir);
  let checked = 0;
  const pages = new Set();

  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    const rel = path.relative(distDir, file);
    ANCHOR.lastIndex = 0;
    let m;
    while ((m = ANCHOR.exec(html)) !== null) {
      const [, attrs, inner] = m;
      // `\b` treats a hyphen as a word boundary, so this matches `cm-name` AND `cm-name-v2` (deliberately
      // tolerant of a suffixed rename) but NOT `byline-name` or `cmname`. Worth knowing before writing a
      // negative fixture: @UnifiedWorker's first attempt to prove the partial-rename hole used `cm-name-v2`
      // and failed because the guard still matched it.
      if (!/class="[^"]*\bcm-name\b[^"]*"/.test(attrs)) continue;
      const href = HREF.exec(attrs)?.[1];
      if (!href) continue;
      const um = MEMBER_HREF.exec(href);
      if (!um) continue; // the retired `gbti` pseudo-author links to `/`, and has no profile to compare against
      const username = um[1];
      if (!profiles.has(username)) continue; // no profile on disk: nothing to be equivalent TO

      checked += 1;
      pages.add(rel);
      const shown = decode(inner.replace(/<[^>]*>/g, ''));
      const expected = expectedName(username, profiles.get(username));
      if (shown !== expected) {
        errors.push(
          `${rel}: byline for author "${username}" renders "${shown}" but the profile says "${expected}"`
        );
      }
    }
  }

  // Zero coverage is a FAILURE, not a note. See the header: a run that checked nothing proved nothing, and
  // an advisory line is exactly how the sibling guard's gap went unnoticed for weeks.
  if (files.length === 0) {
    errors.push('no built HTML found in dist/ -- run the build before this guard, since it can prove nothing without it');
  } else if (checked === 0) {
    errors.push(
      `scanned ${files.length} built page(s) and found ZERO bylines to check, so this guard proved nothing. ` +
      'Either the byline markup changed (the guard keys on class="cm-name" in ContentMeta.astro) or no ' +
      'content detail page was built. Fix the guard or the build; do not ignore this line.'
    );
  }

  return { errors, checked, pages: pages.size, files: files.length };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, checked, pages } = checkBylineEquivalence({ root: ROOT });
  if (errors.length) {
    console.error(`✗ byline equivalence guard FAILED (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ byline equivalence guard passed (${checked} byline${checked === 1 ? '' : 's'} across ${pages} page${pages === 1 ? '' : 's'})`);
}
