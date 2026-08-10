// SOW-006 content operations: building + validating + scoping authored content.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveUsername,
  resolveTarget,
  contentPath,
  canAuthorPath,
  sanitizeInput,
  buildContentFile,
  parseContentFile,
  serializeContentFile,
  planAuthorshipMove,
  ContentValidationError,
} from '../client/src/content-ops.mjs';

test('resolveUsername: Map and plain-object indexes', () => {
  assert.equal(resolveUsername('2002207', new Map([['2002207', 'hudson']])), 'hudson');
  assert.equal(resolveUsername(2002207, { 2002207: 'hudson' }), 'hudson');
  assert.equal(resolveUsername('999', new Map()), null);
});

test('contentPath: per-type folder layout', () => {
  assert.equal(contentPath('post', 'alice', 'hello'), 'members/alice/posts/hello/index.md');
  assert.equal(contentPath('product', 'alice', 'thing'), 'members/alice/products/thing/index.md');
  assert.equal(contentPath('prompt', 'alice', 'p'), 'members/alice/prompts/p/index.md');
  assert.equal(contentPath('profile', 'alice'), 'members/alice/profile.md');
  assert.throws(() => contentPath('post', 'alice'), /requires a slug/);
});

// SOW-145: the house content target (superadmin-only surface, gated by the caller).
test('resolveTarget: member scope, and the network scope resolving to the gbtilabs member folder', () => {
  assert.deepEqual(resolveTarget({ scope: 'member', username: 'alice' }), {
    scope: 'member',
    folder: 'members/alice',
    author: 'alice',
  });
  // sow-195: the network's content is an ordinary member folder now, not the old non-member house/ with its
  // 'gbti' pseudo-author. The scope KEY stays 'house' because it is persisted in the WorkBench preference.
  assert.deepEqual(resolveTarget({ scope: 'house' }), { scope: 'house', folder: 'members/gbtilabs', author: 'gbtilabs' });
  // The actor's own username never leaks into the network target: a superadmin editing it stays gbtilabs.
  assert.deepEqual(resolveTarget({ scope: 'house', username: 'alice' }), { scope: 'house', folder: 'members/gbtilabs', author: 'gbtilabs' });
  // Default scope is member; a member scope without a username is a programming error.
  assert.deepEqual(resolveTarget({ username: 'bob' }), { scope: 'member', folder: 'members/bob', author: 'bob' });
  assert.throws(() => resolveTarget({ scope: 'member' }), /username is required/);
});

test('contentPath: the network scope emits members/gbtilabs/<sub>/<slug>/index.md', () => {
  assert.equal(contentPath('post', 'gbtilabs', 'welcome', 'house'), 'members/gbtilabs/posts/welcome/index.md');
  assert.equal(contentPath('product', 'gbtilabs', 'hue', 'house'), 'members/gbtilabs/products/hue/index.md');
  assert.equal(contentPath('prompt', 'gbtilabs', 'seo', 'house'), 'members/gbtilabs/prompts/seo/index.md');
  // The actor's username never leaks into a house path.
  assert.equal(contentPath('post', undefined, 'welcome', 'house'), 'members/gbtilabs/posts/welcome/index.md');
  // Profiles are member-only regardless of scope.
  assert.equal(contentPath('profile', 'gbtilabs', null, 'house'), 'members/gbtilabs/profile.md');
});

test('canAuthorPath: own folder only, no traversal', () => {
  assert.equal(canAuthorPath('members/alice/posts/x/index.md', 'alice'), true);
  assert.equal(canAuthorPath('members/bob/posts/x/index.md', 'alice'), false);
  assert.equal(canAuthorPath('members/alice/../bob/posts/x.md', 'alice'), false);
  assert.equal(canAuthorPath('/etc/passwd', 'alice'), false);
  assert.equal(canAuthorPath('house/roles.yml', 'alice'), false);
});

// SOW-145: allowHouse (a superadmin) may additionally author under house/; a member still may not, and
// traversal is rejected even with allowHouse (the server gate is the real enforcement, this is UX scoping).
test('canAuthorPath: allowHouse permits house/ only for a superadmin', () => {
  assert.equal(canAuthorPath('house/posts/x/index.md', 'gbtilabs', { allowHouse: true }), true);
  assert.equal(canAuthorPath('house/products/hue/index.md', 'gbtilabs', { allowHouse: true }), true);
  // Without allowHouse a house/ path is rejected (a plain member).
  assert.equal(canAuthorPath('house/posts/x/index.md', 'alice'), false);
  assert.equal(canAuthorPath('house/posts/x/index.md', 'alice', { allowHouse: false }), false);
  // Traversal is rejected even with allowHouse.
  assert.equal(canAuthorPath('house/../members/bob/posts/x.md', 'gbtilabs', { allowHouse: true }), false);
  assert.equal(canAuthorPath('house\\posts\\x', 'gbtilabs', { allowHouse: true }), false);
  // A superadmin may still author their own member folder alongside house.
  assert.equal(canAuthorPath('members/gbtilabs/posts/x/index.md', 'gbtilabs', { allowHouse: true }), true);
});

test('sanitizeInput: forces author + strips system-managed fields', () => {
  const post = sanitizeInput('post', { author: 'evil', contributors: [{ login: 'x' }], title: 'T' }, 'alice');
  assert.equal(post.author, 'alice');
  assert.equal(post.contributors, undefined);
  const profile = sanitizeInput('profile', { username: 'evil', tier: 'paid', joinedAt: '2020-01-01' }, 'alice');
  assert.equal(profile.username, 'alice');
  assert.equal(profile.tier, undefined);
  assert.equal(profile.joinedAt, undefined);
});

test('buildContentFile: valid post is scoped, author-forced, system-stripped', () => {
  const out = buildContentFile({
    type: 'post',
    username: 'alice',
    input: { title: 'Hello World', slug: 'hello-world', author: 'someone-else', contributors: [{ login: 'x' }], status: 'published' },
    body: '# Hi\n\nBody text.',
  });
  assert.equal(out.path, 'members/alice/posts/hello-world/index.md');
  assert.equal(out.frontmatter.author, 'alice');
  assert.equal(out.frontmatter.contributors, undefined);
  assert.match(out.markdown, /^---\n/);
  assert.match(out.markdown, /title: Hello World/);
  assert.match(out.markdown, /Body text\./);
});

// SOW-145 + sow-195: a network publish writes members/gbtilabs/<sub>/<slug>/ and keeps author 'gbtilabs',
// never the editing superadmin. The point of the scope is that the ACTOR and the TARGET stay separate.
test('buildContentFile: the network scope writes members/gbtilabs/ with author gbtilabs', () => {
  const out = buildContentFile({
    type: 'post',
    username: 'gbtilabs',
    input: { title: 'House Post', slug: 'house-post', author: 'gbtilabs', status: 'published' },
    body: 'House body.',
    scope: 'house',
  });
  assert.equal(out.path, 'members/gbtilabs/posts/house-post/index.md');
  assert.equal(out.scope, 'house');
  assert.equal(out.frontmatter.author, 'gbtilabs'); // never the editing superadmin
  assert.equal(out.username, 'gbtilabs'); // the actor stays on the result (fork/commit context)
  assert.match(out.markdown, /author: gbti/);
});

test('sanitizeInput: an explicit author overrides the folder username (house content)', () => {
  const post = sanitizeInput('post', { title: 'T', author: 'gbtilabs' }, 'gbtilabs', { author: 'gbti' });
  assert.equal(post.author, 'gbti');
});

test('buildContentFile: invalid slug throws ContentValidationError', () => {
  assert.throws(
    () => buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'Bad Slug' } }),
    (e) => e instanceof ContentValidationError && /slug/.test(e.message),
  );
});

test('buildContentFile: a non-authorable type is rejected', () => {
  assert.throws(() => buildContentFile({ type: 'comment', username: 'alice', input: {} }), /not an authorable type/);
});

test('buildContentFile: product requires its mandatory fields', () => {
  const ok = buildContentFile({
    type: 'product',
    username: 'alice',
    input: { title: 'Tool', slug: 'tool', shortDescription: 'A tool', category: 'utilities', icon: 'icon.png', featuredImage: 'cover.png' },
  });
  assert.equal(ok.path, 'members/alice/products/tool/index.md');
  assert.throws(
    () => buildContentFile({ type: 'product', username: 'alice', input: { title: 'Tool', slug: 'tool' } }),
    ContentValidationError,
  );
});

test('parseContentFile: round-trips what buildContentFile produced', () => {
  const built = buildContentFile({
    type: 'prompt',
    username: 'alice',
    input: { title: 'P', slug: 'p', shortDescription: 'a one-liner', category: 'coding' },
    body: 'Prompt body',
  });
  const parsed = parseContentFile(built.markdown);
  assert.equal(parsed.frontmatter.title, 'P');
  assert.equal(parsed.frontmatter.author, 'alice');
  assert.equal(parsed.body.trim(), 'Prompt body'); // file ends with a trailing newline by convention
});

// SOW-183: planAuthorshipMove generalizes the SOW-112 slug-rename shape (delete-old + write-new + move the
// intro + re-derive the .enc) to an author-driven cross-folder move, keyed on the SAME slug throughout (the
// public URL never depends on author, only on contentPath's folder does).
test('planAuthorshipMove: member -> member, deletes the old path and writes the new one with author updated', () => {
  const oldFm = { type: 'post', title: 'T', slug: 'hello', author: 'alice', status: 'published' };
  const r = planAuthorshipMove({
    type: 'post', slug: 'hello',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'member', username: 'bob' },
    oldFrontmatter: oldFm, oldBody: 'Body text.',
  });
  assert.equal(r.path, 'members/bob/posts/hello/index.md');
  assert.equal(r.noop, undefined);
  assert.equal(r.frontmatter.author, 'bob');
  assert.deepEqual(r.files.map((f) => f.path), ['members/bob/posts/hello/index.md', 'members/alice/posts/hello/index.md']);
  const written = r.files.find((f) => f.path === 'members/bob/posts/hello/index.md');
  assert.match(written.content, /author: bob/);
  assert.match(written.content, /Body text\./);
  const deleted = r.files.find((f) => f.path === 'members/alice/posts/hello/index.md');
  assert.equal(deleted.content, null);
});

test('planAuthorshipMove: member -> network sets author to gbtilabs and writes under members/gbtilabs/', () => {
  const r = planAuthorshipMove({
    type: 'post', slug: 'hello',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'house' },
    oldFrontmatter: { type: 'post', title: 'T', slug: 'hello', author: 'alice' }, oldBody: 'x',
  });
  assert.equal(r.path, 'members/gbtilabs/posts/hello/index.md');
  assert.equal(r.frontmatter.author, 'gbtilabs');
  assert.deepEqual(r.files.map((f) => f.path), ['members/gbtilabs/posts/hello/index.md', 'members/alice/posts/hello/index.md']);
});

// The destination is a DIFFERENT member on purpose. Since sow-195 the network scope resolves to
// members/gbtilabs, so a move to 'gbtilabs' would be a move to the same folder and would assert nothing.
test('planAuthorshipMove: network -> member sets author to the new username and relocates the file', () => {
  const r = planAuthorshipMove({
    type: 'prompt', slug: 'seo',
    from: { scope: 'house' }, to: { scope: 'member', username: 'alice' },
    oldFrontmatter: { type: 'prompt', title: 'SEO', slug: 'seo', author: 'gbtilabs' }, oldBody: 'x',
  });
  assert.equal(r.path, 'members/alice/prompts/seo/index.md');
  assert.equal(r.frontmatter.author, 'alice');
  assert.deepEqual(r.files.map((f) => f.path), ['members/alice/prompts/seo/index.md', 'members/gbtilabs/prompts/seo/index.md']);
});

test('planAuthorshipMove: from and to resolve to the same path -> a noop, no files', () => {
  const r = planAuthorshipMove({
    type: 'post', slug: 'hello',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'member', username: 'alice' },
    oldFrontmatter: { author: 'alice' }, oldBody: 'x',
  });
  assert.equal(r.noop, true);
  assert.deepEqual(r.files, []);
  assert.equal(r.path, 'members/alice/posts/hello/index.md');
});

test('planAuthorshipMove: an encryptedBody item re-derives the .enc at the new target and moves both', () => {
  const oldFm = { type: 'product', title: 'T', slug: 'thing', author: 'alice', visibility: 'members', encryptedBody: 'members/alice/_enc/product-thing-body.enc' };
  const r = planAuthorshipMove({
    type: 'product', slug: 'thing',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'member', username: 'bob' },
    oldFrontmatter: oldFm, oldBody: '', oldEncText: '{"v":1,"ct":"opaque"}',
  });
  assert.equal(r.frontmatter.encryptedBody, 'members/bob/_enc/product-thing-body.enc');
  const encWrite = r.files.find((f) => f.path === 'members/bob/_enc/product-thing-body.enc');
  const encDelete = r.files.find((f) => f.path === 'members/alice/_enc/product-thing-body.enc');
  assert.equal(encWrite.content, '{"v":1,"ct":"opaque"}');
  assert.equal(encDelete.content, null);
  // the index.md write reflects the NEW encryptedBody pointer, not the old one
  const idxWrite = r.files.find((f) => f.path === 'members/bob/products/thing/index.md');
  assert.match(idxWrite.content, /encryptedBody: members\/bob\/_enc\/product-thing-body\.enc/);
});

test('planAuthorshipMove: an encryptedBody item with no oldEncText throws (fail closed, never drops a gated body)', () => {
  const oldFm = { type: 'post', slug: 'hello', author: 'alice', encryptedBody: 'members/alice/_enc/post-hello-body.enc' };
  assert.throws(
    () => planAuthorshipMove({ type: 'post', slug: 'hello', from: { scope: 'member', username: 'alice' }, to: { scope: 'house' }, oldFrontmatter: oldFm, oldBody: '' }),
    /oldEncText was not provided/,
  );
});

test('planAuthorshipMove: no encryptedBody -> no .enc files at all, just the index.md move', () => {
  const r = planAuthorshipMove({
    type: 'post', slug: 'hello',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'house' },
    oldFrontmatter: { type: 'post', slug: 'hello', author: 'alice' }, oldBody: 'x',
  });
  assert.equal(r.files.length, 2); // just the index.md write + delete
  assert.equal(r.files.some((f) => f.path.includes('_enc')), false);
});

test('planAuthorshipMove: a product/prompt intro comment moves + re-stamps author, slug/id untouched', () => {
  const introText = serializeContentFile({ id: 'intro-thing', targetType: 'product', targetSlug: 'thing', author: 'alice', authorNote: true, visibility: 'public' }, 'From the author.');
  const r = planAuthorshipMove({
    type: 'product', slug: 'thing',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'member', username: 'bob' },
    oldFrontmatter: { type: 'product', slug: 'thing', author: 'alice' }, oldBody: 'x',
    introText,
  });
  const introWrite = r.files.find((f) => f.path === 'members/bob/comments/intro-thing.md');
  const introDelete = r.files.find((f) => f.path === 'members/alice/comments/intro-thing.md');
  assert.ok(introWrite, 'the intro is written at the new author\'s folder');
  assert.ok(introDelete && introDelete.content === null, 'the old intro is deleted');
  const movedFm = parseContentFile(introWrite.content).frontmatter;
  assert.equal(movedFm.author, 'bob');
  assert.equal(movedFm.id, 'intro-thing', 'slug is unchanged by an authorship-only move, so the intro id is untouched');
  assert.equal(movedFm.targetSlug, 'thing');
});

// The SOW-014 intro comment travels with its item, so it must follow the same folders the item does.
test('planAuthorshipMove: the intro comment follows the item out of members/gbtilabs/comments/', () => {
  const introText = serializeContentFile({ id: 'intro-seo', targetType: 'prompt', targetSlug: 'seo', author: 'gbtilabs', authorNote: true, visibility: 'public' }, 'Why we built this.');
  const r = planAuthorshipMove({
    type: 'prompt', slug: 'seo',
    from: { scope: 'house' }, to: { scope: 'member', username: 'alice' },
    oldFrontmatter: { type: 'prompt', slug: 'seo', author: 'gbtilabs' }, oldBody: 'x',
    introText,
  });
  assert.ok(r.files.some((f) => f.path === 'members/gbtilabs/comments/intro-seo.md' && f.content === null));
  assert.ok(r.files.some((f) => f.path === 'members/alice/comments/intro-seo.md' && f.content));
});

test('planAuthorshipMove: a post has no intro-comment concept, introText is ignored even if provided', () => {
  const r = planAuthorshipMove({
    type: 'post', slug: 'hello',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'house' },
    oldFrontmatter: { type: 'post', slug: 'hello', author: 'alice' }, oldBody: 'x',
    introText: 'this should be ignored for posts',
  });
  assert.equal(r.files.some((f) => f.path.includes('/comments/intro-')), false);
});

test('planAuthorshipMove: no introText -> no intro files (the item never had one)', () => {
  const r = planAuthorshipMove({
    type: 'product', slug: 'thing',
    from: { scope: 'member', username: 'alice' }, to: { scope: 'house' },
    oldFrontmatter: { type: 'product', slug: 'thing', author: 'alice' }, oldBody: 'x',
  });
  assert.equal(r.files.some((f) => f.path.includes('/comments/intro-')), false);
});

test('planAuthorshipMove: an unknown/non-authorable type or a missing slug throws', () => {
  assert.throws(
    () => planAuthorshipMove({ type: 'comment', slug: 'x', from: { scope: 'member', username: 'a' }, to: { scope: 'house' }, oldFrontmatter: {}, oldBody: '' }),
    /not an authorable type/,
  );
  assert.throws(
    () => planAuthorshipMove({ type: 'post', slug: '', from: { scope: 'member', username: 'a' }, to: { scope: 'house' }, oldFrontmatter: {}, oldBody: '' }),
    /slug is required/,
  );
});
