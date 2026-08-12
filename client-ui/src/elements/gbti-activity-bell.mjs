// <gbti-activity-bell> (SOW-042 P3): the shell top-bar activity bell. v1 is a CLIENT-SIDE aggregator (no new Worker
// route): it fans out IN PARALLEL to four existing per-member reads, each fail-closed to [], normalizes them, and
// (via activity-bell.mjs) computes an unread badge + a grouped dropdown that deep-links into the relevant surface.
//   - To review  -> client.listContributions()        -> workspace.html#tab=inbox
//   - Your PRs    -> client.listPRs() (resolved only)  -> the PR's GitHub URL
//   - Replies     -> replies on the caller's OWN Shares -> the Shares filter on the unified feed (newtab.html#tab=share)
//   - Following   -> getFollows() ∩ the activity-index -> the in-extension reader (newtab feed deep-link)
// Unread = items past a localStorage watermark (gbti-bell-seen), set when the panel opens. A Locked/unknown account
// hides the bell entirely (no count). Content-item replies + a cross-device server marker defer to P4. Throttle: a
// light poll + on-open; the replies fan-out over the caller's own Shares is hard-bounded.
import { GbtiElement, define, esc } from '../base.mjs';
import { buildBell, markSeen } from '../activity-bell.mjs';
import { canSeeShares, toMs } from '../all-merge.mjs';
import { buildReadHash } from '../browse-hash.mjs';
import { relTime, absTime } from '../time-core.mjs'; // sow-221 follow-up: the shared "time ago" + its tooltip
import { prLifecycle } from '../workspace-core.mjs'; // SOW-072 P2: the shared PR-lifecycle model (rejection never silent)

const SITE = 'https://gbti.network';
const POLL_MS = 120000; // a light poll (the panel-open refresh is the responsive path)
const SEEN_KEY = 'gbti-bell-seen';
const MAX_OWN_SHARES = 20; // bound the replies-on-Shares fan-out (one listShareComments per own Share)

const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3 21a2 2 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
// SOW-095: the "All marked read" confirmation check.
const CHECK = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

function loadSeen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || {}; } catch { return {}; } }
function saveSeen(s) { try { localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch { /* private mode */ } }

const CSS = `
  :host { position:relative; display:inline-flex; font-family:var(--font-body); }
  .btn { width:40px; height:40px; border-radius:50%; border:1.5px solid var(--line); background:var(--panel); color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; transition:border-color .15s, color .15s; }
  .btn:hover { color:var(--fg); }
  .btn svg { width:19px; height:19px; }
  .dot { position:absolute; top:-3px; right:-3px; min-width:18px; height:18px; padding:0 4px; border-radius:999px; background:var(--danger,#d8453b); color:#fff; font-family:var(--font-mono, monospace); font-size:11px; font-weight:700; line-height:18px; text-align:center; box-shadow:0 0 0 2px var(--panel); }
  .panel { position:absolute; top:calc(100% + 8px); right:0; width:340px; max-height:70vh; overflow-y:auto; background:var(--panel); border:1.5px solid var(--line); border-radius:14px; box-shadow:0 16px 40px -12px rgba(0,0,0,.4); padding:6px; z-index:90; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .panel[hidden] { display:none; }
  .phead { display:flex; align-items:baseline; justify-content:space-between; padding:8px 10px 6px; }
  .phead b { font-family:var(--font-display, var(--font-body)); font-size:15px; }
  .phead .clr { background:transparent; border:0; color:var(--muted); font:inherit; font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:5px; }
  .phead .clr:hover { color:var(--accent); }
  /* SOW-095: the "Mark all read" processing + confirmation states. */
  .phead .clr[disabled] { cursor:default; }
  .phead .clr.done { color:var(--accent); }
  .phead .clr .spin { display:inline-block; width:11px; height:11px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:ab-spin .7s linear infinite; }
  @keyframes ab-spin { to { transform:rotate(360deg); } }
  .grp { padding:6px 4px 2px; }
  .grp-h { display:flex; align-items:center; gap:7px; padding:4px 8px; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
  .grp-h .n { background:var(--hover); color:var(--fg); border-radius:999px; padding:0 6px; font-size:10px; }
  .it { display:block; padding:8px 10px; border-radius:9px; color:var(--fg); cursor:pointer; }
  .it:hover { background:var(--hover); }
  .it .t { font-size:13.5px; font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it .s { font-size:12px; color:var(--muted); display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it.unread .t::before { content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--accent); margin-right:7px; vertical-align:middle; }
  .empty { color:var(--muted); font-size:13px; padding:18px 12px; text-align:center; }
`;

class GbtiActivityBell extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._seen = loadSeen();
    this._bell = null;   // the view-model, or null while the first load is pending
    this._sources = null; // the last fetched raw sources (for markSeen on open)
    this._gated = true;  // hidden until membership resolves to paid/trialing
    this._open = false;
    this._login = null;
    this._busy = false;
    this.render();
    this._load();
    // Poll only while the tab is visible: the To-review source walks each open PR's files, so a blind background
    // poll on every parked new-tab would waste GitHub API budget. Refresh when the tab regains focus too.
    this._timer = setInterval(() => { if (!this._open && !this._hidden()) this._load(); }, POLL_MS);
    this._onVis = () => { if (!this._hidden() && !this._open) this._load(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this._onVis);
    // Close the panel on an outside click. composedPath (not this.contains) so it stays correct when this element
    // is nested inside another shadow root, where a document click retargets ev.target to the outer host.
    this._onDoc = (e) => { if (this._open && !e.composedPath().includes(this)) this._close(); };
    document.addEventListener('click', this._onDoc);
  }

  _hidden() { return typeof document !== 'undefined' && document.hidden === true; }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearInterval(this._timer);
    clearTimeout(this._flashTimer);
    if (this._onDoc) document.removeEventListener('click', this._onDoc);
    if (this._onVis && typeof document !== 'undefined') document.removeEventListener('visibilitychange', this._onVis);
  }

  _safe(fn) { return Promise.resolve().then(fn).catch(() => []); }

  async _load() {
    if (this._busy) return;
    this._busy = true;
    try {
      let membership = 'unknown';
      try { const st = await this.client?.status?.(); membership = st?.membership ?? 'unknown'; this._login = st?.identity?.login || null; this._role = st?.role || 'member'; }
      catch { membership = 'unknown'; this._login = null; this._role = 'member'; }
      // The bell is for active members only; a Locked/unknown/signed-out account hides it (no count).
      if (!canSeeShares(membership) || !this._login) { this._gated = true; this._bell = { total: 0, groups: [] }; this.render(); return; }
      this._gated = false;
      const sources = await this._fetchSources(this._login);
      this._sources = sources;
      this._bell = buildBell(sources, this._seen);
      this.render();
    } finally { this._busy = false; }
  }

  async _fetchSources(login) {
    const [review, prs, following, replies, approvals] = await Promise.all([
      this._safe(() => this._review()),
      this._safe(() => this._prs()),
      this._safe(() => this._following(login)),
      this._safe(() => this._replies(login)),
      // SOW-088: superadmin-only. A non-superadmin never fetches (the Worker queue read is
      // superadmin-gated anyway, and _safe fails closed to []).
      this._role === 'superadmin' ? this._safe(() => this._approvals()) : Promise.resolve([]),
    ]);
    return { review, prs, following, replies, approvals };
  }

  // SOW-088: syndication items HOLDING (pending: still in the cancel window, or a flagged item awaiting
  // approval). Surfacing them lets a superadmin APPROVE early so the item posts on the next drain tick
  // instead of waiting out the hold. Approved items are already going out, so they are not notified.
  async _approvals() {
    const q = (await this.client.syndicationQueue()) || {};
    const pending = Array.isArray(q.pending) ? q.pending : [];
    const TYPE = { share: 'Share', post: 'Article', product: 'Product', prompt: 'Prompt' };
    return pending.map((it) => {
      const flagged = Array.isArray(it.flags) && it.flags.length;
      const type = TYPE[it.source] || 'Item';
      return {
        id: `syn:${it.id}`,
        ts: toMs(it.enqueuedAt),
        title: it.title || it.targetSlug || 'Untitled',
        sub: flagged ? `Flagged ${type.toLowerCase()}: needs approval` : `${type} holding: approve to post now`,
        href: 'admin.html#tab=syndication',
      };
    });
  }

  async _review() {
    const { contributions = [] } = (await this.client.listContributions()) || {};
    return contributions.map((c) => ({
      id: `c${c.number}`,
      ts: toMs(c.updatedAt ?? c.createdAt),
      title: c.title || `Contribution #${c.number}`,
      sub: c.author?.login ? `from @${c.author.login}` : 'awaiting your review',
      href: 'workspace.html#tab=inbox',
    }));
  }

  async _prs() {
    const { prs = [] } = (await this.client.listPRs()) || {};
    return prs
      .filter((p) => p.merged === true || p.state === 'merged' || p.state === 'closed')
      .map((p) => {
        // SOW-072 P2: a Declined PR is a "needs attention" signal, never silence. The bell has no gate status, so a
        // declined item routes to the workspace PR tab where the gate REASON is fetched + shown; an accepted one
        // links to GitHub as before.
        const lc = prLifecycle(p, null);
        return {
          id: p.number,
          ts: p.number, // no reliable timestamp in both host modes; the number is a recency proxy for display sort
          title: p.title || `PR #${p.number}`,
          sub: lc.needsAttention ? 'Declined — open to see why' : 'Accepted',
          href: lc.needsAttention ? 'workspace.html#tab=prs' : (p.html_url || SITE),
        };
      });
  }

  async _following(login) {
    const f = (await this.client.getFollows()) || {};
    const set = new Set((f.following || []).map((x) => String(x?.username || '').toLowerCase()).filter(Boolean));
    if (!set.size) return [];
    const res = await fetch(`${SITE}/activity-index.json`, { cache: 'no-cache' });
    const data = res.ok ? await res.json() : {};
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    return entries
      .filter((e) => set.has(String(e.author).toLowerCase()))
      .map((e) => ({
        id: `f:${e.type}:${e.path || e.url || e.title}`,
        ts: toMs(e.publishedAt),
        title: e.title || 'New activity',
        sub: `@${e.author}`,
        href: e.path ? `newtab.html#${buildReadHash(e.type, e.path)}` : `${SITE}${e.url || ''}`,
      }));
  }

  // v1: replies on the caller's OWN Shares (the conversational surface the owner asked about). Content-item replies
  // (post/product/prompt) need a per-item comment walk and defer to P4's server aggregator. Hard-bounded fan-out.
  async _replies(login) {
    const lc = String(login).toLowerCase();
    const { items = [] } = (await this.client.listShares()) || {};
    const mine = items.filter((s) => String(s.author).toLowerCase() === lc).slice(0, MAX_OWN_SHARES);
    const lists = await Promise.all(mine.map((s) => this._safe(async () => {
      const slug = s.author && s.id ? `${s.author}/${s.id}` : '';
      if (!slug) return [];
      const r = (await this.client.listShareComments({ targetSlug: slug })) || {};
      return (r.items || [])
        .filter((c) => String(c.author).toLowerCase() !== lc) // a reply from someone ELSE
        .map((c) => ({
          id: `cmt:${c.path || `${slug}:${c.id || c.createdAt}`}`,
          ts: toMs(c.createdAt),
          title: `Reply on ${s.title || s.shortDescription || 'your Share'}`,
          sub: `@${c.author}`,
          href: 'newtab.html#tab=share',
        }));
    })));
    return lists.flat();
  }

  _close() { this._open = false; clearTimeout(this._flashTimer); this._clearFlash = null; this.render(); }

  _toggle() {
    this._open = !this._open;
    if (this._open && this._sources) {
      // Mark everything currently shown as seen (the badge clears); later items re-badge against this watermark.
      this._seen = markSeen(this._sources);
      saveSeen(this._seen);
      this._bell = buildBell(this._sources, this._seen); // recompute -> unread now 0, items still listed
    }
    this.render();
  }

  _markAllSeen() {
    if (this._sources) { this._seen = markSeen(this._sources); saveSeen(this._seen); this._bell = buildBell(this._sources, this._seen); }
    this.render();
  }

  // SOW-095: the "Mark all read" click gets a brief processing indicator, then a confirmation, so the action reads
  // as acknowledged even though the write is a fast LOCAL watermark. Cosmetic pacing (not a fake delay); the
  // confirmation auto-dismisses back to the settled all-read state.
  _doMarkAll() {
    if (this._clearFlash) return; // already running
    this._clearFlash = 'busy';
    this.render();
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => {
      this._clearFlash = 'done';
      this._markAllSeen(); // the watermark write + a render that shows the "All marked read" confirmation
      this._flashTimer = setTimeout(() => { this._clearFlash = null; this.render(); }, 1500);
    }, 350);
  }

  _clrBtn() {
    if (this._clearFlash === 'busy') return `<button class="clr" type="button" disabled aria-busy="true"><span class="spin"></span>Marking...</button>`;
    if (this._clearFlash === 'done') return `<button class="clr done" type="button" disabled>${CHECK}All marked read</button>`;
    return `<button class="clr" type="button" data-clear>Mark all read</button>`;
  }

  render() {
    if (!this.root) return;
    // Gated (Locked/unknown/signed-out) -> render nothing + take no space.
    if (this._gated) { this.hidden = true; this.set(''); return; }
    this.hidden = false;
    const total = this._bell?.total || 0;
    const dot = total > 0 ? `<span class="dot">${total > 99 ? '99+' : total}</span>` : '';
    const panel = this._open ? this._panelHtml() : '';
    this.set(this.css(CSS) + `<button class="btn" type="button" data-bell aria-label="Activity${total ? `, ${total} new` : ''}" aria-haspopup="true" aria-expanded="${this._open}">${BELL}${dot}</button>${panel}`);
    this.on('[data-bell]', 'click', (e) => { e.stopPropagation(); this._toggle(); });
    this.on('[data-clear]', 'click', (e) => { e.stopPropagation(); this._doMarkAll(); });
  }

  _panelHtml() {
    const seen = this._seen || {};
    const groups = (this._bell?.groups || []).filter((g) => g.items.length);
    const unreadSet = new Map(); // per-group: the set of unread item ids (for the dot)
    for (const g of (this._bell?.groups || [])) {
      const since = Number(seen[g.key]) || 0;
      const seenIds = new Set((seen.prsSeen || []).map(String));
      unreadSet.set(g.key, new Set(g.items.filter((it) => g.key === 'prs' ? !seenIds.has(String(it.id)) : toMs(it.ts) > since).map((it) => it.id)));
    }
    const body = groups.length
      ? groups.map((g) => {
          const un = unreadSet.get(g.key) || new Set();
          const rows = g.items.slice(0, 8).map((it) => {
            const cls = un.has(it.id) ? 'it unread' : 'it';
            const ext = /^https?:\/\//.test(it.href) ? ' target="_blank" rel="noopener"' : '';
            // sow-221 follow-up: a notification list is the surface where "when" matters most, and this one
            // showed no time at all even though `ts` was already computed for sorting and the unread
            // watermark. Appended to the existing subtitle rather than given its own line, so the row keeps
            // its two-line shape. An item with no usable ts renders exactly as before, separator included.
            const when = relTime(it.ts);
            const abs = when ? absTime(it.ts) : '';
            const sub = `${esc(it.sub || '')}${when ? `${it.sub ? ' · ' : ''}${esc(when)}` : ''}`;
            return `<a class="${cls}" href="${esc(it.href)}"${ext}${abs ? ` title="${esc(abs)}"` : ''}>`
              + `<span class="t">${esc(it.title)}</span><span class="s">${sub}</span></a>`;
          }).join('');
          const moreN = g.items.length - Math.min(g.items.length, 8);
          return `<div class="grp"><div class="grp-h">${esc(g.label)}${g.unread ? `<span class="n">${g.unread}</span>` : ''}</div>${rows}${moreN > 0 ? `<div class="it s" style="color:var(--muted)">+${moreN} more</div>` : ''}</div>`;
        }).join('')
      : `<div class="empty">You are all caught up.</div>`;
    return `<div class="panel"><div class="phead"><b>Activity</b>${this._clrBtn()}</div>${body}</div>`;
  }
}

define('gbti-activity-bell', GbtiActivityBell);
export { GbtiActivityBell };
