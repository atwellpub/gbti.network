// SOW-166: the pure digest composition core. No network, injected `now`. The leak guard is the load-bearing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeIssue, hasContent, issueKey, isPublicItem, SECTION_KINDS, DigestError,
  SECTION_ORDER, SECTION_LABELS, EMPTY_SECTION_NOTES, shouldSend,
} from '../membership/mail-digest.mjs';

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

test('LEAK GUARD: a members item is excluded and no body/ciphertext can appear in a compiled issue', () => {
  const items = [
    pub('article', 'public-one', 100, { body: 'PUBLIC BODY TEXT', encryptedBody: 'x.enc' }),
    { kind: 'article', title: 'MEMBER ONLY', url: 'https://gbti.network/secret', author: 'bob', date: 200, visibility: 'members', body: 'SECRET MEMBER BODY', encryptedBody: 'members/bob/_enc/s.enc' },
    { kind: 'share', title: 'no-visibility', url: 'https://x', author: 'c', date: 50 }, // missing visibility -> excluded
  ];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) });
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
  assert.deepEqual(Object.keys(issue.sections.article[0]).sort(), ['author', 'authorName', 'date', 'kind', 'title', 'url']);
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
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { maxNews: 3 });
  assert.deepEqual(issue.topNews.map((n) => n.title), ['high', 'mid-b', 'mid-a']); // opens desc, date breaks ties
  assert.equal(issue.topNews.length, 3); // capped
  assert.deepEqual(Object.keys(issue.topNews[0]).sort(), ['date', 'opens', 'source', 'title', 'url']);
});

test('empty-week policy: skip only when member AND news are both empty; else top-news-only still sends', () => {
  // both empty -> isEmpty, the compile cron skips
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1) });
  assert.equal(dead.isEmpty, true);
  assert.equal(hasContent(dead), false);
  // no member content but news present -> a top-news-only issue that still sends
  const newsOnly = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n', opens: 1 }], now: at(1) });
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
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) });
  assert.deepEqual(issue.sections.article.map((x) => x.title), ['good']);
});

test('an unknown kind does not crash and does not land in a section', () => {
  const items = [{ kind: 'video', title: 'v', url: 'https://v', author: 'a', date: 1, visibility: 'public' }, pub('article', 'a', 2)];
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) });
  assert.equal(issue.counts.article, 1);
  assert.equal(issue.counts.product + issue.counts.prompt + issue.counts.share, 0);
});

// ---- sow-166 content contract (owner ruling 2026-08-21): always send, every section present, note the gaps.

test('layout carries EVERY section every week, filled ones first, in canonical order', () => {
  const items = [pub('prompt', 'p1', 300), pub('share', 's1', 200)];
  const news = [{ title: 'n', url: 'https://n/1', opens: 5, date: 100 }];
  const issue = composeIssue({ issueId: 'i', items, news, now: at(1) });

  // nothing is ever dropped: all five, exactly once each
  assert.deepEqual(issue.layout.map((s) => s.key).sort(), [...SECTION_ORDER].sort());
  assert.equal(issue.layout.length, SECTION_ORDER.length);

  // filled first (news leads the filled group), then the empty ones
  assert.deepEqual(issue.layout.map((s) => s.key), ['news', 'prompt', 'share', 'article', 'product']);
  assert.deepEqual(issue.layout.filter((s) => !s.empty).map((s) => s.key), ['news', 'prompt', 'share']);
});

test('the relative order inside each group is stable, so a section does not move week to week', () => {
  const rank = (key) => SECTION_ORDER.indexOf(key);
  for (const items of [[], [pub('article', 'a', 1)], [pub('share', 's', 1), pub('product', 'p', 2)]]) {
    const layout = composeIssue({ issueId: 'i', items, news: [], now: at(1) }).layout;
    const filled = layout.filter((s) => !s.empty).map((s) => rank(s.key));
    const empty = layout.filter((s) => s.empty).map((s) => rank(s.key));
    assert.deepEqual(filled, [...filled].sort((a, b) => a - b), 'filled group out of canonical order');
    assert.deepEqual(empty, [...empty].sort((a, b) => a - b), 'empty group out of canonical order');
  }
});

test('an empty section carries its note and a filled one carries none', () => {
  const issue = composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news: [], now: at(1) });
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
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) });
  const serialized = JSON.stringify(issue);
  assert.ok(!serialized.includes('SECRET BODY'), 'a member body reached the compiled issue');
  assert.ok(!serialized.includes('secret'), 'a member item title reached the compiled issue');
  for (const section of issue.layout) {
    for (const it of section.items) {
      assert.deepEqual(Object.keys(it).sort(), ['author', 'authorName', 'date', 'kind', 'title', 'url']);
    }
  }
});

test('a thin member week can lift the news cap, but only when asked, and never past an explicit max', () => {
  const news = Array.from({ length: 10 }, (_, i) => ({ title: `n${i}`, url: `https://n/${i}`, opens: 10 - i, date: i }));

  // unset: no lift, so maxNews stays a real ceiling (this is the trap the cap test caught)
  assert.equal(composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { maxNews: 3 }).topNews.length, 3);

  // opted in, and the member week is empty: the lift applies
  assert.equal(
    composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { maxNews: 3, maxNewsThin: 8 }).topNews.length, 8);

  // opted in, but a member item exists: normal cap, because the lift is for thin weeks only
  assert.equal(
    composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news, now: at(1) }, { maxNews: 3, maxNewsThin: 8 })
      .topNews.length, 3);

  // a thin cap BELOW the normal one can only ever raise, never shorten a news-led issue
  assert.equal(
    composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { maxNews: 5, maxNewsThin: 2 }).topNews.length, 5);
});

test('shouldSend is the gate and it is unconditional (owner ruling 2026-08-21)', () => {
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1) });
  const thin = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n/1', opens: 1, date: 1 }], now: at(1) });
  const full = composeIssue({ issueId: 'i', items: [pub('article', 'a', 1)], news: [], now: at(1) });
  for (const issue of [dead, thin, full]) assert.equal(shouldSend(issue), true);
  // and it does not depend on being handed a well-formed issue at all
  assert.equal(shouldSend(undefined), true);
});

test('hasContent stays HONEST, so it can still tell an empty issue from a full one', () => {
  // It is no longer the gate, but the subject line and the logs read it, and a predicate that answered
  // "yes" for an empty issue would mislead them.
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1) });
  assert.equal(dead.isEmpty, true);
  assert.equal(hasContent(dead), false);
  const alive = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n/1', opens: 1, date: 1 }], now: at(1) });
  assert.equal(hasContent(alive), true);
});

test('a fully empty issue is still SHAPED, so always-send never renders a special case', () => {
  // The owner's ground for always-send is that news ingests daily, so this state should not occur. That is a
  // fact about the ingest running, not a property of the composer, so the shape is pinned here: if the news
  // worker is ever down for a week the renderer still gets five labelled sections with notes, not a hole.
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1) });
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
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(9) }, { since: 1_000 });

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
    { issueId: 'i', items: [pub('article', 'exactly-at-the-cutoff', 1_000)], news: [], now: at(1) },
    { since: 1_000 },
  );
  assert.equal(onTheBoundary.counts.article, 1);
  const justUnder = composeIssue(
    { issueId: 'i', items: [pub('article', 'one-tick-earlier', 999)], news: [], now: at(1) },
    { since: 1_000 },
  );
  assert.equal(justUnder.counts.article, 0);
});

test('WINDOW: this is what makes an empty-section note reachable at all', () => {
  // The point of the whole option. The same site, the same artifact, one quiet week: unwindowed it re-sends
  // last week's article as if it were new and the note never renders; windowed the section is empty and the
  // invitation appears. If this ever fails, the section contract is decorative.
  const backCatalogue = [pub('article', 'written-months-ago', 100), pub('prompt', 'also-old', 90)];

  const unwindowed = composeIssue({ issueId: 'i', items: backCatalogue, news: [], now: at(1) });
  const staleArticles = unwindowed.layout.find((s) => s.key === 'article');
  assert.equal(staleArticles.empty, false, 'without a window the back catalogue fills the section');
  assert.equal(staleArticles.note, null, 'so the invitation never renders');

  const windowed = composeIssue({ issueId: 'i', items: backCatalogue, news: [], now: at(1) }, { since: 1_000 });
  const freshArticles = windowed.layout.find((s) => s.key === 'article');
  assert.equal(freshArticles.empty, true);
  assert.equal(freshArticles.note, EMPTY_SECTION_NOTES.article);
  assert.equal(windowed.isEmpty, true, 'nothing new and no news is a genuinely empty week');
});

test('WINDOW: an undated item is never new', () => {
  // date 0 is what the normalizer emits for a missing publishedAt. Treating "no date" as "brand new" would put
  // every dateless entry into every issue forever.
  const issue = composeIssue(
    { issueId: 'i', items: [pub('article', 'no-date', 0)], news: [], now: at(1) },
    { since: 1_000 },
  );
  assert.equal(issue.counts.article, 0);
  // ...but with no window it still renders, because that is the pre-window behaviour and it is unchanged.
  const unwindowed = composeIssue({ issueId: 'i', items: [pub('article', 'no-date', 0)], news: [], now: at(1) });
  assert.equal(unwindowed.counts.article, 1);
});

test('WINDOW: news is deliberately NOT windowed, and the issue records the window it used', () => {
  const news = [{ title: 'opened-all-week', url: 'https://n/1', opens: 40, date: 10 }];
  const issue = composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { since: 5_000 });
  assert.equal(issue.counts.news, 1, 'ranked by openers, not recency, so an older story still leads');
  assert.deepEqual(issue.window, { since: 5_000, excluded: null, appliesTo: 'members' });

  // A compile that forgot the window says so in the stored artifact rather than looking identical to one
  // that meant it. `since: null` in KV is the tell.
  const forgot = composeIssue({ issueId: 'i', items: [], news, now: at(1) });
  assert.equal(forgot.window.since, null);
  // Garbage is treated as no window rather than as 0, which would silently window nothing while looking set.
  for (const bad of ['soon', NaN, Infinity, undefined, null, {}]) {
    assert.equal(composeIssue({ issueId: 'i', items: [], news, now: at(1) }, { since: bad }).window.since, null, `since: ${String(bad)}`);
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
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) }, { exclude });

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
    { issueId: 'i', items: [heldContribution], news: [], now: at(1) },
    { since: lastCompile },
  );
  assert.equal(windowed.counts.article, 0, 'the window loses it');

  const bySentSet = composeIssue(
    { issueId: 'i', items: [heldContribution], news: [], now: at(1) },
    { exclude: new Set(['https://gbti.network/article/something-else']) },
  );
  assert.equal(bySentSet.counts.article, 1, 'the already-mailed set does not');
  assert.equal(bySentSet.sections.article[0].title, 'reviewed-slowly');

  // And stacking them re-opens the loss, which is why the regimes are documented as either/or.
  const stacked = composeIssue(
    { issueId: 'i', items: [heldContribution], news: [], now: at(1) },
    { since: lastCompile, exclude: new Set() },
  );
  assert.equal(stacked.counts.article, 0, 'both filters apply independently');
});

test('EXCLUDE: an empty set is a real answer and a missing one is not, so they must not look alike', () => {
  const items = [pub('article', 'a', 10)];
  const firstIssue = composeIssue({ issueId: 'i', items, news: [], now: at(1) }, { exclude: new Set() });
  assert.equal(firstIssue.counts.article, 1);
  assert.equal(firstIssue.window.excluded, 0, 'an empty set records 0');

  const forgot = composeIssue({ issueId: 'i', items, news: [], now: at(1) });
  assert.equal(forgot.window.excluded, null, 'a forgotten set records null, so KV shows which happened');
});

test('EXCLUDE: takes an array as readily as a Set, and ignores what is not a url collection', () => {
  const items = [pub('article', 'kept', 10), pub('article', 'dropped', 20)];
  const viaArray = composeIssue(
    { issueId: 'i', items, news: [], now: at(1) },
    { exclude: ['https://gbti.network/article/dropped'] },
  );
  assert.deepEqual(viaArray.sections.article.map((x) => x.title), ['kept']);

  // A string is iterable and would otherwise become a set of single characters, excluding nothing while
  // looking set. Anything that is not a url collection means no exclusion, never a partial one.
  for (const bad of ['https://gbti.network/article/dropped', 42, {}, true]) {
    const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1) }, { exclude: bad });
    assert.equal(issue.counts.article, 2, `exclude: ${String(bad)} must not filter`);
    assert.equal(issue.window.excluded, null);
  }
});

test('EXCLUDE: news is untouched by it, the same as the window', () => {
  const news = [{ title: 'still-the-top-story', url: 'https://n/1', opens: 40, date: 10 }];
  const issue = composeIssue(
    { issueId: 'i', items: [], news, now: at(1) },
    { exclude: new Set(['https://n/1']) },
  );
  assert.equal(issue.counts.news, 1, 'news ranks by openers and is bounded by its gather, not by this');
  assert.equal(issue.window.appliesTo, 'members');
});
