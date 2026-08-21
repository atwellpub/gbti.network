// SOW-166: the pure digest composition core. No network, injected `now`. The leak guard is the load-bearing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeIssue, hasContent, issueKey, isPublicItem, SECTION_KINDS, DigestError,
  SECTION_ORDER, SECTION_LABELS, EMPTY_SECTION_NOTES,
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

test('the all-empty week is still the one skip: hasContent is the floor the cron reads', () => {
  const dead = composeIssue({ issueId: 'i', items: [], news: [], now: at(1) });
  assert.equal(dead.isEmpty, true);
  assert.equal(hasContent(dead), false, 'a week with nothing public must not be mailed as a page of notes');
  // even so, the sections are all present, so a renderer never has to special-case the shape
  assert.equal(dead.layout.length, SECTION_ORDER.length);
  assert.ok(dead.layout.every((s) => s.empty && s.note));

  // one news item is enough to clear the floor
  const alive = composeIssue({ issueId: 'i', items: [], news: [{ title: 'n', url: 'https://n/1', opens: 1, date: 1 }], now: at(1) });
  assert.equal(hasContent(alive), true);
});
