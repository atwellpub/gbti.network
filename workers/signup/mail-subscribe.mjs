// SOW-166: the anonymous double-opt-in subscribe + confirm routes for the weekly digest.
//
// TWO ROUTES, ONE FLOW.
//   POST /mail/subscribe  a visitor submits an email. We validate it, gate abuse (rate limit + Turnstile), and
//                         write a PENDING opt-in (mail:optin:<hash>, the emailEnc envelope + a random nonce, a
//                         48h TTL), then send ONE transactional confirmation email carrying a confirm link. We
//                         create NO recipient here, so an address typed by a third party is never enrolled.
//   GET/POST /mail/confirm  the link from that email. GET renders a confirm page (never mutates, so a mail-client
//                         prefetch cannot auto-confirm and defeat the point of double opt-in); POST promotes the
//                         pending opt-in into a real active subscriber (mail:subscriber:<hash>) and deletes the
//                         pending record. Only after this is the address a recipient.
//
// ANTI-ENUMERATION. Every well-formed subscribe returns the SAME neutral response whether the address is new,
// already active, or previously suppressed. The side effect differs, but the requester cannot observe which one
// ran, so the endpoint cannot be used to probe who is subscribed. Only a MALFORMED input (400), a rate limit
// (429), or a failed challenge (403) returns a different status, and none of those reveal a subscriber's
// existence.
//
// THE ADDRESS NEVER LANDS IN KV IN PLAINTEXT. subscribe encrypts it under MAIL_EMAIL_KEY bound to the hash
// (mail-address.mjs) before writing the pending record, and confirm promotes that same opaque envelope into the
// subscriber record with no re-encryption, so no code path stores a raw '@' (the leak-guard the subscriber core
// already carries).
//
// FAIL-CLOSED ON A PRIOR OPT-OUT (owner policy call, filed). A suppressed address is NOT re-contacted and NOT
// re-subscribed by this route: the safe default honors the opt-out. Whether an explicit form resubmission should
// count as fresh consent and lift the suppression (via a confirm click) is the owner's decision; until it is
// made, the strict default stands, because silently re-contacting someone who unsubscribed is the worse error.
//
// INJECTABLE (kv, the abuse checks, the mail sender, now) so the whole thing is unit-tested with a fake KV and no
// network. Everything is best-effort + fail-closed: an unprovisioned or erroring dependency yields the neutral
// response and enrolls nobody, never a 500 that leaks internals.

import { mailHash, suppressKey } from '../../membership/mail-suppress.mjs';
import { encryptEmail } from '../../membership/mail-address.mjs';
import { buildSubscriber } from '../../membership/mail-subscriber.mjs';
import { timingSafeEqual } from '../../membership/mail-unsub-token.mjs';
import {
  isValidEmailShape, optinKey, buildPendingOptIn, normalizePendingOptIn, OPTIN_TTL_SECONDS,
} from '../../membership/mail-optin.mjs';
import { getSubscriber, putSubscriber } from './mail-store.mjs';
import { verifyTurnstile, rateLimit } from './abuse.mjs';
import { createResendClient } from '../../clients/resend.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// Anonymous, no ambient credential (no cookie, no bearer), so a wildcard origin is safe: there is nothing for a
// cross-origin page to ride. Same posture as /touch.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

function escapeHtml(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

/** A machine-generated 64-hex mailHash. Validate before building a KV key from a URL-supplied hash. */
function isHashShape(h) {
  return typeof h === 'string' && h.length === 64 && !/[^0-9a-f]/.test(h);
}

/** A random bearer nonce for the confirm link (base64url, unpadded, 32 bytes of entropy). */
function randomNonce() {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wantsJson(request) {
  const accept = (request.headers.get('accept') || '').toLowerCase();
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  return accept.includes('application/json') || ct.includes('application/json');
}

/** Read the email + Turnstile token from a JSON body or a urlencoded/multipart form body. */
async function readSubscribeInput(request) {
  const ct = (request.headers.get('content-type') || '').toLowerCase();
  try {
    if (ct.includes('application/json')) {
      const b = await request.json();
      return { email: b?.email, turnstileToken: b?.turnstileToken || b?.['cf-turnstile-response'] };
    }
    const form = await request.formData();
    return {
      email: form.get('email'),
      turnstileToken: form.get('cf-turnstile-response') || form.get('turnstileToken'),
    };
  } catch {
    return { email: null, turnstileToken: null };
  }
}

/** The single neutral subscribe outcome (JSON for a fetch, an HTML page for a no-JS form navigation). */
function neutralResult(request) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
    });
  }
  return page('Almost done',
    '<h1>Almost done. Please check your inbox.</h1>'
    + '<p>If this address is new to the GBTI Network digest, we just sent a confirmation email. '
    + 'Click the link in it to start receiving the weekly digest.</p>');
}

/** An error outcome that carries no subscriber information (JSON for a fetch, an HTML page otherwise). */
function errorResult(request, code, status) {
  if (wantsJson(request)) {
    return new Response(JSON.stringify({ ok: false, error: code }), {
      status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS },
    });
  }
  const msg = code === 'invalid_email' ? 'That does not look like a valid email address.'
    : code === 'rate_limited' ? 'Too many requests. Please try again in a few minutes.'
      : code === 'challenge_failed' ? 'We could not verify that request. Please try again.'
        : 'Your request could not be completed.';
  return page('Subscription not sent', `<h1>${escapeHtml(msg)}</h1>`, status);
}

async function readOptin(kv, hash) {
  const key = optinKey(hash);
  if (!kv || !key) return null;
  let raw = null;
  try { raw = await kv.get(key, 'json'); } catch { return null; }
  return normalizePendingOptIn(raw);
}

async function deleteOptin(kv, hash) {
  const key = optinKey(hash);
  if (!kv || !key) return;
  try { await kv.delete(key); } catch { /* best effort; the TTL prunes it */ }
}

/** Send the transactional double-opt-in confirmation email. Best-effort: returns false (never throws) when the
 *  send is unprovisioned or fails, so subscribe stays neutral and the pending record survives for a re-send. */
async function sendConfirmationEmail({ env, to, confirmUrl, send }) {
  const from = str(env?.MAIL_FROM).trim();
  const apiKey = str(env?.RESEND_API_KEY).trim();
  if (!from || !to || !confirmUrl) return false;
  const subject = 'Confirm your GBTI Network digest subscription';
  const text = 'Thanks for subscribing to the GBTI Network weekly digest.\n\n'
    + 'Please confirm your email address to start receiving it:\n'
    + `${confirmUrl}\n\n`
    + 'If you did not request this, you can ignore this email and you will not be subscribed.\n\n'
    + 'GBTI Network';
  const safeUrl = escapeHtml(confirmUrl);
  const html = '<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#25232b;line-height:1.55">'
    + '<p>Thanks for subscribing to the GBTI Network weekly digest.</p>'
    + '<p>Please confirm your email address to start receiving it:</p>'
    + `<p><a href="${safeUrl}" style="display:inline-block;background:#1f9e5f;color:#fff;text-decoration:none;font-weight:600;padding:.6rem 1.1rem;border-radius:.5rem">Confirm subscription</a></p>`
    + `<p style="color:#6c6976;font-size:.9rem">Or paste this link into your browser:<br>${safeUrl}</p>`
    + '<p style="color:#6c6976;font-size:.9rem">If you did not request this, you can ignore this email and you will not be subscribed.</p>'
    + '<p>GBTI Network</p></body></html>';
  const sender = typeof send === 'function'
    ? send
    : (apiKey ? createResendClient({ apiKey }).sendEmail : null);
  if (!sender) return false;
  try { await sender({ from, to, subject, text, html }); return true; } catch { return false; }
}

/**
 * POST /mail/subscribe. Anonymous capture with abuse gating and double opt-in. Returns a Response (JSON or an
 * HTML page by content negotiation). Injectable deps default to the real store, abuse checks, and Resend.
 */
export async function handleSubscribe(request, env, deps = {}) {
  const {
    kv = env?.SIGNUP_KV,
    verifyTurnstileFn = verifyTurnstile,
    rateLimitFn = rateLimit,
    send, // injectable Resend sender for tests
    now = Date.now,
  } = deps;

  const method = str(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (method !== 'POST') return errorResult(request, 'method_not_allowed', 405);

  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Rate limit first (cheap; the endpoint spends a transactional send, so it is a spam vector). A limiter error
  // must not lock out a genuine subscriber, so it is non-fatal: the send is still config-gated below.
  try {
    const rl = await rateLimitFn({ kv, ip, limit: 5, windowSeconds: 600, prefix: 'rl:mailsub:' });
    if (rl && rl.allowed === false) return errorResult(request, 'rate_limited', 429);
  } catch { /* non-fatal */ }

  const { email, turnstileToken } = await readSubscribeInput(request);
  const addr = str(email).trim();
  if (!isValidEmailShape(addr)) return errorResult(request, 'invalid_email', 400);

  // Turnstile is required WHEN a secret is configured (production). Absent secret (local/test) skips it, and the
  // route is still behind the rate limit and the config-gated send.
  const tsSecret = str(env?.TURNSTILE_SECRET_KEY).trim();
  if (tsSecret) {
    const ok = await verifyTurnstileFn({ token: turnstileToken, secret: tsSecret, remoteIp: ip });
    if (!ok) return errorResult(request, 'challenge_failed', 403);
  }

  // From here every path returns the SAME neutral response (anti-enumeration).
  const neutral = neutralResult(request);

  const suppressSecret = str(env?.MAIL_SUPPRESS_KEY).trim();
  const emailKey = str(env?.MAIL_EMAIL_KEY).trim();
  if (!kv || !suppressSecret || !emailKey) return neutral; // inert until provisioned

  const hash = await mailHash(suppressSecret, addr);
  if (!hash) return neutral;

  // Fail-closed on a prior opt-out (owner policy call, filed): a suppressed address is not re-contacted here.
  try {
    const sk = suppressKey(hash);
    if (sk && (await kv.get(sk))) return neutral;
  } catch { return neutral; }

  // Idempotent: an already-active subscriber gets no second confirmation.
  try {
    const existing = await getSubscriber(kv, hash);
    if (existing && existing.status === 'active') return neutral;
  } catch { /* a read error must not block a genuine new subscribe */ }

  // Encrypt the address (bound to the hash) and write a fresh pending opt-in. Re-subscribing before confirming
  // overwrites the prior pending record with a new nonce + TTL, so the newest link is the one that works.
  const envelope = await encryptEmail({ key: emailKey, hash, email: addr });
  if (!envelope) return neutral;
  const nonce = randomNonce();
  let pending;
  try {
    pending = buildPendingOptIn({ hash, emailEnc: JSON.stringify(envelope), nonce }, { now });
  } catch { return neutral; }
  const key = optinKey(hash);
  if (!key) return neutral;
  // A failed opt-in WRITE means confirmation can never succeed (there is no pending record to promote later). Keep
  // the response byte-identical (neutral is the anti-enumeration answer), but do NOT swallow the failure into an
  // indistinguishable "check your email": surface it so it is visible in the Worker logs, not found by a user who
  // never gets confirmed. (SecurityMaster, 2026-08-22.)
  try { await kv.put(key, JSON.stringify(pending), { expirationTtl: OPTIN_TTL_SECONDS }); }
  catch (e) { console.warn(`mail-subscribe: pending opt-in write failed for subscriber ${hash}: ${e?.message || e}`); return neutral; }

  // Send the confirmation (transactional, NOT the bulk digest send gate). The confirm link points back at THIS
  // Worker (PUBLIC_BASE_URL, falling back to the request origin), the same origin that serves /mail/confirm.
  const base = str(env?.PUBLIC_BASE_URL).trim().replace(/\/$/, '') || new URL(request.url).origin;
  const confirmUrl = `${base}/mail/confirm?h=${encodeURIComponent(hash)}&t=${encodeURIComponent(nonce)}`;
  // CAPTURE the confirmation-send outcome. sendConfirmationEmail returns false when RESEND_API_KEY / the sender is
  // absent, MAIL_FROM is unset, or the send throws. With this discarded (the old code did), a mail-provisioning gap
  // failed EVERY subscriber silently: they see the neutral "check your email" page, a pending opt-in sits in KV
  // until its TTL, and nothing reports it. The response stays neutral (the anti-enumeration property is unchanged);
  // the boolean is captured for a log so a broken provisioning is visible, not discovered by a missing email.
  const confirmed = await sendConfirmationEmail({ env, to: addr, confirmUrl, send });
  if (!confirmed) console.warn(`mail-subscribe: confirmation send did not complete for subscriber ${hash} (check RESEND_API_KEY / MAIL_FROM)`);
  return neutral;
}

/**
 * GET/POST /mail/confirm. GET renders a confirmation page (never mutates); POST promotes the pending opt-in into
 * an active subscriber. The nonce in the link is the authorization; it is compared timing-safe against the stored
 * pending record. Fail-closed on a malformed hash, an absent/expired opt-in, or a nonce mismatch.
 */
export async function handleConfirm(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now } = deps;

  const method = str(request.method || 'GET').toUpperCase();
  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: PAGE_HEADERS });
  if (method !== 'GET' && method !== 'POST') return page('Method not allowed', '<h1>Method not allowed</h1>', 405);

  const url = new URL(request.url);
  const hash = (url.searchParams.get('h') || '').trim();
  const token = (url.searchParams.get('t') || '').trim();

  const invalid = (status = 200) => page('Subscription link invalid',
    '<h1>This confirmation link is invalid or has expired.</h1>'
    + '<p class="muted">Confirmation links expire after 48 hours. If you still want the GBTI Network digest, '
    + 'subscribe again from the site.</p>', status);
  const notCompleted = () => page('Subscription not confirmed',
    '<h1>We could not confirm your subscription just now.</h1>'
    + '<p class="muted">Please try the link again in a moment. You have not been subscribed yet.</p>', 503);

  if (!isHashShape(hash)) return invalid(method === 'POST' ? 400 : 200);

  const pending = await readOptin(kv, hash);
  const valid = Boolean(pending) && timingSafeEqual(pending.nonce, token);

  if (method === 'GET') {
    if (!valid) return invalid();
    // The confirm button POSTs back to THIS exact URL (path + query), so the nonce rides the POST, not a hidden
    // field, and a prefetch of the GET never mutates.
    const action = escapeHtml(url.pathname + url.search);
    return page('Confirm your subscription',
      '<h1>Confirm your subscription to the GBTI Network weekly digest.</h1>'
      + '<p>Click the button below to start receiving the weekly email.</p>'
      + `<form method="POST" action="${action}"><button type="submit">Confirm subscription</button></form>`);
  }

  // POST performs the activation.
  if (!valid) return invalid(400);

  // Belt and suspenders: if the address opted out between subscribe and confirm, do not activate it.
  try {
    const sk = suppressKey(hash);
    if (sk && (await kv.get(sk))) {
      await deleteOptin(kv, hash);
      return page('Subscription not confirmed',
        '<h1>This address has opted out.</h1>'
        + '<p class="muted">It was unsubscribed and will not be re-subscribed. Contact us if this is unexpected.</p>');
    }
  } catch { return notCompleted(); } // a suppression-check error fails closed: do not activate

  // Promote the pending opt-in into an active subscriber, reusing the stored emailEnc (no raw email at confirm).
  let stored = null;
  try {
    const rec = buildSubscriber({ hash, source: 'anon', emailEnc: pending.emailEnc }, { now });
    stored = await putSubscriber(kv, rec);
  } catch { stored = null; }
  if (!stored) return notCompleted();

  await deleteOptin(kv, hash); // best-effort: the subscriber is active; a stray opt-in expires on its TTL

  return page('Subscribed',
    '<h1>You are subscribed.</h1>'
    + '<p>You will receive the GBTI Network weekly digest. Every email includes a one-click unsubscribe link.</p>');
}
