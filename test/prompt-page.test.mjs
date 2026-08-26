// The prompt detail shell (src/lib/prompt-page.mjs), shared by src/pages/prompts/[slug].astro and the
// workbench preview. sow-214 fixed the article preview and left every other type rendering through the
// product Doc Shell; this is the prompt half of that, plus the drift guard that keeps the two in step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PROMPT_SHELL, buildPromptHeadHtml, buildPromptResultHtml, buildPromptBlockHtml } from '../src/lib/prompt-page.mjs';

const pageSrc = readFileSync(new URL('../src/pages/prompts/[slug].astro', import.meta.url), 'utf8');
const shellSrc = readFileSync(new URL('../src/lib/preview-shells.mjs', import.meta.url), 'utf8');
const previewSrc = readFileSync(new URL('../src/pages/workbench/preview.astro', import.meta.url), 'utf8');

test('every shell class still appears on the published prompt page', () => {
  // The contract's whole value is that it describes the real page. The preview renders from it and will
  // diverge silently if the page moves, which is the failure this asserts against.
  for (const [key, cls] of Object.entries(PROMPT_SHELL)) {
    assert.ok(pageSrc.includes(`class="${cls}"`), `PROMPT_SHELL.${key} ("${cls}") is no longer a class on prompts/[slug].astro`);
  }
});

test('main precedes the aside, because grid children take columns in source order', () => {
  const main = pageSrc.indexOf(`class="${PROMPT_SHELL.main}"`);
  const aside = pageSrc.indexOf(`class="${PROMPT_SHELL.aside}"`);
  assert.ok(main > 0 && aside > 0);
  assert.ok(main < aside, 'the reading column must come first, or the preview reorders the rail for nothing');
});

test('the preview actually consumes the contract rather than hardcoding the classes', () => {
  // The reshape lives in preview-shells.mjs; preview.astro calls it. Assert both ends, so neither the branch
  // nor its one caller can quietly go away and leave the prompt preview back on the product shell.
  assert.match(shellSrc, /from '\.\/prompt-page\.mjs'/);
  assert.match(shellSrc, /buildPromptHeadHtml/);
  assert.match(shellSrc, /buildPromptBlockHtml/);
  assert.match(shellSrc, /type === 'prompt'/);
  // Anchored to the start of the line: a commented-out call still contains the text, and an earlier version
  // of this assertion passed against exactly that.
  assert.match(previewSrc, /^\s*applyPreviewShell\(document,/m);
  // And it must not have grown its own copies of the class names.
  for (const cls of [PROMPT_SHELL.block, PROMPT_SHELL.body, PROMPT_SHELL.grid]) {
    assert.ok(!previewSrc.includes(`'${cls}'`), `preview.astro hardcodes "${cls}" instead of reading the contract`);
  }
});

test('the head builds a breadcrumb, a title, an optional byline row and an optional lead', () => {
  const html = buildPromptHeadHtml({
    title: 'Grok', crumbs: [{ label: 'AI Prompts', href: '/prompts/' }, { label: 'AI', href: '/prompts/?cat=ai' }],
    metaHtml: '<span>by someone</span>', lead: 'Short description',
  });
  assert.match(html, /<h1 data-gbti-region="title" class="h1 mt12">Grok<\/h1>/);
  assert.match(html, /<a href="\/prompts\/"[^>]*>AI Prompts<\/a>/);
  assert.match(html, /<a href="\/prompts\/\?cat=ai"[^>]*>AI<\/a>/);
  assert.match(html, /by someone/);
  assert.match(html, /Short description/);
  // Optional parts are omitted, not emitted empty: an empty lead paragraph still takes vertical space.
  const bare = buildPromptHeadHtml({ title: 'T' });
  assert.ok(!bare.includes(PROMPT_SHELL.lead));
  assert.ok(!bare.includes(PROMPT_SHELL.meta));
});

test('the head escapes author text', () => {
  const html = buildPromptHeadHtml({ title: '<img src=x onerror=alert(1)>', crumbs: [{ label: '</nav><b>', href: '"x' }] });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('</nav><b>'));
  assert.match(html, /&lt;img src=x/);
});

test('the result figure captions only when there is a caption', () => {
  const withCap = buildPromptResultHtml({ imgHtml: '<img src="a.webp">', caption: 'Example result' });
  assert.match(withCap, /<figure class="prompt-result"><img src="a\.webp"><figcaption>Example result<\/figcaption><\/figure>/);
  // A lead image on a non-generator prompt has nothing to caption, so no empty figcaption is emitted.
  assert.equal(buildPromptResultHtml({ imgHtml: '<img src="a.webp">' }), '<figure class="prompt-result"><img src="a.webp"></figure>');
  // No image at all means no figure, not an empty one.
  assert.equal(buildPromptResultHtml({}), '');
});

test('the block omits the mode switch and Copy when they would do nothing', () => {
  const inert = buildPromptBlockHtml({ interactive: false });
  assert.ok(inert.includes(`class="${PROMPT_SHELL.block}"`));
  assert.ok(inert.includes(`class="${PROMPT_SHELL.body}"`));
  assert.ok(!inert.includes('data-mode-btn'), 'a staged draft has no published raw form to switch to');
  assert.ok(!inert.includes('data-copy'));
  // The published page does carry both, and asks for them.
  const live = buildPromptBlockHtml({ interactive: true });
  assert.match(live, /data-mode-btn="markdown"/);
  assert.match(live, /data-copy/);
});
