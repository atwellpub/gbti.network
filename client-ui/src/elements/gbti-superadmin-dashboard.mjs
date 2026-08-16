// <gbti-superadmin-dashboard> (SOW-038 P2): the admin read-view. Calls client.overrides() (GET /api/overrides,
// admin-gated) for a roster of every known member with their OVERRIDE-derived effective status (ban > staff >
// grandfather), computed from the public house/*.yml. Self-gates: a non-admin caller gets a quiet notice (the
// route is the real boundary). sow-229: each row also carries the effective TIER (bound to the tierLabel
// constant), a grant's provenance (coupon code) + expiry, and a distinct PENDING tag for a coupon redeemed in
// KV but not yet folded into git (an annotation, never effective state). Inert in public (no client). The token
// never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';
import { indexFileFor, SAVED_TYPES } from '../saved-core.mjs';
import { tierLabel } from '../../../membership/tiers.mjs'; // sow-229: the node-free tier label; bind to the constant, never a literal (sow-226 renames it in one place)

const SITE = 'https://gbti.network';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 16px; }
  .chip { font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; }
  .chip b { color:var(--fg); }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:700; padding:0 8px 8px; border-bottom:1px solid var(--line); }
  td { padding:9px 8px; border-top:1px solid var(--line); vertical-align:middle; }
  tr:first-child td { border-top:0; }
  .who { display:flex; align-items:center; gap:9px; min-width:0; }
  .av { width:26px; height:26px; border-radius:50%; flex:none; object-fit:cover; background:var(--hover); }
  .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; }
  a.nm:hover { color:var(--accent); }
  .id { color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .tags { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
  .tag { font-size:11px; font-weight:700; border-radius:999px; padding:2px 9px; background:var(--hover); color:var(--muted); white-space:nowrap; }
  .tag.staff { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.gf { background:rgba(201,150,43,.16); color:#a1741a; }
  .tag.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .tag.tier { background:rgba(31,158,95,.12); color:var(--accent); } /* sow-229: the effective membership tier */
  .tag.gf.soon { box-shadow:inset 0 0 0 1px rgba(201,150,43,.7); } /* sow-229: a bounded grant expiring soon */
  /* sow-229: a coupon grant redeemed in KV but not yet folded into git. DASHED, so a pending (edge-state)
     grant never reads the same as a folded (authoritative) one. */
  .tag.pending { background:transparent; color:var(--muted); border:1px dashed var(--line); font-weight:600; }
  .stat { font-size:11.5px; font-weight:700; border-radius:999px; padding:2px 10px; white-space:nowrap; background:var(--hover); color:var(--muted); }
  .stat.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .stat.tr { background:rgba(201,150,43,.16); color:#a1741a; }
  .stat.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .src { color:var(--muted); font-size:11px; margin-left:6px; }
  .dash { color:var(--muted); }
  .sec-h { font-size:14px; font-weight:700; margin:26px 0 10px; display:flex; align-items:center; gap:8px; }
  .sec-h .ct { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); font-weight:600; }
  ul.prs { list-style:none; margin:0; padding:0; }
  .pr { display:flex; align-items:center; gap:10px; padding:8px 8px; border-top:1px solid var(--line); }
  .pr:first-child { border-top:0; }
  .pr-t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; font-weight:600; font-size:13.5px; }
  a.pr-t:hover { color:var(--accent); }
  .pr-m { flex:none; color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .muted { color:var(--muted); font-size:14px; }
  .note { color:var(--muted); font-size:12.5px; margin:14px 0 0; line-height:1.5; }
  /* SOW-038 P3: operations triggers */
  .ops { display:flex; flex-wrap:wrap; gap:10px; }
  .opbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 15px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .opbtn:hover { border-color:var(--accent); color:var(--accent); }
  .opbtn[disabled] { opacity:.6; cursor:default; }
  .opnote { font-size:12.5px; margin:10px 0 0; } .opnote.ok { color:var(--accent); } .opnote.err { color:var(--danger); }
  /* SOW-070: per-row member actions (contextual ban / grandfather / role -- keyed by the row github_id, no typing). */
  td.act-cell { text-align:right; white-space:nowrap; }
  .manage { font:inherit; font-weight:600; font-size:12px; padding:5px 11px; border:1.5px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; white-space:nowrap; }
  .manage:hover { border-color:var(--accent); color:var(--accent); }
  .manage.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  tr.actrow td { background:var(--hover); border-top:0; padding:14px 12px; }
  .acts { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  .actgrp { display:flex; align-items:center; gap:6px; }
  .actgrp .actlbl { font-size:12.5px; color:var(--muted); font-weight:600; }
  .abtn { font:inherit; font-weight:600; font-size:13px; padding:8px 13px; border:1.5px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); cursor:pointer; white-space:nowrap; }
  .abtn:hover { border-color:var(--accent); color:var(--accent); }
  .abtn.danger { border-color:#e0a39d; color:#b3261e; }
  :host-context([data-theme="dark"]) .abtn.danger { border-color:rgba(243,147,139,.5); color:#f3938b; }
  .abtn.danger:hover { background:#b3261e; border-color:#b3261e; color:#fff; }
  .actrow select { font:inherit; font-size:13px; padding:7px 10px; border:1.5px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .actmsg { margin-top:10px; font-size:12.5px; color:var(--accent); } .actmsg.err { color:var(--danger); }
`;

const ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

class GbtiSuperadminDashboard extends GbtiElement {
  // SOW-070 fix: in admin.html's static markup, so it upgrades BEFORE admin.mjs injects the client. render() retries
  // the load the moment the client arrives (setClient re-renders subscribers) -- no eager _load() that early-returns.
  connectedCallback() {
    this._data = null; // { roster, summary }
    this._pulls = null; // open content-PR queue, or null when unavailable
    this._counts = null; // { username(lower) -> published content count }, or null
    this._error = null; // 'forbidden' | 'auth' | 'error'
    this._role = null; // the SIGNED-IN user's role (gates which per-row actions show); defaults to admin (roster is admin-gated)
    this._managing = null; // the github_id whose inline action panel is open, or null
    super.connectedCallback?.();
  }

  // Per-member published content counts, from the PUBLIC per-type index JSONs (no auth, no new endpoint). Author
  // is the folder username; house/gbti content does not map to a member. Best-effort; a failure leaves it null.
  async _loadCounts() {
    const counts = {};
    await Promise.all(SAVED_TYPES.map(async (t) => {
      try {
        const res = await fetch(`${SITE}/${indexFileFor(t)}`, { cache: 'no-cache' });
        const items = res.ok ? ((await res.json()).items || []) : [];
        for (const it of items) { const a = String(it?.author || '').toLowerCase(); if (a && a !== 'gbti' && a !== 'house') counts[a] = (counts[a] || 0) + 1; }
      } catch { /* skip this type */ }
    }));
    this._counts = counts;
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    try {
      const r = await this.client.overrides();
      this._data = { roster: r?.roster || [], summary: r?.summary || {} };
      this._loading = false;
    } catch (err) {
      const code = err?.code;
      this._error = code === 'forbidden' ? 'forbidden' : (code === 'no-identity' || code === 'not-authenticated') ? 'auth' : 'error';
      this._loading = false;
      this.render();
      return;
    }
    // Admin confirmed (the roster loaded): also load the open content-PR queue + per-member content counts,
    // both best-effort (a failure just hides that column / panel).
    try { this._pulls = (await this.client.openPulls())?.pulls || []; } catch { this._pulls = null; }
    // The signed-in role gates the per-row actions (role assignment is superadmin-only). The roster route is already
    // admin-gated, so a failed status read defaults to admin (ban/grandfather shown, role hidden until confirmed).
    try { this._role = (await this.client.status())?.role || 'admin'; } catch { this._role = 'admin'; }
    await this._loadCounts();
    this.render();
  }

  // The open content-PR queue (admin overview of what is awaiting the gate / review). null = not loaded.
  _pullsSection() {
    if (this._pulls === null) return '';
    if (!this._pulls.length) return `<h3 class="sec-h">Open pull requests</h3><p class="muted">No open pull requests right now.</p>`;
    const rows = this._pulls.map((p) => {
      const author = p.author?.login ? `@${esc(p.author.login)}` : 'unknown';
      const when = p.createdAt ? esc(String(p.createdAt).slice(0, 10)) : '';
      return `<li class="pr"><a class="pr-t" href="${esc(p.html_url || '#')}" target="_blank" rel="noopener">#${esc(p.number)} ${esc(p.title || '')}</a><span class="pr-m">${author}${when ? ` · ${when}` : ''}</span></li>`;
    }).join('');
    return `<h3 class="sec-h">Open pull requests <span class="ct">${this._pulls.length}</span></h3><ul class="prs">${rows}</ul>`;
  }

  // SOW-038 P3: the operations section (reconcile / E2E-smoke triggers). The dashboard is admin-gated (the roster
  // loaded), so these show only to a confirmed admin; the Worker re-checks + holds the dispatch token.
  _opsSection() {
    const note = this._opNote ? `<p class="opnote ${this._opNote.ok ? 'ok' : 'err'}">${esc(this._opNote.msg)}</p>` : '';
    return `<h3 class="sec-h">Operations</h3>
      <div class="ops">
        <button class="opbtn" data-op="reconcile" type="button">Run reconcile (apply)</button>
        <button class="opbtn" data-op="e2e" type="button">Run E2E smoke</button>
      </div>${note}
      <p class="note">Reconcile brings published content + Discord roles in line with Stripe + overrides (full <code>--apply</code>; idempotent). E2E smoke runs the live authenticated create &rarr; confirm &rarr; scrub cycle. Both kick off a GitHub Actions run; results appear in the repo's Actions tab.</p>`;
  }

  async _runOp(action, btn) {
    if (btn) btn.disabled = true;
    this._opNote = { ok: true, msg: 'Triggering&hellip;' };
    this.render();
    try {
      await this.client.adminOp(action);
      this._opNote = { ok: true, msg: `Triggered "${action}". Watch the run in the repo's Actions tab.` };
    } catch (err) {
      this._opNote = { ok: false, msg: err?.message || 'Could not trigger the operation.' };
    }
    this.render();
  }

  // The effective-status cell: the resolved status badge + the override source when it overrode Stripe.
  _statusCell(m) {
    const LABEL = { paid: 'paid', trialing: 'trial', expired: 'expired', cancelled: 'cancelled', none: 'none', banned: 'banned', unknown: 'unknown' };
    const cls = m.status === 'paid' ? 'ok' : m.status === 'banned' ? 'ban' : m.status === 'trialing' ? 'tr' : '';
    const src = m.source && m.source !== 'stripe' ? `<span class="src">via ${esc(m.source)}</span>` : '';
    return `<span class="stat ${cls}">${esc(LABEL[m.status] || m.status)}</span>${src}`;
  }

  // SOW-070: the inline per-member action panel (contextual ban / grandfather / role), keyed by the row's immutable
  // github_id -- no typing. The buttons toggle on the member's current state; role assignment is superadmin-only.
  _actionRow(m, rank) {
    const msg = this._actMsg ? `<div class="actmsg${this._actErr ? ' err' : ''}">${esc(this._actMsg)}</div>` : '';
    const roleCtl = rank >= ROLE_RANK.superadmin
      ? `<div class="actgrp"><span class="actlbl">Role</span><select data-rolefor>${['member', 'moderator', 'admin', 'superadmin'].map((r) => `<option${r === m.role ? ' selected' : ''}>${r}</option>`).join('')}</select><button class="abtn" type="button" data-act="role">Set role</button></div>`
      : '';
    return `<div class="acts">
      <button class="abtn${m.banned ? '' : ' danger'}" type="button" data-act="${m.banned ? 'unban' : 'ban'}">${m.banned ? 'Unban' : 'Ban'}</button>
      <button class="abtn" type="button" data-act="${m.grandfathered ? 'ungrandfather' : 'grandfather'}">${m.grandfathered ? 'Remove grandfather' : 'Grandfather'}</button>
      ${roleCtl}
    </div>${msg}`;
  }

  // Run a member action on the open row via the immutable github_id. Each opens a house PR (the gate + CODEOWNERS are
  // the real boundary); the roster reflects it after that PR merges + the build runs, so we just report submission.
  async _doAction(action) {
    const githubId = this._managing;
    if (!githubId) return;
    const extra = action === 'role' ? { role: this.$('[data-rolefor]')?.value || 'member' } : {};
    this._actMsg = 'Working…'; this._actErr = false; this.render();
    try {
      const res = await this.client.admin(action, { githubId, ...extra });
      this._actMsg = (res?.noop || res?.changed === false)
        ? 'No change (already in that state).'
        : `Submitted (PR #${res?.prNumber ?? '?'}). It takes effect once the PR merges and the build runs.`;
      this._actErr = false;
    } catch (err) {
      this._actMsg = err?.message || 'The action failed.'; this._actErr = true;
    }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to view the member roster.</p>`); return; }
    if (this._error === 'forbidden') { this.set(this.css(CSS) + `<p class="muted">The superadmin dashboard is available to admins and superadmins.</p>`); return; }
    if (this._error === 'auth') { this.set(this.css(CSS) + `<p class="muted">Sign in to view the member roster.</p>`); return; }
    if (this._error) { this.set(this.css(CSS) + `<p class="muted">Could not load the member roster. Try again shortly.</p>`); return; }
    if (!this._data) { if (!this._error && !this._loading) { this._loading = true; this._load(); } this.set(this.css(CSS) + `<p class="muted">Loading the member roster...</p>`); return; }

    const s = this._data.summary || {};
    const chips = `<div class="chips">
      <span class="chip"><b>${esc(s.total ?? 0)}</b> known</span>
      <span class="chip"><b>${esc(s.staff ?? 0)}</b> staff</span>
      <span class="chip"><b>${esc(s.grandfathered ?? 0)}</b> grandfathered</span>
      <span class="chip"><b>${esc(s.banned ?? 0)}</b> banned</span>
    </div>`;

    const rank = ROLE_RANK[this._role] ?? 0;
    const canManage = rank >= ROLE_RANK.admin; // the roster route is admin-gated, so this is effectively always true here
    const rows = (this._data.roster || []).map((m) => {
      const u = m.username ? esc(m.username) : '';
      const who = m.username
        ? `<a class="nm" href="https://gbti.network/members/${u}/" target="_blank" rel="noopener">@${u}</a>`
        : `<span class="nm id">id ${esc(m.githubId)}</span>`;
      const av = m.username
        ? `<img class="av" src="https://github.com/${encodeURIComponent(m.username)}.png?size=52" alt="" loading="lazy" data-avfor="${u}" />`
        : `<span class="av"></span>`;
      const tags = [];
      if (m.banned) tags.push(`<span class="tag ban">banned</span>`);
      // sow-229: the effective TIER, bound to the label constant (never a literal). Suppressed for `none`.
      const tierName = tierLabel(m.tier);
      if (tierName) tags.push(`<span class="tag tier">${esc(tierName)}</span>`);
      if ((ROLE_RANK[m.role] ?? 0) > 0) tags.push(`<span class="tag staff">${esc(m.role)}</span>`);
      if (m.grandfathered) {
        // sow-229: surface the grant's provenance (a coupon code) and its expiry, and emphasise a bounded grant
        // expiring within 30 days so a renewal is not missed (the full expiry column/sort is Phase 4).
        const prov = m.couponCode ? ` · ${esc(m.couponCode)}` : '';
        const until = m.grandfatherUntil ? ` · until ${esc(String(m.grandfatherUntil).slice(0, 10))}` : '';
        const soon = (typeof m.expiresInDays === 'number' && m.expiresInDays >= 0 && m.expiresInDays <= 30) ? ' soon' : '';
        tags.push(`<span class="tag gf${soon}">grandfathered${prov}${until}</span>`);
      }
      // sow-229: a coupon grant redeemed in KV that reconcile has not yet folded into git. An ANNOTATION only
      // (the row's effective status/tier above are unchanged); shown distinct (dashed) so it never reads as a
      // folded, authoritative grant.
      if (m.pendingGrant) {
        const pt = tierLabel(m.pendingGrant.tier);
        const pc = m.pendingGrant.code ? ` ${esc(m.pendingGrant.code)}` : '';
        const pu = m.pendingGrant.until ? ` · until ${esc(String(m.pendingGrant.until).slice(0, 10))}` : '';
        tags.push(`<span class="tag pending" title="Redeemed but not yet recorded in git. Reconcile folds it within a day.">pending${pt ? ' ' + esc(pt) : ''}${pc}${pu}</span>`);
      }
      if (!tags.length) tags.push(`<span class="dash">—</span>`);
      const n = this._counts && m.username ? (this._counts[m.username.toLowerCase()] || 0) : null;
      const content = n == null ? `<span class="dash">—</span>` : esc(n);
      const manage = canManage ? `<button class="manage${this._managing === m.githubId ? ' on' : ''}" type="button" data-manage="${esc(m.githubId)}">Manage</button>` : '';
      const main = `<tr><td><div class="who">${av}${who}</div></td><td>${this._statusCell(m)}</td><td><div class="tags">${tags.join('')}</div></td><td class="id">${content}</td><td class="id">${esc(m.githubId)}</td><td class="act-cell">${manage}</td></tr>`;
      const panel = (canManage && this._managing === m.githubId) ? `<tr class="actrow"><td colspan="6">${this._actionRow(m, rank)}</td></tr>` : '';
      return main + panel;
    }).join('');

    this.set(this.css(CSS) + `${chips}
      <table><thead><tr><th>Member</th><th>Status</th><th>Tier &amp; flags</th><th>Content</th><th>github_id</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="6" class="muted">No members known yet.</td></tr>'}</tbody></table>
      <p class="note">Effective status and tier follow ban &gt; staff &gt; grandfather &gt; Stripe. The override tiers (ban / staff / grandfather) are always authoritative from the public repo; the live Stripe tier shows when the admin Stripe endpoint is reachable. A <b>pending</b> (dashed) tag is a coupon grant a member has redeemed but reconcile has not yet folded into the repo: it is an annotation, not effective access yet, and it clears once the grant is recorded. Member actions open a house PR and take effect once it merges.</p>
      ${this._pullsSection()}
      ${this._opsSection()}`);

    this.$$('[data-avfor]').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
    this.$$('[data-op]').forEach((b) => b.addEventListener('click', () => this._runOp(b.dataset.op, b))); // SOW-038 P3
    this.$$('[data-manage]').forEach((b) => b.addEventListener('click', () => { this._managing = this._managing === b.dataset.manage ? null : b.dataset.manage; this._actMsg = ''; this._actErr = false; this.render(); }));
    this.$$('[data-act]').forEach((b) => b.addEventListener('click', () => this._doAction(b.dataset.act)));
  }
}

define('gbti-superadmin-dashboard', GbtiSuperadminDashboard);
export { GbtiSuperadminDashboard };
