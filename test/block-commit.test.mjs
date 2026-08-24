// sow-235: the Preview commits an edited block back into the Markdown source. Everything the rendered HTML cannot
// express (a table's column alignment, a fence's language, whether a list is ordered) has to survive the trip, so
// the block is rebuilt from its own source and only its text-bearing fields are replaced. These are the guards for
// that. Pure + node-safe (no DOM): readBlockDom is the thin browser half and is exercised in the browser pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyBlockEdit, isEditableBlockTag, EDITABLE_BLOCK_TAGS } from '../client-ui/src/block-commit.mjs';
import { renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';

const CORPUS = [
  'A wrapped paragraph that the renderer',
  'joins back together with a space.',
  '',
  '## A heading',
  '',
  '> a quoted line',
  '',
  '- first item',
  '- second **bold** item',
  '',
  '1. ordered one',
  '2. ordered two',
  '',
  '| Name | Qty |',
  '| :--- | ---: |',
  '| a | 1 |',
  '',
  '```js',
  'const x = 1;',
  '```',
].join('\n');

// The whole design rests on this: a block's SOURCE range must parse to exactly one block of the type the renderer
// emitted. If the two parsers ever drift apart, every commit below is writing to the wrong shape, so this fails
// loudly rather than letting the corruption surface as a mangled table months later.
test('every rendered block re-parses to one block of its own type, and re-serializes exactly', () => {
  const lines = CORPUS.split('\n');
  const { html, blocks } = renderMarkdownWithBlocks(CORPUS);
  const tags = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*data-blk="(\d+)"/gi)].map((m) => [Number(m[2]), m[1].toUpperCase()]);
  const seen = [];
  for (const [n, tag] of tags) {
    const r = blocks[n];
    if (!r) continue;                       // the footnotes section carries a null range by design
    const src = lines.slice(r.start, r.end + 1).join('\n');
    const parsed = parseBlocks(src);
    assert.equal(parsed.length, 1, `<${tag}> at lines ${r.start + 1}-${r.end + 1} parsed to ${parsed.length} blocks`);
    assert.equal(serializeBlocks(parsed), src, `<${tag}> did not re-serialize to its own source`);
    seen.push(tag);
  }
  assert.deepEqual(seen, ['P', 'H2', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE'], 'the corpus must exercise every editable tag');
  for (const tag of seen) assert.ok(isEditableBlockTag(tag), `${tag} should be editable`);
});

test('editing one list item leaves the others alone and keeps the bullet', () => {
  const src = '- first item\n- second **bold** item';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'list', items: ['first item', 'second *changed* item'] }),
    ['- first item', '- second *changed* item'],
  );
});

test('an ordered list keeps its numbering and renumbers cleanly', () => {
  const src = '1. ordered one\n2. ordered two';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'list', items: ['ordered one', 'ordered two', 'ordered three'] }),
    ['1. ordered one', '2. ordered two', '3. ordered three'],
  );
});

test('editing a table cell preserves the alignment row, which exists ONLY in the source', () => {
  const src = '| Name | Qty |\n| :--- | ---: |\n| a | 1 |';
  const out = applyBlockEdit(src, { kind: 'table', head: ['Name', 'Count'], rows: [['a', '2']] });
  assert.deepEqual(out, ['| Name | Count |', '| :--- | ---: |', '| a | 2 |']);
});

test('editing a fenced block preserves its language and does not transform the code', () => {
  const src = '```js\nconst x = 1;\n```';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'code', code: 'const x = 2; // **not** bold' }),
    ['```js', 'const x = 2; // **not** bold', '```'],
  );
});

test('a fence long enough to contain backticks is preserved', () => {
  const src = '````markdown\n```\nnested\n```\n````';
  const out = applyBlockEdit(src, { kind: 'code', code: '```\nstill nested\n```' });
  assert.equal(out[0], '````markdown');
  assert.equal(out[out.length - 1], '````');
});

test('a wrapped paragraph commits back as one line, matching how the renderer joins it', () => {
  const src = 'A wrapped paragraph that the renderer\njoins back together with a space.';
  assert.deepEqual(
    applyBlockEdit(src, { kind: 'paragraph', text: 'A wrapped paragraph, now edited and on one line.' }),
    ['A wrapped paragraph, now edited and on one line.'],
  );
});

test('a heading keeps its level and a quote keeps its marker', () => {
  assert.deepEqual(applyBlockEdit('#### deep heading', { kind: 'heading', text: 'still deep' }), ['#### still deep']);
  assert.deepEqual(applyBlockEdit('> a quoted line', { kind: 'quote', text: 'an edited quote' }), ['> an edited quote']);
});

test('a mismatched or unusable read commits NOTHING rather than guessing', () => {
  // The renderer falls back to a <p> for an unrecognized embed fence, so a paragraph read can land on a source
  // block that is not a paragraph. Writing it would destroy the fence.
  assert.equal(applyBlockEdit('```embed\nhttps://example.com/x\n```', { kind: 'paragraph', text: 'oops' }), null);
  assert.equal(applyBlockEdit('- a\n- b', { kind: 'paragraph', text: 'oops' }), null);   // wrong kind for the source
  assert.equal(applyBlockEdit('- a\n- b', { kind: 'list' }), null);                       // no items
  assert.equal(applyBlockEdit('a para\n\nanother para', { kind: 'paragraph', text: 'x' }), null); // range spans 2 blocks
  assert.equal(applyBlockEdit('a para', null), null);
});

test('hr and non-text blocks are not offered for editing', () => {
  for (const tag of ['HR', 'DIV', 'SECTION', 'IMG', 'IFRAME']) assert.ok(!isEditableBlockTag(tag), `${tag} must not be editable`);
  assert.ok(!EDITABLE_BLOCK_TAGS.has('HR'));
});
