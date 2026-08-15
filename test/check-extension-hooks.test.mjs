// The working-tree pair guard (scripts/check-extension-hooks.mjs): a `data-*` hook in a page's static markup
// must have a counterpart in that page's built bundle.
//
// The load-bearing case is `admin-panels`. On 2026-08-13 the extension admin page rendered EMPTY because
// admin.html carried sow-228's `<template data-admin-panels>` while dist/admin.js predated the commit that
// clones it. Nothing errored; the panels simply never mounted. These fixtures encode that incident so the
// guard cannot regress into passing it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPair, hooksInMarkup, stripNonMarkup } from '../scripts/check-extension-hooks.mjs';

test('a consistent pair passes: every markup hook is wired by the bundle', () => {
  const html = '<div data-shell><button data-tab="members"></button><section data-panel></section></div>';
  const bundle = 'q("[data-shell]");q("[data-tab]");q("[data-panel]");';
  const { hooks, orphaned } = checkPair({ html, bundle });
  assert.deepEqual(hooks, ['panel', 'shell', 'tab']);
  assert.deepEqual(orphaned, []);
});

// THE REGRESSION. This is the exact shape that produced the dead admin page.
test('the real incident: markup declaring data-admin-panels against a bundle lacking it is FLAGGED', () => {
  const html = `<main data-shell>
    <p data-admin-deny hidden>You do not have a staff role.</p>
    <template data-admin-panels><section data-panel="members"></section></template>
  </main>`;
  const staleBundle = 'q("[data-shell]");q("[data-panel]");'; // pre-sow-228: knows nothing of the template
  const { orphaned } = checkPair({ html, bundle: staleBundle });
  assert.deepEqual(orphaned, ['admin-deny', 'admin-panels'],
    'a stale bundle must be caught by the hooks it does not wire');

  // ...and the SAME markup against the fixed bundle passes, so the guard tracks the fix rather than the file.
  const fixedBundle = 'q("template[data-admin-panels]");q("[data-admin-deny]");q("[data-shell]");q("[data-panel]");';
  assert.deepEqual(checkPair({ html, bundle: fixedBundle }).orphaned, []);
});

test('hooks inside comments, <style> or <script> are not markup and are ignored', () => {
  // account.html really does contain the phrase "data-attribute" inside a CSS comment; a naive scan flagged it.
  const html = `<style>/* the data-attribute wiring lives in account.mjs */ [data-cssonly]{color:red}</style>
    <!-- data-commented is documentation, not a hook -->
    <script>var s = "data-inline";</script>
    <div data-real></div>`;
  const { hooks, orphaned } = checkPair({ html, bundle: 'q("[data-real]")' });
  assert.deepEqual(hooks, ['real'], 'only genuine markup attributes count as hooks');
  assert.deepEqual(orphaned, []);
});

test('a data-* used only for styling is not an orphan', () => {
  // A CSS-only hook has no wiring by design, so it must not be reported as dead markup.
  const html = '<style>[data-variant="glass"]{opacity:.8}</style><div data-variant="glass" data-wired></div>';
  const { orphaned } = checkPair({ html, bundle: 'q("[data-wired]")' });
  assert.deepEqual(orphaned, [], 'data-variant is styling; only data-wired needs a counterpart');
});

test('the check is one-directional: a bundle may name hooks the static markup does not carry', () => {
  // JS creates elements dynamically (data-tk in the channel-map manager is generated at render), so extra
  // hooks in the bundle are normal and must never fail the guard.
  const { orphaned } = checkPair({ html: '<div data-shell></div>', bundle: 'q("[data-shell]");el.dataset.tk=k;"data-generated"' });
  assert.deepEqual(orphaned, []);
});

test('hook extraction handles the real attribute spellings', () => {
  assert.deepEqual(hooksInMarkup('<i data-a="1">'), ['a'], 'valued attribute');
  assert.deepEqual(hooksInMarkup('<i data-b >'), ['b'], 'bare attribute followed by space');
  assert.deepEqual(hooksInMarkup('<i data-c>'), ['c'], 'bare attribute closing the tag');
  assert.deepEqual(hooksInMarkup('<i data-multi-part-name="x">'), ['multi-part-name'], 'dashed name');
  // TWO DIFFERENT adjacent names. The previous fixture used the SAME name twice, so the Set dedup made the
  // assertion pass whether or not the second attribute was ever extracted: it could not fail, and it hid a
  // real extraction bug through seven reviewers and a live guard run. Keep these names distinct.
  assert.deepEqual(hooksInMarkup('<i data-a data-b>'), ['a', 'b'], 'ADJACENT attributes: the terminator must not be consumed');
  assert.deepEqual(hooksInMarkup('<div data-shell data-active="x">'), ['active', 'shell'], 'the real markup shape on account/newtab/workspace');
  assert.deepEqual(hooksInMarkup('<i data-a data-a="dup">'), ['a'], 'deduplicated');
});

test('stripNonMarkup removes the three block kinds and leaves markup intact', () => {
  const out = stripNonMarkup('<a data-keep><!--x--><style>y</style><script>z</script>');
  assert.match(out, /data-keep/);
  for (const gone of ['<!--', '<style', '<script']) assert.ok(!out.includes(gone), `${gone} should be stripped`);
});
