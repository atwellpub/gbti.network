// sow-235: the renderer reports where each emitted block came from, so the WorkBench preview can make ONE
// block editable without giving up the guarantee that it renders exactly like the published page.
//
// Three cheaper approaches were tried first and each is disproved below, because the next person to touch
// this will reach for the same ones:
//   - render block by block: loses footnote references, since [^1] only resolves against a document that
//     also carries its definition;
//   - map rendered elements to parseBlocks output by position: the two parse independently and the
//     footnotes section corresponds to no source block, so the counts do not line up;
//   - inject <!--blk:N--> sentinels: raw HTML is escaped to text, so the marker renders visibly.
//
// The load-bearing test is the first one. Everything else here is detail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';

const bodyOf = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8')
  .split(/^---$/m).slice(2).join('---').trim();

const REAL = [
  'members/gbtilabs/posts/upwork-mcp-server-agents-hiring-humans/index.md',
  'members/gbtilabs/posts/airllm-large-models-on-small-gpus/index.md',
  'members/atwellpub/posts/every-tree-is-a-pipe-dream/index.md',
];

// THE guarantee. Editing chrome is only safe while the rendered output is unchanged by its presence.
test('block ids change nothing: stripping data-blk reproduces renderMarkdown exactly, on real articles', () => {
  for (const f of REAL) {
    const md = bodyOf(f);
    const withIds = renderMarkdownWithBlocks(md).html.replace(/ data-blk="\d+"/g, '');
    assert.equal(withIds, renderMarkdown(md), `${f} renders differently once ids are stripped`);
  }
});

test('the id is an ATTRIBUTE on the existing element, never an added wrapper', () => {
  const { html } = renderMarkdownWithBlocks('# H\n\npara\n\n- a\n- b');
  assert.match(html, /^<h1 data-blk="0">H<\/h1>/);
  assert.match(html, /<p data-blk="1">para<\/p>/);
  assert.match(html, /<ul data-blk="2">/);
  // An extra element would reflow the page, which is the whole thing this avoids.
  assert.equal((html.match(/<div/g) || []).length, 0);
});

test('ranges are the inclusive source line span of each block', () => {
  const md = '# H\n\npara one\n\n- a\n- b\n\n```js\nx();\n```\n\nlast';
  const { blocks } = renderMarkdownWithBlocks(md);
  assert.deepEqual(blocks, [
    { start: 0, end: 0 },   // # H
    { start: 2, end: 2 },   // para one
    { start: 4, end: 5 },   // the two list items, one block
    { start: 7, end: 9 },   // the fence, opening line through closing
    { start: 11, end: 11 }, // last
  ]);
});

// A range has to be usable for a splice, which is the entire point of returning it.
test('a range addresses exactly the source lines that produced the block', () => {
  const md = '# Title\n\nfirst para\n\nsecond para';
  const lines = md.split('\n');
  const { blocks } = renderMarkdownWithBlocks(md);
  const slice = (n) => lines.slice(blocks[n].start, blocks[n].end + 1).join('\n');
  assert.equal(slice(0), '# Title');
  assert.equal(slice(1), 'first para');
  assert.equal(slice(2), 'second para');
});

test('the synthesized footnotes section reports a null range, since it has no source lines', () => {
  const { blocks, html } = renderMarkdownWithBlocks('note[^1]\n\n[^1]: def');
  assert.match(html, /md-footnotes/);
  assert.equal(blocks.at(-1), null, 'the footnote section is not editable and must not claim source lines');
  assert.deepEqual(blocks[0], { start: 0, end: 0 });
});

// The reason the whole design renders the document once instead of per block.
test('WHY whole-document: a paragraph rendered alone loses its footnote reference', () => {
  const doc = 'note[^1]\n\n[^1]: def';
  assert.match(renderMarkdown(doc), /md-fnref/);
  assert.doesNotMatch(renderMarkdown('note[^1]'), /md-fnref/);
  // and it survives when the same paragraph is a block inside the whole render
  const { html, blocks } = renderMarkdownWithBlocks(doc);
  assert.match(html, /<p data-blk="0">note<sup class="md-fnref"/);
  assert.deepEqual(blocks[0], { start: 0, end: 0 });
});

// The reason mapping by position was rejected.
test('WHY not positional: emitted blocks do not correspond one-to-one with parseBlocks output', () => {
  const md = bodyOf(REAL[0]);
  const emitted = renderMarkdownWithBlocks(md).blocks.length;
  assert.notEqual(emitted, parseBlocks(md).length, 'if these ever match it is a coincidence, not a contract');
});

// The reason sentinels were rejected.
test('WHY not sentinels: a raw HTML comment is escaped to visible text', () => {
  assert.match(renderMarkdown('<!--blk:0-->\n\ntext'), /&lt;!--blk:0--&gt;/);
});

// The editing round trip rests on this, so it is asserted against a real article rather than a fixture.
test('the block round trip is lossless on a real article', () => {
  const md = bodyOf(REAL[0]);
  assert.equal(serializeBlocks(parseBlocks(md)).trim(), md.trim());
});

test('empty and whitespace input do not throw and report no blocks', () => {
  for (const md of ['', '   ', '\n\n']) {
    const r = renderMarkdownWithBlocks(md);
    assert.equal(typeof r.html, 'string');
    assert.deepEqual(r.blocks, []);
  }
});
