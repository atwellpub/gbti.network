// SOW-166: the PURE subscriber-record core for the weekly digest. No IO, no crypto, no Date.now() inside
// (callers inject `now`), so it is fully unit-tested with fakes. One record is one subscriber, keyed
// `mail:subscriber:<hash>` where `<hash>` is the one-way HMAC identity from mail-suppress.mjs (`mailHash`).
//
// STORE DECISION (owner, 2026-08-17): the subscriber list is SELF-MANAGED in Cloudflare KV, OFF the Stripe
// billing registry (resolving the SecurityMaster ruling), with Resend kept purely transactional. This core is
// the record shape for that store.
//
// THE ADDRESS IS NEVER STORED IN PLAINTEXT. There are two resolution paths, and a record carries exactly one:
//   - an ANONYMOUS subscriber (source 'anon') carries `emailEnc`, the address AES-256-GCM-encrypted under the
//     STANDING MAIL_EMAIL_KEY (never the rotating member-content key); the Worker decrypts it only at send time.
//   - a MEMBER subscriber (source 'member') carries `githubId` (and optionally `customerId`) and NO email: the
//     address stays on the member's Stripe Customer, so data-protection.md:49 is intact for members and the
//     drain resolves the address from Stripe at send time.
// The core takes `emailEnc` as an OPAQUE string (the encryption is the Worker's job) and has no field that
// could hold a raw address, so a compiled record can never serialize an '@' from the address (leak-guard test).
//
// Shape (mail:subscriber:<hash>):
//   { hash, source, status, emailEnc, customerId, githubId, createdAt, updatedAt }
//
// Unsubscribe/erasure HARD-DELETES the record (the Worker) and writes the mail-suppress marker, which outlives
// it. `status: 'unsubscribed'` exists for a caller that prefers a soft transition, but the approved design is
// hard-delete-plus-suppress.

export const SUBSCRIBER_STATUS = new Set(['active', 'unsubscribed']);
export const SUBSCRIBER_SOURCE = new Set(['anon', 'member']);

/** Thrown for caller-input problems; the handler maps it to a 400 (never a 500). */
export class SubscriberError extends Error {}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const trimOrNull = (v) => {
  const s = str(v).trim();
  return s === '' ? null : s;
};
const num = (v) => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Build a canonical, active subscriber record. PURE. Requires the hash and a resolvable address path: an
 * 'anon' record must carry `emailEnc`; a 'member' record must carry `githubId` (or `customerId`). A record
 * with no way to resolve an address is useless and is rejected. `emailEnc` is opaque ciphertext; passing a raw
 * address in any other field is structurally impossible (there is no such field).
 */
export function buildSubscriber(input = {}, { now = Date.now } = {}) {
  const hash = trimOrNull(input.hash);
  if (!hash) throw new SubscriberError('hash is required');
  const source = SUBSCRIBER_SOURCE.has(input.source) ? input.source : 'anon';
  const emailEnc = trimOrNull(input.emailEnc);
  const customerId = trimOrNull(input.customerId);
  const githubId = trimOrNull(input.githubId);

  if (source === 'anon' && !emailEnc) throw new SubscriberError('an anonymous subscriber requires emailEnc');
  if (source === 'member' && !githubId && !customerId) throw new SubscriberError('a member subscriber requires githubId or customerId');
  if (source === 'anon' && (githubId || customerId)) {
    // An anonymous record must not also carry a member identity: that is the merge, and it happens through an
    // explicit claim path, never at create time (SecurityMaster condition 1, claim-before-create).
    throw new SubscriberError('an anonymous subscriber must not carry githubId/customerId at create time');
  }

  const t = Number(now());
  return {
    hash,
    source,
    status: 'active',
    emailEnc: source === 'anon' ? emailEnc : null, // a member record never stores the address
    customerId: source === 'member' ? customerId : null,
    githubId: source === 'member' ? githubId : null,
    createdAt: t,
    updatedAt: t,
  };
}

/** Defensive: coerce a stored value into the canonical shape, or null when it is not a usable record. */
export function normalizeSubscriber(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const hash = trimOrNull(raw.hash);
  if (!hash) return null;
  const source = SUBSCRIBER_SOURCE.has(raw.source) ? raw.source : 'anon';
  const status = SUBSCRIBER_STATUS.has(raw.status) ? raw.status : 'active';
  const emailEnc = trimOrNull(raw.emailEnc);
  const customerId = trimOrNull(raw.customerId);
  const githubId = trimOrNull(raw.githubId);
  // A record with no resolvable address is not usable.
  if (source === 'anon' && !emailEnc) return null;
  if (source === 'member' && !githubId && !customerId) return null;
  const createdAt = num(raw.createdAt) ?? 0;
  return {
    hash,
    source,
    status,
    emailEnc: source === 'anon' ? emailEnc : null,
    customerId: source === 'member' ? customerId : null,
    githubId: source === 'member' ? githubId : null,
    createdAt,
    updatedAt: num(raw.updatedAt) ?? createdAt,
  };
}

/** Is this subscriber currently eligible to receive a send? Only an 'active' record is. */
export function canReceive(rec) {
  return Boolean(rec) && rec.status === 'active';
}

/** How the drain resolves this subscriber's address: from Stripe (a member) or by decrypting emailEnc (anon).
 *  A member record has no stored address; an anon record's address is the decryption of emailEnc. */
export function resolvesFromStripe(rec) {
  return Boolean(rec) && rec.source === 'member' && (Boolean(rec.githubId) || Boolean(rec.customerId));
}

/** Re-activate a previously-unsubscribed record (a deliberate re-subscribe). Stamps updatedAt. */
export function markActive(rec, { now = Date.now } = {}) {
  return { ...rec, status: 'active', updatedAt: Number(now()) };
}

/** The soft-unsubscribe transition. NOTE: the approved design HARD-DELETES the record and writes the
 *  mail-suppress marker instead; this exists for a caller that wants a soft state. Stamps updatedAt. */
export function markUnsubscribed(rec, { now = Date.now } = {}) {
  return { ...rec, status: 'unsubscribed', updatedAt: Number(now()) };
}

/**
 * Claim an anonymous subscriber record for a member who has just signed in (SecurityMaster condition 1:
 * claim-before-create, run inside the path that decides create-vs-reuse). PURE state transition only: the
 * CALLER is responsible for having matched ONLY the GitHub verified primary email (condition 2) and for
 * failing closed on more than one candidate (condition 3) before calling this. On claim the record becomes a
 * MEMBER record: the stored ciphertext is dropped (the member's address now resolves from Stripe) and the
 * githubId is written. Returns the record unchanged if it is not an anonymous record (never re-claims).
 */
export function claimForMember(rec, { githubId, customerId = null, now = Date.now } = {}) {
  const gid = trimOrNull(githubId);
  if (!rec || rec.source !== 'anon' || !gid) return rec;
  return {
    ...rec,
    source: 'member',
    emailEnc: null, // stop storing the address once it lives on the member's Stripe Customer
    customerId: trimOrNull(customerId),
    githubId: gid,
    updatedAt: Number(now()),
  };
}
