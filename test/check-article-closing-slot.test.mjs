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

test('no dist/articles: reports a note, no errors', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const { errors, checked, notes } = checkArticleClosingSlot({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 0);
  assert.ok(notes.some((n) => n.includes('dist/articles not found')));
  fs.rmSync(root, { recursive: true, force: true });
});
