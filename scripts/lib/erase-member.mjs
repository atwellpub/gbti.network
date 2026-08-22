// SOW-024: the right-to-erasure tool library. Erasing a member is now AUTO-DRIVEN for the safe, reversible
// moves and the per-member edge-store keys, with the irreversible moves (Stripe delete, content REMOVAL,
// crypto-shred) kept deliberately gated. On --apply the orchestrator (runErasure) performs:
//   - the per-member KV deletes: activity:<id> (favorites+collections), follows:<id> (the follow graph),
//     gh:<id> (the Stripe-customer lookup cache);
//   - Discord: removes the member's managed roles (Member/Trial/Locked);
//   - content: ONE auto-merged PR that flips the member's content -> draft AND removes their members-index
//     entry (reversible; git history persists, disclosed in the TOS);
//   - Stripe customer delete ONLY when --delete-stripe is explicitly passed (irreversible; tax-retention).
// Crypto-shred (the global SOW-016 key rotation) and de-index stay manual. Every step is identity-minimally
// recorded to the deletable erasure audit log (scripts/lib/erase-audit.mjs).
//
// Pure + injectable (env + fetch + clients), so each piece is unit-tested with fakes (no network, no secrets).
// Mirrors scripts/lib/kv-mirror.mjs for the CF KV REST calls.

import yaml from 'js-yaml';
import { flipStatus } from '../reconcile.mjs';
import { buildAuditRecord, storeAuditRecord } from './erase-audit.mjs';
import { scrubVoter } from '../../membership/share-votes.mjs';
import { INVITE_KEY_PREFIX } from '../../membership/invites.mjs'; // sow-231 Phase 2
import { scrubOpener } from '../../membership/news-opens.mjs'; // SOW-111: per-item news detail-open sets
import { scrubOpener as scrubContentOpener } from '../../membership/content-opens.mjs'; // SOW-126: per-item content-open sets
import { scrubCounterpart } from '../../workers/signup/conversion-snapshot-store.mjs'; // SOW-059 P1c
import { couponGrantKey } from '../../workers/signup/coupons.mjs'; // SOW-119 / sow-212: the one-per-member lock
import { redemptionKey, redemptionCountKey } from '../../membership/coupons.mjs'; // SOW-119 key builders
import { removeGrantEntryIfPresent, listCouponRedemptions, GRANDFATHERED_PATH } from './coupon-grants.mjs';
import { couponLockKey, COUPON_LOCK_VALUE } from '../../membership/coupon-lock.mjs'; // sow-212: the minimized lock
import { mailHash } from '../../membership/mail-suppress.mjs'; // SOW-166: the keyed identity behind every mail key
import { eraseSubscriberMail } from '../../workers/signup/mail-store.mjs'; // SOW-166: the one shared mail eraser
import { normalizeFollows, followingUsernames } from '../../membership/member-follows.mjs'; // SOW-186 phase 3
import { FOLLOWERS_KEY, normalizeFollowers, applyFollower } from '../../membership/member-followers.mjs'; // SOW-186 phase 3

export const ACTIVITY_KEY = (githubId) => `activity:${githubId}`;
export const FOLLOWS_KEY = (githubId) => `follows:${githubId}`; // SOW-023 subscription graph
export const NOTIFICATIONS_KEY = (githubId) => `notifications:${githubId}`; // SOW-150/186 per-member notification store
export const DRAFTS_KEY = (githubId) => `drafts:${githubId}`; // SOW-157 hosted draft staging
export const PREFS_KEY = (githubId) => `prefs:${githubId}`; // SOW-046 member prefs (categories + followed news channels)
export const LOOKUP_KEY = (githubId) => `gh:${githubId}`; // the github_id -> Stripe customer_id lookup cache
export const CONV_SNAPSHOT_KEY = (githubId) => `conv:${githubId}`; // SOW-059 P1c: the frozen conversion attribution snapshot
export const MEMBERS_INDEX_PATH = 'house/members-index.yml';
// SOW-119 coupon lock. Delegates to the canonical builder rather than restating `coupon-grant:<id>`: a
// duplicated key literal is exactly how two halves of this system have drifted before.
export const COUPON_GRANT_KEY = (githubId) => couponGrantKey(String(githubId));
const toBase64 = (str) => Buffer.from(str, 'utf8').toString('base64');

/**
 * DELETE one key from the signup Worker's KV via the Cloudflare REST API. Returns { deleted, key, reason }.
 * Missing credentials (local dry-runs, tests) is a reported no-op, not a throw; a real API error throws.
 */
export async function deleteKvKey({ key, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { deleted: false, key, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: 'DELETE', headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`KV delete failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { deleted: true, key };
}

/** Hard-delete a member's activity (favorites + collections) from the deletable edge store. */
export async function eraseActivity({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: ACTIVITY_KEY(String(githubId)), env, fetchImpl });
}

/** Hard-delete a member's OUTBOUND follow graph (SOW-023) from the deletable edge store. Inbound follows
 *  (others following this member) self-heal: the feed drops a followed username with no published profile. */
export async function eraseFollows({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: FOLLOWS_KEY(String(githubId)), env, fetchImpl });
}

/** Hard-delete a member's prefs (SOW-046: category interests + followed news channels) from the deletable store. */
export async function erasePrefs({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: PREFS_KEY(String(githubId)), env, fetchImpl });
}

/** SOW-150/186 right-to-erasure: hard-delete the member's INBOUND notification store (mentions + followed-author
 *  publishes addressed to them). Per-recipient, keyed by their own github_id, so this is a computed-key delete
 *  like activity/follows. The follow GRAPH that produced these (who they follow, and their entry in others'
 *  reverse follower index) is erased separately (eraseFollows + eraseReverseFollows, SOW-186 phase 3). */
export async function eraseNotifications({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: NOTIFICATIONS_KEY(String(githubId)), env, fetchImpl });
}

/**
 * SOW-186 phase 3 right-to-erasure, BOTH directions of the reverse follower index (followers:<username>):
 *   - AS A FOLLOWER: read follows:<github_id> (the member's outbound list) and remove their github_id from
 *     followers:<eachFollowedUsername>. This erases the member's follow CHOICES from the reverse index AND
 *     stops a followed author's next publish from re-creating a notifications:<github_id> for an erased member.
 *   - AS A FOLLOWED TARGET: delete followers:<username> (the dangling inbound index keyed by the erased
 *     member). The follower github_ids in it are OTHER members' data, preserved in their own forward follows:
 *     lists (the source of truth), so deleting this derived index loses nothing recoverable.
 *
 * ORDER IS LOAD-BEARING: this reads follows:<github_id>, so it MUST run BEFORE the `follows` step deletes it.
 * The step order in runErasure enforces it. Reported no-op without CF creds. A targeted scrub (via the member's
 * own outbound list), never a full followers:* scan.
 */
export async function eraseReverseFollows({ githubId, username = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const accountId = env.CF_ACCOUNT_ID, namespaceId = env.CF_KV_NAMESPACE_ID, apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { skipped: true, reason: 'CF creds not set' };
  const id = String(githubId);
  const readJson = async (key) => { const t = await readKvValue({ key, env, fetchImpl }); if (t == null) return null; try { return JSON.parse(t); } catch { return null; } };

  // AS A FOLLOWER: use the member's OWN outbound list to scrub only the reverse sets they appear in.
  let outboundScrubbed = 0;
  const fwd = await readJson(FOLLOWS_KEY(id));
  if (fwd) {
    for (const followedUsername of followingUsernames(normalizeFollows(fwd))) {
      const key = FOLLOWERS_KEY(followedUsername);
      const before = normalizeFollowers(await readJson(key));
      const after = applyFollower(before, { githubId: id, on: false });
      if (after.followers.length !== before.followers.length) {
        await putKvValue({ key, value: JSON.stringify(after), env, fetchImpl });
        outboundScrubbed++;
      }
    }
  }

  // AS A FOLLOWED TARGET: delete the dangling inbound index keyed by this member's username.
  let inboundDeleted = false;
  if (username) {
    const key = FOLLOWERS_KEY(String(username).toLowerCase());
    if ((await readKvValue({ key, env, fetchImpl })) !== null) {
      await deleteKvKey({ key, env, fetchImpl });
      inboundDeleted = true;
    }
  }
  return { scrubbed: outboundScrubbed + (inboundDeleted ? 1 : 0), outboundScrubbed, inboundDeleted };
}

/** Hard-delete a member's hosted draft store (SOW-157: staged authoring state, may contain unpublished text). */
export async function eraseDrafts({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: DRAFTS_KEY(String(githubId)), env, fetchImpl });
}

/** Hard-delete the github_id -> Stripe customer_id lookup cache (`gh:<github_id>`). It is per-member identity
 *  data; after a Stripe delete it would dangle, and even without one it maps the member to their billing record,
 *  so it is part of the erasure set. A signup re-resolves via Stripe Search if the member ever returns. */
export async function eraseLookupCache({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: LOOKUP_KEY(String(githubId)), env, fetchImpl });
}

/** List KV entries (key + parsed JSON value) under a prefix via the REST API. Missing creds = a reported no-op. */
export async function listKvByPrefix({ prefix, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { available: false, reason: 'CF creds not set', entries: [] };
  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };
  const keys = [];
  let cursor = '';
  for (let page = 0; page < 100000; page++) {
    const url = `${apiBase}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
    const json = await res.json();
    for (const k of json?.result ?? []) if (k?.name) keys.push(k.name);
    cursor = json?.result_info?.cursor || '';
    if (!cursor) break;
  }
  const entries = [];
  for (const key of keys) {
    const res = await fetchImpl(`${apiBase}/values/${encodeURIComponent(key)}`, { headers });
    if (!res || !res.ok) continue;
    let value = null;
    try { value = await res.json(); } catch { value = null; }
    if (value && typeof value === 'object') entries.push({ key, value });
  }
  return { available: true, entries };
}

/** PUT a KV value via the REST API. Missing creds = a reported no-op. */
export async function putKvValue({ key, value, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return { written: false, reason: 'CF creds not set' };
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { method: 'PUT', headers: { Authorization: `Bearer ${apiToken}` }, body: typeof value === 'string' ? value : JSON.stringify(value) });
  if (!res || !res.ok) throw new Error(`KV put failed: ${res ? res.status : 'no response'}`);
  return { written: true, key };
}

/**
 * SOW-057 GDPR: scrub the member's github_id from every per-target share-vote set (`upvotes:share:*`). These sets
 * are keyed by TARGET (not by member), so the per-member activity: delete does not reach them. Removing the id
 * (and clearing it as the cached author when it matches) is the erasure for the behavioral upvote data. The
 * syndication queue items (synd:item:*) reference the author by public username + auto-expire via TTL, so they
 * are not scrubbed here. Reported no-op without CF creds.
 */
export async function eraseShareVotes({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'upvotes:share:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    const { record, changed } = scrubVoter(value, String(githubId));
    if (changed) {
      await putKvValue({ key, value: JSON.stringify(record), env, fetchImpl });
      scrubbed++;
    }
  }
  return { scrubbed };
}

/**
 * SOW-111 GDPR: scrub the member's github_id from every per-item news detail-open set (`news-opens:*`). These
 * sets are keyed by news guid (not by member), so the per-member activity: delete does not reach them.
 * Mirrors eraseShareVotes (list -> scrub -> write back). Reported no-op without CF creds.
 */
export async function eraseNewsOpens({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'news-opens:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    const { record, changed } = scrubOpener(value, String(githubId));
    if (changed) {
      await putKvValue({ key, value: JSON.stringify(record), env, fetchImpl });
      scrubbed++;
    }
  }
  return { scrubbed };
}

/**
 * SOW-126 GDPR: scrub the member's github_id from every per-item content detail-open set (`content-opens:*`).
 * Keyed by content item (not by member), so the per-member activity: delete does not reach them. Mirrors
 * eraseNewsOpens. Reported no-op without CF creds.
 */
export async function eraseContentOpens({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'content-opens:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    const { record, changed } = scrubContentOpener(value, String(githubId));
    if (changed) {
      await putKvValue({ key, value: JSON.stringify(record), env, fetchImpl });
      scrubbed++;
    }
  }
  return { scrubbed };
}

/** GET one raw KV value via the REST API (used for the shared coupon counter). Missing creds = null. */
export async function readKvValue({ key, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return null;
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${apiToken}` } });
  if (!res || !res.ok) return null;
  return res.text ? res.text().catch(() => null) : null;
}

/**
 * SOW-119 / sow-212: hard-delete the raw coupon grant `coupon-grant:<githubId>`.
 *
 * NOT used by erasure. The owner ruled on 2026-08-11 that the one-coupon-per-member lock SURVIVES an
 * erasure, so erasure calls minimizeCouponGrant below instead. This outright delete exists for the sow-212
 * TEST RESET, where the whole point is to make a disposable account redeemable again.
 *
 * The two are deliberately separate functions rather than one function with a flag: "erase this person" and
 * "make this test account reusable" are different intents, and a boolean parameter is how they would end up
 * confused at a call site.
 */
export async function eraseCouponGrant({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: couponGrantKey(String(githubId)), env, fetchImpl });
}

/** sow-212: delete the MINIMIZED lock too. Test-reset only, for an account erased before it was reset. */
export async function eraseCouponLock({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const key = await couponLockKey(env.COUPON_LOCK_KEY, githubId);
  if (!key) return { skipped: true, reason: 'COUPON_LOCK_KEY not set (cannot compute the lock key)' };
  return deleteKvKey({ key, env, fetchImpl });
}

/**
 * SOW-119 / erasure: MINIMIZE the coupon grant instead of deleting it.
 *
 * Owner ruling, 2026-08-11: the lock stays, because deleting it would let an erased account redeem the same
 * coupon again. SecurityMaster's minimization branch reconciles that with Article 17: write a keyed HASH of
 * the github_id (membership/coupon-lock.mjs), then delete the raw-id record. The lock keeps working; the
 * stored artifact stops being a direct identifier.
 *
 * ORDER IS LOAD-BEARING: write the hashed lock FIRST, delete the raw record second. If the process dies
 * between the two, the failure mode is a duplicated lock (harmless, both deny) rather than no lock at all
 * (which silently restores the abuse the owner asked us to prevent).
 *
 * FAIL CLOSED WITHOUT THE SALT: with no COUPON_LOCK_KEY there is no way to write a lock that redeemCoupon
 * could later find, so this does NOT delete the raw record. Reported as skipped with the reason, never a
 * silent pass: leaving identifying data in place is the lesser harm against restoring a coupon exploit, and
 * an operator who sees the skip can provision the key and re-run.
 */
export async function minimizeCouponGrant({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const lockKey = await couponLockKey(env.COUPON_LOCK_KEY, githubId);
  if (!lockKey) {
    return { skipped: true, reason: 'COUPON_LOCK_KEY not set: raw coupon-grant KEPT rather than delete the one-per-member lock' };
  }
  const existing = await readKvValue({ key: couponGrantKey(String(githubId)), env, fetchImpl });
  if (existing === null) return { skipped: true, reason: 'no coupon grant to minimize' };
  await putKvValue({ key: lockKey, value: COUPON_LOCK_VALUE, env, fetchImpl });
  return deleteKvKey({ key: couponGrantKey(String(githubId)), env, fetchImpl });
}

/**
 * SOW-119 / sow-212: delete every `redemption:<CODE>:<githubId>` record for this member and DECREMENT the
 * shared per-code counter `redemptions:<CODE>` for each one removed.
 *
 * Two things here are deliberate and easy to get wrong:
 *   - The redemption key carries the github_id in the KEY NAME, so it is person-keyed data in its own right
 *     (SecurityMaster, 2026-08-11), not merely a value holding an id.
 *   - The counter is SHARED ACROSS ALL MEMBERS and enforces a coupon's maxRedemptions. It is decremented,
 *     never deleted: deleting it would un-burn every other member's redemption and silently hand back
 *     capacity on a capped coupon. Clamped at zero so a repeated run cannot drive it negative.
 *
 * Reuses listCouponRedemptions (the canonical `redemption:` sweep) rather than re-deriving the key shape.
 * Reported no-op without CF creds, matching every other step here.
 */
export async function eraseCouponRedemptions({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listCouponRedemptions({ env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const id = String(githubId);
  const mine = (listed.redemptions ?? []).filter((r) => String(r.githubId) === id);
  let scrubbed = 0;
  for (const r of mine) {
    await deleteKvKey({ key: redemptionKey(r.code, id), env, fetchImpl });
    const countKey = redemptionCountKey(r.code);
    const current = Number(await readKvValue({ key: countKey, env, fetchImpl })) || 0;
    await putKvValue({ key: countKey, value: String(Math.max(0, current - 1)), env, fetchImpl });
    scrubbed++;
  }
  return { scrubbed };
}

/**
 * sow-231 Phase 2: MINIMIZE the issued invites this member redeemed.
 *
 * WHY THIS NEEDS A SWEEP RATHER THAN A COMPUTED KEY. Every other record here is keyed by the github_id, so
 * erasure computes the exact key and deletes it. An invite is keyed by its CODE, and the member's id appears
 * only INSIDE the record as `redeemedBy`, so there is no key to compute. This mirrors eraseCouponRedemptions,
 * which has the same problem for the same reason and solves it by listing the prefix and filtering.
 *
 * MINIMIZED, NOT DELETED, per the standing owner ruling that the one-coupon-per-member lock survives erasure
 * while the identifying record does not. The invite must keep saying it was issued and used, or a superadmin
 * loses the audit trail of a seat they gave away and the campaign's own accounting silently changes. What is
 * removed is WHO used it: `redeemedBy` and `redeemedByLogin` are nulled, `redeemedAt` is kept because a date
 * with no person attached identifies nobody.
 *
 * The administration note is deliberately NOT touched here. It is superadmin-authored text about the
 * OUTREACH ("sent to the lead at X"), it may name a person, and it is exactly the sort of field an erasure
 * should consider. It is left because deciding that is the owner's call and quietly redacting an admin's
 * own note is not a decision a cleanup step should make on its own. Flagged in the SOW rather than done.
 */
export async function minimizeRedeemedInvites({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: INVITE_KEY_PREFIX, env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const id = String(githubId);
  let minimized = 0;
  // listKvByPrefix returns { key, value } with the value ALREADY PARSED, and it drops anything that did not
  // parse as an object, so a corrupt record is skipped upstream rather than needing a second read here.
  for (const { key, value } of listed.entries ?? []) {
    if (String(value?.redeemedBy ?? '') !== id) continue;
    await putKvValue({ key, value: JSON.stringify({ ...value, redeemedBy: null, redeemedByLogin: null }), env, fetchImpl });
    minimized++;
  }
  return { minimized };
}

/** Hard-delete the member's OWN frozen conversion snapshot (SOW-059: their attribution + invite/collaboration record). */
export async function eraseConversionSnapshot({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  return deleteKvKey({ key: CONV_SNAPSHOT_KEY(String(githubId)), env, fetchImpl });
}

/**
 * SOW-059 GDPR: scrub the member's github_id from every OTHER member's frozen snapshot where they appear as a
 * COUNTERPART (first/last-touch owner, an item owner, the inviter, or a collaboration recipient). The per-member
 * conv:<id> delete does not reach those. Nulling the id makes that share fall to retained at payout (money-safe).
 * Reported no-op without CF creds. Mirrors eraseShareVotes (list -> scrub -> write back).
 */
export async function scrubConversionSnapshots({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const listed = await listKvByPrefix({ prefix: 'conv:', env, fetchImpl });
  if (!listed.available) return { skipped: true, reason: listed.reason };
  const own = CONV_SNAPSHOT_KEY(String(githubId));
  let scrubbed = 0;
  for (const { key, value } of listed.entries) {
    if (key === own) continue; // their own record is deleted by eraseConversionSnapshot, not scrubbed
    const cleaned = scrubCounterpart(value, String(githubId));
    if (cleaned) { await putKvValue({ key, value: JSON.stringify(cleaned), env, fetchImpl }); scrubbed++; }
  }
  return { scrubbed };
}

/**
 * The ordered erasure runbook for a member (SOW-024). `auto: true` steps this tool performs on --apply; the
 * rest are the operator checklist (composed from reconcile + the SOW-016 rotation), printed so nothing is
 * silently skipped. Pure (returns data), so it is unit-tested.
 */
/**
 * A Workers-KV-shaped facade over the REST helpers above, so the SCRIPT side and the WORKER side run the SAME
 * erasure logic (`eraseSubscriberMail`) instead of two implementations that can drift. An erasure path is the
 * worst possible place for two implementations, because the failure mode is silent: records that were never
 * deleted look exactly like records that were.
 *
 * `get` honours the TYPE ARGUMENT because mail-store.mjs uses both forms (`kv.get(k, 'json')` at the issue,
 * send, pending and subscriber reads, plain `kv.get(k)` at the existence checks). A shim that ignored it would
 * hand back a raw string where an object was expected, every parse would yield null, and the erasure would
 * report success having deleted nothing.
 *
 * `list` is keys-only ON PURPOSE and does not reuse listKvByPrefix, which fetches every value and then DROPS
 * any entry whose value is not a JSON object. That filter is harmless where it is used; here it would silently
 * skip an issue whose body failed to parse, and with it that issue's send record for this person. Enumerating
 * keys without reading values is both cheaper and the only version that cannot lose a key.
 */
export function kvRestShim({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) return null;
  const base = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}`;
  const headers = { Authorization: `Bearer ${apiToken}` };
  return {
    async get(key, type) {
      const text = await readKvValue({ key, env, fetchImpl });
      if (text == null) return null;
      if (type !== 'json') return text;
      try { return JSON.parse(text); } catch { return null; }
    },
    async put(key, value) {
      return putKvValue({ key, value, env, fetchImpl });
    },
    async delete(key) {
      return deleteKvKey({ key, env, fetchImpl });
    },
    async list({ prefix, cursor } = {}) {
      const url = `${base}/keys?prefix=${encodeURIComponent(prefix ?? '')}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
      const res = await fetchImpl(url, { headers });
      if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
      const json = await res.json();
      const next = json?.result_info?.cursor || '';
      return {
        keys: (json?.result ?? []).filter((k) => k?.name).map((k) => ({ name: k.name })),
        list_complete: !next,
        cursor: next || undefined,
      };
    },
  };
}

/**
 * SOW-166 right-to-erasure: delete the member's weekly-digest records.
 *
 * THIS STEP MUST RUN BEFORE THE STRIPE CUSTOMER DELETE, and that is a correctness constraint rather than a
 * preference. Every mail key is derived from the ADDRESS via mailHash, while erasure is driven by github_id,
 * so nothing in the mail keyspace can be located from a github_id alone. The address lives in exactly one
 * place we can still read: the Stripe customer. Once step `stripe` deletes it, the hash can never be computed
 * again and the subscriber record is unreachable BY ANY FUTURE RUN, permanently. Each step looks correct on
 * its own, which is precisely why the ordering is written down here and asserted by a test rather than left to
 * whoever next edits runErasure.
 *
 * The suppression marker `mail:suppress:<hash>` deliberately SURVIVES (eraseSubscriberMail keeps it). Deleting
 * it would silently re-contact someone who asked not to be contacted, and it holds a bare keyed hash with no
 * address in it. Same shape the owner already ruled on for the coupon lock on 2026-08-11: the record that
 * prevents a future harm outlives erasure in a form that can answer "has this opted out" but never "who".
 *
 * Fails SOFT and says why. Every skip reason is reported rather than swallowed, because "no mail records were
 * deleted" and "we could not tell whether there were any" must never look the same in the audit record.
 */
export async function eraseMailRecords({ githubId, stripe = null, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const secret = env.MAIL_SUPPRESS_KEY;
  if (!secret) return { skipped: true, reason: 'MAIL_SUPPRESS_KEY not set locally; the mail hash cannot be computed (see secrets-ops)' };
  if (!stripe) return { skipped: true, reason: 'no Stripe client (set STRIPE_SECRET_KEY); the address is the only input to the hash' };

  let customer = null;
  try { customer = await stripe.findCustomerByGithubId(String(githubId)); } catch (e) { return { error: e?.message || 'Stripe lookup failed' }; }
  if (!customer?.id) return { skipped: true, reason: 'no Stripe customer found (already deleted? this step must run BEFORE the stripe step)' };
  if (!customer?.email) return { skipped: true, reason: 'Stripe customer has no email; nothing to derive the mail hash from' };

  const hash = await mailHash(secret, customer.email);
  if (!hash) return { skipped: true, reason: 'mailHash returned null (blank secret or address)' };

  const kv = kvRestShim({ env, fetchImpl });
  if (!kv) return { skipped: true, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };

  const counts = await eraseSubscriberMail(kv, hash);
  return { ...counts, suppressionMarkerKept: true };
}

export function planErasure({ githubId, username } = {}) {
  const who = username ? `members/${username}/` : "the member's";
  return [
    { step: 'content', auto: true, tool: 'erase-member.mjs --apply', action: `Flip ${who} content status -> draft via an auto-merged PR (reversible; history persists), and remove their house/grandfathered.yml grant in the same PR.` },
    { step: 'coupon-grant', auto: true, tool: 'erase-member.mjs --apply', action: `MINIMIZE ${COUPON_GRANT_KEY(githubId)}: write a keyed-hash lock, then delete the raw-id record. The one-coupon-per-member lock SURVIVES erasure (owner ruling 2026-08-11); needs COUPON_LOCK_KEY.` },
    { step: 'coupon-redemptions', auto: true, tool: 'erase-member.mjs --apply', action: `Delete every redemption:<CODE>:${githubId} record (the id is in the key name) and decrement each shared redemptions:<CODE> counter.` },
    { step: 'activity', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the edge-store keys ${ACTIVITY_KEY(githubId)} (favorites + collections) and ${FOLLOWS_KEY(githubId)} (the follow graph).` },
    { step: 'notifications', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete ${NOTIFICATIONS_KEY(githubId)} (SOW-150/186: the member's inbound notifications -- mentions + followed-author publishes).` },
    { step: 'reverse-follows', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-186: remove github_id ${githubId} from followers:<each followed username> (read from follows:${githubId}, so BEFORE the follows delete) and delete ${username ? FOLLOWERS_KEY(username) : 'followers:<username>'} (the inbound index). Follower github_ids survive in their own forward follows: lists.` },
    { step: 'lookup-cache', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the lookup-cache key ${LOOKUP_KEY(githubId)} (github_id -> Stripe customer_id).` },
    { step: 'share-votes', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every per-target share-vote set (upvotes:share:*); syndication queue items auto-expire via TTL.` },
    { step: 'news-opens', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every per-item news detail-open set (news-opens:*, SOW-111).` },
    { step: 'conv-snapshot', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the member's frozen conversion snapshot ${CONV_SNAPSHOT_KEY(githubId)} (SOW-059).` },
    { step: 'conv-counterpart', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every OTHER member's frozen snapshot (conv:*) where they are a first/last-touch owner, inviter, or collaborator.` },
    { step: 'mail', auto: true, tool: 'erase-member.mjs --apply', action: `SOW-166: resolve the address from Stripe, compute the mail hash, then delete mail:subscriber:<hash> and every mail:send:<issue>:<hash>. The unsubscribe marker mail:suppress:<hash> SURVIVES (deleting it would silently re-contact someone who opted out). MUST run before the stripe step: after it, the address is gone and the hash can never be computed again.` },
    { step: 'discord', auto: true, tool: 'erase-member.mjs --apply', action: 'Remove the member\'s managed Discord roles (Member/Trial/Locked).' },
    { step: 'members-index', auto: true, tool: 'erase-member.mjs --apply', action: 'Remove the members-index.yml entry (bundled into the content erasure PR).' },
    { step: 'crypto-shred', auto: false, tool: 'scripts/rotate-member-key.mjs', action: 'Rotate the SOW-016 member-content key (global) so the public-history ciphertext becomes keyless.' },
    { step: 'stripe', auto: false, tool: 'erase-member.mjs --apply --delete-stripe (opt-in)', action: 'Delete the Stripe customer (IRREVERSIBLE; anonymize instead where tax-record retention applies).' },
    { step: 'kv-mirror', auto: false, tool: 'scripts/reconcile.mjs --apply', action: 'Re-run reconcile so the overrides mirror + derived status no longer reference the member.' },
    { step: 'de-index', auto: false, tool: 'manual', action: 'Best-effort: purge jsDelivr + request search-engine removal. Forks/archives are outside our control (disclosed in the TOS).' },
  ];
}

/** Reduce a step result to its identity-free audit outcome (no personal fields). outcome in
 *  deleted|removed|drafted|skipped|error. `detail` is a generic string (a reason or a count), never PII. */
function summarizeStep(step, res) {
  if (res?.error) return { step, outcome: 'error', detail: String(res.error).slice(0, 120) };
  if (res?.skipped) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === false) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === true) return { step, outcome: 'deleted' };
  if (res?.deletedCustomer) return { step, outcome: 'deleted' };
  if (typeof res?.scrubbed === 'number') return { step, outcome: res.scrubbed ? 'deleted' : 'skipped', detail: res.scrubbed ? `votes:${res.scrubbed}` : 'none' };
  if (typeof res?.flipped === 'number') return { step, outcome: 'drafted', detail: `pr#${res.pr} flipped:${res.flipped} index:${res.indexRemoved ? 'removed' : 'kept'} grant:${res.grantRemoved ? 'removed' : 'kept'}` };
  if (Array.isArray(res?.removed)) return { step, outcome: res.removed.length ? 'removed' : 'skipped', detail: res.removed.length ? res.removed.join('+') : (res.reason || 'no roles held') };
  return { step, outcome: 'ok' };
}

/**
 * Remove the member's managed Discord roles (Member/Trial/Locked). The discord_user_id is read from Stripe
 * metadata (it is never stored in our KV). Reported no-op when the Discord client, guild, or discord_user_id is
 * absent, or the member is not in the guild. Never throws on a single role removal (best-effort per role).
 */
export async function eraseDiscordRoles({ githubId, stripe = null, discord = null, env = process.env } = {}) {
  if (!discord) return { skipped: true, reason: 'no Discord client (set DISCORD_BOT_TOKEN)' };
  const guildId = env.DISCORD_GUILD_ID;
  if (!guildId) return { skipped: true, reason: 'DISCORD_GUILD_ID not set' };
  let discordUserId = null;
  if (stripe) {
    try {
      const c = await stripe.findCustomerByGithubId(String(githubId));
      discordUserId = c?.metadata?.discord_user_id ?? null;
    } catch { /* Stripe Search lag / error: treat as no id, skip */ }
  }
  if (!discordUserId) return { skipped: true, reason: 'no discord_user_id in Stripe metadata' };

  const roleIds = { member: env.DISCORD_MEMBER_ROLE_ID, trial: env.DISCORD_TRIAL_ROLE_ID, locked: env.DISCORD_LOCKED_ROLE_ID, creator: env.DISCORD_CREATOR_ROLE_ID }; // sow-185: also strip the Content-Creator badge on erasure
  let member = null;
  try { member = await discord.getMember(guildId, discordUserId); } catch { member = null; }
  if (!member) return { skipped: true, reason: 'member not in the guild (nothing to remove)' };
  const held = Array.isArray(member.roles) ? member.roles : [];
  const removed = [];
  for (const [name, id] of Object.entries(roleIds)) {
    if (id && held.includes(id)) {
      try { await discord.removeRole(guildId, discordUserId, id); removed.push(name); } catch { /* best-effort per role */ }
    }
  }
  return { removed };
}

/**
 * ONE auto-merged PR that flips every published file in the member's folder to draft, removes their
 * members-index entry, AND removes their house/grandfathered.yml grant. Reversible (a re-subscribe /
 * un-erase can re-publish); git history persists, which is disclosed in the TOS. Reported no-op without a
 * GitHub client or any net change. `files` is the member's content descriptors ([{ path, status }]) from
 * buildRepoIndex; reading happens in the caller so this is testable with a fake github client.
 *
 * The GRANDFATHERED removal was added 2026-08-11 (SecurityMaster's adjudication, relayed by SowMaster).
 * house/grandfathered.yml is the "durable record" the SOW-119 coupon fold writes to, it is committed to a
 * PUBLIC repo, and it carries per person the github_id, login, a `reason` describing their commercial
 * relationship, and an `until`. Erasure removed the members-index entry and touched no other house/*.yml,
 * so an erased member stayed published there. It rides in THIS PR because the machinery already exists.
 *
 * A username is required for the content flip but NOT for the two house-file removals, so a member with no
 * folder still gets their records stripped.
 */
export async function eraseContent({ github = null, githubId, username, files = [], base = 'main', now = new Date() } = {}) {
  if (!github) return { skipped: true, reason: 'no GitHub client (set GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO)' };

  const id = String(githubId);
  const decode = (b) => Buffer.from(b, 'base64').toString('utf8');
  const safeYaml = (text) => { try { return yaml.load(text) || {}; } catch { return null; } };

  // Phase 1 -- DECIDE from the base branch. Cheap reads that determine WHETHER there is anything to change, so
  // the no-op case creates no branch. The shas read here are NOT used to commit (that would be a TOCTOU).
  const toFlip = [];
  for (const f of files) {
    const existing = await github.getContent(f.path, base);
    if (!existing?.content) continue;
    const current = decode(existing.content);
    if (flipStatus(current, 'draft') !== current) toFlip.push(f.path);
  }
  let wantIndexRemoval = false;
  const idxBase = await github.getContent(MEMBERS_INDEX_PATH, base);
  if (idxBase?.content) {
    const parsed = safeYaml(decode(idxBase.content));
    if (parsed?.members && Object.prototype.hasOwnProperty.call(parsed.members, id)) wantIndexRemoval = true;
  }
  // The grandfather grant (SOW-119 fold target). Decided textually: removeGrantEntryIfPresent is a line
  // splice, because a yaml.dump round-trip would destroy this file's per-person comments and header.
  let wantGrantRemoval = false;
  const grantBase = await github.getContent(GRANDFATHERED_PATH, base);
  if (grantBase?.content) {
    wantGrantRemoval = removeGrantEntryIfPresent(decode(grantBase.content), id).removed;
  }
  if (toFlip.length === 0 && !wantIndexRemoval && !wantGrantRemoval) {
    return { skipped: true, reason: 'no published content, members-index entry, or grandfather grant to change' };
  }

  // Phase 2 -- COMMIT on a fresh branch, reading each target FROM THE BRANCH so the blob sha is authoritative
  // even if the base advanced since phase 1 (no TOCTOU; mirrors scripts/reconcile.mjs enactContent's order).
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) return { error: `cannot resolve base head sha for ${base}` };
  const branch = `erase/${id}-${now.getTime()}`;
  await github.createRef(branch, baseSha);

  let flipped = 0;
  for (const path of toFlip) {
    const onBranch = await github.getContent(path, branch);
    if (!onBranch?.content) continue;
    const current = decode(onBranch.content);
    const next = flipStatus(current, 'draft');
    if (next === current) continue; // a concurrent flip beat us to it: skip
    await github.putContent(path, { message: `erase: draft ${path}`, content: toBase64(next), branch, sha: onBranch.sha });
    flipped++;
  }

  let indexRemoved = false;
  if (wantIndexRemoval) {
    const onBranch = await github.getContent(MEMBERS_INDEX_PATH, branch);
    const parsed = onBranch?.content ? safeYaml(decode(onBranch.content)) : null;
    if (parsed?.members && Object.prototype.hasOwnProperty.call(parsed.members, id)) {
      delete parsed.members[id]; // removes ONLY this github_id; every other member is preserved by the round-trip
      await github.putContent(MEMBERS_INDEX_PATH, {
        message: `erase: remove members-index entry for github_id ${id}`,
        content: toBase64(yaml.dump(parsed, { lineWidth: 100, noRefs: true })),
        branch, sha: onBranch.sha,
      });
      indexRemoved = true;
    }
  }

  let grantRemoved = false;
  if (wantGrantRemoval) {
    const onBranch = await github.getContent(GRANDFATHERED_PATH, branch);
    if (onBranch?.content) {
      const { text, removed } = removeGrantEntryIfPresent(decode(onBranch.content), id);
      if (removed) {
        // Verify before committing: the result must still parse AND must no longer resolve a grant for this
        // id. A silent no-op on a splice is how a "removal" ships without removing anything.
        const reparsed = safeYaml(text);
        const stillThere = (reparsed?.grandfathered ?? []).some((e) => String(e?.github_id ?? '') === id);
        if (reparsed === null) return { error: 'grandfathered.yml did not parse after the removal; nothing committed' };
        if (stillThere) return { error: `grandfathered.yml still resolves a grant for ${id} after the removal; nothing committed` };
        await github.putContent(GRANDFATHERED_PATH, {
          message: `erase: remove grandfather grant for github_id ${id}`,
          content: toBase64(text),
          branch, sha: onBranch.sha,
        });
        grantRemoved = true;
      }
    }
  }

  if (flipped === 0 && !indexRemoved && !grantRemoved) {
    // The decided changes were applied concurrently between phase 1 and phase 2 (practically never for an
    // erasure target). Skip rather than open a diff-less PR (GitHub rejects those); the empty branch is inert.
    return { skipped: true, reason: 'content already drafted / records already removed concurrently' };
  }

  const removals = [
    indexRemoved ? 'the members-index entry' : null,
    grantRemoved ? 'the grandfather grant' : null,
  ].filter(Boolean);
  const pull = await github.createPull({
    title: `erase: draft ${username ?? `github_id ${id}`} content + remove house records`,
    head: branch,
    base,
    body:
      `Automated SOW-024 right-to-erasure for github_id ${id}: flips ${flipped} file(s) -> draft` +
      `${removals.length ? ` and removes ${removals.join(' and ')}` : ''}. Reversible; git history persists ` +
      '(disclosed in the TOS).',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { pr: pull.number, flipped, indexRemoved, grantRemoved };
}

/**
 * IRREVERSIBLE: delete the member's Stripe customer (removes the email + all metadata). Only invoked behind the
 * explicit --delete-stripe opt-in. Reported no-op without a Stripe client or a resolvable customer.
 */
export async function eraseStripeCustomer({ githubId, stripe = null } = {}) {
  if (!stripe) return { skipped: true, reason: 'no Stripe client (set STRIPE_SECRET_KEY)' };
  let customer = null;
  try { customer = await stripe.findCustomerByGithubId(String(githubId)); } catch (e) { return { error: e?.message || 'Stripe lookup failed' }; }
  if (!customer?.id) return { skipped: true, reason: 'no Stripe customer found (Search lag or already deleted)' };
  await stripe.deleteCustomer(customer.id);
  return { deletedCustomer: true };
}

/**
 * The erasure orchestrator. On --apply it runs the auto-driven steps (KV deletes, Discord, content+index),
 * optionally the irreversible Stripe delete, and records ONE identity-minimal audit entry. Each step is
 * fail-isolated: a thrown step is captured as an `error` outcome so the remaining steps still run and the audit
 * reflects exactly what happened. Returns { apply, steps, audit, record } (or { apply:false, plan } for dry-run).
 */
export async function runErasure({
  githubId, username = null, apply = false, deleteStripe = false, operator = null,
  env = process.env, fetchImpl = globalThis.fetch, clients = {}, files = [], now = new Date(),
} = {}) {
  if (!githubId) throw new Error('a github_id is required');
  if (!apply) return { apply: false, plan: planErasure({ githubId, username }) };

  const { stripe = null, github = null, discord = null } = clients;
  const steps = [];
  const runStep = async (name, fn) => {
    let res;
    try { res = await fn(); } catch (e) { res = { error: e?.message || String(e) }; }
    steps.push(summarizeStep(name, res));
    return res;
  };

  await runStep('activity', () => eraseActivity({ githubId, env, fetchImpl }));
  // SOW-186 phase 3: reads follows:<id>, so it MUST precede the follows delete below.
  await runStep('reverse-follows', () => eraseReverseFollows({ githubId, username, env, fetchImpl }));
  await runStep('follows', () => eraseFollows({ githubId, env, fetchImpl }));
  await runStep('notifications', () => eraseNotifications({ githubId, env, fetchImpl })); // SOW-150/186: inbound notification store
  await runStep('prefs', () => erasePrefs({ githubId, env, fetchImpl })); // SOW-046: categories + followed news channels
  await runStep('drafts', () => eraseDrafts({ githubId, env, fetchImpl })); // SOW-157: hosted draft staging
  await runStep('lookup-cache', () => eraseLookupCache({ githubId, env, fetchImpl }));
  await runStep('share-votes', () => eraseShareVotes({ githubId, env, fetchImpl })); // SOW-057: per-target voter sets
  await runStep('news-opens', () => eraseNewsOpens({ githubId, env, fetchImpl })); // SOW-111: per-item opener sets
  await runStep('content-opens', () => eraseContentOpens({ githubId, env, fetchImpl })); // SOW-126: per-item content-open sets
  await runStep('coupon-grant', () => minimizeCouponGrant({ githubId, env, fetchImpl })); // SOW-119: minimize, never delete (owner ruling)
  await runStep('coupon-redemptions', () => eraseCouponRedemptions({ githubId, env, fetchImpl })); // SOW-119: id-in-key records + counter
  await runStep('redeemed-invites', () => minimizeRedeemedInvites({ githubId, env, fetchImpl })); // sow-231: person-keyed by redeemedBy, so it needs a sweep
  await runStep('conv-snapshot', () => eraseConversionSnapshot({ githubId, env, fetchImpl })); // SOW-059: own frozen snapshot
  await runStep('conv-counterpart', () => scrubConversionSnapshots({ githubId, env, fetchImpl })); // SOW-059: scrub as counterpart
  // SOW-166. ORDER IS LOAD-BEARING: this reads the address off the Stripe customer to derive the mail hash, so
  // it must precede the `stripe` step below, which deletes that customer. Afterwards the key is underivable
  // and the records are stranded forever. Pinned by a test in test/erase-member-mail.test.mjs.
  await runStep('mail', () => eraseMailRecords({ githubId, stripe, env, fetchImpl }));
  await runStep('discord', () => eraseDiscordRoles({ githubId, stripe, discord, env }));
  await runStep('content', () => eraseContent({ github, githubId, username, files, now }));
  if (deleteStripe) await runStep('stripe', () => eraseStripeCustomer({ githubId, stripe }));

  const record = buildAuditRecord({ githubId, operator, apply: true, steps, now });
  let audit;
  try { audit = await storeAuditRecord({ record, env, fetchImpl }); }
  catch (e) { audit = { recorded: false, reason: `audit write failed: ${e?.message || e}` }; }
  return { apply: true, steps, audit, record };
}
