// sow-213 Phase 1: the PR gate's overrides source. These are the SOW's two non-negotiable acceptance criteria
// plus the pure units underneath them.
//
// WHY ACCEPTANCE TEST 2 IS THE LOAD-BEARING ONE. The migration does not CREATE a fail-open, it EXPOSES one.
// `membership/overrides.mjs` readYaml returns {} for a missing file, so an absent source yields an EMPTY bans
// map, and an empty bans map is indistinguishable from "nobody is banned". Today the file is always present in
// a git checkout, so the path is unreachable. The moment the source becomes a network call, "unavailable"
// becomes a real runtime state and that latent fail-open becomes reachable. So the test that matters is not
// "does KV work", it is "does an UNREADABLE source deny".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadOverrides, effectiveStatus } from '../membership/overrides.mjs';
import {
  overrideFilesPresent,
  resolveOverridesMode,
  kvCredsPresent,
  readOverridesFromKv,
  applyOverridesSource,
  adoptKvBans,
  diffOverrides,
  MAX_OVERRIDES_AGE_MS,
} from '../scripts/lib/overrides-source.mjs';
import { evaluatePR } from '../scripts/pr-gate.mjs';
import { buildPriceTierMap } from '../membership/tiers.mjs';
import { bansFromParsed, grandfathersFromParsed } from '../membership/overrides-core.mjs';

const CREDS = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const NOW = new Date('2026-08-16T12:00:00Z');
// The mirror's sections are the PARSED YAML FILE OBJECTS ({ bans: [...] }), NOT bare arrays: the Worker
// passes each straight to bansFromParsed and rejects a non-object (membership-content.mjs isSection).
// THESE FIXTURES USED BARE ARRAYS AND THAT IS WHY THE ORIGINAL DOUBLE-WRAP BUG SHIPPED: the fixture was
// built from the same wrong assumption as the code, so the two agreed and the agreement proved nothing.
// Built from the real blob shape now, taken from the Worker rather than from memory.
const fresh = (over = {}) => ({ generatedAt: '2026-08-16T06:00:00Z', roles: {}, bans: { bans: [] }, grandfathered: { grandfathered: [] }, ...over });
const okFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });

// --- ACCEPTANCE 1: a ban that exists ONLY in KV must be honoured. -------------------------------------------

test('sow-213 ACCEPTANCE 1: a ban present only in KV is loaded and would deny the author', async () => {
  const kv = await readOverridesFromKv({
    env: CREDS,
    now: NOW,
    fetchImpl: okFetch(fresh({ bans: { bans: [{ github_id: '424242', reason: 'spam' }] } })),
  });
  assert.equal(kv.available, true);
  assert.equal(kv.bans.has('424242'), true, 'the KV-only ban is visible to the gate');
  // And it is the SAME shape effectiveStatus already consumes, so no call site has to change.
  assert.deepEqual([...kv.bans.keys()], [...bansFromParsed({ bans: [{ github_id: '424242' }] }).keys()]);
});

// ACCEPTANCE 1, AS THE SOW ACTUALLY STATES IT: not "the ban map is populated" but "THE GATE DENIES".
//
// The test above proves `readOverridesFromKv` returns a populated map, and its own name says the author
// "would deny". WOULD is a proxy, and a proxy is the failure class this SOW keeps meeting. Between that map
// and a denial sit three things it never touches: the mode deriving to 'kv' from the ABSENCE of the git
// files, the assignment of the KV maps onto the overrides object, and effectiveStatus ranking the ban above
// Stripe. These two tests drive all of them and assert the gate's own decision.
//
// THE FIXTURE IS BUILT SO THE BAN IS THE ONLY VARIABLE. The author is an active paid CREATOR publishing to
// their own folder, which is the one combination that fully passes and auto-merges. The first attempt gave
// them no tier, and the "control" then failed for a sow-185 tier reason instead of the ban, which would have
// been a red proving nothing: exactly the trap these tests exist to close.
const BANNED_ID = '424242';
const BANNED_LOGIN = 'banneduser';
const CREATOR_PRICE = 'price_creator';
const bannedMirror = fresh({ bans: { bans: [{ github_id: BANNED_ID, reason: 'spam', at: '2026-08-01T00:00:00Z' }] } });
const PRICE_TIER_MAP = buildPriceTierMap({ legacyCreatorPriceId: CREATOR_PRICE });
const paidCreatorStripe = {
  async findCustomerByGithubId() {
    return { subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: CREATOR_PRICE } }] } }] } };
  },
};
const gateOverrides = () => ({
  roles: new Map(),
  bans: new Map(),
  grandfathers: new Map(),
  membersIndex: new Map([[BANNED_ID, BANNED_LOGIN]]),
});
const ownFolderPost = [`members/${BANNED_LOGIN}/posts/hello/index.md`];
const gateDecision = (overrides) =>
  evaluatePR({ author: BANNED_ID, paths: ownFolderPost, overrides, stripe: paidCreatorStripe, now: NOW, priceTierMap: PRICE_TIER_MAP });

/** A repo root with NO house/ override files: the post-migration world Phase 3 creates. */
function rootWithoutOverrideFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sow213-gate-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  return dir;
}

test('sow-213 ACCEPTANCE 1 (GATE): a ban that exists ONLY in KV makes the gate DENY a paid creator', async () => {
  const overrides = gateOverrides();

  const { mode } = await applyOverridesSource({
    overrides,
    repoRoot: rootWithoutOverrideFiles(),
    env: CREDS,
    readKv: async () => await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(bannedMirror) }),
    log: () => {},
  });

  // Asserted rather than assumed: if this ever resolved to 'both' or 'git' the rest of the test would be
  // checking a different world than the one Phase 3 creates.
  assert.equal(mode, 'kv', 'with the git files absent the gate must be in KV-only mode, with no fallback');

  const d = await gateDecision(overrides);
  assert.equal(d.status, 'banned', 'the KV-only ban must outrank the active Stripe subscription');
  assert.equal(d.check, 'fail', 'THE ACCEPTANCE CRITERION: the gate DENIES, it does not merely notice');
  assert.equal(d.label, 'banned', 'and it denies BECAUSE of the ban, not for some unrelated reason');
  assert.equal(d.autoMerge, false);
});

// THE PRE-CHANGE CONTROL, so acceptance 1 is shown to FAIL without the KV read rather than merely to pass
// with it. This is the old gate exactly: overrides come from the git checkout, the KV read never happens, and
// once the files are gone `readYaml` returns {} so the bans map is EMPTY. An empty bans map is
// indistinguishable from "nobody is banned", which is the entire defect class this SOW exists to close.
test('sow-213 ACCEPTANCE 1 (GATE), pre-change control: with no KV read the banned author is ADMITTED and AUTO-MERGED', async () => {
  const d = await gateDecision(gateOverrides()); // empty bans: what loadOverrides yields once the file is gone

  assert.notEqual(d.status, 'banned', 'the pre-change gate cannot see a KV-only ban');
  assert.equal(d.check, 'pass', 'THE FAIL-OPEN: a banned author passes the gate');
  assert.equal(d.autoMerge, true, 'and their PR auto-merges. This is what acceptance 1 exists to stop.');
});

// --- ACCEPTANCE 2: an unreadable, stale, or malformed source must DENY. -------------------------------------

test('sow-213 ACCEPTANCE 2: every unhealthy source is UNAVAILABLE, never an empty ban list', async () => {
  // The distinction this whole SOW turns on: "we could not read the bans" must never arrive at the caller
  // looking like "there are no bans". None of these may return available:true.
  const cases = [
    ['no creds', { env: {}, fetchImpl: okFetch(fresh()) }],
    ['HTTP error', { env: CREDS, fetchImpl: async () => ({ ok: false, status: 500 }) }],
    ['fetch throws', { env: CREDS, fetchImpl: async () => { throw new Error('network down'); } }],
    ['not an object', { env: CREDS, fetchImpl: okFetch('a string') }],
    ['null body', { env: CREDS, fetchImpl: okFetch(null) }],
    ['no generatedAt', { env: CREDS, fetchImpl: okFetch({ bans: { bans: [] }, grandfathered: { grandfathered: [] } }) }],
    // The shape guard. A BARE ARRAY section is exactly what the original double-wrap bug produced, and a
    // malformed section must read as UNAVAILABLE (deny), never fall through to an empty ban list.
    ['bans is a bare array', { env: CREDS, fetchImpl: okFetch(fresh({ bans: [] })) }],
    ['grandfathered is a bare array', { env: CREDS, fetchImpl: okFetch(fresh({ grandfathered: [] })) }],
    ['a section is missing entirely', { env: CREDS, fetchImpl: okFetch({ generatedAt: '2026-08-16T06:00:00Z', grandfathered: { grandfathered: [] } }) }],
    ['unparseable date', { env: CREDS, fetchImpl: okFetch(fresh({ generatedAt: 'not-a-date' })) }],
    ['stale beyond 48h', { env: CREDS, fetchImpl: okFetch(fresh({ generatedAt: '2026-08-01T00:00:00Z' })) }],
    ['dated in the future', { env: CREDS, fetchImpl: okFetch(fresh({ generatedAt: '2027-01-01T00:00:00Z' })) }],
  ];
  for (const [label, opts] of cases) {
    const r = await readOverridesFromKv({ now: NOW, ...opts });
    assert.equal(r.available, false, `${label} must be UNAVAILABLE`);
    assert.ok(r.reason, `${label} must say why`);
    assert.equal(r.bans, undefined, `${label} must not hand back a ban map at all`);
  }
});

// ACCEPTANCE 2 AT THE GATE. The test above proves the READ reports unavailable. It does not prove the GATE
// refuses, and the gap is not theoretical: a mutation that turns the gate's `throw` into an early return
// leaves every module-level test above passing, green, while a banned author sails through. Found by mutating
// the code rather than by reading it, which is the only way this kind of hole shows itself.
//
// A THROW HERE IS A DENY. `pr-gate.mjs` wraps this call in the try whose catch publishes `membership-gate` as
// `failure`, so the PR cannot merge. That is why every unhealthy path throws instead of returning a flag: a
// returned flag is something a caller can forget to check, and forgetting would fail OPEN.
test('sow-213 ACCEPTANCE 2 (GATE): every unhealthy source makes the gate THROW, which is how it denies', async () => {
  const unhealthy = [
    ['unreachable', { available: false, reason: 'KV read threw (network down)' }],
    ['HTTP error', { available: false, reason: 'KV read failed (500)' }],
    ['stale', { available: false, reason: 'mirror is stale or misdated (age 400h)' }],
    ['malformed', { available: false, reason: 'mirror sections are malformed (bans/grandfathered must be objects)' }],
  ];
  for (const [label, kvResult] of unhealthy) {
    // Both post-migration modes must deny: 'kv' (the files are gone) and 'both' (the Phase 1 cross-check).
    for (const repoRoot of [rootWithoutOverrideFiles(), process.cwd()]) {
      await assert.rejects(
        () => applyOverridesSource({ overrides: gateOverrides(), repoRoot, env: CREDS, readKv: async () => kvResult, log: () => {} }),
        /overrides unavailable from KV/,
        `${label} must DENY, not fall through to an empty ban list`,
      );
    }
  }
});

// --- 'BOTH' MODE: DIVERGENCE. These four replace a single test that asserted the WRONG behaviour. ----------
//
// That test pinned "any divergence THROWS", on the reasoning that one source must be lying and the gate does
// not get to guess which. The reasoning was wrong and the throw shipped a repository-wide outage on a daily
// timer: reconcile writes the KV mirror and THEN merges the coupon fold PR into house/grandfathered.yml, so
// git routinely carries a grant the mirror does not. Measured 2026-08-18: reconcile 07:55Z, next sync 13:10Z.
//
// The replacement is not a relaxation. In this mode the gate decides on the GIT maps, so three of the four
// divergence cases were already enforced or already ignored and the throw bought nothing but downtime. The
// fourth, a ban present only in KV, was never enforced by the throw either: it denied everybody instead of
// the banned author. Unioning restrictive records denies exactly the right person, and there is no guess in
// it, because both readings of the divergence agree that a banned person is banned.
//
// EACH TEST BELOW PINS A PROPERTY THE OLD ONE DID NOT COVER AT ALL.

test("sow-213 'both' mode: a ban present ONLY in KV is ADOPTED, and the gate denies THAT AUTHOR", async () => {
  // The checkout still has the files, so repoRoot is the real one and the mode is 'both'.
  const overrides = gateOverrides();
  overrides.bans = new Map(); // git says nobody is banned; KV says one person is

  const r = await applyOverridesSource({
    overrides,
    repoRoot: process.cwd(),
    env: CREDS,
    readKv: async () => await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(bannedMirror) }),
    log: () => {},
  });

  assert.equal(r.mode, 'both', 'the git files are present and creds are set');
  assert.deepEqual(r.adopted, [BANNED_ID], 'the KV-only ban is pulled into the map the gate decides on');

  const d = await gateDecision(overrides);
  assert.equal(d.status, 'banned', 'a ban in EITHER source bans: the fail-closed direction for a restrictive record');
  assert.equal(d.check, 'fail', 'and the gate denies the BANNED AUTHOR, which the old throw never did');
  assert.equal(d.autoMerge, false);
});

test("sow-213 'both' mode, the pre-fix control: the old behaviour denied EVERYONE instead of the banned author", async () => {
  // Pinned so the change is shown to be an improvement rather than asserted to be one. Under the old code
  // this same input threw /DISAGREE/, which pr-gate publishes as a FAILING required check on every open PR.
  // The difference is not that fewer things fail; it is that the RIGHT thing fails.
  const overrides = gateOverrides();
  overrides.bans = new Map();
  const kv = await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(bannedMirror) });
  const differences = diffOverrides(overrides, kv);

  assert.deepEqual(
    differences,
    [{ field: 'bans', id: BANNED_ID, git: false, kv: true }],
    'the divergence the old code threw on is still DETECTED; it is now acted on precisely instead of loudly',
  );
});

test('sow-213: mirror lag must NOT fail the gate, and the git-side record stays enforced', async () => {
  // THE LIVE REGRESSION, as a regression test. git is ahead of the mirror, which is the steady state for
  // several hours after every reconcile. The banned author must still be denied, and nothing may throw.
  const overrides = gateOverrides();
  overrides.bans = new Map([[BANNED_ID, { github_id: BANNED_ID, reason: 'spam' }]]); // git knows
  const emptyMirror = async () => await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(fresh()) }); // KV does not

  const r = await applyOverridesSource({ overrides, repoRoot: process.cwd(), env: CREDS, readKv: emptyMirror, log: () => {} });

  assert.equal(r.mode, 'both');
  assert.deepEqual(r.adopted, [], 'nothing to adopt: git is the one that is ahead');
  assert.equal(r.differences.length, 1, 'the lag is still REPORTED, not swallowed');

  const d = await gateDecision(overrides);
  assert.equal(d.check, 'fail', 'the git ban is enforced regardless of what the mirror has caught up to');
  assert.equal(d.status, 'banned');
});

test('sow-213: a grandfather grant present only in KV is NOT honoured, because it is PERMISSIVE', async () => {
  // The asymmetry that makes the union safe. Unioning a restrictive record fails closed; unioning a
  // permissive one would hand paid status to whoever can write the mirror, which is fail OPEN. While the git
  // files exist, git is the attesting source for grants.
  const overrides = gateOverrides();
  const grantedInKvOnly = fresh({ grandfathered: { grandfathered: [{ github_id: '777', reason: 'coupon:X' }] } });

  const r = await applyOverridesSource({
    overrides,
    repoRoot: process.cwd(),
    env: CREDS,
    readKv: async () => await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(grantedInKvOnly) }),
    log: () => {},
  });

  assert.equal(r.differences.length, 1, 'the KV-only grant is reported');
  assert.equal(overrides.grandfathers.has('777'), false, 'and is NOT adopted into the map the gate decides on');
  assert.deepEqual(r.adopted, [], 'adoption is bans-only, by construction');
});

test('sow-213: the exact reconcile coupon-fold shape resolves cleanly instead of blocking the repository', async () => {
  // Reproduces the production sequence: reconcile writes the mirror from the pre-merge checkout, then merges
  // the fold PR, so the gate sees a grant in git that the mirror does not carry yet. This threw before.
  const overrides = gateOverrides();
  overrides.grandfathers = new Map([['190312419', { github_id: '190312419', reason: 'coupon:CODEABLEYEAR' }]]);

  const r = await applyOverridesSource({
    overrides,
    repoRoot: process.cwd(),
    env: CREDS,
    readKv: async () => await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(fresh()) }),
    log: () => {},
  });

  assert.equal(r.mode, 'both');
  assert.deepEqual(r.differences, [{ field: 'grandfathered', id: '190312419', git: true, kv: false }]);
  // The assertion that matters is simply that we got here: applyOverridesSource resolved, so pr-gate does not
  // enter the catch that publishes `membership-gate` as failure on every open PR.
});

test('sow-213: adoptKvBans unions bans, never grandfathers, and never overwrites a git entry', async () => {
  const overrides = { bans: new Map([['1', { github_id: '1', reason: 'from git' }]]), grandfathers: new Map() };
  const kv = {
    bans: new Map([['1', { github_id: '1', reason: 'from kv' }], ['2', { github_id: '2', reason: 'kv only' }]]),
    grandfathers: new Map([['3', { github_id: '3' }]]),
  };

  assert.deepEqual(adoptKvBans(overrides, kv), ['2'], 'only the id git did not already carry');
  assert.equal(overrides.bans.get('1').reason, 'from git', 'a git entry is never overwritten by the mirror');
  assert.equal(overrides.bans.size, 2);
  assert.equal(overrides.grandfathers.size, 0, 'grandfathers are never adopted');

  // Defensive: an unavailable read has no maps at all, and this must not throw on the way to the caller's
  // own handling of that case.
  assert.deepEqual(adoptKvBans({ bans: new Map(), grandfathers: new Map() }, {}), []);
});

// THE LAPSED-TOKEN PATH, AND IT IS A SCHEDULED EVENT RATHER THAN A HYPOTHETICAL. `CF_KV_READ_TOKEN` is
// being minted WITH A TTL on purpose (secrets-ops: where scope cannot confine a credential, time must). So
// "the gate's KV credential stopped working" is not a maybe, it is a dated certainty, and after Phase 3 it
// lands in the one configuration where getting it wrong readmits every banned author at once.
//
// The reassuring half is that the mode is derived from the FILES, not from the credentials: with the git
// files gone the mode is 'kv' whatever the env says, so absent or expired creds cannot degrade to "no bans".
// This test pins that, because the alternative reading (no creds, so fall back to git, so an empty ban map)
// is the exact fail-open this SOW exists to close and it is a plausible thing for a later change to add.
test('sow-213: AFTER Phase 3, an absent or lapsed KV credential DENIES; it cannot fall back to an empty ban list', async () => {
  for (const [label, env] of [
    ['credential never provisioned', {}],
    ['secret name mistyped, so Actions interpolates empty strings', { CF_ACCOUNT_ID: '', CF_KV_NAMESPACE_ID: '', CF_API_TOKEN: '' }],
    ['only the token missing (a lapsed TTL looks like this)', { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: '' }],
  ]) {
    await assert.rejects(
      () => applyOverridesSource({ overrides: gateOverrides(), repoRoot: rootWithoutOverrideFiles(), env, log: () => {} }),
      /overrides unavailable from KV/,
      `${label}: must DENY once the git files are gone`,
    );
  }
});

// The counterpart, and the reason the SAME missing credential is acceptable TODAY. Before Phase 3 the git
// files are present and authoritative, so no creds means mode 'git' and the gate behaves exactly as it always
// has. That is a FAIL-QUIET, which is normally the defect this repo hunts, and it is acceptable here for one
// narrow reason: in Phase 1 the KV read is a CROSS-CHECK, not the decision. Git still decides.
//
// IT STOPS BEING ACCEPTABLE THE MOMENT PHASE 2 INVERTS THE WRITER, and nothing has to be remembered for that
// to hold: removing the files is what flips the mode. The test above is the proof that the flip happens.
test('sow-213: BEFORE Phase 3, the same absent credential is a quiet no-op, because git is still authoritative', async () => {
  const overrides = gateOverrides();
  const { mode } = await applyOverridesSource({
    overrides,
    repoRoot: process.cwd(), // the house files are still here
    env: {},
    readKv: async () => { throw new Error('must not be called'); },
    log: () => {},
  });
  assert.equal(mode, 'git', 'no creds + files present = current behaviour, unchanged and silent');
});

// The 'git' mode is the pre-provisioning world and must stay EXACTLY as it was: no KV read at all, overrides
// untouched. Asserted because a change here would be a silent behaviour change on the live gate.
test('sow-213 (GATE): in git mode the KV read is never called and the overrides are untouched', async () => {
  const overrides = gateOverrides();
  let called = 0;
  const { mode } = await applyOverridesSource({
    overrides,
    repoRoot: process.cwd(), // the files are present
    env: {}, // no creds
    readKv: async () => { called += 1; return { available: true, bans: new Map([['1', {}]]), grandfathers: new Map() }; },
    log: () => {},
  });
  assert.equal(mode, 'git');
  assert.equal(called, 0, 'git mode must not reach the network at all');
  assert.equal(overrides.bans.size, 0, 'and must not have been overwritten');
});

test('sow-213: the 48h boundary matches the WORKER exactly (inclusive), deliberately', async () => {
  // The Worker uses `ageMs > MAX_OVERRIDES_AGE_MS` (workers/signup/membership-content.mjs), so a mirror at
  // EXACTLY 48h is still fresh there. The gate copies that comparison rather than tightening it to `>=`.
  // A one-millisecond disagreement is worth nothing, and two systems disagreeing about who is banned is its
  // own bug class: the gate would deny a PR the Worker still treats as fine, and no one would know why.
  // Pinned as a test so a future tidy-up of `>` into `>=` has to make the decision on purpose.
  const atBoundary = new Date(NOW.getTime() - MAX_OVERRIDES_AGE_MS).toISOString();
  const justBeyond = new Date(NOW.getTime() - MAX_OVERRIDES_AGE_MS - 1000).toISOString();
  assert.equal((await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(fresh({ generatedAt: atBoundary })) })).available, true, 'exactly 48h is fresh, as it is in the Worker');
  assert.equal((await readOverridesFromKv({ env: CREDS, now: NOW, fetchImpl: okFetch(fresh({ generatedAt: justBeyond })) })).available, false, 'one second past 48h is stale');
});

// --- The hazard itself, demonstrated rather than asserted. --------------------------------------------------

test('sow-213 THE HAZARD: with the git file absent, the trust core reports a BANNED author as paid', () => {
  // This test PASSES TODAY and is not a regression guard. It is an executable statement of the fail-open the
  // rest of this file exists to close, and it is here because the honest version of "acceptance test 2 fails
  // before the fix" is that it does NOT: acceptance test 2 exercises a module that did not previously exist,
  // so its pre-change failure would be an import error, which proves nothing. This is the real proof.
  //
  // Measured, not reasoned: loadOverrides against a root with no house/bans.yml yields an empty bans map, and
  // effectiveStatus then resolves a banned github_id to {status:'paid', source:'stripe'}. Silent, and in the
  // permissive direction. If this test ever starts FAILING, the trust core has learned to distinguish "no
  // bans" from "no ban list", and the derived-mode machinery guarding it can be revisited.
  const root = path.join(os.tmpdir(), `sow213-empty-${process.pid}`);
  fs.mkdirSync(path.join(root, 'house'), { recursive: true });
  try {
    const o = loadOverrides(root);
    assert.equal(o.bans.size, 0, 'a missing bans.yml reads as zero bans, not as an error');
    const eff = effectiveStatus('424242', 'paid', { bans: o.bans, grandfathers: o.grandfathers }, new Date());
    assert.equal(eff.status, 'paid', 'THE FAIL-OPEN: a banned author is admitted when the source is absent');
    // Which is exactly why the mode resolver refuses to fall back once the files are gone.
    assert.equal(resolveOverridesMode({ gitPresent: false, credsPresent: false }), 'kv');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- The mode is derived from reality, which is what removes the flag nobody remembers to flip. -------------

test('sow-213: the mode is DERIVED, and losing the git files makes KV mandatory with no fallback', () => {
  assert.equal(resolveOverridesMode({ gitPresent: true, credsPresent: false }), 'git');
  assert.equal(resolveOverridesMode({ gitPresent: true, credsPresent: true }), 'both');
  // The one that matters: files gone. There is no combination of inputs that returns 'git' here, because a
  // fallback at this point would BE the fail-open the SOW exists to close.
  assert.equal(resolveOverridesMode({ gitPresent: false, credsPresent: true }), 'kv');
  assert.equal(resolveOverridesMode({ gitPresent: false, credsPresent: false }), 'kv',
    'no creds AND no files must still demand KV, so the gate fails loudly rather than gating on an empty list');
});

test('sow-213: overrideFilesPresent reports on the real checkout', () => {
  // True today: the files are still in git. When Phase 3 removes them this flips, and the mode flips with it.
  assert.equal(overrideFilesPresent(process.cwd()), true, 'bans.yml/grandfathered.yml are still in git in Phase 1');
  assert.equal(overrideFilesPresent('/nonexistent-root'), false);
});

test('sow-213: kvCredsPresent requires ALL THREE, so a half-provisioned env does not look ready', () => {
  assert.equal(kvCredsPresent(CREDS), true);
  for (const k of Object.keys(CREDS)) {
    const partial = { ...CREDS, [k]: '' };
    assert.equal(kvCredsPresent(partial), false, `missing ${k} must read as not provisioned`);
  }
});

// --- The cross-check that makes Phase 2 safe without a flag day. --------------------------------------------

test('sow-213: diffOverrides is silent when the two sources agree', () => {
  const git = { bans: bansFromParsed({ bans: [{ github_id: '1' }] }), grandfathers: grandfathersFromParsed({ grandfathered: [{ github_id: '2' }] }) };
  const kv = { bans: bansFromParsed({ bans: [{ github_id: '1' }] }), grandfathers: grandfathersFromParsed({ grandfathered: [{ github_id: '2' }] }) };
  assert.deepEqual(diffOverrides(git, kv), []);
});

test('sow-213: diffOverrides catches a ban in ONE source only, in BOTH directions', () => {
  const empty = { bans: new Map(), grandfathers: new Map() };
  const banned = { bans: bansFromParsed({ bans: [{ github_id: '99' }] }), grandfathers: new Map() };
  // git-only: KV has not caught up, so a ban would be lost the moment KV becomes authoritative.
  assert.deepEqual(diffOverrides(banned, empty), [{ field: 'bans', id: '99', git: true, kv: false }]);
  // kv-only: the more dangerous direction during Phase 1, because git is still the source and would admit them.
  assert.deepEqual(diffOverrides(empty, banned), [{ field: 'bans', id: '99', git: false, kv: true }]);
});

test('sow-213: diffOverrides compares MEMBERSHIP, not prose', () => {
  // A differing reason or note is not a gating fact. Failing the gate on prose churn would train people to
  // ignore it, and a check people ignore is worse than no check.
  const a = { bans: bansFromParsed({ bans: [{ github_id: '7', reason: 'spam' }] }), grandfathers: new Map() };
  const b = { bans: bansFromParsed({ bans: [{ github_id: '7', reason: 'harassment, rewritten later' }] }), grandfathers: new Map() };
  assert.deepEqual(diffOverrides(a, b), []);
});

test('sow-213: diffOverrides reports grandfather divergence too, not just bans', () => {
  const withGrant = { bans: new Map(), grandfathers: grandfathersFromParsed({ grandfathered: [{ github_id: '5' }] }) };
  const without = { bans: new Map(), grandfathers: new Map() };
  assert.deepEqual(diffOverrides(withGrant, without), [{ field: 'grandfathered', id: '5', git: true, kv: false }]);
});
