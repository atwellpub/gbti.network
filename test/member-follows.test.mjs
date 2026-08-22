// SOW-023: the pure follow-graph core (membership/member-follows.mjs). Toggle, dedupe, normalize, validate,
// limit. No IO (injected now), so these are fast and deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFollows, normalizeUsername, normalizeFollows, applyFollow, followingUsernames, FollowError, MAX_FOLLOWING,
  applyFollowNotify, followNotify,
} from '../membership/member-follows.mjs';

const now = () => 1000;

test('normalizeUsername: lowercases, validates shape, rejects junk/paths', () => {
  assert.equal(normalizeUsername('AtwellPub'), 'atwellpub');
  assert.equal(normalizeUsername('di-kafei'), 'di-kafei');
  assert.equal(normalizeUsername('  Hudson  '), 'hudson');
  assert.equal(normalizeUsername('../etc'), null);
  assert.equal(normalizeUsername('a b'), null);
  assert.equal(normalizeUsername('-leading'), null);
  assert.equal(normalizeUsername('trailing-'), null);
  assert.equal(normalizeUsername(''), null);
  assert.equal(normalizeUsername('a'.repeat(40)), null);
  assert.equal(normalizeUsername(42), null);
});

test('applyFollow: adds a follow with a timestamp', () => {
  const f = applyFollow(emptyFollows(), { username: 'Alice', on: true }, { now });
  assert.deepEqual(f.following, [{ username: 'alice', addedAt: 1000 }]);
  assert.equal(f.updatedAt, 1000);
});

test('applyFollow: idempotent add (no duplicate), and remove', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true }, { now });
  f = applyFollow(f, { username: 'alice', on: true }, { now });
  assert.equal(f.following.length, 1, 'no duplicate');
  f = applyFollow(f, { username: 'alice', on: false }, { now });
  assert.equal(f.following.length, 0, 'removed');
});

test('applyFollow: rejects an invalid username', () => {
  assert.throws(() => applyFollow(emptyFollows(), { username: '../x', on: true }, { now }), FollowError);
  assert.throws(() => applyFollow(emptyFollows(), { username: '', on: true }, { now }), FollowError);
});

test('applyFollow: enforces the following limit', () => {
  const following = Array.from({ length: MAX_FOLLOWING }, (_, i) => ({ username: `u${i}`, addedAt: 1 }));
  assert.throws(() => applyFollow({ following }, { username: 'newone', on: true }, { now }), /limit/);
  // toggling OFF an existing follow at the limit is still allowed
  assert.doesNotThrow(() => applyFollow({ following }, { username: 'u0', on: false }, { now }));
});

test('normalizeFollows: drops malformed + duplicate entries, coerces shape', () => {
  const f = normalizeFollows({
    following: [
      { username: 'Alice', addedAt: 5 },
      { username: 'alice', addedAt: 9 }, // dup after lowercase
      { username: '../bad' },            // invalid
      { nope: true },                    // no username
      'string',                          // not an object
    ],
    updatedAt: 7,
  });
  assert.deepEqual(f.following, [{ username: 'alice', addedAt: 5 }]);
  assert.equal(f.updatedAt, 7);
});

test('followingUsernames: returns the clean username list', () => {
  assert.deepEqual(followingUsernames({ following: [{ username: 'A' }, { username: 'b' }] }), ['a', 'b']);
  assert.deepEqual(followingUsernames(null), []);
});

// --- SOW-186 phase 1: the per-follow notification matrix on the follow record ---

test('normalizeFollows preserves a well-formed per-follow notify matrix, drops a malformed one', () => {
  const f = normalizeFollows({
    following: [
      { username: 'alice', addedAt: 5, notify: { article: { email: true }, prompt: { api: false } } },
      { username: 'bob', addedAt: 6, notify: { article: { email: 'yes' } } }, // channel not boolean -> whole thing drops
      { username: 'carol', addedAt: 7 }, // no notify at all
    ],
    updatedAt: 9,
  });
  assert.deepEqual(f.following[0], { username: 'alice', addedAt: 5, notify: { article: { email: true }, prompt: { api: false } } });
  assert.deepEqual(f.following[1], { username: 'bob', addedAt: 6 }, 'a malformed notify is dropped, the follow survives');
  assert.deepEqual(f.following[2], { username: 'carol', addedAt: 7 });
});

test('applyFollow: a notify payload on a NEW follow stores the matrix in one action (follow-button-opens-modal)', () => {
  const f = applyFollow(emptyFollows(), { username: 'Alice', on: true, notify: { article: { email: true } } }, { now });
  assert.deepEqual(f.following, [{ username: 'alice', addedAt: 1000, notify: { article: { email: true } } }]);
});

test('applyFollow: a plain re-follow (no notify arg) never wipes an existing matrix', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true, notify: { share: { email: true } } }, { now });
  f = applyFollow(f, { username: 'alice', on: true }, { now }); // notify omitted
  assert.deepEqual(f.following[0].notify, { share: { email: true } }, 'omitting notify leaves prefs untouched');
});

test('applyFollow: a notify payload on an already-followed member UPDATES the matrix; empty clears it', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true, notify: { article: { email: true } } }, { now });
  f = applyFollow(f, { username: 'alice', on: true, notify: { prompt: { api: false } } }, { now });
  assert.deepEqual(f.following[0].notify, { prompt: { api: false } }, 'the new matrix replaces the old');
  f = applyFollow(f, { username: 'alice', on: true, notify: {} }, { now }); // empty -> cleared
  assert.equal(f.following[0].notify, undefined, 'an empty matrix clears it, falling back to the global default');
});

test('applyFollowNotify: edits an existing follow, throws when not following', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true }, { now });
  f = applyFollowNotify(f, { username: 'alice', notify: { product: { email: true, api: true } } }, { now });
  assert.deepEqual(f.following[0].notify, { product: { email: true, api: true } });
  assert.equal(f.updatedAt, 1000);
  assert.throws(() => applyFollowNotify(f, { username: 'nobody', notify: { article: { email: true } } }, { now }), FollowError);
});

test('applyFollowNotify: a null/empty matrix clears the per-follow override', () => {
  let f = applyFollow(emptyFollows(), { username: 'alice', on: true, notify: { article: { email: true } } }, { now });
  f = applyFollowNotify(f, { username: 'alice', notify: null }, { now });
  assert.equal(f.following[0].notify, undefined);
});

test('followNotify: returns the stored matrix for a followed member, undefined otherwise', () => {
  const f = applyFollow(emptyFollows(), { username: 'alice', on: true, notify: { article: { email: true } } }, { now });
  assert.deepEqual(followNotify(f, 'Alice'), { article: { email: true } }, 'case-insensitive lookup');
  assert.equal(followNotify(f, 'bob'), undefined, 'not followed -> undefined (falls through to global default)');
  assert.equal(followNotify(f, '../bad'), undefined, 'invalid username -> undefined, never a throw');
});
