// SOW-166: the one-click unsubscribe route for the weekly digest. Auto-enrolment of members was granted on the
// explicit rider that a WORKING, non-deferrable one-click opt-out ships with it, so this is not a later phase:
// it is the control that makes forced enrolment lawful and protects the sending domain's reputation.
//
// RFC 8058 (List-Unsubscribe / List-Unsubscribe-Post), and WHY the split matters:
//   - A mail client that supports one-click sends a POST to the List-Unsubscribe URL with the body
//     `List-Unsubscribe=One-Click`. POST is what PERFORMS the unsubscribe here.
//   - Mail clients and security scanners routinely PREFETCH links with GET. If GET performed the unsubscribe,
//     a prefetch would silently opt people out. So GET NEVER mutates: it renders a confirmation page whose
//     button POSTs back to the same URL. Both paths converge on POST.
//
// THE TOKEN IS THE AUTHORIZATION (membership/mail-unsub-token.mjs). The clicker may have no account, so the
// route authenticates nobody: a valid capability token bound to the subscriber hash is the whole proof. The
// URL carries `?h=<mailHash>&t=<token>`; the hash is the pseudonymous mailHash, never the address, so the URL
// space is not enumerable and no address is exposed to a referrer or a proxy log. Verification is fail-closed:
// no secret configured, a malformed hash, or a bad token => NOTHING is suppressed.
//
// ORDER OF WRITES: suppress FIRST, then erase. The suppression marker must exist before the subscriber record
// is torn down, so there is never a window where the record is gone but the opt-out is not recorded (which
// would let a re-subscribe silently un-suppress). eraseSubscriberMail never touches the marker, so the two are
// independent and both idempotent; a retried POST is safe.
//
// INJECTABLE for unit testing (no network, no crypto stubs needed beyond crypto.subtle, which is global): kv,
// the verifier, the erase, and the suppress-write are all overridable, defaulting to the real implementations.

import { verifyUnsubRequest } from '../../membership/mail-unsub-token.mjs';
import { suppressKey, SUPPRESS_VALUE } from '../../membership/mail-suppress.mjs';
import { eraseSubscriberMail } from './mail-store.mjs';

/** Parse a rotation-fallback key list the same prototype-safe way membership-content resolves MEMBER_CONTENT_KEYS:
 *  a comma/space/newline-separated list of RETIRED unsubscribe keys still inside their grace window. The current
 *  key is MAIL_UNSUB_KEY; a token minted under a retired key keeps working until that key leaves the list. */
export function parseRetiredKeys(raw) {
  return String(raw ?? '')
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Escape a string for safe interpolation into HTML. The hash and token are machine-validated (64-hex and
 *  base64url), so this is defense in depth, not the primary guard. */
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Every response is uncacheable and leaks no referrer (the URL carries the capability token, so no-referrer
// keeps it out of any referer header the page might otherwise emit). text/html so a human sees a real page.
const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function page(title, bodyHtml, status = 200) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="referrer" content="no-referrer">`
    + `<title>${escapeHtml(title)}</title>`
    + `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
    + `max-width:34rem;margin:4rem auto;padding:0 1.25rem;line-height:1.55;color:#25232b;background:#fff}`
    + `h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:.5rem 0}`
    + `button{font:inherit;font-weight:600;padding:.6rem 1.1rem;border:0;border-radius:.5rem;`
    + `background:#1f9e5f;color:#fff;cursor:pointer}button:hover{background:#188a51}`
    + `.muted{color:#6c6976;font-size:.9rem}</style></head><body>${bodyHtml}</body></html>`;
  return new Response(html, { status, headers: PAGE_HEADERS });
}

/**
 * Handle GET/POST /mail/unsubscribe. GET renders a confirmation page (never mutates); POST performs the
 * unsubscribe when the capability token verifies. Injectable deps default to the real store + verifier.
 *
 * @returns {Promise<Response>}
 */
export async function handleUnsubscribe(request, env, deps = {}) {
  const {
    kv = env?.SIGNUP_KV,
    verify = verifyUnsubRequest,
    eraseMail = eraseSubscriberMail,
    writeSuppress = defaultWriteSuppress,
  } = deps;

  const method = String(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: PAGE_HEADERS });
  if (method !== 'GET' && method !== 'POST') {
    return page('Method not allowed', '<h1>Method not allowed</h1>', 405);
  }

  const url = new URL(request.url);
  const hash = url.searchParams.get('h') || '';
  const token = url.searchParams.get('t') || '';
  const secret = env?.MAIL_UNSUB_KEY || '';
  const retired = parseRetiredKeys(env?.MAIL_UNSUB_KEYS);

  // Verify the capability on BOTH methods: GET so the page shows the right message, POST as the security gate.
  // Fail-closed: verifyUnsubRequest returns { ok:false } for a missing secret, a malformed hash, or a bad token.
  const checked = await verify({ hash, token, secret, retired });

  if (method === 'GET') {
    if (!checked.ok) {
      return page('Unsubscribe link invalid',
        '<h1>This unsubscribe link is invalid or has expired.</h1>'
        + '<p class="muted">If you are still receiving the GBTI Network digest, use the unsubscribe link in the '
        + 'most recent email, or contact us.</p>');
    }
    // The confirm form POSTs back to THIS exact URL (path + query), so the token rides the POST, not a hidden
    // field. action is the current path+query, explicitly, and HTML-escaped.
    const action = escapeHtml(url.pathname + url.search);
    return page('Confirm unsubscribe',
      '<h1>Unsubscribe from the GBTI Network weekly digest?</h1>'
      + '<p>You will stop receiving the weekly email. You can re-subscribe any time from the site.</p>'
      + `<form method="POST" action="${action}"><button type="submit">Unsubscribe me</button></form>`);
  }

  // POST performs the unsubscribe.
  if (!checked.ok) {
    // A forged or expired token suppresses NOTHING. 400 is honest and leaks nothing: the hash is not
    // enumerable and the token binds to it, so "invalid" reveals no subscriber's existence.
    return page('Unsubscribe link invalid',
      '<h1>This unsubscribe link is invalid or has expired.</h1>'
      + '<p class="muted">Nothing was changed. Use the link in your most recent email, or contact us.</p>', 400);
  }

  // Suppress FIRST (records the opt-out permanently, survives erasure), then erase the mail records.
  let suppressed = false;
  try { suppressed = await writeSuppress(kv, checked.hash); } catch { suppressed = false; }
  if (!suppressed) {
    // The marker did not persist: do NOT report success, and do NOT erase (erasing without a marker would let a
    // re-subscribe silently un-suppress). Fail closed and let the caller retry.
    return page('Unsubscribe not completed',
      '<h1>We could not complete your unsubscribe just now.</h1>'
      + '<p class="muted">Please try the link again in a moment. You have not been unsubscribed yet.</p>', 503);
  }
  try { await eraseMail(kv, checked.hash); } catch { /* the marker is already written; erasure retries via reconcile */ }

  return page('Unsubscribed',
    '<h1>You have been unsubscribed.</h1>'
    + '<p>You will no longer receive the GBTI Network weekly digest. Sorry to see you go.</p>');
}

/** Write the pseudonymous suppression marker. Returns true on a persisted write, false on any failure or a
 *  missing kv/hash (so the caller can fail closed). The marker carries no address, timestamp or id. */
export async function defaultWriteSuppress(kv, hash) {
  const key = suppressKey(hash);
  if (!kv || !key) return false;
  await kv.put(key, SUPPRESS_VALUE);
  return true;
}
