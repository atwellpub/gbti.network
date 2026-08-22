// SOW-186 phase 3 (REWORKED): the reconcile reverse-follower-index builder. Pure projection + the KV->KV sync,
// tested with plain objects and injected fakes (no network, no secrets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReverseIndex, sameFollowerSet, syncFollowerIndex } from '../scripts/lib/follower-index.mjs';
import { FOLLOWERS_KEY } from '../membership/member-followers.mjs';

const at = (n) => () => n;

test('buildReverseIndex: projects the forward graph, keyed by followed github_id, resolving usernames', () => {
  const membersIndex = { '100': 'Alice', '200': 'bob', '9': 'zoe' };
  const forwardEntries = [
    { githubId: '9', follows: { following: [{ username: 'alice', addedAt: 5 }, { username: 'bob', addedAt: 6 }, { username: 'ghost', addedAt: 7 }] } },
    { githubId: '7', follows: { following: [{ username: 'alice', addedAt: 8 }] } },
    { githubId: '100', follows: { following: [{ username: 'alice', addedAt: 9 }] } }, // 100 follows itself -> excluded
  ];
  const { index, unresolved } = buildReverseIndex(forwardEntries, membersIndex, { now: at(1000) });
  assert.equal(unresolved, 1, 'the "ghost" username resolves to no github_id and is skipped fail-safe');
  // alice (100): followers 9 then 7, in forward-entry order; the self-follow (100) is excluded.
  assert.deepEqual(index['100'].followers, [{ githubId: '9', addedAt: 5 }, { githubId: '7', addedAt: 8 }]);
  assert.equal(index['100'].updatedAt, 1000);
  // bob (200): only 9.
  assert.deepEqual(index['200'].followers, [{ githubId: '9', addedAt: 6 }]);
  assert.ok(!('9' in index), 'nobody follows zoe (9), so it has no reverse entry');
});

test('buildReverseIndex: a github_id with no resolvable followed usernames contributes nothing', () => {
  const { index, unresolved } = buildReverseIndex(
    [{ githubId: '7', follows: { following: [{ username: 'nobody', addedAt: 1 }] } }],
    { '100': 'alice' },
    { now: at(1) },
  );
  assert.deepEqual(index, {});
  assert.equal(unresolved, 1);
});

test('buildReverseIndex: tolerates a Map members-index and junk entries', () => {
  const membersIndex = new Map([['100', 'alice'], ['bad', 'x'], ['200', 42]]);
  const { index } = buildReverseIndex(
    [{ githubId: '7', follows: { following: [{ username: 'alice', addedAt: 1 }] } }],
    membersIndex,
    { now: at(1) },
  );
  assert.deepEqual(index['100'].followers, [{ githubId: '7', addedAt: 1 }]);
});

test('sameFollowerSet: compares github_id SETS, ignoring addedAt and updatedAt', () => {
  assert.equal(sameFollowerSet(
    { followers: [{ githubId: '1', addedAt: 1 }], updatedAt: 5 },
    { followers: [{ githubId: '1', addedAt: 999 }], updatedAt: 9 },
  ), true);
  assert.equal(sameFollowerSet(
    { followers: [{ githubId: '1' }] },
    { followers: [{ githubId: '2' }] },
  ), false);
  assert.equal(sameFollowerSet(
    { followers: [{ githubId: '1' }, { githubId: '2' }] },
    { followers: [{ githubId: '1' }] },
  ), false);
});

test('syncFollowerIndex: writes changed targets, skips unchanged, deletes stale (incl. old username-keyed)', async () => {
  const writes = [], deletes = [];
  const r = await syncFollowerIndex({
    env: {}, membersIndex: { '100': 'alice', '200': 'bob' }, now: at(1000),
    listForward: async () => ({ available: true, entries: [
      { githubId: '9', follows: { following: [{ username: 'alice', addedAt: 1 }, { username: 'bob', addedAt: 2 }] } },
    ] }),
    listReverse: async () => ({ available: true, entries: [
      { key: FOLLOWERS_KEY('100'), value: { followers: [{ githubId: '9', addedAt: 1 }] } }, // unchanged
      { key: FOLLOWERS_KEY('200'), value: { followers: [{ githubId: '7', addedAt: 1 }] } }, // set changed (9 not 7)
      { key: 'followers:oldname', value: { followers: [{ githubId: '5', addedAt: 1 }] } },   // stale username-keyed -> delete
    ] }),
    writeReverse: async ({ key, value }) => { writes.push({ key, value: JSON.parse(value) }); },
    deleteReverse: async ({ key }) => { deletes.push(key); },
  });
  assert.equal(r.synced, true);
  assert.equal(r.followedTargets, 2);
  assert.equal(r.unchanged, 1, 'followers:100 set was identical -> no churn write');
  assert.equal(r.written, 1, 'followers:200 changed -> rewritten');
  assert.equal(r.deleted, 1, 'the stale username-keyed followers:oldname is deleted');
  assert.deepEqual(writes.map((w) => w.key), [FOLLOWERS_KEY('200')]);
  assert.deepEqual(writes[0].value.followers, [{ githubId: '9', addedAt: 2 }]);
  assert.deepEqual(deletes, ['followers:oldname']);
});

test('syncFollowerIndex: a fresh KV builds every target from scratch', async () => {
  const writes = [];
  const r = await syncFollowerIndex({
    env: {}, membersIndex: { '100': 'alice' }, now: at(1),
    listForward: async () => ({ available: true, entries: [
      { githubId: '9', follows: { following: [{ username: 'alice', addedAt: 1 }] } },
    ] }),
    listReverse: async () => ({ available: true, entries: [] }),
    writeReverse: async ({ key, value }) => { writes.push({ key, value: JSON.parse(value) }); },
    deleteReverse: async () => { throw new Error('nothing to delete'); },
  });
  assert.equal(r.written, 1);
  assert.equal(r.deleted, 0);
  assert.equal(writes[0].key, FOLLOWERS_KEY('100'));
});

test('syncFollowerIndex: reported no-op when the forward store is unavailable (no CF creds)', async () => {
  const r = await syncFollowerIndex({
    env: {},
    listForward: async () => ({ available: false, reason: 'CF creds not set', entries: [] }),
    listReverse: async () => { throw new Error('should not list reverse'); },
  });
  assert.equal(r.synced, false);
  assert.match(r.reason, /CF creds/);
});
