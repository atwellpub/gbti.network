// SOW-136: the feed-homepage helpers. Ordering, the fail-closed public-share predicate (the scoped
// SOW-018 reversal), the New & Popular ranking, tag aggregation, and relative time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedTime, sortByNewest, isPublicShare, rankNewAndPopular, aggregateTags, relativeTime, readMinutes, decodeEntities, matchesNarrow, chunkPages, newsTargetSlug, utmUrl, feedCounts, commitsHeatGrid, personalizeOrder } from '../src/lib/home-feed.mjs';

test('decodeEntities resolves numeric + common named entities in scraped share metadata', () => {
  assert.equal(decodeEntities('WordPress Down &#8211; SQL Injection'), 'WordPress Down – SQL Injection');
  assert.equal(decodeEntities('Q&amp;A &#x2014; part &quot;two&quot;'), 'Q&A — part "two"');
  assert.equal(decodeEntities('no entities'), 'no entities');
  assert.equal(decodeEntities(undefined), '');
});

test('feedCounts (sow-192): per-tab counts from the build arrays, news is null, members-only excluded', () => {
  const content = [
    { kind: 'article' }, { kind: 'article' }, { kind: 'article' },
    { kind: 'product' }, { kind: 'product' },
    { kind: 'prompt' },
  ];
  const shares = [{ kind: 'share' }, { kind: 'share' }]; // loadFeedItems() only ever puts PUBLIC shares here
  const c = feedCounts(content, shares);
  assert.equal(c.articles, 3);
  assert.equal(c.products, 2);
  assert.equal(c.prompts, 1);
  assert.equal(c.shares, 2);
  assert.equal(c.network, 6); // publications only, no shares
  assert.equal(c.all, 8); // network + shares
  assert.equal(c.news, null); // runtime worker data has no build-time count
});

test('commitsHeatGrid (sow-206): column-major weeks, fixed rolling window, quartile levels, fail-closed', () => {
  const NOW = Date.UTC(2026, 7, 12); // Wed 2026-08-12, UTC-anchored so the test is TZ-independent
  // Fail-closed: no commits -> a full `maxWeeks`-week grid of zero-level cells (a shallow clone renders empty-valid).
  const empty = commitsHeatGrid([], 53, NOW);
  assert.equal(empty.weeks.length, 53);
  assert.equal(empty.total, 0);
  assert.equal(empty.weekdayLabels[0], 'Sun');
  assert.ok(empty.weeks.every((wk) => wk.length === 7)); // every column is 7 weekdays
  // Each column is a WEEK read top-to-bottom, Sun..Sat, so consecutive days in a column are +1 day apart.
  const someWeek = empty.weeks[10].filter(Boolean);
  for (let i = 1; i < someWeek.length; i++) {
    assert.equal(Date.parse(someWeek[i].date + 'T00:00:00Z') - Date.parse(someWeek[i - 1].date + 'T00:00:00Z'), 86_400_000);
  }
  // The window is FIXED at `maxWeeks` columns ending this week (fills the container), NOT adaptive to history.
  const g = commitsHeatGrid([['2026-08-03', 6], ['2026-08-10', 2], ['2026-08-10', 3], ['bad', 1], ['2026-08-04', 'x']], 53, NOW);
  assert.equal(g.weeks.length, 53);
  const cells = g.weeks.flat().filter(Boolean);
  assert.equal(cells.find((c) => c.date === '2026-08-10').count, 5); // 2 + 3 same-day
  assert.equal(cells.find((c) => c.date === '2026-08-03').count, 6);
  assert.equal(cells.find((c) => c.date === '2026-08-04').count, 0); // 'x' count ignored, still a real 0-day
  assert.equal(g.total, 11); // malformed rows never counted
  // Future days of the current week (after NOW = Wed) are null, not zero cells.
  const lastCol = g.weeks[g.weeks.length - 1];
  assert.equal(lastCol[6], null); // Saturday is after Wednesday
  // Per-cell title carries the exact count + a human date, so accuracy is verifiable by hovering.
  assert.equal(cells.find((c) => c.date === '2026-08-10').title, '5 commits on Aug 10, 2026');
  // Quartile levels are 0..4 and 0 exactly when the day has no commits.
  assert.ok(cells.every((c) => c.level >= 0 && c.level <= 4 && (c.count === 0) === (c.level === 0)));
});

test('personalizeOrder (sow-192 Phase D): defaults to newest-first over every row', () => {
  const rows = [
    { index: 0, kind: 'article', author: 'a', tags: [], comments: 1, date: 100, read: false },
    { index: 1, kind: 'share', author: 'b', tags: [], comments: 9, date: 300, read: false },
    { index: 2, kind: 'product', author: 'a', tags: [], comments: 4, date: 200, read: true },
  ];
  assert.deepEqual(personalizeOrder(rows), [1, 2, 0]); // newest first, all visible
  assert.deepEqual(personalizeOrder([]), []);
});

test('personalizeOrder: scope=followed keeps only followed authors; hideRead + shares rules filter', () => {
  const rows = [
    { index: 0, kind: 'article', author: 'Alice', tags: [], comments: 1, date: 100, read: false },
    { index: 1, kind: 'share', author: 'Bob', tags: [], comments: 0, date: 300, read: false },
    { index: 2, kind: 'product', author: 'alice', tags: [], comments: 4, date: 200, read: true },
    { index: 3, kind: 'news', author: 'wired.com', tags: [], comments: 0, date: 400, read: false },
  ];
  // only followed 'alice' (case-insensitive) -> rows 0 and 2, newest first
  assert.deepEqual(personalizeOrder(rows, { scope: 'followed', followedAuthors: ['alice'] }), [2, 0]);
  // hide read drops row 2; drop shares drops row 1
  assert.deepEqual(
    personalizeOrder(rows, { rules: { hideRead: true, sharesInline: false } }),
    [3, 0],
  );
});

test('personalizeOrder: most-discussed order and the followed-tag boost', () => {
  const rows = [
    { index: 0, kind: 'article', author: 'a', tags: ['x'], comments: 2, date: 100 },
    { index: 1, kind: 'article', author: 'b', tags: ['mcp'], comments: 1, date: 90 },
    { index: 2, kind: 'article', author: 'c', tags: [], comments: 5, date: 80 },
  ];
  // most-discussed: comments desc -> 2 (5), 0 (2), 1 (1)
  assert.deepEqual(personalizeOrder(rows, { rules: { newestFirst: false } }), [2, 0, 1]);
  // followed tag 'mcp' floats row 1 to the top, then newest-first for the rest
  assert.deepEqual(personalizeOrder(rows, { followedTags: ['mcp'] }), [1, 0, 2]);
});

test('feedCounts tolerates empty/absent inputs and ignores unknown kinds', () => {
  const c = feedCounts();
  assert.equal(c.all, 0);
  assert.equal(c.shares, 0);
  assert.equal(c.news, null);
  const c2 = feedCounts([{ kind: 'share' }, { kind: 'weird' }, null], undefined);
  assert.equal(c2.all, 0); // a stray share/unknown in the content array is not counted as a publication
  assert.equal(c2.network, 0);
});

test('readMinutes estimates whole minutes at 220 wpm, floors at 1, 0 when empty', () => {
  assert.equal(readMinutes(''), 0);
  assert.equal(readMinutes(undefined), 0);
  assert.equal(readMinutes('a few words'), 1);
  assert.equal(readMinutes(Array(660).fill('word').join(' ')), 3);
});

test('feedTime reads publishedAt for content and createdAt for shares, 0 when undated', () => {
  assert.equal(feedTime({ publishedAt: new Date(5000) }), 5000);
  assert.equal(feedTime({ createdAt: new Date(7000) }), 7000);
  assert.equal(feedTime({ publishedAt: new Date(5000), createdAt: new Date(7000) }), 5000); // content field wins
  assert.equal(feedTime({ updatedAt: new Date(9000) }), 9000); // last resort
  assert.equal(feedTime({}), 0);
  assert.equal(feedTime(undefined), 0);
});

test('sortByNewest orders newest first, sinks undated, does not mutate', () => {
  const input = [{ id: 'old', date: 1 }, { id: 'undated' }, { id: 'new', date: 9 }];
  const out = sortByNewest(input);
  assert.deepEqual(out.map((x) => x.id), ['new', 'old', 'undated']);
  assert.deepEqual(input.map((x) => x.id), ['old', 'undated', 'new']);
});

// The fail-closed gate: ONLY published + public passes. A members share, a stub, a draft public share,
// and malformed data must all be excluded (this is the whole risk of the scoped SOW-018 reversal).
test('isPublicShare admits only published + visibility:public, fail closed', () => {
  assert.equal(isPublicShare({ status: 'published', visibility: 'public' }), true);
  assert.equal(isPublicShare({ status: 'published', visibility: 'members' }), false);
  assert.equal(isPublicShare({ status: 'published', visibility: 'members', publicStub: true }), false); // stubs stay extension-only
  assert.equal(isPublicShare({ status: 'draft', visibility: 'public' }), false);
  assert.equal(isPublicShare({ status: 'published' }), false); // schema default is members; missing = excluded
  assert.equal(isPublicShare({}), false);
  assert.equal(isPublicShare(undefined), false);
});

test('rankNewAndPopular weighs favorites 3 / comments 2 and breaks ties by recency', () => {
  const items = [
    { id: 'plain-new', date: 100 },
    { id: 'faved', date: 10, favorites: 2 }, // score 6
    { id: 'discussed', date: 50, comments: 2 }, // score 4
    { id: 'plain-old', date: 5 },
  ];
  assert.deepEqual(rankNewAndPopular(items, 3).map((x) => x.id), ['faved', 'discussed', 'plain-new']);
  // pre-launch: zero counts everywhere degrades to pure recency
  const zeros = [{ id: 'a', date: 1 }, { id: 'b', date: 3 }, { id: 'c', date: 2 }];
  assert.deepEqual(rankNewAndPopular(zeros, 2).map((x) => x.id), ['b', 'c']);
});

test('rankNewAndPopular caps each kind at maxPerKind, backfilling when kinds run out', () => {
  const items = [
    { id: 'p1', kind: 'prompt', date: 90 },
    { id: 'p2', kind: 'prompt', date: 80 },
    { id: 'p3', kind: 'prompt', date: 70 },
    { id: 'a1', kind: 'article', date: 60 },
    { id: 'pr1', kind: 'product', date: 50 },
  ];
  // the cap keeps the third prompt out while other kinds fill the grid...
  assert.deepEqual(rankNewAndPopular(items, 4, 2).map((x) => x.id), ['p1', 'p2', 'a1', 'pr1']);
  // ...but backfills past the cap when there are not enough kinds to fill n
  assert.deepEqual(rankNewAndPopular(items, 5, 2).map((x) => x.id), ['p1', 'p2', 'a1', 'pr1', 'p3']);
});

test('aggregateTags counts case-insensitively, orders by count then alphabetically, caps at n', () => {
  const items = [
    { tags: ['AI', 'mcp'] },
    { tags: ['ai', 'rag'] },
    { tags: ['ai', 'MCP', ' '] },
    { tags: undefined },
  ];
  assert.deepEqual(aggregateTags(items, 2), [{ tag: 'ai', count: 3 }, { tag: 'mcp', count: 2 }]);
  assert.deepEqual(aggregateTags(items, 9).map((t) => t.tag), ['ai', 'mcp', 'rag']);
});

test('relativeTime buckets minutes, hours, days, months, years', () => {
  const now = new Date('2026-07-21T12:00:00Z').valueOf();
  const at = (iso) => relativeTime(new Date(iso), now);
  assert.equal(at('2026-07-21T11:59:40Z'), 'just now');
  assert.equal(at('2026-07-21T11:55:00Z'), '5m ago');
  assert.equal(at('2026-07-21T09:00:00Z'), '3h ago');
  assert.equal(at('2026-07-19T12:00:00Z'), '2d ago');
  assert.equal(at('2026-03-21T12:00:00Z'), '4mo ago');
  assert.equal(at('2024-07-21T12:00:00Z'), '2y ago');
  assert.equal(relativeTime(undefined, now), '');
  assert.equal(relativeTime(new Date('2026-07-22T12:00:00Z'), now), 'just now'); // clock skew clamps to zero
});

// sow-131: the public feed narrows + the ladder pager's page chunking.
test('matchesNarrow maps the six narrows and fails closed on unknown values', () => {
  const art = { kind: 'article', author: 'alice' };
  const house = { kind: 'prompt', author: 'gbti' };
  const share = { kind: 'share', author: 'alice' };
  assert.equal(matchesNarrow(art, 'all'), true);
  assert.equal(matchesNarrow(art, 'articles'), true);
  assert.equal(matchesNarrow(art, 'products'), false);
  // owner QA 2026-07-21: network = the publications from across the whole network (no shares)
  assert.equal(matchesNarrow(house, 'network'), true);
  assert.equal(matchesNarrow(art, 'network'), true);
  assert.equal(matchesNarrow(share, 'network'), false);
  assert.equal(matchesNarrow(share, 'shares'), true);
  assert.equal(matchesNarrow(share, 'nope'), false);
  assert.equal(matchesNarrow(undefined, 'articles'), false);
  // sow-139: the News view is client-rendered from the worker; no static item matches it.
  assert.equal(matchesNarrow(art, 'news'), false);
  assert.equal(matchesNarrow(share, 'news'), false);
});

test('chunkPages splits into fixed-size pages with a short tail', () => {
  const items = [1, 2, 3, 4, 5, 6, 7];
  assert.deepEqual(chunkPages(items, 3), [[1, 2, 3], [4, 5, 6], [7]]);
  assert.deepEqual(chunkPages([], 3), []);
  assert.deepEqual(chunkPages([1], 5), [[1]]);
});

// sow-139: the news comment-thread key must stay byte-identical to client-ui/src/news.mjs so the site
// reads the thread the extension writes. Pinned values guard the port.
test('newsTargetSlug matches the client-ui implementation (pinned values)', () => {
  assert.equal(newsTargetSlug('https://pytorch.org/?p=148439'), 'news-1r5tn2pt');
  assert.equal(newsTargetSlug(''), 'news-ztntfp0');
  assert.equal(newsTargetSlug('abc'), 'news-7aigaz3');
});

// sow-145: outbound source links carry UTM attribution.
test('utmUrl appends the attribution params, preserves existing queries, falls through on non-URLs', () => {
  assert.equal(
    utmUrl('https://patchstack.com/articles/x/', { campaign: 'shares' }),
    'https://patchstack.com/articles/x/?utm_source=gbti-network&utm_medium=website&utm_campaign=shares',
  );
  assert.match(utmUrl('https://x.test/a?q=1', { campaign: 'news', medium: 'extension' }), /q=1/);
  assert.match(utmUrl('https://x.test/a?q=1', { campaign: 'news', medium: 'extension' }), /utm_medium=extension/);
  assert.equal(utmUrl('not a url', { campaign: 'shares' }), 'not a url');
  assert.equal(utmUrl('', { campaign: 'shares' }), '');
});

// sow-141 QA: the homepage news pepper. News lands after every 2nd member row (ratio 3), never exceeds
// one third of the blended feed, and degrades to no insertions when either stream is empty.
test('newsInsertionPlan peppers at 2:1 and holds the one-third cap', async () => {
  const { newsInsertionPlan } = await import('../src/lib/home-feed.mjs');
  assert.deepEqual(newsInsertionPlan(10, 60), [1, 3, 5, 7, 9]); // 5 news among 10 members = 1/3 blended
  assert.deepEqual(newsInsertionPlan(5, 60), [1, 3]);
  assert.deepEqual(newsInsertionPlan(5, 1), [1]); // news supply caps the plan
  assert.deepEqual(newsInsertionPlan(0, 60), []);
  assert.deepEqual(newsInsertionPlan(10, 0), []);
  assert.deepEqual(newsInsertionPlan(1, 60), []); // a single member row takes no news
  for (const [m, n] of [[7, 60], [30, 60], [200, 60], [9, 4]]) {
    const plan = newsInsertionPlan(m, n);
    assert.ok(plan.length <= Math.floor(m / 2), `${m}/${n} plan within the member half`);
    assert.ok(plan.length / (plan.length + m) <= 1 / 3 + 1e-9, `${m}/${n} holds the one-third cap`);
    assert.ok(plan.every((p, i) => p === 2 * (i + 1) - 1), `${m}/${n} follows the 2:1 rhythm`);
  }
});
