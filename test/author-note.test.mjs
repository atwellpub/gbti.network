// sow-219 Phase 2: the from-the-author note renders in the WorkBench preview, not only on the published page.
// The preview runs on the CLIENT and cannot execute an Astro component, so the block's STRUCTURE is shared
// through src/lib/author-note.mjs and the published component is held to it by the drift test below. This is
// the same shape as test/article-page.test.mjs and the markdown-renderer equivalence test: the contract is
// only worth having if something fails when the component moves away from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUTHOR_NOTE_BLOCK, introPathFor, buildAuthorNoteHtml } from '../src/lib/author-note.mjs';

const COMMENTS = fs.readFileSync(fileURLToPath(new URL('../src/components/blog/Comments.astro', import.meta.url)), 'utf8');
// The pinned block is the `{intro && (...)}` branch; scope the assertions to it so an unrelated class
// elsewhere in the file cannot make a stale contract entry look present.
const PINNED = COMMENTS.slice(COMMENTS.indexOf('{intro && ('), COMMENTS.indexOf('<h2 class="h3"'));

test('DRIFT: every class and style in the shared contract still appears in the published pinned block', () => {
  assert.ok(PINNED.length > 200, 'the pinned intro branch was not found in Comments.astro; the slice anchors moved');
  for (const [key, value] of Object.entries(AUTHOR_NOTE_BLOCK)) {
    if (key === 'avatarSize') { assert.match(PINNED, /size=\{44\}/, 'the avatar size drifted from the contract'); continue; }
    assert.ok(PINNED.includes(String(value)), `contract entry ${key} ("${value}") is no longer in Comments.astro`);
  }
});

test('DRIFT: the published block still selects a PUBLIC authorNote comment, which the preview mirrors', () => {
  // The preview re-implements this filter client-side. If the published rule changes (say it starts pinning a
  // members-visibility note), the preview would silently show something the page does not.
  assert.match(COMMENTS, /c\.data\.visibility === 'public' && c\.data\.authorNote/);
});

test('introPathFor: derives the sibling comment path from the item path', () => {
  assert.equal(introPathFor('members/gbtilabs/posts/my-article/index.md', 'my-article'), 'members/gbtilabs/comments/intro-my-article.md');
  assert.equal(introPathFor('members/alice/products/thing/index.md', 'thing'), 'members/alice/comments/intro-thing.md');
  assert.equal(introPathFor('house/posts/legacy/index.md', 'legacy'), 'house/comments/intro-legacy.md');
});

test('introPathFor: null for a path that is not member or house content, or a missing slug', () => {
  assert.equal(introPathFor('src/pages/index.astro', 'x'), null);
  assert.equal(introPathFor('members/alice/posts/a/index.md', ''), null);
  assert.equal(introPathFor('', 'a'), null);
  assert.equal(introPathFor(undefined, 'a'), null);
});

test('buildAuthorNoteHtml: renders the pinned structure, escaping the name and href', () => {
  const html = buildAuthorNoteHtml({ name: 'GBTI Network', href: '/members/gbtilabs/', avatarUrl: 'https://x/a.png', bodyHtml: '<p>Why I wrote this.</p>' });
  assert.match(html, /class="card" style="padding:24px;border-color:var\(--green\);background:var\(--green-tint\)"/);
  assert.match(html, /From the author/);
  assert.match(html, /GBTI Network/);
  assert.match(html, /<p>Why I wrote this\.<\/p>/); // the rendered body is injected, not escaped
  assert.match(html, /src="https:\/\/x\/a\.png"/);
});

test('buildAuthorNoteHtml: a hostile display name cannot inject markup, and a missing avatar falls back', () => {
  const html = buildAuthorNoteHtml({ name: '<img src=x onerror=alert(1)>', href: 'javascript:alert(1)"', bodyHtml: '' });
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /href="javascript:alert\(1\)"[^>]*>/); // the quote is escaped, so no attribute break-out
  assert.match(html, /<span class="rounded-full"/); // letter disc when no avatar resolved
});
