// SOW-062 Phase 6: the inline presentation transform (Markdown <-> inline HTML) the WYSIWYG uses at the DOM
// boundary. b.text stays Markdown on the model; the editor renders it as inline HTML in a contenteditable and reads
// it back. This guards the md -> html -> md round-trip so opening + saving an existing post never corrupts inline
// formatting. Pure + node-safe (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineMdToHtml, inlineHtmlToMd, isDangerousUrl } from '../client-ui/src/markdown-blocks.mjs';

const roundtrip = (md) => inlineHtmlToMd(inlineMdToHtml(md));

test('inline Markdown survives md -> html -> md', () => {
  for (const md of [
    'plain text',
    'has **bold** word',
    'has *italic* word',
    'has `code` span',
    'a [link](https://x.com) here',
    'bold **and** a [link](https://y.io) and `code`',
    '~~struck~~ out',
  ]) assert.equal(roundtrip(md), md);
});

test('md -> html emits real tags (not literal tokens)', () => {
  assert.equal(inlineMdToHtml('**b**'), '<strong>b</strong>');
  assert.equal(inlineMdToHtml('`c`'), '<code>c</code>');
  assert.equal(inlineMdToHtml('[t](u)'), '<a href="u">t</a>');
});

test('browser bold/italic variants (<b>/<i>) read back to Markdown', () => {
  assert.equal(inlineHtmlToMd('<b>x</b>'), '**x**');
  assert.equal(inlineHtmlToMd('<i>x</i>'), '*x*');
  assert.equal(inlineHtmlToMd('<div>a</div><div>b</div>'), '\na\nb'); // contenteditable soft lines
});

test('html-special characters in prose round-trip through the escape/unescape', () => {
  assert.equal(roundtrip('a < b && c > d'), 'a < b && c > d');
});

// --- SOW-170: attributed links (nofollow / target) carried as sanitized raw <a> HTML ---

test('a nofollow link reads back to raw <a> HTML (markdown cannot express rel)', () => {
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" rel="nofollow">t</a>'),
    '<a href="https://x.com" rel="nofollow">t</a>',
  );
});

test('target=_blank is preserved and forces rel="noopener" (tab-nabbing guard)', () => {
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" target="_blank">t</a>'),
    '<a href="https://x.com" rel="noopener" target="_blank">t</a>',
  );
});

test('an attributed link round-trips idempotently (md -> html -> md stable)', () => {
  for (const md of [
    '<a href="https://x.com" rel="nofollow">go</a>',
    '<a href="https://x.com" rel="nofollow noopener" target="_blank">go</a>',
    'before <a href="https://y.io" rel="nofollow">mid</a> after',
    'plain [a](https://p.io) and <a href="https://q.io" rel="noopener" target="_blank">attr</a>',
  ]) {
    assert.equal(roundtrip(md), roundtrip(roundtrip(md)), `${md} must be stable`);
    assert.equal(roundtrip(md), md, `${md} must round-trip exactly`);
  }
});

test('target=_blank without noopener normalizes on the first pass, then is stable', () => {
  const md = '<a href="https://q.io" target="_blank">attr</a>';
  const once = roundtrip(md);
  assert.equal(once, '<a href="https://q.io" rel="noopener" target="_blank">attr</a>');
  assert.equal(roundtrip(once), once); // stable thereafter
});

test('a plain link stays Markdown; only rel/target forces raw HTML', () => {
  assert.equal(inlineHtmlToMd('<a href="https://x.com">t</a>'), '[t](https://x.com)');
});

test('an href with & stays stable across the round-trip (no double-escape)', () => {
  const md = '<a href="https://x.com/?a=1&amp;b=2" rel="nofollow">t</a>';
  assert.equal(roundtrip(md), md);
  assert.equal(roundtrip(roundtrip(md)), md);
});

test('a dangerous URL scheme drops the link but keeps the text', () => {
  assert.equal(inlineHtmlToMd('<a href="javascript:alert(1)" rel="nofollow">t</a>'), 't');
  assert.equal(inlineMdToHtml('<a href="javascript:alert(1)">t</a>'), 't');
});

test('rel is restricted to the sanitizer allow-list (a bogus token is dropped)', () => {
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" rel="external nofollow sponsored">t</a>'),
    '<a href="https://x.com" rel="nofollow">t</a>',
  );
});

test('isDangerousUrl catches obfuscated script schemes (entities, control chars, case)', () => {
  for (const bad of [
    'javascript:alert(1)', 'JaVaScript:alert(1)', '  javascript:alert(1)', 'java\tscript:alert(1)',
    'java\nscript:alert(1)', '&#106;avascript:alert(1)', '&#x6a;avascript:alert(1)', 'data:text/html,x',
    'vbscript:msgbox(1)',
  ]) assert.equal(isDangerousUrl(bad), true, `${JSON.stringify(bad)} must be flagged`);
  for (const ok of ['https://x.com', '/relative', './img.webp', 'mailto:a@b.com', '#anchor']) {
    assert.equal(isDangerousUrl(ok), false, `${ok} must be allowed`);
  }
});

test('an entity-obfuscated dangerous href is neutralized in the markdown link path too', () => {
  assert.equal(inlineMdToHtml('[t](&#106;avascript:alertme)'), 't'); // decodes to javascript: -> link dropped
});

test('a script/handler smuggled into an attributed link inner is stripped; safe marks survive', () => {
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" rel="nofollow"><script>alert(1)</script>hi</a>'),
    '<a href="https://x.com" rel="nofollow">alert(1)hi</a>', // <script> tags stripped, text kept, no active tag
  );
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" rel="nofollow"><strong>bold</strong></a>'),
    '<a href="https://x.com" rel="nofollow"><strong>bold</strong></a>', // nested mark preserved
  );
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" target="_blank"><b onclick="x()">t</b></a>'),
    '<a href="https://x.com" rel="noopener" target="_blank"><b>t</b></a>', // handler attribute stripped
  );
});

// The entity decode used to stop at &amp;, so a double quote read back as the literal string "&quot;". Stored in a
// body that is re-rendered, it became &amp;quot; and the reader saw the entity on the page.
test('&quot; and &#39; decode to real characters, and &amp;quot; still decodes to &quot;', () => {
  assert.equal(inlineHtmlToMd('not what &quot;load balancing&quot; describes'), 'not what "load balancing" describes');
  assert.equal(inlineHtmlToMd('I&#39;ve had it since then'), "I've had it since then");
  assert.equal(inlineHtmlToMd('I&apos;ve had it since then'), "I've had it since then");
  assert.equal(inlineHtmlToMd('the entity &amp;quot; written out'), 'the entity &quot; written out');
});

// rendererAnchors is OPT-IN precisely so this contract is untouched: an author-written target=_blank link is intent
// to keep a raw anchor, and the doc editor must go on preserving it. Only a caller reading SITE-rendered HTML
// (the WorkBench Preview) asks for the markdown form back.
test('a renderer-shaped anchor is preserved by default and only inverts under rendererAnchors', () => {
  const html = '<a href="https://x.com" target="_blank" rel="noopener">t</a>';
  assert.equal(inlineHtmlToMd(html), '<a href="https://x.com" rel="noopener" target="_blank">t</a>');
  assert.equal(inlineHtmlToMd(html, { rendererAnchors: true }), '[t](https://x.com)');
});

test('rendererAnchors leaves any anchor the site renderer would not have produced alone', () => {
  // nofollow is not part of the renderer's markdown-link decoration, so this one is the author's and stays raw.
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" rel="nofollow noopener" target="_blank">t</a>', { rendererAnchors: true }),
    '<a href="https://x.com" rel="nofollow noopener" target="_blank">t</a>',
  );
  // A nested mark means the inner is not plain text, so the safe raw form is kept rather than guessed at.
  assert.equal(
    inlineHtmlToMd('<a href="https://x.com" target="_blank" rel="noopener"><strong>b</strong></a>', { rendererAnchors: true }),
    '<a href="https://x.com" rel="noopener" target="_blank"><strong>b</strong></a>',
  );
});

// Italic nested inside bold. The strong rule used to require `[^*]+` between the delimiters, so it stopped
// dead at the inner star, never matched, and published `**Asking *how* it works**` with its asterisks
// showing. It reached a live draft that way. Both renderers carry the rule, so both are asserted: this file
// covers markdown-blocks.mjs and test/markdown-render.test.mjs covers client/src/markdown.mjs.
test('a strong run admits italic inside it, and the round-trip survives', () => {
  assert.equal(inlineMdToHtml('**Asking *how* it works**'), '<strong>Asking <em>how</em> it works</strong>');
  assert.equal(inlineHtmlToMd('<strong>Asking <em>how</em> it works</strong>'), '**Asking *how* it works**');
  assert.equal(roundtrip('**Asking *how* it works**'), '**Asking *how* it works**');
});

test('widening the strong run leaves the neighbouring cases alone', () => {
  // Two runs on one line stay two runs: the inner alternation cannot cross a `**`, so it is not greedy.
  assert.equal(inlineMdToHtml('**bold** and **more**'), '<strong>bold</strong> and <strong>more</strong>');
  // A triple keeps the italic-of-bold reading it already had.
  assert.equal(inlineMdToHtml('***both***'), '<em><strong>both</strong></em>');
  // Bare stars used as arithmetic or bullets are untouched by the strong rule.
  assert.equal(inlineMdToHtml('**unclosed bold'), '**unclosed bold');
  assert.equal(inlineMdToHtml('*outer **inner** outer*'), '<em>outer <strong>inner</strong> outer</em>');
});
