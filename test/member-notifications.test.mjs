// SOW-150 / SOW-186: the pure notification-store core (membership/member-notifications.mjs). Normalize, append
// (dedupe + cap), mark-seen, unseen count, and the input validation that keeps a bad record or a poisoned
// deep-link out of a member's bell. No IO (now/genId injected), so these are fast and deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyNotifications, normalizeNotifications, appendNotification, markSeen, unseenCount,
  NotificationError, MAX_NOTIFICATIONS, DEDUPE_WINDOW_MS,
} from '../membership/member-notifications.mjs';

const now = () => 1000;
let seq = 0;
const genId = () => `id${++seq}`;
const share = (slug) => ({ type: 'share', slug, url: `/shares/${slug}/`, title: 'A share' });

test('emptyNotifications / normalizeNotifications: always the canonical shape, tolerant of junk', () => {
  assert.deepEqual(emptyNotifications(), { items: [], updatedAt: null });
  assert.deepEqual(normalizeNotifications(null), { items: [], updatedAt: null });
  assert.deepEqual(normalizeNotifications('x'), { items: [], updatedAt: null });
  assert.deepEqual(normalizeNotifications({ items: 'nope' }), { items: [], updatedAt: null });
});

test('appendNotification: adds a record with a generated id, unseen, newest-first, actor lowercased', () => {
  seq = 0;
  const s = appendNotification(undefined, { type: 'mention', actor: 'Alice', actorName: 'Alice A', target: share('bob/xyz') }, { now, genId });
  assert.equal(s.items.length, 1);
  assert.deepEqual(s.items[0], {
    id: 'id1', type: 'mention', target: { type: 'share', slug: 'bob/xyz', title: 'A share', url: '/shares/bob/xyz/' },
    actor: 'alice', actorName: 'Alice A', createdAt: 1000, seen: false,
  });
  assert.equal(s.updatedAt, 1000);
});

test('appendNotification: a repeat of the same (type, actor, target) inside the window REFRESHES, not duplicates', () => {
  seq = 0;
  let n = 1000;
  const clock = () => n;
  let s = appendNotification(undefined, { type: 'mention', actor: 'alice', target: share('bob/xyz') }, { now: clock, genId });
  s = markSeen(s, { now: clock }); // mark it seen, then a repeat should un-see it
  n = 1000 + DEDUPE_WINDOW_MS - 1; // still inside the window
  s = appendNotification(s, { type: 'mention', actor: 'alice', target: share('bob/xyz') }, { now: clock, genId });
  assert.equal(s.items.length, 1, 'still one row');
  assert.equal(s.items[0].id, 'id1', 'the same row id is kept (updates in place)');
  assert.equal(s.items[0].createdAt, n, 'createdAt bumped to now');
  assert.equal(s.items[0].seen, false, 'a refresh makes it unseen again');
});

test('appendNotification: a repeat AFTER the window is a fresh row (a legit later publish)', () => {
  seq = 0;
  let n = 1000;
  const clock = () => n;
  let s = appendNotification(undefined, { type: 'follow-publish', actor: 'carol', target: share('carol/one') }, { now: clock, genId });
  n = 1000 + DEDUPE_WINDOW_MS + 1; // just past the window
  s = appendNotification(s, { type: 'follow-publish', actor: 'carol', target: share('carol/one') }, { now: clock, genId });
  assert.equal(s.items.length, 2, 'a repeat past the window is a new row');
});

test('appendNotification: a different actor or target is always a distinct row', () => {
  seq = 0;
  let s = appendNotification(undefined, { type: 'mention', actor: 'alice', target: share('bob/one') }, { now, genId });
  s = appendNotification(s, { type: 'mention', actor: 'dave', target: share('bob/one') }, { now, genId }); // other actor
  s = appendNotification(s, { type: 'mention', actor: 'alice', target: share('bob/two') }, { now, genId }); // other target
  assert.equal(s.items.length, 3);
});

test('appendNotification: enforces the cap, dropping the oldest', () => {
  seq = 0;
  let n = 0;
  const clock = () => (n += 1); // strictly increasing so nothing dedupes and order is deterministic
  let s;
  for (let i = 0; i < MAX_NOTIFICATIONS + 25; i++) {
    s = appendNotification(s, { type: 'follow-publish', actor: 'carol', target: share(`carol/i${i}`) }, { now: clock, genId });
  }
  assert.equal(s.items.length, MAX_NOTIFICATIONS, 'capped');
  assert.equal(s.items[0].target.slug, `carol/i${MAX_NOTIFICATIONS + 24}`, 'newest kept at the front');
  assert.ok(!s.items.some((it) => it.target.slug === 'carol/i0'), 'the oldest fell off the tail');
});

test('appendNotification: rejects a bad record (throws NotificationError, no partial write)', () => {
  assert.throws(() => appendNotification(undefined, { type: 'mention', target: { type: 'share', slug: '../evil' } }, { now, genId }), NotificationError);
  assert.throws(() => appendNotification(undefined, { type: 'BAD TYPE', target: share('a/b') }, { now, genId }), NotificationError);
  assert.throws(() => appendNotification(undefined, { type: 'mention', actor: '../x', target: share('a/b') }, { now, genId }), NotificationError);
  assert.throws(() => appendNotification(undefined, { type: 'mention' }, { now, genId }), NotificationError); // no target
  assert.throws(() => appendNotification(undefined, { type: 'mention', target: share('a/b') }, { now }), NotificationError); // no genId
});

test('a poisoned deep-link url is DROPPED (record survives), never stored', () => {
  seq = 0;
  for (const url of ['//evil.com', 'https://evil.com', 'javascript:alert(1)', 'evil']) {
    const s = appendNotification(undefined, { type: 'mention', actor: 'alice', target: { type: 'share', slug: 'a/b', url } }, { now, genId });
    assert.equal(s.items[0].target.url, undefined, `url ${url} dropped`);
    assert.equal(s.items[0].target.slug, 'a/b', 'the record still lands');
  }
  // A well-formed site-relative path (with hyphens) is KEPT.
  const ok = appendNotification(undefined, { type: 'mention', actor: 'alice', target: { type: 'post', slug: 'my-post', url: '/blog/my-post/' } }, { now, genId });
  assert.equal(ok.items[0].target.url, '/blog/my-post/');
});

test('normalizeNotifications: drops malformed + duplicate-id stored items, sorts newest-first, coerces shape', () => {
  const s = normalizeNotifications({
    items: [
      null, 5, { id: 'x' }, // junk + a valid id with no valid target
      { id: 'a', type: 'mention', actor: 'alice', target: { type: 'share', slug: 'bob/one' }, createdAt: 10, seen: true },
      { id: 'a', type: 'mention', actor: 'alice', target: { type: 'share', slug: 'bob/dup' }, createdAt: 99 }, // dup id dropped
      { id: 'b', type: 'follow-publish', actor: 'carol', target: { type: 'post', slug: 'p' }, createdAt: 20 },
      { type: 'mention', target: { type: 'share', slug: 'a/b' }, createdAt: 30 }, // no id -> dropped
    ],
    updatedAt: 50,
  });
  assert.deepEqual(s.items.map((i) => i.id), ['b', 'a'], 'newest-first, dup id + id-less + junk dropped');
  assert.equal(s.items[0].seen, false);
  assert.equal(s.items[1].seen, true);
  assert.equal(s.updatedAt, 50);
});

test('markSeen: all by default; a subset by id; only bumps updatedAt when something changed', () => {
  seq = 0;
  let n = 0;
  const clock = () => (n += 1);
  let s = appendNotification(undefined, { type: 'mention', actor: 'alice', target: share('bob/one') }, { now: clock, genId }); // id1
  s = appendNotification(s, { type: 'mention', actor: 'dave', target: share('bob/two') }, { now: clock, genId }); // id2
  assert.equal(unseenCount(s), 2);
  // mark only id1
  let after = markSeen(s, { ids: ['id1'], now: clock });
  assert.equal(unseenCount(after), 1);
  assert.equal(after.items.find((i) => i.id === 'id1').seen, true);
  assert.equal(after.items.find((i) => i.id === 'id2').seen, false);
  // mark all
  after = markSeen(after, { now: clock });
  assert.equal(unseenCount(after), 0);
  // a no-op mark (already all seen) does not bump updatedAt
  const stamp = after.updatedAt;
  const again = markSeen(after, { now: () => 999999 });
  assert.equal(again.updatedAt, stamp, 'no change -> updatedAt untouched');
});

test('unseenCount: zero for an empty/normalized store', () => {
  assert.equal(unseenCount(undefined), 0);
  assert.equal(unseenCount({ items: [] }), 0);
});
