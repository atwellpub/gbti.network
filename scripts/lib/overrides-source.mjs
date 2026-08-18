// sow-213 Phase 1: where the PR gate reads bans and grandfather grants from.
//
// THE PROBLEM THIS SOLVES. `house/bans.yml` and `house/grandfathered.yml` are person-keyed records of real
// people in a PUBLIC, forkable, CDN-cached repository, so they are on the wrong side of the storage boundary
// (content in git, user data in KV) and no right-to-erasure request can ever be satisfied for them. Moving
// them is the fix. But `scripts/pr-gate.mjs` reads them off the git checkout and has no KV access, so moving
// them naively breaks the gate IN THE FAIL-OPEN DIRECTION: a banned author would pass the ban check.
//
// THE FAIL-OPEN IS NOT CREATED BY THE MIGRATION, IT IS EXPOSED BY IT. `membership/overrides.mjs` readYaml
// returns {} for a missing file, so an absent source yields an EMPTY bans map, and an empty bans map is
// indistinguishable from "nobody is banned". Today the file is always present in a checkout, so the path is
// unreachable. The moment the source becomes a network call, "unavailable" becomes a real runtime state and
// that latent fail-open becomes reachable. Everything below exists to make that state DENY instead.
//
// THE MODE IS DERIVED FROM REALITY, NOT FROM CONFIGURATION. An env flag defaulting to the permissive mode is
// a fail-open waiting for someone to forget to flip it, and the whole point of this SOW is to stop shipping
// those. Instead: if the git files are GONE, KV is mandatory and an unhealthy mirror denies. That flips
// itself at exactly the right instant, because the thing that makes KV mandatory is the same act that removes
// the fallback. There is nothing to remember.
import fs from 'node:fs';
import path from 'node:path';
import { bansFromParsed, grandfathersFromParsed } from '../../membership/overrides-core.mjs';

export const OVERRIDES_KV_KEY = 'overrides:mirror';
// The same 48h bound the Worker applies (workers/signup/membership-content.mjs). Kept as a local constant
// rather than imported, because this runs in Actions and that module is Worker-side.
export const MAX_OVERRIDES_AGE_MS = 48 * 60 * 60 * 1000;

/** Do the git-native override files still exist? This is what decides whether KV is mandatory. */
export function overrideFilesPresent(root) {
  const house = path.join(root, 'house');
  return fs.existsSync(path.join(house, 'bans.yml')) || fs.existsSync(path.join(house, 'grandfathered.yml'));
}

/**
 * Resolve which source the gate must trust. PURE and testable; the whole migration is visible here.
 *   'git'  - Phase 1 before provisioning: the files are in git and there are no KV creds. Current behaviour.
 *   'both' - Phase 1 after provisioning: read both and require agreement. The safety net for Phase 2.
 *   'kv'   - Phase 2/3: the files are gone from git. KV is the only source and there is NO fallback path.
 */
export function resolveOverridesMode({ gitPresent, credsPresent }) {
  if (!gitPresent) return 'kv'; // the files are gone; a fallback here would BE the fail-open
  return credsPresent ? 'both' : 'git';
}

/** Are the Cloudflare KV REST credentials present? Same trio scripts/lib/coupon-grants.mjs already uses. */
export function kvCredsPresent(env = process.env) {
  return Boolean(env.CF_ACCOUNT_ID && env.CF_KV_NAMESPACE_ID && env.CF_API_TOKEN);
}

/**
 * Read the overrides mirror blob from KV over the Cloudflare REST API. Mirrors the read in
 * scripts/lib/coupon-grants.mjs rather than inventing a second client.
 *
 * FAILS CLOSED BY CONSTRUCTION: every failure path returns { available: false, reason }, and there is no
 * path that returns available:true with an empty or partial blob. A caller cannot mistake "we could not
 * read the bans" for "there are no bans", which is the exact confusion that makes this class of bug.
 */
export async function readOverridesFromKv({ env = process.env, fetchImpl = globalThis.fetch, now = new Date() } = {}) {
  if (!kvCredsPresent(env)) {
    return { available: false, reason: 'CF credentials not set (CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN)' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/storage/kv/namespaces/${env.CF_KV_NAMESPACE_ID}/values/${encodeURIComponent(OVERRIDES_KV_KEY)}`;
  let raw;
  try {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
    if (!res?.ok) return { available: false, reason: `KV read failed (${res?.status})` };
    raw = await res.json();
  } catch (err) {
    return { available: false, reason: `KV read threw (${err?.message || 'unknown'})` };
  }
  if (!raw || typeof raw !== 'object') return { available: false, reason: 'mirror is not an object' };

  // The freshness gate. A mirror that stopped being written is the dangerous case: it looks like a healthy
  // read and is silently months out of date, so an unbanned-since ban or a lapsed grant would be honoured.
  const generatedAt = raw.generatedAt;
  if (!generatedAt) return { available: false, reason: 'mirror has no generatedAt' };
  const ageMs = now.getTime() - new Date(generatedAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > MAX_OVERRIDES_AGE_MS) {
    return { available: false, reason: `mirror is stale or misdated (age ${Number.isFinite(ageMs) ? Math.round(ageMs / 3600000) + 'h' : 'unknown'})` };
  }
  // sow-213 FIX: the mirror's `bans` / `grandfathered` fields are the PARSED YAML FILE OBJECTS
  // ({ bans: [...] }), NOT bare arrays. `bansFromParsed` takes that object directly, which is exactly what the
  // Worker does (`bansFromParsed(mirror.bans)`).
  //
  // The first version of this function wrapped them a SECOND time, which would have thrown on the first real
  // blob and taken the gate down the moment CF credentials were added. It shipped because ITS OWN TESTS BUILT
  // THE FIXTURE FROM THE SAME WRONG ASSUMPTION AS THE CODE, so the two agreed and the agreement proved
  // nothing. That is the failure class this repo keeps meeting: evidence that does not bear on the claim.
  //
  // The shape guard is copied from the Worker (membership-content.mjs `isSection`) for the same reason the 48h
  // bound is: the gate and the Worker disagreeing about who is banned is its own bug class. A BARE ARRAY here
  // is precisely what the broken version produced, and it must read as UNAVAILABLE (deny), never as "no bans".
  const isSection = (x) => x != null && typeof x === 'object' && !Array.isArray(x);
  if (!isSection(raw.bans) || !isSection(raw.grandfathered)) {
    return { available: false, reason: 'mirror sections are malformed (bans/grandfathered must be objects)' };
  }
  return {
    available: true,
    generatedAt,
    raw,
    bans: bansFromParsed(raw.bans),
    grandfathers: grandfathersFromParsed(raw.grandfathered),
  };
}

/**
 * Compare the git-loaded Maps against the KV-loaded Maps. PURE. Returns the list of disagreeing github_ids,
 * empty when they agree. Membership only, deliberately: a differing NOTE or reason is not a gating fact, and
 * failing the gate on prose churn would train people to ignore it.
 */
export function diffOverrides(git, kv) {
  const differences = [];
  for (const [field, a, b] of [['bans', git.bans, kv.bans], ['grandfathered', git.grandfathers, kv.grandfathers]]) {
    const ids = new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])]);
    for (const id of ids) {
      const inGit = a?.has(id) ?? false;
      const inKv = b?.has(id) ?? false;
      if (inGit !== inKv) differences.push({ field, id, git: inGit, kv: inKv });
    }
  }
  return differences;
}
