// SOW-166: renderIssue v1, the plain semantic digest template. Pure; plain objects, no IO. Proves it renders
// from the frozen layout (order + empty-section notes owned by the composition core), fails closed on unsafe
// urls, escapes public content, and carries the unsubscribe link the drain hands it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIssue, escapeHtml, safeUrl } from '../membership/mail-render.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';

const at = (t) => () => t;

// A hand-built frozen issue: news filled (2), article empty (note), so order + both branches are exercised.
function issueFixture() {
  return {
    issueId: '2026-08-25',
    layout: [
      {
        key: 'news', label: 'News', empty: false, note: null,
        items: [
          { title: 'Edge AI roundup', url: 'https://news.example/edge', source: 'The Register', opens: 12, date: 3 },
          { title: 'KV at scale', url: 'https://news.example/kv', source: 'ACM', opens: 7, date: 2 },
        ],
      },
      {
        key: 'article', label: 'Articles', empty: false, note: null,
        items: [
          { kind: 'article', title: 'Shipping a Worker cron', url: '/blog/worker-cron/', author: 'dikafei', authorName: 'Dika Fei', date: 5 },
        ],
      },
      {
        key: 'product', label: 'Products', empty: true, note: 'No new products since the last issue.', items: [],
      },
    ],
  };
}

test('safeUrl: http(s) and site-relative pass; javascript:, data:, and junk fail closed', () => {
  assert.equal(safeUrl('https://x.com/a'), 'https://x.com/a');
  assert.equal(safeUrl('http://x.com'), 'http://x.com');
  assert.equal(safeUrl('/blog/x/'), '/blog/x/');
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,x'), '');
  assert.equal(safeUrl('  '), '');
  assert.equal(safeUrl(null), '');
});

test('escapeHtml neutralizes markup characters', () => {
  assert.equal(escapeHtml('<script>&"\''), '&lt;script&gt;&amp;&quot;&#39;');
});

test('renders every layout section IN ORDER; filled sections list items, empty sections show the note', () => {
  const { html } = renderIssue(issueFixture(), {});
  // order: News, then Articles, then the empty Products note
  const iNews = html.indexOf('News');
  const iArticles = html.indexOf('Articles');
  const iProducts = html.indexOf('Products');
  assert.ok(iNews >= 0 && iArticles > iNews && iProducts > iArticles, 'sections render in layout order');
  // filled: both news titles are links; the article title is a link
  assert.match(html, /<a href="https:\/\/news\.example\/edge"[^>]*>Edge AI roundup<\/a>/);
  assert.match(html, /<a href="https:\/\/news\.example\/kv"[^>]*>KV at scale<\/a>/);
  assert.match(html, /<a href="\/blog\/worker-cron\/"[^>]*>Shipping a Worker cron<\/a>/);
  // news shows source, member item shows byline
  assert.match(html, /The Register/);
  assert.match(html, /by Dika Fei/);
  // empty section: the note, no list
  assert.match(html, /No new products since the last issue\./);
});

test('an item with an UNSAFE url renders its title as TEXT, never a live link', () => {
  const issue = { layout: [{ key: 'article', label: 'Articles', empty: false, note: null, items: [
    { kind: 'article', title: 'Sketchy', url: 'javascript:alert(1)', authorName: 'X', date: 1 },
  ] }] };
  const { html } = renderIssue(issue, {});
  assert.doesNotMatch(html, /javascript:/, 'the unsafe url never reaches the output');
  assert.match(html, /Sketchy/, 'the title still renders, as text');
  assert.doesNotMatch(html, /<a[^>]*>Sketchy<\/a>/, 'and not as an anchor');
});

test('a title containing markup is escaped in the rendered HTML', () => {
  const issue = { layout: [{ key: 'article', label: 'Articles', empty: false, note: null, items: [
    { kind: 'article', title: '<b>x</b> & <i>y</i>', url: '/p/', authorName: 'A', date: 1 },
  ] }] };
  const { html } = renderIssue(issue, {});
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt; &amp; &lt;i&gt;y&lt;\/i&gt;/);
  assert.doesNotMatch(html, /<b>x<\/b>/, 'the raw tag is not emitted');
});

test('unsubscribe: a url renders a one-click link (html + text); absent renders a managed-subscription fallback', () => {
  const withUrl = renderIssue(issueFixture(), { unsubscribeUrl: 'https://signup.gbti.network/mail/unsubscribe?h=abc&t=tok' });
  assert.match(withUrl.html, /<a href="https:\/\/signup\.gbti\.network\/mail\/unsubscribe\?h=abc&amp;t=tok"[^>]*>Unsubscribe<\/a>/);
  assert.match(withUrl.text, /Unsubscribe from the weekly digest: https:\/\/signup\.gbti\.network\/mail\/unsubscribe\?h=abc&t=tok/);

  const noUrl = renderIssue(issueFixture(), {});
  assert.match(noUrl.html, /manage your subscription/i);
  assert.doesNotMatch(noUrl.html, />Unsubscribe</, 'no dead unsubscribe link when the drain gave no url');
});

test('an unsafe unsubscribe url is dropped to the fallback (fail closed), never emitted', () => {
  const { html } = renderIssue(issueFixture(), { unsubscribeUrl: 'javascript:steal()' });
  assert.doesNotMatch(html, /javascript:/);
  assert.match(html, /manage your subscription/i);
});

test('subject defaults, and ctx.subject overrides; text alternative carries the sections', () => {
  assert.equal(renderIssue(issueFixture(), {}).subject, 'The GBTI Network weekly digest');
  assert.equal(renderIssue(issueFixture(), { subject: 'Custom line' }).subject, 'Custom line');
  const { text } = renderIssue(issueFixture(), {});
  assert.match(text, /NEWS/);
  assert.match(text, /Edge AI roundup/);
  assert.match(text, /ARTICLES/);
  assert.match(text, /No new products since the last issue\./);
});

test('postal address renders only when provided (CAN-SPAM footer slot, supplied by the drain, never fabricated)', () => {
  assert.doesNotMatch(renderIssue(issueFixture(), {}).html, /Dothan/);
  const { html, text } = renderIssue(issueFixture(), { postalAddress: 'Gethsemane LLC, Dothan, Alabama, USA' });
  assert.match(html, /Gethsemane LLC, Dothan, Alabama, USA/);
  assert.match(text, /Gethsemane LLC, Dothan, Alabama, USA/);
});

test('an empty or missing layout renders a valid shell rather than crashing', () => {
  const a = renderIssue({ layout: [] }, {});
  const b = renderIssue({}, {});
  const c = renderIssue(null, {});
  for (const r of [a, b, c]) {
    assert.match(r.html, /GBTI Network/);
    assert.equal(typeof r.text, 'string');
    assert.equal(r.subject, 'The GBTI Network weekly digest');
  }
});

test('INTEGRATION: composeIssue output feeds renderIssue directly (the two shapes fit)', () => {
  const issue = composeIssue({
    issueId: 'i-int',
    items: [
      { kind: 'article', title: 'Public post', url: '/blog/p/', author: 'a', authorName: 'Ann', date: 9, visibility: 'public' },
      { kind: 'article', title: 'Secret post', url: '/blog/s/', author: 'a', date: 8, visibility: 'members' },
    ],
    news: [{ title: 'Hot item', url: 'https://n/x', source: 'Src', opens: 5, date: 7 }],
    now: at(1_000),
  });
  const { html } = renderIssue(issue, { unsubscribeUrl: 'https://signup.gbti.network/mail/unsubscribe?h=h&t=t' });
  assert.match(html, /Public post/, 'the public item renders');
  assert.doesNotMatch(html, /Secret post/, 'the members-only item was excluded by the composition leak guard');
  assert.match(html, /Hot item/);
  assert.match(html, />Unsubscribe</);
});
