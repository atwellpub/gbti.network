// <gbti-workspace> (SOW-033): the member's management surface inside the extension. A tabbed view of everything
// they own (Articles / Prompts / Products) plus their pull requests with live gate status, and a pinned profile
// row. Each content row opens the item IN PLACE in an embedded <gbti-content-editor> (open-inside-the-extension,
// the SOW-031 tie), reusing the exact gbti-content-list -> editor.load flow. PR rows classify into Proposed /
// Needs changes / Accepted / Declined via the pure classifyPull helper. Host-agnostic (consumes only the
// injected client) so it runs in the extension now and the npm CMS later. Fail-soft: every read falls back to an
// empty state, never throws.
import { GbtiElement, define, esc, getIdentity } from '../base.mjs';
import { classifyPull, classifyDraft, prLifecycle, prEvent, sortPullsByEvent, shouldPollPr, parseWorkspaceTab, parseWorkspaceNew, parseWorkspaceEdit, parseWorkspaceDraft, planHashRoute, typeForContentPath, publicPathFor, submitAck, sortItems, filterByStatus, mergeTypeItems, sortModeFor, WORKSPACE_SORT_KEY, scopeFor, WORKSPACE_SCOPE_KEY } from '../workspace-core.mjs';
import { relTime, absTime } from '../time-core.mjs'; // sow-221: the shared "time ago" + its tooltip stamp
import { wbCacheGet, wbCacheSet, wbCacheInvalidateMany } from '../workbench-cache.mjs'; // SOW-073: SWR workbench cache

const WB_CONTENT_TYPES = new Set(['post', 'prompt', 'product']); // SOW-073: types whose publish invalidates a tab
const SITE = 'https://gbti.network'; // SOW-173: the live site origin, prefixed onto a View link from the extension host
import { glyphFor } from '../cat-glyph.mjs'; // SOW-062: the SOW-049 type glyph, reused on the WorkBench list rows
import './gbti-content-editor.mjs';
import './gbti-contrib-inbox.mjs';
import './gbti-contrib-review.mjs';
import './gbti-saved.mjs';
import './gbti-subscriptions.mjs';

const TABS = [
  { id: 'overview', label: 'Overview' }, // SOW-052: the WorkBench hub (tiles + counts + PRs needing attention)
  { id: 'post', label: 'Articles', type: 'post' },
  { id: 'prompt', label: 'Prompts', type: 'prompt' },
  { id: 'product', label: 'Products', type: 'product' },
  // SOW-085: the standalone Drafts tab is retired; fork-staged drafts (SOW-082) now merge into their content
  // type's list (a draft article under Articles), reached by the per-type Drafts filter.
  { id: 'prs', label: 'Pull requests' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'saved', label: 'Saved' }, // SOW-037: favorites + collections
  { id: 'subs', label: 'Following' }, // SOW-037: follows + membership (network members + news channels)
  { id: 'earnings', label: 'Earnings' }, // SOW-052: placeholder for referrals + rewards (SOW-007/008)
];

// SOW-052: the overview tiles — each is a section of the WorkBench. `count` is filled from the loaded data;
// `href` deep-links (the workbench rail + the element both honor #tab=). Settings/Admin are separate pages.
const MEMBERSHIP_LABEL = { paid: 'Paid member', trial: 'Trial', trialing: 'Trial', expired: 'Expired', cancelled: 'Cancelled', none: 'Not a member', banned: 'Suspended', unknown: 'Not signed in' };

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius:2px; padding:4px; margin:0 0 16px; flex-wrap:wrap; } /* SOW-052 squared aesthetic: 2px nav bar */
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:2px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .tbadge { display:inline-block; min-width:16px; margin-left:6px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:11px; font-weight:800; line-height:16px; text-align:center; vertical-align:text-top; }
  .profile { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:2px; padding:11px 14px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); font-size:14px; }
  .profile .lbl { color:var(--muted); font-size:12px; }
  .profile button { margin-left:auto; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { flex:1; min-width:0; overflow:hidden; }
  .row .gl { flex:none; width:34px; height:34px; border-radius:9px; display:grid; place-items:center; color:var(--ka, var(--accent)); background:color-mix(in srgb, var(--ka, var(--accent)) 12%, transparent); }
  .row .gl svg { width:19px; height:19px; }
  .row .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12.5px; }
  /* sow-221: the event time sits in the meta line, dimmer than the #N link so the link still leads. */
  .row .t .meta .when { opacity:.85; }
  .row .t .meta .when::before { content:"·"; margin:0 6px; opacity:.6; }
  .row .t .why { display:block; margin-top:3px; color:var(--danger); font-size:12px; line-height:1.35; white-space:normal; } /* SOW-072 P2: the rejection reason, never silent */
  .row .t .why[hidden] { display:none; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--hover); font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.bad { background:rgba(224,108,108,.16); color:var(--danger); }
  .btn { flex:none; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .right { display:flex; align-items:center; gap:8px; flex:none; }
  .pager { display:flex; align-items:center; justify-content:center; gap:14px; margin:16px 0 2px; }
  .pager-n { font-size:12.5px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .btn[disabled] { opacity:.42; cursor:default; }
  .btn[disabled]:hover { border-color:var(--line); color:var(--fg); }
  /* SOW-085: the content-list controls bar (status filter + sort) */
  .lc-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 0 10px; }
  .lc-filter { display:inline-flex; gap:2px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:3px; }
  .lc-f { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:600; font-size:12.5px; padding:5px 12px; border-radius:6px; cursor:pointer; }
  .lc-f.on { background:var(--hover); color:var(--accent); }
  /* SOW-145: the superadmin content-scope switch (My content / Network content). sow-195 repointed the
     second scope from the old house/ folder to members/gbtilabs/, so the label names the network, not a folder. */
  .lc-scopes { display:inline-flex; gap:2px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:3px; margin-right:auto; }
  .lc-scope { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:600; font-size:12.5px; padding:5px 12px; border-radius:6px; cursor:pointer; }
  .lc-scope.on { background:var(--accent); color:#fff; }
  .lc-sort { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--muted); }
  .lc-sort .lc-sl { font-weight:600; }
  .lc-sort select { font:inherit; font-size:12.5px; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:5px 9px; cursor:pointer; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:18px 2px; }
  .back { margin:0 0 14px; }
  a { color:var(--accent); }
  /* SOW-052: the Overview hub */
  .ov-hero { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border:1px solid var(--line); border-radius:2px; padding:14px 16px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); margin:0 0 16px; }
  .ov-hero b { font-size:15px; }
  .ov-hero .muted { font-size:12.5px; }
  .ov-draft { font-size:12.5px; color:var(--accent); font-weight:700; }
  .ov-trial { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; border:1px solid var(--accent); border-radius:2px; padding:13px 16px; background:color-mix(in srgb, var(--accent) 9%, var(--panel)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); margin:0 0 16px; }
  .ov-trial b { font-size:13.5px; }
  .ov-trial span { font-size:12.5px; color:var(--muted); }
  .ov-trial .ov-up { flex:none; font-weight:700; font-size:12.5px; padding:7px 14px; border-radius:2px; background:var(--accent); color:#fff; text-decoration:none; white-space:nowrap; }
  .ov-trial .ov-up:hover { filter:brightness(1.05); }
  .ov-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px; margin:0 0 22px; }
  .ov-tile { display:flex; flex-direction:column; gap:4px; border:1px solid var(--line); border-radius:2px; padding:14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); text-decoration:none; color:var(--fg); transition:border-color .14s, transform .14s; }
  .ov-tile:hover { border-color:var(--accent); transform:translateY(-2px); }
  .ov-n { font-weight:800; font-size:22px; line-height:1; color:var(--accent); min-height:16px; }
  .ov-nm { font-weight:600; font-size:13.5px; color:var(--fg); }
  .ov-h3 { font-weight:700; font-size:15px; margin:0 0 10px; }
  .ov-att { list-style:none; margin:0; padding:0; }
  .ov-att li { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .ov-att li:first-child { border-top:0; }
`;

class GbtiWorkspace extends GbtiElement {
  connectedCallback() {
    // Initialize state BEFORE super.connectedCallback(), which synchronously calls render() (base.mjs) -> _body()
    // dereferences this._cache/_tab, so they must exist first; otherwise a TypeError aborts the whole mount and
    // the workspace renders nothing. (Same fix as gbti-browse.)
    // SOW-036 P4: open on the tab named by the deep-link hash (workspace.html#tab=prompt), falling back to 'post'.
    // Lets the avatar menu route the member straight to "My prompts" / "My products" / "My pull requests".
    this._tab = (typeof location !== 'undefined' && parseWorkspaceTab(location.hash)) || 'overview'; // SOW-052 default
    this._cache = {};   // type -> items[]
    this._prs = null;   // { prs }
    this._pollTimer = null; // SOW-072 P3: the single live PR-list poll timer id
    this._pollTries = 0;    // SOW-072 P3: poll attempts this viewing session (bounds a never-merging PR)
    this._overview = null; // SOW-052: { membership, role, counts, attention[] }
    // SOW-064: a #new=<type> deep-link (from the "+" quick-create menu) opens a BLANK editor for that content type,
    // so the member lands straight in a new article/prompt/product. Empty frontmatter + body = a blank form.
    const newType = (typeof location !== 'undefined' && parseWorkspaceNew(location.hash)) || null;
    this._editing = newType ? { type: newType, frontmatter: {}, body: '' } : null;
    // SOW-106 QA fix: an #edit=<path> / #draft=<type>:<slug> deep-link restores the open editor after a refresh.
    // Consumed by render() once the client exists (the SOW-070 client-arrival pattern).
    const hash = typeof location !== 'undefined' ? location.hash : '';
    this._restore = this._editing ? null : (() => {
      const path = parseWorkspaceEdit(hash);
      if (path) return { edit: path };
      const d = parseWorkspaceDraft(hash);
      return d ? { draft: d } : null;
    })();
    this._page = 0; // SOW-062: the current content-list page (client-side paging; resets on tab switch)
    // SOW-085: the content-list controls. The SORT persists across sessions (one device-local pref); the STATUS
    // filter resets to All on each tab switch. `_viewList` is the merged+sorted+filtered list for the current
    // content tab, the index target the row action handlers read.
    this._sort = sortModeFor(typeof localStorage !== 'undefined' ? localStorage.getItem(WORKSPACE_SORT_KEY) : null);
    this._statusFilter = 'all';
    this._viewList = [];
    // SOW-145: the content SCOPE (My content / Network content), superadmin-only. Unresolved (null) until the
    // Overview arrives with the caller's role + personal counts; treated as 'member' until then (so a
    // non-superadmin, and the pre-overview paint, always list the member folder). `scopeFor` then resolves it
    // (an empty-personal superadmin defaults to house). Persisted device-local like the sort pref.
    this._scope = null;
    this._scopeResolved = false;
    this._reviewing = null; // SOW-028: the PR number being reviewed in the drill-in, or null
    this._inboxCount = null; // SOW-028 P5: count of contributions awaiting review, for the Inbox tab badge
    super.connectedCallback?.(); // base now renders the initial view with fields in place
    this._loadProfile();
    this._ensureTab(this._tab);
    // SOW-145: the Overview carries the caller's role + personal counts, which resolve the content SCOPE and gate
    // the superadmin toggle. _ensureTab loads it only on the Overview tab, so a deep-link straight to a content
    // tab (the avatar menu's "My prompts" etc.) would never resolve the scope — load it eagerly in that case.
    if (this._tab !== 'overview') this._ensureOverview();
    this._loadInboxCount();
    // SOW-052: the WorkBench rail deep-links to #tab=<id>; switch the tab on a same-document hash change.
    this._onHash = () => {
      const h = typeof location !== 'undefined' ? location.hash : '';
      // SOW-104: planHashRoute (pure, tested) decides the action. A rail nav to a plain tab while an editor/review
      // pane is open is an explicit EXIT (matching the Back button, which also discards silently); a #new= opens the
      // editor; a different plain tab switches. The editor encodes &edit= in the hash, so a rail click to #tab=<t>
      // is a real hashchange even for the current tab.
      const plan = planHashRoute(h, { editing: !!this._editing, reviewing: this._reviewing != null, tab: this._tab });
      if (plan.action === 'exit') {
        this._editing = null; this._reviewing = null;
        this._tab = plan.tab; this._page = 0; this._statusFilter = 'all'; this.render(); this._ensureTab(plan.tab);
      } else if (plan.action === 'openNew') {
        this._editing = { type: plan.type, frontmatter: {}, body: '' }; this.render();
      } else if (plan.action === 'switchTab') {
        this._tab = plan.tab; this._page = 0; this._statusFilter = 'all'; this.render(); this._ensureTab(plan.tab);
      }
    };
    if (typeof window !== 'undefined') window.addEventListener('hashchange', this._onHash);
    this._wireStorageSync(); // SOW-073: cross-tab cache invalidation sync
  }

  disconnectedCallback() {
    if (typeof window !== 'undefined' && this._onHash) window.removeEventListener('hashchange', this._onHash);
    try { if (this._onStorage) globalThis.chrome?.storage?.onChanged?.removeListener?.(this._onStorage); } catch { /* ignore */ }
    this._clearPolls(); // SOW-072 P3: never leak a PR-status poll timer past teardown
    super.disconnectedCallback?.();
  }

  // SOW-052: load the overview hub data — content counts (+ drafts), PR + saved + follow counts, membership, and
  // the "needs attention" PR list. Fail-soft: every read defaults to 0/empty, never throws. Reuses _cache/_prs.
  async _ensureOverview() {
    // Re-fetch if the cached snapshot was built while the session looked UNAUTHENTICATED. Caching that empty
    // "Not signed in / 0" state permanently (e.g. it first rendered under a momentarily-dead token) was the
    // WorkBench-shows-nothing bug: the data layer recovered but the frozen snapshot never did.
    if (this._overview && this._overview._trusted) return;
    // SOW-073: paint a cached overview snapshot INSTANTLY (no zero-counts flash) before the seven-call revalidate.
    if (!this._overview) {
      const ck = await this._memberKey();
      const cached = ck ? await wbCacheGet(ck, 'overview') : null;
      if (cached?.items?.[0]) { this._overview = cached.items[0]; if (this._tab === 'overview' && !this._editing) this.render(); }
    }
    const num = (p) => Promise.resolve(p).then((v) => v).catch(() => null); // tolerate a missing client method (undefined)
    const [post, prompt, product, prs, activity, follows, status] = await Promise.all([
      num(this.client?.listContent?.({ type: 'post' })),
      num(this.client?.listContent?.({ type: 'prompt' })),
      num(this.client?.listContent?.({ type: 'product' })),
      num(this.client?.listPRs?.()),
      num(this.client?.getActivity?.()),
      num(this.client?.getFollows?.()),
      num(this.client?.status?.()),
    ]);
    const items = (r) => (Array.isArray(r?.items) ? r.items : []);
    this._cache.post = items(post); this._cache.prompt = items(prompt); this._cache.product = items(product);
    this._prs = Array.isArray(prs?.prs) ? prs.prs : (this._prs || []);
    const drafts = [...items(post), ...items(prompt), ...items(product)].filter((it) => it.status === 'draft').length;
    const favs = (activity?.favorites?.length || 0) + (activity?.collections?.length || 0);
    const followN = Array.isArray(follows) ? follows.length : (follows?.following?.length || 0);
    const attention = (this._prs || [])
      .map((pr) => ({ pr, c: classifyPull(pr, null) }))
      .filter(({ pr, c }) => c.label === 'Declined' || (pr.state !== 'closed' && pr.merged !== true)) // declined or still open
      .slice(0, 6)
      .map(({ pr, c }) => ({ title: pr.title || `PR #${pr.number}`, url: pr.html_url || '', label: c.label, tone: c.tone }));
    // `_trusted` = the status read came back authenticated. Only a trusted snapshot is cached permanently; an
    // untrusted one renders once (so the hub is not blank) but is re-fetched on the next call + the retry below.
    const trusted = !!(status && status.authenticated !== false);
    this._overview = {
      membership: status?.membership || 'unknown',
      role: status?.role || 'member',
      counts: { post: items(post).length, prompt: items(prompt).length, product: items(product).length, prs: (this._prs || []).length, saved: favs, subs: followN, drafts },
      attention,
      _trusted: trusted,
    };
    // SOW-073: persist a TRUSTED snapshot (+ the per-type lists this call already fetched) so the next open is instant.
    if (trusted) {
      const ck = await this._memberKey();
      if (ck) {
        wbCacheSet(ck, 'overview', [this._overview], { allowEmpty: true });
        wbCacheSet(ck, 'post', this._cache.post, { allowEmpty: true });
        wbCacheSet(ck, 'prompt', this._cache.prompt, { allowEmpty: true });
        wbCacheSet(ck, 'product', this._cache.product, { allowEmpty: true });
        if (Array.isArray(this._prs)) wbCacheSet(ck, 'prs', this._prs, { allowEmpty: true });
      }
    }
    // SOW-145: resolve the content scope now that the caller's REAL role + personal counts are known (only on a
    // trusted snapshot, once per mount). A superadmin whose member folder is empty (e.g. gbtilabs) lands on the
    // house scope; everyone else stays 'member'. If the resolution moves us off 'member', reload the visible tab.
    if (trusted && !this._scopeResolved) {
      this._scopeResolved = true;
      const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(WORKSPACE_SCOPE_KEY) : null;
      const personalCount = items(post).length + items(prompt).length + items(product).length;
      const resolved = scopeFor(stored, { personalCount, role: this._overview.role });
      const moved = resolved !== this._scopeNow(); // compare BEFORE assigning
      this._scope = resolved;
      // Guard every render here with !this._editing (mirrors the other overview-time renders). An UNGUARDED
      // render() while the editor is open re-mounts <gbti-content-editor> and wipes in-progress edits — reachable
      // via a #new= / #edit= deep-link whose editor opens before this async resolve lands. When the scope MOVED,
      // reset + reload the visible list. Re-render (to surface the now-known superadmin toggle) only when the
      // scope moved or the toggle should appear. While editing, preload the resolved scope's list silently
      // (_ensureTab's own renders are !editing-guarded) so it is ready when the member exits the editor.
      if (!this._editing) {
        if (moved) { this._page = 0; this._statusFilter = 'all'; this._ensureTab(this._tab); }
        if (moved || this._canScope()) this.render();
      } else if (moved) {
        this._ensureTab(this._tab);
      }
    }
    if (this._tab === 'overview' && !this._editing) this.render();
    // Self-heal: if the session looked unauthenticated (a token that may have since recovered/refreshed), retry
    // ONCE shortly so the hub fills in without a manual page refresh.
    if (!trusted && !this._overviewRetried) {
      this._overviewRetried = true;
      setTimeout(() => { this._overview = null; this._ensureOverview(); }, 2000);
    }
  }

  // SOW-028 P5: poll the incoming-contribution count on open (batch-first, like the rest of the client) so the
  // Inbox tab carries a "N to review" badge without the member having to open it. Fail-soft to no badge.
  async _loadInboxCount() {
    try { this._inboxCount = (await this.client?.listContributions?.())?.contributions?.length ?? 0; }
    catch { this._inboxCount = 0; }
    if (!this._editing && this._reviewing == null) this.render();
  }

  // ----- data loaders (each fail-soft to an empty state, like gbti-content-list/gbti-pr-list) -----
  async _loadProfile() {
    try {
      const items = (await this.client?.listContent?.({ type: 'profile' }))?.items ?? [];
      this._profile = items[0] || null;
    } catch { this._profile = null; }
    if (!this._editing) this.render();
  }

  // SOW-083 P2: the member's own earnings ledger (held + payable + paid), served by the Worker from earnings:<id>.
  async _loadEarnings() {
    try { this._earnings = (await this.client?.getEarnings?.()) ?? null; }
    catch { this._earnings = null; }
    this.render();
  }

  // SOW-083 P2: render the earnings dashboard (totals + the per-source breakdown), or the empty/explainer state.
  _renderEarnings() {
    const e = this._earnings;
    const money = (cents) => `$${((cents || 0) / 100).toFixed(2)}`;
    const hero = `<div class="ov-hero"><div><b>Earnings</b><br/><span class="muted">Revenue share from the members your work and your invites bring in.</span></div></div>`;
    if (!e || !Array.isArray(e.entries) || e.entries.length === 0) {
      return hero + `<p class="empty">No earnings yet. When someone joins through your invite link or via content you wrote, your share shows here: 30% when your content is the first touch, 10% when it is the last, a slice of the 5% collaboration pool, and a flat 10% lifetime commission on your invites. Distributions pay out after a 90-day hold. Copy your invite link under <a href="account.html">Settings</a>.</p>`;
    }
    // SOW-083 P3: prompt Stripe Connect payout setup when the member has earnings but is not ready to receive them.
    const ps = e.payoutSetup || { connected: false, ready: false };
    const setup = ps.ready ? '' : `<p class="empty" style="margin-bottom:12px">${ps.connected ? 'Your Stripe payout account is not finished. Complete setup' : 'Set up Stripe payouts'} under <a href="account.html">Settings</a> to receive your earnings.</p>`;
    const t = e.totals || {};
    const stat = (n, l) => `<div style="flex:1;min-width:110px"><div style="font:600 22px/1.1 var(--f-display,inherit)">${money(n)}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.04em">${esc(l)}</div></div>`;
    const totals = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin:16px 0;padding:16px;border:1px solid var(--line-2,#ddd);border-radius:var(--r,8px)">${stat(t.lifetime, 'Lifetime')}${stat(t.paid, 'Paid')}${stat(t.payable, 'Ready')}${stat(t.held, 'Accruing')}</div>`;
    const roleLabel = { first: 'First touch', last: 'Last touch', invite: 'Invite', collab: 'Collaboration' };
    const stateLabel = { paid: 'Paid', payable: 'Ready', held: 'Accruing' };
    const label = (m, k) => esc(m[k] || String(k).replace(/\+/g, ' + '));
    const rows = e.entries.map((r) => `<tr><td style="padding:6px 8px">${label(roleLabel, r.role)}</td><td style="padding:6px 8px">${label(stateLabel, r.state)}</td><td style="padding:6px 8px;text-align:right">${money(r.amount)}</td></tr>`).join('');
    return hero + setup + totals + `<table style="width:100%;border-collapse:collapse;font-size:14px"><thead><tr style="text-align:left;color:var(--fg-mute,#888)"><th style="padding:6px 8px;font-weight:600">Source</th><th style="padding:6px 8px;font-weight:600">Status</th><th style="padding:6px 8px;font-weight:600;text-align:right">Amount</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  async _ensureTab(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    if (id === 'overview') { this._ensureOverview(); return; } // SOW-052
    if (id === 'earnings') { await this._loadEarnings(); return; } // SOW-083 P2: the member's earnings ledger
    // The Inbox / Saved / Subscriptions tabs are self-loading elements (they fetch their own data on connect),
    // so there is nothing to preload here; render() already mounted them. Returning avoids a redundant render.
    if (id === 'inbox' || id === 'saved' || id === 'subs') return;
    if (tab.type) { await this._swrContent(id, tab.type); this._loadDrafts(id); return; } // SOW-106 QA + SOW-085: drafts feed the staged-edits chips AND merge into the list
    if (id === 'prs') { await this._swrPrs(id); }
  }

  // SOW-145: the active scope (member until the Overview resolves it), and the scope-keyed content-cache key so
  // house + member lists of the same type never collide in this._cache or the persistent cache.
  _scopeNow() { return this._scope || 'member'; }
  _ck(type) { return this._scopeNow() === 'house' ? `house:${type}` : type; }
  /** SOW-145: whether the superadmin scope toggle should render (a superadmin, from the trusted Overview). */
  _canScope() { return this._overview?.role === 'superadmin'; }

  /** SOW-073: the per-member cache key (immutable github_id, falling back to login). Cached after the first read. */
  async _memberKey() {
    if (this._mk !== undefined) return this._mk;
    try { const id = await getIdentity(); this._mk = (id?.githubId || id?.login) ? String(id.githubId || id.login) : null; }
    catch { this._mk = null; }
    return this._mk;
  }

  // SOW-073: stale-while-revalidate a content tab. Paint the cached items INSTANTLY (no "Loading"/"none" flash),
  // then revalidate in the background and re-render only if the fresh result differs. Within a session the in-memory
  // this._cache[type] is the fast path (a tab revisit does not refetch); the persistent cache hydrates the FIRST
  // access of a session (so a reload is instant too). A genuinely-empty list (the success path) is cached as [].
  async _swrContent(id, type) {
    // SOW-145: cache + fetch under the SCOPE-keyed slot so the house list never overwrites the member list of
    // the same type (and the persistent cache keeps them separate). Member scope keeps the plain `type` key.
    const ck = this._ck(type);
    const scope = this._scopeNow();
    if (this._cache[ck]) return; // already loaded this session (this scope)
    const key = await this._memberKey();
    let fresh = false;
    if (key) {
      const cached = await wbCacheGet(key, ck);
      if (cached) {
        this._cache[ck] = cached.items;
        if (this._tab === id && !this._editing) this.render(); // instant paint from cache
        fresh = cached.fresh;
      }
    }
    if (fresh) return; // fresh enough: skip the revalidate
    try {
      const items = (await this.client?.listContent?.({ type, scope }))?.items ?? [];
      const changed = !this._cache[ck] || JSON.stringify(this._cache[ck]) !== JSON.stringify(items);
      this._cache[ck] = items;
      if (key) await wbCacheSet(key, ck, items, { allowEmpty: true }); // success path: [] means truly none
      if (changed && this._tab === id && !this._editing) this.render();
    } catch {
      if (!this._cache[ck]) this._cache[ck] = []; // no cache + fetch failed -> empty (prior behavior)
      if (this._tab === id && !this._editing) this.render();
    }
  }

  // SOW-073: SWR for the PR tab (cached as the 'prs' pseudo-type). The per-PR gate labels still resolve live via
  // _loadPrStatuses after the list paints (their server-side inlining is SOW-073 P4).
  async _swrPrs(id) {
    if (this._prs) { if (id === 'prs') this._loadPrStatuses(); return; } // loaded this session
    const key = await this._memberKey();
    let fresh = false, painted = false;
    if (key) {
      const cached = await wbCacheGet(key, 'prs');
      if (cached) {
        this._prs = cached.items; painted = true;
        if (this._tab === id && !this._editing) this.render();
        if (id === 'prs') this._loadPrStatuses();
        fresh = cached.fresh;
      }
    }
    if (fresh) return;
    try {
      const prs = (await this.client?.listPRs?.())?.prs ?? [];
      const changed = !painted || JSON.stringify(this._prs) !== JSON.stringify(prs);
      this._prs = prs;
      if (key) await wbCacheSet(key, 'prs', prs, { allowEmpty: true });
      if (changed) {
        if (this._tab === id && !this._editing) this.render();
        if (id === 'prs') this._loadPrStatuses();
      }
    } catch {
      if (!this._prs) { this._prs = []; if (this._tab === id && !this._editing) this.render(); }
    }
  }

  // SOW-082: load the member's fork-staged drafts (in-memory per session; the staged set changes on save/publish/
  // discard, so it is invalidated there rather than persistently cached). `this._drafts` null = loading.
  async _loadDrafts(id) {
    if (this._drafts) return; // already loaded this session
    try {
      this._drafts = (await this.client?.listDrafts?.())?.drafts ?? [];
    } catch {
      this._drafts = [];
    }
    if (this._tab === id && !this._editing) this.render();
  }

  // SOW-082: a Save-draft from the embedded editor changed the staged set (+ the overview count). Drop the in-memory
  // drafts + overview so the next visit reloads. The editor stays open after a save, so the refresh lands on return.
  async _onDraftSaved() {
    this._drafts = null;
    this._overview = null;
    const key = await this._memberKey();
    if (key) await wbCacheInvalidateMany(key, ['overview']);
    if (!this._editing) this._ensureTab(this._tab);
  }

  // SOW-073: a just-published/edited content type invalidates that type + the Overview snapshot + the PR list (a
  // publish opens a PR), in BOTH the in-memory and the persistent cache, then refetches what the member will see.
  async _onPublished(type) {
    const t = type && WB_CONTENT_TYPES.has(type) ? type : null;
    // SOW-145: invalidate BOTH the plain (member) slot AND the active scope's slot, so a house publish refreshes
    // the house list (and a member publish the member list) without leaving the other scope stale.
    const keys = t ? [...new Set([t, this._ck(t)])] : [];
    keys.forEach((k) => delete this._cache[k]);
    this._overview = null;
    this._prs = null;
    this._drafts = null; // SOW-082: a publish moves a draft Staged -> Submitted
    const key = await this._memberKey();
    if (key) await wbCacheInvalidateMany(key, [...keys, 'overview', 'prs']);
    if (!this._editing) this._ensureTab(this._tab); // refresh the visible tab (skip while still in the editor)
  }

  // SOW-073: if ANOTHER extension page invalidates this member's cache (e.g. a publish in a second workbench tab),
  // chrome.storage.onChanged fires here. React ONLY to REMOVALS (an invalidation), never to our own cache writes (a
  // revalidate SET), so this can never loop. Drops the in-memory caches + refetches the open tab.
  _wireStorageSync() {
    try {
      const oc = globalThis.chrome?.storage?.onChanged;
      if (!oc?.addListener) return;
      this._onStorage = async (changes, area) => {
        if (area !== 'local') return;
        const key = await this._memberKey();
        if (!key) return;
        const prefix = `gbti:wb:${key}:`;
        const removed = Object.entries(changes || {}).some(([k, c]) => k.startsWith(prefix) && c && c.newValue === undefined);
        if (!removed) return;
        this._cache = {}; this._prs = null; this._overview = null;
        if (!this._editing && this._reviewing == null) this._ensureTab(this._tab);
      };
      oc.addListener(this._onStorage);
    } catch { /* no chrome.storage: nothing to sync */ }
  }

  _loadPrStatuses() {
    this._pollTries = 0; // a fresh load (tab open / refresh) resets the live-poll budget
    this._renderAllPrLabels();
    this._schedulePrPoll(); // SOW-072 P3: keep the list fresh while any PR is still in flight, so a row flips live
  }
  // Render every row's gate label from the CURRENT this._prs: a MERGED PR is terminal-accepted (no gate reason to
  // show); an OPEN or CLOSED-declined PR fetches its gate status so a rejection shows its REASON (the silent-rejection
  // fix). Patches the .gate / .why nodes in place by data-n; safe to re-run on a poll tick (no full re-render).
  _renderAllPrLabels() {
    for (const pr of this._prs || []) {
      if (pr.merged === true || pr.state === 'merged') this._renderPrLabel(pr, null);
      else this._loadPrStatus(pr.number);
    }
  }
  async _loadPrStatus(number) {
    let status = null;
    try { status = await this.client?.prStatus?.({ number }); } catch { /* leave null */ }
    const pr = (this._prs || []).find((p) => p.number === number);
    if (pr) this._renderPrLabel(pr, status);
  }
  // SOW-072 P3: while ANY PR is still open (in flight), re-fetch the PR LIST on a backoff and re-render the labels, so a
  // row flips Submitted -> Accepted (merged) / Declined (closed) without a manual refresh. The gate STATUS alone never
  // carries merged/closed, so we must refresh the PR list itself. ONE workspace-level timer. Self-stops off the PR tab
  // / in an editor; bounded by MAX_TRIES per viewing session (the poll only runs while the tab is open). Cleared on
  // re-render + disconnect. _pollTries is NOT reset by _clearPolls (only a fresh _loadPrStatuses resets it), so the cap
  // is not silently defeated by a re-render mid-poll.
  _schedulePrPoll() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    const BASE_MS = 10000, CAP_MS = 30000, MAX_TRIES = 20;
    // "still in flight" = an open PR: prLifecycle with no gate status classifies any non-merged/closed PR as the
    // pollable 'pending' phase (shouldPollPr), so the poll runs until every PR is merged or closed.
    const anyOpen = (this._prs || []).some((pr) => shouldPollPr(prLifecycle(pr, null)));
    if (!anyOpen || (this._pollTries || 0) >= MAX_TRIES) return;
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null;
      if (this._tab !== 'prs' || this._editing) return; // self-stop off the PR tab / in an editor
      this._pollTries = (this._pollTries || 0) + 1;
      let prs = null;
      try { prs = (await this.client?.listPRs?.())?.prs; } catch { /* keep the current list */ }
      if (this._tab !== 'prs' || this._editing) return; // re-check after the await
      if (Array.isArray(prs)) this._prs = prs;
      this._renderAllPrLabels();
      this._schedulePrPoll();
    }, Math.min(BASE_MS * ((this._pollTries || 0) + 1), CAP_MS));
  }
  _clearPolls() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
  }
  _renderPrLabel(pr, status) {
    // SOW-072 P2: the shared lifecycle model drives the label/tone AND the inline rejection reason.
    const { label, tone, reason, needsAttention } = prLifecycle(pr, status);
    const tag = this.$(`.gate[data-n="${pr.number}"]`);
    if (tag) {
      tag.className = `gate tag ${tone}`;
      tag.textContent = label;
      if (reason) tag.title = reason;
    }
    // A rejection is never silent: surface the gate reason as visible text, not just a hover tooltip.
    const why = this.$(`.why[data-n="${pr.number}"]`);
    if (why) {
      if (needsAttention && reason) { why.textContent = reason; why.hidden = false; }
      else { why.textContent = ''; why.hidden = true; }
    }
  }

  // ----- rendering -----
  render() {
    this._clearPolls(); // SOW-072 P3: a re-render replaces the rows (and fires on a client/sign-out change) -> stop the
    // poll; the PR tab re-arms it via _ensureTab -> _loadPrStatuses, and a sign-out leaves it stopped.
    // SOW-112 QA fix: consume the #edit= / #draft= deep-link once the client is available (render fires on
    // client arrival via the setClient subscriber). One-shot: cleared before the async open so it never loops.
    if (this._restore && this.client) {
      const r = this._restore;
      this._restore = null;
      if (r.edit) this._openItem(r.edit, typeForContentPath(r.edit) || 'post');
      else if (r.draft) this._openDraft({ type: r.draft.type, slug: r.draft.slug });
    }
    if (typeof document !== 'undefined') document.body?.classList.toggle('gbti-editing', !!this._editing); // SOW-062 P6: paint .nt-main solid while editing (kills glass bleed)
    if (this._editing) {
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to my work</button><gbti-content-editor></gbti-content-editor>`);
      this.on('[data-back]', 'click', () => { this._editing = null; this._writeHash(`#tab=${encodeURIComponent(this._tab)}`); this.render(); });
      const ed = this.$('gbti-content-editor');
      const e = this._editing;
      // SOW-062 P6 + SOW-106 QA: path resolves the cover preview; staged drives the fork-draft meta.
      // SOW-145: an EDIT carries a house/ path the editor infers scope from; a NEW item has no path, so the
      // current workspace scope decides (a superadmin in House scope creates house content).
      if (ed?.load) ed.load(e.type, e.frontmatter, e.body, e.path, { staged: e.staged, scope: e.path ? undefined : this._scopeNow(), store: e.store }); // sow-194: store lets Preview render a repo draft from canonical, no KV shadow
      // SOW-112 QA fix: after a rename PR opens, drop the stale caches and repoint the deep-link hash at the
      // NEW path — but do NOT refetch it yet (the auto-merge takes ~2-3 minutes; an immediate read 404s and
      // looked like the rename did nothing). The editor already updated its own view optimistically.
      ed?.addEventListener?.('gbti-renamed', (ev) => {
        const r = ev?.detail || {};
        if (!r.path) return;
        this._cache = {};
        this._drafts = null;
        this._overview = null;
        if (this._editing) this._editing.path = r.path;
        this._writeHash(`#tab=${encodeURIComponent(this._tab)}&edit=${encodeURIComponent(r.path)}`);
      }, { once: true });
      // SOW-106: surface the fork-draft state and any schema drift together in the editor status line.
      const notes = [];
      if (e.staged) notes.push('You are editing your staged fork draft. It is not live until you Publish.');
      if (e.invalidNote) notes.push(`This draft no longer matches the current schema: ${e.invalidNote} Fix the listed fields and Save.`);
      if (notes.length && ed?.out) ed.out(esc(notes.join(' ')), e.invalidNote ? 'danger' : 'muted');
      // SOW-073: publishing/editing from the embedded editor invalidates the affected type (+ Overview + PRs) so the
      // workbench reflects the change immediately on return, never a stale list.
      ed?.addEventListener('gbti-published', () => this._onPublished(e.type));
      ed?.addEventListener('gbti-draft-saved', () => this._onDraftSaved()); // SOW-082
      return;
    }
    if (this._reviewing != null) {
      // SOW-028 drill-in: review one incoming contribution. On a decision the review element emits
      // `contrib-decided`; we return to the Inbox, which remounts <gbti-contrib-inbox> and refetches, so the
      // decided PR drops off the list.
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to inbox</button><gbti-contrib-review number="${esc(this._reviewing)}"></gbti-contrib-review>`);
      this.on('[data-back]', 'click', () => { this._reviewing = null; this.render(); });
      this.$('gbti-contrib-review')?.addEventListener('contrib-decided', () => { this._reviewing = null; this.render(); this._loadInboxCount(); });
      return;
    }
    const tabs = TABS.map((t) => {
      // SOW-085: count badges on the content tabs + Pull requests (+ the existing Inbox), from already-loaded
      // data only; hidden while unknown or 0.
      const n = this._tabCount(t);
      const badge = n ? `<span class="tbadge">${esc(n)}</span>` : '';
      return `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}${badge}</button>`;
    }).join('');
    this.set(this.css(CSS) + `${this._profileHtml()}<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this._msg = null; this._draftMsg = null; this._page = 0; this._statusFilter = 'all'; this.render(); this._ensureTab(this._tab); })); // SOW-085: a direct tab click resets the page + filter (was a gap)
    this._wireBody();
  }

  _profileHtml() {
    if (!this._profile) return '';
    const f = this._profile.frontmatter || {};
    const name = f.displayName || f.title || this._profile.title || 'Your profile';
    return `<div class="profile"><span class="lbl">Profile</span> <b>${esc(name)}</b><button class="btn" data-profile type="button">Edit profile</button></div>`;
  }

  _body() {
    const tab = TABS.find((t) => t.id === this._tab);
    if (this._tab === 'overview') return this._overviewHtml(); // SOW-052
    if (this._tab === 'earnings') return this._renderEarnings(); // SOW-083 P2: the member revenue dashboard
    // SOW-028: the incoming-contribution review inbox is its own self-loading element. It fetches + renders
    // independently (and is inert with no client), so the workspace just mounts the tag.
    if (this._tab === 'inbox') return `<gbti-contrib-inbox></gbti-contrib-inbox>`;
    if (this._tab === 'saved') return `<gbti-saved></gbti-saved>`; // SOW-037
    if (this._tab === 'subs') return `<gbti-subscriptions></gbti-subscriptions>`; // SOW-037
    if (this._tab === 'prs') {
      // sow-221: newest event first, so the tab reads as a history. The Worker returns GitHub's `sort=updated`
      // order, which is close but not the same thing: a PR merged today can sit below one whose branch was
      // touched later. Sorting on the event we actually DISPLAY keeps the order and the label consistent.
      const prs = this._prs === null ? null : sortPullsByEvent(this._prs);
      if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
      if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
      // SOW-085: paginate the PR list too (same 15/page pager as the content tabs); rows key on pr.number, so a
      // slice is safe. The per-PR gate status still resolves live for the visible page after the paint.
      const PAGE = 15;
      const pages = Math.max(1, Math.ceil(prs.length / PAGE));
      const page = Math.min(this._page || 0, pages - 1);
      const rows = prs.slice(page * PAGE, page * PAGE + PAGE).map((pr) => {
        // The state pill on the right already says WHERE the PR stands ("Accepted"), so the meta line names the
        // event that produced the timestamp instead of repeating it: "#271 on GitHub, merged 2 hours ago".
        // A payload without timestamps (an un-deployed Worker) yields no verb and the row reads as before.
        const ev = prEvent(pr);
        const when = ev.at ? ` <span class="when" title="${esc(absTime(ev.at))}">${esc(ev.verb)} ${esc(relTime(ev.at))}</span>` : '';
        return `<li class="row">
        <span class="t"><b>${esc(pr.title || ('PR #' + pr.number))}</b><span class="meta"><a href="${esc(pr.html_url || '#')}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub${when}</span><span class="why" data-n="${esc(pr.number)}" hidden></span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`;
      }).join('');
      const pager = pages > 1 ? `<div class="pager">`
        + `<button class="btn" data-page="${page - 1}" type="button"${page === 0 ? ' disabled' : ''}>&larr; Prev</button>`
        + `<span class="pager-n">Page ${page + 1} of ${pages}</span>`
        + `<button class="btn" data-page="${page + 1}" type="button"${page >= pages - 1 ? ' disabled' : ''}>Next &rarr;</button></div>` : '';
      return `<ul class="rows">${rows}</ul>${pager}`;
    }
    // SOW-085: merge the type's canonical content with its fork-staged drafts (SOW-082), then apply the shared
    // list controls (sort -> status filter) before the existing client-side paging. `this._viewList` is the index
    // target the row action handlers in _wireBody read.
    const type = tab?.type;
    const content = this._cache?.[this._ck(type)]; // SOW-145: read the scope-keyed slot (house vs member)
    if (!content) return `<p class="empty">Loading...</p>`;
    // SOW-145: house content publishes directly (no fork-staged house drafts in v1), so never merge the member's
    // fork drafts into the house list; the member scope keeps the SOW-085 merged-draft view.
    const typeDrafts = this._scopeNow() === 'house' ? [] : (this._drafts || []).filter((d) => d.type === type);
    const view = filterByStatus(sortItems(mergeTypeItems(content, typeDrafts), this._sort), this._statusFilter);
    this._viewList = view;
    const controls = this._listControls();
    // SOW-085: the status-flip ack (_msg) AND draft-action errors (_draftMsg, previously shown on the Drafts tab)
    // both surface here now that drafts live in the content list.
    const note = (this._msg || this._draftMsg) ? `<p class="empty">${esc(this._msg || this._draftMsg)}</p>` : '';
    // The "drafts live on your fork" copy that lived on the Drafts tab now shows only when the Drafts filter is on.
    const draftNote = this._statusFilter === 'draft'
      ? `<p class="muted draft-intro">Drafts live on your own fork. Save work here, then publish it to the network when you are ready.</p>` : '';
    if (view.length === 0) {
      const empty = this._statusFilter === 'all' ? `No ${esc(tab.label.toLowerCase())} yet.`
        : this._statusFilter === 'draft' ? `No drafts in ${esc(tab.label)}.`
          : `No published ${esc(tab.label.toLowerCase())}.`;
      return `${controls}${draftNote}${note}<p class="empty">${empty}</p>`;
    }
    const paid = this._overview ? this._overview.membership === 'paid' : true;
    const PAGE = 15;
    const pages = Math.max(1, Math.ceil(view.length / PAGE));
    const page = Math.min(this._page || 0, pages - 1);
    const start = page * PAGE;
    const rows = view.slice(start, start + PAGE).map((it, j) => {
      const i = start + j; // absolute index into this._viewList for the action handlers
      return it.isDraft ? this._draftRow(it, i, paid) : this._contentRow(it, i);
    }).join('');
    const pager = pages > 1 ? `<div class="pager">`
      + `<button class="btn" data-page="${page - 1}" type="button"${page === 0 ? ' disabled' : ''}>&larr; Prev</button>`
      + `<span class="pager-n">Page ${page + 1} of ${pages}</span>`
      + `<button class="btn" data-page="${page + 1}" type="button"${page >= pages - 1 ? ' disabled' : ''}>Next &rarr;</button></div>` : '';
    return `${controls}${draftNote}${note}<ul class="rows">${rows}</ul>${pager}`;
  }

  // SOW-085: a tab's count badge value, from data ALREADY loaded (no fetch just for a badge). Content tabs use
  // the exact merged count once their list is cached, else the eager Overview count; PRs use the loaded PR list;
  // Inbox keeps its awaiting-review count. 0 / unknown -> the caller hides the badge.
  _tabCount(t) {
    if (t.id === 'inbox') return this._inboxCount || 0;
    const counts = this._overview?.counts;
    if (t.id === 'prs') return Array.isArray(this._prs) ? this._prs.length : (counts?.prs ?? 0);
    if (t.type) {
      // SOW-145: in house scope the badge counts the loaded house list (no fork drafts, no personal-count
      // fallback, which would be the WRONG number); member scope keeps the merged personal count + eager fallback.
      if (this._scopeNow() === 'house') {
        const houseContent = this._cache?.[this._ck(t.type)];
        return houseContent ? houseContent.length : 0;
      }
      const content = this._cache?.[t.type];
      if (content) return mergeTypeItems(content, (this._drafts || []).filter((d) => d.type === t.type)).length;
      return counts?.[t.type] ?? 0;
    }
    return 0;
  }

  // SOW-085: the shared list-controls bar (sort + published/draft filter). Rendered above every content list.
  // SOW-145: a superadmin also gets a scope switch (My content / Network content) on the far left; a non-superadmin
  // never sees it (and the server re-checks the house gate regardless).
  _listControls() {
    const f = (v, label) => `<button class="lc-f ${this._statusFilter === v ? 'on' : ''}" data-filter="${v}" type="button">${label}</button>`;
    const opt = (v, label) => `<option value="${v}"${this._sort === v ? ' selected' : ''}>${label}</option>`;
    const now = this._scopeNow();
    const scopeBtn = (v, label) => `<button class="lc-scope ${now === v ? 'on' : ''}" data-scope="${v}" type="button" aria-pressed="${now === v}">${label}</button>`;
    const scopeSwitch = this._canScope()
      ? `<div class="lc-scopes" role="group" aria-label="Content scope">${scopeBtn('member', 'My content')}${scopeBtn('house', 'Network content')}</div>`
      : '';
    return `<div class="lc-bar">`
      + scopeSwitch
      + `<div class="lc-filter" role="group" aria-label="Filter by status">${f('all', 'All')}${f('published', 'Published')}${f('draft', 'Drafts')}</div>`
      + `<label class="lc-sort"><span class="lc-sl">Sort</span><select data-sort aria-label="Sort">${opt('newest', 'Newest')}${opt('oldest', 'Oldest')}${opt('updated', 'Recently updated')}${opt('title-asc', 'Title A-Z')}${opt('title-desc', 'Title Z-A')}</select></label>`
      + `</div>`;
  }

  // SOW-145: switch the content scope (My content <-> House content), persist it, reset the page + status filter,
  // and load the newly-active scope's list for the current tab (the scope-keyed cache makes a repeat switch instant).
  _setScope(scope) {
    if (scope !== 'member' && scope !== 'house') return;
    if (scope === this._scopeNow()) return;
    this._scope = scope;
    this._scopeResolved = true; // an explicit choice pins it (the auto empty-personal default no longer applies)
    try { if (typeof localStorage !== 'undefined') localStorage.setItem(WORKSPACE_SCOPE_KEY, scope); } catch { /* private mode */ }
    this._page = 0;
    this._statusFilter = 'all';
    this.render();
    if (!this._editing) this._ensureTab(this._tab);
  }

  // SOW-085: a canonical content row (its index is into this._viewList). SOW-062 glyph + Manage; SOW-106 the
  // staged-edits chip + the reversible self-unpublish/republish flip.
  _contentRow(it, i) {
    const g = glyphFor(null, it.type);
    const status = it.status ? `<span class="tag ${it.status === 'published' ? 'ok' : ''}">${esc(it.status)}</span>` : '';
    const vis = it.visibility === 'members' ? `<span class="tag">members</span>` : '';
    const stagedTag = (this._drafts || []).some((d) => d.path === it.path) ? `<span class="tag">staged edits</span>` : '';
    const flip = it.status === 'published'
      ? `<button class="btn" data-status="${i}" data-to="draft" type="button">Unpublish</button>`
      : it.status === 'draft'
        ? `<button class="btn" data-status="${i}" data-to="published" type="button">Republish</button>`
        : '';
    // SOW-173: a View link to the live public page, shown only for a PUBLISHED item (drafts and fork-staged rows
    // have no public page). Host-aware: a same-origin path on the website, the absolute site URL in a new browser
    // tab in the extension (chrome-extension:// pages cannot resolve a site-relative path), mirroring the workspace's
    // existing external-link pattern (the PR + membership anchors).
    const pub = it.status === 'published' ? publicPathFor({ type: it.type, path: it.path }) : null;
    const isExt = (typeof location !== 'undefined' && location.protocol === 'chrome-extension:');
    const view = pub
      ? `<a class="btn" href="${esc(isExt ? SITE + pub : pub)}"${isExt ? ' target="_blank" rel="noopener"' : ''} title="View the live page">View</a>`
      : '';
    return `<li class="row"><span class="gl" style="--ka:${esc(g.accent)}"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`
      + `<span class="t"><b>${esc(it.title)}</b><span class="meta">${esc(it.type || '')}</span></span>`
      + `<span class="right">${status} ${stagedTag} ${vis}${view}<button class="btn" data-edit="${i}" type="button">Manage</button>${flip}</span></li>`;
  }

  // SOW-052: the Overview hub — a membership line, a tile per section (with counts; tiles deep-link via #tab=),
  // and the pull requests needing attention. Tiles are <a> links so they need no JS wiring.
  _overviewHtml() {
    const ov = this._overview;
    if (!ov) return `<p class="empty">Loading your WorkBench...</p>`;
    const c = ov.counts;
    const mLabel = MEMBERSHIP_LABEL[ov.membership] || 'Member';
    const isStaff = ['moderator', 'admin', 'superadmin'].includes(ov.role);
    // sow-158 host-awareness fix: Settings + Admin are SEPARATE pages, not tabs, so they need a host-aware base.
    // In the extension they are `account.html` / `admin.html`; on the website they are `/account/` / `/admin/`. A
    // bare `account.html` resolved to /workbench/account.html -> 404 on the site (the same 404 class as the tabs).
    const isExt = (typeof location !== 'undefined' && location.protocol === 'chrome-extension:');
    const settingsHref = isExt ? 'account.html' : '/account/';
    const adminHref = isExt ? 'admin.html' : '/admin/';
    const tiles = [
      // The workspace's OWN tab nav uses a BARE `#tab=` hash, not the extension page `workspace.html#tab=`. On the
      // website the workspace lives at /workbench/, so `workspace.html#...` resolved to /workbench/workspace.html
      // -> 404. A bare hash stays on the current page (extension workspace.html OR website /workbench/) and the
      // _onHash listener switches the tab in place, no reload, on BOTH hosts.
      { nm: 'Articles', href: '#tab=post', n: c.post },
      { nm: 'Prompts', href: '#tab=prompt', n: c.prompt },
      { nm: 'Products', href: '#tab=product', n: c.product },
      { nm: 'Pull requests', href: '#tab=prs', n: c.prs },
      { nm: 'Saved', href: '#tab=saved', n: c.saved },
      { nm: 'Following', href: '#tab=subs', n: c.subs },
      { nm: 'Earnings', href: '#tab=earnings', n: null },
      { nm: 'Settings', href: settingsHref, n: null },
      ...(isStaff ? [{ nm: 'Admin tools', href: adminHref, n: null }] : []),
    ];
    const tileHtml = tiles.map((t) => `<a class="ov-tile" href="${esc(t.href)}"><span class="ov-n">${t.n == null ? '' : esc(t.n)}</span><span class="ov-nm">${esc(t.nm)}</span></a>`).join('');
    const draft = c.drafts ? `<span class="ov-draft">${esc(c.drafts)} draft${c.drafts === 1 ? '' : 's'} in progress</span>` : '';
    // SOW-075: a trial member can author + stage drafts on their own fork but cannot publish; the Overview gave no
    // explanation. This banner makes the fork-only / paid-to-publish reality clear where the trial member spends time.
    const trialBanner = ov.membership === 'trialing'
      ? `<div class="ov-trial"><div><b>You are on the free trial</b><br/><span>Author and stage drafts on your own fork now. Publishing to gbti.network (opening canonical pull requests) requires a paid membership.</span></div><a class="ov-up" href="https://gbti.network/membership/" target="_blank" rel="noopener">Upgrade to publish</a></div>`
      : '';
    const att = ov.attention.length
      ? `<ul class="ov-att">${ov.attention.map((a) => `<li><span class="tag ${esc(a.tone)}">${esc(a.label)}</span> <a href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.title)}</a></li>`).join('')}</ul>`
      : `<p class="muted">No pull requests need your attention.</p>`;
    return `<div class="ov">
      <div class="ov-hero"><div><b>Your WorkBench</b><br/><span class="muted">Membership: ${esc(mLabel)}</span></div>${draft}</div>
      ${trialBanner}
      <div class="ov-tiles">${tileHtml}</div>
      <h3 class="ov-h3">Pull requests</h3>
      ${att}
    </div>`;
  }

  // SOW-082 + SOW-085: a fork-staged draft row, MERGED into its content type's list. The lifecycle state (Staged
  // -> Submitted / Needs changes -> Published / Declined via classifyDraft), Manage / Publish / Discard. `i` is the
  // index into this._viewList; the actions carry data-drow-* so _wireBody looks the draft up there.
  _draftRow(d, i, paid) {
    const g = glyphFor(null, d.type);
    const isRepo = d.store === 'repo'; // sow-194: a status:draft item committed to the public repo
    const { label, tone } = classifyDraft({ pull: d.pull, store: d.store });
    const vis = d.visibility === 'members' ? `<span class="tag">members</span>` : '';
    // sow-194: a repo draft lives in the PUBLIC repo, so it is readable on GitHub even while unpublished on the
    // site. Say so, so a Drafts row is never mistaken for private review.
    const repoNote = isRepo ? `<span class="tag" title="Committed to the public repository, so it is readable on GitHub even though it is not published on the site.">public repo</span>` : '';
    // SOW-106 Phase C: the schema drifted since this draft was saved; it needs fixing before it can publish.
    const bad = d.valid === false ? `<span class="tag bad" title="${esc(d.invalidReason || 'no longer matches the current schema')}">Invalid</span>` : '';
    const pub = label === 'Published' ? ''
      : paid
        ? `<button class="btn" data-drow-publish="${i}" type="button">Publish</button>`
        : `<a class="btn" href="https://gbti.network/membership/" target="_blank" rel="noopener" title="Publishing requires a paid membership">Upgrade to publish</a>`;
    // sow-194: a repo draft is committed to the network; discarding it is a delete request, not a from-here
    // action, so omit the Discard control rather than surface one that always fails.
    const discard = isRepo ? '' : `<button class="btn" data-drow-discard="${i}" type="button">Discard</button>`;
    return `<li class="row"><span class="gl" style="--ka:${esc(g.accent)}"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`
      + `<span class="t"><b>${esc(d.title)}</b><span class="meta">${esc(d.type)} · draft${d.pendingSlug ? ` (renames to ${esc(d.pendingSlug)} on publish)` : ''}</span></span>`
      + `<span class="right"><span class="tag ${esc(tone)}">${esc(label)}</span>${repoNote}${d.pendingSlug ? `<span class="tag">rename pending</span>` : ''}${bad}${vis}`
      + `<button class="btn" data-drow-edit="${i}" type="button">Manage</button>${pub}`
      + `${discard}</span></li>`;
  }

  _wireBody() {
    // SOW-129: in the extension, "Edit profile" opens the dedicated Profile page; the npm CMS (no profile.html)
    // falls back to the generic content editor opening the profile item in place.
    this.on('[data-profile]', 'click', () => {
      if (typeof chrome !== 'undefined' && chrome.runtime?.id && typeof location !== 'undefined') { location.href = 'profile.html'; return; }
      this._openItem(this._profile?.path, 'profile');
    });
    // SOW-028: the Inbox tab's <gbti-contrib-inbox> emits `contrib-open` (composed) when a Review button is
    // clicked; open the review drill-in. The listener sits on the element node the bubbling event passes through.
    if (this._tab === 'inbox') {
      this.$('gbti-contrib-inbox')?.addEventListener('contrib-open', (e) => { this._reviewing = e.detail?.number ?? null; this.render(); });
    }
    const tab = TABS.find((t) => t.id === this._tab);
    if (tab?.type) {
      // SOW-085: all row actions index into this._viewList (the merged + sorted + filtered list).
      const view = () => this._viewList || [];
      this.$$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const it = view()[Number(b.dataset.edit)];
        if (it) this._openItem(it.path, it.type);
      }));
      // SOW-106 Phase B: flip an own item's status (unpublish/republish) through the gated own-folder PR.
      this.$$('[data-status]').forEach((b) => b.addEventListener('click', () => {
        const it = view()[Number(b.dataset.status)];
        if (it) this._setItemStatus(it, b.dataset.to, b, this._ck(tab.type)); // SOW-145: refetch the ACTIVE scope's slot
      }));
      // SOW-085: the merged fork-staged draft rows (SOW-082 affordances).
      this.$$('[data-drow-edit]').forEach((b) => b.addEventListener('click', () => { const d = view()[Number(b.dataset.drowEdit)]; if (d) this._openDraft(d); }));
      this.$$('[data-drow-publish]').forEach((b) => b.addEventListener('click', () => { const d = view()[Number(b.dataset.drowPublish)]; if (d) this._publishDraft(d, b); }));
      this.$$('[data-drow-discard]').forEach((b) => b.addEventListener('click', () => { const d = view()[Number(b.dataset.drowDiscard)]; if (d) this._discardDraft(d, b); }));
      // SOW-085: the shared list controls. Sort persists (one device-local key); the status filter is session-only.
      this.$('[data-sort]')?.addEventListener('change', (e) => {
        this._sort = sortModeFor(e.target.value);
        try { if (typeof localStorage !== 'undefined') localStorage.setItem(WORKSPACE_SORT_KEY, this._sort); } catch { /* private mode */ }
        this._page = 0; this.render();
      });
      this.$$('[data-filter]').forEach((b) => b.addEventListener('click', () => { this._statusFilter = b.dataset.filter; this._page = 0; this.render(); }));
      // SOW-145: the superadmin scope switch (My content / House content).
      this.$$('[data-scope]').forEach((b) => b.addEventListener('click', () => this._setScope(b.dataset.scope)));
    }
    // SOW-062 + SOW-085: client-side paging, wired for whichever pager is present (content tabs OR Pull requests).
    this.$$('[data-page]').forEach((b) => b.addEventListener('click', () => {
      if (b.hasAttribute('disabled')) return;
      this._page = Number(b.dataset.page) || 0;
      this.render(); // re-renders the slice + re-wires via _wireBody
    }));
  }

  // SOW-106 Phase B: member self-unpublish/republish. A reversible status flip on the member's OWN canonical
  // item, via the normal gated PR (auto-merges like any own-folder change; live at the next deploy).
  async _setItemStatus(it, to, btn, cacheType) {
    if (!it?.path || (to !== 'draft' && to !== 'published')) return;
    const ask = to === 'draft'
      ? `Unpublish "${it.title}"? It is set to draft and removed from public view (reversible; the file stays in the repo).`
      : `Republish "${it.title}"? It returns to public view.`;
    if (typeof confirm === 'function' && !confirm(ask)) return;
    const orig = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = to === 'draft' ? 'Unpublishing...' : 'Republishing...'; }
    try {
      const r = await this.client.setContentStatus({ path: it.path, status: to });
      this._msg = r?.noop ? 'Already in that state.' : submitAck({ prNumber: r?.prNumber, autoMerge: true });
      if (this._cache) this._cache[cacheType] = null; // refetch so the row's status chip reflects the flip
      this._overview = null;
      this._ensureTab(this._tab);
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = orig; }
      this._msg = err?.message || 'Could not change the status.';
      this.render();
    }
  }

  async _openItem(path, type) {
    if (!path) return;
    try {
      // SOW-106 QA fix: prefer the member's latest WORK. When a staged fork draft exists for this same path,
      // open THAT (with the staged meta + notice) instead of the canonical file, so an edit saved to the fork
      // is never silently hidden behind the live version.
      await this._loadDrafts(this._tab);
      const staged = (this._drafts || []).find((d) => d.path === path);
      if (staged) { this._openDraft(staged); return; }
      const full = await this.client.getContentItem({ path });
      this._editing = { type, frontmatter: full.frontmatter, body: full.body, path };
      this._writeHash(`#tab=${encodeURIComponent(this._tab)}&edit=${encodeURIComponent(path)}`);
      this.render();
    } catch { /* could not load: stay on the list */ }
  }

  // SOW-106 QA fix: keep the URL restorable without polluting history (replaceState only; fail-soft).
  _writeHash(hash) {
    try { if (typeof history !== 'undefined') history.replaceState(null, '', hash); } catch { /* no history in tests */ }
  }

  // SOW-082: open a fork-staged draft in the editor. readDraft (NOT getContentItem) reads from the staged branch on
  // the fork, decrypting a members-only body for the prefill so a re-save never replaces the gated text with a stub.
  async _openDraft(d) {
    if (!d) return;
    this._draftMsg = null;
    try {
      // sow-194: carry store + path so a repo draft reads its canonical file instead of the fork/KV store.
      const full = await this.client.readDraft({ type: d.type, slug: d.slug, store: d.store, path: d.path });
      // sow-194: carry the store onto the editing state so the editor's Preview can render a repo draft from its
      // canonical content (store:'repo') instead of saving a KV shadow copy first.
      this._editing = { type: d.type, frontmatter: full.frontmatter, body: full.body, path: full.path || d.path || '', staged: true, store: d.store };
      this._writeHash(`#tab=${encodeURIComponent(d.type)}&draft=${encodeURIComponent(d.type)}:${encodeURIComponent(d.slug)}`);
      // SOW-106 Phase C: re-validate against the CURRENT schema on open, so drift surfaces here (a clear prompt)
      // instead of as a publish-time failure. Best-effort: a validate error never blocks opening the draft.
      try {
        const v = await this.client.validateContent({ type: d.type, input: full.frontmatter, body: full.body });
        this._editing.invalidNote = v && v.valid === false ? (v.error || 'This draft no longer matches the current schema.') : null;
      } catch { this._editing.invalidNote = null; }
      this.render();
    } catch { this._draftMsg = 'Could not open that draft.'; this.render(); }
  }

  // SOW-082: publish a staged draft to the network (opens the canonical PR from its branch). Paid-only; a gate
  // rejection surfaces inline. On success the draft becomes Submitted and the list + caches refresh.
  async _publishDraft(d, btn) {
    if (!d) return;
    this._draftMsg = null;
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
    try {
      // sow-194: carry store + path so a repo draft publishes via the status flip, not the fork PR path.
      await this.client.publishDraft({ type: d.type, slug: d.slug, store: d.store, path: d.path });
      await this._onPublished(d.type); // clears _drafts + overview + prs and refreshes the visible tab
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
      this._draftMsg = err?.message || 'Could not publish this draft.';
      this.render();
    }
  }

  // SOW-082: discard a staged draft (deletes its fork branch). Refused server-side if it has an open PR.
  async _discardDraft(d, btn) {
    if (!d) return;
    if (typeof confirm === 'function' && !confirm(`Discard the draft "${d.title}"? This deletes it from your fork.`)) return;
    this._draftMsg = null;
    if (btn) { btn.disabled = true; btn.textContent = 'Discarding...'; }
    try {
      // sow-194: carry store (a repo draft has no Discard control, but a client refuses it with a typed error).
      await this.client.discardDraft({ type: d.type, slug: d.slug, store: d.store });
      this._drafts = null;
      this._overview = null;
      this._ensureTab(this._tab); // SOW-085: refresh the current content tab (drafts merge into it now)
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Discard'; }
      this._draftMsg = err?.message || 'Could not discard this draft.';
      this._drafts = null; // SOW-112 QA fix: re-list live so a stale row (branch already gone) clears itself
      this._ensureTab(this._tab); // SOW-085: refresh the current content tab (drafts merge into it now)
    }
  }
}

define('gbti-workspace', GbtiWorkspace);
export { GbtiWorkspace };
