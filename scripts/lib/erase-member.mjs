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
import { scrubOpener } from '../../membership/news-opens.mjs'; // SOW-111: per-item news detail-open sets
import { scrubOpener as scrubContentOpener } from '../../membership/content-opens.mjs'; // SOW-126: per-item content-open sets
import { scrubCounterpart } from '../../workers/signup/conversion-snapshot-store.mjs'; // SOW-059 P1c

export const ACTIVITY_KEY = (githubId) => `activity:${githubId}`;
export const FOLLOWS_KEY = (githubId) => `follows:${githubId}`; // SOW-023 subscription graph
export const DRAFTS_KEY = (githubId) => `drafts:${githubId}`; // SOW-157 hosted draft staging
export const PREFS_KEY = (githubId) => `prefs:${githubId}`; // SOW-046 member prefs (categories + followed news channels)
export const LOOKUP_KEY = (githubId) => `gh:${githubId}`; // the github_id -> Stripe customer_id lookup cache
export const CONV_SNAPSHOT_KEY = (githubId) => `conv:${githubId}`; // SOW-059 P1c: the frozen conversion attribution snapshot
export const MEMBERS_INDEX_PATH = 'house/members-index.yml';
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
export function planErasure({ githubId, username } = {}) {
  const who = username ? `members/${username}/` : "the member's";
  return [
    { step: 'content', auto: true, tool: 'erase-member.mjs --apply', action: `Flip ${who} content status -> draft via an auto-merged PR (reversible; history persists).` },
    { step: 'activity', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the edge-store keys ${ACTIVITY_KEY(githubId)} (favorites + collections) and ${FOLLOWS_KEY(githubId)} (the follow graph).` },
    { step: 'lookup-cache', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the lookup-cache key ${LOOKUP_KEY(githubId)} (github_id -> Stripe customer_id).` },
    { step: 'share-votes', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every per-target share-vote set (upvotes:share:*); syndication queue items auto-expire via TTL.` },
    { step: 'news-opens', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every per-item news detail-open set (news-opens:*, SOW-111).` },
    { step: 'conv-snapshot', auto: true, tool: 'erase-member.mjs --apply', action: `Hard-delete the member's frozen conversion snapshot ${CONV_SNAPSHOT_KEY(githubId)} (SOW-059).` },
    { step: 'conv-counterpart', auto: true, tool: 'erase-member.mjs --apply', action: `Scrub github_id ${githubId} from every OTHER member's frozen snapshot (conv:*) where they are a first/last-touch owner, inviter, or collaborator.` },
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
  if (typeof res?.flipped === 'number') return { step, outcome: 'drafted', detail: `pr#${res.pr} flipped:${res.flipped} index:${res.indexRemoved ? 'removed' : 'kept'}` };
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
 * ONE auto-merged PR that flips every published file in the member's folder to draft AND removes their
 * members-index entry. Reversible (a re-subscribe / un-erase can re-publish); git history persists, which is
 * disclosed in the TOS. Reported no-op without a GitHub client, a username, or any net change. `files` is the
 * member's content descriptors ([{ path, status }]) from buildRepoIndex; reading happens in the caller so this
 * is testable with a fake github client.
 */
export async function eraseContent({ github = null, githubId, username, files = [], base = 'main', now = new Date() } = {}) {
  if (!github) return { skipped: true, reason: 'no GitHub client (set GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO)' };
  if (!username) return { skipped: true, reason: 'no member folder resolved (provide --username or a members-index entry)' };

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
  if (toFlip.length === 0 && !wantIndexRemoval) return { skipped: true, reason: 'no published content or members-index entry to change' };

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

  if (flipped === 0 && !indexRemoved) {
    // The decided changes were applied concurrently between phase 1 and phase 2 (practically never for an
    // erasure target). Skip rather than open a diff-less PR (GitHub rejects those); the empty branch is inert.
    return { skipped: true, reason: 'content already drafted / index already removed concurrently' };
  }

  const pull = await github.createPull({
    title: `erase: draft ${username} content + remove index entry`,
    head: branch,
    base,
    body:
      `Automated SOW-024 right-to-erasure for github_id ${id}: flips ${flipped} file(s) -> draft` +
      `${indexRemoved ? ' and removes the members-index entry' : ''}. Reversible; git history persists ` +
      '(disclosed in the TOS).',
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { pr: pull.number, flipped, indexRemoved };
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
  await runStep('follows', () => eraseFollows({ githubId, env, fetchImpl }));
  await runStep('prefs', () => erasePrefs({ githubId, env, fetchImpl })); // SOW-046: categories + followed news channels
  await runStep('drafts', () => eraseDrafts({ githubId, env, fetchImpl })); // SOW-157: hosted draft staging
  await runStep('lookup-cache', () => eraseLookupCache({ githubId, env, fetchImpl }));
  await runStep('share-votes', () => eraseShareVotes({ githubId, env, fetchImpl })); // SOW-057: per-target voter sets
  await runStep('news-opens', () => eraseNewsOpens({ githubId, env, fetchImpl })); // SOW-111: per-item opener sets
  await runStep('content-opens', () => eraseContentOpens({ githubId, env, fetchImpl })); // SOW-126: per-item content-open sets
  await runStep('conv-snapshot', () => eraseConversionSnapshot({ githubId, env, fetchImpl })); // SOW-059: own frozen snapshot
  await runStep('conv-counterpart', () => scrubConversionSnapshots({ githubId, env, fetchImpl })); // SOW-059: scrub as counterpart
  await runStep('discord', () => eraseDiscordRoles({ githubId, stripe, discord, env }));
  await runStep('content', () => eraseContent({ github, githubId, username, files, now }));
  if (deleteStripe) await runStep('stripe', () => eraseStripeCustomer({ githubId, stripe }));

  const record = buildAuditRecord({ githubId, operator, apply: true, steps, now });
  let audit;
  try { audit = await storeAuditRecord({ record, env, fetchImpl }); }
  catch (e) { audit = { recorded: false, reason: `audit write failed: ${e?.message || e}` }; }
  return { apply: true, steps, audit, record };
}
