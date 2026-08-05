// <gbti-collection> (SOW-024): upgrades the inert "Save to collection" control baked by CollectionButton.astro.
// The public static build ships `<gbti-collection data-gbti-target-type=.. data-gbti-target-slug=..>` with a
// folder pill (a [data-signin] nudge for visitors). When a host loads @gbti/client-ui, this element upgrades
// into a working picker: a click opens a popover listing the member's collections (read from the deletable
// edge store via client.getActivity()), with a checkbox per collection to add/remove THIS item, plus a "new
// collection" input. Writes go through client.addToCollection() / client.createCollection() -> the signup
// Worker's /membership/activity. The GitHub token never reaches the page (the host holds it).
import { GbtiElement, define } from '../base.mjs';

const folder = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h3.2l1.6 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

const CSS = `
  :host { position: relative; display: inline-flex; }
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  /* sow-179: icon-only (aria-label already carries the name), for the Editorial/Journal sticky action rail. */
  .pill.rail { width:38px; height:38px; padding:0; justify-content:center; border-radius:7px; }
  .pill.rail span { display:none; }
  .pop { position:absolute; z-index:50; top:calc(100% + 8px); left:0; width:260px; max-height:340px; overflow:auto;
    background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:12px;
    box-shadow:0 12px 36px rgba(0,0,0,.18); padding:10px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .pop h4 { margin:2px 6px 8px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  .row { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13.5px; }
  .row:hover { background:var(--hover, rgba(0,0,0,.04)); }
  .row .box { width:16px; height:16px; border:1.5px solid var(--line); border-radius:4px; display:inline-flex; align-items:center; justify-content:center; flex:none; color:#fff; }
  .row.in .box { background:var(--brand); border-color:var(--brand); }
  .row .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .empty { padding:8px; font-size:12.5px; color:var(--muted); }
  .new { display:flex; gap:6px; margin-top:8px; border-top:1px solid var(--line); padding-top:10px; }
  .new input { flex:1; min-width:0; font:inherit; font-size:13px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  .new button { font:inherit; font-size:13px; font-weight:600; padding:6px 12px; border:0; border-radius:8px; background:var(--brand); color:#fff; cursor:pointer; }
  .busy { opacity:.55; pointer-events:none; }
`;

class GbtiCollection extends GbtiElement {
  render() {
    const open = this._open ? this._renderPop() : '';
    const label = !this.client ? 'Sign in to save to a collection' : 'Save to a collection';
    this.set(this.css(CSS) + `<button class="pill ${this._inAny() ? 'on' : ''}" type="button" aria-haspopup="true" aria-expanded="${!!this._open}" aria-label="${label}">${folder}<span>Save</span></button>${open}`);
    this.on('.pill', 'click', (e) => { e.stopPropagation(); this._toggleOpen(); });
    if (this._open) this._wirePop();
  }

  _inAny() {
    const t = this._target();
    return (this._collections || []).some((c) => (c.items || []).some((it) => it.type === t.type && it.slug === t.slug));
  }
  _target() {
    return { type: this.dataset?.gbtiTargetType, slug: this.dataset?.gbtiTargetSlug };
  }

  async _toggleOpen() {
    if (!this.client) { window.location.href = '/membership/'; return; }
    this._open = !this._open;
    if (this._open) {
      this.render();
      await this._load();
      // close on outside click / Escape
      // composedPath (not this.contains): when this element is nested inside ANOTHER shadow root (e.g. the
      // extension reader), a document click retargets ev.target to the OUTER host, so this.contains would wrongly
      // read every in-popover click (including focusing the new-collection input) as "outside" and close it.
      this._away = (ev) => { if (!ev.composedPath().includes(this)) this._close(); };
      this._esc = (ev) => { if (ev.key === 'Escape') this._close(); };
      document.addEventListener('click', this._away);
      document.addEventListener('keydown', this._esc);
    } else {
      this._close();
    }
  }
  _close() {
    this._open = false;
    if (this._away) document.removeEventListener('click', this._away);
    if (this._esc) document.removeEventListener('keydown', this._esc);
    this.render();
  }

  async _load() {
    try {
      const a = await this.client.getActivity();
      this._collections = a?.collections || [];
    } catch (err) {
      if (err?.code === 'not-authenticated' || err?.code === 'membership-required') { window.location.href = '/membership/'; return; }
      this._collections = [];
    }
    this.render();
  }

  _renderPop() {
    const t = this._target();
    const rows = (this._collections || []).map((c) => {
      const inIt = (c.items || []).some((it) => it.type === t.type && it.slug === t.slug);
      return `<div class="row ${inIt ? 'in' : ''}" data-id="${c.id}"><span class="box">${inIt ? '✓' : ''}</span><span class="nm">${escapeHtml(c.name)}</span></div>`;
    }).join('');
    return `<div class="pop ${this._busy ? 'busy' : ''}"><h4>Save to collection</h4>${rows || '<div class="empty">No collections yet. Create one below.</div>'}<div class="new"><input type="text" placeholder="New collection" maxlength="80" /><button type="button">Create</button></div></div>`;
  }

  _wirePop() {
    this.$$('.row').forEach((row) => row.addEventListener('click', () => this._toggleItem(row.dataset.id)));
    const input = this.$('.new input');
    const create = () => this._create(input?.value || '');
    this.on('.new button', 'click', create);
    if (input) input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
  }

  async _toggleItem(id) {
    const t = this._target();
    const c = (this._collections || []).find((x) => x.id === id);
    if (!c) return;
    const on = !(c.items || []).some((it) => it.type === t.type && it.slug === t.slug);
    this._busy = true; this.render();
    try {
      const res = await this.client.addToCollection({ id, targetType: t.type, targetSlug: t.slug, on });
      this._collections = res?.activity?.collections || this._collections;
    } catch (err) {
      if (err?.code === 'not-authenticated' || err?.code === 'membership-required') { window.location.href = '/membership/'; return; }
    }
    this._busy = false; this.render();
  }

  async _create(name) {
    const nm = String(name || '').trim();
    if (!nm) return;
    const t = this._target();
    this._busy = true; this.render();
    try {
      const made = await this.client.createCollection({ name: nm });
      this._collections = made?.activity?.collections || this._collections;
      if (made?.id) {
        const res = await this.client.addToCollection({ id: made.id, targetType: t.type, targetSlug: t.slug, on: true });
        this._collections = res?.activity?.collections || this._collections;
      }
    } catch (err) {
      if (err?.code === 'not-authenticated' || err?.code === 'membership-required') { window.location.href = '/membership/'; return; }
    }
    this._busy = false; this.render();
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

define('gbti-collection', GbtiCollection);
export { GbtiCollection };
