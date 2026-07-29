// sow-158 Phase 3b: the pure core of the website WorkBench adapter (src/lib/workbench-client-core.mjs). No network,
// no TS: the .ts adapter is the cookie transport; this proves the members-only file planning, the discussion
// filter/tier-gate, the comment-visibility coercion, and the favorite derivation. Uses a FAKE encrypt (no Worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMemberFiles, filterThreadComments, coerceCommentInput, favoritedFrom, COMMENT_TARGET_TYPES, MEMBER_READ_TIER } from '../src/lib/workbench-client-core.mjs';
import { buildCommentFile, commentId } from '../client/src/content-ops.mjs';

const fakeEncrypt = async (plaintext, assetId) => ({ v: 1, kid: '1', iv: 'IV', aad: assetId, ct: 'CT(' + plaintext + ')' });

test('planMemberFiles: a members comment encrypts to a .enc + a stub .md carrying the pointer', async () => {
  const id = commentId('2026-01-02T03:04:05Z', 'abc123');
  const built = buildCommentFile({ username: 'gwen', input: { id, targetType: 'post', targetSlug: 'hello', createdAt: '2026-01-02T03:04:05Z', status: 'published', visibility: 'members' }, body: 'a members-only reply' });
  const plan = await planMemberFiles({ built, body: 'a members-only reply', encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2);
  const md = plan.files.find((f) => f.path.endsWith('.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  assert.equal(md.path, `members/gwen/comments/${id}.md`);
  assert.equal(enc.path, `members/gwen/_enc/comment-${id}-body.enc`);
  assert.match(md.content, /encryptedBody:/);
  assert.doesNotMatch(md.content, /a members-only reply/, 'the plaintext members body must NOT appear in the committed .md');
  assert.match(enc.content, /CT\(a members-only reply\)/, 'the ciphertext envelope carries the encrypted body');
  assert.equal(plan.encPath, enc.path);
});

test('planMemberFiles: a public intro (no marker) returns null -> the caller commits the plaintext .md', async () => {
  const id = commentId('2026-01-02T03:04:05Z', 'pub1');
  const built = buildCommentFile({ username: 'gwen', input: { id, targetType: 'product', targetSlug: 'radle', createdAt: '2026-01-02T03:04:05Z', status: 'published', visibility: 'public', authorNote: true }, body: 'why I built this' });
  assert.equal(await planMemberFiles({ built, body: 'why I built this', encrypt: fakeEncrypt }), null);
});

test('coerceCommentInput: a discussion reply is coerced to members; only an author-note intro stays public', () => {
  // a plain reply, even if the client asks for public -> members
  assert.equal(coerceCommentInput({ id: 'c1', targetType: 'post', targetSlug: 's', visibility: 'public' }).visibility, 'members');
  // an author-note intro on a post/product/prompt -> public
  assert.equal(coerceCommentInput({ id: 'c2', targetType: 'product', targetSlug: 's', authorNote: true, visibility: 'public' }).visibility, 'public');
  assert.equal(coerceCommentInput({ id: 'c2', targetType: 'product', targetSlug: 's', authorNote: true, visibility: 'public' }).authorNote, true);
  // an author-note on a SHARE is never public (SOW-044) -> members
  assert.equal(coerceCommentInput({ id: 'c3', targetType: 'share', targetSlug: 's', authorNote: true, visibility: 'public' }).visibility, 'members');
  // a reply carries its parentId + createdAt through
  const withParent = coerceCommentInput({ id: 'c4', targetType: 'post', targetSlug: 's', createdAt: 'T', parentId: 'p1' });
  assert.equal(withParent.parentId, 'p1');
  assert.equal(withParent.createdAt, 'T');
  assert.equal(withParent.status, 'published');
});

const thread = [
  { id: 'b', targetType: 'post', targetSlug: 'hello', status: 'published', visibility: 'public', body: 'second', createdAt: '2026-01-02T00:00:02Z' },
  { id: 'a', targetType: 'post', targetSlug: 'hello', status: 'published', visibility: 'members', body: '', createdAt: '2026-01-02T00:00:01Z' },
  { id: 'c', targetType: 'post', targetSlug: 'other', status: 'published', visibility: 'public', body: 'nope', createdAt: '2026-01-02T00:00:03Z' },
  { id: 'd', targetType: 'product', targetSlug: 'hello', status: 'published', visibility: 'public', body: 'wrongtype', createdAt: '2026-01-02T00:00:04Z' },
  { id: 'e', targetType: 'post', targetSlug: 'renamed-old', status: 'published', visibility: 'public', body: 'alias', createdAt: '2026-01-02T00:00:05Z' },
  { id: 'f', targetType: 'post', targetSlug: 'hello', status: 'draft', visibility: 'public', body: 'draft', createdAt: '2026-01-02T00:00:06Z' },
];

test('filterThreadComments: matches target + aliases, drops other targets/types/drafts, sorts oldest-first', () => {
  const items = filterThreadComments(thread, { targetType: 'post', targetSlug: 'hello', aliases: ['renamed-old'] });
  assert.deepEqual(items.map((c) => c.id), ['a', 'b', 'e'], 'oldest-first, only post:hello + the alias, no draft/other-target/other-type');
});

test('filterThreadComments: a non-member viewer sees ONLY public rows (member stubs are tier-gated)', () => {
  const items = filterThreadComments(thread, { targetType: 'post', targetSlug: 'hello', canSeeMembers: false });
  assert.deepEqual(items.map((c) => c.id), ['b'], 'the members row (a) is dropped for a non-member');
});

test('filterThreadComments: an invalid target or missing slug returns empty', () => {
  assert.deepEqual(filterThreadComments(thread, { targetType: 'nope', targetSlug: 'x' }), []);
  assert.deepEqual(filterThreadComments(thread, { targetType: 'post', targetSlug: '' }), []);
});

test('favoritedFrom: derives favorited from the activity favorites list', () => {
  const activity = { favorites: [{ type: 'post', slug: 'x' }, { type: 'product', slug: 'y' }] };
  assert.equal(favoritedFrom(activity, 'post', 'x'), true);
  assert.equal(favoritedFrom(activity, 'post', 'z'), false);
  assert.equal(favoritedFrom(null, 'post', 'x'), false);
});

test('the shared tier + target sets are as expected', () => {
  assert.ok(COMMENT_TARGET_TYPES.has('share') && COMMENT_TARGET_TYPES.has('post'));
  assert.ok(MEMBER_READ_TIER.has('paid') && MEMBER_READ_TIER.has('trialing') && !MEMBER_READ_TIER.has('none'));
});
