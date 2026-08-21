// <gbti-word-manager> (sow-259): the admin word-of-the-day pool manager. Lists words from house/words.yml
// (client.wordPool) and lets an admin ADD / REMOVE / ENABLE-DISABLE each via the admin ops, which open an
// auto-merged house PR (the SOW-038 governance model; the host token never leaves the host and the gate is the real
// boundary). Edits go live at the Pages-deploy cadence, when the rebuilt /words.json ships. Inert in public (no
// injected client). Host-agnostic. A direct sibling of <gbti-quote-manager>. Words are keyed by the word itself.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add input[data-add-word] { flex:1 1 150px; }
  .add input[data-add-pos] { flex:0 1 130px; }
  .add textarea { flex:2 1 260px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; resize:vertical; min-height:38px; }
  .add input { min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .w { border-top:1px solid var(--line); }
  .w:first-child { border-top:0; }
  .w.off { opacity:.55; }
  .row { display:flex; align-items:flex-start; gap:10px; padding:10px 2px; }
  .tx { flex:1; min-width:0; }
  .term { display:block; color:var(--fg); font-size:14px; font-weight:700; }
  .pos { font-size:11.5px; color:var(--accent); text-transform:uppercase; letter-spacing:.06em; margin-left:7px; font-weight:600; }
  .def { display:block; font-size:12.5px; color:var(--muted); margin-top:2px; line-height:1.45; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;

class GbtiWordManager extends GbtiElement {
  // Same upgrade-order caution as the quote manager: this element sits in admin.html's STATIC markup, so it
  // upgrades BEFORE admin.mjs injects the client. Do not load eagerly here; render() retries the load the moment
  // the client arrives (setClient re-renders subscribers), or it sticks on "Loading..." forever.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._words = (await this.client.wordPool())?.words || []; }
    catch { this._words = []; this._msg = 'Could not load the words.'; }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage words.</p>`); return; }
    if (!this._words) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading words...</p>`); return; }
    const enabled = this._words.filter((w) => w && w.enabled !== false).length;
    const rows = this._words.map((w) => {
      const on = w && w.enabled !== false;
      return `<li class="w ${on ? '' : 'off'}"><div class="row">`
        + `<span class="tx"><span class="term">${esc(w.word || '')}${w.partOfSpeech ? `<span class="pos">${esc(w.partOfSpeech)}</span>` : ''}</span>`
        + `<span class="def">${esc(w.definition || '')}</span></span>`
        + `<button class="lk" type="button" data-toggle="${esc(w.word || '')}" data-on="${on ? '1' : '0'}">${on ? 'Disable' : 'Enable'}</button>`
        + `<button class="lk danger" type="button" data-remove="${esc(w.word || '')}">Remove</button>`
        + `</div></li>`;
    }).join('');
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><span class="hint">${this._words.length} words, ${enabled} enabled</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add">
        <input data-add-word type="text" placeholder="Word" />
        <input data-add-pos type="text" placeholder="Part of speech" />
        <textarea data-add-def placeholder="The definition"></textarea>
        <button class="btn" type="button" data-add>Add word</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The homepage rail shows one enabled word, rotating every 24 hours. With ${enabled} enabled, the pool repeats every ${enabled || 0} days. Disable a word to retire it without losing the history.</p>
      <ul class="list">${rows || '<li class="muted">No words yet.</li>'}</ul>
    </div>`);
    this._wire();
  }

  _wire() {
    this.on('[data-add]', 'click', () => {
      const word = (this.$('[data-add-word]')?.value || '').trim();
      const partOfSpeech = (this.$('[data-add-pos]')?.value || '').trim();
      const definition = (this.$('[data-add-def]')?.value || '').trim();
      if (!word) { this._msg = 'A word is required.'; this.render(); return; }
      if (!definition) { this._msg = 'A definition is required.'; this.render(); return; }
      this._run(() => this.client.addWord({ word, partOfSpeech, definition }));
    });
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () =>
      this._run(() => this.client.setWordEnabled({ word: b.dataset.toggle, enabled: b.dataset.on !== '1' }))));
    this.$$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const word = b.dataset.remove;
      if (typeof confirm === 'function' && !confirm(`Remove this word?\n\n"${word}"`)) return;
      this._run(() => this.client.removeWord({ word }));
    }));
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).'
        : (r?.prNumber ? submitAck({ prNumber: r.prNumber, autoMerge: false }) : 'Done.'); // SOW-072 P2: consistent ack (house edit -> code-owner review)
    } catch (e) {
      this._msg = e?.message || 'That edit failed.';
    }
    this._busy = false;
    await this.load();
  }
}

define('gbti-word-manager', GbtiWordManager);
export { GbtiWordManager };
