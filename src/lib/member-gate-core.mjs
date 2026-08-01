// The node-testable core of the website's gated-page session resolver (member-gate.ts is the thin browser
// wrapper). Fixes the frequent re-login: the gated pages (workbench/account/admin/browse/news) used to treat
// ANY non-OK /membership/status as signed-out and redirect to /login, so a TRANSIENT failure (a Stripe blip, a
// Worker deploy window, a network hiccup) forced a needless re-login even though the 30-day session cookie was
// still valid. The oracle distinguishes the cases: 401 = genuinely signed out; 200 { ok, login } = signed in;
// >= 500 / a network throw = transient. So we retry the transient case and only ever redirect on a DEFINITIVE
// signed-out. Pure over an injected fetch + sleep; no DOM, no globals.

/**
 * Resolve the signed-in member from /membership/status, distinguishing a definitive signed-out from a transient
 * failure. Returns:
 *   { state: 'in',    payload }  -> a 200 with { ok:true, login }: mount.
 *   { state: 'out' }             -> a 401, or a 200 without a login: the caller signs the visitor out (redirect / CTA).
 *   { state: 'error' }           -> transient (network throw or >= 500) that persisted through the retries: the
 *                                   caller keeps the session and shows a soft retry, NEVER a forced logout.
 * @param {object} a
 * @param {string} a.base                 the signup Worker origin (document.documentElement.dataset.signupBase)
 * @param {Function} a.fetchImpl          injected fetch
 * @param {number} [a.retries=2]          transient retries before giving up
 * @param {Function} [a.sleep]            injected delay (ms) -> Promise, for testability (default a real timer)
 * @param {number} [a.backoffMs=700]      base backoff between transient retries
 */
export async function resolveMemberSession({ base, fetchImpl, retries = 2, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), backoffMs = 700 } = {}) {
  const url = `${base || ''}/membership/status`;
  for (let attempt = 0; ; attempt += 1) {
    let res;
    try {
      res = await fetchImpl(url, { credentials: 'include' });
    } catch {
      // Network throw = transient. Retry, or give up to 'error' (never a logout).
      if (attempt < retries) { await sleep(backoffMs * (attempt + 1)); continue; }
      return { state: 'error' };
    }
    const status = res?.status ?? 0;
    if (status === 401) return { state: 'out' }; // definitive: no/invalid session — never retried
    if (status >= 500 || status === 0) {
      if (attempt < retries) { await sleep(backoffMs * (attempt + 1)); continue; } // transient: retry
      return { state: 'error' };
    }
    // A 2xx/3xx/4xx-other response: read the body. A signed-in member carries { ok:true, login }.
    let payload = null;
    try { payload = res.ok ? await res.json() : null; } catch { payload = null; }
    if (payload && payload.ok === true && payload.login) return { state: 'in', payload };
    return { state: 'out' }; // a 200 without a login (or a non-2xx that was not 401/5xx) is a definitive signed-out
  }
}
