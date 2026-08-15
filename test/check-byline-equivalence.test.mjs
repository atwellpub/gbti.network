// sow-215 Check A. The guard exists because defect 1 (the raw username rendered as the byline on 29 pages)
// passed CI, the full unit suite and a 163-page build. So the thing that matters most about these tests is
// NOT that the guard passes on good input. It is that the guard GOES RED on the exact defect it was built
// for, with a message that names the page, the author, what was shown and what was expected.
//
// Every test here that asserts a pass is paired with one that asserts a failure on the same shape. A guard
// verified only against good input is the same class of non-evidence as the defects this SOW catalogues:
// the ritual completes and proves nothing about the question actually asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBylineEquivalence } from '../scripts/check-byline-equivalence.mjs';

const byline = (username, shown) =>
  `<a href="/members/${username}/" class="cm-name" data-astro-cid-pivxhkfe>${shown}</a>`;

// Build a throwaway root with members/<u>/profile.md and dist/<page>.
function fixture({ profiles = {}, pages = {} }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'byline-'));
  for (const [username, displayName] of Object.entries(profiles)) {
    const dir = path.join(root, 'members', username);
    fs.mkdirSync(dir, { recursive: true });
    const dn = displayName == null ? '' : `displayName: "${displayName}"\n`;
    fs.writeFileSync(path.join(dir, 'profile.md'), `---\ntype: profile\nusername: ${username}\n${dn}---\n\nbio\n`);
  }
  for (const [rel, html] of Object.entries(pages)) {
    const f = path.join(root, 'dist', rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, html);
  }
  if (!Object.keys(pages).length) fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  return root;
}

// THE test. This is defect 1 reproduced exactly: a profile defines a display name, the page renders the raw
// username instead. If this ever stops going red, the guard is decorative.
test('RED on defect 1: the raw username rendered where the profile defines a display name', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'articles/x/index.html': `<main>${byline('atwellpub', 'atwellpub')}</main>` },
  });
  const { errors, checked } = checkBylineEquivalence({ root });
  assert.equal(checked, 1);
  assert.equal(errors.length, 1);
  // The message must be actionable on its own, per the review constraint: page, author, shown, expected.
  assert.match(errors[0], /articles[/\\]x[/\\]index\.html/);
  assert.match(errors[0], /"atwellpub"/);
  assert.match(errors[0], /renders "atwellpub"/);
  assert.match(errors[0], /profile says "Hudson Atwell"/);
});

test('GREEN when the byline matches the profile display name', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'articles/x/index.html': `<main>${byline('atwellpub', 'Hudson Atwell')}</main>` },
  });
  const { errors, checked } = checkBylineEquivalence({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

// ZERO COVERAGE IS A FAILURE, and this is the deliberate divergence from check-article-closing-slot, whose
// advisory note on exactly this condition went unread for weeks while two layouts shipped uncovered.
test('RED when pages were built but no byline was found, rather than an advisory note', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'articles/x/index.html': '<main><p>an article with no byline markup at all</p></main>' },
  });
  const { errors, checked } = checkBylineEquivalence({ root });
  assert.equal(checked, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ZERO bylines/);
  assert.match(errors[0], /proved nothing/);
});

test('RED when dist is empty, since the guard cannot prove anything without a build', () => {
  const root = fixture({ profiles: { atwellpub: 'Hudson Atwell' }, pages: {} });
  const { errors } = checkBylineEquivalence({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /no built HTML/);
});

// The matcher's boundary behaviour, asserted rather than left as a comment. `\b` treats a hyphen as a word
// boundary, so a SUFFIXED rename still matches and an unrelated class does not. @UnifiedWorker's first
// attempt to prove the partial-rename hole picked cm-name-v2 and failed for exactly this reason, so the
// behaviour is checked here instead of only being described above the regex.
test('the class matcher tolerates a suffixed rename but not an unrelated class', () => {
  const still = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'x/index.html': '<main><a href="/members/atwellpub/" class="cm-name-v2">atwellpub</a></main>' },
  });
  const a = checkBylineEquivalence({ root: still });
  assert.equal(a.checked, 1, 'cm-name-v2 must still be matched, which is why it is a poor negative fixture');
  assert.equal(a.errors.length, 1, 'and the wrong name inside it must still bite');

  const gone = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'x/index.html': '<main><a href="/members/atwellpub/" class="byline-name">atwellpub</a></main>' },
  });
  const b = checkBylineEquivalence({ root: gone });
  assert.equal(b.checked, 0, 'an unrelated class is NOT matched');
  assert.match(b.errors[0], /ZERO bylines/, 'and that is caught only because zero coverage is red');
});

// The class the guard keys on is the one thing that silently disables it, so pin the coupling.
test('RED if the byline class changes, because the guard would otherwise silently stop checking', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'articles/x/index.html': '<main><a href="/members/atwellpub/" class="cm-NAME-renamed">atwellpub</a></main>' },
  });
  const { errors, checked } = checkBylineEquivalence({ root });
  assert.equal(checked, 0, 'the renamed class is not matched, which is exactly why zero coverage must be red');
  assert.match(errors[0], /ZERO bylines/);
});

// DRIFT: the guard mirrors ContentMeta.astro and src/lib/authors.ts. If either changes shape, the mirror is
// wrong and the guard compares against a stale rule while still reporting green.
test('DRIFT: ContentMeta still renders the byline as class="cm-name" linking to /members/<user>/', () => {
  const s = fs.readFileSync(new URL('../src/components/ContentMeta.astro', import.meta.url), 'utf8');
  assert.match(s, /class="cm-name"/, 'the guard keys on this class; if it moved, update both');
  assert.match(s, /displayName \?\? authorDisplay\(author\)/, 'the expected-name rule the guard mirrors');
});

test('DRIFT: authors.ts still maps the two network pseudo-authors to the brand name', () => {
  const s = fs.readFileSync(new URL('../src/lib/authors.ts', import.meta.url), 'utf8');
  assert.match(s, /NETWORK_AUTHORS = new Set\(\['gbti', 'gbtilabs'\]\)/);
  assert.match(s, /'GBTI Network'/);
});

test('gbtilabs renders as the brand, not the username, even with no displayName on the profile', () => {
  const root = fixture({
    profiles: { gbtilabs: null },
    pages: {
      'ok/index.html': `<main>${byline('gbtilabs', 'GBTI Network')}</main>`,
      'bad/index.html': `<main>${byline('gbtilabs', 'gbtilabs')}</main>`,
    },
  });
  const { errors } = checkBylineEquivalence({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /bad/);
  assert.match(errors[0], /profile says "GBTI Network"/);
});

test('an author with no profile on disk is skipped rather than guessed at', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: { 'x/index.html': `<main>${byline('someone-else', 'Whoever')}</main>` },
  });
  const { errors, checked } = checkBylineEquivalence({ root });
  assert.equal(checked, 0);
  assert.match(errors[0], /ZERO bylines/, 'skipped, but the run still reports that it proved nothing');
});

test('HTML entities in a display name are decoded before comparison', () => {
  const root = fixture({
    profiles: { oneil: "Shán O'Neil" },
    pages: { 'x/index.html': `<main>${byline('oneil', 'Shán O&#39;Neil')}</main>` },
  });
  const { errors } = checkBylineEquivalence({ root });
  assert.deepEqual(errors, [], 'an apostrophe entity must not read as a mismatch');
});

test('every offending page is reported, not just the first', () => {
  const root = fixture({
    profiles: { atwellpub: 'Hudson Atwell' },
    pages: {
      'a/index.html': `<main>${byline('atwellpub', 'atwellpub')}</main>`,
      'b/index.html': `<main>${byline('atwellpub', 'atwellpub')}</main>`,
      'c/index.html': `<main>${byline('atwellpub', 'Hudson Atwell')}</main>`,
    },
  });
  const { errors, checked, pages } = checkBylineEquivalence({ root });
  assert.equal(checked, 3);
  assert.equal(pages, 3);
  assert.equal(errors.length, 2, 'defect 1 hit 29 pages at once; a guard that stops at the first is half a guard');
});
