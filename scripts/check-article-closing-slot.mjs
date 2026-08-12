#!/usr/bin/env node
// Build guard (sow-183 QA follow-up): the article "closing" slot (CommunityInvite, AuthorBox/"Written by",
// and the Comments section, all composed once in src/pages/articles/[slug].astro and shared across every
// Article*.astro layout) rendered completely EMPTY on every non-Journal article for a while, because Astro
// silently drops every statically-slotted sibling on a page when ANY ONE slotted child uses a non-literal
// slot attribute. That regression shipped, passed the full unit suite, and passed every other check:*
// guard, since none of them render or inspect an article page's body content -- it was caught only by manual
// inspection. This guard closes that gap: it renders no component itself, but scans the BUILT HTML of every
// article page for markers that only appear when ContentFooter's children actually rendered, so a future
// recurrence of the same bug class fails the build instead of shipping silently.
//
// Honest limitation: this only proves what CONTENT actually renders. Today every published post carries
// layout: journal (the sow-183 backfill), so this guard exercises Journal on every real page it checks;
// Editorial's and Card's own slot wiring gets ZERO live coverage until a post actually uses one of them (the
// LAYOUT_SIGNATURES note below reports this plainly rather than implying broader coverage than it has).
//   node scripts/check-article-closing-slot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Each marker is a literal HTML substring that appears ONLY when the real element renders (never inside a
// <style> block's selector text, which is how an earlier debugging session was misled by "community-invite"
// alone -- that string also appears in an unrelated global `.community-invite{display:none}` rule on every
// page regardless of whether the section itself rendered).
// A marker may be an ARRAY, meaning any one of them satisfies the check.
const CLOSING_SLOT_MARKERS = [
  ['CommunityInvite ("Join the GBTI Network")', 'class="dark community-invite"'],
  // sow-219 (2026-08-11): an article can now carry a from-the-author note, and ContentFooter's skipAuthorBox
  // DELIBERATELY drops the "Written by" box when it does, because the pinned note already carries the byline.
  // This entry required the AuthorBox specifically, so the first article published with a note failed the
  // build. The real invariant is that the page attributes its author ONE of the two ways.
  ['the author attribution (AuthorBox "Written by", or the pinned "From the author" note)',
    ['class="author-box mx-auto"', 'style="color:var(--green-700)">From the author<']],
  ['Comments section', 'id="comments"'],
];

// Which layout a built page used, inferred from a signature class only that layout's markup emits. Purely
// informational (drives the coverage note below), not part of the pass/fail check itself.
const LAYOUT_SIGNATURES = [
  ['journal', 'art-j-rail'],
  ['editorial', 'art-e-hero'],
  ['editorial (no cover)', 'art-e-header-flat'],
  ['card', 'art-c-card'],
];

/**
 * Scan every built dist/articles/<slug>/index.html for the closing-slot markers. Pure over root/distDir, so
 * it is unit-testable against a hand-built temp dist. Returns { errors, notes, checked }.
 */
export function checkArticleClosingSlot({ root, distDir = path.join(root, 'dist') } = {}) {
  const errors = [];
  const notes = [];
  let checked = 0;
  const articlesDir = path.join(distDir, 'articles');

  if (!fs.existsSync(articlesDir)) {
    notes.push('dist/articles not found, skipped the closing-slot guard (run after `npm run build`).');
    return { errors, notes, checked };
  }

  const layoutsSeen = new Set();
  const slugs = fs.readdirSync(articlesDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  for (const slug of slugs) {
    const file = path.join(articlesDir, slug, 'index.html');
    if (!fs.existsSync(file)) continue;
    checked++;
    const html = fs.readFileSync(file, 'utf8');
    for (const [label, marker] of CLOSING_SLOT_MARKERS) {
      const anyOf = Array.isArray(marker) ? marker : [marker];
      if (!anyOf.some((m) => html.includes(m))) {
        errors.push(`articles/${slug}/: missing ${label} -- the ContentFooter closing-slot content did not render. A non-literal slot attribute on any ONE slotted child in [slug].astro or an Article*.astro layout silently drops every OTHER statically-slotted sibling (this exact bug shipped once, see sow-183); check for that first.`);
      }
    }
    for (const [name, sig] of LAYOUT_SIGNATURES) if (html.includes(sig)) layoutsSeen.add(name);
  }

  if (checked === 0) {
    notes.push('no built article pages found under dist/articles, nothing to check.');
  } else {
    const missingLayouts = ['journal', 'editorial', 'card'].filter((l) => !layoutsSeen.has(l) && ![...layoutsSeen].some((s) => s.startsWith(l)));
    if (missingLayouts.length) {
      notes.push(`this run only exercised ${[...layoutsSeen].join(', ') || 'no recognized layout'} -- ${missingLayouts.join('/')} got zero live coverage from this guard (no published post currently uses ${missingLayouts.length > 1 ? 'them' : 'it'}).`);
    }
  }
  return { errors, notes, checked };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, notes, checked } = checkArticleClosingSlot({ root: ROOT });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ article closing-slot guard failed (${errors.length} issue${errors.length === 1 ? '' : 's'} across ${checked} page${checked === 1 ? '' : 's'} checked):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ article closing-slot guard passed (${checked} article page${checked === 1 ? '' : 's'} checked)`);
}
