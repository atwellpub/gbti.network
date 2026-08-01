// <gbti-reader> (SOW-031): the in-extension reading view. Opens a post/product/prompt/share item and renders it
// IN the extension (markdown -> HTML via client.preview) instead of navigating to gbti.network. Body resolution
// follows the gbti-shares-feed / gbti-locked-content contract VERBATIM: a public body renders via preview; a
// members body (Mode B whole body or Mode C tail) decrypts via client.decrypt (the AES key never leaves the
// Worker, SOW-016) then renders via preview; a non-entitled member sees the upgrade notice. Host-agnostic
// (consumes only the injected client). Honest limit: this is the CMS markdown renderer, not the full Astro
// pipeline, so "View on gbti.network" stays in the article for pixel-perfect / interactive parity.
//
// SOW-050 redesign: a two-column reading layout (article + a right author drawer) that collapses to one column
// below 960px. The hero cover uses the full-resolution `thumbWide` derivative, rendered width-contained (no crop
// = no clipping). The meta row leads with the author avatar + category chips. The right drawer carries the author
// card (avatar, name, the headline "author note"), a Follow control, the author's public social links (Discord
// revealed on inspection), and the discussion thread beneath it. Fenced code blocks upgrade into code cards with
// a language label + Copy button.
import { GbtiElement, define, esc } from '../base.mjs';
import { resolveAsset, resolveMarkdownAssets } from '../assets.mjs';
import './gbti-discussion.mjs'; // SOW-041: the always-open discussion, now mounted inside the author drawer
import './gbti-upvote.mjs'; // SOW-057: the share upvote control
import './gbti-favorite.mjs'; // SOW-013/064: favorite + add-to-collection on the reader meta line
import './gbti-collection.mjs';
import './gbti-mod-actions.mjs'; // SOW-071: per-item moderation (Hide/Unhide/Remove) for moderator+
import { hostOf } from '../all-merge.mjs'; // SOW-057: the link domain for the "Read article on <domain>" CTA
import { utmLink, UTM } from '../news.mjs'; // sow-145: UTM attribution on outbound share links
import { faviconFor } from './gbti-card-list.mjs'; // owner QA 2026-07-22: the share source favicon (meta stack + side card)
import { loadMembersDirectory } from '../members-index.mjs'; // SOW-143: the shared /members-index.json loader (one cache across elements)
import { socialIcon } from '../social-icons.mjs'; // SOW-067: per-platform inline brand icons for the author card
import './gbti-syndicate-now.mjs'; // SOW-088: the superadmin Manually Syndicate control (self-gates)
import { embedUrl, isPortraitEmbed } from '../../../client/src/video-embed.mjs'; // SOW-092: the ONE shared video extractor (a share's video link plays inline)

const SITE = 'https://gbti.network';
const lc = (s) => String(s || '').toLowerCase();
const isHouse = (a) => { const x = lc(a); return !x || x === 'gbti' || x === 'house'; };
const authorName = (a) => (isHouse(a) ? 'GBTI Network' : a);
const githubLogin = (a) => (lc(a) === 'gbti' || lc(a) === 'house' ? 'gbti-network' : a);
const githubAvatar = (a) => (a ? `https://github.com/${encodeURIComponent(githubLogin(a))}.png?size=96` : '');

// SOW-041: the comment targetSlug for an item. A post/product/prompt keys on its content slug (matching the
// public Comments.astro); a Share keys on the composite "<author>/<shareId>". Empty -> no discussion is shown.
function targetSlugFor(it) {
  if (it.type === 'share') return it.author && it.id ? `${it.author}/${it.id}` : '';
  if (it.slug) return String(it.slug);
  const m = String(it.path || '').match(/\/(?:posts|products|prompts)\/([^/]+)\/index\.md$/);
  return m ? m[1] : '';
}
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', share: 'Share' };
const dateStr = (ms) => { try { return ms ? new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : ''; } catch { return ''; } };
const lockNotice = (what) => `<div class="locked">${esc(what)} is for members. <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a> to unlock.</div>`;

// SOW-129: humanize a role slug for the author card (mcp-developer -> "MCP Developer"). Short tokens uppercase.
const prettyRole = (s) => String(s || '').split(/[-_]/).filter(Boolean).map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

// SOW-050: the member directory (/members-index.json) carries the author drawer's avatar/name/headline/links.
// SOW-143: the fetch+memoize moved to the shared client-ui/src/members-index.mjs so the reader and the new
// member-detail view share ONE cache. `loadDirectory` stays as a thin local alias to minimize the reader diff.
const loadDirectory = loadMembersDirectory;

// Build a {href,label,handle?} for each known public social link. A bare handle is prefixed to a canonical URL;
// an already-absolute value passes through. Discord is a handle (not reliably linkable), so it surfaces as an
// inspectable chip (the username on the chip + its title), satisfying "make their Discord available on inspection".
const SOCIALS = [
  ['github', 'GitHub', 'https://github.com/'],
  ['website', 'Website', ''],
  ['x', 'X', 'https://x.com/'],
  ['bluesky', 'Bluesky', 'https://bsky.app/profile/'],
  ['youtube', 'YouTube', 'https://youtube.com/'],
  ['devto', 'DEV', 'https://dev.to/'],
  ['reddit', 'Reddit', 'https://reddit.com/user/'],
  ['linkedin', 'LinkedIn', 'https://linkedin.com/in/'],
  // SOW-129: the comprehensive set.
  ['instagram', 'Instagram', 'https://www.instagram.com/'],
  ['threads', 'Threads', 'https://www.threads.net/@'],
  ['tiktok', 'TikTok', 'https://www.tiktok.com/@'],
  ['twitch', 'Twitch', 'https://www.twitch.tv/'],
  ['facebook', 'Facebook', 'https://www.facebook.com/'],
  ['dailydev', 'daily.dev', 'https://app.daily.dev/'],
  ['producthunt', 'Product Hunt', 'https://www.producthunt.com/@'],
  ['rumble', 'Rumble', 'https://rumble.com/user/'],
  // SOW-131: audio, publishing, dev, and creator platforms.
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/'],
  ['mixcloud', 'Mixcloud', 'https://www.mixcloud.com/'],
  ['spotify', 'Spotify', ''],
  ['bandcamp', 'Bandcamp', ''],
  ['wordpress', 'WordPress', 'https://profiles.wordpress.org/'],
  ['substack', 'Substack', 'https://substack.com/@'],
  ['medium', 'Medium', 'https://medium.com/@'],
  ['hashnode', 'Hashnode', 'https://hashnode.com/@'],
  ['peerlist', 'Peerlist', 'https://peerlist.io/'],
  ['gitlab', 'GitLab', 'https://gitlab.com/'],
  ['stackoverflow', 'Stack Overflow', ''],
  ['patreon', 'Patreon', 'https://www.patreon.com/'],
  ['kofi', 'Ko-fi', 'https://ko-fi.com/'],
  ['telegram', 'Telegram', 'https://t.me/'],
];
function linkUrl(value, base) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (!base) return /^[\w.-]+\.[a-z]{2,}/i.test(v) ? `https://${v}` : ''; // website/mastodon: only if it looks like a host
  return `${base}${v.replace(/^@/, '')}`;
}

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .wrap { max-width:1160px; margin:0 auto; }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:40px; align-items:start; }
  @media (max-width:960px) { .cols { grid-template-columns:1fr; gap:28px; } }
  article { min-width:0; }
  h1 { font-family:var(--font-display); font-size:30px; line-height:1.2; margin:0 0 12px; }

  .meta { color:var(--muted); font-size:13px; margin:0 0 18px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .meta .who { display:inline-flex; align-items:center; gap:8px; }
  .meta .av { width:24px; height:24px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-size:11px; font-weight:700; }
  .meta .av img { width:100%; height:100%; object-fit:cover; }
  .meta .who b { color:var(--fg); font-weight:600; }
  .meta .m-actions { margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
  .meta gbti-favorite, .meta gbti-collection { display:inline-flex; }
  .meta .m-act { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; }
  .meta .m-act:hover { color:var(--accent); border-color:var(--accent); }
  /* Mobile: lift the favorite + collection actions to their own right-justified row ABOVE the author meta. */
  @media (max-width:650px) { .meta .m-actions { order:-1; width:100%; justify-content:flex-end; margin-left:0; margin-bottom:2px; } }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .cats { display:flex; gap:6px; flex-wrap:wrap; }
  .cat { font-size:11px; font-weight:600; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:999px; padding:2px 9px; }

  /* SOW-050: the hero cover is contained by WIDTH only (height auto, no object-fit crop), so the whole image
     shows at full resolution with no clipping. */
  .cover { display:block; width:100%; height:auto; border-radius:12px; border:1px solid var(--line); margin:0 0 22px; }
  /* SOW-092: a share's video link plays inline where the static image sat. TikTok is portrait (tall). */
  .cover-embed { position:relative; aspect-ratio:16/9; overflow:hidden; background:#000; margin:0 0 22px; border-radius:12px; border:1px solid var(--line); }
  .cover-embed iframe { width:100%; height:100%; border:0; }
  .cover-embed.tall { aspect-ratio:9/16; max-width:400px; }

  .body { font-size:15.5px; line-height:1.7; }
  .body h1,.body h2,.body h3 { font-family:var(--font-display); margin:1.4em 0 .5em; }
  .body p { margin:0 0 1em; }
  .body a { color:var(--accent); }
  .body img { max-width:100%; height:auto; border-radius:10px; }
  .body ul,.body ol { padding-left:1.4em; margin:0 0 1em; }
  .body blockquote { margin:0 0 1em; padding:2px 0 2px 14px; border-left:3px solid var(--line); color:var(--muted); }
  /* sow-062 review feedback: GFM tables now render as real tables, so they need borders and, on a phone,
     their own horizontal scroll rather than pushing the article wider than the viewport. */
  .body table { display:block; overflow-x:auto; max-width:100%; border-collapse:collapse; margin:0 0 1.2em; font-size:14.5px; }
  .body table th, .body table td { border:1px solid var(--line); padding:7px 11px; text-align:left; vertical-align:top; }
  .body table th { background:var(--hover); font-weight:700; white-space:nowrap; }
  .body > pre, .body code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .body :not(pre) > code { background:var(--hover); border:1px solid var(--line); border-radius:5px; padding:.08em .35em; font-size:.9em; }
  /* SOW-062 5d: body callout + embed blocks (rendered by client/src/markdown.mjs) */
  .body .md-callout { margin:0 0 1.2em; border:1.5px solid var(--line); border-radius:12px; padding:12px 14px 12px 42px; position:relative; background:var(--hover); }
  .body .md-callout::before { content:""; position:absolute; left:15px; top:15px; width:16px; height:16px; border-radius:50%; }
  .body .md-callout-info { border-color:rgba(63,116,214,.4); background:rgba(63,116,214,.08); } .body .md-callout-info::before { background:#3f74d6; }
  .body .md-callout-note::before { background:var(--muted); }
  .body .md-callout-warning { border-color:rgba(216,144,26,.4); background:rgba(224,163,61,.1); } .body .md-callout-warning::before { background:#d8901a; }
  .body .md-callout-tip { border-color:rgba(31,158,95,.35); background:rgba(31,158,95,.1); } .body .md-callout-tip::before { background:var(--accent); }
  .body .md-embed { position:relative; margin:0 0 1.2em; aspect-ratio:16/9; border-radius:10px; overflow:hidden; background:#000; }
  .body .md-embed iframe { width:100%; height:100%; border:0; }
  /* GFM footnotes: superscript refs jump to the end-of-article list; the back arrow returns. */
  .body sup.md-fnref { line-height:0; } .body sup.md-fnref a { text-decoration:none; font-weight:600; padding:0 1px; }
  .body .md-footnotes { margin-top:28px; padding-top:12px; border-top:1px solid var(--line); font-size:.87em; color:var(--muted); }
  .body .md-footnotes h2 { font-size:1.05em; margin:0 0 .6em; }
  .body .md-footnotes li { margin:0 0 .55em; }
  .body .md-fn-back { text-decoration:none; margin-left:4px; }

  /* SOW-050: code cards (built from <pre> in _enhanceCode) — a header bar with the language + a Copy button, a
     dark, horizontally-scrollable body that preserves whitespace. */
  .codecard { margin:0 0 1.2em; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--code-bg, #11131a); }
  .codebar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; background:color-mix(in srgb, var(--line) 40%, transparent); border-bottom:1px solid var(--line); }
  .codelang { font-family:ui-monospace,monospace; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  .copybtn { font:inherit; font-size:11px; font-weight:600; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 9px; cursor:pointer; }
  .copybtn:hover { color:var(--fg); border-color:var(--accent); }
  .codecard pre { margin:0; padding:13px 14px; overflow-x:auto; }
  .codecard pre code { display:block; white-space:pre; color:var(--code-fg, #e6e6e6); font-size:13px; line-height:1.55; background:none; border:0; padding:0; }

  .locked { border:1px solid var(--line); background:var(--hover); border-radius:10px; padding:14px 16px; color:var(--fg); font-size:14px; margin:14px 0; }
  .locked a { color:var(--accent); }
  .muted { color:var(--muted); }
  .view { display:inline-block; margin-top:22px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }
  /* SOW-090: the whole-prompt Copy (a prompt is a copyable artifact). */
  .copyall { display:inline-block; margin:22px 0 0 12px; font:inherit; font-size:13px; font-weight:700; color:var(--fg); background:var(--panel); border:1.5px solid var(--line); border-radius:999px; padding:6px 16px; cursor:pointer; }
  .copyall:hover { border-color:var(--accent); color:var(--accent); }

  /* The right drawer */
  .side { display:flex; flex-direction:column; gap:22px; }
  .author { border:1px solid var(--line); background:var(--panel); border-radius:7px; padding:18px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .author .a-top { display:flex; align-items:center; gap:12px; }
  .author .a-av { width:48px; height:48px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-weight:700; }
  .author .a-av img { width:100%; height:100%; object-fit:cover; }
  .author .a-name { font-family:var(--font-display); font-size:17px; font-weight:700; line-height:1.2; }
  .author .a-user { font-size:12px; color:var(--muted); }
  .author .a-note { font-size:13.5px; line-height:1.5; color:var(--fg); margin:12px 0 0; }
  /* A Share reads as: the OG/SEO summary (the link description), then the member's own note framed as a
     distinct "Comment by <author>" author note (the note itself in quotes), so it never looks like an
     auto-imported description. */
  .share-summary { font-size:15px; line-height:1.6; color:var(--muted); margin:0 0 16px; }
  .share-summary em { font-style: italic; }
  .share-cite { font-style: normal; font-family: var(--mono, monospace); font-size: 12px; color: var(--muted); white-space: nowrap; }
  /* the share meta stack: source favicon large, member avatar as the badge */
  .av.srcstack { position: relative; overflow: visible; }
  .av.srcstack .src-big { width: 100%; height: 100%; border-radius: 50%; object-fit: contain; background: #fff; padding: 3px; box-sizing: border-box; }
  .av.srcstack .src-mini { position: absolute; right: -5px; bottom: -4px; width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--card, #1c1a21); object-fit: cover; }
  /* the sidebar source card (favicon + domain + credit + the open action) */
  .side-src { border: 1px solid var(--line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .side-src .ss-fav { width: 36px; height: 36px; border-radius: 8px; background: #fff; object-fit: contain; padding: 4px; box-sizing: border-box; }
  .side-src .ss-host { font-weight: 700; font-size: 14px; }
  .side-src .ss-note { margin: 0; font-size: 12.5px; color: var(--muted); }
  /* owner QA 2026-07-22: the source card's action is the neutral "Visit" (not the green CTA). */
  .side-src .side-open { width: 100%; justify-content: center; box-sizing: border-box;
    background: transparent; border: 1px solid var(--line); color: var(--fg); }
  .side-src .side-open:hover { border-color: var(--fg); }
  .author-note { border-left:3px solid var(--accent); background:var(--hover); border-radius:0 10px 10px 0; padding:12px 15px; margin:0 0 20px; }
  .author-note .an-eyebrow { font-family:var(--font-mono, ui-monospace, monospace); font-size:11px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; color:var(--accent); margin:0 0 6px; }
  .author-note .body { font-size:15px; }
  .author-note .body p:last-child { margin-bottom:0; }
  /* enclose the member's comment in quotes */
  .author-note .body.quoted p:first-child::before { content:'"'; }
  .author-note .body.quoted p:last-child::after { content:'"'; }
  /* the author card "Shared by" eyebrow, above the member name, for a Share */
  .author .a-shared { font-family:var(--font-mono, ui-monospace, monospace); font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0 0 3px; }
  /* a large "open the link" button in the sidebar (Share only), under the member card, above the discussion.
     FLAT (default): a solid brand fill (--brand is theme-stable #1f9e5f, so white text stays AA in light +
     dark; --accent flips to a light mint in dark where white would fail). GLASS: a translucent brand fill
     that frosts via --glass-blur (SOW-070), per the gbti-card-list glass pattern. Composes with light/dark. */
  .side-open { display:flex; align-items:center; justify-content:center; gap:9px; width:100%; box-sizing:border-box; margin:8px 0 6px; padding:14px 16px; border-radius:7px; background:var(--brand); color:#fff; font-family:var(--font-display); font-weight:700; font-size:15.5px; text-decoration:none; border:1px solid var(--brand); box-shadow:0 6px 16px rgba(31,158,95,.25); -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .side-open:hover { filter:brightness(1.06); }
  .side-open svg { width:18px; height:18px; flex:none; }
  :host-context([data-layout="glass"]) .side-open { background:color-mix(in srgb, var(--brand) 68%, transparent); border-color:color-mix(in srgb, var(--brand) 60%, transparent); box-shadow:0 6px 20px rgba(31,158,95,.3); }
  .author .follow { display:inline-flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; width:100%; font:inherit; font-size:13px; font-weight:700; padding:8px 12px; border-radius:9px; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; text-decoration:none; }
  .author .follow.on { background:transparent; color:var(--fg); border-color:var(--line); }
  .author .follow.muted { background:transparent; color:var(--muted); border-color:var(--line); cursor:default; }
  .author .tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
  .author .tag { font-size:11.5px; font-weight:600; line-height:1; padding:5px 9px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
  .author .tag.role { color:var(--fg); border-color:var(--accent); background:color-mix(in srgb, var(--accent) 10%, transparent); }
  .author .socials { display:flex; flex-wrap:wrap; gap:7px; margin-top:14px; }
  .author .soc { position:relative; width:30px; height:30px; flex:none; display:inline-flex; align-items:center; justify-content:center; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:8px; text-decoration:none; }
  .author .soc:hover, .author .soc:focus-visible { color:var(--accent); border-color:var(--accent); outline:none; }
  .author .soc svg { width:15px; height:15px; }
  /* Shared hover-tooltip recipe (SOW-067): a position:relative trigger reveals a hidden, absolutely-positioned
     child on :hover / :focus-within / :focus-visible. The same mechanics back the news channel hovercard
     (gbti-news.mjs). V3 tokens (inverted --fg/--bg) keep it legible in both themes. */
  .author .soc .tip { position:absolute; bottom:calc(100% + 7px); left:50%; transform:translateX(-50%); background:var(--fg); color:var(--bg); font-size:11px; font-weight:600; line-height:1; white-space:nowrap; padding:5px 8px; border-radius:6px; opacity:0; visibility:hidden; pointer-events:none; transition:opacity .12s ease; z-index:30; }
  .author .soc:hover .tip, .author .soc:focus-visible .tip, .author .soc:focus-within .tip { opacity:1; visibility:visible; }

  .discussion h3 { font-family:var(--font-display); font-size:17px; margin:0 0 12px; }
  @media (max-width:960px) { .discussion { border-top:1px solid var(--line); padding-top:18px; } }
`;

class GbtiReader extends GbtiElement {
  /** open(item): { type, path, title, author, publishedAt, url, visibility, thumb?, thumbCard?, thumbWide?,
   *  categoryLabels?, body?, encryptedBody? }. For share, body/encryptedBody come from the summary; for
   *  post/product/prompt they come from readItem(path). */
  open(item) {
    this._item = item; this._html = null; this._author = undefined; this._doDone = false; this._rawBody = null; this._fm = null; this.render(); this._resolve();
    // SOW-126: the content detail-open engagement beacon (best-effort, fire-and-forget; the Worker no-ops when
    // the tier/config does not count, and swallows auth/transport errors so an open never surfaces an error).
    try {
      const slug = targetSlugFor(item || {});
      if (slug && TYPE_LABEL[item?.type] && this.client?.contentOpened) Promise.resolve(this.client.contentOpened(item.type, slug)).catch(() => {});
    } catch { /* never let the beacon break the reader */ }
  }

  async _resolve() {
    const it = this._item || {};
    // A DEEP-LINK item is minimal ({ type, path }): no title/author/url, which broke the author card (it
    // showed the house card) and anything reading item metadata (the syndicate popup posted an empty
    // title/author). The body read already returns the frontmatter, so resolve the body FIRST for a
    // minimal item, backfill, then resolve the author from the real username. A rich feed item keeps the
    // parallel fast path.
    const minimal = it.type !== 'share' && (!it.author || !it.title);
    if (minimal) {
      this._html = await this._resolveBody(it);
      this._backfillFromFrontmatter(it);
      this._author = await this._resolveAuthor(this._item || it);
    } else {
      const [html, author] = await Promise.all([this._resolveBody(it), this._resolveAuthor(it)]);
      this._html = html;
      this._author = author;
    }
    this.render();
    this._applyDo(this._item || it);
  }

  // Fill the missing metadata on a minimal deep-link item from the frontmatter _resolveBody stashed.
  _backfillFromFrontmatter(it) {
    const fm = this._fm;
    if (!fm) return;
    const URL_BASE = { post: '/articles', product: '/products', prompt: '/prompts' };
    this._item = {
      ...it,
      title: it.title || fm.title || '',
      author: it.author || fm.author || '',
      shortDescription: it.shortDescription || fm.shortDescription || '',
      url: it.url || (fm.slug && URL_BASE[it.type] ? `${URL_BASE[it.type]}/${fm.slug}/` : ''),
      publishedAt: it.publishedAt ?? (fm.publishedAt ? Date.parse(fm.publishedAt) : null),
    };
  }

  // SOW-114: honor a deep-link force-action (item.doAction = 'favorite' | 'collect') ONCE per open. The
  // public content pages send it via the SOW-036 relay so the site's inert Favorite/Save land here and act.
  // favorite = ensure-ON (applyFavorite treats `on` as the desired state, so this is idempotent and never
  // removes an existing favorite); collect = open the collection picker. Fail closed: with no signed-in
  // client the call fails and the reader's normal state stands (the one-shot guard is set first, no retry).
  async _applyDo(it) {
    const act = it?.doAction;
    if (!act || this._doDone) return;
    this._doDone = true;
    if (!this.client || it.type === 'share') return;
    const slug = targetSlugFor(it);
    if (!slug) return;
    if (act === 'favorite') {
      try {
        const res = await this.client.toggleFavorite({ targetType: it.type, targetSlug: slug, on: true });
        const fav = this.$('gbti-favorite');
        if (fav) { fav._faved = res?.favorited !== false; fav.render?.(); }
      } catch { /* signed-out or refused: leave the meta controls as they are */ }
    } else if (act === 'collect') {
      this.$('gbti-collection')?._toggleOpen?.();
    }
  }

  async _resolveBody(it) {
    try {
      if (it.type === 'share') {
        let body = it.body;
        let enc = it.encryptedBody;
        // SOW-089: a feed/deep-link share projection carries NO body (the public build artifact never
        // holds a member body), so backfill the real record through the tier-gated op (paid/trial get
        // body/encryptedBody; below the tier the record is not returned at all).
        if (!body && !enc && String(it.visibility || 'members') === 'members') {
          try {
            const { items } = (await this.client.listShares({ limit: 100 })) ?? {};
            const hit = (items ?? []).find((s) => (it.id && s.id === it.id)
              || (s.author === it.author && (s.createdAt === it.createdAt || (it.url && s.url === it.url))));
            if (hit) { body = hit.body; enc = hit.encryptedBody; }
          } catch { /* the backfill is best-effort; the no-enc guard below fails closed to no note */ }
        }
        // A share is a link + an OPTIONAL note. Its `members` visibility governs STREAM placement, not
        // gated body content, so only an ENCRYPTED note can ever be locked. With no encrypted note we
        // render the plaintext note (paid backfill) or NOTHING (no note, or below-tier / a fresh share
        // not yet in the index) — never a phantom "become a member" block no tier can unlock.
        if (!enc) return body ? ((await this.client.preview({ body }))?.html ?? '') : '';
        return await this._body(it.visibility, body, enc);
      }
      const { frontmatter, body } = await this.client.readItem({ path: it.path });
      // SOW-090: keep the RAW markdown so "Copy prompt" copies the canonical source (matching the public
      // site's prompt Copy, which always yields the raw markdown regardless of the active view).
      this._rawBody = typeof body === 'string' ? body : null;
      // Repo-relative image srcs (./images/x.webp) only mean something inside the repo; the site build
      // resolves them itself, but THIS reader renders raw markdown, so resolve them to jsDelivr here.
      this._itemPath = it.path;
      // SOW-088: the RAW taxonomy path (categoryLabels alone cannot drive channel routing) + the whole
      // frontmatter for the deep-link metadata backfill.
      this._fmCategories = Array.isArray(frontmatter?.categories) ? frontmatter.categories : null;
      this._fm = frontmatter ?? null;
      return await this._body(it.visibility, body, frontmatter?.encryptedBody);
    } catch {
      return { error: true };
    }
  }

  // Resolve the author drawer model: directory entry (avatar/name/headline/links), whether the viewer follows
  // them, and whether the viewer CAN follow (SOW-060: any signed-in member). House content yields a branded, non-followable card.
  async _resolveAuthor(it) {
    const username = lc(it.author);
    if (isHouse(username)) return { house: true };
    const [dir, status] = await Promise.all([
      loadDirectory(),
      (this.client.status ? this.client.status().catch(() => null) : Promise.resolve(null)),
    ]);
    const entry = dir.get(username) || null;
    const me = lc(status?.identity?.username || status?.identity?.login);
    const canFollow = !!status?.canFollow; // SOW-060: following is a free-tier perk (signed-in); the Worker fail-closes otherwise
    let following = false;
    if (canFollow && this.client.getFollows) {
      // getFollows() returns a bare array (operations.mjs) on both hosts; tolerate the { following: [...] } shape too.
      try { const f = await this.client.getFollows(); const list = Array.isArray(f) ? f : (f?.following ?? []); following = list.some((x) => lc(x.username) === username); }
      catch { /* leave following=false */ }
    }
    return { house: false, username, entry, canFollow, following, isSelf: !!me && me === username };
  }

  // Render the public body via preview, then append the members part (decrypt -> preview) or a locked notice.
  async _body(visibility, publicBody, encPath) {
    const resolve = (md) => resolveMarkdownAssets(md, this._itemPath);
    let html = publicBody ? ((await this.client.preview({ body: resolve(publicBody) }))?.html ?? '') : '';
    if (encPath) {
      try {
        const { text } = await this.client.decrypt({ encPath });
        html += (await this.client.preview({ body: resolve(text) }))?.html ?? '';
      } catch (err) {
        const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
        html += locked ? lockNotice('This part') : `<p class="muted">Could not load the members-only part right now.</p>`;
      }
    }
    if (!html && visibility === 'members') html = lockNotice('This');
    return html;
  }

  _metaHtml(it, when) {
    const t = TYPE_LABEL[it.type] || it.type || '';
    const name = authorName(it.author);
    const avUrl = this._author?.entry?.avatar || githubAvatar(it.author);
    const ini = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
    // Owner QA 2026-07-22: on a Share the SOURCE favicon is the larger circle and the member avatar
    // rides as the badge (mirrors the site share page).
    const srcFav = it.type === 'share' && it.url ? faviconFor(it.url) : '';
    const av = srcFav
      ? `<span class="av srcstack"><img class="src-big" src="${esc(srcFav)}" alt="">${avUrl ? `<img class="src-mini" src="${esc(avUrl)}" alt="">` : ''}</span>`
      : `<span class="av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`;
    const cats = Array.isArray(it.categoryLabels) && it.categoryLabels.length
      ? `<span class="cats">${it.categoryLabels.map((c) => `<span class="cat">${esc(c)}</span>`).join('')}</span>` : '';
    // SOW-013/064: favorite + add-to-collection, on the meta row (right-justified on desktop, a right-justified row
    // ABOVE the meta on mobile via the .m-actions order/width rules). The inert buttons upgrade to the working
    // controls once the client is present (extension/CMS). Shares are not favoritable here.
    const slug = it.type === 'share' ? '' : targetSlugFor(it);
    const HEART = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.3S3.6 15.2 3.6 9.5A4 4 0 0 1 12 7.3a4 4 0 0 1 8.4 2.2c0 5.7-8.4 10.8-8.4 10.8z"/></svg>';
    const COLL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h11M4 12h9M4 17h6"/><path d="M17 13.5v6M14 16.5h6"/></svg>';
    const acts = slug ? `<span class="m-actions">`
      + `<gbti-favorite data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}" data-gbti-region="favorite"><button type="button" class="m-act" aria-label="Favorite">${HEART}</button></gbti-favorite>`
      + `<gbti-collection data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"><button type="button" class="m-act" aria-label="Add to collection">${COLL}</button></gbti-collection>`
      + `<gbti-mod-actions data-gbti-type="${esc(it.type)}" data-gbti-author="${esc(it.author || '')}" data-gbti-slug="${esc(slug)}"></gbti-mod-actions>` // SOW-071: moderator+ only (self-gates; renders nothing otherwise)
      + `</span>` : '';
    return `<div class="meta"><span class="badge">${esc(t)}</span>`
      + `<span class="who">${av}<b>${esc(name)}</b></span>`
      + `${when ? `<span>· ${esc(dateStr(when))}</span>` : ''}${cats}${acts}</div>`;
  }

  _authorCardHtml(it) {
    const a = this._author;
    if (!a || a.house) {
      return `<div class="author"><div class="a-top">`
        + `<span class="a-av"><img src="${esc(githubAvatar('gbti'))}" alt=""></span>`
        + `<div><div class="a-name">GBTI Network</div><div class="a-user">The co-op</div></div></div>`
        + `<p class="a-note">Articles, products, and prompts from the GBTI Network co-op.</p></div>`;
    }
    const e = a.entry || {};
    const name = e.displayName || it.author;
    const avUrl = e.avatar || githubAvatar(it.author);
    const ini = esc((name || '?').trim().charAt(0).toUpperCase() || '?');
    const note = e.headline ? `<p class="a-note">${esc(e.headline)}</p>` : '';
    // Follow control: paid viewer -> toggle; self -> an Edit deep-link into the WorkBench; otherwise a prompt.
    let follow = '';
    // SOW-067 (decision 11): the author viewing their OWN post/product/prompt gets an Edit control that opens the
    // WorkBench on that type tab (workspace.html is a sibling extension page; npm-CMS hosts ignore the dead link).
    if (a.isSelf) follow = ['post', 'product', 'prompt'].includes(it.type)
      ? `<a class="follow edit" href="workspace.html#tab=${esc(it.type)}">Edit in workspace</a>` : '';
    else if (a.canFollow) follow = `<button class="follow${a.following ? ' on' : ''}" data-follow type="button">${a.following ? 'Following' : 'Follow'}</button>`;
    else follow = `<a class="follow muted" href="${SITE}/membership/" target="_blank" rel="noopener" title="Members can follow other members">Follow</a>`;
    // Social links (Discord shown as an inspectable handle chip).
    // SOW-067: per-platform brand ICONS (not spelled-out text). Each chip keeps an aria-label for screen readers
    // and reveals the platform name via the shared hover tooltip (.tip). Discord is not reliably linkable, so it
    // stays a focusable, non-link chip whose tooltip carries the handle.
    const links = e.links || {};
    const chips = [];
    for (const [key, label, base] of SOCIALS) {
      const url = linkUrl(links[key], base);
      const ico = socialIcon(key);
      if (url && ico) chips.push(`<a class="soc" href="${esc(url)}" target="_blank" rel="noopener nofollow" aria-label="${esc(label)}">${ico}<span class="tip" role="tooltip">${esc(label)}</span></a>`);
    }
    if (links.discord) {
      const handle = String(links.discord).trim();
      chips.push(`<span class="soc discord" tabindex="0" role="img" aria-label="Discord: ${esc(handle)}">${socialIcon('discord')}<span class="tip" role="tooltip">Discord: ${esc(handle)}</span></span>`);
    }
    const socials = chips.length ? `<div class="socials">${chips.join('')}</div>` : '';
    // SOW-129: public roles (specialty badges) + skills (tags), carried on the members-index entry. No location.
    const tagPills = [];
    for (const r of (Array.isArray(e.roles) ? e.roles : [])) tagPills.push(`<span class="tag role">${esc(prettyRole(r))}</span>`);
    for (const s of (Array.isArray(e.skills) ? e.skills : [])) tagPills.push(`<span class="tag skill">${esc(String(s))}</span>`);
    const tags = tagPills.length ? `<div class="tags">${tagPills.join('')}</div>` : '';
    return `<div class="author"><div class="a-top">`
      + `<span class="a-av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`
      + `<div>${it.type === 'share' ? '<div class="a-shared">Shared by</div>' : ''}<div class="a-name">${esc(name)}</div><div class="a-user">@${esc(it.author)}</div></div></div>`
      + `${note}${follow}${tags}${socials}</div>`;
  }

  render() {
    const it = this._item;
    if (!it) { this.set(this.css(CSS)); return; }
    // A Share's `url` is the external link it points at; every other type's `url` is a gbti.network path.
    // sow-145: outbound share links carry UTM attribution (the embed relay keeps the RAW url).
    const shareOut = it.type === 'share' && it.url ? utmLink(it.url, { ...UTM, utm_medium: 'extension', utm_campaign: 'shares' }) : '';
    const view = it.type === 'share'
      ? (it.url ? `<a class="view" href="${esc(shareOut)}" target="_blank" rel="noopener nofollow">${embedUrl(it.url) ? 'Watch video' : 'Read article'} on ${esc(hostOf(it.url))}</a>` : '')
      : (it.url ? `<a class="view" href="${esc(SITE + it.url)}" target="_blank" rel="noopener">View on gbti.network</a>` : '');
    const when = it.publishedAt ?? (it.createdAt ? Date.parse(it.createdAt) : null);
    const meta = this._metaHtml(it, when);
    // SOW-090: a whole-prompt Copy for PROMPT items (a prompt is a copyable artifact; the public site has
    // this and the extension reader did not). Copies the raw markdown body.
    const copyAll = (it.type === 'prompt' && this._rawBody)
      ? `<button class="copyall" type="button" data-copyall>Copy prompt</button>` : '';
    // SOW-050: the hero uses the full-res thumbWide derivative (falls back to the card/list thumb if absent).
    // SOW-092: a share whose link is a recognized video (YouTube/Vimeo/TikTok/Rumble embed) plays INLINE —
    // the embed replaces the static share image (the image was usually just that video's thumbnail).
    const shareEmbed = it.type === 'share' && it.url ? embedUrl(it.url) : null;
    const coverUrl = resolveAsset(it.thumbWide || it.thumbCard || it.thumb);
    // The player loads through the site's /embed/ relay: YouTube rejects a referrer-less request (its
    // error 153) and a chrome-extension:// page can never send one, so the relay's https origin vouches.
    const cover = shareEmbed
      ? `<div class="cover-embed${isPortraitEmbed(shareEmbed) ? ' tall' : ''}"><iframe src="${esc(`${SITE}/embed/?u=${encodeURIComponent(it.url)}`)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe></div>`
      : (coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="" loading="lazy">` : '');
    let body;
    if (this._html === null) body = `<p class="muted">Loading...</p>`;
    else if (this._html && this._html.error) body = `<p class="muted">Could not load this content. Try opening it on gbti.network.</p>`;
    else if (it.type === 'share') {
      // A Share's body is the member's OWN note about the link, not a description of it. Frame it as a
      // "From <author>" author note so it does not read as an auto-imported description; and show the
      // OG/SEO summary (shortDescription, pulled from the link's meta at post time) above it, if present.
      const authorDisplay = this._author?.entry?.displayName || authorName(it.author);
      // Owner QA 2026-07-22: the summary is scraped from the article source, so it renders QUOTED,
      // gains a trailing ellipsis when the scrape cut mid-sentence, and cites the source inline.
      const sumRaw = String(it.shortDescription || '').trim();
      const sumHost = hostOf(it.url || '');
      const summary = sumRaw
        ? `<p class="share-summary"><em>"${esc(sumRaw)}${/[.!?]["')\]]?$/.test(sumRaw) ? '' : '...'}"</em>${sumHost ? ` <span class="share-cite">- ${esc(sumHost)}</span>` : ''}</p>`
        : '';
      const note = (typeof this._html === 'string' && this._html.trim())
        ? `<div class="author-note"><p class="an-eyebrow">Comment by ${esc(authorDisplay)}</p><div class="body quoted">${this._html}</div></div>` : '';
      body = `${summary}${note}`;
    }
    else body = `<div class="body">${typeof this._html === 'string' ? this._html : ''}</div>`;

    const resolved = this._html !== null;
    const slug = targetSlugFor(it);
    const discussion = (resolved && slug)
      ? `<section class="discussion"><h3>Discussion</h3><gbti-discussion data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"${Array.isArray(it.aliases) && it.aliases.length ? ` data-gbti-target-aliases="${esc(it.aliases.join(','))}"` : ''}></gbti-discussion></section>`
      : '';
    // Owner QA 2026-07-22: the sidebar SOURCE card (favicon, domain, credit line) wraps the
    // open-the-link action, mirroring the site share page's source card.
    const sideLink = (it.type === 'share' && it.url)
      ? `<div class="side-src"><img class="ss-fav" src="${esc(faviconFor(it.url))}" alt="" onerror="this.remove()"><div class="ss-host">${esc(hostOf(it.url))}</div><p class="ss-note">The source ${esc(this._author?.entry?.displayName || authorName(it.author))} shared this from.</p><a class="side-open" href="${esc(utmLink(it.url, { ...UTM, utm_medium: 'extension', utm_campaign: 'shares' }))}" target="_blank" rel="noopener nofollow" title="Open ${esc(hostOf(it.url))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>Visit</a></div>`
      : '';
    // SOW-088: the superadmin Manually Syndicate control (self-gates to superadmin; the Worker enforces).
    // The category attribute carries the RAW top-level taxonomy key (a share's flat topic, or the first
    // segment of the frontmatter path) so the popup can pre-select the mapped Discord channel.
    const syndCategory = it.type === 'share' ? (it.category || '') : (this._fmCategories?.[0] || '');
    const syndPath = it.type === 'share' ? '' : (this._fmCategories || []).join(','); // SOW-088: leaf-first routing
    const syndUrl = it.url ? (it.type === 'share' ? it.url : SITE + it.url) : '';
    const authorDiscord = this._author?.entry?.links?.discord || '';
    // SOW-120: the author's public X handle ({member-x-handle}) + the item's tags ({tags-hashtags}).
    const authorX = this._author?.entry?.links?.x || '';
    const authorDevto = this._author?.entry?.links?.devto || ''; // SOW-140: feeds {member-devto-handle} on the dev.to byline
    const authorBluesky = this._author?.entry?.links?.bluesky || ''; // SOW-122: {member-bluesky-handle}
    const authorMastodon = this._author?.entry?.links?.mastodon || ''; // SOW-123: {member-mastodon-handle}
    const authorReddit = this._author?.entry?.links?.reddit || ''; // {member-reddit-handle}
    const tagsList = Array.isArray(this._fm?.tags) ? this._fm.tags : (Array.isArray(it.tags) ? it.tags : []);
    const syndTags = tagsList.filter((t) => typeof t === 'string' && t.trim()).join(',');
    const synd = (resolved && slug && ['post', 'product', 'prompt', 'share'].includes(it.type))
      ? `<gbti-syndicate-now data-gbti-type="${esc(it.type)}" data-gbti-slug="${esc(slug)}" data-gbti-author="${esc(it.author || '')}"${this._author?.entry?.displayName ? ` data-gbti-author-name="${esc(this._author.entry.displayName)}"` : ''} data-gbti-title="${esc(it.title || '')}"${(it.shortDescription || this._fm?.shortDescription) ? ` data-gbti-blurb="${esc(String(it.shortDescription || this._fm.shortDescription))}"` : ''} data-gbti-url="${esc(syndUrl)}" data-gbti-visibility="${esc(String(this._fm?.visibility || it.visibility || 'public'))}"${syndCategory ? ` data-gbti-category="${esc(syndCategory)}"` : ''}${syndPath ? ` data-gbti-category-path="${esc(syndPath)}"` : ''}${authorDiscord ? ` data-gbti-discord="${esc(String(authorDiscord))}"` : ''}${authorX ? ` data-gbti-x="${esc(String(authorX))}"` : ''}${authorBluesky ? ` data-gbti-bluesky="${esc(String(authorBluesky))}"` : ''}${authorMastodon ? ` data-gbti-mastodon="${esc(String(authorMastodon))}"` : ''}${authorReddit ? ` data-gbti-reddit="${esc(String(authorReddit))}"` : ''}${authorDevto ? ` data-gbti-devto="${esc(String(authorDevto))}"` : ''}${syndTags ? ` data-gbti-tags="${esc(syndTags)}"` : ''}${it.thumb ? ` data-gbti-image="${esc(String(it.thumb))}"` : ''}></gbti-syndicate-now>`
      : '';
    // The author drawer only renders once resolved (so its data is present); while loading the side column is empty.
    const side = resolved ? `<aside class="side">${this._authorCardHtml(it)}${sideLink}${synd}${discussion}</aside>` : '<aside class="side"></aside>';

    // SOW-057: an upvote control on a Share (extension-only), hidden for the share's own author (whose vote never counts).
    const shareUpvote = (it.type === 'share' && slug && this._author && !this._author.isSelf)
      ? `<div class="share-actions" style="margin-top:12px"><gbti-upvote data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-upvote></div>`
      : '';

    this.set(this.css(CSS) + `<div class="wrap"><div class="cols"><article><h1>${esc(it.title || '')}</h1>${meta}${cover}${body}${view}${copyAll}${shareUpvote}</article>${side}</div></div>`);
    if (resolved) { this._enhanceCode(); this._wireFollow(it); this._wireCopyAll(); this._wireFootnotes(); }
  }

  // GFM footnote anchors live inside this shadow root, where the browser's own fragment navigation cannot
  // reach, so #-links (ref -> definition, back arrow -> ref) route to a local scroll instead. Delegated on
  // the article body; each render builds a fresh body, so no duplicate listeners accumulate.
  _wireFootnotes() {
    const body = this.$('.body');
    if (!body) return;
    body.addEventListener('click', (e) => {
      const a = e.target?.closest?.('a');
      const href = a?.getAttribute?.('href') || '';
      if (!href.startsWith('#')) return;
      const target = this.root.getElementById(href.slice(1));
      if (!target) return; // an unknown fragment keeps its default behavior (never a swallowed click)
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // SOW-050: upgrade each <pre> code block into a code card (language label + Copy button). Idempotent per render.
  // SOW-090: copy the canonical raw markdown of the whole prompt.
  _wireCopyAll() {
    const btn = this.$('[data-copyall]');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(this._rawBody || ''); btn.textContent = 'Copied'; }
      catch { btn.textContent = 'Copy failed'; }
      setTimeout(() => { btn.textContent = 'Copy prompt'; }, 1400);
    });
  }

  _enhanceCode() {
    this.$$('.body pre').forEach((pre) => {
      const code = pre.querySelector('code');
      const lang = (code && code.dataset && code.dataset.lang) || '';
      const card = document.createElement('div');
      card.className = 'codecard';
      const bar = document.createElement('div');
      bar.className = 'codebar';
      const tag = document.createElement('span');
      tag.className = 'codelang';
      tag.textContent = lang || 'code';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'copybtn';
      btn.textContent = 'Copy';
      btn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
          btn.textContent = 'Copied';
          setTimeout(() => { btn.textContent = 'Copy'; }, 1200);
        } catch { btn.textContent = 'Copy failed'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); }
      });
      bar.append(tag, btn);
      pre.replaceWith(card);
      card.append(bar, pre);
    });
  }

  // Toggle follow in place (no full re-render, which would remount the discussion). Optimistic; reverts on error.
  _wireFollow(it) {
    const btn = this.$('[data-follow]');
    if (!btn || !this.client.setFollow) return;
    btn.addEventListener('click', async () => {
      const want = !btn.classList.contains('on');
      btn.disabled = true;
      btn.classList.toggle('on', want);
      btn.textContent = want ? 'Following' : 'Follow';
      try {
        await this.client.setFollow({ username: it.author, on: want });
        if (this._author) this._author.following = want;
      } catch {
        btn.classList.toggle('on', !want); // revert
        btn.textContent = !want ? 'Following' : 'Follow';
      } finally {
        btn.disabled = false;
      }
    });
  }
}

define('gbti-reader', GbtiReader);
export { GbtiReader };
