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
    type: 'share', slug: 'ann/a', title: 'T', author: 'ann', description: null, url: '/shares/ann/a/', publishedAt: 3000, visibility: 'public',
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


// ---------- sow-166 digest v2 (2026-08-23): the public one-line description ----------

test('a titled share publishes its shortDescription as the digest blurb', () => {
  const [e] = buildSharesIndex([share({ id: 'a', title: 'A title', shortDescription: 'Why this is worth reading.' })]);
  assert.equal(e.title, 'A title');
  assert.equal(e.description, 'Why this is worth reading.');
});

// The duplication this prevents is not hypothetical: buildSharesIndex ALREADY falls back to shortDescription
// for the title when a share has none, so emitting it as the description too would print the same sentence
// twice in one row, as heading and as blurb.
test('an UNTITLED share does not repeat its shortDescription as both title and blurb', () => {
  const [e] = buildSharesIndex([share({ id: 'b', title: undefined, shortDescription: 'The only sentence there is.' })]);
  assert.equal(e.title, 'The only sentence there is.', 'it is serving as the title');
  assert.equal(e.description, null, 'so it must not also serve as the blurb');
});

test('a share with no shortDescription publishes no description, never a body', () => {
  const [e] = buildSharesIndex([share({ id: 'c', title: 'T', body: 'THE SHARE BODY', note: 'A NOTE' })]);
  assert.equal(e.description, null, 'absent means absent');
  assert.ok(!JSON.stringify(e).includes('THE SHARE BODY'));
  assert.ok(!JSON.stringify(e).includes('A NOTE'));
});
