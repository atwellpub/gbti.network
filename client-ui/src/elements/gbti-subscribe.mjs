// <gbti-subscribe> (SOW-023): upgrades the inert "Subscribe to activity" control baked by SubscribeButton.astro.
// The public static build ships `<gbti-subscribe data-gbti-username=..>` wrapping a button + a membership-gated
// dialog in its light DOM (the visitor path). When a host loads @gbti/client-ui, this element upgrades into a
// real follow toggle: it reads the caller's follow list (client.getFollows) and, for any SIGNED-IN member
// (SOW-060: following is a free-tier perk, not paid-only), toggles client.setFollow({ username, on }) against the
// deletable edge store via the Worker (never a PR; the GitHub token never reaches the page). A signed-out visitor
// (the Worker denies the read) falls back to the membership route. The followed username is observed, so the
// JS-driven prompts directory hero can set it.
import { GbtiElement, define } from '../base.mjs';

// SOW-143: route the "become a member" fallback safely from ANY host. On gbti.network keep the relative nav
// (unchanged behavior). Inside an extension page (chrome-extension:// origin, this element's first non-site
// mount via <gbti-member-view>), a relative '/membership/' resolves to a dead chrome-extension://<id>/membership/
// that would replace the whole tab, so open the absolute URL in a new tab instead.
const MEMBERSHIP_URL = 'https://gbti.network/membership/';
function goMembership() {
  try {
    if (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) { window.location.href = '/membership/'; return; }
  } catch { /* no location: fall through to the absolute open */ }
  try { window.open(MEMBERSHIP_URL, '_blank', 'noopener'); } catch { /* nothing more we can do */ }
}

// Megaphone inlined: a Shadow-DOM <use href="#ico-mega"> cannot reach the page sprite across the shadow boundary.
const mega = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:6px"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V6.5L6 10H4a1 1 0 0 0-1 1zM14 8v8c1.7-.6 3-2.4 3-4s-1.3-3.4-3-4zm0-4.2v2.1c2.9.9 5 3.7 5 6.1s-2.1 5.2-5 6.1v2.1c4-.9 7-4.4 7-8.2s-3-7.3-7-8.2z" fill="currentColor"/></svg>`;

const CSS = `
  .btn { display:inline-flex; align-items:center; cursor:pointer; font-family:var(--font-body);
    font-size:14px; font-weight:600; border-radius:10px; padding:9px 16px;
    border:1.5px solid var(--brand); background:var(--brand); color:#08231a;
    transition:background .15s ease, color .15s ease, border-color .15s ease; }
  .btn:hover { background:var(--brand-dark); border-color:var(--brand-dark); }
  .btn.on { background:transparent; color:var(--brand); }
  .btn.on:hover { border-color:var(--danger); color:var(--danger); }
  .btn[disabled] { opacity:.6; cursor:default; }
`;

class GbtiSubscribe extends GbtiElement {
  static get observedAttributes() { return ['data-gbti-username']; }
  attributeChangedCallback(name, oldV, newV) {
    if (name === 'data-gbti-username' && oldV !== newV) {
      this._loaded = false;
      this._following = undefined;
      if (this.isConnected) this.render();
    }
  }

  get _username() {
    const u = (this.dataset?.gbtiUsername || '').trim().toLowerCase();
    return /^[a-z0-9](?:-?[a-z0-9])*$/.test(u) ? u : '';
  }

  render() {
    const username = this._username;
    const following = this._following === true;
    const known = this._following !== undefined; // we have resolved the caller's follow state (paid)
    const label = !known ? 'Subscribe to activity' : following ? 'Following' : 'Subscribe to activity';
    const onCls = following ? 'on' : '';
    this.set(
      this.css(CSS) +
        `<button class="btn ${onCls}" type="button" aria-pressed="${following}" ${username ? '' : 'disabled'} aria-label="${label}">${mega}<span class="t">${label}</span></button>`,
    );
    this.on('.btn', 'click', () => this._onClick());
    // Lazily resolve the caller's follow state once (paid members get the live toggle; others fall back).
    if (this.client && username && !this._loaded) this._loadState(username);
  }

  async _loadState(username) {
    this._loaded = true;
    try {
      const r = await this.client.getFollows();
      const list = Array.isArray(r) ? r : (r?.following ?? []);
      this._following = list.some((e) => (e?.username || '').toLowerCase() === username);
      this._canFollow = true;
    } catch {
      // The Worker denies a trial/visitor (paid-only). Leave the visitor path (route to membership on click).
      this._canFollow = false;
    }
    this.render();
  }

  _onClick() {
    const username = this._username;
    if (!username) return;
    if (!this.client || this._canFollow === false) { goMembership(); return; }
    this._toggle(username);
  }

  async _toggle(username) {
    const next = !(this._following === true);
    this._following = next; // optimistic
    this.render();
    try {
      const r = await this.client.setFollow({ username, on: next });
      const list = Array.isArray(r) ? r : (r?.following ?? null);
      if (list) this._following = list.some((e) => (e?.username || '').toLowerCase() === username);
      this.render();
    } catch (err) {
      this._following = !next; // revert
      this.render();
      if (err?.code === 'not-authenticated' || err?.code === 'follows-failed' || /paid|sign in/i.test(err?.message || '')) {
        goMembership();
      }
    }
  }
}

define('gbti-subscribe', GbtiSubscribe);
export { GbtiSubscribe };
