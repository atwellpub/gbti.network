// SOW-062 Phase 4: a minimal, node-free Markdown <-> block model for the in-house block body editor. The repo
// stays the database (the on-disk body is Markdown), so the editor PARSES the body into typed blocks and
// SERIALIZES them back to Markdown. The SOW-016 `<!-- members-only -->` split marker is a first-class block and
// round-trips EXACTLY (the Worker splits on it at publish). Inline Markdown (bold/links) is left as block text
// (we model block STRUCTURE, not inline), so it round-trips verbatim.

export const MEMBERS_MARKER = '<!-- members-only -->';
export const BLOCK_TYPES = ['paragraph', 'heading', 'code', 'quote', 'list', 'table', 'image', 'embed', 'callout', 'members'];

// SOW-169/SOW-170: GFM table helpers. A table is a header row of `| ... |` cells immediately followed by a
// delimiter row (`| --- | :--: |`), then zero or more body rows. Before this, a table fell into the paragraph
// branch and showed as literal pipes; now it is a first-class `table` block the editor renders as a real table.
const isTableDelimLine = (l) => /^\s*\|?(\s*:?-{1,}:?\s*\|)+\s*:?-{1,}:?\s*\|?\s*$/.test(l) || /^\s*\|(\s*:?-{1,}:?\s*\|)+\s*$/.test(l);
/** Split a `| a | b |` row into trimmed cells, honoring a `\|` escaped pipe. */
function splitTableRow(line) {
  let s = String(line).trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}
/** The column alignment from a delimiter spec (`:--`, `--:`, `:-:`, `--`). */
function tableAlign(spec) {
  const s = String(spec).trim();
  const l = s.startsWith(':'); const r = s.endsWith(':');
  return l && r ? 'center' : r ? 'right' : l ? 'left' : '';
}
/** A table begins where a pipe-bearing line is immediately followed by a delimiter row. */
const isTableStart = (lines, i) => i + 1 < lines.length && lines[i].includes('|') && isTableDelimLine(lines[i + 1]);

// SOW-062 Phase 5: callout + body embed are stored as FENCED blocks (```callout <variant> / ```embed) so they
// reuse the same fence machinery, round-trip idempotently, and survive the reader's escape-first renderer. Members
// stays the exact marker line (the Worker splits on it). A code block whose FIRST info token is exactly "callout"
// or "embed" becomes that block; any other language stays a code block.
export const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
const normalizeVariant = (v) => (CALLOUT_VARIANTS.includes(v) ? v : 'note');

// Exported so the editor's Markdown shortcuts share ONE definition with the parser (no drift).
export const isMarker = (l) => l.trim() === MEMBERS_MARKER;
export const isFence = (l) => /^```/.test(l);
export const isHeading = (l) => /^#{1,6}\s+/.test(l);
export const isQuote = (l) => /^>\s?/.test(l);
export const isListItem = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
const isImageOnly = (l) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l);
const isBareUrl = (l) => /^https?:\/\/\S+$/.test(l.trim());
// SOW-062 5f: a bare-URL line is an EMBED only if it is a recognized video (YouTube/Vimeo). Any other bare URL is
// ordinary paragraph text (a link), never a video-embed block -- otherwise a plain link would render as a locked
// video frame and migrate into a misleading ```embed fence.
const isVideoUrl = (l) => /(?:youtube\.com|youtu\.be|vimeo\.com)/i.test(l);

/** Serialize a block list to Markdown (blocks joined by a blank line). */
export function serializeBlocks(blocks) {
  return (Array.isArray(blocks) ? blocks : []).map(serializeBlock).join('\n\n');
}

function serializeBlock(b) {
  if (!b || typeof b !== 'object') return '';
  switch (b.type) {
    case 'members': return MEMBERS_MARKER;
    case 'heading': return `${'#'.repeat(Math.min(6, Math.max(1, b.level || 2)))} ${b.text ?? ''}`;
    case 'code': {
      // The fence must be LONGER than any backtick run in the code, or a nested ``` closes it early.
      const code = b.code ?? '';
      const runs = code.match(/^`{3,}/gm) || [];
      const fence = '`'.repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
      return fence + (b.lang ?? '') + '\n' + code + '\n' + fence;
    }
    case 'callout': return '```callout ' + normalizeVariant(b.variant) + '\n' + (b.text ?? '') + '\n```';
    case 'quote': return String(b.text ?? '').split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n');
    case 'list': {
      const items = Array.isArray(b.items) ? b.items : String(b.text ?? '').split('\n').filter((x) => x !== '');
      return items.map((it, i) => (b.ordered ? `${i + 1}. ` : '- ') + it).join('\n');
    }
    case 'table': {
      const head = Array.isArray(b.head) ? b.head : [];
      const aligns = Array.isArray(b.aligns) ? b.aligns : [];
      const rows = Array.isArray(b.rows) ? b.rows : [];
      const cols = Math.max(1, head.length);
      const cell = (c) => String(c ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
      const pad = (arr) => { const a = arr.slice(0, cols); while (a.length < cols) a.push(''); return a; };
      const line = (cells) => '| ' + pad(cells).map(cell).join(' | ') + ' |';
      const delim = '| ' + pad(head).map((_, i) => {
        const a = aligns[i] || '';
        return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---';
      }).join(' | ') + ' |';
      return [line(head), delim, ...rows.map(line)].join('\n');
    }
    case 'image': return `![${b.alt ?? ''}](${b.url ?? ''})`;
    case 'embed': return '```embed\n' + (b.url ?? '') + '\n```';
    case 'paragraph':
    default: return String(b.text ?? '');
  }
}

/** Parse a Markdown body into typed blocks. Line-based; the members marker is preserved exactly. */
export function parseBlocks(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const blocks = [];
  const n = lines.length;
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; } // blank = block separator
    if (isMarker(line)) { blocks.push({ type: 'members' }); i++; continue; }
    if (isFence(line)) {
      // CommonMark: a fence closes only on a fence of >= the OPENING length with no info string, so a
      // ````markdown block can carry ``` fences as CONTENT (same rule as client/src/markdown.mjs; without
      // it the editor mis-parses a nested-fence body and corrupts it on save).
      const open = /^(`{3,})(.*)$/.exec(line);
      const fenceLen = open[1].length;
      const lang = open[2].trim();
      const info = lang.split(/\s+/);
      const code = [];
      i++;
      while (i < n) {
        const close = /^(`{3,})\s*$/.exec(lines[i]);
        if (close && close[1].length >= fenceLen) break;
        code.push(lines[i]); i++;
      }
      i++; // skip the closing fence
      // SOW-062: ```callout <variant> and ```embed are first-class blocks; anything else stays a code block.
      if (info[0] === 'callout') blocks.push({ type: 'callout', variant: normalizeVariant(info[1]), text: code.join('\n') });
      else if (info[0] === 'embed') blocks.push({ type: 'embed', url: code.join('\n').trim() });
      else blocks.push({ type: 'code', lang, code: code.join('\n') });
      continue;
    }
    let m = line.match(/^(#{1,6})\s+(.*)$/);
    if (m) { blocks.push({ type: 'heading', level: m[1].length, text: m[2] }); i++; continue; }
    if (isQuote(line)) {
      const q = [];
      while (i < n && isQuote(lines[i])) { q.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ type: 'quote', text: q.join('\n') });
      continue;
    }
    if (isListItem(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (i < n && isListItem(lines[i])) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '')); i++; }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }
    // SOW-169: a GFM table = a header row with pipes immediately followed by a delimiter row. Body rows continue
    // while they carry pipes and start no other block. This is what stops a table rendering as literal pipe text.
    if (isTableStart(lines, i)) {
      const head = splitTableRow(lines[i]);
      const cols = Math.max(1, head.length);
      // Normalize aligns + every row to the header column count so parse(serialize(x)) === x (idempotent). GFM
      // uses the header to fix the column count: a short row pads, an over-long row truncates.
      const aligns = splitTableRow(lines[i + 1]).map(tableAlign).slice(0, cols);
      while (aligns.length < cols) aligns.push('');
      i += 2;
      const rows = [];
      while (i < n && lines[i].trim() !== '' && lines[i].includes('|')
        && !isMarker(lines[i]) && !isFence(lines[i]) && !isHeading(lines[i]) && !isQuote(lines[i])) {
        const row = splitTableRow(lines[i]).slice(0, cols);
        while (row.length < cols) row.push('');
        rows.push(row); i++;
      }
      blocks.push({ type: 'table', head, aligns, rows });
      continue;
    }
    m = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
    if (m) { blocks.push({ type: 'image', alt: m[1], url: m[2] }); i++; continue; }
    if (isBareUrl(line) && isVideoUrl(line)) { blocks.push({ type: 'embed', url: line.trim() }); i++; continue; }
    // paragraph: consecutive lines that start no other block
    const para = [];
    while (i < n) {
      const l = lines[i];
      if (l.trim() === '' || isMarker(l) || isFence(l) || isHeading(l) || isQuote(l) || isListItem(l) || isImageOnly(l) || (isBareUrl(l) && isVideoUrl(l)) || isTableStart(lines, i)) break;
      para.push(l); i++;
    }
    if (para.length) blocks.push({ type: 'paragraph', text: para.join('\n') });
    else i++; // safety: never spin
  }
  return blocks;
}

/** Convenience: a fresh empty block of a type (for the editor's add/convert). */
export function emptyBlock(type) {
  switch (type) {
    case 'heading': return { type: 'heading', level: 2, text: '' };
    case 'code': return { type: 'code', lang: '', code: '' };
    case 'quote': return { type: 'quote', text: '' };
    case 'list': return { type: 'list', ordered: false, items: [''] };
    case 'table': return { type: 'table', head: ['Column 1', 'Column 2'], aligns: ['', ''], rows: [['', ''], ['', '']] };
    case 'image': return { type: 'image', alt: '', url: '' };
    case 'embed': return { type: 'embed', url: '' };
    case 'callout': return { type: 'callout', variant: 'note', text: '' };
    case 'members': return { type: 'members' };
    default: return { type: 'paragraph', text: '' };
  }
}

// SOW-062 Phase 6: the INLINE presentation transform at the DOM boundary. The block model carries Markdown in
// b.text; the WYSIWYG renders it as inline HTML (bold/italic/code/link/strike) in a contenteditable, then reads it
// back to Markdown on edit. Block STRUCTURE (headings/lists/fences/the members marker) is NOT their concern -- these
// only handle the inline layer. Pure + node-safe, exported so the editor and its round-trip test share one copy.
// SOW-170: an attributed link (nofollow / open-in-new-tab) cannot be expressed as `[text](url)` Markdown, so it is
// carried as sanitized raw <a> HTML in the body. The sow-158 SITE sanitizer already permits `target` + `rel`
// (nofollow/noopener/noreferrer) on <a>, so a stored raw anchor renders correctly on the published page. A PLAIN
// link (no rel/target) stays `[text](url)`. These helpers keep both forms round-tripping idempotently.
const REL_ALLOWED = new Set(['nofollow', 'noopener', 'noreferrer']);
const DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript):/i;
// A URL is dangerous if it names a script/data scheme, even when obfuscated with entities (numeric or named) or
// with embedded control/whitespace characters ("java\tscript:"). The published site's sow-158 sanitizer is the
// real boundary, but the editor must never mint such a link into the live DOM or the stored body either.
export function isDangerousUrl(url) {
  const decoded = decodeEnt(String(url ?? '')).replace(/[\x00-\x20]+/g, '');
  return DANGEROUS_SCHEME.test(decoded) || DANGEROUS_SCHEME.test(String(url ?? ''));
}
/** Keep only allow-listed, de-duplicated rel tokens (mirrors the sow-158 sanitizer allow-list). */
function sanitizeRel(rel) {
  const kept = [];
  for (const tok of String(rel || '').trim().split(/\s+/)) {
    const t = tok.toLowerCase();
    if (REL_ALLOWED.has(t) && !kept.includes(t)) kept.push(t);
  }
  return kept;
}
const attrOf = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(String(attrs || '')); return m ? m[1] : ''; };
const decodeEntOnce = (s) => String(s ?? '')
  .replace(/&#x([0-9a-f]+);?/gi, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
  .replace(/&#(\d+);?/g, (_m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
  .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
// Decode to a fixed point (capped) so a double-encoded scheme like `&amp;#106;avascript:` cannot slip past the
// dangerous-URL check by needing two passes. The cap bounds the work; real hrefs settle in one pass.
const decodeEnt = (s) => { let p = String(s ?? ''); for (let i = 0; i < 4; i += 1) { const n = decodeEntOnce(p); if (n === p) break; p = n; } return p; };
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Parse an <a>'s attribute string into a safe, DECODED link shape. `attributed` is true when it needs raw-HTML form. */
function parseLinkAttrs(attrs) {
  const rawHref = decodeEnt(attrOf(attrs, 'href'));
  const href = isDangerousUrl(rawHref) ? '' : rawHref;
  const rel = sanitizeRel(attrOf(attrs, 'rel'));
  const blank = attrOf(attrs, 'target').toLowerCase() === '_blank';
  if (blank && !rel.includes('noopener')) rel.push('noopener'); // target=_blank must carry noopener (tab-nabbing)
  return { href, rel, blank, attributed: rel.length > 0 || blank };
}
// An attributed link's inner content is preserved verbatim so nested marks (<strong>/<em>/<code>) survive, but a
// crafted inner must never smuggle a script/style/iframe/handler into the stored body or the editor DOM. Keep ONLY
// safe inline tags (stripping their attributes too) and drop every other tag, leaving its text. The published-site
// sanitizer is still the real boundary; this is defense-in-depth so the stored .md never carries an active tag.
const SAFE_INNER_TAG = /^(?:strong|b|em|i|code|s|del|br)$/i;
function sanitizeInner(html) {
  return String(html ?? '').replace(/<(\/?)([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi,
    (_m, slash, tag) => (SAFE_INNER_TAG.test(tag) ? `<${slash}${tag.toLowerCase()}>` : ''));
}
/** The ONE canonical sanitized raw-<a> HTML for an attributed link (href already decoded), used on BOTH sides. */
function rawAnchor(href, rel, blank, inner) {
  const relAttr = rel.length ? ` rel="${rel.join(' ')}"` : '';
  const tgtAttr = blank ? ' target="_blank"' : '';
  return `<a href="${escAttr(href)}"${relAttr}${tgtAttr}>${sanitizeInner(inner)}</a>`;
}

export function inlineMdToHtml(md) {
  let src = String(md ?? '');
  const keep = [];
  // Preserve author-written attributed links (raw <a rel/target>) across the escape pass, re-sanitized to canonical.
  src = src.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, inner) => {
    const a = parseLinkAttrs(attrs);
    keep.push(a.href ? rawAnchor(a.href, a.rel, a.blank, inner) : inner);
    return `\u0000A${keep.length - 1}\u0000`;
  });
  // Escape the URL before it goes into the href attribute (& < > are already escaped above; the double-quote is
  // not, so an unescaped " would break out of href=""), and neutralize dangerous URL schemes.
  let h = src.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) =>
    isDangerousUrl(url) ? text : `<a href="${String(url).replace(/"/g, '&quot;').replace(/'/g, '&#39;')}">${text}</a>`);
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  h = h.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  h = h.replace(/~~([^~]+)~~/g, '<s>$1</s>');
  h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
  h = h.replace(/\n/g, '<br>');
  return h.replace(/\u0000A(\d+)\u0000/g, (_m, i) => keep[Number(i)] ?? ''); // restore the protected anchors
}
export function inlineHtmlToMd(html, { rendererAnchors = false } = {}) {
  let s = String(html ?? '');
  const keep = [];
  // Links: a plain link -> `[text](url)`; an attributed link (rel/target) -> the canonical sanitized raw <a> HTML,
  // protected from the tag-strip + entity-decode below by a placeholder so it survives verbatim.
  s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, inner) => {
    const a = parseLinkAttrs(attrs);
    if (!a.href) return inner;                       // dangerous/empty href -> drop the link, keep the text
    if (!a.attributed) return `[${inner}](${a.href})`;
    // rendererAnchors: the caller's HTML came from the SITE renderer, not from an author. client/src/markdown.mjs
    // decorates every markdown link with exactly target="_blank" rel="noopener", so an anchor wearing precisely
    // that pair, around plain text, WAS `[text](url)` and must read back as one. Without this the Preview's
    // edit-in-place rewrites an author's markdown link into raw <a> HTML. Off by default: the doc editor feeds
    // this its own author-written anchors, where target=_blank is intent to preserve (see test/inline-md.test.mjs).
    const rendererShaped = a.blank && a.rel.length === 1 && a.rel[0] === 'noopener' && !/</.test(inner);
    if (rendererAnchors && rendererShaped) return `[${inner}](${a.href})`;
    keep.push(rawAnchor(a.href, a.rel, a.blank, inner));
    return `\u0000A${keep.length - 1}\u0000`;
  });
  s = s.replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**');
  s = s.replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
  s = s.replace(/<(s|strike|del)>([\s\S]*?)<\/\1>/gi, '~~$2~~');
  s = s.replace(/<code>([\s\S]*?)<\/code>/gi, '`$1`');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<div>/gi, '\n').replace(/<\/div>/gi, ''); // contenteditable wraps soft lines in <div>
  s = s.replace(/<[^>]+>/g, ''); // drop any stray markup (paste is hardened; nothing else should appear)
  // Decode NON-anchor text. &quot; and &#39; were missing, so an edited paragraph containing a double quote stored
  // the literal string "&quot;", which re-renders to &amp;quot; and shows the entity to the reader. &amp; stays LAST
  // so an author's own "&amp;quot;" still decodes to "&quot;" rather than collapsing to a quote character.
  s = s.replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&(?:apos|#0*39);/gi, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return s.replace(/\u0000A(\d+)\u0000/g, (_m, i) => keep[Number(i)] ?? ''); // restore anchors AFTER the decode
}
