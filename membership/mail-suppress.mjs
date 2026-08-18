// SOW-166: the one-way email identity + unsubscribe suppression for the weekly digest. Modeled EXACTLY on
// membership/coupon-lock.mjs (SecurityMaster's minimization construction), because the same reasoning applies:
// an email address is far more guessable than it is secret, so a plain or publicly-salted hash of one is
// reversible by anyone who can guess the address. The identity must therefore be a KEYED hash (HMAC under a
// standing Worker secret), which is what makes the stored suppression marker pseudonymous rather than a
// recoverable address.
//
// `mailHash(secret, email)` is the canonical subscriber identity used everywhere in the digest system: it is
// the `<hash>` in `mail:subscriber:<hash>` (the subscriber record), the `recipientHash` in
// `mail:send:<issueId>:<hash>` (the per-recipient send-state), and the `<hash>` in `mail:suppress:<hash>` (the
// unsubscribe marker). One email maps to exactly one hash, so subscribe is idempotent and unsubscribe can
// suppress by the same key without ever storing the address.
//
// NO ROTATION (carried from coupon-lock.mjs): rotating the key orphans every existing suppression marker,
// which silently un-suppresses people who asked not to be contacted. The suppression marker must OUTLIVE the
// subscriber record (unsubscribe hard-deletes the record but keeps the marker), so re-adding a suppressed
// address is caught before the next send.
//
// Node-free on purpose: `crypto.subtle` is global in both the Cloudflare Workers runtime and Node 18+, so the
// Worker (which writes the marker at unsubscribe and checks it before enrolling/sending) shares one
// implementation with any script that needs it and they can never disagree about the key.

const enc = new TextEncoder();

export const MAIL_SUPPRESS_PREFIX = 'mail:suppress:';
export const MAIL_SUBSCRIBER_PREFIX = 'mail:subscriber:';

const bytesToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Canonicalize an address for hashing: trim and lowercase. SecurityMaster condition 2 requires lowercasing
 *  both sides of any email match, and email addresses are treated case-insensitively in practice. Returns ''
 *  for a null/blank input, which mailHash rejects (fail-closed). */
export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * The one-way HMAC identity for an email, or null when no secret is configured or the email is blank.
 *
 * Returning NULL rather than an unkeyed hash is the fail-closed choice at every call site (copied from
 * couponLockKey): without the secret the subscribe path declines to create an identity it cannot reproduce
 * and the suppression check declines to consult a key it cannot compute. A weak identity that looks strong is
 * worse than an absent one. The hash carries a domain-separation label so it can never collide with another
 * use of the same key.
 *
 * @param {string} secret  MAIL_SUPPRESS_KEY, an HMAC key. Absent/blank yields null.
 * @param {string} email
 * @returns {Promise<string|null>} the lowercase hex digest (the bare hash, NOT a prefixed key)
 */
export async function mailHash(secret, email) {
  const key0 = String(secret ?? '').trim();
  const addr = normalizeEmail(email);
  if (!key0 || !addr) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(key0), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`mail-subscriber:${addr}`));
  return bytesToHex(sig);
}

/** The KV key for a subscriber's unsubscribe marker, from the bare hash. */
export function suppressKey(hash) {
  const h = String(hash ?? '').trim();
  if (!h) return null;
  return `${MAIL_SUPPRESS_PREFIX}${h}`;
}

/** The KV key for a subscriber record, from the bare hash. (The subscriber-record SHAPE lives in
 *  mail-subscriber.mjs; the key builder lives here beside mailHash so the two prefixes that derive from the
 *  same hash sit together.) */
export function subscriberKey(hash) {
  const h = String(hash ?? '').trim();
  if (!h) return null;
  return `${MAIL_SUBSCRIBER_PREFIX}${h}`;
}

/**
 * The stored suppression value. Deliberately carries NO address, NO timestamp and NO id: the only question it
 * answers is "has this address opted out", and every extra field is a correlation handle minimization is meant
 * to remove. A bare marker is the whole point.
 */
export const SUPPRESS_VALUE = JSON.stringify({ suppressed: true });
