// SOW-026: the extension's first-run / account tab. Clicking the toolbar icon opens THIS page (the action has
// no popup; a popup closes on focus loss and lost the device-flow code the moment the member tabbed to GitHub).
// It reuses the SAME messaging bridge as the content script / Shares page: /api/* requests are relayed to the
// background worker (which holds the token + runs the device-flow polling), so this page never sees the token.
// It mounts the shared <gbti-onboarding> wizard (sign in -> fork -> install, one focused step at a time, driven
// by /api/onboarding-status = durable GitHub state) and surfaces the signed-in identity + a sign-out control
// (the job the old popup used to do).

import { setClient, createHttpClient } from '../../client-ui/src/index.mjs';

// Escape before any innerHTML interpolation (the account row interpolates the GitHub login). Exported for tests.
export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Relay a /api/* request to the background worker (replaces a real network fetch). Mirrors shares.mjs. */
async function messagingFetch(url, init = {}) {
  const u = new URL(url, 'https://gbti.network');
  const req = {
    method: init.method || 'GET',
    pathname: u.pathname,
    query: Object.fromEntries(u.searchParams.entries()),
    body: init.body ? JSON.parse(init.body) : undefined,
  };
  const result = await chrome.runtime.sendMessage({ type: 'api', req });
  const r = result || { status: 500, json: { error: 'no_response' } };
  return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
}

const client = createHttpClient({ baseUrl: '', token: 'extension', fetch: messagingFetch });

// Device-flow login is a HOST capability: the worker polls; we relay the user code to the caller's onPrompt.
client.login = (onPrompt) =>
  new Promise((resolve, reject) => {
    const onMsg = (m) => { if (m?.type === 'login-prompt') onPrompt?.({ userCode: m.userCode, verificationUri: m.verificationUri }); };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.runtime.sendMessage({ type: 'login' })
      .then((r) => { chrome.runtime.onMessage.removeListener(onMsg); r?.ok ? resolve(r) : reject(new Error(r?.error || 'sign-in failed')); })
      .catch((e) => { chrome.runtime.onMessage.removeListener(onMsg); reject(e); });
  });

setClient(client); // also DEFINES <gbti-onboarding> + the other client-ui elements

const SITE = 'https://gbti.network';
const LOCKED = ['expired', 'cancelled', 'none', 'banned']; // SOW-011: a lapsed/banned status cannot publish

async function status() {
  const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname: '/api/status', query: {} } });
  return r?.json ?? null;
}

async function signOut() {
  await chrome.runtime.sendMessage({ type: 'signout' });
  mount();          // reset the wizard back to step 1
  refreshAccount(); // back to the "join" line
}

/** Populate the brand-panel footer with the signed-in identity + sign-out, or the join nudge when signed out. */
async function refreshAccount() {
  const el = document.querySelector('[data-account]');
  if (!el) return;
  let s = null;
  try { s = await status(); } catch { /* worker unreachable: keep whatever is shown */ return; }
  const id = s?.identity;
  if (id && s.authenticated) {
    const lapsed = LOCKED.includes(s.membership)
      ? ` Your membership has lapsed. <a href="${SITE}/membership/" target="_blank" rel="noopener">Renew</a> to publish again.`
      : '';
    el.innerHTML = `Signed in as <strong>@${esc(id.login)}</strong>. <button class="linkbtn" data-signout type="button">Sign out</button>${lapsed}`;
    el.querySelector('[data-signout]')?.addEventListener('click', signOut);
  } else {
    el.innerHTML = `Not a member yet? <a href="${SITE}/membership/" target="_blank" rel="noopener">Join GBTI Network</a> to publish.`;
  }
}

function mount() {
  const app = document.getElementById('app');
  if (!app) return;
  const el = document.createElement('gbti-onboarding');
  app.replaceChildren(el);

  // Sign-in: run the device flow in the background worker; feed the user code into the wizard's sign-in card
  // (it shows the code + a Copy button + an "Open github.com/login/device" link). On success, re-probe.
  el.addEventListener('gbti:onboarding-signin', () => {
    client.login(({ userCode, verificationUri }) => el.setCode?.(userCode, verificationUri))
      .then(() => { el.refresh?.(); refreshAccount(); })
      .catch(() => el.setCode?.(null));
  });

  el.addEventListener('gbti:onboarding-ready', () => refreshAccount());
  // "Complete Integration" (SOW-029): take over the page with the post-setup welcome view (membership phase +
  // join-Discord + follow-members). When the member finishes, THEN open the extension's home (new tab).
  el.addEventListener('gbti:onboarding-start', () => {
    // SOW-029: if the new tab already showed the welcome (flag set on show), do not re-show it -> go straight home.
    let seen = false; try { seen = localStorage.getItem('gbti-welcome-seen') === '1'; } catch { /* no storage */ }
    if (seen) { window.location.href = chrome.runtime.getURL('newtab.html'); return; }
    // The setup wizard PAGE is light by design (SOW-026: no data-theme, so its V3 tokens stay light), but the
    // WELCOME takeover is a member surface and must honor the member's theme like every other page. Resolve it
    // exactly like theme-init.mjs (dark default, 'system' follows the OS) and stamp it at takeover, with a
    // matching page background so the light chrome never bleeds through behind the dark cards.
    let theme = 'dark';
    try {
      const t = localStorage.getItem('gbti-theme');
      theme = t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : (t === 'light' ? 'light' : 'dark');
    } catch { /* default dark */ }
    document.documentElement.setAttribute('data-theme', theme);
    if (theme === 'dark') { document.body.style.background = '#0d1117'; document.body.style.color = '#e6edf3'; }
    const w = document.createElement('gbti-welcome');
    w.addEventListener('gbti:welcome-done', () => {
      try { localStorage.setItem('gbti-welcome-seen', '1'); } catch { /* no storage */ } // SOW-029: don't re-show on the new tab
      // Land on the Profile page (not the home feed): the welcome banner + the staged-socials prefill greet
      // them there, so the flow ends with the profile getting filled out.
      // sow-204: the extension no longer hosts a profile editor, so finishing setup hands off to the website
      // WorkBench. The old `?welcome=1` banner is DROPPED on purpose (owner, 2026-08-12): sow-207 put a
      // website-hosted welcome flow at /welcome/, and a fresh signup already lands there, so keeping this
      // banner would greet the same member twice for the same moment.
      window.location.href = 'https://gbti.network/workbench/';
    });
    w.style.cssText = 'display:block; padding:5vh 16px;'; // breathing room around the two-pane welcome panel
    const shell = document.querySelector('main.shell');
    if (shell) { shell.style.gridTemplateColumns = '1fr'; shell.replaceChildren(w); }
    else { (document.getElementById('app') || document.body).replaceChildren(w); }
  });
}

function init() {
  mount();
  refreshAccount();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshAccount(); });
}

if (typeof document !== 'undefined' && typeof chrome !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}
