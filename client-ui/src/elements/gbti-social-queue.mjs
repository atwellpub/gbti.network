// <gbti-social-queue> (SOW-121): the superadmin Social Queue popup. A manual-assist worklist for channels
// that cost money to post (X, after its free API tier was deprecated): the system renders + queues the post,
// a human posts it by hand through the FREE web composer, then marks it done. Three tabs: To do (pending
// tasks: Assist -> the pre-filled web composer, Done, Delete), Manual done (posted-by-hand history), and Auto
// done (the adapter-posted activity, reused from client.syndicationQueue()). Each tab has type/channel/search
// filters + pagination. Superadmin-gated by the Worker (a non-superadmin read 403s). Inert without a client.
// Renders its own 70vw panel inside the shell's .compose-modal overlay; the X close button dispatches
// gbti-social-close for the overlay to catch.
import { GbtiElement, define, esc } from '../base.mjs';
import { socialIcon } from '../social-icons.mjs';
import { channelCapability } from '../../../membership/syndication-config-core.mjs'; // Post now is auto-capability only

// The free web composer for a manual-assist channel (X opens the intent composer, pre-filled).
// SOW-121/127: the free web composer for a manual-assist channel, pre-filled with the rendered text. X uses
// its intent composer; LinkedIn opens the feed share composer with the text (LinkedIn no longer guarantees a
// text prefill, so the "Copy" button is the reliable fallback: copy, then paste into the composer).
const composeUrl = (channel, text) => {
  const t = encodeURIComponent(String(text || ''));
  if (channel === 'x') return `https://twitter.com/intent/tweet?text=${t}`;
  if (channel === 'linkedin') return `https://www.linkedin.com/feed/?shareActive=true&text=${t}`;
  if (channel === 'dailydev') return 'https://app.daily.dev/squads/gbti_network'; // SOW-135: no text prefill; Assist opens the squad, the Copy button supplies the link
  if (channel === 'hashnode') return 'https://hashnode.com/draft'; // Hashnode is a full-article cross-post: Assist opens a new draft; copy the article from the gbti.network link in the task text
  return null;
};
const CH_LABEL = { x: 'X', discord: 'Discord', 'discord-category': 'Discord', reddit: 'Reddit', devto: 'dev.to', hashnode: 'Hashnode', dailydev: 'daily.dev', linkedin: 'LinkedIn', bluesky: 'Bluesky' };
const CH_ICON = { x: 'x', discord: 'discord', 'discord-category': 'discord', reddit: 'reddit', devto: 'devto', hashnode: 'hashnode', dailydev: 'dailydev', linkedin: 'linkedin', bluesky: 'bluesky' };
const SRC_LABEL = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };
const PAGE_SIZE = 12;
const fmtDate = (ms) => { try { return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };

const CSS = `
  :host { display:block; width:70vw; max-width:1100px; max-height:86vh; overflow:hidden; display:flex; flex-direction:column;
    background:var(--bg); color:var(--fg); border:1.5px solid var(--line); border-radius:7px; box-shadow:var(--sh-lg, 0 24px 60px rgba(0,0,0,.4)); font-family:var(--font-body); }
  .hd { display:flex; align-items:center; gap:12px; padding:14px 18px; border-bottom:1.5px solid var(--line); flex:none; }
  .hd h2 { margin:0; font-family:var(--font-display, inherit); font-weight:800; font-size:16px; letter-spacing:.02em; text-transform:uppercase; flex:1; }
  .hd .x { background:none; border:1.5px solid var(--line); border-radius:7px; color:var(--fg-mute, var(--muted)); width:32px; height:32px; cursor:pointer; font-size:15px; line-height:1; }
  .hd .x:hover { border-color:var(--fg-mute, var(--muted)); }
  .body { padding:12px 18px 16px; overflow:auto; flex:1; }
  .tabs { display:flex; gap:5px; margin:0 0 10px; }
  .tab { font:inherit; font-size:12.5px; font-weight:700; color:var(--muted); background:none; border:1.5px solid var(--line); border-radius:7px; padding:5px 12px; cursor:pointer; }
  .tab.on { color:var(--brand); border-color:var(--brand); background:var(--brand-tint, rgba(31,158,95,.1)); }
  .tab .n { font-family:var(--font-mono, monospace); font-size:10.5px; opacity:.8; margin-left:5px; }
  .hint { color:var(--muted); font-size:11.5px; margin:0 0 10px; line-height:1.5; }
  .msg { font-size:12.5px; color:var(--accent); margin:0 0 10px; } .msg.err { color:var(--danger, #e06c6c); }
  .empty { padding:26px 10px; text-align:center; color:var(--muted); font-family:var(--font-mono, monospace); font-size:12px; }
  .busy { opacity:.55; pointer-events:none; }

  .fbar { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 10px; align-items:center; }
  .fbar select, .fbar input { width:auto; font:inherit; font-size:12px; color:var(--fg); background:var(--bg); border:1.5px solid var(--line); border-radius:7px; padding:6px 9px; outline:none; }
  .fbar select:focus, .fbar input:focus { border-color:var(--brand); }
  .fbar input { flex:1; min-width:150px; }
  .fbar .count { align-self:center; font-family:var(--font-mono, monospace); font-size:11px; color:var(--muted); margin-left:auto; }

  /* compact rows */
  .row { display:flex; align-items:center; gap:10px; padding:8px 11px; border:1.5px solid var(--line); border-radius:7px; margin:0 0 7px; }
  .row .src { font-size:9.5px; font-weight:800; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); border:1px solid var(--line); border-radius:7px; padding:2px 7px; flex:none; }
  .row .ti { font-weight:700; font-size:13px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .ti a { color:var(--fg); text-decoration:none; } .row .ti a:hover { color:var(--accent); }
  .row .when { font-size:11px; color:var(--muted); font-variant-numeric:tabular-nums; white-space:nowrap; flex:none; }
  .chans { display:flex; gap:5px; flex:none; }
  .chip { display:inline-flex; align-items:center; gap:4px; font-size:9.5px; font-weight:700; text-transform:uppercase; letter-spacing:.03em; color:var(--muted); border:1px solid var(--line); border-radius:7px; padding:2px 6px; white-space:nowrap; }
  .chip svg { width:12px; height:12px; flex:none; }
  .chip.sent { color:var(--brand); border-color:var(--brand); } .chip.failed { color:var(--danger, #e06c6c); border-color:var(--danger, #e06c6c); }
  .chip.big { font-size:11px; padding:3px 8px; } .chip.big svg { width:14px; height:14px; }

  /* to-do task (needs the text + actions) */
  .task { border:1.5px solid var(--line); border-radius:7px; padding:11px 12px; margin:0 0 9px; }
  .task .top { display:flex; align-items:center; gap:8px; margin-bottom:7px; }
  .task .ti { font-weight:700; font-size:13px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .task .txt { font-size:12px; color:var(--fg-soft, var(--fg)); background:var(--hover); border-radius:7px; padding:8px 10px; margin:0 0 9px; white-space:pre-wrap; word-break:break-word; line-height:1.5; max-height:100px; overflow:auto; }
  .acts { display:flex; gap:7px; flex-wrap:wrap; }
  .btn { font:inherit; font-size:12px; font-weight:700; border-radius:7px; padding:6px 11px; cursor:pointer; border:1.5px solid var(--line); background:none; color:var(--fg); display:inline-flex; align-items:center; gap:6px; }
  .btn svg { width:13px; height:13px; }
  .btn.assist { color:#fff; background:var(--brand); border-color:var(--brand); } .btn.assist:hover { filter:brightness(1.06); }
  .btn.done { color:var(--brand); border-color:var(--brand); }
  .btn.del { color:var(--danger, #e06c6c); } .btn.del:hover { border-color:var(--danger, #e06c6c); }
  .btn:hover { border-color:var(--fg-mute, var(--muted)); }

  .pager { display:flex; align-items:center; justify-content:center; gap:10px; margin-top:10px; }
  .pager button { font:inherit; font-size:12px; font-weight:700; border:1.5px solid var(--line); border-radius:7px; background:none; color:var(--fg); padding:5px 12px; cursor:pointer; }
  .pager button:disabled { opacity:.4; cursor:default; }
  .pager .pg { font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); }
`;

class GbtiSocialQueue extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._tab = this._tab || 'todo';
    this._page = 0;
    this._fType = 'all'; this._fChannel = 'all'; this._fQ = '';
    this._data = null; this._auto = null;
    this._msg = ''; this._err = false; this._busy = false;
    if (this.client) this.load(); else this.render();
  }

  async load() {
    if (!this.client) { this.render(); return; }
    this._loading = true;
    try { this._data = await this.client.socialQueue(); this._err = false; }
    catch (e) { this._err = true; this._msg = e?.message || 'Could not load the Social Queue.'; }
    this._loading = false;
    this.render();
  }
  async _loadAuto() {
    if (this._auto || !this.client) return;
    try { const q = await this.client.syndicationQueue(); this._auto = Array.isArray(q?.sent) ? q.sent : []; }
    catch { this._auto = []; }
    this.render();
  }

  _rawList() {
    if (this._tab === 'todo') return this._data?.pending || [];
    if (this._tab === 'manual') return this._data?.done || [];
    return this._auto || [];
  }
  _chansOf(row) { return this._tab === 'auto' ? Object.keys(row.perChannel || {}) : [row.channel]; }
  _filtered() {
    const q = this._fQ.trim().toLowerCase();
    return this._rawList().filter((r) =>
      (this._fType === 'all' || (r.source || '') === this._fType)
      && (this._fChannel === 'all' || this._chansOf(r).includes(this._fChannel))
      && (!q || String(r.title || r.targetSlug || '').toLowerCase().includes(q)));
  }
  _channelOptions() {
    const set = new Set();
    for (const r of this._rawList()) for (const c of this._chansOf(r)) if (c) set.add(c);
    return [...set];
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + this._shell(`<p class="empty">Open in the GBTI client (superadmin) to use the Social Queue.</p>`)); this._wire(); return; }
    if (this._err) { this.set(this.css(CSS) + this._shell(`<p class="msg err">${esc(this._msg)}</p><button class="btn" data-reload type="button">Retry</button>`)); this._wire(); this.$('[data-reload]')?.addEventListener('click', () => this.load()); return; }
    if (!this._data) { if (!this._loading) this.load(); this.set(this.css(CSS) + this._shell(`<p class="empty">Loading the Social Queue...</p>`)); this._wire(); return; }

    const nPending = (this._data.pending || []).length, nDone = (this._data.done || []).length, nAuto = (this._auto || []).length;
    const tabBtn = (k, label, n) => `<button class="tab ${this._tab === k ? 'on' : ''}" data-tab="${k}" type="button">${label}<span class="n">${n}</span></button>`;
    const hint = this._tab === 'todo'
      ? 'Posts held for your review. On a channel the system can post to, Post now sends the text below through the adapter; on X and LinkedIn, Assist opens the free web composer (or Copy the text), post it by hand, then mark it Done.'
      : this._tab === 'manual' ? 'Posts completed from this queue (Post now or by hand).' : 'Posts the system sent automatically (the On-Automatic channels).';

    const filtered = this._filtered();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (this._page >= pages) this._page = pages - 1;
    const paged = filtered.slice(this._page * PAGE_SIZE, this._page * PAGE_SIZE + PAGE_SIZE);
    const rows = paged.length
      ? paged.map((r) => (this._tab === 'todo' ? this._todoRow(r) : this._tab === 'manual' ? this._doneRow(r) : this._autoRow(r))).join('')
      : `<p class="empty">${this._rawList().length ? 'Nothing matches the filters.' : (this._tab === 'todo' ? 'Nothing to post by hand right now.' : this._tab === 'manual' ? 'No manual posts yet.' : 'No automated posts yet.')}</p>`;

    const opt = (v, l, cur) => `<option value="${esc(v)}"${cur === v ? ' selected' : ''}>${esc(l)}</option>`;
    const chOpts = this._channelOptions();

    this.set(this.css(CSS) + this._shell(`
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="tabs">${tabBtn('todo', 'To do', nPending)}${tabBtn('manual', 'Manual done', nDone)}${tabBtn('auto', 'Auto done', nAuto || '')}</div>
      <p class="hint">${esc(hint)}</p>
      <div class="fbar">
        <select data-f="type" aria-label="Filter by type">${opt('all', 'All types', this._fType)}${Object.entries(SRC_LABEL).map(([v, l]) => opt(v, l, this._fType)).join('')}</select>
        <select data-f="channel" aria-label="Filter by channel">${opt('all', 'All channels', this._fChannel)}${chOpts.map((c) => opt(c, CH_LABEL[c] || c, this._fChannel)).join('')}</select>
        <input data-f="q" type="search" placeholder="Search titles" value="${esc(this._fQ)}" aria-label="Search titles" />
        <span class="count">${filtered.length} item${filtered.length === 1 ? '' : 's'}</span>
      </div>
      <div class="${this._busy ? 'busy' : ''}">${rows}</div>
      ${pages > 1 ? `<div class="pager"><button data-pg="prev" type="button" ${this._page === 0 ? 'disabled' : ''}>Prev</button><span class="pg">Page ${this._page + 1} of ${pages}</span><button data-pg="next" type="button" ${this._page >= pages - 1 ? 'disabled' : ''}>Next</button></div>` : ''}
    `));
    this._wire();
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this._page = 0; this._fChannel = 'all'; if (this._tab === 'auto') this._loadAuto(); this.render(); }));
    this.$$('[data-f]').forEach((el) => el.addEventListener(el.dataset.f === 'q' ? 'input' : 'change', () => {
      if (el.dataset.f === 'type') this._fType = el.value; else if (el.dataset.f === 'channel') this._fChannel = el.value; else this._fQ = el.value;
      this._page = 0;
      const focusQ = el.dataset.f === 'q';
      this.render();
      if (focusQ) { const q = this.$('[data-f="q"]'); if (q) { q.focus(); q.setSelectionRange(q.value.length, q.value.length); } }
    }));
    this.$$('[data-pg]').forEach((b) => b.addEventListener('click', () => { this._page += b.dataset.pg === 'next' ? 1 : -1; this.render(); }));
    this.$$('[data-assist]').forEach((b) => b.addEventListener('click', () => this._assist(b.dataset.assist)));
    this.$$('[data-copy]').forEach((b) => b.addEventListener('click', () => this._copy(b.dataset.copy)));
    this.$$('[data-done]').forEach((b) => b.addEventListener('click', () => this._action('done', b.dataset.done)));
    this.$$('[data-del]').forEach((b) => b.addEventListener('click', () => this._action('delete', b.dataset.del)));
    this.$$('[data-post]').forEach((b) => b.addEventListener('click', () => this._action('post', b.dataset.post)));
  }

  _shell(inner) { return `<div class="hd"><h2>Social Queue</h2><button class="x" data-close type="button" aria-label="Close">✕</button></div><div class="body">${inner}</div>`; }
  _wire() { this.$('[data-close]')?.addEventListener('click', () => this.dispatchEvent(new CustomEvent('gbti-social-close', { bubbles: true, composed: true }))); }
  _byId(id) { return (this._data?.pending || []).find((t) => t.id === id) || (this._data?.done || []).find((t) => t.id === id) || null; }
  _chip(channel, status, big) { return `<span class="chip ${status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : ''}${big ? ' big' : ''}">${socialIcon(CH_ICON[channel] || channel, big ? 14 : 12)}${esc(CH_LABEL[channel] || channel)}${status ? ` ${esc(status)}` : ''}</span>`; }

  _todoRow(t) {
    // The primary action depends on the channel's capability: an AUTO channel (an On-Manual matrix cell put
    // it here for review) posts through its adapter with one click; a MANUAL channel (x, linkedin) opens the
    // free web composer (Assist) or falls back to Copy, and a human marks it done.
    const label = CH_LABEL[t.channel] || t.channel;
    const url = composeUrl(t.channel, t.text);
    const primary = channelCapability(t.channel) === 'auto'
      ? `<button class="btn assist" data-post="${esc(t.id)}" type="button">${socialIcon(CH_ICON[t.channel] || t.channel, 13)} Post now to ${esc(label)}</button>`
      : url
        ? `<button class="btn assist" data-assist="${esc(t.id)}" type="button">${socialIcon(CH_ICON[t.channel] || t.channel, 13)} Assist post to ${esc(label)}</button>`
        : `<button class="btn copy" data-copy="${esc(t.id)}" type="button">Copy text</button>`;
    return `<div class="task">
      <div class="top"><span class="src">${esc(SRC_LABEL[t.source] || t.source || '')}</span>${this._chip(t.channel, '', true)}<span class="ti">${esc(t.title || t.itemId || '(untitled)')}</span><span class="when">${t.createdAt ? esc(fmtDate(t.createdAt)) : ''}</span></div>
      <div class="txt">${esc(t.text || '')}</div>
      <div class="acts">${primary}<button class="btn copy" data-copy="${esc(t.id)}" type="button">Copy</button><button class="btn done" data-done="${esc(t.id)}" type="button">Mark done</button><button class="btn del" data-del="${esc(t.id)}" type="button">Delete</button></div>
    </div>`;
  }
  _doneRow(t) {
    return `<div class="row"><span class="src">${esc(SRC_LABEL[t.source] || t.source || '')}</span>${this._chip(t.channel, 'sent')}<span class="ti">${esc(t.title || '(untitled)')}</span><span class="when">${t.doneAt ? esc(fmtDate(t.doneAt)) : ''}</span><button class="btn del" data-del="${esc(t.id)}" type="button">Delete</button></div>`;
  }
  _autoRow(it) {
    const chans = Object.entries(it.perChannel || {}).map(([n, r]) => this._chip(n, r?.status || 'sent')).join('');
    const title = it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noopener">${esc(it.title || it.targetSlug || '(untitled)')}</a>` : esc(it.title || it.targetSlug || '(untitled)');
    return `<div class="row"><span class="src">${esc(SRC_LABEL[it.source] || it.source || '')}</span><span class="ti">${title}</span><span class="chans">${chans}</span><span class="when">${it.sentAt ? esc(fmtDate(it.sentAt)) : ''}</span></div>`;
  }

  _assist(id) {
    const t = this._byId(id); if (!t) return;
    const url = composeUrl(t.channel, t.text);
    if (url) { try { window.open(url, '_blank', 'noopener'); } catch { /* popup blocked */ } }
    this._msg = 'Opened the composer. Post it, then click "Mark done".'; this.render();
  }
  async _copy(id) {
    const t = this._byId(id); if (!t) return;
    try { await navigator.clipboard?.writeText?.(t.text || ''); this._msg = 'Copied the post text.'; }
    catch { this._msg = 'Could not copy automatically; select the text to copy it.'; }
    this.render();
  }
  async _action(action, id) {
    if (!id) return;
    if (action === 'delete' && typeof confirm === 'function' && !confirm('Delete this item from the Social Queue?')) return;
    if (action === 'post') {
      const t = this._byId(id);
      const label = t ? (CH_LABEL[t.channel] || t.channel) : 'the channel';
      if (typeof confirm === 'function' && !confirm(`Post this to ${label} now? The reviewed text above is exactly what goes out.`)) return;
    }
    this._busy = true; this.render();
    try { await this.client.socialQueueAction({ action, id }); this._msg = action === 'done' ? 'Marked done.' : action === 'post' ? 'Posted.' : 'Deleted.'; await this.load(); }
    catch (e) { this._msg = e?.message || 'Action failed.'; }
    finally { this._busy = false; this.render(); }
  }
}

define('gbti-social-queue', GbtiSocialQueue);
export { GbtiSocialQueue };
