// SOW-062 Phase 5d: the callout + embed body blocks render in BOTH the in-extension reader (client/src/markdown.mjs)
// and the static build (src/lib/remark-content-blocks.mjs), via the one shared embedUrl. No author HTML executes:
// callout bodies are escaped, and only a normalized provider URL becomes an iframe src.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { embedUrl, isPortraitEmbed } from '../client/src/video-embed.mjs';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';

// The PUBLISHED pipeline, in astro.config.mjs order. A second construction of it lives in
// markdown-sanitize.test.mjs; sharing one helper would mean importing across test files, which re-runs the
// other file's tests. The duplication is test scaffolding only, and both copies cite the same config.
async function published(md) {
  const out = await unified()
    .use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
    .use(rehypeIframeHostAllowlist).use(rehypeStyleAllowlist).use(rehypeIdSafety)
    .use(rehypeStringify).process(md);
  return String(out);
}
const anchorOf = (html) => (/<a\b[^>]*>[\s\S]*?<\/a>/.exec(html) ?? [''])[0];

test('reader: a callout fence renders a variant box with an escaped, inline-formatted body', () => {
  const html = renderMarkdown('```callout warning\nHeads up, see [docs](https://x.com).\n```');
  assert.match(html, /md-callout md-callout-warning/);
  assert.match(html, /<a href="https:\/\/x\.com"/); // inline link works inside the callout
  assert.doesNotMatch(html, /<pre>/); // it is NOT a code block
});

test('reader: an unknown or missing callout variant falls back to note', () => {
  assert.match(renderMarkdown('```callout\nx\n```'), /md-callout-note/);
  assert.match(renderMarkdown('```callout danger\nx\n```'), /md-callout-note/);
});

// CHANGED intent (SOW-092): this used to assert a DIRECT provider iframe. That is the bug. This renderer only
// ever runs off-https (the extension's chrome-extension:// pages, the npm CMS on localhost), so the provider
// gets no HTTP Referer and YouTube refuses to play (its error 153). The fence now frames the https relay, which
// is what gbti-reader and gbti-shares-feed already do. The `sandbox` attribute went with it: nested browsing
// contexts INHERIT sandbox flags, so it would have applied to the inner player rather than the relay.
test('reader: an embed fence with a YouTube URL frames the https relay, not the provider directly', () => {
  const html = renderMarkdown('```embed\nhttps://youtu.be/dQw4w9WgXcQ\n```');
  assert.match(html, /<iframe src="https:\/\/gbti\.network\/embed\/\?u=https%3A%2F%2Fyoutu\.be%2FdQw4w9WgXcQ"/);
  assert.doesNotMatch(html, /src="https:\/\/www\.youtube\.com/); // never the provider from an extension page
  assert.match(html, /allowfullscreen/);
});

test('reader: an embed fence with a non-video URL degrades to an escaped link, never an iframe', () => {
  const html = renderMarkdown('```embed\nhttps://example.com/page\n```');
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /<a href="https:\/\/example\.com\/page"/);
});

test('reader: a raw <iframe> typed as body text stays escaped (only the embed fence makes an iframe)', () => {
  const html = renderMarkdown('Look: <iframe src="https://evil"></iframe>');
  assert.match(html, /&lt;iframe/);
  assert.doesNotMatch(html, /<iframe /);
});

// sow-170 gap (2026-08-04): the WorkBench editor's link tool (client-ui/src/markdown-blocks.mjs) stores an
// attributed link (nofollow and/or open-in-new-tab) as raw sanitized <a> HTML, since plain `[text](url)`
// Markdown cannot express rel/target. The published site already renders that correctly (Astro's rehype-raw +
// the sow-158 sanitizer allow target/rel on <a>), but this reader had no matching passthrough, so Preview and
// gbti-reader/gbti-locked-content showed the literal tag text instead of a link. These mirror the exact
// allowlist client-ui/src/markdown-blocks.mjs enforces, as an independent copy (see the comment above
// escapeKeepingLinks in client/src/markdown.mjs for why it is not a shared import).
test('reader: an attributed <a> (nofollow / target=_blank) round-trips to a real link, not literal tag text', () => {
  const nofollow = renderMarkdown('Try <a href="https://x.com" rel="nofollow">this</a> now.');
  assert.match(nofollow, /<a href="https:\/\/x\.com" rel="nofollow">this<\/a>/);
  const blank = renderMarkdown('Try <a href="https://x.com" target="_blank">this</a> now.');
  assert.match(blank, /<a href="https:\/\/x\.com" rel="noopener" target="_blank">this<\/a>/); // blank forces noopener
  const both = renderMarkdown('Try <a href="https://x.com" rel="nofollow" target="_blank">this</a> now.');
  assert.match(both, /<a href="https:\/\/x\.com" rel="nofollow noopener" target="_blank">this<\/a>/);
});

// 2026-08-11: the sow-170 passthrough above kept the raw <a> but treated its inner text as opaque, so
// `<a href="x">**Name**</a>` showed literal asterisks in Preview while the published page showed a bold
// link. CommonMark parses markdown INSIDE inline HTML and remark obeys it, so the two renderers disagreed.
// This asserts EQUIVALENCE against the real published pipeline rather than a hand-written expectation,
// which is the only version of this test that keeps failing if either side moves.
test('DRIFT: emphasis inside a raw <a> renders identically in the reader and on the published page', async () => {
  const cases = [
    'A <a href="https://appleinsider.com/x" rel="nofollow">**ExxonMobil**</a> paid at the pump.',
    'A <a href="https://x.com" rel="nofollow">*ParkWhiz*</a> tapped a tag.',
    'A <a href="https://x.com" rel="nofollow">**Flash Note Cards**</a> shared a deck.',
  ];
  for (const md of cases) {
    assert.equal(anchorOf(renderMarkdown(md)), anchorOf(await published(md)), `diverged on: ${md}`);
  }
});

test('reader: emphasis inside a raw <a> becomes real tags, leaving no literal asterisks', () => {
  const html = renderMarkdown('A <a href="https://x.com" rel="nofollow">**ExxonMobil**</a> paid.');
  assert.match(html, /<a href="https:\/\/x\.com" rel="nofollow"><strong>ExxonMobil<\/strong><\/a>/);
  assert.doesNotMatch(html, /\*\*/);
  // A dropped link keeps its text, and that text is emphasized too rather than left as punctuation.
  assert.match(renderMarkdown('A <a href="javascript:alert(1)">**bad**</a> link.'), /<strong>bad<\/strong>/);
});

test('reader: a dangerous or disallowed attributed <a> is neutralized, not passed through', () => {
  const dangerous = renderMarkdown('Try <a href="javascript:alert(1)">bad</a> now.');
  assert.doesNotMatch(dangerous, /<a /); // the link is dropped entirely
  assert.match(dangerous, /Try bad now\./); // the text survives, plain
  const strippedAttrs = renderMarkdown('Try <a href="https://x.com" onclick="alert(1)" style="x">click</a> now.');
  assert.doesNotMatch(strippedAttrs, /onclick|style=/); // only href/rel/target are ever read back out
  const droppedRel = renderMarkdown('Try <a href="https://x.com" rel="sponsored external">click</a> now.');
  assert.match(droppedRel, /<a href="https:\/\/x\.com">click<\/a>/); // non-allowlisted rel tokens vanish
  const nestedScript = renderMarkdown('Try <a href="https://x.com" rel="nofollow"><script>alert(1)</script>hi</a> now.');
  assert.doesNotMatch(nestedScript, /<script/);
  assert.match(nestedScript, /<a href="https:\/\/x\.com" rel="nofollow">alert\(1\)hi<\/a>/);
});

test('reader: an attributed <a> works in a heading, a list item, and a table cell; a code fence still escapes it', () => {
  assert.match(renderMarkdown('## See <a href="https://x.com" target="_blank">docs</a>'), /<h2>See <a href="https:\/\/x\.com" rel="noopener" target="_blank">docs<\/a><\/h2>/);
  assert.match(renderMarkdown('- one <a href="https://x.com" rel="nofollow">two</a>'), /<li>one <a href="https:\/\/x\.com" rel="nofollow">two<\/a><\/li>/);
  const table = renderMarkdown(['| A |', '|---|', '| <a href="https://x.com" target="_blank">go</a> |'].join('\n'));
  assert.match(table, /<td><a href="https:\/\/x\.com" rel="noopener" target="_blank">go<\/a><\/td>/);
  const fenced = renderMarkdown('```html\n<a href="https://x.com" target="_blank">example</a>\n```');
  assert.match(fenced, /&lt;a href=&quot;https:\/\/x\.com&quot; target=&quot;_blank&quot;&gt;example&lt;\/a&gt;/); // literal source, not a live link
});

test('reader: two attributed links in one paragraph both convert, and plain numbers nearby are untouched', () => {
  const html = renderMarkdown('First <a href="https://a.com" target="_blank">A</a> then <a href="https://b.com" rel="nofollow">B</a>. Release v2.4.1, 42 stars, 100 more.');
  assert.match(html, /<a href="https:\/\/a\.com" rel="noopener" target="_blank">A<\/a>/);
  assert.match(html, /<a href="https:\/\/b\.com" rel="nofollow">B<\/a>/);
  assert.match(html, /Release v2\.4\.1, 42 stars, 100 more\./); // the placeholder-restore pass never touches plain digits
});

test('embedUrl normalizes YouTube + Vimeo forms and rejects everything else', () => {
  assert.equal(embedUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://vimeo.com/123456'), 'https://player.vimeo.com/video/123456');
  assert.equal(embedUrl('dQw4w9WgXcQ'), 'https://www.youtube.com/embed/dQw4w9WgXcQ');
  assert.equal(embedUrl('https://example.com'), null);
});

test('embedUrl: TikTok + Rumble (SOW-092 share embeds); a Rumble WATCH page stays null', () => {
  assert.equal(embedUrl('https://www.tiktok.com/@somebody/video/7301234567890123456'), 'https://www.tiktok.com/embed/v2/7301234567890123456');
  assert.equal(embedUrl('https://rumble.com/embed/v4abcd9/'), 'https://rumble.com/embed/v4abcd9/');
  // The watch page's v-code is a DIFFERENT id than the embed code, so it cannot embed client-side.
  assert.equal(embedUrl('https://rumble.com/v6abcd1-some-title.html'), null);
  // The watch?v param with a playlist still resolves (real share URLs carry extra params).
  assert.equal(embedUrl('https://www.youtube.com/watch?v=N_GfH09iP9c&list=RDN_GfH09iP9c&start_radio=1'), 'https://www.youtube.com/embed/N_GfH09iP9c');
  assert.equal(isPortraitEmbed('https://www.tiktok.com/embed/v2/1'), true);
  assert.equal(isPortraitEmbed('https://www.youtube.com/embed/x'), false);
});

test('build: remarkContentBlocks turns callout/embed code nodes into html nodes, matching the reader', () => {
  const tree = { type: 'root', children: [
    { type: 'code', lang: 'callout', meta: 'tip', value: 'Nice **bold**' },
    { type: 'code', lang: 'embed', value: 'https://youtu.be/dQw4w9WgXcQ' },
    { type: 'code', lang: 'js', value: 'const callout = 1;' },
  ] };
  remarkContentBlocks()(tree);
  assert.equal(tree.children[0].type, 'html');
  assert.match(tree.children[0].value, /callout callout-tip/);
  assert.match(tree.children[0].value, /<strong>bold<\/strong>/); // inline parity with the reader
  assert.equal(tree.children[1].type, 'html');
  assert.match(tree.children[1].value, /youtube\.com\/embed\/dQw4w9WgXcQ/);
  assert.equal(tree.children[2].type, 'code'); // a real code block is left untouched
});

test('a 4-backtick fence carries ``` fences as CONTENT (the /ci skill prompt regression)', () => {
  const md = 'Intro\n\n````markdown\n# Title\n```bash\necho hi\n```\nAfter the inner fence.\n````\n\nOutro';
  const html = renderMarkdown(md);
  // ONE code block whose content includes the inner fence lines verbatim (escaped), not a paragraph split.
  assert.equal((html.match(/<pre/g) || []).length, 1);
  assert.match(html, /```bash/);
  assert.match(html, /After the inner fence\./);
  assert.match(html, /<p>Outro<\/p>/);
  assert.ok(!/<p>[^<]*echo hi/.test(html), 'inner code never leaks into a paragraph');
});

test('reader: GFM footnote refs render superscript anchors; defs collect into an end section', () => {
  const md = 'Alpha[^1] and beta[^2].\n\n[^1]: First note with [a link](https://x.com).\n[^2]: Second note:  \n    **Song - Title**, extra line\n\n_The end._';
  const html = renderMarkdown(md);
  assert.match(html, /Alpha<sup class="md-fnref"><a href="#fn-1" id="fnref-1">1<\/a><\/sup>/);
  assert.ok(html.indexOf('md-footnotes') > html.indexOf('The end.'), 'the footnote section renders at the document end');
  assert.match(html, /<li id="fn-1">First note with <a href="https:\/\/x\.com"/);
  assert.match(html, /<li id="fn-2">Second note:<br\/><strong>Song - Title<\/strong>, extra line/);
  assert.match(html, /<a class="md-fn-back" href="#fnref-1"/);
  assert.doesNotMatch(html, /\[\^1\]/); // no literal footnote syntax leaks into the output
});

test('reader: a footnote ref inside a blockquote works; a def-less document emits no section', () => {
  const quoted = renderMarkdown('> Wise words.[^3]\n\n[^3]: The source.');
  assert.match(quoted, /<blockquote>Wise words\.<sup class="md-fnref"><a href="#fn-3"/);
  assert.doesNotMatch(renderMarkdown('Plain text, no footnotes.'), /md-footnotes/);
});

test('reader: repeated refs get disambiguated ids and per-occurrence back arrows; the def renders once', () => {
  const html = renderMarkdown('One[^6] and again[^6].\n\n[^6]: Shared source.');
  assert.equal((html.match(/href="#fn-6"/g) || []).length, 2);
  assert.match(html, /id="fnref-6"/);
  assert.match(html, /id="fnref-6-2"/); // the second occurrence, like remark-gfm
  assert.equal((html.match(/<li id="fn-6">/g) || []).length, 1);
  assert.match(html, /href="#fnref-6"/);
  assert.match(html, /href="#fnref-6-2"/); // a back arrow per occurrence
});

test('reader: a ref with no matching definition stays literal, like remark-gfm', () => {
  const html = renderMarkdown('A typo ref[^9] here.\n\n[^1]: Unrelated.');
  assert.match(html, /A typo ref\[\^9\] here\./);
  assert.doesNotMatch(html, /#fn-9/);
});

test('reader: an unreferenced definition is dropped from the section, like remark-gfm', () => {
  const html = renderMarkdown('Uses[^1].\n\n[^1]: Kept.\n[^2]: Orphaned.');
  assert.match(html, /<li id="fn-1">Kept\./);
  assert.doesNotMatch(html, /Orphaned/);
});

test('reader: footnote-looking text inside a code span or a link stays untouched', () => {
  const inCode = renderMarkdown('Write `[^1]` to cite.\n\n[^1]: Real def, referenced[^1].');
  assert.match(inCode, /<code>\[\^1\]<\/code>/); // the quoted syntax is not a live anchor
  const asLink = renderMarkdown('[^caret](https://example.com/caret)');
  assert.match(asLink, /<a href="https:\/\/example\.com\/caret"[^>]*>\^caret<\/a>/); // no def -> the link rule wins
});

// sow-062 review feedback (2026-08-01): the preview renderer had no table branch at all, so a GFM table fell
// through to the paragraph gather and rendered as literal pipes while the site build (Astro + GFM) rendered a
// real table. The preview disagreeing with the published page defeats the point of a preview.
test('reader: a GFM table renders a real table, not literal pipes', () => {
  const html = renderMarkdown(['## Commands', '', '| Command | Default key |', '|---|---|', '| Reset Layout | none |'].join('\n'));
  assert.match(html, /<table><thead><tr><th>Command<\/th><th>Default key<\/th><\/tr><\/thead>/);
  assert.match(html, /<tbody><tr><td>Reset Layout<\/td><td>none<\/td><\/tr><\/tbody>/);
  assert.doesNotMatch(html, /<p>\| Command/); // never the old paragraph fallback
});

test('reader: table delimiter colons set per-column alignment', () => {
  const html = renderMarkdown(['| L | C | R |', '|:--|:-:|--:|', '| a | b | c |'].join('\n'));
  assert.match(html, /<th style="text-align:left">L<\/th>/);
  assert.match(html, /<th style="text-align:center">C<\/th>/);
  assert.match(html, /<th style="text-align:right">R<\/th>/);
  assert.match(html, /<td style="text-align:right">c<\/td>/);
});

test('reader: an escaped pipe stays inside its cell, and inline formatting still applies', () => {
  const html = renderMarkdown(['| A | B |', '|---|---|', '| a \\| b | **bold** |'].join('\n'));
  assert.match(html, /<td>a \| b<\/td>/);
  assert.match(html, /<td><strong>bold<\/strong><\/td>/);
});

test('reader: pipes without a delimiter row are NOT a table (and a header-only table still renders)', () => {
  assert.match(renderMarkdown('| just | pipes |'), /<p>\| just \| pipes \|<\/p>/);
  const headOnly = renderMarkdown(['| A | B |', '|---|---|'].join('\n'));
  assert.match(headOnly, /<table><thead>/);
  assert.doesNotMatch(headOnly, /<tbody>/); // no rows -> no empty tbody
});

test('reader: a table is escaped like every other block (no author HTML executes)', () => {
  const html = renderMarkdown(['| A |', '|---|', '| <img src=x onerror=alert(1)> |'].join('\n'));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});
