// SOW-166: renderIssue v2, the send-ready 600px table template. Pure; plain objects, no IO. These tests split
// into CONTRACT (behaviour the send path depends on: fail-closed urls, escaping, layout-order consumption, the
// leak guard, the unsubscribe link/fallback, the postal address that renders only from ctx) and DESIGN v2 (the table
// skeleton, palette token layer, counts subject and preheader, the filled-before-empty collapse, and the
// optional blurb/thumb/derived-avatar item fields). Reconciled to the owner's 2026-08-21 rulings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderIssue, escapeHtml, safeUrl } from '../membership/mail-render.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';

const at = (t) => () => t;

// A hand-built frozen issue: news filled (2), article filled (1), product EMPTY (so the collapse branch and the
// filled-before-empty order are both exercised). No counts/generatedAt, so the subject falls back to the plain
// default (a bare fixture must not trip the counts-subject path).
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

// ---- CONTRACT ----

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

test('renders filled sections IN ORDER with links; empty sections collapse to one line at the end', () => {
  const { html } = renderIssue(issueFixture(), {});
  // order: News, then Articles, then the collapsed empty line naming Products
  const iNews = html.indexOf('News');
  const iArticles = html.indexOf('Articles');
  const iProducts = html.indexOf('Products');
  assert.ok(iNews >= 0 && iArticles > iNews && iProducts > iArticles, 'filled sections in order, empties after');
  // filled: titles are links
  assert.match(html, /<a href="https:\/\/news\.example\/edge"[^>]*>Edge AI roundup<\/a>/);
  assert.match(html, /<a href="https:\/\/news\.example\/kv"[^>]*>KV at scale<\/a>/);
  assert.match(html, /<a href="https:\/\/gbti\.network\/blog\/worker-cron\/"[^>]*>Shipping a Worker cron<\/a>/, 'site-relative item links are absolutized for email');
  // news shows source, member item shows byline
  assert.match(html, /The Register/);
  assert.match(html, /by Dika Fei/);
  // filled sections carry a count label
  assert.match(html, /2 NEW/);
  assert.match(html, /1 NEW/);
  // the empty Products section collapses to one compact line, NOT the per-section note or a section box
  assert.match(html, /Nothing new in Products since the last issue\./);
  assert.doesNotMatch(html, /No new products since the last issue\./, 'the per-section note is not rendered');
  assert.doesNotMatch(html, /NONE THIS WEEK/, 'an empty section gets no count label');
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

test('postal address renders ONLY when the drain supplies ctx.postalAddress; there is no default (never hardcoded)', () => {
  // Permanent contract: no address on the default render path. This is what keeps the real value, which lives
  // only in the MAIL_POSTAL_ADDRESS worker secret, off any output the drain did not explicitly ask for.
  const bare = renderIssue(issueFixture(), {});
  assert.doesNotMatch(bare.html, /PO Box|Suite|Ste\.|\bLLC\b/i, 'no address text on the default path');
  // A supplied address renders in the html footer and the text alternative. The fixture is an OBVIOUSLY FAKE
  // address on purpose: the real value must never appear in a committed file, a comment, or a commit message.
  const fake = 'Example Org, PO Box 00000, Testville, ZZ 00000, USA';
  const { html, text } = renderIssue(issueFixture(), { postalAddress: fake });
  assert.match(html, /Example Org, PO Box 00000, Testville, ZZ 00000, USA/);
  assert.match(text, /Example Org, PO Box 00000, Testville, ZZ 00000, USA/);
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

test('INTEGRATION: composeIssue output feeds renderIssue directly (the two shapes fit; leak guard holds)', () => {
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

// ---- DESIGN v2 ----

test('the shell is a 600px table wrapping a 536px card with a 480px content column', () => {
  const { html } = renderIssue(issueFixture(), {});
  assert.match(html, /<table[^>]*width="600"/);
  assert.match(html, /width="536"/);
  assert.match(html, /width="480"/);
  assert.match(html, /role="presentation"/);
});

test('the palette is light by default and swaps to dark on ctx.theme', () => {
  const light = renderIssue(issueFixture(), {}).html;
  const dark = renderIssue(issueFixture(), { theme: 'dark' }).html;
  assert.match(light, /background-color:#efece7/, 'light page background');
  assert.doesNotMatch(light, /#1b1922/, 'no dark tokens leak into the light render');
  assert.match(dark, /background-color:#1b1922/, 'dark page background');
  assert.doesNotMatch(dark, /#efece7/, 'no light tokens leak into the dark render');
});

test('the subject carries the item count and week range when the issue provides counts and generatedAt', () => {
  const issue = { generatedAt: Date.UTC(2026, 7, 21), counts: { article: 2, product: 0, prompt: 0, share: 9, news: 4 }, layout: [] };
  const { subject } = renderIssue(issue, {});
  assert.match(subject, /^GBTI Digest · 15 items · Aug 15-21$/);
  // ctx.subject still overrides the computed one.
  assert.equal(renderIssue(issue, { subject: 'Custom line' }).subject, 'Custom line');
});

test('the hidden preheader carries a natural-language counts summary in non-zero-section order', () => {
  const issue = { generatedAt: Date.UTC(2026, 7, 21), counts: { article: 4, product: 2, prompt: 0, share: 0, news: 3 }, layout: [] };
  const { html } = renderIssue(issue, {});
  assert.match(html, /<span style="display:none[^"]*">4 articles, 2 products and 3 news picks from the network this week\.<\/span>/);
});

test('the text alternative carries filled sections and the collapsed empty line', () => {
  const { text } = renderIssue(issueFixture(), {});
  assert.match(text, /NEWS \(2\)/);
  assert.match(text, /Edge AI roundup/);
  assert.match(text, /ARTICLES \(1\)/);
  assert.match(text, /Nothing new in Products since the last issue\./);
  assert.doesNotMatch(text, /No new products since the last issue\./, 'the per-section note is not carried into text');
});

test('an item blurb renders when present and is escaped', () => {
  const issue = { layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/p/', authorName: 'A', date: 1, blurb: 'A short <b>summary</b>.' },
  ] }] };
  const { html } = renderIssue(issue, {});
  assert.match(html, /A short &lt;b&gt;summary&lt;\/b&gt;\./);
});

test('SECURITY: the row shows NO blurb when the item has a body but no blurb (no body fallback)', () => {
  const issue = { layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/p/', authorName: 'A', date: 1, body: 'SECRET BODY TEXT', encryptedBody: 'CIPHERTEXT' },
  ] }] };
  const { html, text } = renderIssue(issue, {});
  assert.doesNotMatch(html, /SECRET BODY TEXT/, 'the renderer never reads a body field');
  assert.doesNotMatch(html, /CIPHERTEXT/, 'and never reads a ciphertext field');
  assert.doesNotMatch(text, /SECRET BODY TEXT/);
});

test('a thumbnail renders when the item carries a thumb; absent means no image; an unsafe thumb is dropped', () => {
  const withThumb = renderIssue({ layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/p/', authorName: 'A', date: 1, thumb: '/media/x.webp' },
  ] }] }, {});
  assert.match(withThumb.html, /<img src="https:\/\/gbti\.network\/media\/x\.webp"[^>]*width="96"/, 'a site-relative thumb is absolutized for email');

  const noThumb = renderIssue({ layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/p/', authorName: 'A', date: 1 },
  ] }] }, {});
  assert.doesNotMatch(noThumb.html, /width="96"/, 'no thumbnail column when the item carries no thumb');

  const badThumb = renderIssue({ layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/p/', authorName: 'A', date: 1, thumb: 'javascript:x' },
  ] }] }, {});
  assert.doesNotMatch(badThumb.html, /javascript:/);
  assert.doesNotMatch(badThumb.html, /width="96"/, 'an unsafe thumb renders no image');
});

test('site-relative links are absolutized against ctx.siteUrl (external links pass through)', () => {
  const issue = { layout: [{ key: 'article', label: 'Articles', empty: false, items: [
    { kind: 'article', title: 'T', url: '/blog/x/', authorName: 'A', date: 1, thumb: '/media/y.webp' },
  ] }] };
  const { html } = renderIssue(issue, { siteUrl: 'https://staging.example' });
  assert.match(html, /<a href="https:\/\/staging\.example\/blog\/x\/"/, 'the item link uses the provided base');
  assert.match(html, /<img src="https:\/\/staging\.example\/media\/y\.webp"/, 'the thumb uses the provided base');
  // an external item link is untouched
  const ext = renderIssue({ layout: [{ key: 'news', label: 'News', empty: false, items: [
    { title: 'N', url: 'https://news.example/z', source: 'S', date: 1 },
  ] }] }, { siteUrl: 'https://staging.example' }).html;
  assert.match(ext, /<a href="https:\/\/news\.example\/z"/);
});

test('a member item derives its author avatar from the github login; a news item has none', () => {
  const issue = { layout: [
    { key: 'news', label: 'News', empty: false, items: [{ title: 'N', url: 'https://n/x', source: 'Src', date: 1 }] },
    { key: 'article', label: 'Articles', empty: false, items: [{ kind: 'article', title: 'T', url: '/p/', author: 'dikafei', authorName: 'Dika Fei', date: 1 }] },
  ] };
  const { html } = renderIssue(issue, {});
  assert.match(html, /<img src="https:\/\/github\.com\/dikafei\.png\?size=32"[^>]*alt=""/);
  assert.doesNotMatch(html, /github\.com\/Src\.png/, 'the news source is not treated as an avatar login');
});

test('empty sections collapse to a single line naming them all; the first issue swaps the cadence clause and shows its launch note', () => {
  const base = [
    { key: 'news', label: 'News', empty: false, items: [{ title: 'N', url: 'https://n/x', source: 'Src', date: 1 }] },
    { key: 'article', label: 'Articles', empty: true, note: 'x', items: [] },
    { key: 'product', label: 'Products', empty: true, note: 'y', items: [] },
    { key: 'prompt', label: 'Prompts', empty: true, note: 'z', items: [] },
  ];
  const later = renderIssue({ layout: base }, {}).html;
  assert.match(later, /Nothing new in Articles, Products and Prompts since the last issue\./);

  const first = renderIssue({ launchNote: 'This is the first issue, so it covers the past week rather than everything published before it.', layout: base }, {}).html;
  assert.match(first, /Nothing new in Articles, Products and Prompts in the past week\./);
  assert.match(first, /This is the first issue/);
});
