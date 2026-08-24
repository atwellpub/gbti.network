// The WorkBench Preview edits a paragraph in place: it renders the body with renderMarkdownWithBlocks, lets the
// author type into the rendered block, then reads that block back with inlineHtmlToMd and splices the result over
// the block's source line (src/pages/workbench/preview.astro commitBlock). That only works if the SITE renderer and
// inlineHtmlToMd are inverses of each other. They were not, and nothing tested the pair: test/inline-md.test.mjs
// guards inlineMdToHtml <-> inlineHtmlToMd, which is a DIFFERENT pair used by the doc editor.
//
// Two failures fell out of the gap. A markdown link came back as raw <a> HTML, and a double quote came back as the
// literal string &quot;, which re-renders to &amp;quot; and shows the entity to the reader. Because commitBlock
// compares the read-back to the source as a raw string, both also made a click-through look like an edit: the body
// was rewritten and re-rendered under the author's next click, which is why clicking a paragraph appeared to do
// nothing. Pure + node-safe (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownWithBlocks } from '../client/src/markdown.mjs';
import { inlineHtmlToMd } from '../client-ui/src/markdown-blocks.mjs';

// Mirror of what commitBlock does for ONE block, minus the DOM: take the rendered inner HTML of a block and read it
// back to the markdown that should be spliced over its source line.
const readBack = (inner, before) => {
  const prefix = /^(\s{0,3}(?:#{1,6}\s+|>\s?|[-*]\s+|\d+\.\s+))/.exec(before);
  return (prefix ? prefix[1] : '') + inlineHtmlToMd(inner, { rendererAnchors: true }).trim();
};

// Every wired block, as { line, source, inner }. wireEditing only wires a single-source-line P or H block, because
// commitBlock replaces a block's whole range with one line, so that is exactly the set under test.
function wiredBlocks(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const { html, blocks } = renderMarkdownWithBlocks(body);
  const out = [];
  const re = /<(p|h[1-6])\b([^>]*\bdata-blk="(\d+)"[^>]*)>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html))) {
    const range = blocks[Number(m[3])];
    if (!range || range.start !== range.end) continue;
    out.push({ line: range.start + 1, source: lines[range.start], inner: m[4] });
  }
  return out;
}

const FIXTURE = [
  'A plain sentence with nothing special in it.',
  '',
  'Ceilings rather than reservations, which is not what "load balancing" describes.',
  '',
  "I've had an ASRock H110 Pro BTC+ in the closet since Ethereum was proof of work.",
  '',
  '[Proxmox VE](https://www.proxmox.com/en/proxmox-virtual-environment/overview) is a Debian-based platform.',
  '',
  'Read **the docs** at [SavePoint](https://savepoint.fm) and run `pct enter 101` to get a shell.',
  '',
  '## What LXC is, and how it differs from a "virtual machine"',
  '',
  'Ampersands & angle brackets like <not-a-tag> must survive the trip too.',
].join('\n');

test('every wired Preview block reads back to its exact source line', () => {
  const wired = wiredBlocks(FIXTURE);
  assert.equal(wired.length, 7, 'fixture should wire 7 single-line blocks; the guard is worthless if it wires none');
  for (const b of wired) {
    assert.equal(readBack(b.inner, b.source), b.source, `line ${b.line} did not survive the round trip`);
  }
});

test('a click-through commits nothing: the read-back equals the source for every block', () => {
  // This is the dropped-click defect stated as data. commitBlock treats read-back !== source as an edit, rewrites
  // the body and re-renders the whole document, destroying the node the author is clicking next.
  const mismatched = wiredBlocks(FIXTURE).filter((b) => readBack(b.inner, b.source) !== b.source);
  assert.deepEqual(mismatched.map((b) => b.line), [], 'these lines would be rewritten by a click-through');
});

test('a double quote survives as a quote, not as an entity the reader can see', () => {
  const [block] = wiredBlocks('He called it "load balancing".');
  assert.equal(readBack(block.inner, block.source), 'He called it "load balancing".');
});

test('a markdown link stays markdown rather than becoming raw anchor HTML', () => {
  const src = '[Proxmox VE](https://www.proxmox.com/) is Debian-based.';
  const [block] = wiredBlocks(src);
  assert.equal(readBack(block.inner, block.source), src);
});

test('a heading keeps its hashes and its inline content', () => {
  const src = '## What LXC is, and how it differs from a "virtual machine"';
  const [block] = wiredBlocks(src);
  assert.equal(readBack(block.inner, block.source), src);
});
