// sow-235: the hover selection toolbar and its link manager, shared by every rich-text surface.
//
// This was built inside gbti-doc-editor.mjs (the toolbar in SOW-062 phase 5c-2, the link panel in SOW-170) as
// private methods bound to that component's shadow root, its .ce elements and its block model. The WorkBench
// Preview needs the same thing over site-rendered HTML in the light DOM, so it is lifted out here rather than
// copied: one implementation, one place to fix, and the anchor-text field added once benefits both.
//
// The host supplies everything surface-specific through callbacks. The module owns the popovers, the selection
// plumbing and the link semantics, and knows nothing about blocks, Markdown or how the host stores its document.
import { isDangerousUrl } from './markdown-blocks.mjs';

const STYLE_ID = 'gbti-selection-toolbar-css';

/** Popover styling. --s-* is the editor palette; the site's V3 tokens are the fallback, so this looks right in
 *  both surfaces and in both themes without either host restating it. */
export const SELECTION_TOOLBAR_CSS = `
.gbti-stb, .gbti-lp {
  position: absolute; z-index: 40; display: none;
  --stb-pop: var(--s-surface, var(--paper, #fff));
  --stb-pop-2: var(--s-surface-2, var(--paper-2, #f4f3f7));
  --stb-line: var(--s-line, var(--line, #d9d7e0));
  --stb-fg: var(--s-fg, var(--fg, #25232b));
  --stb-fg-soft: var(--s-fg-soft, var(--fg-soft, #55525f));
  --stb-accent: var(--s-green, var(--green-700, #1f9e5f));
}
.gbti-stb { gap: 1px; padding: 4px; border-radius: 10px; background: var(--ink, #25232b); box-shadow: 0 12px 30px rgba(0,0,0,.4); }
.gbti-stb button {
  min-width: 30px; height: 30px; display: inline-flex; align-items: center; justify-content: center;
  border: 0; border-radius: 7px; background: transparent; color: #e6e4ee; cursor: pointer;
  font-weight: 700; font-size: 13px; padding: 0 6px; font-family: inherit;
}
.gbti-stb button:hover { background: rgba(255,255,255,.12); color: #fff; }
.gbti-lp {
  flex-direction: column; gap: 8px; padding: 10px; min-width: 268px;
  background: var(--stb-pop); border: 1.5px solid var(--stb-line); border-radius: 10px;
  box-shadow: 0 12px 34px rgba(0,0,0,.28); color: var(--stb-fg);
}
.gbti-lp input[type="text"], .gbti-lp input[type="url"] {
  font: inherit; font-size: 13px; color: var(--stb-fg); background: var(--stb-pop-2);
  border: 1px solid var(--stb-line); border-radius: 7px; padding: 7px 9px; min-width: 0;
}
.gbti-lp label { display: flex; align-items: center; gap: 7px; font-size: 13px; color: var(--stb-fg-soft); cursor: pointer; }
.gbti-lp .lp-btns { display: flex; gap: 8px; margin-top: 2px; }
.gbti-lp button {
  font: inherit; font-size: 13px; font-weight: 600; border-radius: 7px; padding: 6px 12px;
  cursor: pointer; border: 1px solid var(--stb-line); background: var(--stb-pop-2); color: var(--stb-fg);
}
.gbti-lp button[data-lk-apply] { border-color: var(--stb-accent); background: var(--stb-accent); color: #fff; }
`;

/** Inject the stylesheet once per root. A shadow root needs its own copy; the light DOM shares one in <head>. */
function ensureStyles(host) {
  const root = host.getRootNode ? host.getRootNode() : document;
  const target = root && root.nodeType === 11 ? root : document.head;   // 11 = DOCUMENT_FRAGMENT (a ShadowRoot)
  if (!target || target.querySelector(`#${STYLE_ID}`)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = SELECTION_TOOLBAR_CSS;
  target.appendChild(el);
}

/** The canonical rel for a link, given the two author choices. target=_blank must carry noopener (tab-nabbing). */
export function linkRel({ nofollow = false, blank = false } = {}) {
  return [nofollow ? 'nofollow' : null, blank ? 'noopener' : null].filter(Boolean).join(' ');
}

/**
 * Decide what the link panel's inputs MEAN, with no DOM involved. apply() below is then a thin applier of this
 * plan, which is what makes the link semantics testable: whether a URL is refused, what rel and target a pair of
 * checkboxes compose to, and whether the anchor text is being changed or left alone.
 *
 * Returns one of:
 *   { action: 'reject' }                          the URL scheme is dangerous; touch nothing
 *   { action: 'none' }                            nothing to do (no URL, and no link to remove)
 *   { action: 'remove' }                          unwrap the existing anchor, keep its text
 *   { action: 'create'|'update', href, rel, target, text }
 * where rel/target are null when the attribute should be absent, and text is null when the existing text stands.
 */
export function planLinkEdit({ url = '', text = '', nofollow = false, blank = false, hasExisting = false, existingText = '', remove = false } = {}) {
  const href = String(url ?? '').trim();
  if (remove || !href) return hasExisting ? { action: 'remove' } : { action: 'none' };
  if (isDangerousUrl(href)) return { action: 'reject' };
  const rel = linkRel({ nofollow, blank });
  const wanted = String(text ?? '').trim();
  return {
    action: hasExisting ? 'update' : 'create',
    href,
    rel: rel || null,
    target: blank ? '_blank' : null,
    text: wanted && wanted !== String(existingText ?? '') ? wanted : null,
  };
}

/**
 * Attach a selection toolbar to a surface.
 *
 * @param root        ShadowRoot or Document, for getSelection.
 * @param host        POSITIONED container the popovers are appended to (they position absolutely against it).
 *                    May be a FUNCTION returning it: gbti-doc-editor rebuilds its whole subtree on every render,
 *                    so the container is not stable and a captured element would leave the popovers detached.
 * @param editableOf  (node) => the editable element containing node, or null. Decides where the toolbar shows.
 * @param allowInline (el) => whether inline formatting applies here. False inside a code block, which stays literal.
 * @param onCommit    (el, reason) => write the edited element back. reason is 'format' or 'link'.
 */
export function createSelectionToolbar({ root, host, editableOf, allowInline = () => true, onCommit = () => {} }) {
  const hostEl = () => (typeof host === 'function' ? host() : host);
  if (!hostEl()) return { destroy() {}, isPanelOpen: () => false, hide() {} };

  /** Append (or re-append) a popover to the CURRENT host. A re-rendered surface leaves the old node orphaned. */
  const mount = (node) => {
    const h = hostEl();
    if (h && node.parentNode !== h) h.appendChild(node);
    return node;
  };

  let tb = null;      // the B / I / code / Link bar
  let lp = null;      // the link panel
  let lk = null;      // the pending link edit: { range, el, existing }

  const getSel = () => {
    try { return root?.getSelection?.() ?? document.getSelection(); } catch { return null; }
  };
  const place = (node, rect, above) => {
    const h = hostEl();
    if (!h) return;
    ensureStyles(h);
    mount(node);
    const hr = h.getBoundingClientRect();
    node.style.top = `${above ? rect.top - hr.top - 40 : rect.bottom - hr.top + 6}px`;
    node.style.left = `${Math.max(0, rect.left - hr.left)}px`;
    node.style.display = 'flex';
  };

  const hideTb = () => { if (tb) tb.style.display = 'none'; };
  const hidePanel = () => { if (lp) lp.style.display = 'none'; lk = null; };

  // --- the toolbar -------------------------------------------------------------------------------------------
  function buildTb() {
    const el = document.createElement('div');
    el.className = 'gbti-stb';
    el.innerHTML = '<button type="button" data-w="bold" title="Bold">B</button>'
      + '<button type="button" data-w="italic" title="Italic" style="font-style:italic">I</button>'
      + '<button type="button" data-w="code" title="Inline code" style="font-family:var(--f-mono,monospace)">&lt;&gt;</button>'
      + '<button type="button" data-w="link" title="Link">Link</button>';
    // mousedown + preventDefault, not click: the selection must survive pressing the button.
    el.querySelectorAll('button').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); wrap(b.dataset.w); }));
    return el;
  }

  function update() {
    if (lp && lp.style.display !== 'none') return;   // the panel owns the screen while it is open
    const sel = getSel();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideTb(); return; }
    const el = editableOf(sel.anchorNode);
    if (!el) { hideTb(); return; }
    try {
      if (!tb) tb = buildTb();
      place(tb, sel.getRangeAt(0).getBoundingClientRect(), true);
    } catch { hideTb(); }
  }

  function wrap(w) {
    const sel = getSel();
    if (!sel || sel.isCollapsed) return;
    const el = editableOf(sel.anchorNode);
    if (!el) return;
    if (!allowInline(el)) return;                    // a code block stays literal
    if (w === 'link') { openPanel(sel, el); return; } // applies + commits on its own
    if (w === 'code') toggleInline(sel, 'code');
    else if (typeof document !== 'undefined') document.execCommand(w); // bold -> <strong>/<b>; italic -> <em>/<i>
    onCommit(el, 'format');
    hideTb();
  }

  // execCommand has no 'code', so the tag is toggled by hand. Unwrapping uses textContent, matching the original.
  function toggleInline(sel, tag) {
    if (!sel.rangeCount || sel.isCollapsed) return;
    const r = sel.getRangeAt(0);
    const at = r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement;
    const existing = at && at.closest ? at.closest(tag) : null;
    if (existing) { existing.replaceWith(document.createTextNode(existing.textContent)); return; }
    const node = document.createElement(tag);
    try { node.appendChild(r.extractContents()); r.insertNode(node); } catch { /* selection spans elements */ }
  }

  // --- the link panel ----------------------------------------------------------------------------------------
  function anchorIn(range, stopAt) {
    let n = range.commonAncestorContainer;
    n = n && n.nodeType === 1 ? n : (n && n.parentNode);
    while (n && n !== root && n !== stopAt) {
      if (n.tagName === 'A') return n;
      n = n.parentNode;
    }
    return null;
  }

  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'gbti-lp';
    el.innerHTML = '<input type="text" data-lk-text placeholder="Link text" />'
      + '<input type="url" data-lk-url placeholder="https://..." />'
      + '<label><input type="checkbox" data-lk-nofollow /> nofollow</label>'
      + '<label><input type="checkbox" data-lk-blank /> New tab</label>'
      + '<div class="lp-btns"><button type="button" data-lk-apply>Apply</button>'
      + '<button type="button" data-lk-remove title="Remove link">Remove</button></div>';
    // Keep the saved range alive: anything that is not an input must not take focus away from the document.
    el.addEventListener('mousedown', (e) => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    el.querySelector('[data-lk-apply]').addEventListener('click', () => apply(false));
    el.querySelector('[data-lk-remove]').addEventListener('click', () => apply(true));
    el.querySelectorAll('input[type="text"], input[type="url"]').forEach((i) =>
      i.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); apply(false); }
        if (e.key === 'Escape') { e.preventDefault(); hidePanel(); }
      }));
    return el;
  }

  function openPanel(sel, el) {
    const range = sel.getRangeAt(0).cloneRange();
    const existing = anchorIn(range, el);
    lk = { range, el, existing };
    if (!lp) lp = buildPanel();
    const rel = existing ? (existing.getAttribute('rel') || '') : '';
    lp.querySelector('[data-lk-text]').value = existing ? (existing.textContent || '') : String(range.toString() || '');
    lp.querySelector('[data-lk-url]').value = existing ? (existing.getAttribute('href') || '') : '';
    lp.querySelector('[data-lk-nofollow]').checked = /\bnofollow\b/i.test(rel);
    lp.querySelector('[data-lk-blank]').checked = existing ? existing.getAttribute('target') === '_blank' : false;
    lp.querySelector('[data-lk-remove]').style.display = existing ? '' : 'none';
    place(lp, range.getBoundingClientRect(), false);
    hideTb();
    setTimeout(() => lp.querySelector('[data-lk-url]').focus(), 0);
  }

  function apply(remove) {
    if (!lk) return;
    const el = lk.el;
    const text = String(lp.querySelector('[data-lk-text]').value || '').trim();
    const url = String(lp.querySelector('[data-lk-url]').value || '').trim();
    const nofollow = lp.querySelector('[data-lk-nofollow]').checked;
    const blank = lp.querySelector('[data-lk-blank]').checked;
    const plan = planLinkEdit({
      url, text, nofollow, blank,
      hasExisting: !!lk.existing,
      existingText: lk.existing ? (lk.existing.textContent || '') : String(lk.range.toString() || ''),
      remove,
    });
    // A dangerous scheme never enters the live DOM, and a no-op leaves the document untouched rather than
    // committing an identical block.
    if (plan.action === 'reject' || plan.action === 'none') { hidePanel(); return; }
    // Put the saved selection back so the edit lands where the author made it.
    try { el.focus(); const s = getSel(); s.removeAllRanges(); s.addRange(lk.range); } catch { /* selection lost */ }

    const attrs = (a) => {
      a.setAttribute('href', plan.href);
      if (plan.rel) a.setAttribute('rel', plan.rel); else a.removeAttribute('rel');
      if (plan.target) a.setAttribute('target', plan.target); else a.removeAttribute('target');
    };
    if (plan.action === 'remove') {
      const a = lk.existing;
      if (a && a.parentNode) { while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove(); }
    } else if (plan.action === 'update') {
      const a = lk.existing;
      attrs(a);
      if (plan.text !== null) a.textContent = plan.text;
    } else {
      const a = document.createElement('a');
      attrs(a);
      try {
        a.appendChild(lk.range.extractContents());
        if (plan.text !== null) a.textContent = plan.text;
        lk.range.insertNode(a);
      } catch { /* selection spans blocks */ }
    }
    hidePanel();
    onCommit(el, 'link');
  }

  const onSel = () => update();
  document.addEventListener('selectionchange', onSel);

  return {
    isPanelOpen: () => !!lp && lp.style.display !== 'none',
    hide() { hideTb(); hidePanel(); },
    /**
     * Open the link manager for an existing anchor, without going through the selection. A single click on a link
     * inside a contenteditable neither navigates (Chrome and Firefox both suppress that) nor shows anything, so
     * the link reads as dead unless the host wires this. Builds its own Range rather than touching
     * document.getSelection(), so the selectionchange listener cannot flash the B/I/Link bar in behind the panel.
     */
    editLink(el, anchor) {
      if (!el || !anchor) return;
      const range = document.createRange();
      range.selectNodeContents(anchor);
      hideTb();
      openPanel({ getRangeAt: () => range }, el);
    },
    destroy() {
      document.removeEventListener('selectionchange', onSel);
      tb?.remove(); lp?.remove();
      tb = null; lp = null; lk = null;
    },
  };
}
