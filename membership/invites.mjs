// sow-231: the ISSUED INVITE core. A campaign (house/coupons.yml) says WHAT an invite is worth; an invite
// says WHO we handed one to. This module is the pure half: minting a unique code, building the record, and
// deciding whether a given record may still be redeemed. Node-free (no fs, no yaml, no crypto), so the
// Worker, the CI validator and the tests all share one implementation.
//
// WHY THESE LIVE IN KV AND NOT IN house/coupons.yml, since that is the surprising part:
// an issued invite is a record of who we sent something to, carrying an administration note that in
// practice names a person. That is private, mutable, per-person state, and CLAUDE.md's storage boundary
// puts it in KV. Minting unique codes into the registry would write person-keyed records into a public,
// forkable, CDN-cached repository permanently, open one pull request per invite, and make the note the most
// identifying field in git history. The campaign stays in git because it is curated configuration; the
// invites do not because they are about people.
//
// THE BEARER PROPERTY IS ACCEPTED, NOT DENIED (owner, 2026-08-12, reversing their own 2026-07-18 ruling).
// Whoever opens a one-time link first can redeem it, so a forwarded link is a transferred membership. That
// was weighed and accepted: the alternative in place today is a shared, uncapped, published code whose
// failure mode is the WHOLE campaign, where this one fails at a single seat. Invites are deliberately
// FIRST-COME rather than bound to a named recipient, because the coupon is validated at /signup/start
// before either OAuth hop, so a bound invite could only be REFUSED after the recipient had already
// authorized GitHub and Discord. See sow-231 open questions 1 and 2.

import { normalizeCouponCode, COUPON_CODE_RE } from './coupons.mjs';

/**
 * The code alphabet, deliberately NOT the full A-Z 0-9 that COUPON_CODE_RE allows. `0/O`, `1/I/L` and `U`
 * are removed because these codes get read aloud, retyped from a message and pasted by hand, and a code
 * nobody can transcribe is a support ticket. 30 characters, so a 10-character suffix is about 49 bits.
 */
export const INVITE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const INVITE_SUFFIX_LEN = 10;

/** The campaign-derived prefix is capped so `prefix + suffix` always fits COUPON_CODE_RE's 32 characters. */
export const INVITE_PREFIX_MAX = 12;

/** An administration note is free text about a person, so it is bounded and stripped of control characters. */
export const MAX_INVITE_NOTE = 280;

export const INVITE_STATE = Object.freeze({
  issued: 'issued',
  redeemed: 'redeemed',
  revoked: 'revoked',
  expired: 'expired',
  unknown: 'unknown', // a malformed or missing record: never redeemable
});

/** The KV key for one invite. ONE builder, so every reader and writer agrees on the shape. */
export function inviteKey(code) {
  return `invite:${normalizeCouponCode(code)}`;
}

/** The KV key prefix an admin sweep lists over. Kept next to inviteKey so the two can never drift apart. */
export const INVITE_KEY_PREFIX = 'invite:';

/**
 * The campaign-derived prefix of a minted code, so a code is recognizable in `house/grandfathered.yml`
 * after the reconcile fold lands it as `reason: coupon:<CODE>`. Anything outside the alphabet is dropped
 * rather than substituted, because a substitution could silently collide two campaigns onto one prefix.
 * Returns '' when the campaign yields no usable characters, which the caller must treat as unmintable.
 */
export function invitePrefix(campaign) {
  const up = normalizeCouponCode(campaign);
  let out = '';
  for (const ch of up) {
    if (INVITE_ALPHABET.includes(ch) && out.length < INVITE_PREFIX_MAX) out += ch;
  }
  return out;
}

/**
 * Mint a unique invite code for `campaign` from caller-supplied random bytes.
 *
 * Pure on purpose: the Worker passes `crypto.getRandomValues(new Uint8Array(32))` and the tests pass a
 * fixed array, so the same function is exercised in both and there is no untested branch in production.
 *
 * REJECTION SAMPLING, not plain modulo. 256 does not divide 30, so `byte % 30` would make the first six
 * letters of the alphabet measurably likelier. Bytes at or above 240 are skipped instead, which costs a
 * few extra bytes and removes the bias entirely.
 *
 * @throws when the campaign has no usable prefix, or the byte supply runs out before the suffix is full.
 */
export function mintInviteCode(campaign, bytes) {
  const prefix = invitePrefix(campaign);
  if (!prefix) throw new Error('invites: the campaign code yields no usable prefix');
  const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(Array.isArray(bytes) ? bytes : []);
  const limit = 256 - (256 % INVITE_ALPHABET.length); // 240 for a 30-character alphabet
  let suffix = '';
  for (let i = 0; i < src.length && suffix.length < INVITE_SUFFIX_LEN; i += 1) {
    const b = src[i];
    if (b >= limit) continue; // biased sample: discard rather than fold it back in
    suffix += INVITE_ALPHABET[b % INVITE_ALPHABET.length];
  }
  if (suffix.length < INVITE_SUFFIX_LEN) throw new Error('invites: not enough random bytes to mint a code');
  const code = `${prefix}${suffix}`;
  // The minted code must satisfy the SAME rule every other coupon code does, because it travels the whole
  // existing validate -> sign -> redeem path with no special-casing. A failure here is a programming error.
  if (!COUPON_CODE_RE.test(code)) throw new Error(`invites: minted an invalid code (${code})`);
  return code;
}

/**
 * Bound + strip an administration note. Control characters (newlines and tabs included) collapse to a
 * single space so a note stays one line in a table and cannot smuggle framing into a log or an export;
 * everything else is stored as written. The escapes are written as \x.. rather than as literal bytes so the
 * intent survives a copy-paste through an editor that would silently eat the raw characters.
 */
export function sanitizeNote(note) {
  if (typeof note !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return note.replace(/[\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_INVITE_NOTE);
}

function isoOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Build a fresh invite record. `expiresAt` is a STORED DATE checked at redemption, deliberately not a KV
 * `expirationTtl`: a TTL'd key vanishes, and it would take the issuance record and the administration note
 * with it. An expired invite has to stay visible as "issued to X, never redeemed, expired" (sow-231 Q4).
 *
 * An unparseable `expiresAt` normalizes to null rather than throwing, and the CALLER validates it, so a bad
 * date can never quietly become an invite that lives forever.
 */
export function newInvite({ campaign, code, issuedBy = null, issuedByLogin = null, note = '', expiresAt = null, now = new Date() } = {}) {
  const c = normalizeCouponCode(code);
  const camp = normalizeCouponCode(campaign);
  if (!COUPON_CODE_RE.test(c)) throw new Error('invites: invalid invite code');
  if (!COUPON_CODE_RE.test(camp)) throw new Error('invites: invalid campaign code');
  return {
    code: c,
    campaign: camp,
    issuedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    issuedBy: issuedBy === null || issuedBy === undefined ? null : String(issuedBy),
    issuedByLogin: issuedByLogin || null,
    note: sanitizeNote(note),
    expiresAt: isoOrNull(expiresAt),
    redeemedBy: null,
    redeemedByLogin: null,
    redeemedAt: null,
    revokedAt: null,
    revokedBy: null,
  };
}

/**
 * The state of an invite at `now`. Order matters and encodes the policy:
 *   redeemed beats everything (a used invite stays used even once its expiry passes, so the audit trail
 *   keeps saying what actually happened rather than being rewritten by the clock),
 *   then revoked, then expired, then issued.
 * A missing or structurally unusable record is `unknown`, never `issued`.
 */
export function inviteState(rec, now = new Date()) {
  if (!rec || typeof rec !== 'object') return INVITE_STATE.unknown;
  if (!COUPON_CODE_RE.test(normalizeCouponCode(rec.code))) return INVITE_STATE.unknown;
  if (rec.redeemedAt) return INVITE_STATE.redeemed;
  if (rec.revokedAt) return INVITE_STATE.revoked;
  if (rec.expiresAt) {
    const t = new Date(rec.expiresAt);
    // FAIL CLOSED: an expiry we cannot read is treated as passed, matching couponIsRedeemable's handling of
    // an unparseable campaign expiry. A corrupt date must not become an invite that never expires.
    if (Number.isNaN(t.getTime())) return INVITE_STATE.expired;
    if ((now instanceof Date ? now : new Date(now)).getTime() >= t.getTime()) return INVITE_STATE.expired;
  }
  return INVITE_STATE.issued;
}

/** True only for a record in the `issued` state. Every other outcome, including unknown, is false. */
export function inviteIsRedeemable(rec, now = new Date()) {
  return inviteState(rec, now) === INVITE_STATE.issued;
}

/**
 * Mark an invite redeemed. Returns { next, changed }. Idempotent by contract: a record already redeemed is
 * returned UNCHANGED rather than re-stamped, so a retried signup chain cannot rewrite who redeemed it or
 * when. A non-redeemable invite returns changed:false and the caller refuses the redemption.
 */
export function markInviteRedeemed(rec, { githubId, login = null, now = new Date() } = {}) {
  if (!inviteIsRedeemable(rec, now)) return { next: rec, changed: false };
  if (!githubId) return { next: rec, changed: false };
  return {
    next: {
      ...rec,
      redeemedBy: String(githubId),
      redeemedByLogin: login || null,
      redeemedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    },
    changed: true,
  };
}

/**
 * Revoke an unredeemed invite. Returns { next, changed }. A REDEEMED invite is never revoked: the grant it
 * produced is already live and is taken back through the grandfather machinery (ban or grant removal), not
 * by editing the record of how it was issued.
 */
export function revokeInvite(rec, { by = null, now = new Date() } = {}) {
  const state = inviteState(rec, now);
  if (state === INVITE_STATE.redeemed || state === INVITE_STATE.unknown) return { next: rec, changed: false };
  if (rec.revokedAt) return { next: rec, changed: false }; // idempotent
  return {
    next: { ...rec, revokedAt: (now instanceof Date ? now : new Date(now)).toISOString(), revokedBy: by === null ? null : String(by) },
    changed: true,
  };
}

/** Set the administration note on an existing invite. Allowed in any state: notes are an audit aid. */
export function setInviteNote(rec, note) {
  if (!rec || typeof rec !== 'object') return { next: rec, changed: false };
  const next = sanitizeNote(note);
  if (next === (rec.note ?? '')) return { next: rec, changed: false };
  return { next: { ...rec, note: next }, changed: true };
}

/**
 * The shareable link for an invite. Reuses the EXISTING plain `?coupon=` parameter the invite page already
 * reads (`src/pages/codeable-invite/index.astro`), so nothing new has to be built on the page: what changed
 * is that the code in the link is unique per invite rather than shared. The sow-119 `?t=<token>` resolver
 * stays retired.
 */
export function inviteLink(siteBase, code, path = '/codeable-invite/') {
  const base = String(siteBase || '').replace(/\/+$/, '');
  return `${base}${path}?coupon=${encodeURIComponent(normalizeCouponCode(code))}`;
}

/** The admin-facing view of a record: the state resolved once, so no surface re-derives it. */
export function inviteSummary(rec, now = new Date()) {
  if (!rec || typeof rec !== 'object') return null;
  return {
    code: normalizeCouponCode(rec.code),
    campaign: normalizeCouponCode(rec.campaign),
    state: inviteState(rec, now),
    issuedAt: rec.issuedAt ?? null,
    issuedByLogin: rec.issuedByLogin ?? null,
    note: rec.note ?? '',
    expiresAt: rec.expiresAt ?? null,
    redeemedBy: rec.redeemedBy ?? null,
    redeemedByLogin: rec.redeemedByLogin ?? null,
    redeemedAt: rec.redeemedAt ?? null,
    revokedAt: rec.revokedAt ?? null,
  };
}
