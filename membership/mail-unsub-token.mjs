// SOW-166: the one-click unsubscribe capability token. Sits beside membership/mail-suppress.mjs and reuses its
// construction (keyed HMAC + a domain-separation label + fail-closed on a missing secret) rather than inventing
// a second scheme.
//
// WHAT THE TOKEN IS FOR. The unsubscribe link is clicked from an email by someone who may have no account at
// all, so the route cannot authenticate anybody. The token IS the authorization: holding a valid one proves
// control of the mailbox the issue was sent to, and nothing else. That makes it a capability, and the two
// properties it must have follow directly:
//   NOT FORGEABLE   - nobody without the key can mint one, so a stranger cannot unsubscribe someone else.
//   NOT ENUMERABLE  - holding one token reveals nothing about any other subscriber, and the URL space cannot
//                     be walked. This comes free from binding to mailHash, which is itself an HMAC of the
//                     address: there is no ordering to iterate and no address in the URL to harvest.
//
// A THIRD SECRET, AND THE REASON IS ROTATION AND NOT CAUTION. Reusing MAIL_SUPPRESS_KEY under a second label
// would be cryptographically sound (that is exactly what domain separation is for) and would save a secret.
// It is still wrong here, because the two keys have OPPOSITE rotation stories and sharing one welds them
// together:
//   MAIL_SUPPRESS_KEY   must NEVER rotate. mail-suppress.mjs says so in its own header: rotating it orphans
//                       every suppression marker, which silently re-contacts people who asked not to be.
//   MAIL_UNSUB_KEY      must be ABLE to rotate, because it is a signing key reachable from the open internet
//                       and a signing key that can never be replaced after a suspected leak is a dead end.
// Welded together, the second requirement loses to the first and the token key becomes unrotatable too.
//
// NO EXPIRY IN THE TOKEN, DELIBERATELY. An opt-out that stops working is user-hostile and legally exposed
// (CAN-SPAM expects the mechanism to keep working for at least 30 days after a send, and a digest issue can be
// read much later than that). So there is no timestamp to verify and no clock in this module. Rotation is
// handled by KID FALLBACK at the call site instead, the way MEMBER_CONTENT_KID / MEMBER_CONTENT_KEYS already
// does it for content: verify against the current key, then any retired key still inside its grace window. A
// token minted under the old key keeps working until that window closes, which is the property an expiry field
// would have destroyed.
//
// Node-free on purpose, same as mail-suppress.mjs: `crypto.subtle` is global in both the Workers runtime and
// Node 18+, so the Worker that VERIFIES and the compile step that MINTS share one implementation and can never
// drift apart about how a token is formed.

const enc = new TextEncoder();

/** Domain separation, so an HMAC here can never be confused with mail-suppress.mjs's `mail-subscriber:` one
 *  even if the same key were ever supplied to both by mistake. */
const UNSUB_LABEL = 'mail-unsubscribe:';

/** base64url, unpadded: survives a query string with no percent-encoding, so the link cannot be mangled by a
 *  mail client that rewrites URLs. */
function bytesToB64Url(buf) {
  let s = '';
  const b = new Uint8Array(buf);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Compare two strings without leaking WHERE they differ through timing.
 *
 * The length check returns early and therefore leaks the length, which is fine and is not a shortcut: every
 * valid token is exactly 43 characters (base64url of a 32-byte HMAC), so the length is a fixed public constant
 * and learning it tells an attacker nothing they could not read in this file. What must not leak is the
 * position of the first differing byte, because that is what turns forgery from 2^256 guesses into 43 cheap
 * ones, and the accumulate-then-compare below is what prevents it.
 */
export function timingSafeEqual(a, b) {
  const A = String(a ?? '');
  const B = String(b ?? '');
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A.charCodeAt(i) ^ B.charCodeAt(i);
  return diff === 0;
}

/**
 * Mint the unsubscribe token for a subscriber hash. The compile step calls this once per recipient per issue.
 *
 * Returns null when the secret or the hash is missing, exactly as mailHash does, so a misconfigured Worker
 * produces NO LINK rather than a weak one. A token that looks valid but is not is worse than an absent token,
 * because the absent one is noticed.
 *
 * @param {string} secret MAIL_UNSUB_KEY
 * @param {string} hash   the mailHash identity (mail-suppress.mjs), NOT an email address
 */
export async function makeUnsubToken(secret, hash) {
  const key0 = String(secret ?? '').trim();
  const h = String(hash ?? '').trim();
  if (!key0 || !h) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(key0), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${UNSUB_LABEL}${h}`));
  return bytesToB64Url(sig);
}

/**
 * Verify a presented token against one key. False on every failure path, and there is no path that returns
 * true without a real HMAC match.
 */
export async function verifyUnsubToken(secret, hash, token) {
  const presented = String(token ?? '').trim();
  if (!presented) return false;
  const expected = await makeUnsubToken(secret, hash);
  if (!expected) return false; // no secret configured: fail closed, never admit
  return timingSafeEqual(expected, presented);
}

/**
 * The route-shaped verifier: accept the CURRENT key, and any retired key still inside its rotation grace
 * window, so rotating MAIL_UNSUB_KEY does not break links in issues already delivered.
 *
 * `retired` is an optional array of previous key strings (the caller parses MAIL_UNSUB_KEYS, prototype-safe,
 * the way membership-content.mjs resolves MEMBER_CONTENT_KEYS). Order does not matter; every candidate is
 * tried and the result is a plain boolean, so no information about WHICH key matched reaches the caller.
 *
 * Returns { ok, hash } so the route can go straight to suppressKey(hash) with no second parse.
 */
export async function verifyUnsubRequest({ hash, token, secret, retired = [] }) {
  const h = String(hash ?? '').trim();
  if (!h) return { ok: false, hash: null };
  // A hash is a SHA-256 hex digest. Rejecting anything else keeps a malformed or injected identifier from ever
  // reaching a KV key builder, and costs nothing because the value is machine-generated on our own side.
  //
  // A LENGTH TEST PLUS A NEGATED CLASS, NOT AN ANCHORED MATCH.
  //
  // CORRECTED 2026-08-22 (@UnifiedWorker caught it, verified on node v22). This comment previously claimed
  // that JS `$` matches immediately before a trailing newline, so /^[0-9a-f]{64}$/ would accept "<64 hex>\n".
  // THAT IS FALSE IN JAVASCRIPT: without the `m` flag, `$` matches only the true end of input. The
  // before-a-final-newline behaviour belongs to Perl, PCRE and Python. Left visible rather than deleted so the
  // folklore is not reintroduced by someone who half-remembers it, as I did.
  //
  // The form is still the right one, on reasons that hold: an explicit LENGTH CHECK is exact where a quantifier
  // is easy to misread, and a negated class states "no character outside this set" directly, with no anchor
  // semantics to get wrong. The true JS behaviour is pinned in test/member-followers.test.mjs.
  if (h.length !== 64 || /[^0-9a-f]/.test(h)) return { ok: false, hash: null };
  for (const candidate of [secret, ...(Array.isArray(retired) ? retired : [])]) {
    // eslint-disable-next-line no-await-in-loop -- at most a handful of keys, and they must be tried serially
    if (await verifyUnsubToken(candidate, h, token)) return { ok: true, hash: h };
  }
  return { ok: false, hash: null };
}
