// <gbti-member-view> (SOW-143): the in-extension DETAIL view of ANOTHER member's profile. The public site's
// follow relay (SubscribeButton.astro) opens newtab.html#tab=member&member=<username> so a follow lands on the
// specific person, not the generic Subscriptions tab. Self-loading + attribute-driven (mirrors <gbti-subscribe>):
// it paints a header skeleton from the username alone so the follow button is on screen at once, then fills in
// from the PUBLIC /members-index.json (header) + the three per-type index JSONs (their content). Presentation
// only: the follow gate + membership stay the Worker's. Node-free / CSP-safe / shadow DOM.
import { GbtiElement, define, esc } from '../base.mjs';
import { resolveAsset } from '../assets.mjs';
import { utmLink } from '../news.mjs';
import { socialIcon, SOCIAL_KEYS, SOCIAL_LABELS, buildSocialUrl } from '../social-icons.mjs';
import { loadMembersDirectory } from '../members-index.mjs';
import { memberContent, MEMBER_SECTIONS } from '../member-view-core.mjs';
import './gbti-subscribe.mjs'; // the follow toggle (reused verbatim)
import './gbti-card-list.mjs'; // the content section renderer

const SITE = 'https://gbti.network';
const lc = (s) => String(s || '').toLowerCase();
const githubAvatar = (login) => (login ? `https://github.com/${encodeURIComponent(login)}.png?size=128` : '');
// SOW-129 role humanizer (mcp-developer -> "MCP Developer"; short tokens uppercase).
const prettyRole = (s) => String(s || '').split(/[-_]/).filter(Boolean).map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
const USERNAME_RE = /^[a-z0-9](?:-?[a-z0-9]){0,38}$/;

const CSS = `
  :host { display:block; }
  .wrap { max-width:820px; margin:0 auto; padding:4px 2px 40px; }
  .hero { display:flex; gap:18px; align-items:flex-start; padding:6px 2px 18px; border-bottom:1px solid var(--line, #e5e5ea); margin-bottom:20px; }
  .av { flex:0 0 auto; width:96px; height:96px; border-radius:50%; overflow:hidden; display:grid; place-items:center;
    background:var(--panel, #f2f2f5); border:1px solid var(--line, #e5e5ea); font-weight:800; font-size:34px; color:var(--muted, #6c6976); }
  .av img { width:100%; height:100%; object-fit:cover; }
  .id { flex:1 1 auto; min-width:0; }
  .name { font-family:var(--font-display, inherit); font-weight:800; font-size:24px; line-height:1.15; color:var(--fg, #25232b); }
  .user { color:var(--muted, #6c6976); font-size:13.5px; margin-top:1px; }
  .headline { margin:8px 0 0; color:var(--fg-soft, #43414d); font-size:15px; }
  .bio { margin:10px 0 0; color:var(--fg-soft, #43414d); font-size:14px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
  .since { margin-top:8px; color:var(--muted, #6c6976); font-size:12.5px; }
  .actions { display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-top:14px; }
  .actions a.site, .actions a.edit { display:inline-flex; align-items:center; font:inherit; font-size:14px; font-weight:600;
    text-decoration:none; padding:9px 16px; border-radius:10px; border:1.5px solid var(--line, #d9d9df); color:var(--fg, #25232b); }
  .actions a.site:hover, .actions a.edit:hover { border-color:var(--brand, #1f9e5f); color:var(--brand, #1f9e5f); }
  .tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:12px; }
  .tag { font-size:12px; font-weight:600; padding:3px 9px; border-radius:999px; border:1px solid var(--line, #e5e5ea); color:var(--fg-soft, #43414d); }
  .tag.role { border-color:var(--brand, #1f9e5f); color:var(--brand, #1f9e5f); }
  .socials { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; }
  .soc { position:relative; display:grid; place-items:center; width:34px; height:34px; border-radius:9px;
    border:1px solid var(--line, #e5e5ea); color:var(--fg-soft, #43414d); text-decoration:none; }
  .soc:hover { border-color:var(--brand, #1f9e5f); color:var(--brand, #1f9e5f); }
  .note { margin:14px 0; padding:10px 12px; border-radius:10px; background:var(--panel, #f2f2f5); color:var(--muted, #6c6976); font-size:13px; }
  section.work { margin-top:26px; }
  section.work > h3 { font-family:var(--font-display, inherit); font-size:15px; font-weight:800; margin:0 0 10px; color:var(--fg, #25232b); }
  .empty { color:var(--muted, #6c6976); font-size:14px; padding:8px 0; }
  .skeleton { color:var(--muted, #6c6976); font-size:14px; padding:14px 0; }
`;

class GbtiMemberView extends GbtiElement {
  _loaded = false;
  _loading = false;
  _entry = null;      // /members-index.json row, or null (off-directory member)
  _isSelf = false;
  _sections = {};     // type -> filtered items[]

  static get observedAttributes() { return ['data-gbti-username']; }
  attributeChangedCallback() {
    // A live username swap (the new tab reusing one mounted element) resets and reloads.
    this._loaded = false; this._loading = false; this._entry = null; this._isSelf = false; this._sections = {};
    if (this.isConnected) this.render();
  }

  /** Call-site symmetry with openReader(item): set the observed attribute, which drives the load. */
  open(username) { this.setAttribute('data-gbti-username', String(username || '')); }

  get _username() {
    const u = lc(this.getAttribute('data-gbti-username') || '').trim();
    return USERNAME_RE.test(u) ? u : '';
  }

  async _load() {
    const username = this._username;
    if (!username || !this.client) { this._loaded = true; this._loading = false; return; }
    const guard = (p) => Promise.resolve(p).then((v) => v, () => null);
    try {
      const [dir, status, ...idx] = await Promise.all([
        guard(loadMembersDirectory()),
        guard(this.client.status?.()),
        ...MEMBER_SECTIONS.map((s) => guard(fetch(`${SITE}/${s.json}`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)))),
      ]);
      this._entry = (dir && dir.get) ? (dir.get(username) || null) : null;
      const me = lc(status?.identity?.username || status?.identity?.login || '');
      this._isSelf = !!me && me === username;
      MEMBER_SECTIONS.forEach((s, i) => { this._sections[s.type] = memberContent(idx[i]?.items || [], username, 24); });
    } catch { /* render whatever resolved */ }
    this._loaded = true; this._loading = false;
    this.render();
  }

  _heroHtml() {
    const username = this._username;
    const e = this._entry || {};
    const login = e.username || username;
    const avUrl = resolveAsset(e.avatar) || githubAvatar(login);
    const name = e.displayName || username;
    const ini = esc((name || '?').charAt(0).toUpperCase());
    const headline = e.headline ? `<p class="headline">${esc(e.headline)}</p>` : '';
    // SOW-143: the bio is a build-time PLAIN-TEXT excerpt on the directory entry; render ESCAPED, never as HTML.
    const bio = e.bio ? `<p class="bio">${esc(e.bio)}</p>` : '';
    let since = '';
    if (e.joinedAt) { try { since = `<div class="since">Member since ${new Date(e.joinedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</div>`; } catch { since = ''; } }

    // The primary action: self -> edit own profile (sibling extension page, no relay); other -> follow toggle.
    const action = this._isSelf
      ? `<a class="edit" href="profile.html">Edit your profile</a>`
      : `<gbti-subscribe data-gbti-username="${esc(username)}"></gbti-subscribe>`;
    const siteLink = utmLink(`${SITE}/members/${username}/`, { utm_source: 'gbti-network', utm_medium: 'extension', utm_campaign: 'member-profile' });
    const actions = `<div class="actions">${action}<a class="site" href="${esc(siteLink)}" target="_blank" rel="noopener">View on gbti.network</a></div>`;

    const tagPills = [];
    for (const r of (Array.isArray(e.roles) ? e.roles : [])) tagPills.push(`<span class="tag role">${esc(prettyRole(r))}</span>`);
    for (const s of (Array.isArray(e.skills) ? e.skills : [])) tagPills.push(`<span class="tag">${esc(String(s))}</span>`);
    const tags = tagPills.length ? `<div class="tags">${tagPills.join('')}</div>` : '';

    const links = e.links || {};
    const chips = [];
    for (const key of SOCIAL_KEYS) {
      if (key === 'discord' || !links[key]) continue;
      const url = buildSocialUrl(key, links[key]);
      const ico = socialIcon(key);
      if (url && ico) chips.push(`<a class="soc" href="${esc(url)}" target="_blank" rel="noopener nofollow" aria-label="${esc(SOCIAL_LABELS[key] || key)}">${ico}</a>`);
    }
    if (links.discord) {
      const handle = String(links.discord).trim();
      chips.push(`<span class="soc" tabindex="0" role="img" title="Discord: ${esc(handle)}" aria-label="Discord: ${esc(handle)}">${socialIcon('discord')}</span>`);
    }
    const socials = chips.length ? `<div class="socials">${chips.join('')}</div>` : '';

    // Off-directory members are absent from /members-index.json; the follow target still exists, so render a
    // username-only header with a working toggle rather than a "not found" wall (the point of the relay).
    const note = (!this._entry && this._loaded)
      ? `<div class="note">This member has not published a public profile. You can still follow them.</div>` : '';

    return `<div class="hero">`
      + `<span class="av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`
      + `<div class="id"><div class="name">${esc(name)}</div><div class="user">@${esc(username)}</div>`
      + `${headline}${bio}${since}${actions}${tags}${socials}</div></div>${note}`;
  }

  render() {
    const username = this._username;
    if (!username) { this.set(this.css(CSS) + `<div class="wrap"><div class="note">No member selected.</div></div>`); return; }
    // Kick the async load from render (the client may arrive after mount; base.mjs re-renders on setClient).
    if (this.client && !this._loaded && !this._loading) { this._loading = true; this._load(); }

    const sections = this._loaded
      ? MEMBER_SECTIONS.map((s) => `<section class="work" data-section="${s.type}"><h3>${esc(s.label)}</h3><div data-list="${s.type}"></div></section>`).join('')
      : `<div class="skeleton">Loading ${esc(username)}…</div>`;
    // SOW-143 open question 1 resolved: public SHARES are omitted in v1 (listShares is newest-first repo-wide,
    // capped at 100, no author param, so a per-author filter under-reports). Slot kept here for a future
    // per-author share index.
    this.set(this.css(CSS) + `<div class="wrap">${this._heroHtml()}${sections}</div>`);

    // Mount a <gbti-card-list> per section AFTER paint; a click re-emits member-open-item so the HOST decides
    // how to open it (the new tab opens the reader with a return-to-this-member back target).
    if (this._loaded) {
      for (const s of MEMBER_SECTIONS) {
        const host = this.$(`[data-list="${s.type}"]`);
        if (!host) continue;
        const items = this._sections[s.type] || [];
        if (!items.length) { host.innerHTML = `<div class="empty">No published ${esc(s.label.toLowerCase())} yet.</div>`; continue; }
        const list = document.createElement('gbti-card-list');
        list.mode = 'detailed';
        list.items = items; // no openHref -> emits card-open
        list.addEventListener('card-open', (e) => { const it = e.detail?.item; if (it) this.emit('member-open-item', { item: it, username }); });
        host.replaceChildren(list);
      }
    }
  }
}

define('gbti-member-view', GbtiMemberView);
export { GbtiMemberView };
