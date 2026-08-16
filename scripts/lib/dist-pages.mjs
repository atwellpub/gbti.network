// Shared enumeration of BUILT detail pages, for the dist guards.
//
// WHY THIS IS SHARED RATHER THAN PRIVATE TO ONE GUARD. Two guards need the same question answered: which
// content-type detail pages did this build actually emit. check-article-closing-slot needs it to know
// whether it has any subjects (a run with none proves nothing), and sow-242's per-content-type coverage
// floor needs it to require that each BUILT section yields at least one checked item. Two implementations
// of "walk dist and find the detail pages" would drift, and the drift would be silent in both directions:
// a guard that enumerates slightly differently from its sibling reports slightly different coverage and
// nobody can tell which is right.
//
// It answers ONLY what was built. It deliberately does not read the content collections, because a guard
// that compares dist against its own reimplementation of the publish rules is asserting that two copies of
// a rule agree, not that the build is correct. The build is the authority for what exists; these guards
// check what is IN what was built.
import fs from 'node:fs';
import path from 'node:path';

/** The content types that render a `/<type>/<slug>/` detail page. */
export const DETAIL_PAGE_TYPES = Object.freeze(['articles', 'products', 'prompts']);

/**
 * Slugs of built detail pages for one type, or [] when the section was not built at all.
 *
 * Returning [] for "section absent" and [] for "section present but empty" is DELIBERATE: they are the same
 * fact to a caller deciding whether it has subjects, and `sectionBuilt` below is there for the one caller
 * that needs to tell them apart. Keeping that distinction out of the return value stops every caller having
 * to handle a third case it does not care about.
 */
export function listBuiltDetailPages(distDir, type) {
  const dir = path.join(distDir, type);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((slug) => fs.existsSync(path.join(dir, slug, 'index.html')))
    .sort();
}

/** Was this content-type section built at all? Distinguishes "no build" from "built and empty". */
export function sectionBuilt(distDir, type) {
  return fs.existsSync(path.join(distDir, type));
}

/** Every type that this build actually emitted a section for. sow-242 enumerates coverage from this. */
export function builtSections(distDir, types = DETAIL_PAGE_TYPES) {
  return types.filter((t) => sectionBuilt(distDir, t));
}

/** Did this build produce ANY HTML at all? The cheapest way to tell "not built" from "built and wrong". */
export function distHasHtml(distDir) {
  const stack = [distDir];
  while (stack.length) {
    let entries;
    try {
      entries = fs.readdirSync(stack.pop(), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (e.isFile() && e.name.endsWith('.html')) return true;
      if (e.isDirectory()) stack.push(path.join(e.parentPath ?? e.path, e.name));
    }
  }
  return false;
}
