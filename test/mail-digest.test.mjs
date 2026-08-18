// SOW-166: the pure digest composition core. No network, injected `now`. The leak guard is the load-bearing test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  composeIssue, hasContent, issueKey, isPublicItem, SECTION_KINDS, DigestError,
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
