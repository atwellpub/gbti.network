// SOW-166: bind a subscriber's raw email into an encrypted envelope keyed to their non-reversible mailHash,
// and recover it fail-closed. The platform stores NO raw email of its own (data-protection.md:49): a paid
// member's address lives only on their Stripe Customer, and an ANONYMOUS subscriber's address lives only inside
// this envelope on their subscriber record, under a standing Worker key. The mailHash is the subscriber id and
// is already non-reversible, so binding it as the AAD is safe and is exactly what stops one subscriber's
// ciphertext from being decrypted under another subscriber's record.
//
// PURE over an injected key (client/src/crypto-assets.mjs is node-free AES-256-GCM over globalThis.crypto), so
// it is fully unit-tested with a fixed key and no IO. The subscribe route calls encryptEmail; the drain's
// resolveAddress calls decryptEmail. This module is the single coupling point between them, so the two AAD
// traps live in ONE place instead of being re-reasoned at each call site.
//
// TWO TRAPS, both load-bearing (SecurityMaster):
//   1. The AAD is the mailHash, NEVER the email. encryptAsset writes `aad` in CLEARTEXT into the envelope, so
//      binding the address there would leak the very thing the envelope exists to hide. We bind the hash.
//   2. decryptAsset authenticates the envelope's OWN aad but does not check it against the record it was read
//      under. So decryptEmail MUST assert envelope.aad === the expected hash before trusting the plaintext, or
//      a confused-deputy read (subscriber A's valid envelope stored under B's record) returns A's address under
//      B's key. GCM would not catch that: A's envelope is internally consistent. This module catches it.

import { encryptAsset, decryptAssetText } from '../client/src/crypto-assets.mjs';

// A mailHash is 64 lowercase hex (HMAC-SHA-256, membership/mail-suppress.mjs). Normalize + validate so a caller
// can neither bind to nor match against a malformed id: an empty or non-hex "hash" must never be accepted, or a
// tampered envelope.aad of '' could compare equal to a '' expected hash and defeat trap 2.
function normalizeHash(hash) {
  const h = typeof hash === 'string' ? hash.trim().toLowerCase() : '';
  return /^[0-9a-f]{64}$/.test(h) ? h : '';
}

/**
 * Encrypt one email address into an envelope bound to `hash` (the subscriber's mailHash). Returns the envelope
 * object { v, kid, iv, aad, ct } for storage on the subscriber record, or null when the inputs are unusable (no
 * key, a malformed hash, or a blank email) so a caller can never accidentally store an unencrypted or unbound
 * address. Fail-closed: any crypto error is null, never a throw.
 */
export async function encryptEmail({ key, hash, email, kid = '1' }) {
  const h = normalizeHash(hash);
  const addr = typeof email === 'string' ? email.trim() : '';
  if (!key || !h || !addr) return null;
  try {
    // assetId === h => the envelope's AAD is the hash (trap 1). Never pass the address here.
    return await encryptAsset({ plaintext: addr, key, assetId: h, kid });
  } catch {
    return null;
  }
}

/**
 * Recover the email from an envelope, ASSERTING it was bound to `hash`. Returns the address string, or null
 * fail-closed on: an absent key/hash/envelope, an envelope aad that does not equal the expected hash (trap 2,
 * the confused-deputy guard), or any decrypt/auth failure (wrong key, wrong epoch, tampered ct/iv/aad). Never
 * throws to the caller: an unreadable address is null, and the drain treats null as "no usable address".
 */
export async function decryptEmail({ key, hash, envelope }) {
  const h = normalizeHash(hash);
  if (!key || !h || !envelope || typeof envelope !== 'object') return null;
  // Trap 2: compare the envelope's bound id to THIS record's hash BEFORE decrypting, so a mismatched envelope
  // never even attempts a read under the wrong key. Exact match against the normalized 64-hex hash: a
  // differently-cased or padded aad is rejected rather than normalized into a match.
  if (String(envelope.aad) !== h) return null;
  try {
    const email = await decryptAssetText({ envelope, key });
    return email || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a subscriber record to a raw email for sending. BI-MODAL by design (mail-subscriber.mjs): an ANON
 * subscriber carries the address as an emailEnc envelope on its OWN record (decrypt it here, under the record's
 * hash); a MEMBER subscriber carries only githubId/customerId and NEVER stores the address, which lives on
 * their Stripe Customer (data-protection.md:49), so the member branch defers to the INJECTED `fetchMemberEmail`.
 * The drain injects both, so this stays pure and unit-tested, and the drain does at most one member lookup per
 * member-recipient (bounded by the per-tick send cap, well inside the Worker subrequest ceiling).
 *
 * Fail-closed to null on anything unusable: an unknown source, an anon record without emailEnc, a member record
 * without an id, an absent key (anon) or absent fetcher (member), a decrypt failure, or a fetcher that throws or
 * returns nothing. The drain treats null as "no usable address" and never sends to an empty or wrong one.
 */
export async function resolveSubscriberEmail(subscriber, { key, fetchMemberEmail } = {}) {
  const sub = subscriber && typeof subscriber === 'object' ? subscriber : null;
  if (!sub) return null;
  const hash = normalizeHash(sub.hash);
  if (!hash) return null;
  if (sub.source === 'anon') {
    // The record stores emailEnc as an OPAQUE string (buildSubscriber/KV JSON), so parse it here; accept a
    // pre-parsed object too. An unparseable envelope is null, never a send.
    let envelope = sub.emailEnc;
    if (typeof envelope === 'string') {
      try { envelope = JSON.parse(envelope); } catch { return null; }
    }
    return decryptEmail({ key, hash, envelope });
  }
  if (sub.source === 'member') {
    if (typeof fetchMemberEmail !== 'function') return null;
    const idRef = { githubId: sub.githubId ?? null, customerId: sub.customerId ?? null };
    if (!idRef.githubId && !idRef.customerId) return null;
    try {
      const email = await fetchMemberEmail(idRef);
      const addr = typeof email === 'string' ? email.trim() : '';
      return addr || null;
    } catch {
      return null;
    }
  }
  return null;
}
