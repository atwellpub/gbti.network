// sow-158 Phase 1a: the build-time member-markdown sanitizer. Runs the REAL pipeline in the exact
// astro.config.mjs order (remarkContentBlocks -> ... -> rehypeRaw -> rehypeSanitize(schema) ->
// rehypeIframeHostAllowlist) and proves attacker constructs are stripped while every legitimate
// construct the content system emits survives.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';
import { remarkContentBlocks } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety, IFRAME_HOSTS } from '../src/lib/markdown-sanitize.mjs';

async function render(md) {
  const out = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkContentBlocks)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeIframeHostAllowlist)
    .use(rehypeStyleAllowlist)
    .use(rehypeIdSafety)
    .use(rehypeStringify)
    .process(md);
  return String(out);
}

test('attacker constructs are stripped', async () => {
  const html = await render([
    'hello <script>alert(1)</script> world',
    '',
    '<img src="x" onerror="alert(1)">',
    '',
    '[link](javascript:alert(1))',
    '',
    '<iframe src="https://evil.example/frame"></iframe>',
    '',
    '<a href="https://ok.example" onclick="alert(1)">a</a>',
    '',
    '<div style="position:fixed;inset:0">overlay</div>',
    '',
    '<form action="https://evil.example"><input name="password" type="password"></form>',
  ].join('\n'));
  assert.ok(!/<script/i.test(html), 'script removed');
  assert.ok(!/onerror|onclick/i.test(html), 'event handlers removed');
  assert.ok(!/javascript:/i.test(html), 'javascript: URL removed');
  assert.ok(!/<iframe/i.test(html), 'non-provider iframe removed entirely');
  assert.ok(!/<form/i.test(html), 'the form element is removed');
  assert.ok(!/type="password"/i.test(html), 'the password field is neutralized (no submittable password input)');
  // hast-util-sanitize keeps <input> only as the GFM task-list control and forces it inert (disabled
  // checkbox); with the <form> gone and disabled set it cannot submit, phish, or run script.
  for (const input of html.match(/<input[^>]*>/gi) ?? []) {
    assert.ok(/\bdisabled\b/i.test(input) && /type="checkbox"/i.test(input), `input is the inert task-list checkbox: ${input}`);
  }
  assert.ok(!/position:fixed/i.test(html), 'style attr not allowed on div');
  assert.ok(html.includes('hello') && html.includes('world'), 'surrounding text kept');
});

test('the callout and embed fences survive intact', async () => {
  const html = await render([
    '```callout warning',
    'Careful with **this** and `that` and [a link](https://example.com/x).',
    '```',
    '',
    '```embed',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    '```',
  ].join('\n'));
  assert.ok(html.includes('class="callout callout-warning"'), 'callout wrapper kept');
  assert.ok(html.includes('class="callout-body"'), 'callout body kept');
  assert.ok(html.includes('<strong>this</strong>') && html.includes('<code>that</code>'), 'inline formatting kept');
  assert.ok(html.includes('class="embed-wrap"'), 'embed wrapper kept');
  assert.ok(/<iframe[^>]+src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/.test(html), 'provider iframe kept');
  assert.ok(/<iframe[^>]+sandbox=/.test(html), 'sandbox attribute kept');
});

test('standard markdown output survives (tables, images, footnotes, code)', async () => {
  const html = await render([
    '| a | b |',
    '| - | - |',
    '| 1 | 2 |',
    '',
    '![alt text](https://example.com/pic.png)',
    '',
    '    indented code',
    '',
    'A claim.[^1]',
    '',
    '[^1]: The footnote body.',
  ].join('\n'));
  assert.ok(html.includes('<table>') && html.includes('<td>1</td>'), 'table kept');
  assert.ok(/<img[^>]+src="https:\/\/example\.com\/pic\.png"/.test(html), 'image kept');
  assert.ok(html.includes('data-footnotes') || html.includes('footnote'), 'footnote section kept');
  // the disabled clobberPrefix keeps the fn/fnref pairs matching
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const hrefs = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]);
  for (const h of hrefs) assert.ok(ids.includes(h), `footnote anchor #${h} resolves`);
  assert.ok(html.includes('<pre>') || html.includes('<code>'), 'code kept');
});

test('the iframe host allowlist admits every embedUrl provider and the tweet host', () => {
  for (const host of ['www.youtube.com', 'player.vimeo.com', 'www.tiktok.com', 'rumble.com', 'platform.twitter.com']) {
    assert.ok(IFRAME_HOSTS.has(host), host);
  }
});

test('an http (non-https) iframe src is stripped by the protocol rule', async () => {
  const html = await render('<iframe src="http://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
  assert.ok(!/<iframe/.test(html), 'http iframe removed');
});

// sow-158 red-team hardening: the style-attribute allowlist closes the CSS-only abuse classes the
// adversarial pass surfaced (hast-util-sanitize never parses CSS, so these reached the page before).
test('the style-attribute allowlist strips clickjacking, url() beacons, and legacy CSS vectors', async () => {
  const html = await render([
    '<span style="width:expression(alert(1));-moz-binding:url(https://evil.example/x.xml#e);behavior:url(#default#x)">a</span>',
    '',
    '<span style="position:fixed;inset:0;z-index:99999;opacity:0.01">overlay</span>',
    '',
    "<span style=\"background:url('//evil.example/leak.png');background-image:url(https://evil/x.png)\">b</span>",
    '',
    '<span style="color:#005cc5;/* c */ pointer-events:none">c</span>',
  ].join('\n'));
  assert.ok(!/expression\(/i.test(html), 'legacy CSS expression() stripped');
  assert.ok(!/-moz-binding/i.test(html), '-moz-binding stripped');
  assert.ok(!/behavior\s*:/i.test(html), 'IE behavior: stripped');
  assert.ok(!/position\s*:/i.test(html), 'position (clickjacking) stripped');
  assert.ok(!/z-index/i.test(html), 'z-index stripped');
  assert.ok(!/pointer-events/i.test(html), 'pointer-events stripped');
  assert.ok(!/url\(/i.test(html), 'every url() (beacon) stripped');
  assert.ok(/color:#005cc5/i.test(html), 'a safe color declaration is preserved (Shiki highlighting survives)');
});

test('safe Shiki-style declarations on code survive the allowlist', async () => {
  const html = await render('<pre style="background-color:#24292e;color:#e1e4e8;overflow-x:auto"><code style="color:#79b8ff">x</code></pre>');
  assert.ok(/background-color:#24292e/i.test(html), 'code background-color kept');
  assert.ok(/overflow-x:auto/i.test(html), 'code overflow-x kept');
  assert.ok(/color:#79b8ff/i.test(html), 'token color kept');
});

// sow-158 red-team hardening: the id/name safety pass neutralizes DOM clobbering (a real risk once the
// site hosts a login dialog) while leaving the GFM footnote anchors intact.
test('author id/name are stripped (DOM-clobbering neutralized) but footnote ids survive', async () => {
  const html = await render([
    '<div id="gbti-signin-dialog">shadow the dialog</div>',
    '',
    '<img id="__proto__" name="config" src="x" alt="">',
    '',
    '<a id="main" name="main">x</a>',
    '',
    'A claim.[^1]',
    '',
    '[^1]: The footnote body.',
  ].join('\n'));
  assert.ok(!/id="gbti-signin-dialog"/.test(html), 'author id that shadows the login dialog is stripped');
  assert.ok(!/id="__proto__"/.test(html), 'proto-clobbering id stripped');
  assert.ok(!/\sid="main"/.test(html), 'generic author id stripped');
  assert.ok(!/\sname=/.test(html), 'all name attributes stripped');
  // the footnote system ids (user-content-fn*) must remain and stay self-consistent
  assert.ok(/id="user-content-fn-1"/.test(html), 'footnote def id preserved');
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  const hrefs = [...html.matchAll(/ href="#([^"]+)"/g)].map((m) => m[1]);
  for (const h of hrefs) assert.ok(ids.includes(h), `footnote anchor #${h} still resolves`);
});
