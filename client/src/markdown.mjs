// Minimal, dependency-free Markdown renderer for the CMS LOCAL PREVIEW (SOW-006). This is an approximate
// preview for authoring convenience; the authoritative render is the Astro site build. It escapes HTML
// first (the preview is shown in the local CMS, but we still never inject raw input), then handles the
// common blocks (headings, lists, blockquotes, fenced code, hr, paragraphs) and inline (code, links, bold,
// italic). Pure + unit-testable.
// SOW-062 Phase 5d: also renders the ```callout / ```embed body blocks (the shared embedUrl gives a safe iframe src).
import { embedUrl } from './video-embed.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
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
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
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
    const src = embedUrl(url);
    if (src) return `<div class="md-embed"><iframe src="${escapeHtml(src)}" loading="lazy" allowfullscreen sandbox="allow-scripts allow-same-origin allow-presentation" title="Embedded video"></iframe></div>`;
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

export function renderMarkdown(md) {
  const lines = String(md ?? '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let codeFence = 3;
  let inCode = false;
  let codeBuf = [];
  let codeLang = '';
  let listType = null;
  let listBuf = [];
  const footnotes = []; // GFM footnote definitions, rendered as one section at the end (like the site build)
  const fn = { ids: collectFootnoteIds(lines), counts: new Map() }; // known def ids + per-id reference counts
  const flushList = () => {
    if (listType) {
      out.push(`<${listType}>${listBuf.join('')}</${listType}>`);
      listType = null;
      listBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = /^(`{3,})(.*)$/.exec(line);
    if (fence) {
      if (!inCode) { inCode = true; codeBuf = []; codeFence = fence[1].length; codeLang = fence[2]; i++; continue; }
      // CommonMark: a fence closes only on a fence of >= the OPENING length with no info string, so a
      // ````markdown block can carry ``` fences as CONTENT (the /ci skill prompt broke on this).
      if (fence[1].length >= codeFence && !fence[2].trim()) { inCode = false; flushList(); out.push(renderFence(codeLang, codeBuf, fn)); codeLang = ''; i++; continue; }
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

    const esc = escapeHtml(line);
    let m;
    if ((m = /^(#{1,6})\s+(.*)$/.exec(esc))) { flushList(); out.push(`<h${m[1].length}>${inline(m[2], fn)}</h${m[1].length}>`); i++; continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listBuf.push(`<li>${inline(escapeHtml(line.replace(/^\s*[-*]\s+/, '')), fn)}</li>`); i++; continue; }
    if (/^\s*\d+\.\s+/.test(line)) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listBuf.push(`<li>${inline(escapeHtml(line.replace(/^\s*\d+\.\s+/, '')), fn)}</li>`); i++; continue; }
    if (/^\s*>\s?/.test(line)) { flushList(); out.push(`<blockquote>${inline(escapeHtml(line.replace(/^\s*>\s?/, '')), fn)}</blockquote>`); i++; continue; }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) { flushList(); out.push('<hr/>'); i++; continue; }
    // GFM table: a header row followed by a delimiter row, then body rows until a blank line or a row with
    // no pipe. Without this the pipes fell through to the paragraph gather and rendered as literal text,
    // while the site build (Astro + GFM) rendered a real table, so the preview disagreed with the page.
    const aligns = i + 1 < lines.length ? tableAlignments(lines[i + 1]) : null;
    if (aligns && line.includes('|')) {
      flushList();
      const cell = (c) => inline(escapeHtml(c), fn);
      const cols = (row, tag) => row
        .map((c, n) => `<${tag}${aligns[n] ? ` style="text-align:${aligns[n]}"` : ''}>${cell(c)}</${tag}>`)
        .join('');
      const head = `<thead><tr>${cols(splitTableRow(line), 'th')}</tr></thead>`;
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && !/^\s*$/.test(lines[i])) { rows.push(splitTableRow(lines[i])); i++; }
      const body = rows.length ? `<tbody>${rows.map((r) => `<tr>${cols(r, 'td')}</tr>`).join('')}</tbody>` : '';
      out.push(`<table>${head}${body}</table>`);
      continue;
    }
    if (/^\s*$/.test(line)) { flushList(); i++; continue; }

    // paragraph: gather consecutive plain lines
    flushList();
    const para = [esc];
    i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !new RegExp(`^(#{1,6})\\s|^\\s*[-*]\\s|^\\s*\\d+\\.\\s|^\`\`\`|^\\s*>|^\\[\\^${FN_ID}\\]:`).test(lines[i])) {
      para.push(escapeHtml(lines[i]));
      i++;
    }
    out.push(`<p>${inline(para.join(' '), fn)}</p>`);
  }
  flushList();
  if (inCode) out.push(renderFence(codeLang, codeBuf, fn));
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
    out.push(`<section class="md-footnotes"><h2>Footnotes</h2><ol>${items}</ol></section>`);
  }
  return out.join('\n');
}
