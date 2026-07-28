// SOW-016: server-side member-content crypto. The AES-256-GCM epoch key NEVER leaves the Worker (this
// SUPERSEDES SOW-015's GET /membership/key handout). Two endpoints, both gated to an EFFECTIVE-PAID caller:
//   POST /membership/decrypt  body: a .enc envelope          -> { ok, text } (the plaintext markdown)
//   POST /membership/encrypt  body: { plaintext, assetId }   -> { ok, envelope } to commit as <assetId>.enc
//
// authorizePaid() applies ban > staff > grandfather > Stripe SERVER-SIDE from the reconcile-written SIGNUP_KV
// overrides mirror, FAIL CLOSED: missing/unverifiable token, Stripe error, missing/stale/incomplete mirror,
// a ban, or anything other than effective 'paid' -> 4xx, never a decrypt/encrypt.
//
// HONEST CAVEAT: obfuscation for perks, not absolute secrecy. An authorized member can still copy the
// plaintext they open; the public ciphertext is permanent (bounded by key-destroying rotation). See SOW-016.

import { githubFetchUser } from './oauth.mjs';
import { resolveIdentity } from './identity.mjs'; // sow-158 Phase 1b: bearer-or-cookie identity choke point
import { deriveStatus } from '../../membership/derive-status.mjs';
import { effectiveStatus, bansFromParsed, rolesFromParsed, grandfathersFromParsed } from '../../membership/overrides-core.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { decryptAssetText, encryptAsset } from '../../client/src/crypto-assets.mjs';
import { readCouponGrant } from './coupons.mjs'; // SOW-119: the coupon fast-path grant

export const OVERRIDES_KV_KEY = 'overrides:mirror';
// The mirror must be fresher than this or we fail closed (a stale mirror could serve a since-banned member).
export const MAX_OVERRIDES_AGE_MS = 48 * 60 * 60 * 1000;

const deny = (message) => ({ ok: false, status: 403, body: { error: 'forbidden', message } });

/**
 * Resolve the caller's EFFECTIVE membership status from their GitHub bearer token, fail-closed. Returns
 * { ok: true, githubId, status, source } (status is 'paid'|'trialing'|'expired'|'cancelled'|'none'|'banned')
 * or { ok: false, status, body }. Pure over injected deps (no network/secrets in tests). Identity comes ONLY
 * from the verified token; ban > staff > grandfather > Stripe is applied here. The caller decides which
 * statuses it accepts (decrypt allows an active trial to read a Share; encrypt + everything else is paid-only).
 */
export async function resolveEffective(request, env, { fetchImpl = globalThis.fetch, makeStripe = createStripeClient, fetchUser = githubFetchUser, verifyCookie, now = new Date(), needStripe = true, allowCookie = false, needToken = false, kv = env?.SIGNUP_KV } = {}) {
  // sow-158 Phase 1b: identity now comes from EITHER a bearer token OR (only when the route opts in with
  // allowCookie) the signed gbti_session cookie. resolveIdentity preserves the exact bearer-path messages, so
  // a bearer caller is unaffected. Everything below (Stripe derive, mirror staleness/shape gate, effectiveStatus
  // ban>staff>grandfather, the coupon fast-path) is unchanged and runs on the resolved githubId regardless.
  const id = await resolveIdentity(request, env, { fetchImpl, fetchUser, ...(verifyCookie ? { verifyCookie } : {}), now, allowCookie, needToken });
  if (!id.ok) return id;
  const githubId = id.githubId;
  const login = id.login;

  // SOW-078: a free / ban-only caller (authorizeMemberCheap) does NOT need the Stripe-derived paid/trial status —
  // its decision rests on identity + the cheap KV ban/override mirror, and ban > staff > grandfather wins regardless
  // of the Stripe value. Skip the live Stripe round-trip for it (a hot path such as the new-tab feed). The mirror
  // guards + the ban check below are UNCHANGED, so the cheap path still fails closed on a missing/stale/incomplete
  // mirror; only the unneeded `derived` paid/trial signal is dropped (it floors to 'none').
  let derived = 'none';
  if (needStripe) {
    if (!env?.STRIPE_SECRET_KEY) return { ok: false, status: 500, body: { error: 'misconfigured', message: 'Stripe is not configured' } };
    const stripe = makeStripe({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
    derived = await deriveStatus(githubId, stripe, now); // fails closed to 'none'; share the injected clock
  }

  let mirror = null;
  try {
    mirror = await kv?.get(OVERRIDES_KV_KEY, 'json');
  } catch {
    mirror = null;
  }
  if (!mirror || !mirror.generatedAt) return deny('member overrides are unavailable right now');
  const ageMs = now.getTime() - new Date(mirror.generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) return deny('member overrides are stale right now');
  // Each section must be a non-array object ({ bans: [...] } etc). A malformed/wrong-shaped section (e.g. bans
  // written as a bare array) would silently parse to ZERO bans, dropping the ban tier, so it must fail closed.
  const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!isSection(mirror.bans) || !isSection(mirror.roles) || !isSection(mirror.grandfathered)) return deny('member overrides are incomplete right now');

  const overrides = {
    bans: bansFromParsed(mirror.bans),
    roles: rolesFromParsed(mirror.roles),
    grandfathers: grandfathersFromParsed(mirror.grandfathered),
  };
  const effective = effectiveStatus(githubId, derived, overrides, now);

  // SOW-119: the coupon fast-path. A fresh redemption makes the member effective-paid IMMEDIATELY (the
  // daily reconcile lands the durable git grant later). Consulted only when the mirror-derived status is
  // neither paid (nothing to add) nor banned (ban outranks everything, including a coupon).
  if (effective.status !== 'paid' && effective.status !== 'banned') {
    const grant = await readCouponGrant(kv, githubId, now);
    if (grant) return { ok: true, githubId, login, via: id.via, status: 'paid', source: 'coupon' };
  }

  return { ok: true, githubId, login, via: id.via, status: effective.status, source: effective.source };
}

/**
 * Authorize an EFFECTIVE-PAID caller (encrypt, and any non-Share decrypt). Thin wrapper over resolveEffective:
 * anything other than effective 'paid' is denied (banned -> a distinct message). Returns { ok, githubId, source }.
 */
export async function authorizePaid(request, env, deps = {}) {
  const r = await resolveEffective(request, env, deps);
  if (!r.ok) return r;
  if (r.status !== 'paid') {
    return deny(r.status === 'banned' ? 'this account is not permitted' : 'an active paid membership is required');
  }
  return { ok: true, githubId: r.githubId, login: r.login, source: r.source, status: r.status }; // SOW-061: tier for usage analytics
}

/**
 * SOW-060: authorize any SIGNED-IN, non-banned caller (the FREE / member tier). Thin wrapper over resolveEffective:
 * a verified token + a fresh, well-shaped overrides mirror is enough, and only a ban is denied (so it inherits the
 * 401-no-token, 401-bad-token, and 403-stale/incomplete-mirror fail-closed behavior verbatim). Used for the FREE
 * perks that carry NO member-only content body: NEWS browse/follow, the follow graph, and news/category prefs.
 * Member-only CONTENT (decrypt/encrypt, Shares, publishing, Discord side effects) stays on authorizePaid.
 */
export async function authorizeMember(request, env, deps = {}) {
  const r = await resolveEffective(request, env, deps);
  if (!r.ok) return r;
  if (r.status === 'banned') return deny('this account is not permitted');
  return { ok: true, githubId: r.githubId, login: r.login, source: r.source, status: r.status }; // SOW-061: tier for usage analytics
}

/**
 * SOW-077: authorize ANY signed-in caller, INCLUDING a banned account, for a READ-only, non-KV perk (the news feed).
 * Identical to authorizeMember EXCEPT it does NOT deny banned: a ban is a COMMUNITY ban, so a banned account keeps the
 * non-KV reads (it still gets ZERO KV via the activity/follows/prefs gates, which stay on authorizeMember). Keeps the
 * fail-closed token + mirror checks AND the Stripe-derived `status` (so news analytics stay per-tier; the 'banned'
 * bucket is already in USAGE_BUCKETS). The optional Stripe-trim — flip to needStripe:false — is a separate decision.
 */
export async function authorizeSignedIn(request, env, deps = {}) {
  const r = await resolveEffective(request, env, deps);
  if (!r.ok) return r;
  return { ok: true, githubId: r.githubId, login: r.login, source: r.source, status: r.status }; // banned is allowed to read
}

/**
 * SOW-078: authorize any SIGNED-IN, non-banned caller WITHOUT a Stripe call. Same fail-closed contract as
 * authorizeMember (401 no/bad token, 403 missing/stale/incomplete mirror, 403 banned), but it skips the live Stripe
 * derive because the decision is identity + the ban mirror only. For the cheap free-tier gates whose outcome never
 * reads paid-vs-trial: the member ACTIVITY save/collect (SOW-077: banned gets ZERO KV) and other identity+ban gates.
 * CAVEAT: the returned `status` is NOT Stripe-derived (a paid member surfaces as 'none' unless staff/grandfather), so
 * it must NOT be used as an analytics tier — that is why news/follows (which record per-tier usage) stay on the
 * Stripe-backed authorizeMember until that analytics tradeoff is accepted (see the SOW-078 punch-list).
 */
export async function authorizeMemberCheap(request, env, deps = {}) {
  const r = await resolveEffective(request, env, { ...deps, needStripe: false });
  if (!r.ok) return r;
  if (r.status === 'banned') return deny('this account is not permitted');
  return { ok: true, githubId: r.githubId, login: r.login, source: r.source, status: r.status };
}

// SOW-018: a Share's encrypted body carries the AAD `share:<id>:body` (encAssetFor('share', ...)). The AAD is
// bound into the GCM ciphertext, so it cannot be forged onto another asset's envelope (decryption would fail),
// making it a safe authorization signal. Shares grant LIMITED TRIAL ACCESS: an active trial may READ (decrypt)
// the community Shares stream, but posting (encrypt) stays paid-only. A lapsed/cancelled/expired/banned account
// is NOT trialing, so it cannot read (the extension shows its lock splash). Everything else stays paid-only.
// SOW-018 shares + SOW-089 comments: both asset families are readable by an active TRIAL or a paid member;
// every other member-only asset (post/product/prompt bodies) stays paid-only. The AAD is GCM-authenticated
// at encrypt time, so a content envelope cannot be relabeled into this carve-out (decrypt would 422).
const READ_TRIAL_AAD = /^(share|comment):/;
const READ_TRIAL_OK = new Set(['paid', 'trialing']);

/**
 * Resolve the base64 key for an epoch id (prototype-safe). The current epoch is the MEMBER_CONTENT_KEY secret;
 * retired epochs (during a rotation overlap) live in the optional MEMBER_CONTENT_KEYS JSON map. Returns null
 * for an unknown epoch so the caller fails with a 500 (never a 200 carrying a junk key).
 */
export function resolveEpochKey(env, kid) {
  const currentKid = String(env.MEMBER_CONTENT_KID || '1');
  if (kid === currentKid && env.MEMBER_CONTENT_KEY) return String(env.MEMBER_CONTENT_KEY);
  if (env.MEMBER_CONTENT_KEYS) {
    try {
      const keys = Object.assign(Object.create(null), JSON.parse(env.MEMBER_CONTENT_KEYS));
      if (Object.prototype.hasOwnProperty.call(keys, kid) && typeof keys[kid] === 'string') return keys[kid];
    } catch { /* fall through */ }
  }
  return null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}

/**
 * POST /membership/decrypt — body is a v1 .enc envelope. Returns { ok, text } (plaintext markdown) to an
 * effective-paid caller, decrypted with the Worker-held key for the envelope's epoch. The key never leaves.
 */
export async function membershipDecrypt(request, env, deps = {}) {
  // Identity first (a missing/unverifiable token -> 401), then validate the envelope (400), then the
  // authorization decision (403), which depends on the asset type (its AAD).
  const r = await resolveEffective(request, env, deps);
  if (!r.ok) return { status: r.status, body: r.body };

  const envelope = await readJson(request);
  if (!envelope || typeof envelope !== 'object' || typeof envelope.ct !== 'string' || typeof envelope.iv !== 'string') {
    return { status: 400, body: { error: 'bad_request', message: 'a v1 .enc envelope JSON body is required' } };
  }

  // SOW-018 + SOW-089: a Share or COMMENT asset (AAD `share:...` / `comment:...`) is readable by an active
  // trial OR a paid member; content bodies stay paid-only. The AAD is GCM-authenticated, so it cannot be
  // forged onto another asset family.
  const trialReadable = READ_TRIAL_AAD.test(String(envelope.aad ?? ''));
  const allowed = trialReadable ? READ_TRIAL_OK.has(r.status) : r.status === 'paid';
  if (!allowed) {
    const msg = r.status === 'banned'
      ? 'this account is not permitted'
      : trialReadable
        ? 'an active membership is required to read this'
        : 'an active paid membership is required';
    return { status: 403, body: { error: 'forbidden', message: msg } };
  }
  const key = resolveEpochKey(env, String(envelope.kid ?? env.MEMBER_CONTENT_KID ?? '1'));
  if (!key) return { status: 500, body: { error: 'misconfigured', message: 'no member-content key for this epoch' } };
  try {
    const text = await decryptAssetText({ envelope, key });
    return { status: 200, body: { ok: true, text } };
  } catch {
    // AssetAccessError (tamper / wrong key / bad envelope) -> 422, never leak internals or partial data.
    return { status: 422, body: { error: 'undecryptable', message: 'the asset could not be decrypted' } };
  }
}

/**
 * POST /membership/encrypt — body { plaintext, assetId }. Returns { ok, envelope } for an effective-paid
 * author to commit as <assetId>.enc, encrypted under the CURRENT epoch with the Worker-held key.
 */
export async function membershipEncrypt(request, env, deps = {}) {
  const auth = await authorizePaid(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };

  const body = await readJson(request);
  const plaintext = body?.plaintext;
  const assetId = body?.assetId;
  if (typeof plaintext !== 'string' || !assetId || typeof assetId !== 'string') {
    return { status: 400, body: { error: 'bad_request', message: 'plaintext (string) and assetId (string) are required' } };
  }
  const kid = String(env.MEMBER_CONTENT_KID || '1');
  const key = resolveEpochKey(env, kid);
  if (!key) return { status: 500, body: { error: 'misconfigured', message: 'no member-content key is configured' } };
  const envelope = await encryptAsset({ plaintext, key, assetId, kid });
  return { status: 200, body: { ok: true, envelope } };
}
