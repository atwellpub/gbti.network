// <gbti-share-composer> (SOW-018): the extension-only authoring surface for member "Shares" (status updates).
// Shares are NOT a public website experience; this composer lives in the GBTI client/extension. It encodes the
// access model directly from client.status().membership:
//   - paid + Content Creator tier -> the full composer (note + optional link + visibility), via client.postShare()
//   - paid on a LOWER tier (sow-218) -> an upgrade notice, because a share PR needs creator at the gate
//   - trialing       -> read-only notice: a trial may READ the community Shares stream but posting is paid
//   - expired/cancelled/none/banned (Locked) -> a lock splash (renew to rejoin); no composer
//   - unknown        -> show the composer optimistically (the oracle is down; publishShare + the gate are the
//                       real authority and will reject a genuinely non-paid post)
// The host holds the GitHub token; this element only calls the injected client.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck, failHint } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement
import { topicsFromJson } from '../topic-picker-core.mjs'; // SOW-087: the flat topic vocabulary for the category select
import { optimisticShareItem } from '../share-post-core.mjs'; // SOW-092: the reader-ready item for the instant redirect
// sow-192 Phase E: the Note step's Write/Preview toggle renders markdown with the SAME node-free, escape-first,
// XSS-hardened helpers the block editor uses (no client.preview needed, so the preview is portable to the
// cookie-adapter hosts that lack it).
import { parseBlocks, inlineMdToHtml, isDangerousUrl } from '../markdown-blocks.mjs';

const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);
const SITE = 'https://gbti.network';

// sow-192 Phase E: inline glyphs for the wizard chrome. The shadow DOM cannot reach the site's light-DOM sprite
// (#ico-*), so the step icons are inlined here. `fill:currentColor` lets them inherit the button/label color.
const IC = {
  bolt: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 4.5 13.5H11l-1 8.5L18.5 10.5H12z"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m0 2a3 3 0 0 1 3 3v3H9V7a3 3 0 0 1 3-3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m6.9 6h-2.9a15.7 15.7 0 0 0-1.3-3.3A8 8 0 0 1 18.9 8M12 4c.9 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1-2.8 1.9-4M4.3 14a7.9 7.9 0 0 1 0-4h3.1a17 17 0 0 0 0 4zm.8 2h2.9c.4 1.2.8 2.3 1.3 3.3A8 8 0 0 1 5.1 16m2.9-8H5.1a8 8 0 0 1 3.8-3.3A15.7 15.7 0 0 0 8 8M12 20c-.9-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1 2.8-1.9 4m2.3-6H9.7a15 15 0 0 1 0-4h4.6a15 15 0 0 1 0 4m.4 5.3c.5-1 .9-2.1 1.3-3.3h2.9a8 8 0 0 1-4.2 3.3M16.6 14a17 17 0 0 0 0-4h3.1a7.9 7.9 0 0 1 0 4z"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11h12.2l-3.6-3.6L14 6l6 6-6 6-1.4-1.4 3.6-3.6H4z"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11H7.8l3.6-3.6L10 6l-6 6 6 6 1.4-1.4L7.8 13H20z"/></svg>',
};
const STEP_LABELS = ['Link', 'Preview', 'Note', 'Publish'];
const NEXT_LABEL = { 1: 'Fetch details', 2: 'Looks good', 3: 'Continue' };

// sow-211: the composer used to HIDE the whole preview box on any throw (a 401, a network failure, a 500)
// and say nothing, which is what the owner reported as "nothing was extracted and there was no visual
// feedback". The empty-but-reached case was already legible; the FAILED case was not, and the two were never
// the indistinguishable pair the SOW originally described.
//
// The information to explain a failure was already arriving and being discarded: both hosts throw an error
// carrying `.code` and `.message` (WorkbenchClientError in src/lib/workbench-client.ts, GbtiClientError in
// client-ui/src/client.mjs), and the old bare `catch` dropped both.
//
// Pure and exported so every branch is unit-testable: the element modules guard customElements for node, so
// the house pattern is to test the helper rather than the element (see domainOf in gbti-news.mjs, prEvent in
// workspace-core.mjs).

/** Why an empty preview is empty. Mirrors membership-og.mjs's `reason`; anything unrecognised falls through
 *  to the generic empty message rather than showing a raw code to the author. */
const OG_REASON_TEXT = {
  unreachable: 'We could not reach that page.',
  'not-a-page': 'That link is not a web page.',
  timeout: 'That link took too long to respond.',
};

/**
 * Decide what the preview box should show. Exactly one of three kinds, so the renderer has no branching of
 * its own and cannot grow a second interpretation.
 *
 * @param {{og?: object|null, error?: any}} args
 * @returns {{kind:'card'|'empty'|'error', message:string, retry:boolean}}
 */
export function ogPreviewState({ og = null, error = null } = {}) {
  if (error) {
    const code = String(error?.code || '');
    // A signed-out or expired session is the one failure with a specific action attached, so it gets its own
    // sentence. Mirrors newsGet in workbench-client.ts, which already drives a view from the code not the status.
    if (code === 'not_authenticated' || code === 'not-authenticated' || code === 'http-401') {
      return { kind: 'error', message: 'Sign in to fetch a link preview.', retry: false };
    }
    // A validation refusal already carries a specific, member-readable reason from the Worker ("only http(s)
    // URLs are allowed", "that host is not allowed"). Surface it instead of the generic line, and do NOT
    // offer a retry, since the same URL will be refused again.
    //
    // This does not weaken the SSRF posture, which is a guardrail this SOW names explicitly: every blocked
    // host gets the same sentence whether or not anything is listening there, so nothing about internal
    // hosts is revealed by the difference between two responses.
    if (code === 'invalid_url' || code === 'bad_request') {
      const detail = String(error?.message || '').trim();
      return { kind: 'error', message: detail && detail !== code ? `We cannot preview that link: ${detail}` : 'We cannot preview that link.', retry: false };
    }
    // The code is appended rather than swallowed: a generic apology is what made this undiagnosable.
    return { kind: 'error', message: `We could not fetch a preview for that link.${code ? ` (${code})` : ''}`, retry: true };
  }
  if (og && (og.title || og.description || og.image)) return { kind: 'card', message: '', retry: false };
  const reason = og && typeof og.reason === 'string' ? og.reason : '';
  if (OG_REASON_TEXT[reason]) return { kind: 'empty', message: OG_REASON_TEXT[reason], retry: reason !== 'not-a-page' };
  // Reached it, read it, it genuinely has nothing. Unchanged wording, because it was already correct.
  return { kind: 'empty', message: 'No preview available for this link.', retry: false };
}

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .card { background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius:14px; padding:16px; }
  h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sub { margin:0 0 12px; font-size:13px; color:var(--muted); }
  textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; font:inherit; font-size:14px;
    padding:10px 12px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  textarea:focus { outline:none; border-color:var(--brand); }
  input.title, input.desc { width:100%; box-sizing:border-box; font:inherit; padding:9px 12px; margin-bottom:8px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  input.title { font-size:15px; font-weight:700; }
  input.desc { font-size:13px; }
  input.title:focus, input.desc:focus { outline:none; border-color:var(--brand); }
  .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
  input[type=url] { flex:1; min-width:160px; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  select { font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  .actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:12px; }
  button.post { display:inline-flex; align-items:center; gap:8px; font:inherit; font-weight:700; font-size:14px; padding:9px 18px; border:0; border-radius:10px; background:var(--brand); color:#fff; cursor:pointer; }
  button.post[disabled] { opacity:.6; cursor:default; }
  /* SOW-092: the progressing ring shown inside the Post button while postShare runs. */
  .post .spin { display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:sc-spin .7s linear infinite; }
  @keyframes sc-spin { to { transform:rotate(360deg); } }
  .msg { font-size:13px; }
  .msg.err { color:#c0392b; }
  .msg.ok { color:var(--brand); }
  .notice { display:flex; gap:12px; align-items:flex-start; padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--hover, rgba(0,0,0,.03)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .notice h3 { margin-bottom:2px; }
  .notice a { color:var(--brand); font-weight:600; }
  .lock { font-size:22px; line-height:1; }
  .busy { opacity:.55; pointer-events:none; }
  .og { margin-top:10px; }
  .og .ogmsg { font-size:12.5px; color:var(--muted); }
  /* sow-211: a FAILED preview reads as a failure, not as a quiet absence. Same red as .msg.err above, so the
     composer has one error colour rather than two. A reached-but-empty page stays muted: it is not an error. */
  .og .ogmsg.err { color:#c0392b; }
  /* SOW-102: the rich link-preview card (image + title + description + domain), replacing the bare image. */
  .og .ogcard { display:flex; gap:12px; align-items:stretch; border:1px solid var(--line); border-radius:7px; overflow:hidden; background:var(--panel); }
  .og .ogimg { flex:none; width:120px; min-height:76px; object-fit:cover; border:0; border-radius:0; }
  .og .ogtxt { min-width:0; padding:8px 10px 8px 0; display:flex; flex-direction:column; gap:2px; justify-content:center; }
  .og .ogtxt:first-child { padding-left:10px; }
  .og .ogtitle { font-size:13.5px; font-weight:700; color:var(--fg); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .og .ogdesc { font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .og .ogdomain { font-size:11px; color:var(--muted); opacity:.8; text-transform:lowercase; }
  .og .ogclear { margin-top:6px; font:inherit; font-size:12px; background:none; border:0; color:var(--muted); cursor:pointer; padding:0; }
  .og .ogclear:hover { color:var(--brand); text-decoration:underline; }
  /* sow-192 Phase E: the four-step wizard chrome (Link -> Preview -> Note -> Publish). */
  /* The step sections + nav buttons are toggled with the [hidden] attribute, but several of them carry an
     explicit display (flex/inline-flex) that would beat the UA [hidden]{display:none}. Force it here so a
     hidden step or a hidden Back/Next/Post button actually disappears. */
  [hidden] { display:none !important; }
  .rail { display:flex; gap:6px; margin:0 0 16px; }
  .rail .dot { flex:1; display:flex; align-items:center; gap:7px; padding:0; background:none; border:0; font:inherit; font-size:12px; color:var(--muted); cursor:pointer; text-align:left; }
  .rail .dot .num { flex:none; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; border:1.5px solid var(--line); background:var(--panel); color:var(--muted); }
  .rail .dot .lbl { white-space:nowrap; }
  .rail .dot.on { color:var(--fg); font-weight:600; }
  .rail .dot.done { color:var(--fg); }
  .rail .dot.on .num, .rail .dot.done .num { background:var(--brand); border-color:var(--brand); color:#fff; }
  .step h3 { margin:0 0 4px; }
  .step .sub { margin:0 0 12px; }
  .hint { margin:8px 0 0; font-size:12px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .autoblock { margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
  .autolabel { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--brand); margin-bottom:8px; }
  .autolabel svg { width:14px; height:14px; fill:currentColor; flex:none; }
  .notetabs { display:flex; align-items:center; gap:4px; margin-bottom:8px; }
  .notetabs .nt { font:inherit; font-size:13px; font-weight:600; padding:5px 12px; border:1.5px solid var(--line); border-radius:8px; background:var(--panel); color:var(--muted); cursor:pointer; }
  .notetabs .nt.on { border-color:var(--brand); color:var(--brand); }
  .notetabs .mdlabel { margin-left:auto; font-size:11px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .notepreview { min-height:84px; padding:10px 12px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); font-size:14px; line-height:1.6; overflow-wrap:anywhere; }
  .notepreview :is(h1,h2,h3) { font-family:var(--font-display, var(--font-body)); font-size:16px; margin:.6em 0 .3em; }
  .notepreview p { margin:0 0 .7em; }
  .notepreview p:last-child, .notepreview :is(ul,ol):last-child, .notepreview blockquote:last-child { margin-bottom:0; }
  .notepreview a { color:var(--brand); }
  .notepreview ul, .notepreview ol { padding-left:1.3em; margin:0 0 .7em; }
  .notepreview blockquote { margin:0 0 .7em; padding:2px 0 2px 12px; border-left:3px solid var(--line); color:var(--muted); }
  .notepreview pre { background:var(--hover, rgba(0,0,0,.05)); padding:8px 10px; border-radius:8px; overflow-x:auto; font-size:12.5px; }
  .notepreview code { font-family:var(--font-mono, monospace); font-size:.92em; }
  .notepreview .empty { color:var(--muted); font-style:italic; }
  .aud { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .audcard { display:flex; flex-direction:column; gap:3px; text-align:left; font:inherit; padding:12px 14px; border:1.5px solid var(--line); border-radius:12px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .audcard .at { display:flex; align-items:center; gap:7px; font-weight:700; font-size:14px; }
  .audcard .at svg { width:15px; height:15px; fill:currentColor; flex:none; }
  .audcard .ad { font-size:12px; color:var(--muted); }
  .audcard.on { border-color:var(--brand); box-shadow:inset 0 0 0 1px var(--brand); }
  .audcard.on .at { color:var(--brand); }
  .wizfoot { display:flex; align-items:center; gap:10px; margin-top:16px; }
  .wizfoot .msg { margin-right:auto; }
  .navbtns { display:flex; align-items:center; gap:8px; }
  .navbtns button.back, .navbtns button.next { font:inherit; font-weight:700; font-size:14px; padding:9px 16px; border-radius:10px; cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
  .navbtns .back { background:none; border:1.5px solid var(--line); color:var(--fg); }
  .navbtns .next { background:var(--brand); border:0; color:#fff; }
  .navbtns svg { width:15px; height:15px; fill:currentColor; flex:none; }
  @media (max-width:420px) { .aud { grid-template-columns:1fr; } }
  @media (max-width:360px) { .rail .dot .lbl { display:none; } }
`;

class GbtiShareComposer extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._loadStatus();
  }

  async _loadStatus() {
    if (!this.client) { this._membership = null; this._tier = null; this.render(); return; }
    try {
      const s = await this.client.status();
      this._membership = s?.membership ?? 'unknown';
      // sow-218: also read the sow-185 paid TIER. `paid` alone is no longer enough to post a Share, and the
      // oracle already returns this, so it costs no extra call.
      this._tier = typeof s?.paidTier === 'string' ? s.paidTier : null;
    } catch {
      this._membership = 'unknown';
      this._tier = null;
    }
    this.render();
  }

  render() {
    const m = this._membership;
    if (!this.client) return this.set(this.css(CSS) + this._noticeHtml('Open in the GBTI client', 'Shares are posted from the GBTI browser extension or the desktop client. Open it to share an update.', '🧩'));
    if (m === undefined) return this.set(this.css(CSS) + `<div class="card"><p class="sub">Loading…</p></div>`);
    if (LOCKED.has(m)) return this._renderLocked();
    if (m === 'trialing') return this._renderTrial();
    // sow-218: paid is necessary but no longer sufficient. Posting a Share is Content Creator work at the PR
    // gate (a share PR reports TYPE_OTHER, so requiredTierFor demands creator), and without this check a
    // Network Member would compose a whole Share and only meet that wall AFTER submitting, as a rejected PR.
    // Fail-closed the other way here though: an ABSENT tier still shows the composer, matching the existing
    // `unknown` behaviour. A down oracle must not silently strip posting from a real Content Creator, and the
    // gate remains the authority either way.
    if (this._tier && this._tier !== 'creator') return this._renderNotCreator();
    return this._renderComposer(); // paid creator, or an unresolved tier
  }

  _noticeHtml(title, body, glyph) {
    return `<div class="notice"><span class="lock">${glyph}</span><div><h3>${esc(title)}</h3><p class="sub" style="margin:0">${body}</p></div></div>`;
  }

  _renderLocked() {
    this.set(this.css(CSS) + this._noticeHtml(
      'Your access is locked',
      'Your membership has lapsed, so Shares are locked. <a href="https://gbti.network/membership/">Renew your membership</a> to read and post in the community stream again.',
      '🔒',
    ));
  }

  // sow-218: a paid member on a tier below Content Creator. Named for what they ARE rather than what they lack,
  // and it states the tier plainly, because "your PR was rejected" after writing a Share is the experience this
  // exists to prevent.
  _renderNotCreator() {
    this.set(this.css(CSS) + this._noticeHtml(
      'Posting Shares is a Content Creator perk',
      'Your membership covers reading the community stream. Posting Shares, articles, products and prompts is part of Content Creator membership. <a href="https://gbti.network/membership/">See the membership tiers</a> to upgrade.',
      '✍️',
    ));
  }

  _renderTrial() {
    this.set(this.css(CSS) + this._noticeHtml(
      'Reading only on the free trial',
      'On the trial you can READ the community Shares stream. Posting Shares requires a paid membership. <a href="https://gbti.network/membership/">Upgrade to a paid membership</a> to post.',
      '👀',
    ));
  }

  // sow-192 Phase E: the same fields as before, redistributed into a four-step wizard (Link -> Preview ->
  // Note -> Publish). Every field stays in the DOM at all times (hidden steps keep their nodes), so the eager
  // OG fetch + the field values persist across steps and the existing selectors in _fetchPreview / _loadTopics
  // / _post keep working unchanged. Only the layout + step chrome are new; the data paths are identical.
  _renderComposer() {
    this._step = 1;
    this._noteTab = 'write';
    this._visibility = 'members'; // shares stay members-only by default (unchanged product behavior)
    const rail = STEP_LABELS.map((l, i) =>
      `<button class="dot" type="button" data-goto="${i + 1}"><span class="num">${i + 1}</span><span class="lbl">${l}</span></button>`).join('');
    this.set(this.css(CSS) + `
      <div class="card wizard">
        <div class="rail">${rail}</div>

        <section class="step" data-step="1">
          <h3>What are you sharing?</h3>
          <p class="sub">Paste a link and we will pull the title, description and image for you. You can also skip it and just write a note.</p>
          <div class="row">
            <input type="url" placeholder="https://… (optional link)" />
          </div>
          <p class="hint">Works with articles, videos, repos and product pages.</p>
        </section>

        <section class="step" data-step="2" hidden>
          <h3>Does this look right?</h3>
          <p class="sub">Edit anything that reads badly. Every field is optional.</p>
          <div class="og" data-og hidden></div>
          <input class="title" type="text" placeholder="Title (optional)" maxlength="80" />
          <input class="desc" type="text" placeholder="Short description (optional)" maxlength="200" />
          <div class="autoblock">
            <span class="autolabel">${IC.bolt} Categorised automatically</span>
            <select class="cat" aria-label="Category">
              <option value="">Category (optional)</option>
            </select>
          </div>
        </section>

        <section class="step" data-step="3" hidden>
          <h3>Add your take</h3>
          <p class="sub">Optional, but a share with a note gets read far more often.</p>
          <div class="notetabs">
            <button class="nt on" type="button" data-note-tab="write">Write</button>
            <button class="nt" type="button" data-note-tab="preview">Preview</button>
            <span class="mdlabel">Markdown</span>
          </div>
          <textarea placeholder="What are you reading, building, or finding?" maxlength="4000"></textarea>
          <div class="notepreview" data-note-preview hidden></div>
        </section>

        <section class="step" data-step="4" hidden>
          <h3>Who sees this?</h3>
          <p class="sub">Set the audience for your share.</p>
          <div class="aud">
            <button class="audcard on" type="button" data-vis="members" aria-pressed="true">
              <span class="at">${IC.lock} Members only</span>
              <span class="ad">Signed-in members of the network, nobody else.</span>
            </button>
            <button class="audcard" type="button" data-vis="public" aria-pressed="false">
              <span class="at">${IC.globe} Public</span>
              <span class="ad">Anyone can read it, and it can be indexed.</span>
            </button>
          </div>
        </section>

        <div class="wizfoot">
          <span class="msg" aria-live="polite"></span>
          <div class="navbtns">
            <button class="back" type="button" data-back hidden>${IC.back} Back</button>
            <button class="next" type="button" data-next>${esc(NEXT_LABEL[1])} ${IC.fwd}</button>
            <button class="post" type="button" hidden>Post Share</button>
          </div>
        </div>
      </div>`);
    this._image = null;
    this._suggested = null; // SOW-087: the Worker's category suggestion, applied once topics are loaded
    // One delegated handler for the wizard controls (rail dots, Back/Next, note tabs, audience cards); base
    // `on()` binds a single element, so a group of buttons needs delegation.
    this.$('.card')?.addEventListener('click', (e) => this._onCardClick(e));
    this.on('.post', 'click', () => this._post());
    // SOW-057 + SOW-102: fetch the link preview EAGERLY — on paste and on a debounced input, not only on
    // blur/enter (change) — so a pasted URL imports without the member ever leaving the field. The same-URL
    // guard in _fetchPreview keeps the overlapping triggers from double-fetching.
    this.on('input[type=url]', 'change', () => this._fetchPreview());
    this.on('input[type=url]', 'paste', () => setTimeout(() => this._fetchPreview(), 0));
    this.on('input[type=url]', 'input', () => {
      clearTimeout(this._ogTimer);
      this._ogTimer = setTimeout(() => this._fetchPreview(), 400);
    });
    this._go(1);
    this._loadTopics();
  }

  // Delegated wizard navigation + toggles.
  _onCardClick(e) {
    const t = e.target;
    if (!t || !t.closest) return;
    const goto = t.closest('[data-goto]');
    if (goto) { this._go(Number(goto.dataset.goto)); return; }
    if (t.closest('[data-next]')) { this._advance(); return; }
    if (t.closest('[data-back]')) { this._go(this._step - 1); return; }
    const nt = t.closest('[data-note-tab]');
    if (nt) { this._setNoteTab(nt.dataset.noteTab); return; }
    const vis = t.closest('[data-vis]');
    if (vis) { this._selectAudience(vis.dataset.vis); return; }
  }

  // Advance from the current step. Leaving step 1 makes sure the link preview is fetched (idempotent + same-URL
  // guarded), so "Fetch details" reliably imports even if the debounce had not fired yet.
  _advance() {
    if (this._step === 1) this._fetchPreview();
    this._go(this._step + 1);
  }

  // Show one step; update the rail, the Back button, and the Next/Post label.
  _go(n) {
    const step = Math.max(1, Math.min(4, n));
    // Leaving the Note step returns it to Write so the textarea is the source of truth on return.
    if (this._step === 3 && step !== 3 && this._noteTab === 'preview') this._setNoteTab('write');
    this._step = step;
    for (const sec of this.$$('.step')) sec.hidden = Number(sec.dataset.step) !== step;
    for (const dot of this.$$('.rail .dot')) {
      const dn = Number(dot.dataset.goto);
      dot.classList.toggle('on', dn === step);
      dot.classList.toggle('done', dn < step);
    }
    const back = this.$('.back'); if (back) back.hidden = step === 1;
    const next = this.$('.next'); const post = this.$('.post');
    if (step === 4) {
      if (next) next.hidden = true;
      if (post) post.hidden = false;
    } else {
      if (post) post.hidden = true;
      if (next) { next.hidden = false; next.innerHTML = `${esc(NEXT_LABEL[step])} ${IC.fwd}`; }
    }
  }

  _setNoteTab(tab) {
    this._noteTab = tab === 'preview' ? 'preview' : 'write';
    const ta = this.$('textarea');
    const pv = this.$('[data-note-preview]');
    for (const b of this.$$('[data-note-tab]')) b.classList.toggle('on', b.dataset.noteTab === this._noteTab);
    if (this._noteTab === 'preview') {
      if (pv) { pv.innerHTML = this._notePreviewHtml(ta?.value || ''); pv.hidden = false; }
      if (ta) ta.hidden = true;
    } else {
      if (pv) pv.hidden = true;
      if (ta) ta.hidden = false;
    }
  }

  _selectAudience(vis) {
    this._visibility = vis === 'public' ? 'public' : 'members';
    for (const c of this.$$('[data-vis]')) {
      const on = c.dataset.vis === this._visibility;
      c.classList.toggle('on', on);
      c.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // Render the note's markdown for the Preview tab using the shared, escape-first block helpers. Escape-first
  // means no author markdown can inject active HTML into the preview (member-markdown XSS stays closed).
  _notePreviewHtml(md) {
    const src = String(md || '').trim();
    if (!src) return `<span class="empty">Nothing to preview yet.</span>`;
    const html = parseBlocks(src).map((b) => this._blockPreview(b)).join('');
    return html || `<span class="empty">Nothing to preview yet.</span>`;
  }

  _blockPreview(b) {
    switch (b.type) {
      case 'members': return ''; // the members-only split marker is meaningless in a short share note
      case 'heading': { const lv = Math.min(3, Math.max(1, b.level || 2)); return `<h${lv}>${inlineMdToHtml(b.text || '')}</h${lv}>`; }
      case 'quote': case 'callout': return `<blockquote>${inlineMdToHtml(b.text || '')}</blockquote>`;
      case 'code': return `<pre><code>${esc(b.code || '')}</code></pre>`;
      case 'list': {
        const items = (Array.isArray(b.items) ? b.items : []).map((it) => `<li>${inlineMdToHtml(it)}</li>`).join('');
        return b.ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      }
      case 'image': return b.url && !isDangerousUrl(b.url) ? `<p><img src="${esc(b.url)}" alt="${esc(b.alt || '')}" /></p>` : '';
      case 'embed': return b.url && !isDangerousUrl(b.url) ? `<p><a href="${esc(b.url)}">${esc(b.url)}</a></p>` : '';
      case 'table': return ''; // rare in a note; the light preview omits tables
      case 'paragraph': default: return `<p>${inlineMdToHtml(b.text || '')}</p>`;
    }
  }

  // SOW-087: populate the category select from the public topic vocabulary (/topics.json). The vocabulary is
  // static per session, so it is fetched once and reused across re-renders. A fetch failure leaves the select
  // with only the empty option (category stays optional).
  async _loadTopics() {
    if (!this._topics) {
      try {
        const r = await fetch(`${SITE}/topics.json`, { cache: 'no-cache' });
        this._topics = topicsFromJson(await r.json());
      } catch {
        this._topics = [];
      }
    }
    const sel = this.$('select.cat');
    if (!sel) return;
    sel.innerHTML = `<option value="">Category (optional)</option>` +
      this._topics.map((t) => `<option value="${esc(t.key)}">${esc(t.label)}</option>`).join('');
    this._applySuggested();
  }

  // Pre-select the Worker's suggestion, but NEVER clobber an author's own pick.
  _applySuggested() {
    const sel = this.$('select.cat');
    if (!sel || !this._suggested || sel.value) return;
    if ([...sel.options].some((o) => o.value === this._suggested)) sel.value = this._suggested;
  }

  // Fetch the link preview server-side (the Worker is SSRF-guarded). Updates ONLY the preview area + soft-prefills
  // EMPTY title/desc fields (never clobbering author text), so it does not re-render the composer.
  // SOW-102: same-URL guarded (the eager paste/input/change triggers overlap), with a rich preview card
  // (image + title + description + domain) and a quiet empty state instead of a silent nothing.
  async _fetchPreview() {
    const url = (this.$('input[type=url]')?.value || '').trim();
    const box = this.$('[data-og]');
    if (!box) return;
    if (!/^https?:\/\//i.test(url) || !this.client?.ogPreview) { this._lastOgUrl = null; this._image = null; box.hidden = true; box.innerHTML = ''; return; }
    if (url === this._lastOgUrl) return; // already fetched (or in flight) for this exact URL
    this._lastOgUrl = url;
    box.hidden = false;
    box.innerHTML = `<span class="ogmsg">Fetching preview…</span>`;
    let og = null;
    let error = null;
    try {
      og = await this.client.ogPreview({ url });
    } catch (e) {
      error = e;
    }
    if ((this.$('input[type=url]')?.value || '').trim() !== url) return; // the field moved on; a newer fetch owns the box
    // sow-211: ONE decision, made by the pure mapper, so a failure can never again render as a hidden box.
    const state = ogPreviewState({ og, error });
    if (state.kind === 'card') {
      const t = this.$('input.title'); if (t && !t.value.trim() && og?.title) t.value = String(og.title).slice(0, 80);
      const d = this.$('input.desc'); if (d && !d.value.trim() && og?.description) d.value = String(og.description).slice(0, 200);
      // SOW-087: soft-prefill the category from the Worker's suggestion (the author can always override).
      this._suggested = og?.suggestedCategory || null;
      this._applySuggested();
      this._image = og?.image || null;
      let domain = '';
      try { domain = new URL(url).hostname.replace(/^www\./, ''); } catch { /* leave empty */ }
      box.innerHTML = `<div class="ogcard">`
        + (this._image ? `<img class="ogimg" src="${esc(this._image)}" alt="" />` : '')
        + `<div class="ogtxt">`
        + (og?.title ? `<span class="ogtitle">${esc(og.title)}</span>` : '')
        + (og?.description ? `<span class="ogdesc">${esc(og.description)}</span>` : '')
        + (domain ? `<span class="ogdomain">${esc(domain)}</span>` : '')
        + `</div></div>`
        + `<button class="ogclear" type="button" data-ogclear>Remove preview</button>`;
      const clr = box.querySelector('[data-ogclear]');
      if (clr) clr.addEventListener('click', () => { this._image = null; this._lastOgUrl = null; box.hidden = true; box.innerHTML = ''; });
      return;
    }
    // Empty or failed. The box STAYS VISIBLE and says which. A preview is optional metadata, so neither state
    // blocks posting; the author can continue to the note and publish without one.
    this._image = null;
    // A THROW clears the same-URL guard (as it always did) so the next input event can retry on its own; a
    // reached-but-empty page keeps it, since re-asking on every keystroke is what the guard exists to stop.
    if (state.kind === 'error') { this._lastOgUrl = null; this._suggested = null; }
    box.innerHTML = `<span class="ogmsg${state.kind === 'error' ? ' err' : ''}">${esc(state.message)}</span>`
      + (state.retry ? ` <button class="ogclear" type="button" data-ogretry>Try again</button>` : '');
    // The same-URL guard at the top of this method would otherwise strand a failed fetch until the author
    // edits the field, so retry clears it and re-runs rather than asking them to retype the link.
    const again = box.querySelector('[data-ogretry]');
    if (again) again.addEventListener('click', () => { this._lastOgUrl = null; this._fetchPreview(); });
  }

  async _post() {
    const card = this.$('.card');
    const title = (this.$('input.title')?.value || '').trim();
    const shortDescription = (this.$('input.desc')?.value || '').trim();
    const body = (this.$('textarea')?.value || '').trim();
    const url = (this.$('input[type=url]')?.value || '').trim();
    const visibility = this._visibility || 'members'; // sow-192 Phase E: the audience card selection
    const category = this.$('select.cat')?.value || ''; // SOW-087: the optional topic category
    const msg = this.$('.msg');
    if (!body && !url && !title) { this._say(msg, 'Add a title, a note, or a link first.', 'err'); return; }
    // SOW-092: a real progressing state — disable the button and show a ring spinner for the several
    // seconds postShare spends on the fork commit + PR round-trip (the card dim alone read as stuck).
    const btn = this.$('button.post');
    const btnLabel = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.innerHTML = `<span class="spin" aria-hidden="true"></span>Posting...`; }
    card?.classList.add('busy');
    try {
      const input = { visibility };
      if (title) input.title = title;
      if (shortDescription) input.shortDescription = shortDescription;
      if (url) input.url = url;
      if (category) input.category = category; // SOW-087: routes the share's category Discord post
      if (this._image) input.image = this._image; // SOW-057: the featured image (OG-fetched, author-clearable)
      const res = await this.client.postShare({ input, body });
      this._say(msg, submitAck({ prNumber: res?.prNumber, autoMerge: true }), 'ok'); // SOW-072 P2: consistent ack
      for (const sel of ['input.title', 'input.desc', 'textarea', 'input[type=url]']) { const el = this.$(sel); if (el) el.value = ''; }
      const cat = this.$('select.cat'); if (cat) cat.value = '';
      const postedImage = this._image;
      this._image = null;
      this._suggested = null;
      this._lastOgUrl = null;
      const ogBox = this.$('[data-og]'); if (ogBox) { ogBox.hidden = true; ogBox.innerHTML = ''; }
      // sow-192 Phase E: return the wizard to a clean first step for the next share (the ack stays visible in
      // the always-on footer).
      this._setNoteTab('write');
      this._selectAudience('members');
      this._go(1);
      // SOW-092: emit a READER-READY optimistic item alongside the publish result so the host redirects
      // the member to their share IMMEDIATELY (SOW-076 instant-feel; the emit only fires on success).
      const item = optimisticShareItem({ res, input: { ...input, image: postedImage }, body });
      this.emit('gbti-share-posted', { ...res, item });
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this._say(msg, h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text, 'err');
    } finally {
      card?.classList.remove('busy');
      if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    }
  }

  _say(el, text, kind) {
    if (!el) return;
    el.textContent = text;
    el.className = `msg ${kind || ''}`;
  }
}

define('gbti-share-composer', GbtiShareComposer);
export { GbtiShareComposer };
