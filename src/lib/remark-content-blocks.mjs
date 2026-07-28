// SOW-062 Phase 5d: renders the body ```callout <variant> and ```embed blocks on the STATIC site, mirroring the
// in-extension reader (client/src/markdown.mjs). A REMARK pass (not rehype): it runs on the mdast, where a fenced
// block is a `code` node with reliable `lang` + `meta` (the hast conversion drops `meta`), and replaces the callout
// / embed code node with a raw-HTML node BEFORE Shiki highlights it. Same hand-written style as rehypeDemoteBodyH1,
// no new dependency. Only a NORMALIZED provider URL (via the one shared embedUrl) becomes an iframe src -- never
// author-supplied HTML -- and callout bodies are HTML-escaped, so no author script executes.
import { embedUrl } from '../../client/src/video-embed.mjs';

const CALLOUT_VARIANTS = ['info', 'note', 'warning', 'tip'];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Inline formatting on ALREADY-escaped text, identical to the reader's inline() so callouts match across renderers.
const inline = (escaped) => escaped
  .replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`)
  .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`)
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');

function renderBlock(node) {
  if (node.lang === 'callout') {
    const meta = String(node.meta || '').trim();
    const v = CALLOUT_VARIANTS.includes(meta) ? meta : 'note';
    const body = String(node.value || '').split('\n').map((l) => inline(esc(l))).join('<br/>');
    return `<div class="callout callout-${v}" role="note"><div class="callout-body">${body}</div></div>`;
  }
  // embed
  const url = String(node.value || '').trim();
  const src = embedUrl(url);
  // sow-158: sandbox matches the in-extension reader (client/src/markdown.mjs) so both renderers cage the frame.
  if (src) return `<div class="embed-wrap"><iframe src="${esc(src)}" loading="lazy" allowfullscreen title="Embedded video" sandbox="allow-scripts allow-same-origin allow-presentation allow-popups" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"></iframe></div>`;
  return `<p><a href="${esc(url)}" target="_blank" rel="noopener">${esc(url)}</a></p>`;
}

export function remarkContentBlocks() {
  return (tree) => {
    const walk = (node) => {
      if (!node || !Array.isArray(node.children)) return;
      for (let i = 0; i < node.children.length; i++) {
        const n = node.children[i];
        if (n && n.type === 'code' && (n.lang === 'callout' || n.lang === 'embed')) {
          node.children[i] = { type: 'html', value: renderBlock(n) };
        } else {
          walk(n);
        }
      }
    };
    walk(tree);
  };
}
