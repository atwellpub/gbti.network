// <gbti-onboarding> (SOW-026): the first-run setup wizard. A 3-line checklist (sign in, make your copy, give
// access) whose source of truth is DURABLE GitHub state via client.onboardingStatus(), so it never loops on a
// cleared store. It shows ONLY the first not-yet-done step as an expanded card (one why-this-matters line, a
// what-you-will-see preview, one primary button), collapses done steps to a green-check row, and dims unreached
// steps. Detection advances ONLY on a positive durable signal (a re-probe), never on a click or timer, so an
// abandoned GitHub action just leaves the step open (fail closed). Sign-in is delegated to the host (which holds
// the token); fork + install open GitHub-hosted deep-links and the wizard auto-polls for the return.
import { GbtiElement, define, esc } from '../base.mjs';

const STEP_IDS = ['signin', 'fork', 'install'];
// SOW-157: hosted onboarding is sign-in only (the host has no step metadata for it, so the copy lives here).
const HOSTED_SIGNIN_META = {
  title: 'Sign in with GitHub',
  why: 'Your GitHub account is your identity on the network. No repository access is requested, and the network publishes on your behalf.',
  doneLabel: 'Signed in',
};
// White check on the filled (done) green circle, to match the white-on-green buttons.
const check = (filled) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${filled ? 'var(--brand)' : 'none'}" stroke="${filled ? 'var(--brand)' : 'var(--line)'}" stroke-width="2"/>${filled ? '<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;

// Per-step glyphs for the primary action buttons (currentColor = the button's white text). The fork icon is the
// GitHub repo-forked octicon; sign-in is the GitHub mark; install is a shield (access).
const BTN_ICON = {
  signin: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
  fork: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`,
  install: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`,
};

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .head h2 { font-family:var(--font-display); font-size:16px; margin:0; text-transform:none; letter-spacing:0; color:var(--fg); }
  .count { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .bar { height:3px; border-radius:999px; background:var(--line); overflow:hidden; margin-bottom:14px; }
  .bar > i { display:block; height:100%; background:var(--brand); transition:width .25s ease; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .row .ic { flex:none; margin-top:1px; }
  .row.done .t { color:var(--muted); font-size:13px; padding-top:1px; }
  .card { flex:1; min-width:0; border:1px solid var(--line); border-radius:10px; padding:12px 13px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .card .title { font-family:var(--font-display); font-size:16px; font-weight:700; margin:0 0 3px; }
  .card .why { font-size:12.5px; color:var(--muted); margin:0 0 7px; line-height:1.45; }
  .card .see { font-size:12px; color:var(--fg); margin:0 0 11px; display:flex; gap:6px; align-items:flex-start; }
  .card .see svg { flex:none; margin-top:1px; opacity:.7; }
  /* Primary action. Used as BOTH a <button> (Sign in) and an <a> (Open github.com/login/device), so it must be a
     block-level flex box (an inline <a> let its green background wrap mid-text into two ragged pieces) with WHITE
     text to match the site's green CTA. */
  .btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; box-sizing:border-box;
    border:0; border-radius:9px; background:var(--brand); color:#fff; text-decoration:none; text-align:center;
    font:inherit; font-weight:700; font-size:14px; padding:11px 14px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn svg { flex:none; }
  .again { display:block; margin-top:8px; text-align:right; font-size:12px; color:var(--accent); background:none; border:0; cursor:pointer; margin-left:auto; }
  .again[disabled] { opacity:.6; cursor:default; }
  .code { display:inline-flex; align-items:center; gap:8px; margin:2px 0 10px; font-family:ui-monospace,monospace; font-size:18px; font-weight:700; letter-spacing:.06em; background:var(--hover); padding:7px 11px; border-radius:8px; }
  .copy { font-family:var(--font-body); font-size:11px; font-weight:600; letter-spacing:0; border:1px solid var(--line); background:var(--panel); color:var(--accent); border-radius:6px; padding:3px 8px; cursor:pointer; }
  .copy:hover { border-color:var(--accent); }
  .note { font-size:12px; color:var(--muted); margin:8px 0 0; }
  .note.warn { color:var(--danger); }
  /* Decodes GitHub's scary-sounding "Act on your behalf" wording on the authorize screen. */
  .reassure { display:flex; gap:8px; align-items:flex-start; margin:0 0 11px; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:var(--hover); }
  .reassure svg { flex:none; margin-top:1px; color:var(--accent); }
  .reassure p { margin:0; font-size:12px; line-height:1.5; color:var(--fg); }
  .reassure b { font-weight:700; }
  .ready { text-align:center; padding:6px 0 2px; }
  .ready .big { font-family:var(--font-display); font-size:17px; font-weight:700; margin:8px 0 4px; }
  .foot { margin-top:12px; font-size:11.5px; color:var(--muted); text-align:center; }
  .foot.err { color:var(--danger); }
`;

class GbtiOnboarding extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._onVis = () => { if (!document.hidden) this.refresh(); };
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('focus', this._onVis);
    this.refresh();
  }
  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopPolling();
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('focus', this._onVis);
  }

  _startPolling() { if (!this._timer) this._timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 5000); }
  _stopPolling() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  /** The host (which runs the device flow) feeds the user code in so the sign-in card can show it. */
  setCode(code, url) { this._code = code ? { code, url } : null; this.render(); }

  /** Re-probe durable GitHub state and re-render. Never advances on an error (the probe returns reachedGithub:false).
   *  A manual check (the Check again button) gets visible feedback: the button flips to "Checking...", and when the
   *  probe returns unchanged we say so instead of silently re-rendering the same card (which reads as a dead click). */
  async refresh({ manual = false } = {}) {
    if (this._busy) return;
    this._busy = true;
    if (manual) { this._checking = true; this.render(); }
    const sig = (s) => (s ? [s.signedIn, s.forkReady, s.installReady, s.allReposGrant, s.activeStep].join('|') : '');
    const before = sig(this._status);
    try {
      const s = await this.client?.onboardingStatus?.();
      if (s) {
        const becameReady = s.ready && !(this._status && this._status.ready);
        this._status = s;
        this._staleNote = manual && !s.ready && sig(s) === before;
        if (s.signedIn) this._code = null; // the device code is spent once we are signed in
        if (s.ready) { this._stopPolling(); if (becameReady) this.emit('gbti:onboarding-ready', { login: s.login }); }
        else this._startPolling();
      }
    } catch {
      this._status = { ...(this._status || {}), reachedGithub: false };
    } finally {
      this._busy = false;
      this._checking = false;
      this.render();
    }
  }

  render() {
    const s = this._status;
    if (!s) { this.set(this.css(CSS) + `<p class="note">Checking your setup...</p>`); return; }

    // SOW-157: hosted (and classic) onboarding is SIGN-IN ONLY — no fork, no install; the network does the
    // git work on the member's behalf. The host says which via status.mode; app mode keeps the 3-step wizard.
    const hostedLike = Boolean(s.mode && s.mode !== 'app');

    if (s.ready) {
      const note = hostedLike
        ? 'Sign-in is all it takes: your drafts save privately, and the network publishes for you.'
        : 'Your drafts save to your copy, and we open the review request for you.';
      this.set(this.css(CSS) + `<div class="ready">${check(true)}<div class="big">You are ready to publish</div>
        <p class="note">${note}</p>
        <button class="btn" data-start style="margin-top:12px">Complete Integration</button></div>`);
      this.on('[data-start]', 'click', () => this.emit('gbti:onboarding-start'));
      return;
    }

    const stepIds = hostedLike ? ['signin'] : STEP_IDS;
    const doneAll = [s.signedIn, s.forkReady, s.installReady];
    const done = stepIds.map((_, i) => doneAll[i]);
    const nDone = done.filter(Boolean).length;
    // Default to the sign-in step when the probe could not resolve one (e.g. a transient error before sign-in),
    // so step 1 is ALWAYS an actionable card rather than a dead-end.
    const active = s.activeStep || (s.signedIn ? null : 'signin');
    // Show ONLY the done steps (a compact green-check row) plus the single active step as its own card. Upcoming
    // steps stay hidden until reached, so the member works one focused step at a time and never jumps ahead.
    const rows = stepIds.map((id, i) => {
      const meta = s.steps?.[id] || (hostedLike && id === 'signin' ? HOSTED_SIGNIN_META : {});
      if (done[i]) return `<li class="row done"><span class="ic">${check(true)}</span><span class="t">${esc(meta.doneLabel || meta.title || id)}</span></li>`;
      if (id !== active) return '';
      return `<li class="row"><span class="ic">${check(false)}</span>${this._card(id, meta, s)}</li>`;
    }).filter(Boolean).join('');

    const reached = s.reachedGithub !== false;
    this.set(this.css(CSS) + `
      <div class="head"><h2>${hostedLike ? 'Sign in to publish' : 'Set up publishing'}</h2><span class="count">${nDone} of ${stepIds.length}</span></div>
      <div class="bar"><i style="width:${Math.round((nDone / stepIds.length) * 100)}%"></i></div>
      <ul>${rows}</ul>
      <p class="foot${reached ? '' : ' err'}">${reached ? 'Reached GitHub just now.' : 'We could not reach GitHub. Trying again.'}</p>`);

    this.on('[data-again]', 'click', () => this.refresh({ manual: true }));
    this.on('[data-signin]', 'click', () => this.emit('gbti:onboarding-signin'));
    const copy = this.$('[data-copy]');
    if (copy) copy.addEventListener('click', () => { try { navigator.clipboard?.writeText?.(this._code?.code || ''); copy.textContent = 'Copied'; } catch { /* clipboard blocked */ } });
    const open = this.$('[data-open]');
    if (open) open.addEventListener('click', () => { const u = open.getAttribute('data-open'); if (u) window.open(u, '_blank', 'noopener'); setTimeout(() => this.refresh(), 1500); });
  }

  _card(id, meta, s) {
    const eye = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5c-5 0-8.5 4.5-9 7 0.5 2.5 4 7 9 7s8.5-4.5 9-7c-.5-2.5-4-7-9-7zm0 11a4 4 0 110-8 4 4 0 010 8z" fill="currentColor"/></svg>`;
    const why = `<p class="why">${esc(meta.why || '')}</p>`;
    const see = `<p class="see">${eye}<span>${esc(meta.preview || '')}</span></p>`;
    const again = `<button class="again" data-again type="button"${this._checking ? ' disabled' : ''}>${this._checking ? 'Checking...' : 'Check again'}</button>${
      this._staleNote && !this._checking
        ? `<p class="note">Checked just now, no change yet. GitHub can take a minute to reflect updates, and this step re-checks itself every few seconds.</p>`
        : ''
    }`;
    if (id === 'signin') {
      const verifyUrl = this._code?.url || 'https://github.com/login/device';
      // Plain-language decode of GitHub's "Act on your behalf" authorize line, which alarms members out of context.
      const shield = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`;
      const reassure = `<div class="reassure">${shield}<p><b>"Act on your behalf" is GitHub's standard wording for any app you connect, not full account access.</b> GBTI Network can only open pull requests and save drafts to the copy you choose. It cannot read your private code, change your account, or reach any other repository. You can remove it at any time in your GitHub settings.</p></div>`;
      const code = this._code
        ? `<div class="code"><span data-codeval>${esc(this._code.code)}</span><button class="copy" data-copy type="button" title="Copy the code">Copy</button></div>
           <a class="btn" href="${esc(verifyUrl)}" target="_blank" rel="noopener">${BTN_ICON.signin}<span>Open github.com/login/device</span></a>
           <p class="note">Copy the code, open the GitHub page, paste it there, and Authorize. Leave this tab open: it checks off on its own when you come back.</p>`
        : `<button class="btn" data-signin type="button">${BTN_ICON.signin}<span>${esc(meta.button || 'Sign in with GitHub')}</span></button>`;
      return `<div class="card"><p class="title">${esc(meta.title || 'Sign in with GitHub')}</p>${why}${see}${reassure}${code}${again}</div>`;
    }
    // REJECT an "All repositories" grant: send the member to the installation settings to switch to "Only
    // select repositories" -> their fork. We do not accept it as done (the probe reports installReady:false),
    // so this corrective card replaces the first-time install prompt until they scope it down.
    if (id === 'install' && s.allReposGrant) {
      return `<div class="card"><p class="title">Switch to just your copy</p>
        <p class="why">You granted GBTI access to <b>all</b> your repositories. For your security we only want your one copy. Open the installation, choose <b>Only select repositories</b>, pick gbti.network, and save.</p>
        <button class="btn" data-open="${esc(s.links?.manage || 'https://github.com/settings/installations')}" type="button">${BTN_ICON.install}<span>Fix access on GitHub</span></button>${again}
        <p class="note warn">Access to all repositories is not accepted.</p></div>`;
    }
    const link = id === 'fork' ? s.links?.fork : s.links?.install;
    return `<div class="card"><p class="title">${esc(meta.title)}</p>${why}${see}
      <button class="btn" data-open="${esc(link || '')}" type="button">${BTN_ICON[id] || ''}<span>${esc(meta.button)}</span></button>${again}</div>`;
  }
}

define('gbti-onboarding', GbtiOnboarding);
export { GbtiOnboarding };
