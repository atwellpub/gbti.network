// <gbti-shares-feed> (SOW-018; SOW-041 P2): the EXTENSION/client-only Shares reading stream. No public website
// surface; this is where a member reads the co-op's status updates. SOW-041 makes a Share a FIRST-CLASS content
// item: the stream is now a thin adapter over the shared <gbti-card-list> (the same card every content type uses
// — coin glyph + Members lock + author/time), and clicking a Share opens a focused READING view (the note body +
// an always-open discussion thread) instead of stacking expanded cards. The body+discussion engine (decrypt via
// the Worker, SOW-016; threads via SOW-032's listShareComments + the inert <gbti-comment-box>) is unchanged.
// A Locked account gets a splash; the key never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';
import { utmLink, UTM } from '../news.mjs'; // sow-145: UTM attribution on outbound share links
// sow-221 follow-up: the private relTime that used to live here flattened everything under 24 hours to
// "today". The shared one reports "3 hours ago", which is what the owner asked for and what the content
// cards already did, so this surface disagreed with those for same-day items. One definition now.
import { relTime } from '../time-core.mjs';
import { parseBrowseHash } from '../browse-hash.mjs'; // SOW-092: the share deep link (#tab=share&read=<author>/<id>)
import { embedUrl, isPortraitEmbed } from '../../../client/src/video-embed.mjs'; // SOW-092: a video share plays inline
import { shareToItem, hostOf } from '../all-merge.mjs'; // SOW-042: the shared Share projection + link-host helper
import { resolveAsset } from '../assets.mjs'; // SOW-057: resolve the share featured image URL
import './gbti-card-list.mjs';
import './gbti-discussion.mjs'; // SOW-041: the shared thread engine (factored out of this file)
import './gbti-favorite.mjs'; // SOW-050 P3: Shares are first-class — favorite + collect them like every other type
import './gbti-collection.mjs';
import './gbti-upvote.mjs'; // SOW-057: upvote a share (two votes enqueue syndication)
import './gbti-mod-actions.mjs'; // SOW-071: the shared per-item moderation control (replaces the bespoke Hide button)

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; margin:4px 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .refresh { background:transparent; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
  .refresh:hover { color:var(--brand); }
  .pager { display:flex; justify-content:center; margin-top:14px; }
  .load-older { background:var(--panel); border:1.5px solid var(--line); border-radius:10px; color:var(--fg); cursor:pointer; font:inherit; font-size:13px; padding:8px 18px; }
  .load-older:hover { border-color:var(--brand); color:var(--brand); }
  .load-older:disabled { opacity:.6; cursor:default; }
  .muted { color:var(--muted); font-size:13.5px; }
  /* SOW-092: a share whose link is a recognized video plays inline in place of the static image. */
  .share-embed { position:relative; aspect-ratio:16/9; overflow:hidden; background:#000; border-radius:10px; margin-top:10px; }
  .share-embed iframe { width:100%; height:100%; border:0; }
  .share-embed.tall { aspect-ratio:9/16; max-width:380px; }
  .empty { color:var(--muted); font-size:12.5px; margin:0 0 8px; }

  /* reading view (a focused Share + its discussion) */
  .rtop { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 14px; }
  .back { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .back:hover { border-color:var(--accent); color:var(--accent); }
  .hide { border:1px solid var(--line); background:var(--panel); color:var(--danger); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .hide:hover { border-color:var(--danger); }
  .hide[disabled] { opacity:.6; cursor:default; }
  .reading .who { display:flex; align-items:baseline; gap:8px; }
  .reading .who .name { font-weight:700; font-size:14px; }
  .reading .who .when { color:var(--muted); font-size:12px; }
  .reading .badge { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .reading .title { font-weight:700; font-size:18px; margin-top:8px; }
  .reading .desc { color:var(--muted); font-size:13.5px; margin-top:2px; }
  .reading .actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; } /* SOW-050 P3: favorite + collect a Share */
  .body { margin-top:10px; font-size:14.5px; line-height:1.6; }
  .body :is(h1,h2,h3,h4){ font-weight:700; margin:.8em 0 .3em; }
  .body p { margin:0 0 .7em; } .body ul,.body ol { margin:0 0 .7em 1.2em; }
  .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--bg, rgba(0,0,0,.05)); padding:10px; border-radius:8px; overflow:auto; }
  .link { display:inline-flex; align-items:center; gap:6px; margin-top:10px; font-size:12.5px; color:var(--brand); text-decoration:none; }
  .tags { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .locked { color:var(--muted); font-size:13.5px; } .locked a { color:var(--brand); font-weight:600; }
  .splash { text-align:center; padding:40px 16px; }
  .splash .lock { font-size:30px; } .splash h3 { margin:10px 0 4px; } .splash a { color:var(--brand); font-weight:600; }

  /* SOW-032/041 discussion container (the thread itself renders inside <gbti-discussion>). */
  .discussion-wrap { margin-top:22px; border-top:1px solid var(--line); padding-top:14px; }
  .discussion-wrap h4 { margin:0 0 10px; font-size:14px; }
`;

const authorName = (a) => (a === 'gbti' ? 'GBTI Network' : a || 'A member');

class GbtiSharesFeed extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._items = null; // raw shares
    this._reading = null; // the share being read, or null (the list)
    this._locked = false;
    // SOW-092: on post, open the member's new share IMMEDIATELY (the optimistic reader-ready item the
    // composer emits; SOW-076 instant-feel) and refetch the stream quietly behind it. Marks the event
    // handled so the shell's no-reader compose fallback never double-fires. A payload without the item
    // (an older composer) keeps the old refetch behavior.
    this._onPosted = (e) => {
      const item = e?.detail?.item;
      if (item) { if (e.detail) e.detail.handled = true; this._reading = item; this.render(); this.reload(true); return; }
      this._reading = null;
      this.reload();
    };
    document.addEventListener('gbti-share-posted', this._onPosted);
    // SOW-092: a share handed off by another page (the shell compose fallback stashes the optimistic item
    // in sessionStorage and navigates here).
    const stashed = this._takeStash();
    if (stashed) { this._reading = stashed; this.render(); this.reload(true); return; }
    // SOW-092: the share deep link — #read=<author>/<shareId> (shares.html or the Browse Shares tab). The
    // target opens once the stream loads (reload resolves it).
    this._openSlug = (() => {
      try { return parseBrowseHash(typeof location !== 'undefined' ? location.hash : '').read || null; } catch { return null; }
    })();
    this.reload();
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._onPosted) document.removeEventListener('gbti-share-posted', this._onPosted);
  }

  _takeStash() {
    try {
      const raw = sessionStorage.getItem('gbti-open-share');
      if (!raw) return null;
      sessionStorage.removeItem('gbti-open-share');
      const item = JSON.parse(raw);
      return item && item.type === 'share' && item.id ? item : null;
    } catch { return null; }
  }

  /** SOW-092: reflect the open share in the hash (keeps any tab= token, e.g. on the Browse Shares tab) so
   *  the address bar is a copyable deep link; slug=null strips it. replaceState fires no hashchange. */
  _setHash(slug) {
    if (typeof location === 'undefined' || typeof history === 'undefined') return;
    try {
      const { tab } = parseBrowseHash(location.hash);
      const parts = [];
      if (tab) parts.push(`tab=${tab}`);
      if (slug) parts.push(`read=${encodeURIComponent(slug)}`);
      history.replaceState(null, '', location.pathname + location.search + (parts.length ? '#' + parts.join('&') : ''));
    } catch { /* fail-soft */ }
  }

  /** quiet=true refreshes the stream WITHOUT painting (used behind an open reading view). */
  async reload(quiet = false) {
    if (!this.client) { if (!quiet) this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client to read Shares.</p>`); return; }
    if (!quiet) this.set(this.css(CSS) + `<p class="muted">Loading the co-op stream…</p>`);
    let membership = 'unknown';
    try { const st = await this.client.status(); membership = st?.membership ?? 'unknown'; this._role = st?.role ?? 'member'; this._me = String(st?.identity?.username || st?.identity?.login || '').toLowerCase(); } catch { membership = 'unknown'; this._role = 'member'; this._me = ''; }
    this._locked = LOCKED.has(membership);
    if (this._locked) return quiet ? undefined : this._splash();
    // A host whose listShares returns a `nextBefore` cursor (the website cookie adapter) enables the "Load older"
    // pager; a host that returns only { items } (the extension GitHub reader) leaves it null, so the pager never
    // shows there -- an additive, feature-detected enhancement with no change to the extension surfaces.
    try { const r = await this.client.listShares(); this._items = r?.items ?? []; this._nextBefore = r?.nextBefore ?? null; }
    catch { if (!quiet) this.set(this.css(CSS) + `<p class="muted">Could not load Shares right now.</p>`); return; }
    // SOW-092: resolve a pending deep link against the freshly loaded stream (silently falls back to the
    // list when the target is not there, e.g. an old link to a removed share).
    if (this._openSlug && !this._reading) {
      const target = this._items.find((s) => `${s.author}/${s.id}` === this._openSlug);
      this._openSlug = null;
      if (target) this._reading = target;
    }
    if (!quiet) this.render();
  }

  render() {
    if (this._locked) return this._splash();
    if (this._reading) { this._renderReading(this._reading); return; }
    this._renderList();
  }

  // The stream as the shared content-item card list. A Share has no image, so the card shows the coin category
  // glyph (glyphFor type fallback). No openHref -> the card emits card-open, which opens the reading view.
  _renderList() {
    const head = `<div class="head"><h3>Co-op stream</h3><button class="refresh" type="button">Refresh</button></div>`;
    const items = this._items || [];
    if (!items.length) {
      this.set(this.css(CSS) + head + `<p class="muted">No Shares yet. Post the first one with the + button.</p>`);
      this.on('.refresh', 'click', () => this.reload());
      return;
    }
    // The "Load older" pager shows only when the host handed back a cursor (the website cookie adapter). It calls
    // listShares({ before }) and appends, so the account hub can page past the newest window.
    const pager = this._nextBefore ? `<div class="pager"><button class="load-older" type="button" data-load-older>Load older</button></div>` : '';
    this.set(this.css(CSS) + head + `<div data-list></div>${pager}`);
    this.on('.refresh', 'click', () => this.reload());
    if (this._nextBefore) this.on('[data-load-older]', 'click', () => this._loadOlder());
    const list = document.createElement('gbti-card-list');
    list.mode = 'detailed';
    // Carry the full Share through the shared projection so card-open returns it (the card only reads a few fields).
    list.items = items.map((it) => shareToItem(it));
    list.addEventListener('card-open', (e) => { const it = e.detail?.item; if (it) { this._reading = it; this.render(); } });
    this.$('[data-list]')?.replaceChildren(list);
  }

  /** Append the next older page (website cookie adapter only; feature-detected by the nextBefore cursor). */
  async _loadOlder() {
    if (!this._nextBefore || this._loadingMore) return;
    this._loadingMore = true;
    const btn = this.$('[data-load-older]');
    if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
    try {
      const r = await this.client.listShares({ before: this._nextBefore });
      this._items = [...(this._items || []), ...((r && r.items) || [])];
      this._nextBefore = r?.nextBefore ?? null;
    } catch { if (btn) { btn.disabled = false; btn.textContent = 'Load older'; } this._loadingMore = false; return; }
    this._loadingMore = false;
    this.render();
  }

  // The focused reading view: the Share's body + an always-open discussion thread.
  _renderReading(share) {
    const slug = share.author && share.id ? `${share.author}/${share.id}` : '';
    const badge = share.visibility === 'members' ? `<span class="badge">Members</span>` : '';
    const title = share.title ? `<div class="title">${esc(share.title)}</div>` : '';
    const desc = share.shortDescription ? `<div class="desc">${esc(share.shortDescription)}</div>` : '';
    // SOW-057: "Read article on <domain>" + the featured image beneath it (single-column feed).
    const link = share.url ? `<a class="link" href="${esc(utmLink(share.url, { ...UTM, utm_medium: 'extension', utm_campaign: 'shares' }))}" target="_blank" rel="noopener nofollow">${embedUrl(share.url) ? 'Watch video' : 'Read article'} on ${esc(hostOf(share.url))}</a>` : '';
    // SOW-092: a video link (YouTube/Vimeo/TikTok/Rumble embed) plays inline; the static image (usually
    // that video's thumbnail) shows only for non-video links.
    const shareEmbed = share.url ? embedUrl(share.url) : null;
    const heroUrl = share.image ? resolveAsset(share.image) : '';
    const hero = shareEmbed
      ? `<div class="share-embed${isPortraitEmbed(shareEmbed) ? ' tall' : ''}"><iframe src="${esc(`https://gbti.network/embed/?u=${encodeURIComponent(share.url)}`)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
      : (heroUrl ? `<img class="share-hero" src="${esc(heroUrl)}" alt="" loading="lazy" style="display:block;max-width:100%;border-radius:10px;margin-top:10px" />` : '');
    const tags = (share.tags || []).length ? `<div class="tags">${share.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join('')}</div>` : '';
    // SOW-050 P3 + SOW-057: the Favorite + Collection cluster, plus an Upvote (hidden for the share's own author,
    // whose vote never counts). A Share keys on its composite "<author>/<id>" slug.
    const isAuthor = !!this._me && this._me === String(share.author || '').toLowerCase();
    const upvote = (slug && !isAuthor) ? `<gbti-upvote data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-upvote>` : '';
    const actions = slug ? `<div class="actions">
      ${upvote}
      <gbti-favorite data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-favorite>
      <gbti-collection data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-collection>
    </div>` : '';
    const discussion = slug ? `<div class="discussion-wrap"><h4>Discussion</h4><gbti-discussion data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>` : '';
    // SOW-071: the shared <gbti-mod-actions> replaces the bespoke Hide button (one moderation surface on every content
    // type). It self-gates by role + builds the canonical members/<author>/shares/<id>.md path; on a hide/remove it
    // emits 'mod-action', which returns us to the updated stream. CODEOWNERS + the SOW-005 gate stay the boundary.
    const mod = (share.author && share.id) ? `<gbti-mod-actions data-gbti-type="share" data-gbti-author="${esc(share.author)}" data-gbti-id="${esc(share.id)}"></gbti-mod-actions>` : '';
    this.set(this.css(CSS) + `<div class="rtop"><button class="back" type="button" data-back>&larr; Back to the stream</button>${mod}</div>
      <article class="reading">
        <div class="who"><span class="name">${esc(authorName(share.author))}</span><span class="when">${esc(relTime(share.createdAt))}</span>${badge}</div>
        ${title}${desc}${actions}
        <div class="body" data-body><p class="empty">Loading…</p></div>
        ${link}${hero}${tags}${discussion}
      </article>`);
    this.on('[data-back]', 'click', () => { this._reading = null; this._setHash(null); this.render(); });
    this._setHash(slug); // SOW-092: the address bar carries the share deep link while reading
    this.on('gbti-mod-actions', 'mod-action', (e) => { if (e.detail?.action !== 'unhide') { this._reading = null; this.reload(); } });
    // Resolve the Share's note body (decrypt for a members Share); the discussion loads itself.
    this._fillBody(share);
  }

  async _fillBody(share) {
    const html = await this._resolveBody(share);
    const el = this.$('[data-body]');
    if (!el) return;
    if (html && html.locked) el.innerHTML = `<div class="locked">This Share is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`;
    else el.innerHTML = (typeof html === 'string' && html) ? html : `<p class="muted">No note.</p>`;
  }

  async _resolveBody(it) {
    try {
      // SOW-092: the author's own just-posted share carries its LOCAL plaintext body (the optimistic item)
      // even at members visibility, so it renders with zero decrypt round-trip.
      if (it.body) return (await this.client.preview({ body: it.body }))?.html ?? '';
      if (it.visibility === 'members') {
        if (!it.encryptedBody) return ''; // a members Share with no body
        const { text } = await this.client.decrypt({ encPath: it.encryptedBody });
        return (await this.client.preview({ body: text }))?.html ?? '';
      }
      return '';
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      return { locked };
    }
  }

  _splash() {
    this.set(this.css(CSS) + `<div class="splash"><div class="lock">🔒</div><h3>Your access is locked</h3>
      <p class="muted">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to read the community Shares stream again.</p></div>`);
  }

}

define('gbti-shares-feed', GbtiSharesFeed);
export { GbtiSharesFeed };
