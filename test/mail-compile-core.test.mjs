// SOW-166: the pure compile core (normalizers + weekly issue id). The load-bearing assertion is that
// VISIBILITY SURVIVES the type->kind mapping, proven end to end through composeIssue's fail-closed guard, not
// just by reading the field back. No hearts (they do not exist as data); news normalizes the wired opens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContent, normalizeContentEntry, normalizeNews, normalizeNewsEntry, weeklyIssueId } from '../membership/mail-compile-core.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';

const at = (t) => () => t;

test('type -> kind: post->article, product->product, prompt->prompt, share->share; unknown -> null', () => {
  const k = (type) => normalizeContentEntry({ type, title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'public' })?.kind;
  assert.equal(k('post'), 'article');
  assert.equal(k('product'), 'product');
  assert.equal(k('prompt'), 'prompt');
  assert.equal(k('share'), 'share');
  assert.equal(normalizeContentEntry({ type: 'news', title: 't', url: '/u/', visibility: 'public' }), null, 'an unmapped type is dropped');
  assert.equal(normalizeContentEntry(null), null);
});

test('visibility is copied VERBATIM (public stays public, members stays members)', () => {
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'public' }).visibility, 'public');
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'members' }).visibility, 'members');
  // a missing visibility stays undefined (NOT defaulted to public) so composeIssue's fail-closed guard drops it
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1 }).visibility, undefined);
});

test('date maps from publishedAt; a missing/NaN date becomes 0', () => {
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 42, visibility: 'public' }).date, 42);
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: null, visibility: 'public' }).date, 0);
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', visibility: 'public' }).date, 0);
});

test('authorName resolves via the injected displayName; absent it is null', () => {
  const names = { ann: 'Ann Author', atwellpub: 'Hudson Atwell' };
  const e = { type: 'post', title: 't', url: '/u/', author: 'atwellpub', publishedAt: 1, visibility: 'public' };
  assert.equal(normalizeContentEntry(e, { displayName: (h) => names[h] }).authorName, 'Hudson Atwell');
  assert.equal(normalizeContentEntry(e).authorName, null, 'no resolver -> null, renderer falls back to the handle');
  assert.equal(normalizeContentEntry({ ...e, author: 'unknown' }, { displayName: (h) => names[h] }).authorName, null);
});

test('normalizeContent maps a mixed list and drops unknown types', () => {
  const out = normalizeContent([
    { type: 'post', title: 'P', url: '/a/', author: 'a', publishedAt: 3, visibility: 'public' },
    { type: 'share', title: 'S', url: '/shares/a/1/', author: 'a', publishedAt: 2, visibility: 'public' },
    { type: 'mystery', title: 'X', url: '/x/', visibility: 'public' },
    null,
  ]);
  assert.deepEqual(out.map((o) => o.kind), ['article', 'share']);
  assert.equal(normalizeContent(null).length, 0);
});

// The property that matters: the normalizer does NOT filter public-vs-member (one guard, in composeIssue).
// It must preserve visibility so composeIssue's fail-closed guard can drop the member item. If visibility were
// dropped or defaulted, either a member item would leak or the whole section would silently empty.
test('VISIBILITY SURVIVES end to end: composeIssue drops the members item the normalizer passed through', () => {
  const items = normalizeContent([
    { type: 'post', slug: 'x', title: 'Public one', url: '/articles/x/', author: 'ann', publishedAt: 5, visibility: 'public' },
    { type: 'post', slug: 'y', title: 'Members stub', url: '/articles/y/', author: 'ann', publishedAt: 6, visibility: 'members' },
  ]);
  assert.equal(items.find((i) => i.title === 'Members stub').visibility, 'members', 'normalizer preserved it (did not filter)');
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1000) });
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Public one'], 'composeIssue dropped the members item, kept the public one');
});

test('normalizeNewsEntry: opens/date default 0, blank source is null, missing title or url drops the item', () => {
  assert.deepEqual(
    normalizeNewsEntry({ title: 'N', url: 'https://n/x', source: 'Src', opens: 9, date: 7 }),
    { title: 'N', url: 'https://n/x', source: 'Src', opens: 9, date: 7 },
  );
  assert.deepEqual(
    normalizeNewsEntry({ title: 'N', url: 'https://n/x' }),
    { title: 'N', url: 'https://n/x', source: null, opens: 0, date: 0 },
  );
  assert.equal(normalizeNewsEntry({ url: 'https://n/x' }), null, 'no title -> dropped');
  assert.equal(normalizeNewsEntry({ title: 'N' }), null, 'no url -> dropped');
  assert.equal(normalizeNews(null).length, 0);
  // NO fabricated `comments`: the discussion-count field arrives only when a real gather populates it.
  assert.equal('comments' in normalizeNewsEntry({ title: 'N', url: 'https://n/x' }), false);
});

test('weeklyIssueId is a stable weekly-YYYY-MM-DD in UTC, idempotent same-day, and throws on a bad time', () => {
  const t = Date.UTC(2026, 7, 25, 13, 0, 0); // 2026-08-25 13:00 UTC (a Tuesday)
  assert.equal(weeklyIssueId(t), 'weekly-2026-08-25');
  assert.equal(weeklyIssueId(t + 6 * 3600 * 1000), 'weekly-2026-08-25', 'same UTC day -> same id (idempotent re-run)');
  assert.throws(() => weeklyIssueId(NaN), /finite timestamp/);
  assert.throws(() => weeklyIssueId('nope'), /finite timestamp/);
});
