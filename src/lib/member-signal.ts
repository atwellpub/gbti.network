// SOW-030: the site's consumer of the extension's PAGE-SAFE identity signal. The GBTI extension content script
// stamps document.documentElement.dataset.gbtiMember (a JSON string) and dispatches a `gbti:identity` event when
// a member is signed in (identity + membership status only, NEVER the GitHub token). The site uses this to show
// a signed-in / member experience when the extension is installed + signed in.
//
// IMPORTANT: this signal is UNTRUSTED for any security decision. Page JS (including any XSS) can set the
// attribute, so it drives PRESENTATION ONLY (show an avatar, reveal non-functional edit chrome). Every
// authoritative check stays server-side: the SOW-005 PR gate (ownership + paid), the Worker membership oracle,
// and CODEOWNERS. The inert <gbti-edit-panel> still self-activates only for the true owner via the
// worker-backed client; this signal only governs the chrome around it.

import { memberSignalFromStatus, selectIdentity } from './member-signal-core.mjs'; // sow-158 Phase 2: pure core

export interface MemberSignal {
  authenticated: true;
  login: string | null;
  githubId: string | null;
  username: string | null;
  role: string;
  membership: string;
  paidTier: string; // sow-185: the resolved paid tier ('none' | 'member' | 'creator'); fail-closed to 'none'
  canPublish: boolean;
  source?: 'cookie' | 'extension'; // sow-158 Phase 2: which producer set it (the cookie session wins over the extension)
}

/** Validate an already-parsed object into a MemberSignal, or null. Shared by the attribute + event paths. */
function coerce(o: unknown): MemberSignal | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  if (r.authenticated !== true) return null;
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return {
    authenticated: true,
    login: str(r.login),
    githubId: str(r.githubId),
    username: str(r.username),
    role: typeof r.role === 'string' ? r.role : 'member',
    membership: typeof r.membership === 'string' ? r.membership : 'unknown',
    paidTier: typeof r.paidTier === 'string' ? r.paidTier : 'none', // sow-185: fail-closed to 'none'
    canPublish: r.canPublish === true,
    source: 'extension', // sow-158 Phase 2: the attribute/event path is the extension signal (display-only)
  };
}

/** Parse the data-gbti-member JSON string into a MemberSignal, or null (missing / malformed / signed out). */
export function parseMemberSignal(raw: string | null | undefined): MemberSignal | null {
  if (!raw) return null;
  try {
    return coerce(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Read the current signal from the DOM (null in SSR or when no member signal is present). */
export function readMemberSignal(): MemberSignal | null {
  if (typeof document === 'undefined') return null;
  return parseMemberSignal(document.documentElement.dataset.gbtiMember);
}

// sow-158 Phase 2: the website httpOnly-cookie session state. The cookie is the REAL session and WINS over the
// extension's display-only signal (selectIdentity). onMemberSignal routes every extension event through the
// precedence selector, so a late extension gbti:identity event can never override a resolved cookie member.
const listeners = new Set<(s: MemberSignal | null) => void>();
let cookieResolved = false;
let cookieSignal: MemberSignal | null = null;
let hydrateStarted = false;

/** The effective identity given the resolved cookie session and an incoming extension signal (cookie wins). */
export function currentIdentity(extSignal: MemberSignal | null): MemberSignal | null {
  return selectIdentity({ cookieResolved, cookieSignal, extSignal }) as MemberSignal | null;
}

/** Subscribe to live sign-in/sign-out changes. Returns an unsubscribe fn. The cookie session takes precedence. */
export function onMemberSignal(cb: (s: MemberSignal | null) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  listeners.add(cb);
  const handler = (e: Event) => cb(currentIdentity(coerce((e as CustomEvent).detail)));
  document.addEventListener('gbti:identity', handler as EventListener);
  return () => { listeners.delete(cb); document.removeEventListener('gbti:identity', handler as EventListener); };
}

/** Reflect the signal onto <html> so components + CSS can react to a signed-in / paid member presentationally. */
export function applyMemberSignalClasses(s: MemberSignal | null): void {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.classList.toggle('is-gbti-member', !!s);
  el.classList.toggle('is-gbti-paid', s?.membership === 'paid');
  // SOW-050: an ACTIVE member is paid OR on trial (both are "members" for whom the Join CTA is irrelevant).
  el.classList.toggle('is-gbti-member-active', s?.membership === 'paid' || s?.membership === 'trialing');
  // sow-185: the resolved paid TIER, for a creator-only gate (the composer bar, Member-vs-Creator UI). A
  // superadmin / staff already resolves to 'creator' server-side, so this hook includes them. Presentation only.
  el.classList.toggle('is-gbti-creator', s?.paidTier === 'creator');
  if (s && s.paidTier) el.dataset.gbtiTier = s.paidTier;
  else delete el.dataset.gbtiTier;
  if (s && s.role) el.dataset.gbtiRole = s.role;
  else delete el.dataset.gbtiRole;
}

/** Read a cookie value by name from document.cookie (for the non-HttpOnly gbti_csrf). */
function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** The signup Worker origin, stamped site-wide on <html> by BaseLayout (data-signup-base). */
function readSignupBase(): string {
  if (typeof document === 'undefined') return '';
  return document.documentElement.dataset.signupBase || '';
}

/**
 * sow-158 Phase 2: hydrate the signed-in state from the httpOnly gbti_session cookie. Fetches the PUBLIC
 * /membership/status with credentials so the cookie rides along; the token NEVER enters the page. Cheap gate: with
 * no readable gbti_csrf cookie there is no web session, so it skips the network entirely (no Stripe hit on
 * anonymous pageloads). On a member it becomes the authoritative source (the cookie wins over the extension) and
 * notifies every registered consumer.
 */
const STATUS_CACHE_KEY = 'gbti_status_v1';
const STATUS_CACHE_TTL_MS = 120000; // 2 min: coalesce same-session navigations, short enough to reflect a fresh pay

/** Read the cached status signal for this csrf token, or undefined on a miss/stale/other-session. Presentation only. */
function readStatusCache(csrf: string): MemberSignal | null | undefined {
  try {
    const raw = sessionStorage.getItem(STATUS_CACHE_KEY);
    if (!raw) return undefined;
    const c = JSON.parse(raw);
    if (c.k !== csrf || typeof c.t !== 'number' || Date.now() - c.t > STATUS_CACHE_TTL_MS) return undefined;
    return c.s ?? null;
  } catch { return undefined; }
}
function writeStatusCache(csrf: string, signal: MemberSignal | null): void {
  try { sessionStorage.setItem(STATUS_CACHE_KEY, JSON.stringify({ k: csrf, t: Date.now(), s: signal })); } catch { /* no storage */ }
}

export async function hydrateMemberSignal(base: string = readSignupBase()): Promise<void> {
  if (typeof document === 'undefined' || hydrateStarted) return;
  hydrateStarted = true;
  const csrf = readCookie('gbti_csrf');
  if (!base || !csrf) { cookieResolved = true; cookieSignal = null; return; } // no web session -> no network at all
  // sessionStorage coalesces the Stripe-backed /membership/status fetch across same-session navigations (the
  // response is no-store and hits Stripe per call). Keyed by the csrf value so a re-login misses the old cache.
  let signal: MemberSignal | null | undefined = readStatusCache(csrf);
  if (signal === undefined) {
    // sow-158 re-login fix: resolveMemberSession distinguishes a DEFINITIVE signed-out (401 / no login) from a
    // TRANSIENT failure (a Worker deploy window, a network blip), retrying the transient case. CRITICAL: on a
    // transient error we do NOT write the cache, so one blip on first load cannot POISON the whole browser
    // session into a signed-out header (the old code cached the null and forced a re-login until re-auth).
    const { resolveMemberSession } = await import('./member-gate-core.mjs');
    const s = await resolveMemberSession({ base, fetchImpl: fetch });
    if (s.state === 'in') { signal = memberSignalFromStatus(s.payload) as MemberSignal | null; writeStatusCache(csrf, signal); }
    else if (s.state === 'out') { signal = null; writeStatusCache(csrf, signal); }
    else { signal = null; /* transient: leave the cache UNSET so the next navigation retries */ }
  }
  cookieResolved = true;
  cookieSignal = signal;
  if (signal) {
    applyMemberSignalClasses(signal);
    for (const cb of listeners) cb(currentIdentity(null)); // deliver the winning cookie signal to all consumers
  }
}

/**
 * sow-158 Phase 2: end the website session. Reads the readable gbti_csrf cookie for the double-submit header and
 * POSTs /auth/logout with credentials so the Worker clears both cookies (fail-closed CSRF + Origin check). No-op
 * when there is no web session. The caller reloads afterward so the page re-hydrates signed-out.
 */
export async function signOutWeb(base: string = readSignupBase()): Promise<void> {
  if (typeof document === 'undefined') return;
  try { sessionStorage.removeItem(STATUS_CACHE_KEY); } catch { /* no storage */ } // invalidate the cached member
  const csrf = readCookie('gbti_csrf');
  if (!base || !csrf) return;
  try {
    await fetch(base + '/auth/logout', { method: 'POST', credentials: 'include', headers: { 'X-GBTI-CSRF': csrf } });
  } catch { /* best effort; the reload + re-hydrate reflects reality */ }
}
