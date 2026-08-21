// SOW-265: the shared live-URL scheme (client-ui/src/public-url.mjs), used by both the editor's
// "View Public Entry" button and the My Content table's View button. Pure, node-free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publicUrlFor, slugFromPath, TYPE_BASE, SITE_ORIGIN } from '../client-ui/src/public-url.mjs';

test('publicUrlFor maps each content type to its public route', () => {
  assert.equal(publicUrlFor({ type: 'post', slug: 'hello-world' }), 'https://gbti.network/articles/hello-world/');
  assert.equal(publicUrlFor({ type: 'product', slug: 'my-plugin' }), 'https://gbti.network/products/my-plugin/');
  assert.equal(publicUrlFor({ type: 'prompt', slug: 'a-prompt' }), 'https://gbti.network/prompts/a-prompt/');
});

test('publicUrlFor returns an absolute URL under the site origin', () => {
  assert.ok(publicUrlFor({ type: 'product', slug: 'x' }).startsWith(SITE_ORIGIN + '/'));
});

test('publicUrlFor returns empty for an unknown or pageless type (fail-safe, no broken link)', () => {
  assert.equal(publicUrlFor({ type: 'profile', slug: 'someone' }), '');
  assert.equal(publicUrlFor({ type: 'share', slug: 'x' }), '');
  assert.equal(publicUrlFor({ type: undefined, slug: 'x' }), '');
});

test('publicUrlFor returns empty when no slug can be resolved', () => {
  assert.equal(publicUrlFor({ type: 'product', slug: '' }), '');
  assert.equal(publicUrlFor({ type: 'product', slug: null }), '');
  assert.equal(publicUrlFor({ type: 'product' }), '');
});

test('publicUrlFor recovers the slug from a nested item path when frontmatter omits it', () => {
  // The historical null-slug bug built https://gbti.network/products// ; the path fallback fixes it.
  assert.equal(
    publicUrlFor({ type: 'product', slug: null, path: 'members/gbtilabs/products/my-plugin/index.md' }),
    'https://gbti.network/products/my-plugin/',
  );
  assert.equal(
    publicUrlFor({ type: 'post', slug: '', path: 'members/hudson/posts/a-post/index.md' }),
    'https://gbti.network/articles/a-post/',
  );
});

test('publicUrlFor prefers an explicit slug over the path-derived one', () => {
  assert.equal(
    publicUrlFor({ type: 'product', slug: 'renamed', path: 'members/x/products/old-dir/index.md' }),
    'https://gbti.network/products/renamed/',
  );
});

test('publicUrlFor URL-encodes the slug (valid kebab slugs pass through unchanged)', () => {
  assert.equal(publicUrlFor({ type: 'product', slug: 'plain-slug-123' }), 'https://gbti.network/products/plain-slug-123/');
  assert.equal(publicUrlFor({ type: 'product', slug: 'a b' }), 'https://gbti.network/products/a%20b/');
  assert.equal(publicUrlFor({ type: 'product', slug: 'a/b' }), 'https://gbti.network/products/a%2Fb/');
});

test('slugFromPath reads the folder name of a nested index file, else empty', () => {
  assert.equal(slugFromPath('members/gbtilabs/products/my-plugin/index.md'), 'my-plugin');
  assert.equal(slugFromPath('members/hudson/prompts/qa-skill/index.mdx'), 'qa-skill');
  assert.equal(slugFromPath('members/x/shares/2026-08-21-note.md'), ''); // not an index file
  assert.equal(slugFromPath(''), '');
  assert.equal(slugFromPath(null), '');
});

test('TYPE_BASE carries exactly the three page-bearing content types', () => {
  assert.deepEqual(TYPE_BASE, { post: 'articles', product: 'products', prompt: 'prompts' });
});
