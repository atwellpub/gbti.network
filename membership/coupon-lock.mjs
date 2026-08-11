// sow-212 / SOW-119: the MINIMIZED coupon lock.
//
// Owner ruling (2026-08-11): "we do not want someone to be able to use the same coupon twice", so the
// one-coupon-per-member lock SURVIVES a right-to-erasure. That settles the question the opposite way from
// the default: erasure must NOT delete `coupon-grant:<githubId>`, because deleting it restores the abuse it
// exists to prevent.
//
// SecurityMaster's minimization branch is how both things hold at once. On erasure the raw-id record is
// replaced by a keyed HASH of the github_id, so the lock keeps working exactly as before while the stored
// artifact stops being a direct identifier. The system can still answer "has this account redeemed?" and can
// no longer answer "who has redeemed?" by reading its own keys.
//
// WHY KEYED (HMAC) RATHER THAN A PLAIN SALTED DIGEST. GitHub ids are small integers and fully enumerable, so
// an unsalted or publicly-salted hash of one is reversible in seconds by brute force and would provide no
// protection whatsoever. The salt must be a SECRET, which makes this an HMAC, so it is built as one using
// the same construction the Worker already uses for sessions and Stripe webhooks.
//
// Node-free on purpose: `crypto.subtle` is global in both the Cloudflare Workers runtime and Node 18+, so
// the Worker (which CHECKS the lock at redemption) and the erasure script (which WRITES it) share one
// implementation and can never disagree about the key.

const enc = new TextEncoder();

export const COUPON_LOCK_PREFIX = 'coupon-lock:';

const bytesToHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The KV key for a member's minimized coupon lock, or null when no salt is configured.
 *
 * Returning NULL rather than falling back to an unkeyed hash is deliberate and is the fail-closed choice at
 * both call sites: without the secret, the erasure step declines to minimize (and so declines to delete the
 * raw record, preserving the lock) and the redemption check declines to consult a key it cannot compute.
 * A weak lock that looks like a strong one is worse than an absent one.
 *
 * @param {string} salt       COUPON_LOCK_SALT, a secret. Absent/blank yields null.
 * @param {string|number} githubId
 * @returns {Promise<string|null>} `coupon-lock:<hex>`
 */
export async function couponLockKey(salt, githubId) {
  const secret = String(salt ?? '').trim();
  const id = String(githubId ?? '').trim();
  if (!secret || !id) return null;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`coupon-lock:${id}`));
  return `${COUPON_LOCK_PREFIX}${bytesToHex(sig)}`;
}

/**
 * The stored lock value. Deliberately carries NO code, NO timestamp and NO id: the only question it has to
 * answer is "does a lock exist", and every extra field is a correlation handle that minimization is
 * supposed to remove. A bare marker is the whole point.
 */
export const COUPON_LOCK_VALUE = JSON.stringify({ locked: true });
