// SOW-143: the pure helpers behind the in-extension member profile detail view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberContent, MEMBER_SECTIONS } from '../client-ui/src/member-view-core.mjs';
import { directoryMap } from '../client-ui/src/members-index.mjs';

const items = [
  { type: 'post', title: 'A', author: 'alice', publishedAt: 300 },
  { type: 'post', title: 'B', author: 'Alice', publishedAt: 100 }, // case-insensitive match
  { type: 'post', title: 'C', author: 'bob', publishedAt: 200 },
  { type: 'post', title: 'D', author: 'alice', publishedAt: null }, // dateless -> last
  { type: 'post', title: 'E', author: 'gbti', publishedAt: 999 },
];

test('memberContent: matches author case-insensitively, newest-first, dateless last', () => {
  const out = memberContent(items, 'alice');
  assert.deepEqual(out.map((i) => i.title), ['A', 'B', 'D']); // 300, 100, then dateless
  // bob's and gbti's items are excluded
  assert.equal(out.some((i) => i.title === 'C' || i.title === 'E'), false);
});

test('memberContent: gbti/house never match a member, empty username -> []', () => {
  assert.deepEqual(memberContent(items, 'gbti'), []);
  assert.deepEqual(memberContent(items, 'house'), []);
  assert.deepEqual(memberContent(items, ''), []);
  assert.deepEqual(memberContent(items, null), []);
});

test('memberContent: cap applies after the sort (keeps the newest N)', () => {
  const out = memberContent(items, 'alice', 2);
  assert.deepEqual(out.map((i) => i.title), ['A', 'B']); // the two newest, dateless dropped
});

test('memberContent: a non-array input returns []', () => {
  assert.deepEqual(memberContent(undefined, 'alice'), []);
  assert.deepEqual(memberContent({}, 'alice'), []);
});

test('MEMBER_SECTIONS: the three content types in order', () => {
  assert.deepEqual(MEMBER_SECTIONS.map((s) => s.type), ['post', 'product', 'prompt']);
  assert.deepEqual(MEMBER_SECTIONS.map((s) => s.json), ['blog-index.json', 'products-index.json', 'prompts-index.json']);
});

test('directoryMap: keys by lowercase username, tolerates junk', () => {
  const m = directoryMap({ members: [{ username: 'Alice', displayName: 'Alice A' }, { username: 'bob' }, null, {}] });
  assert.equal(m.get('alice')?.displayName, 'Alice A');
  assert.equal(m.has('bob'), true);
  assert.equal(m.size, 2); // null + username-less entries dropped
  assert.deepEqual([...directoryMap(null).keys()], []);
  assert.deepEqual([...directoryMap({}).keys()], []);
});
