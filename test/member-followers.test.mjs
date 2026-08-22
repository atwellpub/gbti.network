// SOW-186 phase 3: the pure reverse-follower-index core (membership/member-followers.mjs). Normalize, add /
// remove (idempotent), cap, and the numeric-id validation that keeps junk out of the index. No IO (now
// injected), so these are fast and deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyFollowers, normalizeFollowers, applyFollower, followerIds, FollowersError, MAX_FOLLOWERS, FOLLOWERS_KEY,
} from '../membership/member-followers.mjs';

const now = () => 1000;

test('FOLLOWERS_KEY is keyed by the followed username', () => {
  assert.equal(FOLLOWERS_KEY('alice'), 'followers:alice');
});

test('emptyFollowers / normalizeFollowers: always the canonical shape, tolerant of junk', () => {
  assert.deepEqual(emptyFollowers(), { followers: [], updatedAt: null });
  assert.deepEqual(normalizeFollowers(null), { followers: [], updatedAt: null });
  assert.deepEqual(normalizeFollowers({ followers: 'nope' }), { followers: [], updatedAt: null });
});

test('normalizeFollowers: drops non-numeric ids, duplicates, and malformed entries', () => {
  const s = normalizeFollowers({
    followers: [
      { githubId: '42', addedAt: 5 },
      { githubId: 42, addedAt: 9 },   // dup after String() coercion
      { githubId: 'abc' },            // non-numeric -> dropped
      { nope: true },                 // no id -> dropped
      'string',                       // not an object -> dropped
      { githubId: '7', addedAt: 'x' },
    ],
    updatedAt: 3,
  });
  assert.deepEqual(s.followers, [{ githubId: '42', addedAt: 5 }, { githubId: '7', addedAt: 0 }]);
  assert.equal(s.updatedAt, 3);
});

test('applyFollower: add stamps a timestamp; add is idempotent; remove works', () => {
  let s = applyFollower(emptyFollowers(), { githubId: '42', on: true }, { now });
  assert.deepEqual(s.followers, [{ githubId: '42', addedAt: 1000 }]);
  assert.equal(s.updatedAt, 1000);
  // idempotent add: no duplicate, and updatedAt NOT bumped (so the Worker glue can skip the write)
  const again = applyFollower(s, { githubId: '42', on: true }, { now: () => 2000 });
  assert.equal(again.followers.length, 1);
  assert.equal(again.updatedAt, 1000, 'idempotent add leaves updatedAt untouched');
  // remove
  s = applyFollower(s, { githubId: '42', on: false }, { now: () => 3000 });
  assert.deepEqual(s.followers, []);
  assert.equal(s.updatedAt, 3000);
  // remove an absent id: idempotent no-op
  const noop = applyFollower(s, { githubId: '99', on: false }, { now: () => 4000 });
  assert.equal(noop.updatedAt, 3000, 'removing an absent id leaves updatedAt untouched');
});

test('applyFollower: coerces a numeric id to a string, rejects a non-numeric id', () => {
  const s = applyFollower(emptyFollowers(), { githubId: 42, on: true }, { now });
  assert.equal(s.followers[0].githubId, '42');
  assert.throws(() => applyFollower(emptyFollowers(), { githubId: 'abc', on: true }, { now }), FollowersError);
  assert.throws(() => applyFollower(emptyFollowers(), { githubId: '', on: true }, { now }), FollowersError);
  assert.throws(() => applyFollower(emptyFollowers(), { githubId: null, on: true }, { now }), FollowersError);
});

test('applyFollower: enforces the follower cap on add (not on remove)', () => {
  const followers = Array.from({ length: MAX_FOLLOWERS }, (_v, i) => ({ githubId: String(i + 1), addedAt: 1 }));
  assert.throws(() => applyFollower({ followers }, { githubId: '999999999', on: true }, { now }), /limit/);
  // removing at the cap is still allowed
  assert.doesNotThrow(() => applyFollower({ followers }, { githubId: '1', on: false }, { now }));
});

test('followerIds: returns the clean github_id list for drain-time enumeration', () => {
  const s = applyFollower(applyFollower(emptyFollowers(), { githubId: '42', on: true }, { now }), { githubId: '7', on: true }, { now });
  assert.deepEqual(followerIds(s), ['42', '7']);
  assert.deepEqual(followerIds(null), []);
});
