// sow-194: the shared pure helpers that fold /membership/repo-drafts into the WorkBench Drafts view
// (client/src/repo-drafts-core.mjs). No network; both the extension/npm client and the website adapter use them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapRepoDraftItem, mergeRepoDrafts } from '../client/src/repo-drafts-core.mjs';

const ITEM = { type: 'post', slug: 'my-wip', path: 'members/alice/posts/my-wip/index.md', owner: 'alice', title: 'My WIP', visibility: 'public', status: 'draft', store: 'repo' };

test('mapRepoDraftItem: maps to the draft-row shape with store:repo, no branch, no pull', () => {
  assert.deepEqual(mapRepoDraftItem(ITEM), {
    type: 'post', slug: 'my-wip', branch: null, path: 'members/alice/posts/my-wip/index.md',
    pendingSlug: null, title: 'My WIP', visibility: 'public', status: 'draft', owner: 'alice',
    valid: true, invalidReason: null, pull: null, store: 'repo',
  });
});

test('mapRepoDraftItem: a members-visibility repo draft is preserved; a missing title falls back to the slug', () => {
  const m = mapRepoDraftItem({ type: 'prompt', slug: 'p', path: 'members/bob/prompts/p/index.md', visibility: 'members' });
  assert.equal(m.visibility, 'members');
  assert.equal(m.title, 'p'); // no title -> slug
  assert.equal(m.store, 'repo');
  assert.equal(m.branch, null);
  // an unknown visibility fails closed to public (never leaks a members row as a members badge on a bad value)
  assert.equal(mapRepoDraftItem({ type: 'post', slug: 'x', visibility: 'weird' }).visibility, 'public');
});

test('mergeRepoDrafts: appends repo rows after the existing fork/KV rows', () => {
  const existing = [{ type: 'post', slug: 'staged-one', store: 'fork' }];
  const merged = mergeRepoDrafts(existing, [ITEM]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].slug, 'staged-one'); // existing first
  assert.equal(merged[1].slug, 'my-wip');
  assert.equal(merged[1].store, 'repo');
});

test('mergeRepoDrafts: a repo row whose (type,slug) already has a fork/KV draft is DROPPED (the editable copy wins)', () => {
  const existing = [{ type: 'post', slug: 'my-wip', store: 'kv' }]; // same item, being edited in KV
  const merged = mergeRepoDrafts(existing, [ITEM]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].store, 'kv'); // the KV row, not the repo copy
});

test('mergeRepoDrafts: same slug but DIFFERENT type is NOT a collision (both kept)', () => {
  const existing = [{ type: 'post', slug: 'my-wip', store: 'kv' }];
  const merged = mergeRepoDrafts(existing, [{ ...ITEM, type: 'prompt' }]);
  assert.equal(merged.length, 2); // post:my-wip (kv) + prompt:my-wip (repo)
  assert.deepEqual(merged.map((d) => `${d.type}:${d.slug}`).sort(), ['post:my-wip', 'prompt:my-wip']);
});

test('mergeRepoDrafts: the optional type filter keeps only repo rows of that type', () => {
  const items = [ITEM, { type: 'product', slug: 'prod', path: 'members/alice/products/prod/index.md' }];
  const merged = mergeRepoDrafts([], items, { type: 'post' });
  assert.deepEqual(merged.map((d) => d.slug), ['my-wip']);
});

test('mergeRepoDrafts: fail-soft on junk (null items, missing type/slug are skipped; input not mutated)', () => {
  const existing = [{ type: 'post', slug: 'a', store: 'fork' }];
  const merged = mergeRepoDrafts(existing, [null, {}, { type: 'post' }, { slug: 'x' }, ITEM]);
  assert.equal(merged.length, 2); // only ITEM is a valid repo row
  assert.equal(existing.length, 1); // the original array is not mutated
});

test('mergeRepoDrafts: two repo drafts of the SAME (type,slug) only appear once', () => {
  const merged = mergeRepoDrafts([], [ITEM, { ...ITEM, title: 'dupe' }]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].title, 'My WIP'); // the first wins
});
