// <gbti-coupon-manager> (SOW-119): the superadmin coupon manager. The CONFIG half is git-native: coupons
// live in house/coupons.yml and every edit opens an auto-merged house PR (the SOW-038 governance model;
// CODEOWNERS + the SOW-005 gate are the real boundary), going live at the next coupons:config mirror sync.
// The RUNTIME half (redemption counts) is Worker/KV via the admin usage endpoint; the share URL is the
// plain visible /codeable-invite/?coupon=<CODE> (QA 2026-07-18: no minted token links).
// Inert in public (no injected client). Host-agnostic. A sibling of <gbti-news-source-manager>.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs';
import { landerFor } from '../../../membership/invites.mjs';

// sow-231 Phase 3: THE SHARE URL IS NO LONGER ONE HARDCODED PATH. It was `/codeable-invite/?coupon=` for
// every coupon, which was correct when that was the only lander. There are now three, tier-scoped, and a
// member-tier code pointed at the Creator lander advertises benefits the member will not receive. That
// exact defect went live on 2026-08-15 and the owner caught it. `landerFor` is the single mapping, shared
// with scripts/invite-links.mjs.

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:grid; grid-template-columns: 1.2fr .7fr .7fr 1.4fr auto; gap:8px; margin:0 0 16px; }
  @media (max-width: 760px) { .add { grid-template-columns: 1fr 1fr; } }
  .add input { min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .c { border-top:1px solid var(--line); padding:12px 2px; }
  .c:first-child { border-top:0; }
  .c.off { opacity:.6; }
  .crow { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .code { font-family:var(--font-mono, monospace); font-weight:700; font-size:14px; color:var(--fg); letter-spacing:.04em; }
  .meta { font-size:12.5px; color:var(--muted); }
  .sp { flex:1; }
  .lk { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .linkrow { display:flex; align-items:center; gap:8px; margin-top:8px; flex-wrap:wrap; }
  .linkrow input { flex:1 1 320px; min-width:0; font-family:var(--font-mono, monospace); font-size:12px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:6px 9px; }
  .use { margin-top:8px; font-size:12.5px; color:var(--muted); }
  .use b { color:var(--fg); }
  .reds { list-style:none; margin:6px 0 0; padding:0; }
  .reds li { font-size:12.5px; color:var(--muted); padding:2px 0; font-family:var(--font-mono, monospace); }
  .muted { color:var(--muted); }
  .warn { color:var(--amber, #a9781c); }
  /* sow-231 Phase 3: issued invites. A separate panel because it is a different STORE with different rules:
     coupons are git-native config edited by PR, invites are per-person KV state that goes live at once. */
  .inv-head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:26px 0 12px; padding-top:20px; border-top:1px solid var(--line); }
  .inv-head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .mint { display:grid; grid-template-columns: .9fr 1.6fr .8fr auto; gap:8px; margin:0 0 14px; }
  @media (max-width: 760px) { .mint { grid-template-columns: 1fr 1fr; } }
  .mint select, .mint input { min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .i { border-top:1px solid var(--line); padding:11px 2px; }
  .i:first-child { border-top:0; }
  .i.spent { opacity:.62; }
  .st { font-family:var(--font-mono, monospace); font-size:11px; text-transform:uppercase; letter-spacing:.08em; border:1px solid var(--line); border-radius:999px; padding:2px 8px; }
  .st.issued { color:var(--accent); border-color:var(--accent); }
  .st.redeemed { color:var(--muted); }
  .st.revoked, .st.expired, .st.unknown { color:var(--amber, #a9781c); border-color:var(--amber, #a9781c); }
  .noterow { display:flex; gap:8px; margin-top:7px; }
  .noterow input { flex:1 1 auto; min-width:0; font:inherit; font-size:12.5px; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:5px 9px; }
`;

class GbtiCouponManager extends GbtiElement {
  // SOW-070: static admin.html markup upgrades before setClient; render() retries the load once the client lands.
  connectedCallback() { super.connectedCallback?.(); }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._coupons = (await this.client.couponPool())?.coupons || []; }
    catch { this._coupons = []; this._msg = 'Could not load the coupon registry.'; }
    try {
      const u = await this.client.couponUsage();
      this._usage = u?.usage || {};
    } catch { this._usage = {}; }
    // sow-231 Phase 3. Loaded separately and failing separately: an invite-route error must not blank the
    // coupon registry above it, which is the half that still works without this one. `null` distinguishes
    // "not loaded" from "loaded and empty", so the panel can say which.
    try { this._invites = (await this.client.inviteList?.())?.invites ?? []; }
    catch { this._invites = null; }
    this._loading = false;
    this.render();
  }

  _siteBase() {
    // The invite page lives on the public site regardless of which host renders this manager.
    return 'https://gbti.network';
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage coupons.</p>`); return; }
    if (!this._coupons) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading coupons...</p>`); return; }

    const rows = this._coupons.map((c) => {
      const code = String(c.code || '').toUpperCase();
      const u = this._usage[code] || { count: 0, redemptions: [] };
      // The share URL is the plain visible coupon param (QA 2026-07-18: no secret token links). Static,
      // derived, nothing to mint or rotate; deactivating the coupon is what kills the URL.
      // The PATH comes from the coupon's tier. No lander means no link is offered: a wrong one would
      // describe a tier this coupon does not confer.
      const path = landerFor({ code, tier: c.tier });
      const link = path ? `${this._siteBase()}${path}?coupon=${encodeURIComponent(code)}` : '';
      const reds = (u.redemptions || []).slice(0, 8).map((r) =>
        `<li>${esc(r.login || r.githubId)} · ${esc(String(r.redeemedAt || '').slice(0, 10))} → ${esc(String(r.until || '').slice(0, 10))}</li>`).join('');
      return `<li class="c${c.active === false ? ' off' : ''}" data-code="${esc(code)}">
        <div class="crow">
          <span class="code">${esc(code)}</span>
          <span class="meta">${esc(String(c.freeDays))} free day${Number(c.freeDays) === 1 ? '' : 's'}${c.maxRedemptions != null ? ` · max ${esc(String(c.maxRedemptions))}` : ' · unlimited'}${c.note ? ` · ${esc(c.note)}` : ''}</span>
          <span class="sp"></span>
          <button class="lk" data-toggle="${esc(code)}">${c.active === false ? 'Activate' : 'Deactivate'}</button>
        </div>
        ${link
          ? `<div class="linkrow"><input readonly value="${esc(link)}" aria-label="Share URL for ${esc(code)}" /><button class="lk" data-copy="${esc(link)}">Copy</button></div>`
          : `<div class="use warn">No lander for tier <b>${esc(String(c.tier || 'none'))}</b>, so there is no link to share. Give the coupon a known tier, or add the tier to landerFor().</div>`}
        <div class="use">Redemptions: <b>${esc(String(u.count ?? 0))}</b>${u.max != null ? ` of ${esc(String(u.max))}` : ''}</div>
        ${reds ? `<ul class="reds">${reds}</ul>` : ''}
      </li>`;
    }).join('');

    this.set(this.css(CSS) + `
      <div class="head"><h3>Coupons</h3><span class="hint">Free-time signup codes. Config edits land as an audited house PR and go live at the next mirror sync; links resolve immediately.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add">
        <input data-f="code" placeholder="CODE (A-Z 0-9)" maxlength="32" />
        <input data-f="freeDays" type="number" min="1" max="3650" placeholder="Free days" />
        <input data-f="maxRedemptions" type="number" min="1" placeholder="Max uses (empty = unlimited)" />
        <input data-f="note" placeholder="Note" maxlength="160" />
        <button class="btn" data-add>Add coupon</button>
      </div>
      <ul class="list">${rows || '<li class="c muted">No coupons yet.</li>'}</ul>
      ${this._invitesHtml()}
    `);

    this.$('[data-add]')?.addEventListener('click', () => this._add());
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () => this._toggle(b.dataset.toggle)));
    this.$$('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy'; }, 1500); } catch { /* clipboard denied */ }
    }));
    this.$('[data-mint]')?.addEventListener('click', () => this._mint());
    this.$$('[data-revoke]').forEach((b) => b.addEventListener('click', () => this._revoke(b.dataset.revoke)));
    this.$$('[data-savenote]').forEach((b) => b.addEventListener('click', () => this._saveNote(b.dataset.savenote)));
  }

  /**
   * The issued-invites panel. Rendered from inviteSummary records the Worker already resolved, so the
   * STATE is not re-derived here: one place decides whether an invite is issued, redeemed, revoked or
   * expired, and it is the same place the redemption path asks.
   */
  _invitesHtml() {
    // Only campaigns that can actually back an invite. Minting against a retired campaign would produce a
    // link that resolves to terms nobody can redeem, so it is not offered.
    const mintable = (this._coupons || []).filter((c) => c.active !== false);
    const opts = mintable.map((c) => `<option value="${esc(String(c.code).toUpperCase())}">${esc(String(c.code).toUpperCase())}</option>`).join('');

    if (this._invites === null) {
      return `<div class="inv-head"><h3>Issued invites</h3></div>
        <p class="use warn">Could not load issued invites. The coupon registry above is unaffected.</p>`;
    }

    const items = (this._invites || []).map((v) => {
      const code = esc(String(v.code || ''));
      const state = String(v.state || 'unknown');
      const path = landerFor({ code: v.campaign, tier: (this._coupons || []).find((c) => String(c.code).toUpperCase() === String(v.campaign).toUpperCase())?.tier });
      const link = path ? `${this._siteBase()}${path}?coupon=${encodeURIComponent(String(v.code))}` : '';
      const who = v.redeemedByLogin || v.redeemedBy;
      return `<li class="i${state === 'issued' ? '' : ' spent'}">
        <div class="crow">
          <span class="code">${code}</span>
          <span class="st ${esc(state)}">${esc(state)}</span>
          <span class="meta">${esc(String(v.campaign || ''))}${v.issuedAt ? ` · issued ${esc(String(v.issuedAt).slice(0, 10))}` : ''}${v.issuedByLogin ? ` by ${esc(v.issuedByLogin)}` : ''}${who ? ` · redeemed by ${esc(String(who))}` : ''}${v.expiresAt ? ` · expires ${esc(String(v.expiresAt).slice(0, 10))}` : ''}</span>
          <span class="sp"></span>
          ${state === 'issued' ? `<button class="lk" data-revoke="${code}">Revoke</button>` : ''}
        </div>
        ${link && state === 'issued'
          ? `<div class="linkrow"><input readonly value="${esc(link)}" aria-label="Invite link for ${code}" /><button class="lk" data-copy="${esc(link)}">Copy</button></div>`
          : ''}
        <div class="noterow">
          <input data-note="${code}" value="${esc(v.note || '')}" placeholder="Administration note (who this went to, and why)" maxlength="280" />
          <button class="lk" data-savenote="${code}">Save note</button>
        </div>
      </li>`;
    }).join('');

    return `
      <div class="inv-head">
        <h3>Issued invites</h3>
        <span class="hint">One-time links, each backed by a campaign above. Unlike coupons these are per-person records in KV, not config, so they take effect immediately and open no PR.</span>
      </div>
      <div class="mint">
        <select data-f="campaign" aria-label="Campaign">${opts || '<option value="">No active campaign</option>'}</select>
        <input data-f="inote" placeholder="Note (who is this for?)" maxlength="280" />
        <input data-f="iexpires" type="date" aria-label="Expires (optional)" />
        <button class="btn" data-mint${mintable.length ? '' : ' disabled'}>Generate invite</button>
      </div>
      <ul class="list">${items || '<li class="i muted">No invites issued yet.</li>'}</ul>`;
  }

  async _mint() {
    const v = (k) => this.$(`[data-f="${k}"]`)?.value?.trim() ?? '';
    const campaign = v('campaign');
    if (!campaign) { this._msg = 'Pick a campaign to mint against.'; this.render(); return; }
    await this._run(() => this.client.inviteCreate({ campaign, note: v('inote'), expiresAt: v('iexpires') || null }), `Invite minted against ${campaign}`);
  }

  async _revoke(code) {
    await this._run(() => this.client.inviteUpdate({ code, action: 'revoke' }), `${code} revoked`);
  }

  async _saveNote(code) {
    const note = this.$(`[data-note="${code}"]`)?.value ?? '';
    await this._run(() => this.client.inviteUpdate({ code, action: 'note', note }), `Note saved for ${code}`);
  }

  async _add() {
    const v = (k) => this.$(`[data-f="${k}"]`)?.value?.trim() ?? '';
    const code = v('code');
    const freeDays = Number(v('freeDays'));
    if (!code || !freeDays) { this._msg = 'A code and the free days are required.'; this.render(); return; }
    await this._run(() => this.client.addCoupon({ code, freeDays, note: v('note'), maxRedemptions: v('maxRedemptions') || null, expiresAt: null }), `Coupon ${code.toUpperCase()} added`);
  }

  async _toggle(code) {
    const cur = this._coupons.find((c) => String(c.code).toUpperCase() === code);
    const next = cur?.active === false;
    await this._run(() => this.client.updateCoupon({ code, patch: { active: next } }), `${code} ${next ? 'activated' : 'deactivated'}`);
  }

  async _run(fn, okMsg) {
    try {
      const r = await fn();
      this._msg = r?.prNumber ? `${okMsg}. ${submitAck({ prNumber: r.prNumber })}` : okMsg;
    } catch (err) {
      this._msg = err?.message || 'The action failed.';
    }
    this._coupons = null; // reload both halves
    this.render();
  }
}

define('gbti-coupon-manager', GbtiCouponManager);
