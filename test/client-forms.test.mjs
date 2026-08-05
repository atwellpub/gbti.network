// SOW-006 form polish: per-type field drift guard, the preview markdown renderer, and image staging.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIELDS, fieldsFor } from '../client/src/form-fields.mjs';
import { schemaFor } from '../client/src/schemas.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stageImage, itemImagesDir } from '../client/src/operations.mjs';
import { createStager } from '../client/src/repo-fs.mjs';

const FORCED_OR_SYSTEM = ['type', 'author', 'username', 'contributors', 'tier', 'joinedAt'];

test('form-fields: every field is a real schema key, and forced/system fields are never offered', () => {
  for (const type of Object.keys(FIELDS)) {
    const shape = new Set(Object.keys(schemaFor(type).shape));
    const fields = fieldsFor(type);
    assert.ok(fields.length > 0, `${type} has fields`);
    for (const f of fields) assert.ok(shape.has(f.key), `${type}.${f.key} is not a schema key`);
    const offered = new Set(fields.map((f) => f.key));
    for (const forbidden of FORCED_OR_SYSTEM) assert.ok(!offered.has(forbidden), `${type} must not offer ${forbidden}`);
  }
});

test('form-fields: content types require title + slug; profile requires displayName', () => {
  for (const t of ['post', 'product', 'prompt']) {
    const keys = fieldsFor(t).filter((f) => f.required).map((f) => f.key);
    assert.ok(keys.includes('title') && keys.includes('slug'), `${t} requires title+slug`);
  }
  assert.ok(fieldsFor('profile').some((f) => f.key === 'displayName' && f.required));
});

test('renderMarkdown: headings, emphasis, lists, code, links, and HTML escaping', () => {
  assert.match(renderMarkdown('# Title'), /<h1>Title<\/h1>/);
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(renderMarkdown('`code`'), /<code>code<\/code>/);
  assert.match(renderMarkdown('[GBTI](https://gbti.network)'), /<a href="https:\/\/gbti\.network"[^>]*>GBTI<\/a>/);
  assert.match(renderMarkdown('```\nx<y\n```'), /<pre><code>x&lt;y<\/code><\/pre>/);
  // SOW-050: a fenced block tags its language onto the <code> (class + data-lang) for the reader's code card;
  // an unknown/dirty tag is sanitized to a safe charset.
  assert.match(renderMarkdown('```js\nconst a=1;\n```'), /<pre><code class="language-js" data-lang="js">const a=1;<\/code><\/pre>/);
  assert.match(renderMarkdown('```TS x\ny\n```'), /class="language-ts" data-lang="ts"/); // first token, lowercased
  assert.doesNotMatch(renderMarkdown('```"><img>\nz\n```'), /<img>/); // tag chars stripped, never injected
  // XSS safety: raw HTML is escaped, not injected
  assert.doesNotMatch(renderMarkdown('<script>alert(1)</script>'), /<script>/);
  assert.match(renderMarkdown('<script>alert(1)</script>'), /&lt;script&gt;/);
});

test('stageImage: writes a scoped image and rejects traversal / bad type', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-img-'));
  const ctx = { identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }), stager: createStager(repoPath), store: { get: (k) => ({ repoPath })[k] } };
  const data = Buffer.from('PNGDATA').toString('base64');

  const ok = stageImage(ctx, { filename: 'pic.png', dataBase64: data });
  assert.equal(ok.path, 'members/alice/images/pic.png');
  assert.ok(fs.existsSync(path.join(repoPath, ok.path)));

  assert.throws(() => stageImage(ctx, { filename: '../escape.png', dataBase64: data }), /invalid filename/);
  assert.throws(() => stageImage(ctx, { filename: 'evil.exe', dataBase64: data }), /unsupported image type/);
  assert.throws(() => stageImage(ctx, { filename: 'pic.png' }), /no image data/);
});

test('sow-165 itemImagesDir: resolves the own/house item folder, null for unsafe or foreign paths', () => {
  // own member item -> co-located images dir alongside index.md
  assert.equal(itemImagesDir('members/alice/posts/hello/index.md', 'alice'), 'members/alice/posts/hello/images');
  assert.equal(itemImagesDir('members/alice/products/tool/index.md', 'alice'), 'members/alice/products/tool/images');
  // house item -> allowed (house authoring)
  assert.equal(itemImagesDir('house/posts/news/index.md', 'alice'), 'house/posts/news/images');
  // a leading slash is tolerated (normalized)
  assert.equal(itemImagesDir('/members/alice/posts/hello/index.md', 'alice'), 'members/alice/posts/hello/images');
  // ANOTHER member's folder -> null (never write outside the caller's tree)
  assert.equal(itemImagesDir('members/bob/posts/hello/index.md', 'alice'), null);
  // traversal / backslash / empty / no-slash -> null
  assert.equal(itemImagesDir('members/alice/../bob/posts/x/index.md', 'alice'), null);
  assert.equal(itemImagesDir('members\\alice\\posts\\x\\index.md', 'alice'), null);
  assert.equal(itemImagesDir('', 'alice'), null);
  assert.equal(itemImagesDir(null, 'alice'), null);
  assert.equal(itemImagesDir('index.md', 'alice'), null);
});

test('sow-165 stageImage: co-locates into the item folder and returns ./images when itemPath is known', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-img2-'));
  const ctx = { identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }), stager: createStager(repoPath), store: { get: (k) => ({ repoPath })[k] } };
  const data = Buffer.from('PNGDATA').toString('base64');

  const out = stageImage(ctx, { filename: 'shot.webp', dataBase64: data, itemPath: 'members/alice/products/tool/index.md' });
  // the reference stored in content is the canonical repo-relative ./images path (native Astro resolution)
  assert.equal(out.path, './images/shot.webp');
  assert.equal(out.repoPath, 'members/alice/products/tool/images/shot.webp');
  assert.ok(fs.existsSync(path.join(repoPath, out.repoPath)));

  // a FOREIGN itemPath is rejected by itemImagesDir, so it falls back to the per-user library (never bob's tree)
  const fallback = stageImage(ctx, { filename: 'shot.webp', dataBase64: data, itemPath: 'members/bob/products/tool/index.md' });
  assert.equal(fallback.path, 'members/alice/images/shot.webp');
  assert.ok(fs.existsSync(path.join(repoPath, 'members/alice/images/shot.webp')));
  assert.ok(!fs.existsSync(path.join(repoPath, 'members/bob/products/tool/images/shot.webp')));
});
