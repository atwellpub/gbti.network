// Minimal, dependency-free Markdown renderer for the CMS LOCAL PREVIEW (SOW-006). This is an approximate
// preview for authoring convenience; the authoritative render is the Astro site build. It escapes HTML
// first (the preview is shown in the local CMS, but we still never inject raw input), then handles the
// common blocks (headings, lists, blockquotes, fenced code, hr, paragraphs) and inline (code, links, bold,
// italic). Pure + unit-testable.
// SOW-062 Phase 5d: also renders the ```callout / ```embed body blocks (the shared embedUrl gives a safe iframe src).
import { embedUrl } from './video-embed.mjs';

// SOW-092: the https video relay. public/_headers gives /embed the one policy on the site whose
// frame-ancestors admits chrome-extension:, so an extension page may frame it.
const EMBED_RELAY = 'https://gbti.network/embed/';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Attributed <a> passthrough for prose lines (headings/paragraphs/lists/quotes/cells): an independent copy of
// client-ui/src/markdown-blocks.mjs's rawAnchor/parseLinkAttrs, not an import of it, because this file is the
// dependency-free renderer the client/ npm package publishes standalone (its package.json "files" ships only
// client/src, never client-ui/). A stored body only ever carries raw <a> HTML for a link the doc editor's
// link tool attributed with nofollow and/or open-in-new-tab (a plain link stays `[text](url)`), so this lets
// that raw form survive the escape pass below instead of showing as literal tag text, matching how the
// sow-158 site sanitizer already renders it on the published page. Code fences, callouts, and embed URLs
// deliberately keep using the plain escapeHtml above: their content is literal source or an attribute value,
// never author prose that could carry a link.
const REL_ALLOWED = new Set(['nofollow', 'noopener', 'noreferrer']);
const DANGEROUS_SCHEME = /^\s*(?:javascript|data|vbscript):/i;
function decodeEntities(s) {
  let p = String(s ?? '');
  for (let i = 0; i < 4; i++) {
    const n = p.replace(/&#x([0-9a-f]+);?/gi, (_m, h) => { try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; } })
      .replace(/&#(\d+);?/g, (_m, d) => { try { return String.fromCodePoint(parseInt(d, 10)); } catch { return ''; } })
      .replace(/&amp;/gi, '&');
    if (n === p) break;
    p = n;
  }
  return p;
}
// A decoded scheme check catches an obfuscated "javascript:" hiding behind entities before it ever reaches href.
const isDangerousAnchorHref = (url) => {
  const decoded = decodeEntities(url).replace(/[\x00-\x20]+/g, '');
  return DANGEROUS_SCHEME.test(decoded) || DANGEROUS_SCHEME.test(String(url ?? ''));
};
const attrOf = (attrs, name) => { const m = new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(String(attrs || '')); return m ? m[1] : ''; };
const escAttr = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Bold and italic, in ONE place: inline() applies it to ordinary text, and rawAnchorHtml applies it to the
// inner text of a raw <a>. Both need it, because the site's remark pipeline parses markdown INSIDE inline
// HTML (CommonMark requires it), so `<a href="x">**Name**</a>` publishes as a bold link. This renderer draws
// the preview, so any rule it applies in one place and not the other makes the preview lie about the page.
// The strong run admits a SINGLE star inside it (`\*(?!\*)`) so italic nested in bold parses; a plain
// `[^*]+` stopped at the inner star, left the run unmatched, and published the asterisks as literal text.
// The leading `(?!\*)` keeps `***x***` on the italic-of-bold path it already took.
function emphasis(t) {
  return String(t)
    .replace(/\*\*(?!\*)((?:[^*]|\*(?!\*))+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
}
const SAFE_INNER_TAG = /^(?:strong|b|em|i|code|s|del|br)$/i;
const sanitizeAnchorInner = (html) => String(html ?? '').replace(/<(\/?)([a-z][a-z0-9]*)(?:\s[^>]*)?>/gi,
  (_m, slash, tag) => (SAFE_INNER_TAG.test(tag) ? `<${slash}${tag.toLowerCase()}>` : ''));
/** The canonical sanitized raw-<a> HTML for an author-attributed link (mirrors markdown-blocks.mjs's rawAnchor). */
function rawAnchorHtml(attrs, inner) {
  const href = decodeEntities(attrOf(attrs, 'href'));
  if (!href || isDangerousAnchorHref(href)) return emphasis(sanitizeAnchorInner(inner)); // drop the link, keep safe text
  const rel = [];
  for (const tok of attrOf(attrs, 'rel').toLowerCase().split(/\s+/)) if (REL_ALLOWED.has(tok) && !rel.includes(tok)) rel.push(tok);
  const blank = attrOf(attrs, 'target').toLowerCase() === '_blank';
  if (blank && !rel.includes('noopener')) rel.push('noopener'); // target=_blank must carry noopener (tab-nabbing)
  const relAttr = rel.length ? ` rel="${rel.join(' ')}"` : '';
  const tgtAttr = blank ? ' target="_blank"' : '';
  // Sanitize first (strip any tag that is not on the safe list), THEN emphasize, so the <strong>/<em> this
  // emits are ours by construction and never pass back through the tag stripper.
  return `<a href="${escAttr(href)}"${relAttr}${tgtAttr}>${emphasis(sanitizeAnchorInner(inner))}</a>`;
}
// Extracts + sanitizes raw <a> tags from the RAW (pre-escape) line into `keep`, swapped for a placeholder the
// escape pass cannot mangle, then escapes everything else exactly as escapeHtml always has. `keep` is threaded
// in from renderMarkdown so one array collects every anchor found across the whole document for one final
// restoration pass at the end (the same protect-placeholder-restore shape inline() already uses for code spans).
function escapeKeepingLinks(s, keep) {
  const stripped = String(s ?? '').replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_m, attrs, inner) => {
    keep.push(rawAnchorHtml(attrs, inner));
    return `${keep.length - 1}`;
  });
  return escapeHtml(stripped);
}

// GFM footnote ids: alnum/dash/underscore only, so an id can never carry markdown punctuation (which the
// later bold/italic passes would rewrite inside the emitted attributes) or need attribute escaping.
const FN_ID = '[A-Za-z0-9_-]+';

// Pre-scan for footnote DEFINITION ids (skipping fenced code), so references convert only when their
// definition exists: like remark-gfm on the site, [^9] with no [^9]: line stays literal text, and
// [^word](url) falls through to the normal link rule.
function collectFootnoteIds(lines) {
  const ids = new Set();
  let fence = 0;
  for (const line of lines) {
    const f = /^(`{3,})(.*)$/.exec(line);
    if (f) {
      if (!fence) fence = f[1].length;
      else if (f[1].length >= fence && !f[2].trim()) fence = 0;
      continue;
    }
    if (fence) continue;
    const d = new RegExp(`^\\[\\^(${FN_ID})\\]:`).exec(line);
    if (d) ids.add(d[1]);
  }
  return ids;
}

// Inline formatting. Input is ALREADY HTML-escaped, so only markdown punctuation remains to transform.
// `fn` = { ids, counts } footnote state threaded from renderMarkdown (null when footnotes are off).
function inline(escaped, fn = null) {
  let t = escaped;
  // Code spans first, as PLACEHOLDERS: their content must stay literal for every later rule (a `[^1]` or
  // `**x**` inside backticks is being quoted, not used). Restored after all other passes.
  const codes = [];
  t = t.replace(/`([^`]+)`/g, (_m, c) => { codes.push(c); return `\uE000${codes.length - 1}\uE001`; });
  // GFM footnote references [^1] -> a superscript anchor down to the definition (the site build renders the
  // same syntax via remark-gfm; this keeps the reader/preview in step). Repeat references get GFM's
  // disambiguated ids (fnref-1, fnref-1-2, ...), so the definition's back arrows can return to each.
  if (fn) {
    t = t.replace(new RegExp(`\\[\\^(${FN_ID})\\](?!:)`, 'g'), (m, id) => {
      if (!fn.ids.has(id)) return m;
      const n = (fn.counts.get(id) ?? 0) + 1;
      fn.counts.set(id, n);
      return `<sup class="md-fnref"><a href="#fn-${id}" id="fnref-${id}${n > 1 ? `-${n}` : ''}">${id}</a></sup>`;
    });
  }
  // Images BEFORE links (the syntaxes nest). Alt may be empty (![](...)). Accepted srcs: absolute http(s),
  // site-absolute /..., and repo-relative ./... (the reader pre-resolves relatives to a CDN URL; an
  // unresolved relative still renders as an img and fails visibly rather than as literal markdown text).
  t = t.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+|\.?\/[^\s)]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}" loading="lazy">`);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, txt, url) => `<a href="${url}" target="_blank" rel="noopener">${txt}</a>`);
  t = emphasis(t);
  t = t.replace(/\uE000(\d+)\uE001/g, (_m, i) => `<code>${codes[Number(i)] ?? ''}</code>`);
  return t;
}

// A fenced-code language tag -> a safe `language-x` class + data-lang attribute (consumed by the reader's code
// card for the language label + per-language styling). Only the first token after the fence is used, lowercased
// and reduced to a safe charset; an unknown/empty tag yields no class.
function codeOpen(lang) {
  const tag = String(lang || '').trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9+#.-]/g, '');
  return tag ? `<pre><code class="language-${tag}" data-lang="${tag}">` : '<pre><code>';
}

// SOW-062 Phase 5d: a fence whose info string starts with `callout` or `embed` renders as a callout box / a safe
// provider iframe instead of a code block; everything else stays a normal code block. HTML is still escaped, and the
// iframe src is a NORMALIZED provider URL (never author HTML), so no author script executes.
const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
function renderFence(lang, buf, fn = null) {
  const info = String(lang || '').trim().split(/\s+/);
  const body = buf.join('\n');
  if (info[0] === 'callout') {
    const v = CALLOUT_VARIANTS.includes(info[1]) ? info[1] : 'note';
    const html = body.split('\n').map((l) => inline(escapeHtml(l), fn)).join('<br/>');
    return `<div class="md-callout md-callout-${v}"><div class="md-callout-body">${html}</div></div>`;
  }
  if (info[0] === 'embed') {
    const url = body.trim();
    // Frame the SOW-092 relay, never the provider directly. This renderer only ever runs off-https (the
    // extension's chrome-extension:// pages, the npm CMS on localhost), and neither can send YouTube an HTTP
    // Referer, which YouTube rejects with its error 153. The relay's https origin vouches for the request, the
    // same way gbti-reader and gbti-shares-feed already do. embedUrl still gates it, so an unrecognized URL
    // stays a plain link and no ?u= is minted for something the relay would refuse to play anyway.
    const src = embedUrl(url);
    if (src) return `<div class="md-embed"><iframe src="${escapeHtml(`${EMBED_RELAY}?u=${encodeURIComponent(url)}`)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen title="Embedded video"></iframe></div>`;
    return `<p><a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a></p>`;
  }
  return `${codeOpen(lang)}${escapeHtml(body)}</code></pre>`;
}

// GFM tables. Split a row on UNESCAPED pipes, dropping the optional leading/trailing pipe. A manual scan
// rather than a lookbehind regex, so the bundle stays safe on older Safari; `\|` becomes a literal pipe.
// Matching GFM, a pipe inside a code span DOES split a cell unless it is escaped.
export function splitTableRow(line) {
  const s = String(line).trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (ch === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** A GFM delimiter row: every cell is `-`, `:-`, `-:` or `:-:`. Returns per-column alignment, or null. */
export function tableAlignments(line) {
  if (!/\|/.test(String(line ?? ''))) return null;
  const cells = splitTableRow(line);
  if (!cells.length || cells.some((c) => !/^:?-+:?$/.test(c))) return null;
  return cells.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
}

/**
 * sow-235: render a document AND report where each emitted block came from in the source.
 *
 * The WorkBench preview needs to make one block editable without giving up the guarantee that it renders
 * exactly like the published page. Three cheaper approaches were tried and each fails:
 *   - rendering block by block loses footnote references, since `[^1]` only resolves against a document
 *     that also carries its definition;
 *   - matching rendered elements to `parseBlocks` output by position does not hold, because the two parse
 *     independently and the footnote section corresponds to no source block;
 *   - injecting `<!--blk:N-->` sentinels does not survive, because raw HTML is escaped to text.
 *
 * So the renderer that actually produces the DOM reports its own boundaries. `blocks[n]` gives the
 * inclusive source line range for the nth emitted block, and with `ids` on, each block carries
 * `data-blk="n"`. An ATTRIBUTE rather than an extra element, so nothing reflows.
 *
 * @returns {{ html: string, blocks: Array<{start:number,end:number}|null> }} null range = synthesized
 *          (the footnotes section), which has no source lines and is not editable.
 */
export function renderMarkdownWithBlocks(md) {
  return renderDoc(md, true);
}

export function renderMarkdown(md) {
  return renderDoc(md, false).html;
}

function renderDoc(md, ids) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const ranges = [];
  // Stamp the block index onto the emitted element's opening tag. Attribute only: an added element would
  // change layout and break the very equivalence this exists to preserve.
  const stamp = (html, n) => (ids ? String(html).replace(/^(\s*<[a-zA-Z][a-zA-Z0-9-]*)/, `$1 data-blk="${n}"`) : html);
  const emit = (html, start, end) => { out.push(stamp(html, out.length)); ranges.push(start == null ? null : { start, end }); };
  let codeFence = 3;
  let fenceStart = 0;   // sow-235: first line of the open fence, for its source range
  let listStart = null; // first line of the run of list items being gathered
  let inCode = false;
  let codeBuf = [];
  let codeLang = '';
  let listType = null;
  let listBuf = [];
  const footnotes = []; // GFM footnote definitions, rendered as one section at the end (like the site build)
  const fn = { ids: collectFootnoteIds(lines), counts: new Map() }; // known def ids + per-id reference counts
  const linkKeep = []; // attributed <a> tags extracted by escapeKeepingLinks, restored in one pass at the end
  const flushList = () => {
    if (listType) {
      emit(`<${listType}>${listBuf.join('')}</${listType}>`, listStart, i - 1);
      listType = null;
      listBuf = [];
      listStart = null;
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(`{3,})(.*)$/.exec(line);
    if (fence) {
      if (!inCode) { inCode = true; fenceStart = i; codeBuf = []; codeFence = fence[1].length; codeLang = fence[2]; i++; continue; }
      // CommonMark: a fence closes only on a fence of >= the OPENING length with no info string, so a
      // ````markdown block can carry ``` fences as CONTENT (the /ci skill prompt broke on this).
      if (fence[1].length >= codeFence && !fence[2].trim()) { inCode = false; flushList(); emit(renderFence(codeLang, codeBuf, fn), fenceStart, i); codeLang = ''; i++; continue; }
      codeBuf.push(line); i++; continue;
    }
    if (inCode) { codeBuf.push(line); i++; continue; }

    // A GFM footnote definition ([^1]: text, continuations indented 4+ spaces). Collected, not emitted in
    // place: the rendered section belongs at the document end, matching the authoritative site render.
    const def = new RegExp(`^\\[\\^(${FN_ID})\\]:\\s?(.*)$`).exec(line);
    if (def) {
      flushList();
      const parts = [def[2].trim()];
      i++;
      while (i < lines.length && /^ {4,}\S/.test(lines[i])) { parts.push(lines[i].trim()); i++; }
      footnotes.push({ id: def[1], html: parts.map((p) => inline(escapeHtml(p), fn)).join('<br/>') });
      continue;
    }

    const esc = escapeKeepingLinks(line, linkKeep);
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(esc))) { flushList(); emit(`<h${m[1].length}>${inline(m[2], fn)}</h${m[1].length}>`, i, i); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (listType !== 'ul') { flushList(); listType = 'ul'; listStart = i; } listBuf.push(`<li>${inline(escapeKeepingLinks(line.replace(/^\s*[-*]\s+/, ''), linkKeep), fn)}</li>`); i++; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { if (listType !== 'ol') { flushList(); listType = 'ol'; listStart = i; } listBuf.push(`<li>${inline(escapeKeepingLinks(line.replace(/^\s*\d+\.\s+/, ''), linkKeep), fn)}</li>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) { flushList(); emit(`<blockquote>${inline(escapeKeepingLinks(line.replace(/^\s*>\s?/, ''), linkKeep), fn)}</blockquote>`, i, i); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushList(); emit('<hr/>', i, i); i++; continue; }
    // GFM table: a header row followed by a delimiter row, then body rows until a blank line or a row with
    // no pipe. Without this the pipes fell through to the paragraph gather and rendered as literal text,
    // while the site build (Astro + GFM) rendered a real table, so the preview disagreed with the page.
    const aligns = i + 1 < lines.length ? tableAlignments(lines[i + 1]) : null;
    if (aligns && line.includes('|')) {
      const tableStart = i;
      flushList();
      const cell = (c) => inline(escapeKeepingLinks(c, linkKeep), fn);
      const cols = (row, tag) => row
        .map((c, n) => `<${tag}${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${cell(c)}</${tag}>`)
        .join('');
      const head = `<thead><tr>${cols(splitTableRow(line), 'th')}</tr></thead>`;
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      const body = rows.length ? `<tbody>${rows.map((r) => `<tr>${cols(r, 'td')}</tr>`).join('')}</tbody>` : '';
      emit(`<table>${head}${body}</table>`, tableStart, i - 1);
      continue;
    }
    if (/^\s*$/.test(line)) { flushList(); i++; continue; }

    // paragraph: gather consecutive plain lines
    flushList();
    const paraStart = i;
    const para = [esc];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !new RegExp(`^(#{1,6})\\s|^\\s*[-*]\\s|^\\s*\\d+\\.\\s|^\`\`\`|^\\s*>|^\\[\\^${FN_ID}\\]:`).test(lines[i])) {
      para.push(escapeKeepingLinks(lines[i], linkKeep));
      i++;
    }
    emit(`<p>${inline(para.join(' '), fn)}</p>`, paraStart, i - 1);
  }
  flushList();
  if (inCode) emit(renderFence(codeLang, codeBuf, fn), fenceStart, lines.length - 1);
  // The footnote section: only REFERENCED definitions render (GFM drops the rest), with one back arrow per
  // reference occurrence (matching the disambiguated fnref ids), so every jump down has a jump back.
  const referenced = footnotes.filter((f) => (fn.counts.get(f.id) ?? 0) > 0);
  if (referenced.length) {
    const items = referenced
      .map((f) => {
        const n = fn.counts.get(f.id);
        const backs = Array.from({ length: n }, (_v, k) =>
          `<a class="md-fn-back" href="#fnref-${f.id}${k ? `-${k + 1}` : ''}" aria-label="Back to reference${k ? ` ${k + 1}` : ''}">&#8617;${k ? `<sup>${k + 1}</sup>` : ''}</a>`).join(' ');
        return `<li id="fn-${f.id}">${f.html} ${backs}</li>`;
      })
      .join('');
    emit(`<section class="md-footnotes"><h2>Footnotes</h2><ol>${items}</ol></section>`, null, null);
  }
  const joined = out.join('\n');
  const html = linkKeep.length ? joined.replace(/(\d+)/g, (_m, i) => linkKeep[Number(i)] ?? '') : joined;
  return { html, blocks: ranges };
}
