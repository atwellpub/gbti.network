// sow-183 QA follow-up: the article closing-slot guard. Exercises the scanner against a temp dist: a page
// carrying every marker (passes), a page missing the closing slot entirely -- the exact shape the ternary/
// non-literal-slot bug produced (fails, one error per missing marker), and the layout-coverage note.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkArticleClosingSlot } from '../scripts/check-article-closing-slot.mjs';

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-closing-slot-'));
  return root;
}
function writeArticle(root, slug, html) {
  const dir = path.join(root, 'dist', 'articles', slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), html);
}

const FULL_CLOSING_SLOT = `
  <div class="art-j-rail">rail stuff</div>
  <section class="dark community-invite" style="max-width:820px">Join the GBTI Network</section>
  <div class="author-box mx-auto">Written by</div>
  <section id="comments">0 Comments</section>
`;

test('passes when every closing-slot marker is present', () => {
  const root = tmpRoot();
  writeArticle(root, 'a-real-post', `<html><body>${FULL_CLOSING_SLOT}</body></html>`);
  const { errors, checked, notes } = checkArticleClosingSlot({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
  assert.ok(notes.some((n) => n.includes('editorial/card got zero live coverage') || n.includes('card got zero live coverage') || n.includes('editorial') ));
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails when the closing slot rendered empty (the ternary/non-literal-slot bug shape)', () => {
  const root = tmpRoot();
  // Only the global style rule referencing .community-invite is present (the false-positive signal that
  // misled an earlier debugging pass) -- no actual element markers anywhere in the page.
  writeArticle(root, 'broken-post', `<html><head><style>html.is-gbti-member-active .community-invite{display:none}</style></head><body><div class="art-e-hero"></div></body></html>`);
  const { errors, checked } = checkArticleClosingSlot({ root });
  assert.equal(checked, 1);
  assert.equal(errors.length, 3); // CommunityInvite, AuthorBox, Comments all missing
  assert.match(errors[0], /broken-post/);
  assert.match(errors.join('\n'), /CommunityInvite/);
  assert.match(errors.join('\n'), /AuthorBox/);
  assert.match(errors.join('\n'), /Comments section/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('reports which layouts got zero coverage this run', () => {
  const root = tmpRoot();
  writeArticle(root, 'journal-post', `<html><body>${FULL_CLOSING_SLOT}</body></html>`);
  const { notes } = checkArticleClosingSlot({ root });
  const joined = notes.join(' ');
  assert.match(joined, /editorial/);
  assert.match(joined, /card/);
  assert.doesNotMatch(joined, /journal got zero/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('checks multiple pages independently, one error set per broken page', () => {
  const root = tmpRoot();
  writeArticle(root, 'good-post', `<html><body>${FULL_CLOSING_SLOT}</body></html>`);
  writeArticle(root, 'bad-post', '<html><body><p>nothing here</p></body></html>');
  const { errors, checked } = checkArticleClosingSlot({ root });
  assert.equal(checked, 2);
  assert.equal(errors.length, 3);
  assert.ok(errors.every((e) => e.includes('bad-post')));
  fs.rmSync(root, { recursive: true, force: true });
});

// THESE THREE REPLACE A TEST THAT ASSERTED THE DEFECT. It read "no dist/articles: reports a note, no
// errors" and it passed, which is why the hole survived: the guard exited 0 having inspected nothing, as the
// last-but-one step of verify:dist in the Pages deploy, and a test certified that as correct. Zero coverage
// is now a FAILURE in each of its three shapes, and they are separate cases because the causes differ.

test('ZERO COVERAGE: an unbuilt dist FAILS rather than passing with nothing checked', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const { errors, checked } = checkArticleClosingSlot({ root });
  assert.equal(checked, 0);
  assert.ok(errors.length > 0, 'a run that inspected nothing must not report success');
  assert.match(errors.join(' '), /no built HTML/i);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ZERO COVERAGE: a built dist with no articles SECTION fails, and says which', () => {
  // Distinct from the above: the site built, so "run the build" would be the wrong advice. This means the
  // articles route stopped emitting, which is a real regression rather than an operator error.
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html><body>home</body></html>');
  const { errors, checked } = checkArticleClosingSlot({ root });
  assert.equal(checked, 0);
  assert.match(errors.join(' '), /NO dist\/articles section/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('ZERO COVERAGE: an articles section with no built pages fails', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist', 'articles'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), '<html><body>home</body></html>');
  const { errors, checked } = checkArticleClosingSlot({ root });
  assert.equal(checked, 0);
  assert.match(errors.join(' '), /ZERO built article pages/);
  fs.rmSync(root, { recursive: true, force: true });
});

// sow-219 (2026-08-11): an article may carry a from-the-author note, and ContentFooter's skipAuthorBox then
// DROPS the "Written by" box, because the pinned note already carries the byline. This guard demanded the
// AuthorBox unconditionally, so the very first article published with a note failed the deploy build. The
// markup below is copied from a real built product page that has a note, not invented.
const NOTE_INSTEAD_OF_AUTHORBOX = `
  <div class="art-j-rail">rail stuff</div>
  <section class="dark community-invite" style="max-width:820px">Join the GBTI Network</section>
  <section id="comments">
    <article class="card"><div><p class="eyebrow" style="color:var(--green-700)">From the author</p>
    <a href="/members/gbtilabs/" class="link">GBTI Network</a></div></article>
  </section>
`;

test('an article whose AuthorBox is replaced by a pinned author note still passes', () => {
  const root = tmpRoot();
  writeArticle(root, 'post-with-a-note', `<html><body>${NOTE_INSTEAD_OF_AUTHORBOX}</body></html>`);
  const { errors } = checkArticleClosingSlot({ root });
  assert.deepEqual(errors, [], 'a note is a valid substitute for the Written by box, not a missing element');
});

test('a page with NEITHER the AuthorBox nor a note still fails (the invariant is attribution, not laxity)', () => {
  const root = tmpRoot();
  writeArticle(root, 'post-with-no-attribution', '<html><body>'
    + '<div class="art-j-rail">rail</div>'
    + '<section class="dark community-invite">Join</section>'
    + '<section id="comments">0 Comments</section>'
    + '</body></html>');
  const { errors } = checkArticleClosingSlot({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /author attribution/);
});
