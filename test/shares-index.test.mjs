// SOW-166: the public-shares build artifact projection (/shares-index.json). Proves the leak guard: ONLY a
// published + visibility:public share reaches the artifact the digest reads; a members-only share, a Mode B
// stub, or a draft is excluded, fail closed. Pure; plain { data } fixtures, no Astro build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSharesIndex } from '../src/lib/shares-index.mjs';

const share = (over) => ({ data: { status: 'published', visibility: 'public', author: 'ann', id: 'x', title: 'T', createdAt: 1000, ...over } });

test('includes ONLY published+public shares; members-only, draft, and junk are excluded (fail closed)', () => {
  const entries = buildSharesIndex([
    share({ author: 'ann', id: 'a', createdAt: 3000 }),
    share({ author: 'bob', id: 'b', visibility: 'members', createdAt: 2000 }), // members-only -> excluded
    share({ author: 'cid', id: 'c', status: 'draft', createdAt: 2500 }),        // draft -> excluded
    { data: {} },                                                               // no status/visibility -> excluded
  ]);
  assert.equal(entries.length, 1, 'only the one public share survives the guard');
  assert.deepEqual(entries[0], {
    type: 'share', slug: 'ann/a', title: 'T', author: 'ann', url: '/shares/ann/a/', publishedAt: 3000, visibility: 'public',
  });
});

test('sorted newest-first by the share timestamp', () => {
  const entries = buildSharesIndex([
    share({ author: 'a', id: '1', createdAt: 1000 }),
    share({ author: 'a', id: '2', createdAt: 3000 }),
    share({ author: 'a', id: '3', createdAt: 2000 }),
  ]);
  assert.deepEqual(entries.map((e) => e.slug), ['a/2', 'a/3', 'a/1']);
});

test('title falls back to shortDescription then a neutral default; entities are decoded', () => {
  assert.equal(buildSharesIndex([share({ title: 'A &amp; B', id: 't' })])[0].title, 'A & B');
  assert.equal(buildSharesIndex([share({ title: undefined, shortDescription: 'Just a desc', id: 'd' })])[0].title, 'Just a desc');
  assert.equal(buildSharesIndex([share({ title: undefined, shortDescription: undefined, id: 'n' })])[0].title, 'Shared a link');
});

test('publishedAt uses the share timestamp; an undated share sinks to null', () => {
  assert.equal(buildSharesIndex([share({ createdAt: 5000, id: 'x' })])[0].publishedAt, 5000);
  assert.equal(buildSharesIndex([share({ createdAt: undefined, id: 'y' })])[0].publishedAt, null);
});

test('non-array input is a safe empty list', () => {
  assert.deepEqual(buildSharesIndex(null), []);
  assert.deepEqual(buildSharesIndex(undefined), []);
  assert.deepEqual(buildSharesIndex([]), []);
});
