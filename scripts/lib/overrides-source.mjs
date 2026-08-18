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
 * Resolve the gate's ACTUAL override maps: derive the mode, read KV when the mode calls for it, and hand back
 * the overrides object the gate will decide on. Throws on every unhealthy path, and `pr-gate.mjs` reports a
 * thrown error as a FAILING `membership-gate` status, so a throw here is a DENY.
 *
 * EXTRACTED SO THE ACCEPTANCE CRITERIA CAN BE TESTED AS STATED. The SOW's criterion is "a banned author is
 * DENIED BY THE GATE when the ban exists only in KV". While this logic sat inline in `run()` the only thing a
 * test could reach was `readOverridesFromKv`, so the test asserted that a ban map came back populated and its
 * name said the author "WOULD deny". That is a proxy: it proves the module, not the gate, and it steps over
 * the mode derivation and the assignment that sit between them. Same failure class as the double-wrap bug
 * above, one level up. With this exported, the test drives mode -> read -> assignment -> evaluatePR and
 * asserts the decision itself.
 *
 * `readKv` and `log` are injected for that test; production passes neither.
 *
 * MUTATES `overrides` in place (as the inline version did) and also returns it, so the caller reads either way.
 */
export async function applyOverridesSource({ overrides, repoRoot, env = process.env, readKv = readOverridesFromKv, log = console.log }) {
  const mode = resolveOverridesMode({
    gitPresent: overrideFilesPresent(repoRoot),
    credsPresent: kvCredsPresent(env),
  });

  if (mode === 'git') {
    // Pre-provisioning: the files are still in git and there are no KV creds. Current behaviour, unchanged.
    log('pr-gate: overrides source = git (KV credentials not set; nothing has moved yet).');
    return { mode, overrides };
  }

  const kv = await readKv({ env });
  if (!kv.available) {
    throw new Error(`overrides unavailable from KV (${kv.reason}); refusing to gate on an unknown ban list [mode=${mode}]`);
  }

  if (mode === 'kv') {
    overrides.bans = kv.bans;
    overrides.grandfathers = kv.grandfathers;
    log(`pr-gate: overrides source = KV (mirror ${kv.generatedAt}); the git files are gone, as intended.`);
    return { mode, overrides, generatedAt: kv.generatedAt };
  }

  // Both sources present. The FIRST version of this branch threw on ANY divergence, on the reasoning that one
  // of the two sources must be lying and the gate does not get to guess which. That reasoning was wrong, and
  // it shipped a repository-wide outage on a daily timer. Both halves are worth stating, because the
  // correction is not "relax the check", it is "the check was measuring the wrong thing".
  //
  // WHY IT WAS AN OUTAGE. `scripts/reconcile.mjs` writes the KV mirror (line ~697) and THEN merges the coupon
  // fold PR into house/grandfathered.yml (line ~752). Its own comment records that the run cannot see its own
  // merge, so the mirror is written from the pre-merge checkout BY DESIGN. The moment that PR lands, git
  // carries a grant KV does not, every gate run throws, and `pr-gate.mjs` publishes `membership-gate` as a
  // FAILING required check for EVERY open PR until the next 6-hourly sync. Measured on 2026-08-18: reconcile
  // ran 07:55Z, the next sync ran 13:10Z. A five-hour blackout, repeating daily, triggered by a coupon
  // redemption. The same shape appears in reverse whenever an unban, an ungrandfather or an erase-member
  // removes an entry from git and the mirror still carries it.
  //
  // WHY THE CHECK WAS MEASURING THE WRONG THING. In this mode `overrides` was loaded from GIT and git is what
  // the gate decides on: the branch below never reassigned the maps. So walk the four divergence cases and
  // ask what denying the whole repository actually bought:
  //   ban in git only          -> already enforced, the git map has it. Denying everyone adds NOTHING.
  //   grandfather in git only  -> already granted from git. Denying everyone adds NOTHING.
  //   grandfather in KV only   -> NOT granted, the gate reads git. Denying everyone adds NOTHING.
  //   ban in KV only           -> NOT enforced. This is the only case with any security content at all.
  // Three of the four were pure self-inflicted downtime. The fourth deserves a better answer than an outage.
  //
  // THE BETTER ANSWER, AND THERE IS NO GUESSWORK IN IT. A ban is RESTRICTIVE, so the union is the fail-closed
  // direction: banned in EITHER source means banned. That answers the original objection rather than dodging
  // it, because we no longer have to decide which source is stale. Both readings ("git has not caught up" and
  // "KV has not caught up") agree that the person is banned, so adopting the KV-only ban is correct under
  // both. It also denies exactly the right person instead of everybody, and it is what makes a Phase 2
  // KV-native ban actually BITE before Phase 3 removes the files, which the throw never did.
  //
  // A GRANDFATHER GRANT IS NOT UNIONED, AND THAT ASYMMETRY IS THE WHOLE POINT. It is PERMISSIVE: honouring a
  // KV-only grant would hand paid status to anyone able to write that blob, which is fail-OPEN. While git is
  // present it stays the attesting source for permissive records. Restrictive records union, permissive
  // records do not. Phase 3 removes the git files and the 'kv' branch above takes over, at which point the
  // mirror is the only record and its integrity is carried by the credential scoping instead.
  const differences = diffOverrides(overrides, kv);
  const adopted = adoptKvBans(overrides, kv);

  // Loud, because converting a hard failure into a warning is exactly how a real signal goes unnoticed, and
  // this SOW's entire thesis is that quiet failures are the defect. These lines are the compensating control.
  for (const d of differences) {
    if (d.field === 'bans' && !d.git) {
      log(`pr-gate: WARNING: ${d.id} is banned in KV but not in git. ADOPTED (a ban in either source bans).`);
    } else if (d.field === 'bans') {
      log(`pr-gate: WARNING: ${d.id} is banned in git but not in the KV mirror. The git ban is enforced; the mirror is behind.`);
    } else {
      log(`pr-gate: WARNING: grandfather grant for ${d.id} differs (git=${d.git} kv=${d.kv}). Git is authoritative here; a KV-only grant is NOT honoured while the git files exist.`);
    }
  }
  const summary = differences.length
    ? `${differences.length} divergence(s), ${adopted.length} KV-only ban(s) adopted`
    : `${overrides.bans.size} ban(s) agree`;
  log(`pr-gate: overrides source = git, cross-checked against KV (mirror ${kv.generatedAt}), ${summary}.`);
  return { mode, overrides, generatedAt: kv.generatedAt, differences, adopted };
}

/**
 * Union KV-only bans into the map the gate decides on, and report which ids were adopted. MUTATES `overrides`
 * in place, like the rest of this resolution.
 *
 * Bans only. See the asymmetry argument above: restrictive records are safe to union because both readings of
 * a divergence agree on the restrictive outcome, and permissive records are not, because unioning them would
 * let whoever can write the mirror grant themselves paid status.
 */
export function adoptKvBans(overrides, kv) {
  const adopted = [];
  for (const [id, entry] of kv?.bans ?? []) {
    if (!overrides.bans.has(id)) {
      overrides.bans.set(id, entry);
      adopted.push(id);
    }
  }
  return adopted;
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
