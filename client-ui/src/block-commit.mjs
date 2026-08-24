// sow-235: committing an edited block from the WorkBench Preview back into the Markdown source.
//
// The Preview renders the body with renderMarkdownWithBlocks (client/src/markdown.mjs), which stamps every emitted
// block with a data-blk index and records that block's SOURCE line range. Editing happens in the rendered DOM, so
// the commit has to turn a block of HTML back into the right number of Markdown lines.
//
// The naive version replaced a block's whole range with ONE line, which is why only single-line paragraphs and
// headings were ever editable: a two-item list would have collapsed to a single bullet and a fenced code block
// would have lost its fences. It also could not have worked, because the rendered HTML does not carry everything
// the Markdown does. A table's column alignment survives only as a style attribute, a fence's language only as a
// class, and a list's ordered-ness only as the tag name.
//
// So the block is rebuilt from its OWN SOURCE rather than from the DOM: re-parse the original range with
// parseBlocks, replace only the text-bearing fields with what the author edited, and re-serialize. Everything the
// DOM cannot express is carried through untouched because it never left the source. parseBlocks/serializeBlocks
// are the doc editor's existing model, reused rather than reimplemented.
import { parseBlocks, serializeBlocks, inlineHtmlToMd } from './markdown-blocks.mjs';

/** Rendered tags the Preview can edit. hr has nothing to edit; a callout/embed renders as a div and is not text. */
export const EDITABLE_BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'TABLE', 'PRE']);

/** A read of kind K may only be written onto a source block of this type. A mismatch means the two parsers
 *  disagree about this range (an embed fence falls back to a <p>, for one), and the commit refuses rather than
 *  writing a paragraph over something that is not one. */
const COMPATIBLE = { paragraph: 'paragraph', heading: 'heading', quote: 'quote', list: 'list', table: 'table', code: 'code' };

export function isEditableBlockTag(tag) {
  return EDITABLE_BLOCK_TAGS.has(String(tag || '').toUpperCase());
}

/**
 * Read the edited block out of the DOM as a plain object. Browser-only and deliberately thin: everything that can
 * be decided without a DOM lives in applyBlockEdit, which is where the tests are.
 */
export function readBlockDom(el) {
  if (!el) return null;
  const tag = String(el.tagName || '').toUpperCase();
  // rendererAnchors: this HTML came from the site renderer, so an anchor wearing its target=_blank rel=noopener
  // reads back as the [text](url) it was authored as instead of raw <a> HTML.
  const md = (html) => inlineHtmlToMd(html, { rendererAnchors: true }).trim();
  const kids = (node, sel) => Array.from(node.querySelectorAll(sel));

  if (tag === 'UL' || tag === 'OL') return { kind: 'list', items: kids(el, 'li').map((li) => md(li.innerHTML)) };
  if (tag === 'PRE') {
    // Code stays literal: no inline transform, and the trailing newline the renderer adds is not content.
    const code = el.querySelector('code') || el;
    return { kind: 'code', code: String(code.textContent ?? '').replace(/\n$/, '') };
  }
  if (tag === 'TABLE') {
    const rows = kids(el, 'tr').map((tr) => Array.from(tr.children).map((c) => md(c.innerHTML)));
    return { kind: 'table', head: rows[0] || [], rows: rows.slice(1) };
  }
  if (tag === 'BLOCKQUOTE') return { kind: 'quote', text: md(el.innerHTML) };
  if (/^H[1-6]$/.test(tag)) return { kind: 'heading', text: md(el.innerHTML) };
  if (tag === 'P') return { kind: 'paragraph', text: md(el.innerHTML) };
  return null;
}

/**
 * Rebuild one block's Markdown from its original source plus the edit read out of the DOM.
 * Returns the replacement LINES, or null when the edit cannot be applied safely (the caller then commits nothing).
 * Pure: no DOM, no I/O.
 */
export function applyBlockEdit(sourceText, read) {
  if (!read || typeof read !== 'object') return null;
  const blocks = parseBlocks(String(sourceText ?? ''));
  // A range that does not parse to exactly one block means the caller's range is wrong, or the two parsers
  // disagree. Either way, guessing here would corrupt neighbouring content.
  if (blocks.length !== 1) return null;
  const b = { ...blocks[0] };
  if (COMPATIBLE[read.kind] !== b.type) return null;

  switch (b.type) {
    case 'list': {
      if (!Array.isArray(read.items)) return null;
      b.items = read.items.slice();
      delete b.text;            // serializeBlock prefers items, but a stale text field is a trap for the next reader
      break;
    }
    case 'table': {
      if (!Array.isArray(read.head)) return null;
      b.head = read.head.slice();
      b.rows = Array.isArray(read.rows) ? read.rows.map((r) => r.slice()) : [];
      break;                    // b.aligns is deliberately NOT touched: it exists only in the source
    }
    case 'code': {
      if (typeof read.code !== 'string') return null;
      b.code = read.code;       // b.lang likewise stays as the source had it
      break;
    }
    default: {
      if (typeof read.text !== 'string') return null;
      b.text = read.text;       // heading keeps its level, quote its marker, from the source
    }
  }
  return serializeBlocks([b]).split('\n');
}
