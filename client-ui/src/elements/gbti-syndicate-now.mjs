// <gbti-syndicate-now> (SOW-088): the superadmin "Manually Syndicate" control in the reader sidebar. A
// button (rendered ONLY for a superadmin; the Worker is the real boundary) opens a modal: step 1 pick the
// destination (Discord, Reddit pending, X, Bluesky, LinkedIn, Mastodon), step 2 edit the stored per-type
// template with a LIVE preview (the SAME pure renderTemplate the Worker uses, so preview equals post),
// pick the Discord channel (real names, PRE-selected from the item's category mapping), then publish via
// POST /api/syndicate-now (direct post + a tracker record). A prior send shows a warning line but never
// blocks (owner-decided: re-shares are sometimes the point).
//
// Attributes: data-gbti-type (post|product|prompt|share), data-gbti-slug (share: "<author>/<id>"),
// data-gbti-author, data-gbti-title, data-gbti-url (absolute), data-gbti-category (RAW top-level taxonomy
// key or a share's flat topic), data-gbti-image (optional).
import { GbtiElement, define, esc } from '../base.mjs';
import { renderTemplate, renderBodyTemplate, recordDestinations } from '../../../membership/syndication-format.mjs';
import { channelForCategoryPath } from '../../../membership/news-channels.mjs';

const DEST_LABEL = { discord: 'Discord', reddit: 'Reddit', devto: 'dev.to', hashnode: 'Hashnode', dailydev: 'daily.dev', x: 'X', bluesky: 'Bluesky', linkedin: 'LinkedIn', mastodon: 'Mastodon' };
// SOW-137 follow-up: dev.to + Hashnode cross-post the FULL article body, so the "Message template" field is
// actually the article TITLE (fed to the adapter as the title; the body is the fetched article + byline + CTA).
// dev.to is the only API-driven full-body channel left; Hashnode is now manual-assist (a Social Queue task), so
// it uses the normal message-template field like X / LinkedIn / daily.dev.
const FULL_BODY_DESTS = new Set(['devto']);

// Cloudflare KV's list() is eventually consistent, so a JUST-posted record can be missing from the tracker
// read for a minute or more (hit live 2026-07-20: a fresh Reddit post showed no badge on reopen while the
// older Discord sends did). Successful sends are remembered locally too and merged into the history until
// the tracker carries them, so the destination badge and the prior-send warning always reflect a post that
// just happened. Entries prune themselves once covered, or after seven days.
const LOCAL_SENDS_KEY = 'gbti-synd-local-sends';
const LOCAL_SENDS_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const localSendsAll = () => { try { const a = JSON.parse(localStorage.getItem(LOCAL_SENDS_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const localSendsSave = (list) => { try { localStorage.setItem(LOCAL_SENDS_KEY, JSON.stringify(list.slice(-50))); } catch { /* private mode */ } };

const CSS = `
  :host { display:block; }
  .snbtn { display:block; width:100%; font:inherit; font-weight:700; font-size:13px; padding:9px 14px; border:1.5px solid var(--line); border-radius:0; background:var(--panel); color:var(--fg); cursor:pointer; margin:0 0 14px; }
  .snbtn:hover { border-color:var(--accent); color:var(--accent); }
  .overlay { position:fixed; inset:0; background:rgba(10,12,11,.62); z-index:60; display:flex; align-items:center; justify-content:center; }
  .panel { width:min(560px, calc(100% - 32px)); max-height:calc(100vh - 48px); overflow-y:auto; background:var(--bg, #16181a); color:var(--fg); border:1.5px solid var(--line); border-radius:12px; padding:18px 20px; }
  .panel h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:17px; }
  .sub { color:var(--muted); font-size:12.5px; margin:0 0 14px; }
  .tiles { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; }
  .tile { font:inherit; font-weight:700; font-size:13px; padding:14px 10px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); cursor:pointer; text-align:center; }
  .tile:hover:not([disabled]) { border-color:var(--accent); color:var(--accent); }
  .tile[disabled] { opacity:.45; cursor:default; }
  .tile .why { display:block; font-weight:400; font-size:10.5px; color:var(--muted); margin-top:4px; }
  .tile .sentb { display:block; font-weight:600; font-size:10.5px; color:#d8a13d; margin-top:4px; }
  .info { color:var(--muted); font-size:12.5px; margin-top:10px; }
  label { display:block; font-size:12px; font-weight:600; color:var(--muted); margin:12px 0 4px; }
  textarea, select { width:100%; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  textarea { min-height:74px; font-family:var(--font-mono, monospace); font-size:12.5px; }
  .preview { border:1.5px dashed var(--line); border-radius:8px; padding:10px 12px; font-size:13px; white-space:pre-wrap; word-break:break-word; background:var(--hover, rgba(0,0,0,.15)); }
  .warn { color:#d8a13d; font-size:12.5px; margin-top:10px; }
  .err { color:#e06c6c; font-size:12.5px; margin-top:10px; }
  .okmsg { color:var(--accent); font-size:13px; margin-top:10px; }
  .okmsg a { color:var(--accent); }
  .actions { display:flex; justify-content:space-between; align-items:center; gap:10px; margin-top:16px; }
  .go { font:inherit; font-weight:700; font-size:13.5px; padding:9px 18px; border:0; border-radius:10px; background:var(--brand); color:#fff; cursor:pointer; }
  .go[disabled] { opacity:.55; cursor:default; }
  .ghost { font:inherit; font-size:13px; padding:8px 14px; border:1.5px solid var(--line); border-radius:10px; background:transparent; color:var(--muted); cursor:pointer; }
  .ghost:hover { color:var(--fg); }
  .spin { display:inline-block; width:12px; height:12px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:sn-spin .7s linear infinite; vertical-align:-1px; margin-right:7px; }
  @keyframes sn-spin { to { transform:rotate(360deg); } }
`;

class GbtiSyndicateNow extends GbtiElement {
  render() {
    if (!this.client) { this.set(''); return; }
    if (this._role === undefined && !this._loading) { this._loading = true; this._gate(); }
    if (this._role !== 'superadmin') { this.set(''); return; }
    this.set(this.css(CSS) + `<button class="snbtn" type="button">Manually Syndicate</button>${this._open ? this._modalHtml() : ''}`);
    this.on('.snbtn', 'click', () => { this._open = true; this._step = 'dest'; this._result = null; this._err = null; this.render(); this._loadInfo(); });
    if (this._open) this._wireModal();
  }

  async _gate() {
    try {
      const st = await this.client.status();
      this._role = st?.role || 'member';
      // SOW-143 follow-up: the signed-in viewer's username, to decide when the Discord-mention preview
      // placeholder is safe to show (only for the viewer's OWN content, where we can confirm their link status).
      this._me = String(st?.identity?.username || st?.identity?.login || '').toLowerCase();
    } catch { this._role = 'member'; this._me = ''; }
    this._loading = false;
    this.render();
  }

  _item() {
    const d = this.dataset || {};
    return {
      source: d.gbtiType || '',
      targetSlug: d.gbtiSlug || '',
      targetType: d.gbtiType || '',
      author: d.gbtiAuthor || '',
      authorName: d.gbtiAuthorName || undefined, // SOW-088 {fullName}: the profile displayName (else @login)
      title: d.gbtiTitle || '',
      blurb: d.gbtiBlurb || undefined, // SOW-088 {short-description}: the item's shortDescription
      url: d.gbtiUrl || '',
      image: d.gbtiImage || undefined,
      category: d.gbtiCategory || undefined,
      categoryPath: d.gbtiCategoryPath ? d.gbtiCategoryPath.split(',').filter(Boolean) : undefined, // SOW-088: leaf-first routing
      authorDiscord: d.gbtiDiscord || undefined, // SOW-088: the public profile Discord handle
      authorX: d.gbtiX || undefined, // SOW-120: the public profile X handle ({member-x-handle})
      authorBluesky: d.gbtiBluesky || undefined, // SOW-122: the public profile Bluesky handle ({member-bluesky-handle})
      authorMastodon: d.gbtiMastodon || undefined, // SOW-123: the public profile Mastodon handle ({member-mastodon-handle})
      authorReddit: d.gbtiReddit || undefined, // the public profile Reddit username ({member-reddit-handle})
      authorDevto: d.gbtiDevto || undefined, // SOW-140: the public profile dev.to handle ({member-devto-handle})
      tags: d.gbtiTags ? d.gbtiTags.split(',').map((t) => t.trim()).filter(Boolean) : undefined, // SOW-120: {tags-hashtags}
      authorNote: this._authorNote || undefined, // SOW-088 {author-note}: the from-the-author intro comment
      visibility: d.gbtiVisibility === 'members' ? 'members' : 'public', // SOW-088 Proposal A: drives the STUB template set
    };
  }

  async _loadInfo() {
    try {
      const it0 = this._item();
      const [info, queue, thread] = await Promise.all([
        this.client.getSyndicateNow(),
        this.client.syndicationQueue().catch(() => null),
        // The {author-note} token: the from-the-author intro comment (public, flagged authorNote).
        this.client.listComments({ targetType: it0.targetType, targetSlug: it0.targetSlug }).catch(() => null),
      ]);
      this._info = info;
      const note = (thread?.items ?? thread?.comments ?? []).find((c) => c?.authorNote && typeof c.body === 'string' && c.body.trim());
      this._authorNote = note ? note.body.trim() : null;
      // SOW-143 follow-up: is the signed-in viewer's Discord linked (discord_user_id on their Stripe customer)?
      // The Discord mention resolves from that SAME field server-side, so a linked viewer syndicating their OWN
      // content WILL be @mentioned at post. Cache it so the preview can show an honest placeholder instead of
      // the name fallback. Fail-soft to not-linked (the preview then just shows the real fallback).
      try { this._discordLinked = Boolean((await this.client.discordLinkStatus?.())?.linked); }
      catch { this._discordLinked = false; }
      const key = `${this._item().source}:${this._item().targetSlug}`;
      const prior = [...(queue?.sent ?? []), ...(queue?.failed ?? [])].filter((it) => (it.id || '').startsWith(key + '#'));
      this._prior = prior.filter((it) => it.status === 'sent');
      this._mergeLocalSends(key);
    } catch (err) {
      this._err = err?.message || 'Could not load the syndication destinations.';
    }
    this.render();
  }

  /** Merge the locally-remembered sends for this item into _prior (KV list-lag cover, see LOCAL_SENDS_KEY);
   *  a local entry the tracker now carries is pruned, so the memory converges to the server record. */
  _mergeLocalSends(key) {
    const now = Date.now();
    const all = localSendsAll().filter((s) => s && typeof s === 'object' && now - (s.at || 0) < LOCAL_SENDS_MAX_AGE);
    const mine = all.filter((s) => s.key === key);
    if (!mine.length) { localSendsSave(all); return; }
    const covered = (s) => (this._prior || []).some((rec) => {
      const at = rec.sentAt || rec.enqueuedAt || 0;
      return recordDestinations(rec).has(s.dest) && at >= (s.at || 0) - 120000;
    });
    const still = [];
    for (const s of mine) {
      if (covered(s)) continue; // the tracker caught up; drop the local copy
      still.push(s);
      this._prior = [...(this._prior || []), { status: 'sent', sentAt: s.at, trigger: 'manual', manualBy: 'local', channels: { [s.dest]: { status: 'sent' } } }];
    }
    localSendsSave([...all.filter((s) => s.key !== key), ...still]);
  }

  _modalHtml() {
    const body = !this._info && !this._err
      ? `<p class="sub"><span class="spin"></span>Loading destinations…</p>`
      : this._err && !this._info
        ? `<p class="err">${esc(this._err)}</p>`
        : this._step === 'dest' ? this._destHtml() : this._composeHtml();
    return `<div class="overlay" data-overlay><div class="panel">
      <h3>Manually Syndicate</h3>
      <p class="sub">${esc(this._item().title || this._item().targetSlug)}</p>
      ${body}
    </div></div>`;
  }

  /** Per-DESTINATION send history from the tracker records: destination -> { count, last, manual }.
   *  Derived from each record's channels map keys (`discord:<id>` / `discord-forward:<id>` / `reddit` ...),
   *  so "already syndicated" can say WHERE it went and by WHAT (a manual post vs the auto pipeline). */
  _destSends() {
    const map = {};
    for (const rec of this._prior || []) {
      const at = rec.sentAt || rec.enqueuedAt || 0;
      const manual = rec.trigger === 'manual' || !!rec.manualBy;
      const dests = recordDestinations(rec);
      for (const d of dests) {
        const cur = map[d] || { count: 0, last: 0, manual: false };
        map[d] = { count: cur.count + 1, last: Math.max(cur.last, at), manual: cur.manual || manual };
      }
    }
    return map;
  }

  _sendPhrase(d, s) {
    return `${DEST_LABEL[d] || d} ${s.count === 1 ? 'once' : `${s.count} times`} (${s.manual ? 'manually' : 'by the auto pipeline'}, last ${esc(new Date(s.last).toLocaleString())})`;
  }

  _destHtml() {
    const sends = this._destSends();
    const tiles = (this._info?.destinations ?? []).map((d) => {
      const label = DEST_LABEL[d.id] || d.id;
      const s = sends[d.id];
      const badge = s ? `<span class="sentb">sent ${esc(new Date(s.last).toLocaleDateString())}${s.manual ? ' (manual)' : ''}</span>` : '';
      // dev.to crossposts the FULL article body, so a share (no article) cannot go there.
      const shareBlocked = d.id === 'devto' && this._item().source === 'share';
      return d.ready && !shareBlocked
        ? `<button class="tile" type="button" data-dest="${esc(d.id)}">${esc(label)}${badge}</button>`
        : `<button class="tile" type="button" disabled>${esc(label)}<span class="why">${esc(shareBlocked ? 'content items only' : (d.reason || 'not available'))}</span>${badge}</button>`;
    }).join('');
    const sent = Object.keys(sends);
    const prior = sent.length
      ? `<p class="warn">Already posted to ${sent.map((d) => this._sendPhrase(d, sends[d])).join('; ')}.</p><p class="info">Destinations without a badge have not received this item yet.</p>`
      : '';
    return `<label>Destination</label><div class="tiles">${tiles}</div>${prior}
      <div class="actions"><button class="ghost" type="button" data-close>Cancel</button><span></span></div>`;
  }

  /** The template that WILL be sent: an explicit edit, else the per-destination default. ONE definition
   *  shared by the compose view and _publish (they diverged once: the preview said {title} while publish
   *  fell back to the stored per-type template, so a Reddit send ignored what the preview showed). */
  _effectiveTemplate() {
    // SOW-088: the destination's own channel-template override wins, then the shared per-type map, then
    // the per-destination built-in ({title} reads natural as a Reddit post title).
    const src = this._item().source;
    // Reddit/dev.to titles resolve CHANNEL-scoped only (the shared per-type map is Discord-voiced and
    // must never become a post title; adversarial finding): channel stub override -> the channel's
    // built-in stub -> channel public override -> {title}.
    if (this._dest === 'reddit' || this._dest === 'devto') {
      const stub = this._isStub()
        ? (this._info?.channelTemplatesStub?.[this._dest]?.[src] || this._info?.stubDefaults?.[this._dest]?.[src] || '')
        : '';
      const pub = this._info?.channelTemplates?.[this._dest]?.[src] || '';
      return this._template ?? (stub || pub || '{title}');
    }
    const stored = this._stored(this._dest, src);
    return this._template ?? (stored || '{title} {url}');
  }

  _isStub() { return this._item().visibility === 'members'; }

  /** The ADMIN-stored template for a channel key, stub-aware: for a members item the STUB chain runs
   *  first (channel stub -> shared stub -> the built-in stub maps served by the GET), then the public
   *  chain (mirroring templateFor in the core). */
  _stored(channel, key) {
    if (this._isStub()) {
      const stub = this._info?.channelTemplatesStub?.[channel]?.[key]
        || this._info?.stubTemplates?.[key]
        || this._info?.stubDefaults?.[channel]?.[key]
        || this._info?.stubDefaults?.['']?.[key]
        || '';
      if (stub) return stub;
    }
    return this._info?.channelTemplates?.[channel]?.[key] || this._info?.templates?.[key] || '';
  }

  /** The reddit-key resolver, guarded so a template referencing {author-note} never pre-fills for a
   *  no-intro item (empty quotes read broken). */
  _redditStored(key) {
    const tpl = this._stored('reddit', key);
    return tpl && (this._authorNote || !/\{author-note(-italic)?\}/.test(tpl)) ? tpl : '';
  }

  /** The Reddit BODY template (the DESCRIPTION under the title; the embed card comes from the item URL):
   *  an explicit edit wins, else the stored reddit-body template. A text post appends the link when the
   *  template lacks {url}, since the body is the whole post there. */
  _effectiveBody() {
    if (this._bodyTemplate != null) return this._bodyTemplate;
    const tpl = this._redditStored('reddit-body');
    if (tpl) return tpl + (this._redditKind === 'self' && !/\{url\}/.test(tpl) ? '\n\n{url}' : '');
    return this._redditKind === 'self' ? '{url}' : '';
  }

  /** The separately-templated FIRST COMMENT (owner-directed): an explicit edit wins, else the stored
   *  reddit-comment template; blank = no comment is posted. */
  _effectiveComment() {
    if (this._commentTemplate != null) return this._commentTemplate;
    return this._redditStored('reddit-comment');
  }

  /** The dev.to BYLINE prepended to the crosspost: an edit wins, else the stored devto-intro. */
  _effectiveDevtoIntro() {
    if (this._devtoIntroTemplate != null) return this._devtoIntroTemplate;
    return this._stored('devto', 'devto-intro');
  }

  /** The STUB middle for a members item on dev.to: an edit wins, else the stored devto-stub chain. */
  _effectiveDevtoStub() {
    if (this._devtoStubTemplate != null) return this._devtoStubTemplate;
    return this._stored('devto', 'devto-stub');
  }

  /** The CTA FOOTER appended to every dev.to post (full and stub): an edit wins, else the stored devto-footer. */
  _effectiveDevtoFooter() {
    if (this._devtoFooterTemplate != null) return this._devtoFooterTemplate;
    return this._stored('devto', 'devto-footer');
  }

  /** The PUBLIC BODY template for a dev.to crosspost (SOW-138): an edit wins, else the stored devto-body,
   *  else the built-in {body} (the article verbatim). Members items post the stub, not this. */
  _effectiveDevtoBody() {
    if (this._devtoBodyTemplate != null) return this._devtoBodyTemplate;
    return this._stored('devto', 'devto-body') || '{body}';
  }

  _composeHtml() {
    const dest = this._dest;
    const item = this._item();
    // Reddit renders the template as the POST TITLE; a plain {title} reads natural there.
    const template = this._effectiveTemplate();
    // SOW-143 follow-up: for a Discord post, the {member-discord-username} / {memberdiscord} tokens resolve to a
    // real <@id> mention SERVER-SIDE at publish, which the browser cannot show (it falls back to the name and
    // reads like a bug). Show an honest placeholder ONLY when we can confirm it will resolve: the item's author
    // is the signed-in viewer AND their Discord is linked. For anyone else's content, or an unlinked viewer, the
    // preview keeps the real fallback (which honestly signals "not linked").
    const authorIsMe = this._me && String(item.author || '').toLowerCase() === this._me;
    const previewMention = (dest === 'discord' && authorIsMe && this._discordLinked) ? '[you will be @mentioned on Discord]' : null;
    const preview = renderTemplate(template, item, { limit: 2000, previewMention });
    let channelRow = '';
    if (dest === 'discord') {
      const groups = new Map();
      for (const c of this._channels || []) {
        const sec = c.section || 'Channels';
        if (!groups.has(sec)) groups.set(sec, []);
        groups.get(sec).push(c);
      }
      const selected = this._channelId || '';
      const opts = [...groups.entries()].map(([sec, list]) =>
        `<optgroup label="${esc(sec)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === selected ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
      // When the name list is unavailable the picker degrades to a manual channel-id input, never a dead end.
      const fwdSelected = this._forwardId ?? '';
      const fwdOpts = `<option value=""${fwdSelected ? '' : ' selected'}>Do not forward</option>` + [...groups.entries()].map(([sec, list]) =>
        `<optgroup label="${esc(sec)}">${list.map((c) => `<option value="${esc(c.id)}"${c.id === fwdSelected ? ' selected' : ''}>#${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
      const preNote = this._preselectedNote === 'featured'
        ? ` <span style="font-weight:400">(pre-selected: the featured ${esc(item.source)} channel)</span>`
        : this._preselectedNote === 'category' ? ` <span style="font-weight:400">(pre-selected from the ${esc(item.category || '')} category)</span>` : '';
      channelRow = opts
        ? `<label>Channel${preNote}</label>
          <select data-channel>${opts}</select>
          <label>Forward to <span style="font-weight:400">(a secondary channel gets the Discord FORWARD of the original post${this._forwardNote ? `; pre-selected from the deepest mapped category` : ''})</span></label>
          <select data-forward>${fwdOpts}</select>`
        : `<label>Channel id <span style="font-weight:400">(the channel list did not load${this._chErr ? `: ${esc(this._chErr)}` : ''}; paste the Discord channel id)</span></label>
          <input data-channel-manual type="text" inputmode="numeric" placeholder="e.g. 1180150623346372638" value="${esc(this._channelId || '')}" style="width:100%;box-sizing:border-box;font:inherit;font-size:13px;padding:8px 10px;border:1.5px solid var(--line);border-radius:8px;background:var(--panel);color:var(--fg)" />`;
    }
    // Reddit (Radle-style): a post-kind picker (link | text) and an optional templated BODY. A link post
    // carries the item URL as the link (the body rides under it); a text post's body IS the content.
    let redditRows = '';
    if (dest === 'reddit') {
      const kind = this._redditKind || 'link';
      const bodyTemplate = this._effectiveBody();
      const bodyPreview = bodyTemplate ? renderTemplate(bodyTemplate, item, { limit: 2000 }) : '';
      const commentTemplate = this._effectiveComment();
      const commentPreview = commentTemplate ? renderTemplate(commentTemplate, item, { limit: 2000 }) : '';
      redditRows = `<label>Post kind</label>
        <select data-reddit-kind>
          <option value="link"${kind === 'link' ? ' selected' : ''}>Link post (the item URL is the link)</option>
          <option value="self"${kind === 'self' ? ' selected' : ''}>Text post (the body below is the content)</option>
        </select>
        <label>Body template <span style="font-weight:400">(the description under the title; optional; same tokens as the title)</span></label>
        <textarea data-reddit-body>${esc(bodyTemplate)}</textarea>
        <label>Body preview</label>
        <div class="preview" data-reddit-body-preview>${esc(bodyPreview)}</div>
        <label>First comment template <span style="font-weight:400">(optional; posts as the brand account's first comment; blank = none)</span></label>
        <textarea data-reddit-comment>${esc(commentTemplate)}</textarea>
        <label>Comment preview</label>
        <div class="preview" data-reddit-comment-preview>${esc(commentPreview)}</div>`;
    }
    let devtoRows = '';
    if (dest === 'devto') {
      const introTemplate = this._effectiveDevtoIntro();
      const introPreview = introTemplate ? renderTemplate(introTemplate, item, { limit: 800 }) : '';
      const footerTemplate = this._effectiveDevtoFooter();
      const footerPreview = footerTemplate ? renderTemplate(footerTemplate, item, { limit: 1200 }) : '';
      const stubRows = this._isStub()
        ? (() => {
            const stubTemplate = this._effectiveDevtoStub();
            const stubPreview = stubTemplate ? renderTemplate(stubTemplate, item, { limit: 1200 }) : '';
            return `<label>Stub template <span style="font-weight:400">(the members-only teaser body; markdown; same tokens)</span></label>
        <textarea data-devto-stub>${esc(stubTemplate)}</textarea>
        <label>Stub preview</label>
        <div class="preview" data-devto-stub-preview>${esc(stubPreview)}</div>`;
          })()
        : '';
      // SOW-138: the PUBLIC body is editable ({body} = the full article verbatim; a members item posts the
      // stub instead, so no body field there). The preview shows a [full article body] placeholder because the
      // real article is fetched server-side at send time.
      const bodyRows = this._isStub()
        ? ''
        : (() => {
            const bodyTemplate = this._effectiveDevtoBody();
            const bodyPreview = renderBodyTemplate(bodyTemplate, item, '[the full article body]');
            return `<label>Body template <span style="font-weight:400">({body} = the full article verbatim; wrap it or replace it; markdown; same tokens)</span></label>
        <textarea data-devto-body>${esc(bodyTemplate)}</textarea>
        <label>Body preview</label>
        <div class="preview" data-devto-body-preview>${esc(bodyPreview)}</div>`;
          })();
      devtoRows = `${this._isStub() ? '<p class="warn">Members-only item: the STUB templates apply (description + link, never the body).</p>' : ''}
        <label>Byline template <span style="font-weight:400">(prepended to the article; markdown; same tokens)</span></label>
        <textarea data-devto-intro>${esc(introTemplate)}</textarea>
        <label>Byline preview</label>
        <div class="preview" data-devto-intro-preview>${esc(introPreview)}</div>
        ${bodyRows}
        <label>CTA footer template <span style="font-weight:400">(appended to the post; markdown; same tokens)</span></label>
        <textarea data-devto-footer>${esc(footerTemplate)}</textarea>
        <label>CTA preview</label>
        <div class="preview" data-devto-footer-preview>${esc(footerPreview)}</div>
        ${stubRows}
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" data-devto-draft style="width:auto"${this._devtoDraft ? ' checked' : ''} /> Create as a dev.to DRAFT first (publish from the dev.to dashboard)</label>`;
    }
    const liNote = dest === 'linkedin'
      ? `<p class="sub" style="margin:8px 0 0">Posts as the GBTI organization page. The item link becomes a rich article card automatically; the text above is the commentary.</p>`
      : dest === 'reddit'
        ? `<p class="sub" style="margin:8px 0 0">Posts to the community subreddit as ${this._redditKind === 'self' ? 'a TEXT post: the title template above (300 characters max) plus the body below' : 'a LINK: the title template above becomes the Reddit post title (300 characters max); an optional body posts as the link post body'}.</p>`
        : dest === 'devto'
          ? `<p class="sub" style="margin:8px 0 0">Posts to dev.to under the GBTI organization with a canonical link back to gbti.network: a PUBLIC item crossposts in full; a members-only item posts only its description plus a read-it-on-gbti.network link. The CTA footer is appended either way.</p>` : '';
    // Destination-SPECIFIC prior-send messaging: a duplicate warning only when THIS destination already
    // got the item; otherwise an informational note so a Discord-only history never scares a Reddit send.
    const sends = this._destSends();
    const here = sends[dest];
    const elsewhere = Object.keys(sends).filter((d) => d !== dest);
    const prior = here
      ? `<p class="warn">Already posted to ${this._sendPhrase(dest, here)}. Publishing again posts a duplicate there.</p>`
      : elsewhere.length
        ? `<p class="info">Not posted to ${esc(DEST_LABEL[dest] || dest)} yet. Previously posted to ${elsewhere.map((d) => this._sendPhrase(d, sends[d])).join('; ')}.</p>`
        : '';
    const cmtState = this._result?.comment
      ? (this._result.comment.error ? ` The first comment failed: ${esc(this._result.comment.error)}.` : ' The first comment posted.')
      : '';
    const fwdState = this._result?.forwarded
      ? (this._result.forwarded.error ? ` Forward failed: ${esc(this._result.forwarded.error)}.` : ' Forwarded to the secondary channel.')
      : '';
    const result = this._result
      ? `<p class="okmsg">${this._result.queued ? 'Queued to the Social Queue. Open it from your avatar menu to post it by hand (this channel is manual-assist, so nothing is charged).' : this._result.draft ? `Draft created. <a href="https://dev.to/dashboard" target="_blank" rel="noopener">Review it on the dev.to dashboard</a> (a draft's direct URL 404s until it publishes).` : `Posted.${this._result.url ? ` <a href="${esc(this._result.url)}" target="_blank" rel="noopener">Open the post</a>` : ''}`}${fwdState}${cmtState}</p>`
      : '';
    const stubNote = this._isStub() && dest !== 'devto'
      ? `<p class="warn">Members-only item: the STUB template set applies on this channel.</p>` : '';
    return `<label>Destination</label><p class="sub" style="margin:0">${esc(DEST_LABEL[dest] || dest)} <button class="ghost" type="button" data-back style="padding:2px 10px;font-size:11.5px;margin-left:8px">change</button></p>
      ${stubNote}
      ${FULL_BODY_DESTS.has(dest)
        ? `<label>Article title <span style="font-weight:400">(${esc(DEST_LABEL[dest] || dest)} cross-posts the FULL article body: this field is ONLY the post title, not the body. The body is the whole article, wrapped by the byline and CTA footer below. {title} {content-type} {category}; CAPS a token to uppercase it: {CONTENT-TYPE})</span></label>`
        : `<label>Message template <span style="font-weight:400">({title} {url} {content-type} {member-discord-username} {author} {fullName} {category} {author-note} {author-note-italic} {member-url} {short-description} {category-hashtag} {tags-hashtags} {hashtags} {member-x-handle} {member-bluesky-handle} {member-mastodon-handle} {member-reddit-handle}; CAPS a token to uppercase it: {CONTENT-TYPE})</span></label>`}
      <textarea data-template>${esc(template)}</textarea>
      <label>${FULL_BODY_DESTS.has(dest) ? 'Title preview' : 'Preview'}</label>
      <div class="preview" data-preview>${esc(preview)}</div>
      ${channelRow}${redditRows}${devtoRows}${liNote}${prior}${this._err ? `<p class="err">${esc(this._err)}</p>` : ''}${result}
      <div class="actions">
        <button class="ghost" type="button" data-close>${this._result ? 'Done' : 'Cancel'}</button>
        <button class="go" type="button" data-publish ${this._busy || this._result ? 'disabled' : ''}>${this._busy ? '<span class="spin"></span>Publishing...' : 'Publish'}</button>
      </div>`;
  }

  _wireModal() {
    this.on('[data-close]', 'click', () => { this._open = false; this._template = null; this._err = null; this.render(); });
    this.on('[data-back]', 'click', () => { this._step = 'dest'; this._err = null; this._result = null; this.render(); });
    this.$$('[data-dest]').forEach((b) => b.addEventListener('click', () => this._pickDest(b.dataset.dest)));
    const ta = this.$('[data-template]');
    if (ta) ta.addEventListener('input', () => {
      this._template = ta.value;
      const pv = this.$('[data-preview]');
      if (pv) pv.textContent = renderTemplate(ta.value, this._item(), { limit: 2000 });
    });
    const sel = this.$('[data-channel]');
    if (sel) sel.addEventListener('change', () => { this._channelId = sel.value; });
    const manual = this.$('[data-channel-manual]');
    if (manual) manual.addEventListener('input', () => { this._channelId = manual.value.trim(); });
    const fwd = this.$('[data-forward]');
    if (fwd) fwd.addEventListener('change', () => { this._forwardId = fwd.value; });
    const rk = this.$('[data-reddit-kind]');
    if (rk) rk.addEventListener('change', () => { this._redditKind = rk.value === 'self' ? 'self' : 'link'; this.render(); });
    const rb = this.$('[data-reddit-body]');
    if (rb) rb.addEventListener('input', () => {
      this._bodyTemplate = rb.value;
      const pv = this.$('[data-reddit-body-preview]');
      if (pv) pv.textContent = rb.value ? renderTemplate(rb.value, this._item(), { limit: 2000 }) : '';
    });
    const di = this.$('[data-devto-intro]');
    if (di) di.addEventListener('input', () => {
      this._devtoIntroTemplate = di.value;
      const pv = this.$('[data-devto-intro-preview]');
      if (pv) pv.textContent = di.value ? renderTemplate(di.value, this._item(), { limit: 800 }) : '';
    });
    const db = this.$('[data-devto-body]');
    if (db) db.addEventListener('input', () => {
      this._devtoBodyTemplate = db.value;
      const pv = this.$('[data-devto-body-preview]');
      // {body} previews as a placeholder (the real article is fetched server-side at send).
      if (pv) pv.textContent = renderBodyTemplate(db.value, this._item(), '[the full article body]');
    });
    const df = this.$('[data-devto-footer]');
    if (df) df.addEventListener('input', () => {
      this._devtoFooterTemplate = df.value;
      const pv = this.$('[data-devto-footer-preview]');
      if (pv) pv.textContent = df.value ? renderTemplate(df.value, this._item(), { limit: 1200 }) : '';
    });
    const ds = this.$('[data-devto-stub]');
    if (ds) ds.addEventListener('input', () => {
      this._devtoStubTemplate = ds.value;
      const pv = this.$('[data-devto-stub-preview]');
      if (pv) pv.textContent = ds.value ? renderTemplate(ds.value, this._item(), { limit: 1200 }) : '';
    });
    const dd = this.$('[data-devto-draft]');
    if (dd) dd.addEventListener('change', () => { this._devtoDraft = dd.checked; });
    const rc = this.$('[data-reddit-comment]');
    if (rc) rc.addEventListener('input', () => {
      this._commentTemplate = rc.value;
      const pv = this.$('[data-reddit-comment-preview]');
      if (pv) pv.textContent = rc.value ? renderTemplate(rc.value, this._item(), { limit: 2000 }) : '';
    });
    this.on('[data-publish]', 'click', () => this._publish());
  }

  async _pickDest(dest) {
    if (dest !== this._dest) { this._template = null; this._bodyTemplate = null; this._commentTemplate = null; this._devtoIntroTemplate = null; this._devtoBodyTemplate = null; this._devtoFooterTemplate = null; this._devtoStubTemplate = null; this._devtoDraft = false; this._redditKind = 'link'; } // per-destination defaults; an edit never leaks across
    this._dest = dest;
    this._step = 'compose';
    this._err = null;
    this._result = null;
    if (dest === 'discord' && !this._channels) {
      try {
        const r = await this.client.discordChannels();
        const all = r?.channels ?? [];
        const sections = new Map(all.filter((c) => c.type === 4).map((c) => [c.id, c.name]));
        this._channels = all
          .filter((c) => c.type === 0 || c.type === 5)
          .map((c) => ({ ...c, section: sections.get(c.parentId) || 'Channels' }));
        this._chErr = null;
      } catch (err) { this._channels = []; this._chErr = err?.message || 'request failed'; }
      // Owner-decided default: the per-type FEATURED channel (#prompts for a prompt, etc.); the
      // category-mapped channel stays one click away in the same picker.
      // Leaf-first: the deepest mapped key on the item's full taxonomy path wins (skill -> #devops beats
      // the broad ai row), so per-leaf mappings set in the categories workspace drive the forward default.
      const it0 = this._item();
      const mapped = channelForCategoryPath({ channels: this._info?.channelMap ?? [] }, it0.categoryPath?.length ? it0.categoryPath : [it0.category]);
      const featured = this._info?.featured?.[this._item().source] || null;
      this._channelId = featured || mapped || this._channels[0]?.id || '';
      this._preselectedNote = featured ? 'featured' : (mapped ? 'category' : '');
      // The secondary FORWARD defaults to the category-mapped channel when it differs from the primary.
      this._forwardId = mapped && mapped !== this._channelId ? mapped : '';
      this._forwardNote = Boolean(this._forwardId);
    }
    this.render();
  }

  async _publish() {
    const item = this._item();
    const template = this._effectiveTemplate().trim();
    if (!template) { this._err = 'A message template is required.'; this.render(); return; }
    this._busy = true; this._err = null; this.render();
    try {
      const payload = { destination: this._dest, item, template };
      if (this._dest === 'reddit') {
        payload.redditKind = this._redditKind === 'self' ? 'self' : 'link';
        const body = this._effectiveBody().trim();
        if (body) payload.bodyTemplate = body;
        const comment = this._effectiveComment().trim();
        if (comment) payload.commentTemplate = comment;
      }
      if (this._dest === 'devto') {
        const intro = this._effectiveDevtoIntro().trim();
        if (intro) payload.devtoIntroTemplate = intro;
        const footer = this._effectiveDevtoFooter().trim();
        if (footer) payload.devtoFooterTemplate = footer;
        const stubT = this._isStub() ? this._effectiveDevtoStub().trim() : '';
        if (stubT) payload.devtoStubTemplate = stubT;
        // SOW-138: the public body template (RAW; {body} resolves in the adapter). Members items post the stub.
        const bodyT = this._isStub() ? '' : this._effectiveDevtoBody().trim();
        if (bodyT) payload.devtoBodyTemplate = bodyT;
        if (this._devtoDraft) payload.devtoDraft = true;
      }
      if (this._dest === 'discord') {
        payload.channelId = this._channelId;
        if (this._forwardId && this._forwardId !== this._channelId) payload.forwardChannelId = this._forwardId;
      }
      this._result = await this.client.syndicateNow(payload);
      this._prior = [...(this._prior || []), { status: 'sent', sentAt: Date.now(), trigger: 'manual', channels: { [this._dest]: { status: 'sent' } } }];
      // Remember the send locally so a reopened modal badges it even while the KV list lags the write.
      localSendsSave([...localSendsAll(), { key: `${item.source}:${item.targetSlug}`, dest: this._dest, at: Date.now() }]);
    } catch (err) {
      this._err = err?.message || 'The post failed.';
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-syndicate-now', GbtiSyndicateNow);
export { GbtiSyndicateNow };
