// Working-tree pair guard for the Chrome extension: every `data-*` hook in a page's static markup must have
// a counterpart in that page's BUILT bundle. Catches the class of failure the other guards structurally
// cannot see.
//
// WHY THIS EXISTS (2026-08-13). The admin page rendered EMPTY for the owner. sow-228 had moved the eight
// admin panels into an inert `<template data-admin-panels>` that admin.js clones once the role resolves, but
// this clone's `extension/dist/admin.js` predated that commit, so nothing ever cloned the template. Header
// rendered, rail rendered, body empty, and NO error, because revealAdminPanels() returns silently when the
// template is missing. `check-extension.mjs` and the extension-check CI job both compare the COMMITTED ZIP
// against manifest.json; neither compares the working tree's html against the working tree's js. Every agent
// on this project loads the UNPACKED folder, so a pair nothing validates is what several of us actually run.
//
// THE RULE, and it is deliberately ONE-DIRECTIONAL. Static markup carrying a hook the bundle never mentions
// is dead markup, and a stale bundle is exactly what that looks like. The reverse (a bundle naming a hook no
// static markup carries) is NORMAL, because JS creates elements dynamically, so it is not checked.
//
// Three extraction rules, all principled rather than allowlists:
//   - Comment, <style> and <script> blocks are stripped before hooks are collected. A naive scan's only false
//     positive across 79 hooks was the literal phrase "data-attribute" inside a CSS comment in account.html.
//   - A hook the page's OWN CSS targets is exempt, because it has a legitimate non-JS consumer. Stripping
//     <style> is NOT sufficient for this on its own: a styling hook must also appear as a real attribute in
//     the markup for CSS to select it, so it is collected as a hook and would be reported as dead without an
//     explicit exemption. (Caught by test 4 while building this; the first draft had exactly that bug.)
//   - The comparison against the bundle is a plain substring test on `data-<name>`, which is what survives
//     esbuild: attribute selectors, dataset access and string literals all keep the dashed form.
//
// Node built-ins only, read-only, fail closed. Run: node scripts/check-extension-hooks.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Markup with comment/style/script blocks removed, so only real attributes are scanned. */
export function stripNonMarkup(html) {
  return String(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');
}

/** The distinct `data-*` attribute names a page's static markup declares. */
export function hooksInMarkup(html) {
  const seen = new Set();
  for (const m of stripNonMarkup(html).matchAll(/\sdata-([a-z0-9-]+)[=\s>]/g)) seen.add(m[1]);
  return [...seen].sort();
}

/** The `data-*` names the page's own <style> blocks target. These are styling hooks with a real non-JS
 *  consumer, so they are exempt from needing a counterpart in the bundle. */
export function hooksStyledInPage(html) {
  const seen = new Set();
  for (const block of String(html).matchAll(/<style[\s\S]*?<\/style>/gi)) {
    const css = block[0].replace(/\/\*[\s\S]*?\*\//g, ''); // drop CSS comments: prose there is not a selector
    for (const m of css.matchAll(/\[data-([a-z0-9-]+)/g)) seen.add(m[1]);
  }
  return seen;
}

/**
 * Compare one page's markup against its bundle.
 * PURE: takes the two sources as strings so it is testable without a filesystem.
 * @returns {{ hooks: string[], styled: string[], orphaned: string[] }}
 */
export function checkPair({ html, bundle }) {
  const hooks = hooksInMarkup(html);
  const styled = hooksStyledInPage(html);
  const js = String(bundle);
  return {
    hooks,
    styled: [...styled].sort(),
    orphaned: hooks.filter((k) => !js.includes(`data-${k}`) && !styled.has(k)),
  };
}

/**
 * Walk every extension page that has a same-named bundle.
 * A page with no matching bundle is SKIPPED and reported, never failed: a page may legitimately be served by
 * a shared bundle, and failing on that would make the guard lie about a working tree.
 */
export function checkExtensionHooks({ root, extDir = 'extension', distDir = 'extension/dist' } = {}) {
  const errors = [];
  const notes = [];
  let pages = 0;
  let checked = 0;
  const pagesDir = path.join(root, extDir);
  if (!fs.existsSync(pagesDir)) return { errors: [`extension directory not found: ${extDir}`], notes, pages, checked };

  for (const file of fs.readdirSync(pagesDir).filter((f) => f.endsWith('.html')).sort()) {
    const bundlePath = path.join(root, distDir, `${file.replace(/\.html$/, '')}.js`);
    if (!fs.existsSync(bundlePath)) { notes.push(`${file}: no same-named bundle, skipped`); continue; }
    pages += 1;
    const { hooks, orphaned } = checkPair({
      html: fs.readFileSync(path.join(pagesDir, file), 'utf8'),
      bundle: fs.readFileSync(bundlePath, 'utf8'),
    });
    checked += hooks.length;
    if (orphaned.length) {
      errors.push(
        `${file} declares ${orphaned.length} hook${orphaned.length === 1 ? '' : 's'} its bundle never wires: ` +
        `${orphaned.map((h) => `data-${h}`).join(', ')}. ` +
        `${path.relative(root, bundlePath)} is STALE against the markup: rebuild with ` +
        `\`node client-ui/build.mjs && npm run build:extension\`, or restore the artifact from origin if ` +
        `another session holds uncommitted source here.`,
      );
    }
  }
  return { errors, notes, pages, checked };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, notes, pages, checked } = checkExtensionHooks({ root: ROOT });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ extension hook-pair guard failed (${errors.length} page${errors.length === 1 ? '' : 's'} with dead markup):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ extension hook-pair guard passed (${checked} hooks across ${pages} page${pages === 1 ? '' : 's'} all wired)`);
}
