// SOW-024: encrypted, retention-bounded backups of the deletable edge store (Cloudflare KV). The member data
// that lives ONLY in KV -- `activity:<id>` (favorites + collections) and `follows:<id>` (the subscription
// graph) -- cannot be rebuilt from git or Stripe, so an operator error or corruption would lose it. This takes
// a point-in-time snapshot, ENCRYPTS it (AES-256-GCM via the SOW-016 crypto core, under a dedicated stable
// KV_BACKUP_KEY), and stores it at `backup:<iso>` with an `expiration_ttl` so it is RETENTION-BOUNDED.
//
// Two properties matter for GDPR:
//   - Encrypted at rest: the snapshot is unreadable in KV without KV_BACKUP_KEY (which never leaves the
//     operator env / Worker secret store; it is NOT the rotating member-content key, so backups stay
//     restorable within their window regardless of SOW-016 key rotation).
//   - Retention-bounded: each snapshot self-expires after the retention window, so an erased member's data ages
//     out of ALL backups within that window. "Fully erased" = erasure + the retention window (a standard,
//     bounded, defensible backup story).
//
// Pure + injectable (env + fetch + key), so the crypto round-trip + the no-op-without-creds paths are unit
// tested with fakes (no network, no secrets). Mirrors the CF KV REST pattern in scripts/lib/kv-mirror.mjs.
//
// RESTORE CAVEAT (operational, see the SOP): restoring an OLD snapshot can re-introduce data for a member who
// was erased AFTER it was taken. After any restore, re-run erasure for everyone erased since the snapshot.

import { encryptAsset, decryptAssetText } from '../../client/src/crypto-assets.mjs';

export const BACKUP_PREFIX = 'backup:';
// The KV-only member data worth backing up: it cannot be rebuilt from git or Stripe.
//   activity: (favorites + collections), follows: (the subscription graph), prefs: (category interests + followed
//   channels), conv: (SOW-059 frozen attribution snapshots -- frozen ONCE at conversion; the touch: records that fed
//   them are cleared at conversion + TTL-expire, so a lost conv: record loses the payout attribution PERMANENTLY),
//   coupon-grant: + redemption: (SOW-119 coupon redemptions -- the ONLY record of a member's free period until the
//   daily reconcile folds it into house/grandfathered.yml, and coupon-grant: stays the one-per-github_id lock
//   forever after; losing it un-burns a redeemed coupon and, pre-fold, silently reverts the member to a plain trial).
// Excluded ON PURPOSE: earnings: (recomputable by the payout job from conv: + Stripe + git), touch: (ephemeral, 90-day
//   TTL, cleared at conversion -- backing it up would EXTEND its retention, GDPR-adverse), gh: (the Stripe-lookup
//   cache) + overrides:mirror (both regenerable), redemptions: (the per-code counter, recomputable by counting
//   redemption: records), and the erasure-audit log (write-once, handled separately).
//   invite: (sow-231 issued invite links -- the ONLY record that a seat was given to a named person, carrying
//   the superadmin's administration note about the outreach. It cannot be rebuilt from git or Stripe: the
//   campaign is in house/coupons.yml but WHO was invited, when, by whom and with what note exists nowhere
//   else, and losing it also un-burns every single-use link that had already been redeemed).
export const BACKED_UP_PREFIXES = ['activity:', 'follows:', 'prefs:', 'conv:', 'coupon-grant:', 'redemption:', 'invite:'];
export const DEFAULT_RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days
export const SNAPSHOT_KEY = (iso) => `${BACKUP_PREFIX}${iso}`;

const cfCreds = (env) => (env.CF_ACCOUNT_ID && env.CF_KV_NAMESPACE_ID && env.CF_API_TOKEN ? env : null);
const cfBase = (env) => `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.CF_KV_NAMESPACE_ID}`;
const NO_CREDS = 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set';

async function listKeys({ env, fetchImpl, prefix }) {
  const headers = { Authorization: `Bearer ${env.CF_API_TOKEN}` };
  const out = [];
  let cursor = '';
  for (let page = 0; page < 100000; page++) {
    const url = `${cfBase(env)}/keys?prefix=${encodeURIComponent(prefix)}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetchImpl(url, { headers });
    if (!res || !res.ok) throw new Error(`KV key list failed: ${res ? res.status : 'no response'}`);
    const json = await res.json();
    for (const k of json?.result ?? []) if (k?.name) out.push(k.name);
    cursor = json?.result_info?.cursor || '';
    if (!cursor) break;
  }
  return out;
}

async function getRaw({ env, fetchImpl, key }) {
  const res = await fetchImpl(`${cfBase(env)}/values/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
  if (res && res.ok) return res.text ? await res.text() : null;
  // A 404 means the key is genuinely absent (e.g. it raced away between the list and this read): skip it. ANY
  // other failure (500, 429, network) THROWS so a transient error can never silently drop a record and leave a
  // backup that looks complete but is not. collectSnapshot aborts before anything is stored.
  if (res && res.status === 404) return null;
  const detail = res && res.text ? await res.text().catch(() => '') : '';
  throw new Error(`KV get failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
}

async function putRaw({ env, fetchImpl, key, value, ttlSeconds }) {
  const ttl = ttlSeconds ? `?expiration_ttl=${ttlSeconds}` : '';
  const res = await fetchImpl(`${cfBase(env)}/values/${encodeURIComponent(key)}${ttl}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`KV put failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
}

/** Pure: shape the snapshot blob. */
export function buildSnapshot(records, now = new Date()) {
  return { v: 1, takenAt: now.toISOString(), count: records.length, records };
}

/** Collect the KV-only member data into a snapshot. Reported no-op (available:false) without CF creds. */
export async function collectSnapshot({ env = process.env, fetchImpl = globalThis.fetch, now = new Date(), prefixes = BACKED_UP_PREFIXES } = {}) {
  if (!cfCreds(env)) return { available: false, reason: NO_CREDS };
  const records = [];
  for (const prefix of prefixes) {
    for (const key of await listKeys({ env, fetchImpl, prefix })) {
      const value = await getRaw({ env, fetchImpl, key });
      if (value != null) records.push({ key, value });
    }
  }
  return { available: true, snapshot: buildSnapshot(records, now) };
}

/** Encrypt a snapshot into an envelope bound to its snapshot id (the AAD). */
export async function encryptSnapshot({ snapshot, key, snapshotId }) {
  if (!key) throw new Error('KV_BACKUP_KEY is required to encrypt a backup');
  return encryptAsset({ plaintext: JSON.stringify(snapshot), key, assetId: snapshotId, kid: 'backup' });
}

/** Decrypt + parse an envelope back into a snapshot. Throws AssetAccessError on a wrong key / tamper. */
export async function decryptSnapshot({ envelope, key }) {
  return JSON.parse(await decryptAssetText({ envelope, key }));
}

/**
 * Take + store ONE encrypted, retention-bounded snapshot. Reported no-op without CF creds or KV_BACKUP_KEY.
 * Returns { stored, key, count, ttlSeconds } or { stored:false, reason }.
 */
export async function takeBackup({
  env = process.env, fetchImpl = globalThis.fetch, now = new Date(),
  retentionSeconds = DEFAULT_RETENTION_SECONDS, key = env.KV_BACKUP_KEY,
} = {}) {
  const collected = await collectSnapshot({ env, fetchImpl, now });
  if (!collected.available) return { stored: false, reason: collected.reason };
  if (!key) return { stored: false, reason: 'KV_BACKUP_KEY not set' };
  // A backup MUST be retention-bounded: a 0/negative/non-finite retention would store a permanent snapshot
  // (re-introducing the erasure problem), so clamp to the default rather than ever storing an unbounded backup.
  const ttlSeconds = Number.isFinite(retentionSeconds) && retentionSeconds > 0 ? Math.floor(retentionSeconds) : DEFAULT_RETENTION_SECONDS;
  const snapshot = collected.snapshot;
  const snapshotId = SNAPSHOT_KEY(snapshot.takenAt);
  const envelope = await encryptSnapshot({ snapshot, key, snapshotId });
  await putRaw({ env, fetchImpl, key: snapshotId, value: JSON.stringify(envelope), ttlSeconds });
  // SOW-084: return the encrypted envelope so the caller can ALSO write it OFF-namespace (a CI artifact), surviving a
  // whole-namespace loss (the in-KV backup:<iso> only survives key-level deletion). Still encrypted; safe to export.
  return { stored: true, key: snapshotId, count: snapshot.count, ttlSeconds, envelope };
}

/**
 * SOW-084: verify the LATEST stored backup is RESTORABLE (it decrypts + parses), so a silently-broken backup (wrong
 * key, tamper, corruption) is caught BEFORE it is needed. Returns { ok, snapshotKey, count, takenAt } or { ok:false,
 * reason }. Reported no-op without creds/key.
 */
export async function verifyLatestBackup({ env = process.env, fetchImpl = globalThis.fetch, key = env.KV_BACKUP_KEY } = {}) {
  const listed = await listSnapshots({ env, fetchImpl });
  if (!listed.available) return { ok: false, reason: listed.reason };
  if (!listed.keys.length) return { ok: false, reason: 'no snapshots stored' };
  const latest = listed.keys[listed.keys.length - 1]; // ISO-suffix sort -> last is newest
  let read;
  // A wrong key / tampered envelope makes decryptSnapshot THROW; catch it so a broken backup is REPORTED (ok:false),
  // never an unhandled rejection that hides the alarm.
  try { read = await readSnapshot({ env, fetchImpl, snapshotKey: latest, key }); }
  catch (err) { return { ok: false, reason: err?.message || 'snapshot did not decrypt (wrong key or tampered)', snapshotKey: latest }; }
  if (!read.available) return { ok: false, reason: read.reason, snapshotKey: latest };
  return { ok: true, snapshotKey: latest, count: read.snapshot.count, takenAt: read.snapshot.takenAt };
}

/** List the stored snapshot keys (`backup:*`), newest discoverable via the ISO suffix sort. */
export async function listSnapshots({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!cfCreds(env)) return { available: false, reason: NO_CREDS };
  const keys = await listKeys({ env, fetchImpl, prefix: BACKUP_PREFIX });
  return { available: true, keys: keys.sort() };
}

/** Read + decrypt one stored snapshot (for inspection or restore). */
export async function readSnapshot({ env = process.env, fetchImpl = globalThis.fetch, snapshotKey, key = env.KV_BACKUP_KEY } = {}) {
  if (!cfCreds(env)) return { available: false, reason: NO_CREDS };
  if (!key) return { available: false, reason: 'KV_BACKUP_KEY not set' };
  const raw = await getRaw({ env, fetchImpl, key: snapshotKey });
  if (raw == null) return { available: false, reason: `snapshot ${snapshotKey} not found` };
  let envelope;
  try { envelope = JSON.parse(raw); } catch { return { available: false, reason: 'snapshot is not valid JSON' }; }
  return { available: true, snapshot: await decryptSnapshot({ envelope, key }) };
}

/**
 * Restore the member keys from a decrypted snapshot back into KV. Additive (never deletes keys not in the
 * snapshot). CAVEAT (enforce via the SOP): a restore can re-introduce data for a member erased AFTER the
 * snapshot was taken; re-run erasure for anyone erased since.
 */
export async function restoreSnapshot({ env = process.env, fetchImpl = globalThis.fetch, snapshot } = {}) {
  if (!cfCreds(env)) return { restored: 0, reason: NO_CREDS };
  let restored = 0;
  for (const r of snapshot?.records ?? []) {
    if (!r?.key || r.value == null) continue;
    await putRaw({ env, fetchImpl, key: r.key, value: r.value }); // restore is permanent (no TTL), like the original
    restored++;
  }
  return { restored };
}
