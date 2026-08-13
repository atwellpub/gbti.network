// sow-231 Phase 1: admin-gated ISSUANCE of unique one-time invites. Sibling of membership-coupons-admin.mjs
// and deliberately shaped like it: authorizeAdmin runs FIRST (token or cookie -> github_id -> role from the
// fresh KV overrides mirror, fail closed), then KV.
//
// The split this module depends on: a CAMPAIGN (house/coupons.yml, git-native, admin PR) says what an
// invite is WORTH (freeDays, tier); an INVITE (KV) says who we handed one to. An invite never carries its
// own terms, so there is exactly one place to change what a campaign gives.
//
// KV keys:
//   invite:<CODE>                  the issued-invite record (this module)
//   redemption:<CODE>:<githubId>   written at signup, unchanged
//   coupon-grant:<githubId>        the fast-path grant + the one-per-member lock, unchanged
//
// AN ISSUED INVITE IS PERSON-KEYED DATA. The administration note names people in practice, so this whole
// surface sits behind authorizeAdmin, exactly like the Stripe status map does, and the records must join
// the SOW-024 erasure inventory before this ships past Phase 1.

import { authorizeAdmin } from './membership-admin.mjs';
import { readCouponsConfig } from './coupons.mjs';
import { couponByCode, normalizeCouponCode } from '../../membership/coupons.mjs';
import { roleLoginsFromParsed } from '../../membership/overrides-core.mjs';
import {
  inviteKey,
  INVITE_KEY_PREFIX,
  mintInviteCode,
  newInvite,
  inviteSummary,
  revokeInvite,
  setInviteNote,
} from '../../membership/invites.mjs';

const MINT_BYTES = 32; // ample for a 10-character suffix even after rejection sampling discards ~6% of bytes
const MINT_ATTEMPTS = 5; // a collision is astronomically unlikely; retrying is still cheaper than failing

const bad = (status, error, message) => ({ status, body: { ok: false, error, message } });

/**
 * The issuing admin's login, for a list that reads "issued by atwellpub" rather than "issued by 2002207".
 * authorizeAdmin returns { ok, githubId, role, isCurator, mirror } and NO login, so it is resolved here
 * from the roles section of the same overrides mirror the authorization already read. Best effort: a miss
 * leaves null, because failing an issuance over a display name would be absurd.
 */
function issuerLogin(auth) {
  try { return roleLoginsFromParsed(auth?.mirror?.roles).get(String(auth?.githubId)) ?? null; }
  catch { return null; }
}

/** Read one invite record, or null. A malformed value reads as null so a caller can never act on junk. */
async function readInvite(kv, code) {
  try {
    const rec = await kv.get(inviteKey(code), 'json');
    return rec && typeof rec === 'object' ? rec : null;
  } catch {
    return null;
  }
}

/**
 * POST /membership/admin/invites -> mint ONE invite against a campaign.
 * Body: { campaign, note?, expiresAt? }
 *
 * The campaign must be REDEEMABLE right now (couponByCode applies active + expiresAt), because issuing a
 * link against a switched-off campaign would hand someone a URL that fails at redemption with no
 * explanation. Fail closed: an unknown or inactive campaign is a 400, never a silently unusable invite.
 */
export async function membershipInviteCreate(request, env, { authorize = authorizeAdmin, now = new Date(), randomBytes = null, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  let body;
  try { body = await request.json(); } catch { return bad(400, 'bad_request', 'a JSON body is required'); }

  const campaign = normalizeCouponCode(body?.campaign);
  const config = await readCouponsConfig(kv, now);
  if (!config) return bad(503, 'unavailable', 'the coupon registry is not readable right now');
  const coupon = couponByCode(config, campaign, now);
  if (!coupon) return bad(400, 'unknown_campaign', `no active campaign named ${campaign || '(none)'}`);

  // An expiry the caller cannot read back is refused rather than normalized away, because silently
  // dropping it would produce a link that never expires when the admin asked for one that does.
  const rawExpires = body?.expiresAt;
  if (rawExpires !== undefined && rawExpires !== null && rawExpires !== '' && Number.isNaN(new Date(rawExpires).getTime())) {
    return bad(400, 'bad_request', 'expiresAt must be an ISO date when set');
  }

  const rand = typeof randomBytes === 'function'
    ? randomBytes
    : (n) => crypto.getRandomValues(new Uint8Array(n));

  let code = null;
  for (let i = 0; i < MINT_ATTEMPTS; i += 1) {
    let candidate;
    try { candidate = mintInviteCode(campaign, rand(MINT_BYTES)); }
    catch (e) { return bad(400, 'unmintable', e?.message || 'this campaign cannot mint an invite code'); }
    // Two collisions to rule out, and BOTH matter. A previously issued invite is the obvious one. A
    // CAMPAIGN code is the subtle one: if a minted code equalled a campaign name, redemption would resolve
    // it as the shared campaign and the invite would silently stop being single-use.
    if (couponByCode(config, candidate, now)) continue;
    if (await readInvite(kv, candidate)) continue;
    code = candidate;
    break;
  }
  if (!code) return bad(503, 'mint_failed', 'could not mint a unique code; try again');

  const rec = newInvite({
    campaign,
    code,
    issuedBy: auth.githubId,
    issuedByLogin: issuerLogin(auth),
    note: body?.note ?? '',
    expiresAt: rawExpires ?? null,
    now,
  });
  await kv.put(inviteKey(code), JSON.stringify(rec));

  // The link is built by the CALLER (the admin UI knows its own site base), so this Worker never has to
  // guess a public origin. The code is what matters here.
  return { status: 200, body: { ok: true, invite: inviteSummary(rec, now) } };
}

/**
 * GET /membership/admin/invites -> { ok, invites: [...] }
 * One list sweep over the invite: prefix, mirroring the redemption sweep in membership-coupons-admin.
 * Newest first, so the thing an admin just issued is at the top.
 */
export async function membershipInviteList(request, env, { authorize = authorizeAdmin, now = new Date(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: INVITE_KEY_PREFIX, cursor });
    for (const k of page?.keys ?? []) names.push(k.name);
    cursor = page?.list_complete ? null : page?.cursor;
  } while (cursor);

  const invites = [];
  for (const name of names) {
    const key = name.slice(INVITE_KEY_PREFIX.length);
    const rec = await readInvite(kv, key);
    const s = inviteSummary(rec, now);
    // A record that will not parse at all yields null and is genuinely absent. A record that parses but is
    // STRUCTURALLY BAD resolves to state `unknown`, and it is kept deliberately: dropping it would make a
    // corrupt invite invisible to the only surface that could notice, which is the silent-truncation
    // failure this system tries not to have. The key is carried alongside so an admin can find it in KV
    // even when the record's own `code` field disagrees with where it is stored.
    if (s) invites.push(s.state === 'unknown' ? { ...s, code: s.code || key, key, corrupt: true } : s);
  }
  invites.sort((a, b) => String(b.issuedAt ?? '').localeCompare(String(a.issuedAt ?? '')));
  return { status: 200, body: { ok: true, invites } };
}

/**
 * PATCH /membership/admin/invites -> revoke an invite, or set its administration note.
 * Body: { code, action: 'revoke' | 'note', note? }
 *
 * Revoking a REDEEMED invite is refused by the core (revokeInvite), because the grant it produced is
 * already live and is taken back through the grandfather machinery rather than by editing the issuance
 * record. The endpoint reports that as a 409 rather than a silent no-op.
 */
export async function membershipInviteUpdate(request, env, { authorize = authorizeAdmin, now = new Date(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  let body;
  try { body = await request.json(); } catch { return bad(400, 'bad_request', 'a JSON body is required'); }

  const code = normalizeCouponCode(body?.code);
  const rec = await readInvite(kv, code);
  if (!rec) return bad(404, 'not_found', `no invite named ${code || '(none)'}`);

  const action = String(body?.action ?? '');
  let result;
  if (action === 'revoke') result = revokeInvite(rec, { by: auth.githubId, now });
  else if (action === 'note') result = setInviteNote(rec, body?.note ?? '');
  else return bad(400, 'bad_request', "action must be 'revoke' or 'note'");

  if (!result.changed) {
    // Not an error for a note that already reads that way; it IS one for a revoke that cannot apply.
    if (action === 'revoke') return bad(409, 'not_revocable', 'a redeemed invite is taken back through the grandfather grant, not here');
    return { status: 200, body: { ok: true, changed: false, invite: inviteSummary(rec, now) } };
  }

  await kv.put(inviteKey(code), JSON.stringify(result.next));
  return { status: 200, body: { ok: true, changed: true, invite: inviteSummary(result.next, now) } };
}
