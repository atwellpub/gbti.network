// SOW-166: the PURE double-opt-in core for anonymous digest subscription. No IO and no crypto (the caller does
// the KV writes, the mailHash, and the emailEnc envelope); this module is only the record shape, the key builder,
// the email-shape check, and the TTL, so the whole thing is unit-tested with plain values.
//
// WHY A SEPARATE PREFIX. A not-yet-confirmed opt-in must NEVER be treated as a recipient. The compile walks
// `mail:subscriber:<hash>` (mail-suppress.mjs MAIL_SUBSCRIBER_PREFIX) and `mail:pending:<issueId>` is already the
// per-issue send index (mail-store.mjs), so the pending opt-in lives under its OWN prefix `mail:optin:<hash>`. A
// pending record is therefore invisible to listRecipientHashes and cannot be mailed; only the confirm step, which
// promotes it to a real `mail:subscriber:<hash>` record, makes the address a recipient. Double-opt-in is exactly
// this: receiving the confirmation email proves control of the mailbox, and clicking confirm proves the human
// consented, so nobody is enrolled by a third party typing their address into the form.
//
// THE RECORD CARRIES NO RAW ADDRESS. `emailEnc` is the opaque AES-256-GCM envelope (mail-address.mjs, bound to
// the hash), stored as a JSON string exactly as the final subscriber record stores it, so confirm can promote it
// straight across with no re-encryption and no plaintext address ever touching KV. The `nonce` is a random bearer
// secret the confirm link carries; confirm compares it timing-safe against this record. The hash is the one-way
// mailHash identity, so the key space is not enumerable and the record holds no correlation handle beyond it.

export const MAIL_OPTIN_PREFIX = 'mail:optin:';

// A pending opt-in that is never confirmed self-prunes after 48h. This is the whole retention of an unconfirmed
// address: an abandoned opt-in leaves nothing behind once the TTL lapses (the emailEnc goes with it).
export const OPTIN_TTL_SECONDS = 48 * 60 * 60;

/** Thrown for caller-input problems; a handler maps it to a neutral outcome, never a 500. */
export class OptInError extends Error {}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/**
 * A conservative email-shape check for the capture form. It is deliberately strict rather than RFC-complete: a
 * launch does not need internationalized or quoted-local-part addresses, and rejecting the exotic shapes keeps a
 * malformed or injected value from ever reaching mailHash. The real proof an address is deliverable is the
 * confirmation email, not this regex; this only screens obvious garbage before we spend a send on it.
 */
export function isValidEmailShape(email) {
  const s = str(email).trim();
  if (s.length < 3 || s.length > 254) return false;
  if (/\s/.test(s)) return false; // no whitespace anywhere
  if (/[^\x21-\x7e]/.test(s)) return false; // printable ASCII only (no control chars, no unicode)
  const at = s.indexOf('@');
  if (at <= 0 || at !== s.lastIndexOf('@')) return false; // exactly one '@', and not the first character
  const local = s.slice(0, at);
  const domain = s.slice(at + 1);
  if (!local || !domain) return false;
  if (!domain.includes('.')) return false; // a domain needs a dot
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) return false;
  return true;
}

/** The KV key for a pending opt-in, from the bare mailHash. Null for a blank hash so a bad key never reaches KV. */
export function optinKey(hash) {
  const h = str(hash).trim();
  return h ? `${MAIL_OPTIN_PREFIX}${h}` : null;
}

/**
 * Build a pending opt-in record. PURE. Requires the hash, the opaque emailEnc string, and the nonce. Rejects any
 * missing field (an opt-in with no way to confirm or no address to promote is useless). `now` is injected.
 */
export function buildPendingOptIn({ hash, emailEnc, nonce } = {}, { now = Date.now } = {}) {
  const h = str(hash).trim();
  const enc = str(emailEnc).trim();
  const n = str(nonce).trim();
  if (!h) throw new OptInError('hash is required');
  if (!enc) throw new OptInError('emailEnc is required');
  if (!n) throw new OptInError('nonce is required');
  return { hash: h, emailEnc: enc, nonce: n, createdAt: Number(now()) };
}

/** Defensive: coerce a stored value into the canonical opt-in shape, or null when it is not usable. */
export function normalizePendingOptIn(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hash = str(raw.hash).trim();
  const emailEnc = str(raw.emailEnc).trim();
  const nonce = str(raw.nonce).trim();
  if (!hash || !emailEnc || !nonce) return null;
  const createdAt = Number(raw.createdAt);
  return { hash, emailEnc, nonce, createdAt: Number.isFinite(createdAt) ? createdAt : 0 };
}
