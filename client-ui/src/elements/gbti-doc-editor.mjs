// <gbti-doc-editor> (SOW-062 Phase 5): the cohesive Markdown WYSIWYG body editor. Replaces the Phase-4
// per-block-container editor (gbti-block-editor) with one continuous surface where blocks edit IN PLACE. Same public
// contract as before: `.value` parses Markdown -> blocks (setter) + serializes blocks -> Markdown (getter), and it
// emits `block-change`, so the host (gbti-content-editor) is untouched. MODEL-IS-TRUTH: `this._blocks` is the state,
// the DOM renders it, and `.value` ALWAYS serializes from the array (never from the contenteditable HTML) -- this is
// what protects the round-trip idempotence + the SOW-016 `<!-- members-only -->` marker. Blocks after a members
// divider render as the "Members-only" section. In-house, node-free, CSP-safe, shadow-DOM. Phase 5c layers the slash
// menu + selection toolbar + drag reorder on top of this engine.
import { GbtiElement, define, esc } from '../base.mjs';
import { parseBlocks, serializeBlocks, emptyBlock, CALLOUT_VARIANTS, inlineMdToHtml, inlineHtmlToMd } from '../markdown-blocks.mjs';
import { resolveContentAsset } from '../assets.mjs'; // sow-165: repo-relative body images need the item folder to resolve
import { EDITOR_SURFACE } from '../tokens.mjs'; // SOW-062 P6: the solid --s-* editor palette (decoupled from glass)

let UID = 0;
const withId = (b) => { if (b && !b._id) b._id = ++UID; return b; };
const TEXT_TYPES = new Set(['paragraph', 'heading', 'quote', 'callout']);

// The "Turn into" menu: each entry maps to a concrete block shape (heading carries a level; list an ordered flag).
// SOW-062 P6: each palette entry carries an icon + one-line description so the slash / add-block menus render as
// rich rows (icon box + name + description), matching the hi-fi. icon keys resolve against the `ic` glyph map.
const CONVERT = [
  { key: 'paragraph', label: 'Text', icon: 'text', desc: 'Plain paragraph' },
  { key: 'h1', label: 'Heading 1', type: 'heading', level: 1, icon: 'h1', desc: 'Big section title' },
  { key: 'h2', label: 'Heading 2', type: 'heading', level: 2, icon: 'h2', desc: 'Section heading' },
  { key: 'h3', label: 'Heading 3', type: 'heading', level: 3, icon: 'h3', desc: 'Sub-section' },
  { key: 'quote', label: 'Quote', icon: 'quote', desc: 'Call out a passage' },
  { key: 'callout', label: 'Callout', icon: 'info', desc: 'Info, note or warning' },
  { key: 'code', label: 'Code', icon: 'code', desc: 'A code block' },
  { key: 'ul', label: 'Bulleted list', type: 'list', ordered: false, icon: 'listul', desc: 'A simple list' },
  { key: 'ol', label: 'Numbered list', type: 'list', ordered: true, icon: 'listol', desc: 'An ordered list' },
  { key: 'image', label: 'Image', icon: 'img', desc: 'Upload or embed a picture' },
  { key: 'embed', label: 'Video / embed', icon: 'video', desc: 'YouTube or Vimeo' },
];
// SOW-062 P6: one rich palette row (icon box + name + description); `sel` marks the keyboard-highlighted row.
const paletteRow = (c, dataAttr, sel = false) => `<div class="mi${sel ? ' on' : ''}" ${dataAttr}><span class="mi-ic">${svg(c.icon)}</span><span class="mi-tx"><span class="mi-nm">${esc(c.label)}</span><span class="mi-ds">${esc(c.desc)}</span></span></div>`;
const convertKey = (b) => (b.type === 'heading' ? `h${Math.min(3, Math.max(1, b.level || 2))}` : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type);
const blockFromKey = (key) => {
  const c = CONVERT.find((x) => x.key === key) || CONVERT[0];
  const nb = emptyBlock(c.type || c.key);
  if (c.level) nb.level = c.level;
  if ('ordered' in c) nb.ordered = c.ordered;
  return nb;
};

const ic = {
  up: '<path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>',
  img: '<rect x="4" y="5" width="16" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 17.5l4.2-4.2L13 17l2.6-2.6L19 17.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  video: '<rect x="3.5" y="6" width="11" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.5 10l6-2.8v9.6l-6-2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  gear: '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13c.05-.33.08-.66.08-1s-.03-.67-.08-1l1.86-1.43-1.8-3.12-2.2.88a7 7 0 0 0-1.73-1l-.33-2.33h-3.6l-.33 2.33a7 7 0 0 0-1.73 1l-2.2-.88-1.8 3.12L7.1 11c-.05.33-.08.66-.08 1s.03.67.08 1l-1.86 1.43 1.8 3.12 2.2-.88c.52.4 1.1.74 1.73 1l.33 2.33h3.6l.33-2.33a7 7 0 0 0 1.73-1l2.2.88 1.8-3.12L19.4 13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>',
  // SOW-062 P6: block-palette glyphs for the rich slash / add-block menu rows (from the hi-fi sprite).
  text: '<path d="M5 6h14M5 6v1.5M19 6v1.5M12 6v13M9.5 19h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  h1: '<path d="M4 6v12M12 6v12M4 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 9l2.5-1.2V18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  h2: '<path d="M3 6v12M10 6v12M3 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14.5 9.2a2.3 2.3 0 0 1 4 1.5c0 2-4 3-4 5.8h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  h3: '<path d="M3 6v12M10 6v12M3 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14.5 8.5a2.2 2.2 0 1 1 1.7 3.6 2.3 2.3 0 1 1-1.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  quote: '<path d="M9 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3M19 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  listul: '<circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="17" r="1.4" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  listol: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 6l1-.5V9M3.6 15.5c.3-.8 1.8-.8 1.8.3 0 .8-1.6 1.2-1.8 2.2H5.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ic[k]}</svg>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--s-fg); }
  .doc-blocks { display:flex; flex-direction:column; position:relative; }
  /* a block = its content + a contextual hover toolbar in the right gutter; NO bordered box around each block */
  .blk { position:relative; padding:2px 0; margin:2px 0; }
  .blk-tools { position:absolute; top:0; right:0; display:flex; gap:2px; align-items:center; padding:2px;
    background:var(--s-surface); border:1px solid var(--s-line); border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.08);
    opacity:0; pointer-events:none; transition:opacity .12s ease; z-index:2; }
  .blk:hover > .blk-tools, .blk:focus-within > .blk-tools { opacity:1; pointer-events:auto; }
  .bt { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:6px;
    background:transparent; color:var(--s-fg-mute); cursor:pointer; padding:0; }
  .bt:hover { background:var(--s-surface-2); color:var(--s-fg); }
  .bt.danger:hover { color:#d2453f; }
  .bt svg { width:16px; height:16px; }
  .grip { cursor:grab; } .grip:active { cursor:grabbing; }
  .blk.drop-over { box-shadow:inset 0 2.5px 0 var(--s-green); }
  .bt-type { font:inherit; font-size:12px; padding:2px 4px; border:0; border-radius:6px; background:transparent; color:var(--s-fg-mute); cursor:pointer; }
  .bt-type:hover { background:var(--s-surface-2); color:var(--s-fg); }
  /* the editing surfaces: borderless, "document" feel */
  .ce { outline:0; white-space:pre-wrap; word-break:break-word; caret-color:var(--s-green); color:var(--s-fg); padding:2px 40px 2px 0; border-radius:6px; }
  .ce:empty::before { content:attr(data-ph); color:var(--s-fg-mute); opacity:.5; pointer-events:none; }
  .ce:focus { background:transparent; }
  .ce-p { font-size:17px; line-height:1.65; padding:6px 40px 6px 0; }
  .ce-h1 { font-family:var(--font-display, var(--font-body)); font-weight:800; font-size:30px; line-height:1.2; letter-spacing:-.01em; padding:12px 0 4px; }
  .ce-h2 { font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:24px; line-height:1.25; padding:10px 0 3px; }
  .ce-h3 { font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:19.5px; line-height:1.3; padding:8px 0 2px; }
  .ce-q { border-left:3px solid var(--s-green); padding-left:20px; color:var(--s-fg-soft); font-size:18px; line-height:1.55; font-style:italic; margin:6px 0; }
  .ce-code { font-family:var(--font-mono, ui-monospace, monospace); font-size:13.5px; line-height:1.6; color:#e6e4ee; background:var(--ink); border:1.5px solid var(--s-line-2); border-radius:8px; padding:13px 16px; margin:8px 0; }
  .ce-list { padding-left:26px; font-size:17px; line-height:1.6; margin:6px 0; }
  .ce-list li { padding:1px 0; }
  /* SOW-062 P6: inline formatting rendered inside the contenteditable (bold/italic/link/code/strike) */
  .ce a { color:var(--s-green-fg); text-decoration:underline; text-underline-offset:2px; }
  .ce strong, .ce b { font-weight:700; }
  .ce em, .ce i { font-style:italic; }
  .ce s, .ce del { text-decoration:line-through; opacity:.8; }
  .ce code { font-family:var(--font-mono, ui-monospace, monospace); font-size:.88em; background:var(--s-surface-2); padding:2px 5px; border-radius:5px; }
  /* callout */
  .cwrap { margin:8px 0; }
  .cvar { display:inline-flex; align-items:center; gap:5px; margin-bottom:9px; padding:4px 4px 4px 6px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; }
  .cvar-lab { display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--s-fg-mute); padding-right:6px; border-right:1.5px solid var(--s-line-2); white-space:nowrap; }
  .cvar-lab svg { width:13px; height:13px; }
  .cvar button { font:inherit; font-size:11px; font-weight:600; padding:3px 9px; border-radius:7px; border:0; background:transparent; color:var(--s-fg-soft); cursor:pointer; text-transform:capitalize; }
  .cvar button.on { background:var(--s-green); color:#fff; }
  .callout { display:flex; gap:13px; padding:15px 17px; border-radius:8px; border:1.5px solid var(--s-tint-2); background:var(--s-tint); margin:0; }
  .callout .cicon { width:24px; height:24px; flex:none; display:flex; align-items:center; justify-content:center; margin-top:1px; }
  .callout .cicon svg { width:21px; height:21px; }
  .callout .ce { padding:0; font-size:15.5px; line-height:1.6; flex:1; }
  .callout-info { background:color-mix(in srgb, #3f74c9 11%, var(--s-canvas)); border-color:color-mix(in srgb, #3f74c9 32%, transparent); } .callout-info .cicon { color:#3f74c9; }
  .callout-note { background:var(--s-tint); border-color:var(--s-tint-2); } .callout-note .cicon { color:var(--s-green-fg); }
  .callout-warning { background:color-mix(in srgb, #c9892b 13%, var(--s-canvas)); border-color:color-mix(in srgb, #c9892b 34%, transparent); } .callout-warning .cicon { color:#c9892b; }
  .callout-tip { background:color-mix(in srgb, #7a5cc0 12%, var(--s-canvas)); border-color:color-mix(in srgb, #7a5cc0 32%, transparent); } .callout-tip .cicon { color:#7a5cc0; }
  .co-lang { font:inherit; font-size:12px; color:var(--s-fg-mute); background:transparent; border:0; padding:0 0 4px; }
  /* void cards (image / embed) */
  .card { border:1.5px solid var(--s-line); border-radius:12px; padding:12px; background:var(--s-surface); display:flex; flex-direction:column; gap:8px; }
  .card-h { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:var(--s-fg-mute); } .card-h svg { width:18px; height:18px; }
  .card input { width:100%; box-sizing:border-box; font:inherit; font-size:13.5px; padding:8px 10px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--bg, var(--s-surface)); color:var(--s-fg); }
  .card-prev { max-width:100%; border-radius:8px; border:1px solid var(--s-line); }
  /* SOW-062 P6: image drop-zone placeholder (striped) + the preview frame */
  .imgframe { border:1.5px solid var(--s-line-2); border-radius:9px; overflow:hidden; background:var(--s-surface-2); }
  .imgframe img { width:100%; display:block; }
  .imgph { aspect-ratio:16/8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:9px; color:var(--s-fg-mute); cursor:pointer;
    background-image:repeating-linear-gradient(45deg, var(--s-surface-3) 0 12px, transparent 12px 24px); transition:color .14s ease, box-shadow .14s ease; }
  .imgph:hover { color:var(--s-green-fg); }
  .imgph.drag { color:var(--s-green-fg); background:var(--s-tint); box-shadow:inset 0 0 0 2px var(--s-green); }
  .imgph svg { width:30px; height:30px; opacity:.55; }
  .imgph-t { font-family:var(--font-mono,monospace); font-size:12px; }
  .up { display:flex; align-items:center; gap:10px; }
  .up-btn { font:inherit; font-size:13px; font-weight:600; padding:7px 12px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--s-surface); color:var(--s-fg); cursor:pointer; }
  .up-btn:hover { border-color:var(--s-green); color:var(--s-green); }
  .up-st { font-size:12px; color:var(--s-fg-mute); }
  /* members-only section divider + the tinted region after it */
  .mem-div { display:flex; align-items:center; gap:8px; margin:16px 0 8px; color:var(--s-green); font-weight:700; font-size:13px; }
  .mem-div::after { content:""; flex:1; height:1.5px; background:linear-gradient(to right, var(--s-green), transparent); }
  .mem-div svg { width:16px; height:16px; }
  .mem-div .rm { margin-left:auto; }
  .blk.in-members { border-left:2px solid var(--green-tint-2, rgba(31,158,95,.35)); padding-left:12px; margin-left:2px; }
  /* add row */
  .add-row { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0 4px; }
  .add-btn { display:inline-flex; align-items:center; gap:7px; font:inherit; font-weight:600; font-size:13.5px; padding:9px 14px;
    border:1.5px dashed var(--s-line); border-radius:10px; background:transparent; color:var(--s-fg-mute); cursor:pointer; }
  .add-btn:hover { border-color:var(--s-green); color:var(--s-green); }
  .add-btn svg { width:16px; height:16px; }
  .add-menu { position:relative; }
  .add-pop { position:absolute; top:calc(100% + 6px); left:0; z-index:5; min-width:268px; background:var(--s-surface); border:1.5px solid var(--s-line);
    border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.18); padding:6px; }
  /* SOW-062 5c-2: the slash menu + the inline selection toolbar (in-shadow popovers) */
  .slash-pop, .sel-tb { position:absolute; z-index:20; background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:0 12px 34px rgba(0,0,0,.2); }
  .slash-pop { min-width:268px; max-height:300px; overflow:auto; padding:5px; }
  /* SOW-062 P6: rich palette rows (icon box + name + description), shared by the add-block + slash menus */
  .mi { display:flex; align-items:center; gap:11px; padding:8px 9px; border-radius:8px; cursor:pointer; }
  .mi:hover, .mi.on { background:var(--s-surface-2); }
  .mi-ic { width:32px; height:32px; flex:none; border-radius:7px; border:1.5px solid var(--s-line); background:var(--s-surface); display:flex; align-items:center; justify-content:center; color:var(--s-fg-soft); }
  .mi.on .mi-ic { border-color:var(--s-green); color:var(--s-green-fg); background:var(--s-tint); }
  .mi-ic svg { width:18px; height:18px; }
  .mi-tx { display:flex; flex-direction:column; min-width:0; }
  .mi-nm { font-weight:600; font-size:14px; }
  .mi-ds { font-size:11.5px; color:var(--s-fg-mute); margin-top:1px; }
  .sel-tb { display:none; gap:1px; padding:4px; background:var(--ink); border:0; box-shadow:0 12px 30px rgba(0,0,0,.4); }
  .sel-tb button { min-width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:7px; background:transparent; color:#e6e4ee; cursor:pointer; font-weight:700; font-size:13px; padding:0 6px; }
  .sel-tb button:hover { background:rgba(255,255,255,.12); color:#fff; }
`;

class GbtiDocEditor extends GbtiElement {
  // sow-165: the owning editor sets this so a repo-relative body image resolves against the item's folder.
  set itemPath(v) { this._itemPath = v || null; if (this.isConnected) this._render(); }
  get itemPath() { return this._itemPath || null; }
  set value(md) { this._blocks = parseBlocks(md).map(withId); if (this.isConnected) this._render(); }
  get value() { return serializeBlocks(this._blocks || []); } // serializeBlock ignores the non-serialized _id

  connectedCallback() {
    if (!this._blocks) this._blocks = [];
    if (!this._onSel) this._onSel = () => this._updateSelToolbar();
    document.addEventListener('selectionchange', this._onSel);
    super.connectedCallback?.();
    this._render();
  }

  disconnectedCallback() {
    if (this._onSel) document.removeEventListener('selectionchange', this._onSel);
    super.disconnectedCallback?.();
  }

  _byId(id) { return (this._blocks || []).find((b) => String(b._id) === String(id)); }
  _indexOf(id) { return (this._blocks || []).findIndex((b) => String(b._id) === String(id)); }
  _change() { this.emit('block-change'); }

  _render() {
    const blocks = this._blocks || [];
    const hasMembers = blocks.some((b) => b.type === 'members');
    let inMem = false;
    const parts = blocks.map((b) => {
      if (b.type === 'members') { inMem = true; return this._memberDivider(b); }
      return this._blockHtml(b, inMem);
    });
    const addRow = `<div class="add-row">
      <div class="add-menu"><button class="add-btn" data-addmenu type="button">${svg('plus')} Add block</button><div class="add-pop" data-addpop hidden></div></div>
      ${hasMembers ? '' : `<button class="add-btn" data-addmembers type="button">${svg('lock')} Add members-only section</button>`}
    </div>`;
    this._slash = null; this._tb = null; // the popovers lived in the old DOM (this.set replaced it)
    this.set(this.css(EDITOR_SURFACE + CSS) + `<div class="doc-blocks">${parts.join('')}${addRow}</div>`);
    this._wire();
  }

  _tools(b) {
    const id = b._id;
    const opts = CONVERT.map((c) => `<option value="${c.key}" ${convertKey(b) === c.key ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
    return `<div class="blk-tools">
      <span class="bt grip" draggable="true" data-grip="${id}" title="Drag to reorder">${svg('grip')}</span>
      <select class="bt-type" data-convert="${id}" title="Turn into">${opts}</select>
      <button class="bt" type="button" data-up="${id}" title="Move up">${svg('up')}</button>
      <button class="bt" type="button" data-down="${id}" title="Move down">${svg('down')}</button>
      <button class="bt danger" type="button" data-del="${id}" title="Delete">${svg('x')}</button>
    </div>`;
  }

  _blockHtml(b, inMem) {
    return `<div class="blk blk-${esc(b.type)}${inMem ? ' in-members' : ''}" data-id="${b._id}">${this._tools(b)}<div class="blk-in">${this._bodyHtml(b)}</div></div>`;
  }

  _ce(cls, edit, b, ph) {
    return `<div class="ce ${cls}" contenteditable="true" data-edit="${edit}" data-id="${b._id}" data-ph="${esc(ph || '')}">${inlineMdToHtml(b.text || '')}</div>`;
  }

  _bodyHtml(b) {
    switch (b.type) {
      case 'heading': return this._ce(`ce-h${Math.min(3, Math.max(1, b.level || 2))}`, 'text', b, 'Heading');
      case 'quote': return this._ce('ce-q', 'text', b, 'Quote');
      case 'callout': {
        const v = CALLOUT_VARIANTS.includes(b.variant) ? b.variant : 'note';
        const bar = `<div class="cvar"><span class="cvar-lab">${svg('gear')} Callout style</span>${CALLOUT_VARIANTS.map((x) => `<button type="button" class="${x === v ? 'on' : ''}" data-cvar="${b._id}" data-cval="${x}">${x}</button>`).join('')}</div>`;
        return `<div class="cwrap">${bar}<div class="callout callout-${v}"><span class="cicon">${svg('info')}</span>${this._ce('', 'text', b, 'Callout text')}</div></div>`;
      }
      case 'code':
        return `<input class="co-lang" data-edit="lang" data-id="${b._id}" value="${esc(b.lang || '')}" placeholder="language (optional)" />`
          + `<div class="ce ce-code" contenteditable="true" data-edit="code" data-id="${b._id}" data-ph="Code">${esc(b.code || '')}</div>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const items = (Array.isArray(b.items) ? b.items : ['']).map((it) => `<li>${inlineMdToHtml(it)}</li>`).join('') || '<li></li>';
        return `<${tag} class="ce ce-list" contenteditable="true" data-edit="list" data-id="${b._id}">${items}</${tag}>`;
      }
      case 'image': {
        // SOW-062 P6: a striped drop-zone placeholder when empty (click OR drag-drop an image), the preview when set.
        const hasUrl = !!b.url;
        // sow-165: a body image is usually a REPO-relative path (`./images/x.webp`). Prefixing the site
        // origin produced `https://gbti.network/./images/x.webp`, a guaranteed 404, which is why every body
        // image rendered broken in the editor. Resolve against the item's folder like the reader does.
        const src = hasUrl ? esc(resolveContentAsset(b.url, this.itemPath)) : '';
        return `<div class="card"><div class="card-h">${svg('img')} Image</div>`
          + `<div class="imgframe">`
          +   (hasUrl ? `<img src="${src}" alt="" />` : `<div class="imgph" data-imgdrop="${b._id}" title="Drop an image here, or click to upload">${svg('img')}<span class="imgph-t">Drop an image here, or click to upload</span></div>`)
          +   `<input type="file" accept="image/*" hidden data-imgfile="${b._id}" />`
          + `</div>`
          + `<input data-edit="url" data-id="${b._id}" value="${esc(b.url || '')}" placeholder="Image URL or repo path" />`
          + `<input data-edit="alt" data-id="${b._id}" value="${esc(b.alt || '')}" placeholder="Alt text" />`
          + `<div class="up"><button type="button" class="up-btn" data-imgpick="${b._id}">${svg('img')} ${hasUrl ? 'Replace image' : 'Choose image'}</button><span class="up-st" data-imgst="${b._id}"></span></div></div>`;
      }
      case 'embed':
        return `<div class="card"><div class="card-h">${svg('video')} Video / embed</div>`
          + `<input data-edit="url" data-id="${b._id}" value="${esc(b.url || '')}" placeholder="Paste a YouTube or Vimeo URL" /></div>`;
      case 'paragraph':
      default: return this._ce('ce-p', 'text', b, 'Write, or use the Add block button');
    }
  }

  // SOW-062 5c: a leading Markdown token in a fresh paragraph converts it to the block type (Notion-style).
  _shortcut(txt) {
    let m;
    if ((m = txt.match(/^(#{1,3})\s(.*)$/))) { const b = emptyBlock('heading'); b.level = m[1].length; b.text = m[2]; return b; }
    if ((m = txt.match(/^>\s(.*)$/))) { const b = emptyBlock('quote'); b.text = m[1]; return b; }
    if ((m = txt.match(/^[-*]\s(.*)$/))) { const b = emptyBlock('list'); b.ordered = false; b.items = [m[1]]; return b; }
    if ((m = txt.match(/^1\.\s(.*)$/))) { const b = emptyBlock('list'); b.ordered = true; b.items = [m[1]]; return b; }
    if (txt === '```') return emptyBlock('code');
    return null;
  }

  _memberDivider(b) {
    return `<div class="mem-div" data-id="${b._id}">${svg('lock')} Members only <span>· only members see the content below</span>`
      + `<button class="bt danger rm" type="button" data-del="${b._id}" title="Remove the members-only split">${svg('x')}</button></div>`;
  }

  _wire() {
    // Live text/field edits: mutate the model in place WITHOUT re-render (preserve caret). IME-safe.
    this.$$('[data-edit]').forEach((el) => {
      const on = () => {
        if (el._composing) return;
        const b = this._byId(el.dataset.id);
        if (!b) return;
        const f = el.dataset.edit;
        if (f === 'text') {
          const plain = el.innerText.replace(/\n$/, ''); // plain text for shortcut/slash detection ONLY
          if (b.type === 'paragraph') {
            const sc = this._shortcut(plain); // SOW-062 5c: '# '/'> '/'- '/'1. '/``` convert the paragraph IN PLACE
            if (sc) { const i = this._indexOf(b._id); this._blocks[i] = withId(sc); this._render(); this._focusBlock(this._blocks[i]._id); this._change(); return; }
            if (plain.startsWith('/')) this._openSlash(el, plain.slice(1)); else this._closeSlash(); // SOW-062 5c-2: slash menu
          }
          b.text = inlineHtmlToMd(el.innerHTML).replace(/\n$/, ''); // SOW-062 P6: store the .ce's inline HTML as Markdown
        }
        else if (f === 'code') b.code = el.innerText.replace(/\n$/, ''); // code stays literal
        else if (f === 'list') b.items = Array.from(el.querySelectorAll('li')).map((li) => inlineHtmlToMd(li.innerHTML));
        else b[f] = el.value; // lang / url / alt inputs
        this._change();
      };
      el.addEventListener('input', on);
      el.addEventListener('compositionstart', () => { el._composing = true; });
      el.addEventListener('compositionend', () => { el._composing = false; on(); });
      if (el.classList.contains('ce')) {
        // paste as PLAIN TEXT only (never author HTML -> CSP + round-trip safe)
        el.addEventListener('paste', (e) => {
          e.preventDefault();
          const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
          document.execCommand('insertText', false, t);
        });
      }
    });
    // Convert (Turn into): re-render + restore focus to the converted block.
    this.$$('[data-convert]').forEach((el) => el.addEventListener('change', () => {
      const i = this._indexOf(el.dataset.convert);
      if (i < 0) return;
      const cur = this._blocks[i];
      const next = withId(blockFromKey(el.value));
      if (cur.text != null && 'text' in next) next.text = cur.text;
      if (cur.text != null && next.type === 'code') next.code = cur.text;
      if (cur.text != null && next.type === 'list') next.items = String(cur.text).split('\n');
      this._blocks[i] = next;
      this._render(); this._focusBlock(next._id); this._change();
    }));
    this.$$('[data-cvar]').forEach((el) => el.addEventListener('click', () => {
      const b = this._byId(el.dataset.cvar);
      if (b) { b.variant = el.dataset.cval; this._render(); this._focusBlock(b._id); this._change(); }
    }));
    this.$$('[data-up]').forEach((el) => el.addEventListener('click', () => this._move(el.dataset.up, -1)));
    this.$$('[data-down]').forEach((el) => el.addEventListener('click', () => this._move(el.dataset.down, 1)));
    this.$$('[data-del]').forEach((el) => el.addEventListener('click', () => {
      const i = this._indexOf(el.dataset.del);
      if (i < 0) return;
      this._blocks.splice(i, 1); this._render(); this._change();
    }));
    // Add block menu.
    const menuBtn = this.$('[data-addmenu]'); const pop = this.$('[data-addpop]');
    if (menuBtn && pop) {
      pop.innerHTML = CONVERT.map((c) => paletteRow(c, `data-newkey="${c.key}"`)).join('');
      // SOW-062 P6 fix: arm the outside-click dismiss on EACH open (the old once-per-render {once:true} listener
      // stopped working after the first open/close cycle, since re-opening did not re-arm it).
      const hideAddPop = () => { pop.hidden = true; document.removeEventListener('click', hideAddPop); };
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
        document.removeEventListener('click', hideAddPop);
        if (!pop.hidden) document.addEventListener('click', hideAddPop);
      });
      pop.querySelectorAll('[data-newkey]').forEach((b) => b.addEventListener('click', () => {
        const nb = withId(blockFromKey(b.dataset.newkey));
        this._blocks.push(nb); this._render(); this._focusBlock(nb._id); this._change();
      }));
    }
    this.$('[data-addmembers]')?.addEventListener('click', () => {
      this._blocks.push(withId({ type: 'members' }), withId(emptyBlock('paragraph')));
      this._render(); this._change();
    });
    // SOW-062 5c: drag reorder via the grip handle only (native DnD; the contenteditable body is not draggable).
    this.$$('[data-grip]').forEach((g) => {
      g.addEventListener('dragstart', (e) => { this._dragId = g.dataset.grip; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', g.dataset.grip); } catch { /* Firefox needs data */ } } });
      g.addEventListener('dragend', () => { this._dragId = null; this.$$('.blk.drop-over').forEach((b) => b.classList.remove('drop-over')); });
    });
    this.$$('.blk[data-id]').forEach((blk) => {
      blk.addEventListener('dragover', (e) => { if (this._dragId != null) { e.preventDefault(); blk.classList.add('drop-over'); } });
      blk.addEventListener('dragleave', () => blk.classList.remove('drop-over'));
      blk.addEventListener('drop', (e) => {
        e.preventDefault(); blk.classList.remove('drop-over');
        if (this._dragId == null || this._dragId === blk.dataset.id) { this._dragId = null; return; }
        const from = this._indexOf(this._dragId);
        if (from < 0) return;
        const [moved] = this._blocks.splice(from, 1);
        const to = this._indexOf(blk.dataset.id); // recompute after the splice; insert BEFORE the drop target
        this._blocks.splice(to < 0 ? this._blocks.length : to, 0, moved);
        this._dragId = null; this._render(); this._change();
      });
    });
    // Image upload (reused from the Phase-4 editor).
    this.$$('[data-imgpick]').forEach((el) => {
      const id = el.dataset.imgpick;
      const fileEl = this.$(`[data-imgfile="${id}"]`);
      el.addEventListener('click', () => fileEl?.click());
      fileEl?.addEventListener('change', (e) => this._uploadImage(e.target.files?.[0], id));
    });
    // SOW-062 P6: the empty-image drop-zone: click to open the picker, or drag-drop an image file (reuses _uploadImage).
    this.$$('[data-imgdrop]').forEach((zone) => {
      const id = zone.dataset.imgdrop;
      const fileEl = this.$(`[data-imgfile="${id}"]`);
      zone.addEventListener('click', () => fileEl?.click());
      zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag');
        const f = e.dataTransfer?.files?.[0];
        if (f && f.type.startsWith('image/')) this._uploadImage(f, id);
      });
    });
    // Enter at the end of a text block inserts a new paragraph after it.
    this.$$('.ce[data-edit="text"]').forEach((el) => el.addEventListener('keydown', (e) => {
      if (this._slash && this._slash.el === el) { // SOW-062 5c-2: slash-menu keyboard nav
        if (e.key === 'ArrowDown') { e.preventDefault(); return this._moveSlash(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); return this._moveSlash(-1); }
        if (e.key === 'Enter') { e.preventDefault(); return this._pickSlash(this._slash.idx); }
        if (e.key === 'Escape') { e.preventDefault(); return this._closeSlash(); }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const b = this._byId(el.dataset.id);
        const sel = this.root.getSelection ? this.root.getSelection() : document.getSelection();
        const atEnd = sel && sel.focusOffset === (el.innerText || '').length;
        if (b && atEnd) {
          e.preventDefault();
          const i = this._indexOf(b._id);
          const nb = withId(emptyBlock('paragraph'));
          this._blocks.splice(i + 1, 0, nb);
          this._render(); this._focusBlock(nb._id); this._change();
        }
      }
    }));
  }

  _focusBlock(id) {
    const el = this.$(`.blk[data-id="${id}"] .ce`) || this.$(`.blk[data-id="${id}"] input`);
    if (!el) return;
    el.focus();
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch { /* input focus is enough */ }
  }

  _move(id, dir) {
    const i = this._indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= this._blocks.length) return;
    const [b] = this._blocks.splice(i, 1);
    this._blocks.splice(j, 0, b);
    this._render(); this._change();
  }

  async _uploadImage(file, id) {
    const b = this._byId(id);
    if (!file || !b || !this.client?.stageImage) return;
    const st = this.$(`[data-imgst="${id}"]`);
    if (st) st.textContent = 'Uploading...';
    try {
      const dataBase64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const out = await this.client.stageImage({ filename: file.name, dataBase64 });
      b.url = out.path;
      if (!b.alt) b.alt = file.name.replace(/\.[^.]+$/, '');
      this._render(); this._change();
    } catch {
      if (st) st.textContent = 'Upload failed';
    }
  }

  // --- SOW-062 5c-2: slash menu (type "/" in a fresh paragraph -> a filtered block picker) ---
  _openSlash(el, query) {
    const q = String(query || '').toLowerCase();
    const matches = CONVERT.filter((c) => `${c.label} ${c.key}`.toLowerCase().includes(q));
    this._closeSlash();
    const host = this.$('.doc-blocks'); const blk = el.closest('.blk');
    if (!matches.length || !host || !blk) return;
    const pop = document.createElement('div');
    pop.className = 'slash-pop';
    pop.style.top = `${blk.offsetTop + blk.offsetHeight + 4}px`;
    pop.style.left = `${blk.offsetLeft}px`;
    pop.innerHTML = matches.map((c, i) => paletteRow(c, `data-si="${i}"`, i === 0)).join('');
    pop.querySelectorAll('[data-si]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); this._pickSlash(Number(b.dataset.si)); }));
    host.appendChild(pop);
    this._slash = { el, matches, idx: 0, pop };
  }

  _closeSlash() { if (this._slash && this._slash.pop) this._slash.pop.remove(); this._slash = null; }

  _moveSlash(dir) {
    const s = this._slash; if (!s) return;
    s.idx = (s.idx + dir + s.matches.length) % s.matches.length;
    s.pop.querySelectorAll('[data-si]').forEach((b, i) => { const on = i === s.idx; b.classList.toggle('on', on); if (on) b.scrollIntoView({ block: 'nearest' }); });
  }

  _pickSlash(i) {
    const s = this._slash; if (!s) return;
    const b = this._byId(s.el.dataset.id); if (!b) { this._closeSlash(); return; }
    const idx = this._indexOf(b._id);
    this._blocks[idx] = withId(blockFromKey(s.matches[i].key)); // the "/query" text is discarded on convert
    this._closeSlash();
    this._render(); this._focusBlock(this._blocks[idx]._id); this._change();
  }

  // --- SOW-062 5c-2: inline selection toolbar (wraps the selection with literal Markdown tokens; defensive) ---
  _ceOf(node) {
    let n = node;
    while (n && n !== this.root) { if (n.nodeType === 1 && n.classList && n.classList.contains('ce')) return n; n = n.parentNode || n.host; }
    return null;
  }

  _updateSelToolbar() {
    if (!this.isConnected) return;
    let sel; try { sel = document.getSelection(); } catch { return; }
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { this._hideTb(); return; }
    const ce = this._ceOf(sel.anchorNode);
    if (!ce || !ce.dataset || (ce.dataset.edit !== 'text' && ce.dataset.edit !== 'code')) { this._hideTb(); return; }
    try { this._showTb(sel.getRangeAt(0)); } catch { this._hideTb(); }
  }

  _showTb(range) {
    const host = this.$('.doc-blocks'); if (!host) return;
    if (!this._tb) {
      const tb = document.createElement('div'); tb.className = 'sel-tb';
      tb.innerHTML = `<button type="button" data-w="bold" title="Bold">B</button>`
        + `<button type="button" data-w="italic" title="Italic" style="font-style:italic">I</button>`
        + `<button type="button" data-w="code" title="Inline code" style="font-family:var(--font-mono,monospace)">&lt;&gt;</button>`
        + `<button type="button" data-w="link" title="Link">Link</button>`;
      tb.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); this._wrap(b.dataset.w); }));
      host.appendChild(tb); this._tb = tb;
    }
    const hr = host.getBoundingClientRect(); const r = range.getBoundingClientRect();
    this._tb.style.top = `${r.top - hr.top - 40}px`;
    this._tb.style.left = `${Math.max(0, r.left - hr.left)}px`;
    this._tb.style.display = 'flex';
  }

  _hideTb() { if (this._tb) this._tb.style.display = 'none'; }

  _wrap(w) {
    let sel; try { sel = document.getSelection(); } catch { return; }
    if (!sel || sel.isCollapsed) return;
    const ce = this._ceOf(sel.anchorNode); if (!ce) return;
    if (ce.dataset.edit === 'code') return; // SOW-062 P6: code blocks stay literal -- no inline formatting
    if (w === 'link') { const url = (typeof prompt === 'function' ? prompt('Link URL', 'https://') : '') || ''; if (url && typeof document !== 'undefined') document.execCommand('createLink', false, url); }
    else if (w === 'code') this._toggleInline(sel, 'code');
    else if (typeof document !== 'undefined') document.execCommand(w); // 'bold' -> <strong>/<b>; 'italic' -> <em>/<i>
    const b = this._byId(ce.dataset.id);
    if (b) { b.text = inlineHtmlToMd(ce.innerHTML).replace(/\n$/, ''); this._change(); }
    this._hideTb();
  }

  // SOW-062 P6: toggle an inline tag around the selection (execCommand has no 'code'); ported from the design.
  _toggleInline(sel, tag) {
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const host = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const existing = host && host.closest ? host.closest(tag) : null;
    if (existing) { const txt = document.createTextNode(existing.textContent); existing.replaceWith(txt); return; }
    const node = document.createElement(tag);
    try { node.appendChild(r.extractContents()); r.insertNode(node); } catch { /* selection spans elements */ }
  }
}

define('gbti-doc-editor', GbtiDocEditor);
export { GbtiDocEditor };
