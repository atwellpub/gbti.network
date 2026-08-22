// SOW-046 (B/E): the pure member-prefs core (membership/member-prefs.mjs) — categories + followed news channels,
// normalize/apply with dedupe + caps + validation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePrefs, applyPrefs, PrefsError } from '../membership/member-prefs.mjs';

test('normalizePrefs: always returns arrays, deduped (case-insensitive), tolerant of junk', () => {
  assert.deepEqual(normalizePrefs(null), { categories: [], followedChannels: [], publicFavorites: false });
  const p = normalizePrefs({ categories: ['AI', 'ai', 'devops', ''], followedChannels: ['bleeping-computer', 'Bleeping-Computer', 123] });
  assert.deepEqual(p.categories, ['AI', 'devops']); // 'ai' deduped against 'AI'
  assert.deepEqual(p.followedChannels, ['bleeping-computer']); // dup folded, non-string dropped
});

test('applyPrefs: replace categories', () => {
  const p = applyPrefs({ categories: ['old'] }, { categories: ['ai', 'security'] });
  assert.deepEqual(p.categories, ['ai', 'security']);
  assert.throws(() => applyPrefs({}, { categories: 'nope' }), PrefsError);
});

test('applyPrefs: follow + unfollow a channel (idempotent)', () => {
  let p = applyPrefs({}, { followChannel: { id: 'bleeping-computer', on: true } });
  assert.deepEqual(p.followedChannels, ['bleeping-computer']);
  // re-follow -> no dup
  p = applyPrefs(p, { followChannel: { id: 'Bleeping-Computer', on: true } });
  assert.deepEqual(p.followedChannels, ['bleeping-computer']);
  // unfollow (case-insensitive)
  p = applyPrefs(p, { followChannel: { id: 'BLEEPING-COMPUTER', on: false } });
  assert.deepEqual(p.followedChannels, []);
  // unfollow a non-followed -> no-op
  assert.deepEqual(applyPrefs(p, { followChannel: { id: 'x', on: false } }).followedChannels, []);
});

test('applyPrefs: an invalid channel id throws; categories + channels coexist', () => {
  assert.throws(() => applyPrefs({}, { followChannel: { id: '', on: true } }), PrefsError);
  assert.throws(() => applyPrefs({}, { followChannel: { id: '../evil', on: true } }), PrefsError);
  const p = applyPrefs({ categories: ['ai'] }, { followChannel: { id: 'sdtimes', on: true } });
  assert.deepEqual(p.categories, ['ai']);
  assert.deepEqual(p.followedChannels, ['sdtimes']);
});

// SOW-114: the publicFavorites opt-in (default OFF; strictly boolean; erasure-friendly like the rest).
test('publicFavorites: defaults false, normalizes strictly, applies as a boolean patch only', () => {
  assert.equal(normalizePrefs({}).publicFavorites, false);
  assert.equal(normalizePrefs({ publicFavorites: 'yes' }).publicFavorites, false); // truthy junk never opts in
  assert.equal(normalizePrefs({ publicFavorites: true }).publicFavorites, true);
  const on = applyPrefs(null, { publicFavorites: true });
  assert.equal(on.publicFavorites, true);
  assert.deepEqual(on.categories, []); // untouched fields keep their shape
  const off = applyPrefs(on, { publicFavorites: false });
  assert.equal(off.publicFavorites, false);
  // A patch without the field leaves the stored value alone.
  assert.equal(applyPrefs(on, { categories: ['ai'] }).publicFavorites, true);
  assert.throws(() => applyPrefs(null, { publicFavorites: 'on' }), PrefsError);
});

test('applyPrefs: the categories cap is 200 (raised for the topic picker Select all; 85 topics today)', () => {
  const many = Array.from({ length: 250 }, (_v, i) => `topic-${i}`);
  const p = applyPrefs({}, { categories: many });
  assert.equal(p.categories.length, 200);
  assert.equal(p.categories[0], 'topic-0');
});

// SOW-186 phase 1: the global notification-defaults matrix (falls back to the system default when absent).
test('notify: absent by default, so the record shape is unchanged for a member who never set it', () => {
  assert.deepEqual(normalizePrefs(null), { categories: [], followedChannels: [], publicFavorites: false });
  assert.ok(!('notify' in normalizePrefs({ categories: ['ai'] })), 'no notify key unless set');
});

test('notify: normalizePrefs keeps a well-formed matrix and drops garbage', () => {
  const p = normalizePrefs({ notify: { article: { email: true }, prompt: { api: false }, bad: 'x' } });
  assert.deepEqual(p.notify, { article: { email: true }, prompt: { api: false } });
  assert.ok(!('notify' in normalizePrefs({ notify: { article: { email: 'yes' } } })), 'all-garbage -> no notify key');
});

test('notify: applyPrefs sets, replaces and clears the global matrix without touching other fields', () => {
  let p = applyPrefs({ categories: ['ai'] }, { notify: { article: { email: true } } });
  assert.deepEqual(p.notify, { article: { email: true } });
  assert.deepEqual(p.categories, ['ai'], 'other fields untouched');
  // replace
  p = applyPrefs(p, { notify: { share: { api: true, email: true } } });
  assert.deepEqual(p.notify, { share: { api: true, email: true } });
  // clear with null, and with {}
  assert.ok(!('notify' in applyPrefs(p, { notify: null })), 'null clears the matrix');
  assert.ok(!('notify' in applyPrefs(p, { notify: {} })), 'an empty matrix clears it');
  // a patch without notify leaves the stored matrix alone
  assert.deepEqual(applyPrefs(p, { categories: ['x'] }).notify, { share: { api: true, email: true } });
});

test('notify: applyPrefs rejects a non-object notify patch (array or scalar)', () => {
  assert.throws(() => applyPrefs({}, { notify: 'nope' }), PrefsError);
  assert.throws(() => applyPrefs({}, { notify: ['article'] }), PrefsError);
  assert.throws(() => applyPrefs({}, { notify: 5 }), PrefsError);
});
