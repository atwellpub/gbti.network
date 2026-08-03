// SOW-062 Phase 4: the Markdown <-> block round-trip for the in-house block editor. The repo stays the database,
// so parse->serialize must preserve the body, and the SOW-016 members-only marker must round-trip EXACTLY.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBlocks, serializeBlocks, MEMBERS_MARKER, emptyBlock, CALLOUT_VARIANTS, isHeading, isQuote, isListItem, isFence } from '../client-ui/src/markdown-blocks.mjs';

test('parseBlocks classifies the core block types', () => {
  const md = '# Heading\n\npara line one\npara line two\n\n- a\n- b\n\n> quote\n\n![alt](url.png)';
  const b = parseBlocks(md);
  assert.deepEqual(b.map((x) => x.type), ['heading', 'paragraph', 'list', 'quote', 'image']);
  assert.equal(b[0].level, 1);
  assert.equal(b[0].text, 'Heading');
  assert.equal(b[1].text, 'para line one\npara line two');
  assert.deepEqual(b[2].items, ['a', 'b']);
  assert.equal(b[3].text, 'quote');
  assert.deepEqual([b[4].alt, b[4].url], ['alt', 'url.png']);
});

test('the members-only marker is a first-class block and round-trips EXACTLY (SOW-016)', () => {
  const md = 'Public intro.\n\n<!-- members-only -->\n\nPaid-only section.';
  const blocks = parseBlocks(md);
  assert.deepEqual(blocks.map((x) => x.type), ['paragraph', 'members', 'paragraph']);
  const out = serializeBlocks(blocks);
  assert.ok(out.includes(MEMBERS_MARKER));
  assert.equal(out, md);
});

test('serialize(parse(md)) round-trips a full document verbatim', () => {
  const md = [
    '# Title', '',
    'Intro with **bold** and a [link](https://x.com).', '',
    '## Subhead', '',
    '- one', '- two', '',
    '> a blockquote', '',
    '```js', 'const x = 1;', '```', '',
    MEMBERS_MARKER, '',
    'Members text.',
  ].join('\n');
  assert.equal(serializeBlocks(parseBlocks(md)), md);
});

test('code fence preserves language + body; ordered list renumbers', () => {
  const md = '```python\nprint(1)\nprint(2)\n```\n\n1. first\n2. second';
  const b = parseBlocks(md);
  assert.equal(b[0].type, 'code');
  assert.equal(b[0].lang, 'python');
  assert.equal(b[0].code, 'print(1)\nprint(2)');
  assert.equal(b[1].type, 'list');
  assert.equal(b[1].ordered, true);
  assert.equal(serializeBlocks(b), md);
});

test('round-trip is IDEMPOTENT across repeated edit cycles, and a mid-text marker is NOT a divider', () => {
  const md = [
    'Intro.', '', '<!-- members-only -->', '', '## Members', '', 'Secret one.', '',
    '<!-- members-only -->', '', 'Secret two.',
  ].join('\n');
  const once = serializeBlocks(parseBlocks(md));
  const twice = serializeBlocks(parseBlocks(once));
  assert.equal(once, twice); // editing + re-saving never drifts the body
  assert.equal((once.match(/<!-- members-only -->/g) || []).length, 2); // both markers survive verbatim
  // a marker that is NOT on its own line stays inline text (the Worker splits on the marker LINE), not a divider
  const inline = parseBlocks('text <!-- members-only --> more');
  assert.deepEqual(inline.map((b) => b.type), ['paragraph']);
});

test('empty + marker-only + bare-url embed', () => {
  assert.deepEqual(parseBlocks(''), []);
  assert.deepEqual(parseBlocks(MEMBERS_MARKER).map((x) => x.type), ['members']);
  assert.equal(serializeBlocks([]), '');
  const e = parseBlocks('https://youtu.be/abc');
  assert.deepEqual([e[0].type, e[0].url], ['embed', 'https://youtu.be/abc']);
  assert.equal(emptyBlock('heading').level, 2);
});

test('SOW-062: callout is a fenced block with a variant, round-trips + defaults/normalizes', () => {
  const md = '```callout warning\nHeads up, this matters.\n```';
  const b = parseBlocks(md);
  assert.equal(b[0].type, 'callout');
  assert.equal(b[0].variant, 'warning');
  assert.equal(b[0].text, 'Heads up, this matters.');
  assert.equal(serializeBlocks(b), md); // verbatim round-trip
  assert.equal(parseBlocks('```callout\nx\n```')[0].variant, 'note'); // missing -> note
  assert.equal(parseBlocks('```callout danger\nx\n```')[0].variant, 'note'); // unknown -> note
  assert.equal(emptyBlock('callout').variant, 'note');
});

test('SOW-062: body embed is a fenced block; a legacy bare URL upgrades to the fence on save', () => {
  const md = '```embed\nhttps://youtu.be/abc\n```';
  const b = parseBlocks(md);
  assert.deepEqual([b[0].type, b[0].url], ['embed', 'https://youtu.be/abc']);
  assert.equal(serializeBlocks(b), md); // verbatim round-trip
  // one-time normalization: a legacy bare-URL VIDEO body parses to embed and re-serializes as the fence
  assert.equal(serializeBlocks(parseBlocks('https://youtu.be/abc')), md);
  // SOW-062 5f: a NON-video bare URL stays paragraph text (a link), never a video embed
  assert.deepEqual(parseBlocks('https://turtlapp.com/').map((x) => x.type), ['paragraph']);
  assert.equal(serializeBlocks(parseBlocks('https://turtlapp.com/')), 'https://turtlapp.com/');
});

test('SOW-062: callout/embed do not swallow real code, and idempotence holds with the marker', () => {
  const md = [
    '# Doc', '',
    '```callout info', 'A note with a [link](https://x).', '```', '',
    '<!-- members-only -->', '',
    '```embed', 'https://vimeo.com/12345', '```', '',
    '```js', 'const callout = 1;', '```',
  ].join('\n');
  const once = serializeBlocks(parseBlocks(md));
  const twice = serializeBlocks(parseBlocks(once));
  assert.equal(once, twice); // no drift across edit cycles
  assert.deepEqual(parseBlocks(md).map((b) => b.type), ['heading', 'callout', 'members', 'embed', 'code']); // ```js stays code
  assert.ok(once.includes(MEMBERS_MARKER)); // the marker survives verbatim
});

test('SOW-062: the shortcut regexes are exported for the editor', () => {
  assert.ok(isHeading('## x') && !isHeading('x'));
  assert.ok(isQuote('> x') && !isQuote('x'));
  assert.ok(isListItem('- x') && isListItem('1. x') && !isListItem('x'));
  assert.ok(isFence('```js') && !isFence('x'));
  assert.deepEqual(CALLOUT_VARIANTS, ['info', 'note', 'warning', 'tip']);
});

// The nested-fence rule (CommonMark): a ````markdown block carries ``` fences as CONTENT, and the
// round-trip re-emits a fence longer than any inner run (the /sow skill prompt broke on this in the reader;
// the editor parser had the same defect and would have corrupted the body on save).
test('a 4-backtick fence carries inner ``` fences as content and round-trips', () => {
  const md = '````markdown\n# Skill\n```bash\nmkdir -p .data/sow\n```\ntail\n````';
  const blocks = parseBlocks(md);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].type, 'code');
  assert.equal(blocks[0].lang, 'markdown');
  assert.match(blocks[0].code, /```bash\nmkdir -p \.data\/sow\n```/);
  assert.match(blocks[0].code, /tail$/);
  const back = serializeBlocks(blocks);
  assert.deepEqual(parseBlocks(back), blocks); // idempotent round-trip
  assert.match(back, /^````markdown\n/);
});

// SOW-169: the GFM table block (was rendering as literal pipe text in the visual editor).
test('a GFM table parses into a table block with head, aligns, and rows', () => {
  const md = '| Action | Shortcut |\n| --- | :---: |\n| Toggle | Ctrl+1 |\n| Grow | Ctrl+Right |';
  const b = parseBlocks(md);
  assert.equal(b.length, 1);
  assert.equal(b[0].type, 'table');
  assert.deepEqual(b[0].head, ['Action', 'Shortcut']);
  assert.deepEqual(b[0].aligns, ['', 'center']);
  assert.deepEqual(b[0].rows, [['Toggle', 'Ctrl+1'], ['Grow', 'Ctrl+Right']]);
});

test('a table block round-trips to canonical GFM and back idempotently', () => {
  const md = '| Action | Shortcut |\n| --- | :---: |\n| Toggle | Ctrl+1 |';
  const blocks = parseBlocks(md);
  const back = serializeBlocks(blocks);
  assert.deepEqual(parseBlocks(back), blocks); // stable
  assert.equal(back, '| Action | Shortcut |\n| --- | :---: |\n| Toggle | Ctrl+1 |');
});

test('a table adjacent to paragraphs is split out (upgrade from the old paragraph fallback)', () => {
  const md = 'Intro line.\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\nOutro line.';
  const b = parseBlocks(md);
  assert.deepEqual(b.map((x) => x.type), ['paragraph', 'table', 'paragraph']);
  assert.equal(b[0].text, 'Intro line.');
  assert.equal(b[2].text, 'Outro line.');
});

test('an escaped pipe inside a cell survives the round-trip', () => {
  const md = '| Key | Note |\n| --- | --- |\n| a \\| b | ok |';
  const b = parseBlocks(md);
  assert.deepEqual(b[0].rows, [['a | b', 'ok']]);
  assert.equal(serializeBlocks(b), md);
});

test('emptyBlock("table") is a usable 2x2 starter', () => {
  const t = emptyBlock('table');
  assert.equal(t.type, 'table');
  assert.equal(t.head.length, 2);
  assert.equal(t.rows.length, 2);
  assert.equal(serializeBlocks([t]).split('\n').length, 4); // head + delim + 2 rows
});

test('a pipe line WITHOUT a delimiter row stays a paragraph (not a false table)', () => {
  const md = 'a | b | c is just prose\nsecond line';
  const b = parseBlocks(md);
  assert.equal(b[0].type, 'paragraph');
});

test('a ragged table (rows/delims != header cols) normalizes and round-trips idempotently', () => {
  for (const md of [
    '| A | B |\n| --- |\n| 1 |',                 // short delimiter + short row
    '| A | B |\n| --- | --- |\n| 1 | 2 | 3 |',   // over-long row (extra cell dropped per GFM)
    '| Only |\n| --- | --- |',                   // delimiter wider than header
  ]) {
    const b = parseBlocks(md);
    assert.equal(b[0].type, 'table');
    const cols = b[0].head.length;
    assert.equal(b[0].aligns.length, cols, 'aligns normalized to header width');
    for (const r of b[0].rows) assert.equal(r.length, cols, 'rows normalized to header width');
    assert.deepEqual(parseBlocks(serializeBlocks(b)), b, 'idempotent after normalization');
  }
});
