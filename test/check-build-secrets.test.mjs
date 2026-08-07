// SOW-015: the build-secrets guard. Exercises both leak paths against a temp repo root: a leaked secret value
// in dist, a plaintext committed beside (or AS) a .enc, and a clean tree that passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-guard-'));
  fs.mkdirSync(path.join(root, 'house/_enc'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist/_astro'), { recursive: true });
  return root;
}
const validEnvelope = JSON.stringify({ v: 1, kid: '1', iv: 'AAAAAAAAAAAAAAAA', aad: 'a', ct: 'AAAA' });

test('a clean tree passes (valid .enc, no plaintext, no leak)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/ok.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on a leaked secret value in dist (any non-binary file)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/ok.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'dist/sitemap.xml'), '<url>SECRETKEYVALUE123456</url>');
  const { errors } = checkBuildSecrets({ root, env: { SCAN_SECRETS: 'SECRETKEYVALUE123456' } });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /leaked SCAN_SECRETS value/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails on plaintext committed beside a .enc', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/x.enc'), validEnvelope);
  fs.writeFileSync(path.join(root, 'house/_enc/x'), 'the raw plaintext');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /plaintext committed beside ciphertext/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('fails when a .enc is actually plaintext / a malformed envelope', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'house/_enc/fake.enc'), 'this is not encrypted at all');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /not valid JSON|not a valid v1 encrypted envelope/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: the members-only marker leaking into dist fails the build', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'dist/blog/leaky'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/leaky/index.html'), '<article>teaser <!-- members-only --> gated tail</article>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /members-only marker leaked/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-158 Phase 3a: the members-only marker in an app bundle (.js) is CODE, not a content leak', () => {
  const root = tmpRoot();
  // The client-ui authoring bundle (now part of the site build) references the marker as a string literal in
  // the editor cheatsheet + the WorkBench adapter's split detection. That is code, never rendered content.
  fs.writeFileSync(path.join(root, 'dist/_astro/gbti-workspace.abc123.js'), 'const MEM_MARKER="<!-- members-only -->";export{MEM_MARKER};');
  fs.writeFileSync(path.join(root, 'dist/_astro/style.def456.css'), '/* teach the marker: <!-- members-only --> */');
  const clean = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(clean.errors, [], 'a .js/.css bundle referencing the marker must not trip the content scan: ' + clean.errors.join('; '));
  // But a RENDERED page still leaking the marker fails (the guard keeps its power over content output).
  fs.mkdirSync(path.join(root, 'dist/blog/leaky2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/leaky2/index.html'), '<article>teaser <!-- members-only --> gated tail</article>');
  const leaked = checkBuildSecrets({ root, env: {} });
  assert.ok(leaked.errors.some((e) => /members-only marker leaked/.test(e)), leaked.errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode A item with a public page in dist fails the build', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/secret/index.md'), '---\ntype: post\nslug: secret\nvisibility: members\npublicStub: false\n---\n');
  fs.mkdirSync(path.join(root, 'dist/blog/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/secret/index.html'), '<html>oops a Mode A page got built</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /Mode A item .* has a public page in dist/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode A item with NO dist page passes (the normal case)', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/secret'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/secret/index.md'), '---\ntype: post\nslug: secret\nvisibility: members\npublicStub: false\n---\n');
  // no dist/blog/secret/ page
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-018: the extension-only tripwire must catch a Share leaking onto a public surface.
test('sow-094: a PUBLIC share page in dist/shares/ passes; a MEMBERS share page fails', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'members/alice/shares'), { recursive: true });
  fs.writeFileSync(path.join(root, 'members/alice/shares/pub-1.md'), '---\nstatus: published\nvisibility: public\nid: pub-1\nauthor: alice\n---\n');
  fs.writeFileSync(path.join(root, 'members/alice/shares/priv-1.md'), '---\nstatus: published\nvisibility: members\nid: priv-1\nauthor: alice\n---\n');
  fs.mkdirSync(path.join(root, 'dist/shares/alice/pub-1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/shares/alice/pub-1/index.html'), '<html>the public share page</html>');
  const ok = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(ok.errors, [], 'a public-share page is allowed: ' + ok.errors.join('; '));
  // now a page for the MEMBERS share appears -> fail
  fs.mkdirSync(path.join(root, 'dist/shares/alice/priv-1'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/shares/alice/priv-1/index.html'), '<html>leak</html>');
  const bad = checkBuildSecrets({ root, env: {} });
  assert.ok(bad.errors.some((e) => /NON-public share has a page in dist/.test(e)), bad.errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-018: a Share in the public activity-index.json fails the build', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/activity-index.json'), JSON.stringify({ entries: [{ type: 'post', slug: 'a' }, { type: 'share', slug: 'x' }] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /Share appears in the public activity-index/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-018: a normal activity-index (no share) and no /shares/ passes the tripwire', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/activity-index.json'), JSON.stringify({ entries: [{ type: 'post', slug: 'a' }, { type: 'prompt', slug: 'b' }] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a Mode B item authored `publicStub: True` (capital) is NOT misclassified as Mode A', () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, 'house/posts/stub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'house/posts/stub/index.md'), '---\ntype: post\nslug: stub\nvisibility: members\npublicStub: True\n---\n');
  fs.mkdirSync(path.join(root, 'dist/blog/stub'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/blog/stub/index.html'), '<html>a legit Mode B stub page</html>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, [], 'publicStub: True is a stub (Mode B), so its page is allowed');
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-016: a key value written into a .enc file in dist is still caught', () => {
  const root = tmpRoot();
  const key = 'KEYMATERIAL_IN_ENC_1234567890';
  fs.writeFileSync(path.join(root, 'dist/leak.enc'), JSON.stringify({ note: key }));
  const { errors } = checkBuildSecrets({ root, env: { SCAN_SECRETS: key } });
  assert.ok(errors.some((e) => /leaked SCAN_SECRETS value/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-044: comments are members-only + encrypted; the only public comment is a from-the-author intro.
const writeComment = (root, rel, fm) => {
  fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
  const body = fm.__body ?? '';
  const front = Object.entries(fm).filter(([k]) => k !== '__body').map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(path.join(root, rel), `---\n${front}\n---\n${body}\n`);
};

test('SOW-044: a public discussion comment (no authorNote) fails the build', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c1.md', { type: 'comment', visibility: 'public', targetType: 'post', __body: 'a public reply' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /a public comment is only allowed as a from-the-author intro/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a public comment on a SHARE fails the build even with authorNote', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c2.md', { type: 'comment', visibility: 'public', authorNote: true, targetType: 'share', __body: 'reply' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /a public comment is only allowed as a from-the-author intro/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a from-the-author intro (authorNote on a product) is allowed public', () => {
  const root = tmpRoot();
  writeComment(root, 'house/comments/intro-radle.md', { type: 'comment', visibility: 'public', authorNote: true, targetType: 'product', __body: 'why I built this' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a members comment committed with plaintext (no encryptedBody) fails the build', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c3.md', { type: 'comment', visibility: 'members', targetType: 'post', __body: 'secret reply text' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /committed plaintext \(no encryptedBody\)/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-044: a members comment with an empty stub + encryptedBody passes (the encrypted normal case)', () => {
  const root = tmpRoot();
  writeComment(root, 'members/alice/comments/c4.md', { type: 'comment', visibility: 'members', targetType: 'post', encryptedBody: 'members/alice/_enc/comment-c4-body.enc' });
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('a MEMBER_CONTENT_KEY value present in dist is caught', () => {
  const root = tmpRoot();
  const key = 'A'.repeat(43) + '=';
  fs.writeFileSync(path.join(root, 'dist/_astro/app.js'), `const k="${key}";`);
  const { errors } = checkBuildSecrets({ root, env: { MEMBER_CONTENT_KEY: key } });
  assert.ok(errors.some((e) => /leaked MEMBER_CONTENT_KEY value/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

// SOW-136 (the sow-131 election, scoping SOW-018): public Shares may render in the site feed, but a
// NON-public Share (members visibility or any draft) must leak nothing to dist. The scan matches the
// share's title / blurb / body text across every text file in the build output.
function writeShare(root, rel, lines) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, '---\n' + lines.join('\n') + '\n---\n');
}

test('SOW-136: a members-share title appearing in dist fails the build', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/x.md', ['status: published', 'visibility: members', 'title: A secret members-only headline', 'id: x', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>A secret members-only headline</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a DRAFT public share leaking into dist also fails (published + public only)', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/d.md', ['status: draft', 'visibility: public', 'title: An unpublished draft share headline', 'id: d', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>An unpublished draft share headline</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a published PUBLIC share rendered in dist passes (the scoped reversal)', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/p.md', ['status: published', 'visibility: public', 'title: A public share headline on the feed', 'id: p', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.writeFileSync(path.join(root, 'dist/index.html'), '<h2>A public share headline on the feed</h2>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, []);
  fs.rmSync(root, { recursive: true, force: true });
});

test('SOW-136: a members-share FOLDED blurb (>- style) leaking into dist is caught', () => {
  const root = tmpRoot();
  writeShare(root, 'members/alice/shares/f.md', ['status: published', 'visibility: members', 'shortDescription: >-', '  A folded members-only blurb that', '  spans two source lines.', 'id: f', 'author: alice', "createdAt: '2026-01-01T00:00:00Z'"]);
  fs.mkdirSync(path.join(root, 'dist/page'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/page/index.html'), '<p>A folded members-only blurb that spans two source lines.</p>');
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /NON-public Share leaked into build output/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

// sow-194: a `status: draft` content item is the unpublish state, so isListed excludes it from every public
// listing. This guard asserts none reaches a dist `*-index.json`, a fail-closed backstop against a regression
// that re-lists drafts. The draft set comes from buildRepoDraftsIndex (the same builder the Worker route reads).
function writeDraftItem(root, rel, fm) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const front = Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(p, `---\n${front}\n---\nbody\n`);
}

test('sow-194: a repo draft listed by its path in a public index fails the build', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/alice/posts/my-wip/index.md', { title: 'My Work In Progress Post', status: 'draft', visibility: 'public' });
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [
    { type: 'post', slug: 'my-wip', title: 'My Work In Progress Post', path: 'members/alice/posts/my-wip/index.md' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /draft \(status:draft\) item is listed in a public index/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: a repo draft listed by type+slug with NO path field still fails', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'house/prompts/secret-prompt/index.md', { title: 'A Secret Prompt Draft', status: 'draft' });
  fs.writeFileSync(path.join(root, 'dist/prompts-index.json'), JSON.stringify({ items: [
    { type: 'prompt', slug: 'secret-prompt' }, // the entry omits path; type+slug still identifies it
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /draft \(status:draft\) item is listed in a public index/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: a draft TITLE leaking into an index (entry reshaped, no path/slug match) is caught by the backstop', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/bob/posts/hidden/index.md', { title: 'An Unpublished Headline Only', status: 'draft' });
  // the entry carries a different slug and no path, but the draft title text is present in the JSON
  fs.writeFileSync(path.join(root, 'dist/activity-index.json'), JSON.stringify({ entries: [
    { type: 'post', slug: 'something-else', headline: 'An Unpublished Headline Only' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.ok(errors.some((e) => /draft title leaked into a public index/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: a structural draft leak reports once (the title backstop does not double-report)', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/alice/posts/my-wip/index.md', { title: 'My Work In Progress Post', status: 'draft', visibility: 'public' });
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [
    { type: 'post', slug: 'my-wip', title: 'My Work In Progress Post', path: 'members/alice/posts/my-wip/index.md' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  const draftErrors = errors.filter((e) => /sow-194/.test(e));
  assert.equal(draftErrors.length, 1, 'one draft leak yields one error, not a structural + title pair: ' + draftErrors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: published items in the index pass while a repo draft stays correctly excluded (normal case)', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/alice/posts/my-wip/index.md', { title: 'My Work In Progress Post', status: 'draft', visibility: 'public' });
  // the index lists ONLY a published item (the draft is correctly absent)
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [
    { type: 'post', slug: 'shipped', title: 'A Fully Shipped Article', path: 'members/alice/posts/shipped/index.md' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, [], 'a repo draft correctly absent from the index must not trip the guard: ' + errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: a draft slug that is a substring of a published slug does NOT false-positive (exact type+slug)', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/alice/posts/ai/index.md', { title: 'AI', status: 'draft' }); // short title (<12), slug 'ai'
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [
    { type: 'post', slug: 'ai-tools-roundup', title: 'A Roundup of AI Tools', path: 'members/bob/posts/ai-tools-roundup/index.md' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, [], 'an exact type+slug match must not fire on a substring: ' + errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: a published excerpt that merely MENTIONS a draft title (substring) does NOT false-positive', () => {
  const root = tmpRoot();
  writeDraftItem(root, 'members/alice/posts/wip/index.md', { title: 'An Unpublished Headline Only', status: 'draft' });
  // a legitimately published entry whose excerpt quotes the draft title inside a longer sentence
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [
    { type: 'post', slug: 'commentary', title: 'A Published Commentary', path: 'members/bob/posts/commentary/index.md',
      excerpt: 'I disagree with the take in "An Unpublished Headline Only" and here is why.' },
  ] }));
  const { errors } = checkBuildSecrets({ root, env: {} });
  assert.deepEqual(errors, [], 'exact-field-equality must not fire on a title mentioned inside a longer field: ' + errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});

test('sow-194: fail CLOSED if the draft index cannot be enumerated (the builder throws)', () => {
  const root = tmpRoot();
  fs.writeFileSync(path.join(root, 'dist/blog-index.json'), JSON.stringify({ items: [{ type: 'post', slug: 'x', path: 'p' }] }));
  const throwing = () => { throw new Error('boom reading the repo'); };
  const { errors } = checkBuildSecrets({ root, env: {}, buildDrafts: throwing });
  assert.ok(errors.some((e) => /could not enumerate repo drafts.*failing closed/.test(e)), errors.join('; '));
  fs.rmSync(root, { recursive: true, force: true });
});
