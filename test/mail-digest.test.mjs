// SOW-166: the pure digest composition core. No network, injected `now`. The leak guard is the load-bearing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeIssue, hasContent, issueKey, isPublicItem, SECTION_KINDS, DigestError,
  SECTION_ORDER, SECTION_LABELS, EMPTY_SECTION_NOTES, shouldSend,
  FIRST_ISSUE_NOTE, FIRST_ISSUE_SECTION_NOTES,
} from '../membership/mail-digest.mjs';

// The injected clock. It must sit AFTER every fixture date in a test: an item reaches the artifact only once
// it is published, so a compile that predates its own items cannot occur, and composeIssue now enforces that
// by withholding anything not yet due. Fixtures written before that used at(1) freely; they were modelling an
// impossible world and passing for the wrong reason.
const at = (t) => () => t;
const pub = (kind, title, date, extra = {}) => ({ kind, title, url: `https://gbti.network/${kind}/${title}`, author: 'alice', date, visibility: 'public', ...extra });

test('issueKey builds the KV key and rejects a blank id', () => {
  assert.equal(issueKey('2026-08-18'), 'mail:issue:2026-08-18');
  assert.throws(() => issueKey(''), DigestError);
});

test('composeIssue groups public items by kind, newest-first, capped per section', () => {
  const items = [
    pub('article', 'a-old', 100), pub('article', 'a-new', 300), pub('article', 'a-mid', 200),
    pub('product', 'p1', 50), pub('prompt', 'q1', 10), pub('share', 's1', 5),
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(999) }, { perSection: 2 });
  assert.equal(issue.generatedAt, 999);
  assert.deepEqual(issue.sections.article.map((x) => x.title), ['a-new', 'a-mid']); // newest first, capped at 2
  assert.equal(issue.sections.product.length, 1);
  assert.equal(issue.counts.article, 2);
  assert.equal(issue.isEmpty, false);
  assert.ok(SECTION_KINDS.every((k) => Array.isArray(issue.sections[k])));
});

// sow-166, 2026-08-23. THE UNDATED-ITEM TRAP, pinned so it cannot quietly come back.
//
// `publishedAt` was optional in every content schema, so an item could publish without one. A missing date
// normalizes to 0, and 0 is below EVERY time floor, so the item is silently unmailable forever rather than
// merely late. It also sorts dead last in `buildActivityIndex`, which caps at 40 per type, so once a type has
// more than 40 items an undated one is cut from the public index entirely while its page stays live.
//
// Live consequences, both reported by the owner: the Ryker product (11 products, under the cap) sat in the
// index with date 0 and could never be mailed; three published articles (50 posts, over the cap) were absent
// from the index, the extension feed and the digest altogether.
//
// The real repair is upstream: scripts/validate-content.mjs now REJECTS a published post/product/prompt with
// no publishedAt, so this state cannot be authored. This test pins the downstream behaviour that makes that
// rule load-bearing. If someone ever relaxes the validator, this is the explanation of what it costs.
test('an item with no date is excluded by any floor (why publishedAt is required at authoring time)', () => {
  const floor = 1_000;
  const items = [pub('product', 'dated', floor + 500), { ...pub('product', 'undated', 0), date: 0 }];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(floor + 900) }, { perSection: 5, since: floor });
  assert.deepEqual(issue.sections.product.map((x) => x.title), ['dated']);
  // And it is not the floor alone: no floor a live compile can pick is at or below 0.
  const noFloor = composeIssue({ issueId: 'i', items, news: [], now: at(floor + 900) }, { perSection: 5 });
  assert.ok(noFloor.sections.product.some((x) => x.title === 'undated'), 'with NO floor it would have been included, so the floor is what drops it');
});

test('LEAK GUARD: a members item is excluded and no body/ciphertext can appear in a compiled issue', () => {
  const items = [
    pub('article', 'public-one', 100, { body: 'PUBLIC BODY TEXT', encryptedBody: 'x.enc' }),
    { kind: 'article', title: 'MEMBER ONLY', url: 'https://gbti.network/secret', author: 'bob', date: 200, visibility: 'members', body: 'SECRET MEMBER BODY', encryptedBody: 'members/bob/_enc/s.enc' },
    { kind: 'share', title: 'no-visibility', url: 'https://x', author: 'c', date: 50 }, // missing visibility -> excluded
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) });
  // only the public article survives
  assert.equal(issue.sections.article.length, 1);
  assert.equal(issue.sections.article[0].title, 'public-one');
  assert.equal(issue.sections.share.length, 0); // the no-visibility share failed closed
  const serialized = JSON.stringify(issue);
  assert.ok(!serialized.includes('MEMBER ONLY'), 'a members item title must not appear');
  assert.ok(!serialized.includes('SECRET MEMBER BODY'));
  assert.ok(!serialized.includes('PUBLIC BODY TEXT'), 'even a public items body is not copied (projection)');
  assert.ok(!serialized.includes('.enc'));
  // the surviving item has ONLY public-safe fields
  assert.deepEqual(Object.keys(issue.sections.article[0]).sort(), ['author', 'authorName', 'blurb', 'date', 'kind', 'thumb', 'title', 'url']); // + blurb/thumb (sow-166, 2026-08-23). Still an EXACT list, so a third field fails right here
});

test('isPublicItem fails closed on missing/other visibility', () => {
  assert.equal(isPublicItem({ visibility: 'public' }), true);
  assert.equal(isPublicItem({ visibility: 'members' }), false);
  assert.equal(isPublicItem({}), false);
  assert.equal(isPublicItem(null), false);
});

test('news is ranked by distinct-opener count, then newest, and capped', () => {
  const news = [
    { title: 'low', url: 'https://n/low', opens: 2, date: 900 },
    { title: 'high', url: 'https://n/high', opens: 50, date: 100 },
    { title: 'mid-a', url: 'https://n/ma', opens: 10, date: 100 },
    { title: 'mid-b', url: 'https://n/mb', opens: 10, date: 500 }, // same opens, newer -> ahead of mid-a
  ];
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { maxNews: 3 });
  assert.deepEqual(issue.topNews.map((n) => n.title), ['high', 'mid-b', 'mid-a']); // opens desc, date breaks ties
  assert.equal(issue.topNews.length, 3); // capped
  assert.deepEqual(Object.keys(issue.topNews[0]).sort(), ['blurb', 'date', 'opens', 'source', 'sourceName', 'thumb', 'title', 'url']);
});

test('empty-week policy: skip only when member AND news are both empty; else top-news-only still sends', () => {
  // both empty -> isEmpty, the compile cron skips
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) });
  assert.equal(dead.isEmpty, true);
  assert.equal(hasContent(dead), false);
  // no member content but news present -> a top-news-only issue that still sends
  const newsOnly = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n', opens: 1 }], now: at(1_000_000) });
  assert.equal(newsOnly.isEmpty, false);
  assert.equal(newsOnly.counts.news, 1);
  assert.equal(hasContent(newsOnly), true);
  // member content but no news -> sends
  const memberOnly = composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news: [] }, {});
  assert.equal(memberOnly.isEmpty, false);
});

test('items with no title or url are dropped as unrenderable', () => {
  const items = [
    { kind: 'article', title: '', url: 'https://x', author: 'a', date: 1, visibility: 'public' },
    { kind: 'article', title: 'ok', url: '', author: 'a', date: 1, visibility: 'public' },
    pub('article', 'good', 1),
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) });
  assert.deepEqual(issue.sections.article.map((x) => x.title), ['good']);
});

test('an unknown kind does not crash and does not land in a section', () => {
  const items = [{ kind: 'video', title: 'v', url: 'https://v', author: 'a', date: 1, visibility: 'public' }, pub('article', 'a', 2)];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) });
  assert.equal(issue.counts.article, 1);
  assert.equal(issue.counts.product + issue.counts.prompt + issue.counts.share, 0);
});

// ---- sow-166 content contract (owner ruling 2026-08-21): always send, every section present, note the gaps.

test('layout carries EVERY section every week, filled ones first, in canonical order', () => {
  const items = [pub('prompt', 'p1', 300), pub('share', 's1', 200)];
  const news = [{ title: 'n', url: 'https://n/1', opens: 5, date: 100 }];
  const issue = composeIssue({ issueId: 'i', items, news, now: at(1_000_000) });

  // nothing is ever dropped: all five, exactly once each
  assert.deepEqual(issue.layout.map((s) => s.key).sort(), [...SECTION_ORDER].sort());
  assert.equal(issue.layout.length, SECTION_ORDER.length);

  // filled first, then the empty ones. News TRAILS the filled group (owner ruling 2026-08-23): it used to lead
  // it, which put curated third-party links above everything the members wrote.
  assert.deepEqual(issue.layout.map((s) => s.key), ['prompt', 'share', 'news', 'article', 'product']);
  assert.deepEqual(issue.layout.filter((s) => !s.empty).map((s) => s.key), ['prompt', 'share', 'news']);
});

test('the relative order inside each group is stable, so a section does not move week to week', () => {
  const rank = (key) => SECTION_ORDER.indexOf(key);
  for (const items of [[], [pub('article', 'a', 1)], [pub('share', 's', 1), pub('product', 'p', 2)]]) {
    const layout = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) }).layout;
    const filled = layout.filter((s) => !s.empty).map((s) => rank(s.key));
    const empty = layout.filter((s) => s.empty).map((s) => rank(s.key));
    assert.deepEqual(filled, [...filled].sort((a, b) => a - b), 'filled group out of canonical order');
    assert.deepEqual(empty, [...empty].sort((a, b) => a - b), 'empty group out of canonical order');
  }
});

test('an empty section carries its note and a filled one carries none', () => {
  const issue = composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news: [], now: at(1_000_000) });
  const bySection = Object.fromEntries(issue.layout.map((s) => [s.key, s]));

  assert.equal(bySection.article.empty, false);
  assert.equal(bySection.article.note, null, 'a section with items must not carry an empty note');

  for (const key of ['news', 'product', 'prompt', 'share']) {
    assert.equal(bySection[key].empty, true);
    assert.equal(bySection[key].note, EMPTY_SECTION_NOTES[key]);
    assert.ok(bySection[key].note.length > 0, `${key} note is blank`);
  }
});

test('every section in the order has a label and a note defined, so none can render nameless', () => {
  for (const key of SECTION_ORDER) {
    assert.ok(SECTION_LABELS[key], `no label for ${key}`);
    assert.ok(EMPTY_SECTION_NOTES[key], `no empty note for ${key}`);
  }
  // the notes are member-facing copy: the house style bans em and en dashes in anything a reader sees
  for (const [key, note] of Object.entries(EMPTY_SECTION_NOTES)) {
    assert.ok(!/[\u2013\u2014]/.test(note), `${key} note contains an em or en dash`);
  }
  // four of these can appear together on a thin week; identical phrasing reads as filler
  const memberNotes = ['article', 'product', 'prompt', 'share'].map((k) => EMPTY_SECTION_NOTES[k]);
  assert.equal(new Set(memberNotes).size, memberNotes.length, 'empty-section notes must not repeat');
});

test('the notes are anchored to the cadence, not to the reading date', () => {
  // The issue is frozen once and the send smooths across a rate budget, so the last recipient may open it
  // days after the first. Copy that says "this week" is true on Tuesday and drifts for everyone behind them.
  for (const [key, note] of Object.entries(EMPTY_SECTION_NOTES)) {
    assert.ok(!/\bthis week\b/i.test(note), `${key} note is anchored to the reading date ("this week")`);
    assert.ok(!/\b(today|yesterday|tomorrow|right now)\b/i.test(note), `${key} note uses a reading-date anchor`);
    assert.match(note, /since the last issue/i, `${key} note should anchor to the issue cadence`);
  }
});

test('the notes are plain sentences a table-based HTML email can render', () => {
  // The renderer is a branded but conservative table email. Markdown would reach the reader literally.
  for (const [key, note] of Object.entries(EMPTY_SECTION_NOTES)) {
    assert.ok(!/[*_`~]|\[[^\]]*\]\(/.test(note), `${key} note contains markdown the email would show literally`);
    assert.ok(!/<[a-z/]/i.test(note), `${key} note contains raw HTML`);
    assert.equal(note, note.trim(), `${key} note has stray whitespace`);
    assert.match(note, /\.$/, `${key} note should be a complete sentence`);
  }
});

test('LEAK GUARD holds through layout: a members item reaches no section and no body field appears', () => {
  const items = [
    pub('article', 'public-one', 200),
    { kind: 'article', title: 'secret', url: 'https://x/s', author: 'bob', date: 300, visibility: 'members', body: 'SECRET BODY' },
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) });
  const serialized = JSON.stringify(issue);
  assert.ok(!serialized.includes('SECRET BODY'), 'a member body reached the compiled issue');
  assert.ok(!serialized.includes('secret'), 'a member item title reached the compiled issue');
  for (const section of issue.layout) {
    for (const it of section.items) {
      assert.deepEqual(Object.keys(it).sort(), ['author', 'authorName', 'blurb', 'date', 'kind', 'thumb', 'title', 'url']);
    }
  }
});

test('a thin member week can lift the news cap, but only when asked, and never past an explicit max', () => {
  const news = Array.from({ length: 10 }, (_, i) => ({ title: `n${i}`, url: `https://n/${i}`, opens: 10 - i, date: i }));

  // unset: no lift, so maxNews stays a real ceiling (this is the trap the cap test caught)
  assert.equal(composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { maxNews: 3 }).topNews.length, 3);

  // opted in, and the member week is empty: the lift applies
  assert.equal(
    composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { maxNews: 3, maxNewsThin: 8 }).topNews.length, 8);

  // opted in, but a member item exists: normal cap, because the lift is for thin weeks only
  assert.equal(
    composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news, now: at(1_000_000) }, { maxNews: 3, maxNewsThin: 8 })
      .topNews.length, 3);

  // a thin cap BELOW the normal one can only ever raise, never shorten a news-led issue
  assert.equal(
    composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { maxNews: 5, maxNewsThin: 2 }).topNews.length, 5);
});

test('shouldSend is the gate and it is unconditional (owner ruling 2026-08-21)', () => {
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) });
  const thin = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n/1', opens: 1, date: 1 }], now: at(1_000_000) });
  const full = composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news: [], now: at(1_000_000) });
  for (const issue of [dead, thin, full]) assert.equal(shouldSend(issue), true);
  // and it does not depend on being handed a well-formed issue at all
  assert.equal(shouldSend(undefined), true);
});

test('hasContent stays HONEST, so it can still tell an empty issue from a full one', () => {
  // It is no longer the gate, but the subject line and the logs read it, and a predicate that answered
  // "yes" for an empty issue would mislead them.
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) });
  assert.equal(dead.isEmpty, true);
  assert.equal(hasContent(dead), false);
  const alive = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n/1', opens: 1, date: 1 }], now: at(1_000_000) });
  assert.equal(hasContent(alive), true);
});

test('a fully empty issue is still SHAPED, so always-send never renders a special case', () => {
  // The owner's ground for always-send is that news ingests daily, so this state should not occur. That is a
  // fact about the ingest running, not a property of the composer, so the shape is pinned here: if the news
  // worker is ever down for a week the renderer still gets five labelled sections with notes, not a hole.
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) });
  assert.equal(dead.layout.length, SECTION_ORDER.length);
  assert.deepEqual(dead.layout.map((s) => s.key), SECTION_ORDER, 'canonical order when nothing is filled');
  assert.ok(dead.layout.every((s) => s.empty && s.note && s.label));
  assert.deepEqual(dead.topNews, []);
  for (const k of SECTION_KINDS) assert.deepEqual(dead.sections[k], []);
});

test('WINDOW: `since` keeps what is new and drops what is old, both proven in one call', () => {
  // Positive AND negative control together on purpose. A window test that only asserts the old item is gone
  // passes just as well against a function that drops EVERYTHING, which is the same guards-passing-on-zero
  // shape that made an earlier verification of the shares artifact vacuous.
  const items = [
    pub('article', 'published-after-the-last-issue', 2_000),
    pub('article', 'published-before-the-last-issue', 500),
    pub('product', 'old-product', 400),
    pub('share', 'brand-new-share', 3_000),
  ];
  // `now` sits AFTER every fixture date on purpose: an item reaches the artifact only once it is published, so
  // a compile that predates its own items is a world that cannot occur, and the future-date clamp says so.
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(9_000) }, { since: 1_000 });

  assert.deepEqual(issue.sections.article.map((x) => x.title), ['published-after-the-last-issue'], 'the new one survives');
  assert.deepEqual(issue.sections.share.map((x) => x.title), ['brand-new-share']);
  assert.deepEqual(issue.sections.product, [], 'the old one is dropped');
  assert.equal(issue.counts.article, 1);
  assert.equal(issue.counts.product, 0);
});

test('WINDOW: the boundary is inclusive, so an item never falls between two issues', () => {
  // An item published at the exact instant of the previous compile has to land in exactly one issue. If the
  // boundary excluded it, next week's window starts later still and the item is lost for good.
  const onTheBoundary = composeIssue(
    { issueId: 'i', items: [pub('article', 'exactly-at-the-cutoff', 1_000)], news: [], now: at(9_000) },
    { since: 1_000 },
  );
  assert.equal(onTheBoundary.counts.article, 1);
  const justUnder = composeIssue(
    { issueId: 'i', items: [pub('article', 'one-tick-earlier', 999)], news: [], now: at(9_000) },
    { since: 1_000 },
  );
  assert.equal(justUnder.counts.article, 0);
});

test('WINDOW: this is what makes an empty-section note reachable at all', () => {
  // The point of the whole option. The same site, the same artifact, one quiet week: unwindowed it re-sends
  // last week's article as if it were new and the note never renders; windowed the section is empty and the
  // invitation appears. If this ever fails, the section contract is decorative.
  const backCatalogue = [pub('article', 'written-months-ago', 100), pub('prompt', 'also-old', 90)];

  const unwindowed = composeIssue({ issueId: 'i', items: backCatalogue, news: [], now: at(1_000_000) });
  const staleArticles = unwindowed.layout.find((s) => s.key === 'article');
  assert.equal(staleArticles.empty, false, 'without a window the back catalogue fills the section');
  assert.equal(staleArticles.note, null, 'so the invitation never renders');

  const windowed = composeIssue({ issueId: 'i', items: backCatalogue, news: [], now: at(1_000_000) }, { since: 1_000 });
  const freshArticles = windowed.layout.find((s) => s.key === 'article');
  assert.equal(freshArticles.empty, true);
  assert.equal(freshArticles.note, EMPTY_SECTION_NOTES.article);
  assert.equal(windowed.isEmpty, true, 'nothing new and no news is a genuinely empty week');
});

test('WINDOW: an undated item is never new', () => {
  // date 0 is what the normalizer emits for a missing publishedAt. Treating "no date" as "brand new" would put
  // every dateless entry into every issue forever.
  const issue = composeIssue(
    { issueId: 'i', items: [pub('article', 'no-date', 0)], news: [], now: at(1_000_000) },
    { since: 1_000 },
  );
  assert.equal(issue.counts.article, 0);
  // ...but with no window it still renders, because that is the pre-window behaviour and it is unchanged.
  const unwindowed = composeIssue({ issueId: 'i', items: [pub('article', 'no-date', 0)], news: [], now: at(1_000_000) });
  assert.equal(unwindowed.counts.article, 1);
});

test('WINDOW: news is deliberately NOT windowed, and the issue records the window it used', () => {
  const news = [{ title: 'opened-all-week', url: 'https://n/1', opens: 40, date: 10 }];
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { since: 5_000 });
  assert.equal(issue.counts.news, 1, 'ranked by openers, not recency, so an older story still leads');
  assert.deepEqual(issue.window, { since: 5_000, excluded: null, appliesTo: 'members' });

  // A compile that forgot the window says so in the stored artifact rather than looking identical to one
  // that meant it. `since: null` in KV is the tell.
  const forgot = composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) });
  assert.equal(forgot.window.since, null);
  // Garbage is treated as no window rather than as 0, which would silently window nothing while looking set.
  for (const bad of ['soon', NaN, Infinity, undefined, null, {}]) {
    assert.equal(composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { since: bad }).window.since, null, `since: ${String(bad)}`);
  }
});

test('EXCLUDE: an already-mailed item is dropped and an unmailed one is kept, both in one call', () => {
  // The positive control is the whole point here. An exclude test that only proves the mailed item is gone
  // passes against a filter that drops everything, and that failure would empty every issue after the first.
  const items = [
    pub('article', 'mailed-last-week', 5_000),
    pub('article', 'never-mailed', 4_000),
    pub('share', 'also-never-mailed', 3_000),
  ];
  const exclude = new Set([`https://gbti.network/article/mailed-last-week`]);
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) }, { exclude });

  assert.deepEqual(issue.sections.article.map((x) => x.title), ['never-mailed']);
  assert.deepEqual(issue.sections.share.map((x) => x.title), ['also-never-mailed']);
  assert.equal(issue.window.excluded, 1);
});

test('EXCLUDE: it rescues the item `since` loses, which is the entire reason it exists', () => {
  // The held-contribution case. publishedAt is stamped when the PR is OPENED, so a contribution held for the
  // folder owner's review carries a date from BEFORE the last compile and only reaches the artifact after it.
  // Under a window it is dropped forever and nobody is told. Under the already-mailed set it goes out late.
  const heldContribution = pub('article', 'reviewed-slowly', 500); // published before the last compile
  const lastCompile = 1_000;

  const windowed = composeIssue(
    { issueId: 'i', items: [heldContribution], news: [], now: at(1_000_000) },
    { since: lastCompile },
  );
  assert.equal(windowed.counts.article, 0, 'the window loses it');

  const bySentSet = composeIssue(
    { issueId: 'i', items: [heldContribution], news: [], now: at(1_000_000) },
    { exclude: new Set(['https://gbti.network/article/something-else']) },
  );
  assert.equal(bySentSet.counts.article, 1, 'the already-mailed set does not');
  assert.equal(bySentSet.sections.article[0].title, 'reviewed-slowly');

  // And stacking them re-opens the loss, which is why the regimes are documented as either/or.
  const stacked = composeIssue(
    { issueId: 'i', items: [heldContribution], news: [], now: at(1_000_000) },
    { since: lastCompile, exclude: new Set() },
  );
  assert.equal(stacked.counts.article, 0, 'both filters apply independently');
});

test('EXCLUDE: an empty set is a real answer and a missing one is not, so they must not look alike', () => {
  const items = [pub('article', 'a', 10)];
  const firstIssue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) }, { exclude: new Set() });
  assert.equal(firstIssue.counts.article, 1);
  assert.equal(firstIssue.window.excluded, 0, 'an empty set records 0');

  const forgot = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) });
  assert.equal(forgot.window.excluded, null, 'a forgotten set records null, so KV shows which happened');
});

test('EXCLUDE: takes an array as readily as a Set, and ignores what is not a url collection', () => {
  const items = [pub('article', 'kept', 10), pub('article', 'dropped', 20)];
  const viaArray = composeIssue(
    { issueId: 'i', items, news: [], now: at(1_000_000) },
    { exclude: ['https://gbti.network/article/dropped'] },
  );
  assert.deepEqual(viaArray.sections.article.map((x) => x.title), ['kept']);

  // A string is iterable and would otherwise become a set of single characters, excluding nothing while
  // looking set. Anything that is not a url collection means no exclusion, never a partial one.
  for (const bad of ['https://gbti.network/article/dropped', 42, {}, true]) {
    const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1_000_000) }, { exclude: bad });
    assert.equal(issue.counts.article, 2, `exclude: ${String(bad)} must not filter`);
    assert.equal(issue.window.excluded, null);
  }
});

test('EXCLUDE: news is untouched by it, the same as the window', () => {
  const news = [{ title: 'still-the-top-story', url: 'https://n/1', opens: 40, date: 10 }];
  const issue = composeIssue(
    { issueId: 'i', items: [], news, now: at(1_000_000) },
    { exclude: new Set(['https://n/1']) },
  );
  assert.equal(issue.counts.news, 1, 'news ranks by openers and is bounded by its gather, not by this');
  assert.equal(issue.window.appliesTo, 'members');
});

test('LAUNCH ISSUE: nothing below the line says "since the last issue" to somebody reading their first', () => {
  const issue = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) }, { firstIssue: true });
  assert.equal(issue.launchNote, FIRST_ISSUE_NOTE);
  for (const section of issue.layout) {
    assert.ok(section.note, `${section.key} still carries a note`);
    assert.doesNotMatch(section.note, /last issue/i, `${section.key} must not reference an issue that never existed`);
    assert.match(section.note, /in the past 90 days/i, `${section.key} names the span it actually covers`);
  }
});

test('LAUNCH ISSUE: every issue after it is untouched, which is the half that runs 51 weeks a year', () => {
  const issue = composeIssue({ issueId: 'i', items: [], news: [], now: at(1_000_000) });
  assert.equal(issue.launchNote, null, 'the template renders the line by its presence, so absence must be null');
  for (const section of issue.layout) assert.match(section.note, /since the last issue/i);
});

test('LAUNCH ISSUE: the derived notes cannot drift from the ones they are derived from', () => {
  // Derived rather than hand-written twice, so this asserts the derivation actually fired for every key
  // instead of silently returning the original. A no-op replace is the failure mode of a derived table.
  assert.deepEqual(Object.keys(FIRST_ISSUE_SECTION_NOTES).sort(), Object.keys(EMPTY_SECTION_NOTES).sort());
  for (const [key, note] of Object.entries(FIRST_ISSUE_SECTION_NOTES)) {
    assert.notEqual(note, EMPTY_SECTION_NOTES[key], `${key} must actually differ from the standing copy`);
    assert.doesNotMatch(note, /last issue/i);
    // Only the cadence clause moves. The invitation each note carries is copy the owner reviewed, and a
    // substitution that ate any of it would be a silent rewrite.
    assert.equal(note, EMPTY_SECTION_NOTES[key].replace('since the last issue', 'in the past 90 days'));
  }
});

test('the empty-section notes carry an INVITATION, which is the whole reason they exist', () => {
  // The same tautological gap as the launch line, found by the same audit. Every other assertion about these
  // notes either restates the constant or checks the cadence clause, so deleting all four invitation halves
  // left the suite fully green. The owner's ruling was that an empty section renders a note "because a visible
  // gap is an invitation to fill it": a note that states the absence and stops is the version they rejected.
  //
  // Pinned by SUBSTANCE (a second sentence beyond the bare statement) rather than by exact wording, so the
  // copy can be rewritten freely and only fails by losing the invitation itself.
  const sentences = (note) => note.split(/(?<=\.)\s+/).filter(Boolean);
  for (const kind of SECTION_KINDS) {
    assert.ok(
      sentences(EMPTY_SECTION_NOTES[kind]).length >= 2,
      `${kind} note states the absence and then invites; it currently only states it`,
    );
  }
  // NEWS is deliberately the exception and asserting that keeps the rule honest: nothing a member does
  // produces a news item, so an invitation there would be asking for something nobody can supply. Without
  // this half, the test above could be satisfied by padding every note including one that must not be padded.
  assert.equal(sentences(EMPTY_SECTION_NOTES.news).length, 1, 'news states a fact and invites nothing');
});

test('LAUNCH ISSUE: the launch line still says the two things it exists to say', () => {
  // Found by auditing this file for TAUTOLOGICAL assertions, the mechanism SowMaster named after the PR 324
  // failure: an assertion that restates a post-condition of the code under test has no discriminating power
  // at all. `assert.equal(issue.launchNote, FIRST_ISSUE_NOTE)` is exactly that shape. It restates the
  // constant's definition and passes against ANY value of it, so replacing the reviewed sentence with
  // "First issue." left all 36 tests green, including the plain-sentence one, which that string also passes.
  //
  // The line exists to do two things: retire "the last issue" by saying this is the first, and name the span
  // it covers so a reader does not wonder where last month's article went. Both are pinned here by SUBSTANCE
  // rather than by exact string, so the owner or SowMaster can reword it freely and only lose the test by
  // dropping one of the facts.
  assert.match(FIRST_ISSUE_NOTE, /first issue/i, 'must say it is the first issue');
  assert.match(FIRST_ISSUE_NOTE, /past 90 days/i, 'must name the span it covers, which is the bootstrap window');
});

test('LAUNCH ISSUE: the copy is plain sentences, the same rule the standing notes are held to', () => {
  // The renderer is a table-based HTML email, so a stray asterisk or bracket reaches the reader as one.
  for (const note of [FIRST_ISSUE_NOTE, ...Object.values(FIRST_ISSUE_SECTION_NOTES)]) {
    assert.doesNotMatch(note, /[*_`[\]<>]|—|–/, `plain sentences only: ${note}`);
    assert.match(note, /\.$/, 'ends as a sentence');
  }
});

test('REGIMES: the floor plus the sent set is the only combination that gets all three cases right', () => {
  // This pins the guidance itself, because prose in a header comment is not a control and the FIRST version of
  // that prose said to pass one or the other and produced a live defect. Three claims, one artifact, one call
  // each. If someone changes the recommended combination, this fails and names which case it broke.
  const DAY = 86_400_000;
  const NOW = 2_000 * DAY; // the newsletter began 60 days ago, so this is roughly issue nine
  const EPOCH = NOW - 60 * DAY;
  const item = (title, daysAgo) => pub('article', title, NOW - daysAgo * DAY);

  const artifact = [
    item('new-this-week', 2),
    item('held-for-review', 12),   // PR opened 12 days ago, merged and deployed only now. After the epoch.
    item('predates-the-newsletter', 120),
  ];
  const titles = (opts) =>
    composeIssue({ issueId: 'i', items: artifact, news: [], now: at(NOW) }, { perSection: 5, ...opts })
      .sections.article.map((x) => x.title);

  // A per-issue window alone loses the held contribution. That is the defect exclude was built for.
  assert.deepEqual(titles({ since: NOW - 7 * DAY }), ['new-this-week']);

  // The sent set alone mails the pre-newsletter archive as if it were this week's news.
  assert.deepEqual(
    titles({ since: null, exclude: new Set() }),
    ['new-this-week', 'held-for-review', 'predates-the-newsletter'],
  );

  // The floor plus the sent set: the new item and the late one, and nothing from before the newsletter existed.
  assert.deepEqual(titles({ since: EPOCH, exclude: new Set() }), ['new-this-week', 'held-for-review']);

  // ...and it still excludes what was already mailed, so the floor did not quietly replace the filter.
  assert.deepEqual(
    titles({ since: EPOCH, exclude: new Set([`https://gbti.network/article/new-this-week`]) }),
    ['held-for-review'],
  );
});

// A weekly compile driven exactly the way workers/signup/mail-compile.mjs drives it: the floor is the compile
// time of the oldest issue still inside `historyDepth`, and the mailed set is the union of that window's item
// urls. Returned as a per-title tally, because the property under test is "how many times was this mailed",
// which no single compile can answer.
function runWeeklyCompiles(items, { weeks, historyDepth, t0, perSection = 5 }) {
  const WEEK = 7 * 86_400_000;
  const issues = [];
  const tally = {};
  for (let n = 0; n < weeks; n += 1) {
    const now = t0 + n * WEEK;
    const inWindow = issues.slice(-historyDepth);
    const exclude = new Set(inWindow.flatMap((i) => i.urls));
    // The floor holds at the epoch until an issue actually AGES OUT, then advances to the compile time of the
    // oldest issue still inside the window. Advancing it during ramp-up (the first draft of this helper) walls
    // off the entire back catalogue at the second compile and the test reports a loss that the real compile
    // does not have. The harness has to model resolveWindow, not something adjacent to it.
    const since = issues.length > historyDepth ? inWindow[0].generatedAt : t0 - WEEK;
    const issue = composeIssue({ issueId: `w${n}`, items, news: [], now: at(now) }, { perSection, since, exclude });
    const mailed = issue.sections.product;
    for (const it of mailed) tally[it.title] = (tally[it.title] ?? 0) + 1;
    issues.push({ generatedAt: now, urls: mailed.map((it) => it.url) });
  }
  return tally;
}

test('FUTURE DATES: a not-yet-due item is withheld, then mailed exactly ONCE when its date arrives', () => {
  // THIS IS A SEAM TEST AND IT HAS TO BE. The defect it guards is invisible to any single compile: an earlier
  // fix clamped the date to the compile time, which made every single-compile assertion pass while the item
  // was re-projected to `now` every week, stayed above a floor lagging by historyDepth, and was mailed FOUR
  // times over sixteen weeks. UnifiedWorker found that by running the merged code forward. A test that cannot
  // run forward cannot see it.
  const DAY = 86_400_000;
  const T0 = Date.parse('2026-09-01T00:00:00Z');
  const items = [
    pub('product', 'normal', T0 - DAY),
    pub('product', 'due-in-100-days', T0 + 100 * DAY),
  ];

  // Stopping BEFORE the due date: withheld entirely, and the ordinary item beside it still mails once, so a
  // filter that dropped everything could not pass this.
  const early = runWeeklyCompiles(items, { weeks: 12, historyDepth: 3, t0: T0 });
  assert.equal(early['due-in-100-days'], undefined, 'not mailed while it is dated in the future');
  assert.equal(early.normal, 1, 'and the ordinary item is untouched');

  // Running PAST the due date: it arrives at its real date and mails exactly once, never again. Withholding
  // that turned into silent suppression would pass the assertion above and fail this one.
  const later = runWeeklyCompiles(items, { weeks: 25, historyDepth: 3, t0: T0 });
  assert.equal(later['due-in-100-days'], 1, 'mailed once, when due');
  assert.equal(later.normal, 1);
});

test('FUTURE DATES: an ordinary catalogue still mails each item exactly once across many compiles', () => {
  // The seam regression for the floor-versus-history coupling, kept here because the due-date filter sits in
  // the same projection and could re-open it. Six below-cap products, the shape that re-mailed at issue 28.
  const DAY = 86_400_000;
  const T0 = Date.parse('2026-09-01T00:00:00Z');
  const items = Array.from({ length: 6 }, (_, i) => pub('product', `p${i + 1}`, T0 - (i + 1) * DAY));
  const tally = runWeeklyCompiles(items, { weeks: 20, historyDepth: 3, t0: T0, perSection: 2 });
  assert.deepEqual(Object.keys(tally).sort(), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']);
  for (const [title, n] of Object.entries(tally)) assert.equal(n, 1, `${title} mailed ${n} times, expected once`);
});

// ---------- sow-166 digest v2 (2026-08-23): blurb + thumb, and the rule that keeps the guard closed ----------

// THE SECURITY CONTROL FOR THE WIDENED PROJECTION, and it is not the field name.
//
// publicItem grew `blurb` so the email can show a line under each title. post.excerpt is OPTIONAL, so the day
// an article lands without one the obvious repair is "fall back to the body", and for a Mode B stub that puts
// member-only text into a mailed issue. The projection cannot express that rule; only this test can. It is
// the reason a bare row is correct rather than a bug, and it is what should go red if anyone adds a fallback.
test('SECURITY CONTROL: an item with a BODY and no frontmatter blurb renders a BARE row, never a body excerpt', () => {
  const items = [
    pub('article', 'no-excerpt', 100, { body: 'THE ARTICLE BODY TEXT', encryptedBody: 'x.enc' }), // no blurb
    pub('product', 'has-blurb', 90, { blurb: 'A real frontmatter blurb.', body: 'PRODUCT BODY TEXT' }),
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(999) });
  const bare = issue.sections.article[0];
  const withBlurb = issue.sections.product[0];

  assert.equal(bare.blurb, null, 'a missing frontmatter blurb must stay missing');
  assert.equal(withBlurb.blurb, 'A real frontmatter blurb.', 'a real blurb still arrives, or this proves nothing');

  const serialized = JSON.stringify(issue);
  assert.ok(!serialized.includes('THE ARTICLE BODY TEXT'), 'no body reached the issue in place of the blurb');
  assert.ok(!serialized.includes('PRODUCT BODY TEXT'), 'a body is not copied even when a blurb exists');
});

test('the projection carries blurb + thumb through, and still drops everything else', () => {
  const items = [pub('article', 'a', 100, {
    blurb: 'Public frontmatter blurb.', thumb: '/media/a.png',
    body: 'BODY', encryptedBody: 'e.enc', secretField: 'SHOULD NOT SURVIVE',
  })];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(999) });
  const it = issue.sections.article[0];
  assert.equal(it.blurb, 'Public frontmatter blurb.');
  assert.equal(it.thumb, '/media/a.png');
  assert.deepEqual(Object.keys(it).sort(), ['author', 'authorName', 'blurb', 'date', 'kind', 'thumb', 'title', 'url']);
  assert.ok(!JSON.stringify(issue).includes('SHOULD NOT SURVIVE'), 'the projection is still an allowlist, not a merge');
});

test('the news projection carries sourceName, blurb and thumb, and stays an allowlist', () => {
  const news = [{
    title: 'N', url: 'https://theverge.com/x', source: 'object-object', sourceName: 'The Verge',
    blurb: 'A one line summary.', thumb: 'https://cdn.theverge.com/x.jpg', opens: 3, date: 10,
    rawFeedPayload: 'SHOULD NOT SURVIVE',
  }];
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(999) });
  const n = issue.topNews[0];
  assert.equal(n.sourceName, 'The Verge');
  assert.equal(n.source, 'object-object', 'the stored id is kept: it is the key, the name is only for display');
  assert.equal(n.blurb, 'A one line summary.');
  assert.equal(n.thumb, 'https://cdn.theverge.com/x.jpg');
  assert.ok(!JSON.stringify(issue).includes('SHOULD NOT SURVIVE'));
});

// OWNER RULING 2026-08-23, read back off the real constant rather than restated as a comment.
test('SECTION ORDER: News is LAST and the member types run in the design order', () => {
  assert.deepEqual(SECTION_ORDER, ['article', 'prompt', 'product', 'share', 'news']);
  assert.equal(SECTION_ORDER[SECTION_ORDER.length - 1], 'news', 'news goes last');
});

test('layout puts News last among FILLED sections, not merely last in the constant', () => {
  const items = [pub('article', 'a', 100), pub('share', 's', 90)];
  const news = [{ title: 'N', url: 'https://n/1', source: 'src', opens: 9, date: 95 }];
  const issue = composeIssue({ issueId: 'i', items, news, now: at(999) });
  const filled = issue.layout.filter((s) => !s.empty).map((s) => s.key);
  assert.deepEqual(filled, ['article', 'share', 'news'], 'a filled news section still sorts below the member types');
  assert.equal(filled[filled.length - 1], 'news');
});

test('SECTION_LABELS stay the plain nouns: "Latest" is a heading prefix, not the label', () => {
  // The label also names the "See all in the Articles feed" link and the collapsed empty line ("Nothing new
  // in Articles, Products"). Baking the prefix in here would corrupt both, so it is applied in the renderer.
  for (const [key, label] of Object.entries(SECTION_LABELS)) {
    assert.ok(!/^Latest\b/.test(label), `SECTION_LABELS.${key} must not carry the prefix`);
  }
});

// sow-166, 2026-08-24: A GENERIC BANNER IS NOT AN IMAGE, SO IT RENDERS AS NO IMAGE. Owner ruling.
//
// An item with no picture of its own gets the per-type banner from src/lib/feature-image.ts. That is right
// for a link preview, where the alternative is a bare grey box in somebody else's timeline. It is wrong here,
// where the banners repeat down the page: the issue delivered on 2026-08-24 carried the SAME prompt banner
// five times in one section, which reads as a rendering fault rather than as branding.
test('the per-type default banner is dropped, so an item with no image of its own renders bare', () => {
  const items = [
    pub('prompt', 'generic', 300, { thumb: '/brand/feature/feature-prompt.png' }),
    pub('prompt', 'own', 200, { thumb: '/_astro/result.CJ0K4A1W.webp' }),
    pub('article', 'generic-absolute', 100, { thumb: 'https://gbti.network/brand/feature/feature-article.png' }),
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(999) }, { perSection: 5 });
  const thumbOf = (kind, title) => issue.sections[kind].find((x) => x.title === title).thumb;
  assert.equal(thumbOf('prompt', 'generic'), null, 'a root-relative banner is suppressed');
  assert.equal(thumbOf('article', 'generic-absolute'), null, 'and so is the same banner as an absolute url');
  // Not vacuous: the item that HAS its own image keeps it, which is the half a blanket "drop all thumbs"
  // change would also have satisfied.
  assert.equal(thumbOf('prompt', 'own'), '/_astro/result.CJ0K4A1W.webp');
});

test('the banner rule matches the PATH, so a query string or host cannot smuggle one through', () => {
  const items = [
    pub('product', 'q', 300, { thumb: '/brand/feature/feature-product.png?v=2' }),
    pub('product', 'nested', 200, { thumb: '/members/alice/brand/feature/feature-product.png' }),
    pub('product', 'lookalike', 100, { thumb: '/brand/feature/feature-product-custom.png' }),
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(999) }, { perSection: 5 });
  const thumbOf = (t) => issue.sections.product.find((x) => x.title === t).thumb;
  assert.equal(thumbOf('q'), null, 'a cache-busting query does not make a banner unique');
  assert.equal(thumbOf('nested'), null, 'the segment is matched anywhere in the path, not only at the root');
  // A member could name a real image something banner-shaped. The rule is anchored to the exact
  // feature-<word>.<ext> filename, so a longer name is theirs and is kept.
  assert.ok(thumbOf('lookalike'), 'a genuinely custom file whose name merely starts the same is kept');
});

test('NEWS images are never touched by the banner rule', () => {
  // A news image comes from the publisher's own feed and is never one of ours, so there is nothing here to
  // match. Pinned because the obvious place to put this rule is "everywhere", and that would strip a
  // legitimate publisher image the day one of them happens to sit at a similar path.
  const news = [{ title: 'n', url: 'https://pub.example/a', source: 's', opens: 1, date: 100, thumb: 'https://pub.example/brand/feature/feature-article.png' }];
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1_000_000) }, { perSection: 5, maxNews: 5 });
  assert.equal(issue.topNews.length, 1, 'anchor: the news item is actually in the issue');
  assert.equal(issue.topNews[0].thumb, 'https://pub.example/brand/feature/feature-article.png');
});
