// The MV3 background service worker (SOW-006 v2 P4). It holds the GitHub token (chrome.storage.local, NEVER
// exposed to the page), runs device-flow auth, and answers the content script's /api/* messages by running the
// dispatcher against the extension ctx. The page can never read the token: it only sends messages and gets
// back results. This is the privileged half of the extension client.

import { createExtStore } from './ext-store.mjs';
import { buildExtContext, UPSTREAM } from './ext-context.mjs';
import { dispatch, computeRole } from './ext-dispatch.mjs';
import { devlog } from './devlog.mjs';
import { createGithubReader } from './github-reader.mjs';
import { deviceFlowLogin } from '../../client/src/auth-device.mjs';
import { createRepoClient } from '../../client/src/github-repo.mjs';
import { resolveMembership } from '../../client/src/membership.mjs';
import { GITHUB_CLIENT_ID, GITHUB_APP_SLUG, activeClientId, activeScope, decideAuthMode } from '../../client/src/signup-base.mjs';
import { probeReadiness } from '../../client/src/github-app-probe.mjs'; // SOW-157: mode decision at sign-in
import { resolveOpenPage } from './open-page.mjs';
import { needsRefresh, refreshPatch } from './token-refresh.mjs';

// GITHUB_CLIENT_ID is the PUBLIC device-flow OAuth app client id, single-sourced in signup-base.mjs (device flow
// has no client secret, so it is safe to bundle). Baked into the extension at build time.

// SOW-011: the signup Worker that answers the membership-status oracle. In host_permissions so the worker can
// fetch it cross-origin (the token stays in the worker; only the derived status comes back).
const SIGNUP_BASE = 'https://signup.gbti.network';

let storePromise = null;
function getStore() {
  if (!storePromise) {
    storePromise = chrome.storage.local.get('gbti').then((d) =>
      createExtStore(d?.gbti ?? {}, (next) => chrome.storage.local.set({ gbti: next })),
    );
  }
  return storePromise;
}

async function handleLogin(store) {
  const { accessToken, refreshToken, expiresIn } = await deviceFlowLogin({
    // SOW-026: classic mode = the public_repo OAuth app (account-wide); app mode = the GitHub App (fork-scoped,
    // no scope, GitHub Apps ignore it). The token only ever reaches GitHub; app mode shrinks its capability to
    // the member's single fork. The MV3 worker has no process.env, so AUTH_MODE defaults to classic until the
    // bundle bakes app mode at provisioning.
    clientId: activeClientId(),
    scope: activeScope(),
    onPrompt: ({ userCode, verificationUri }) => {
      // Surface the code to the onboarding tab. Do NOT auto-open the verification tab here: the GitHub App device
      // flow returns no verification_uri_complete, so an auto-opened page cannot pre-fill the code anyway, and
      // grabbing focus mid-flow is hostile. The tab shows the code with a Copy button + an
      // "Open github.com/login/device" button the member clicks themselves. The device flow keeps polling here.
      chrome.runtime.sendMessage({ type: 'login-prompt', userCode, verificationUri }).catch(() => {});
    },
  });
  const repo = createRepoClient({ token: accessToken, upstream: UPSTREAM });
  const u = await repo.getAuthUser();
  // SOW: persist the refresh token + access-token expiry so the background can refresh silently (GitHub App user
  // tokens expire ~8h). A classic OAuth token returns no refresh_token/expires_in -> these are null and the token
  // simply never refreshes (it does not expire). expiresIn is seconds; we store an absolute ms deadline.
  store.set({
    githubToken: accessToken,
    githubRefreshToken: refreshToken || null,
    githubTokenExpiresAt: expiresIn ? Date.now() + expiresIn * 1000 : null,
    identity: { login: u.login, githubId: String(u.id), username: String(u.login).toLowerCase() },
  });

  // SOW-157: decide this member's auth mode ONCE per fresh sign-in, from the readiness probe. A stored mode
  // is never overwritten automatically (a member who chose fork mode keeps it; switching is an explicit
  // account action), and decideAuthMode returns null on an unreachable probe or a fork-without-install (no
  // silent flip that would orphan staged fork drafts). New members with no fork land on 'hosted': sign-in
  // IS the whole onboarding, and the Worker does the git work. The background is the only mode writer.
  if (!store.get('authMode')) {
    try {
      const probe = await probeReadiness({ token: accessToken, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM, fetch: globalThis.fetch });
      const mode = decideAuthMode(probe);
      if (mode) store.set({ authMode: mode });
    } catch { /* leave unset; the baked default applies */ }
  }

  // SOW-011: resolve + cache the effective membership so the in-page editor can show the "membership required
  // to publish" notice and block a trial publish. Best-effort: any failure leaves it 'unknown' (fails OPEN to
  // the gate). The reader reads the public house/*.yml overrides; the Worker supplies the Stripe-derived status.
  try {
    const reader = createGithubReader({ upstream: UPSTREAM, token: accessToken });
    const { stripeStatus, membership, couponUntil } = await resolveMembership({ githubId: String(u.id), token: accessToken, signupBase: SIGNUP_BASE, readFile: (p) => reader.readFile(p) });
    store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null }); // SOW-119 QA: drives the expiry countdown
  } catch {
    // leave membership unset (treated as 'unknown')
  }
  // sow-158: also sign the member into gbti.network (mint the cookie session from this fresh token). Fire-and-forget;
  // reset the once-per-session stamp so maybeMintWebSession will re-mint later if this call did not land.
  try { await chrome.storage?.session?.set?.({ webSessionMinted: true }); } catch { /* best-effort */ }
  mintWebSession(accessToken);
  return { ok: true, login: u.login };
}

// SOW: refresh the GitHub App access token via the Worker (which holds the App client secret; the extension only
// sends its rotating refresh_token). Returns the parsed response or throws. The token never goes to a page.
async function refreshViaWorker(refreshToken) {
  const res = await fetch(`${SIGNUP_BASE}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) throw new Error(`refresh failed: ${res.status}`);
  return res.json();
}

// sow-158 auth bridge: mint the gbti.network httpOnly cookie session from this member's verified token, so ONE
// extension sign-in also signs them in on the website (WorkBench / News / account) with no separate web sign-in.
// Bearer-authenticated -> their OWN session (no new capability). Best-effort + fire-and-forget: a failure is
// non-fatal (web sign-in stays available). credentials:'include' so the browser stores the Set-Cookies in the
// shared cookie jar the gbti.network page reads. The token is sent to the SAME Worker that already holds it.
async function mintWebSession(token) {
  if (!token) return;
  try {
    await fetch(`${SIGNUP_BASE}/auth/session-from-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch { /* non-fatal: the web can always sign in directly */ }
}

// Opportunistic mint: once per browser session, so an EXISTING signed-in member (who signed in before this shipped)
// gets a website session without re-signing-in. chrome.storage.session clears when the browser closes, so this
// re-mints roughly once per browser run (idempotent + rate-limited server-side).
async function maybeMintWebSession(store) {
  try {
    const token = store.get('githubToken');
    if (!token) return;
    const { webSessionMinted } = (await chrome.storage?.session?.get?.('webSessionMinted')) ?? {};
    if (webSessionMinted) return;
    await chrome.storage?.session?.set?.({ webSessionMinted: true });
    await mintWebSession(token);
  } catch { /* best-effort */ }
}

// Single-flight proactive refresh: when the access token is at/near expiry, swap in a fresh one BEFORE the request
// runs, so no read ever 401s on a merely-expired token. Concurrent api calls share ONE in-flight refresh (the
// refresh token rotates, so parallel refreshes would invalidate each other). A failed refresh is swallowed: the
// request proceeds with the stale token, and the reader's 401 -> onAuthError -> re-sign-in splash is the fallback.
let _refreshing = null;
async function ensureFreshToken(store) {
  const state = { githubToken: store.get('githubToken'), githubRefreshToken: store.get('githubRefreshToken'), githubTokenExpiresAt: store.get('githubTokenExpiresAt') };
  if (!needsRefresh(state)) return;
  if (!_refreshing) {
    const old = state.githubRefreshToken;
    _refreshing = (async () => {
      try {
        const patch = refreshPatch(await refreshViaWorker(old), old);
        if (patch) store.set(patch);
      } catch { /* leave the session as-is; a 401 then trips the re-auth fallback */ }
      finally { _refreshing = null; }
    })();
  }
  return _refreshing;
}

// SOW-026: the toolbar icon has NO default_popup, so clicking it fires this handler instead of opening a popup.
// A popup closes the instant it loses focus, which discarded the device-flow code the moment the member tabbed
// to GitHub; the onboarding TAB persists. Best-effort focus an already-open onboarding tab (kept in
// chrome.storage.session) so repeated clicks do not spawn duplicate tabs. No "tabs" permission is needed: we
// only create/update/get by id (reading a tab's url/title would need it; checking existence + windowId does not).
const ONBOARDING_PAGE = 'onboarding.html';
async function openOnboardingTab() {
  const url = chrome.runtime.getURL(ONBOARDING_PAGE);
  try {
    const { onboardingTabId } = (await chrome.storage?.session?.get?.('onboardingTabId')) ?? {};
    if (onboardingTabId != null) {
      try {
        const t = await chrome.tabs.get(onboardingTabId); // rejects if the tab was closed
        await chrome.tabs.update(onboardingTabId, { active: true });
        if (t?.windowId != null) await chrome.windows.update(t.windowId, { focused: true });
        return;
      } catch { /* the remembered tab is gone; fall through and open a fresh one */ }
    }
    const created = await chrome.tabs.create({ url });
    if (created?.id != null) await chrome.storage?.session?.set?.({ onboardingTabId: created.id });
  } catch {
    try { await chrome.tabs.create({ url }); } catch { /* give up */ }
  }
}
chrome.action?.onClicked?.addListener(() => { openOnboardingTab(); });

// SOW-030: tell gbti.network content scripts (in any tab) that auth changed, so they re-stamp the page-safe
// identity signal. A service worker's chrome.runtime.sendMessage reaches extension pages, NOT content scripts,
// so we must message each gbti.network tab via chrome.tabs.sendMessage. The url filter is permitted by our
// https://gbti.network/* host permission (no "tabs" permission needed). Best-effort + carries NO data.
async function broadcastAuthChanged() {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://gbti.network/*' });
    for (const t of tabs) if (t.id != null) chrome.tabs.sendMessage(t.id, { type: 'auth-changed' }).catch(() => {});
  } catch { /* no tabs API / no matching tab */ }
}

/** Bring a tab (by id) to the foreground. Permission-free; reading the tab's url/title would need "tabs". */
async function focusTab(tabId, windowId) {
  if (tabId == null) return;
  try {
    await chrome.tabs.update(tabId, { active: true });
    if (windowId != null) await chrome.windows.update(windowId, { focused: true });
  } catch { /* tab closed */ }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const store = await getStore();
    try {
      if (msg?.type === 'api') {
        await ensureFreshToken(store); // SOW: refresh an about-to-expire token before the request reads GitHub
        maybeMintWebSession(store); // sow-158: opportunistic once-per-session website sign-in (fire-and-forget)
        sendResponse(await dispatch(buildExtContext(store), msg.req || {}));
      } else if (msg?.type === 'login') {
        const res = await handleLogin(store);
        // Device-flow sign-in ends on GitHub's "you're all set" page in a different tab. Route the member back
        // to the tab that started sign-in (the onboarding tab, or the gbti.network page) so they see step 2.
        if (res?.ok) { broadcastAuthChanged(); await focusTab(sender?.tab?.id, sender?.tab?.windowId); }
        sendResponse(res);
      } else if (msg?.type === 'signout') {
        store.set({ githubToken: null, githubRefreshToken: null, githubTokenExpiresAt: null, identity: null });
        // SOW-073: clear the local content caches (the workbench SWR cache gbti:wb:* and the SOW-064 create-recent
        // cache) so a signed-out member's owned-content metadata never survives on the device into another session.
        try {
          const all = await chrome.storage.local.get(null);
          const keys = Object.keys(all || {}).filter((k) => k.startsWith('gbti:wb:') || k === 'gbti:create-recent');
          if (keys.length) await chrome.storage.local.remove(keys);
        } catch { /* storage unavailable: best-effort */ }
        // sow-158: clear the once-per-session mint stamp so a later re-sign-in re-mints the website session. (The
        // extension does not clear the website cookie itself; the web Sign out + the 30-day TTL end it — v1 note.)
        try { await chrome.storage?.session?.remove?.('webSessionMinted'); } catch { /* best-effort */ }
        broadcastAuthChanged();
        sendResponse({ ok: true });
      } else if (msg?.type === 'open-page') {
        // SOW-036: the avatar menu (site header relay, or the new-tab dropdown) asks to open an in-extension
        // management page in a new tab. resolveOpenPage is the authoritative allowlist: only a known page +
        // a safe hash resolve, so a hostile gbti.network page cannot relay a request to open an arbitrary URL.
        const rel = resolveOpenPage({ page: msg.page, hash: msg.hash });
        if (!rel) { sendResponse({ ok: false, error: 'bad_page' }); return; }
        try {
          await chrome.tabs.create({ url: chrome.runtime.getURL(rel) });
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: e?.message ?? 'open_failed' });
        }
      } else if (msg?.type === 'devlog-recent' || msg?.type === 'devlog-clear') {
        // SOW-124: the Debug panel reads/clears the BACKGROUND realm's ring. Superadmin-gated (fail-closed): the
        // ring can carry redacted diagnostics, so only a superadmin caller gets it. The role is read from
        // house/roles.yml via the same path /api/status uses.
        let role = 'member';
        try { role = await computeRole(buildExtContext(store)); } catch { role = 'member'; }
        if (role !== 'superadmin') { sendResponse({ ok: false, error: 'forbidden' }); return; }
        if (msg.type === 'devlog-clear') { devlog.clear(); sendResponse({ ok: true }); }
        else sendResponse({ ok: true, entries: devlog.recent() });
      } else {
        sendResponse({ error: 'unknown_message' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message ?? String(err) });
    }
  })();
  return true; // keep the message channel open for the async sendResponse
});
