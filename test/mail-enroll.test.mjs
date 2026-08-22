// SOW-166: the digest member backfill planner. No network, no KV, no secrets.
//
// EVERY TEST HERE MIXES PEOPLE WHO SHOULD BE ENROLLED WITH PEOPLE WHO SHOULD NOT, IN THE SAME RUN. A suite
// that feeds a planner only enrollable members and asserts "everyone was enrolled" passes identically
// whether the exclusions work or do not exist at all. That exact shape cost us a morning, so the population
// fixture below deliberately carries a banned member, an unreachable one, a suppressed one and an
// already-enrolled one alongside the four who should actually be written.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planMailEnrollment,
  planFollowBackfill,
  enrollmentCounts,
  HOUSE_FOLLOW_TARGETS,
  IDENTITY_REASON,
} from '../scripts/lib/mail-enroll.mjs';
import { normalizeUsername, followingUsernames, followNotify } from '../membership/member-follows.mjs';

const NOW = () => 1755_000_000_000;

const member = (githubId, status, over = {}) => ({
  githubId,
  githubLogin: `login${githubId}`,
  username: `user${githubId}`,
  email: `${githubId}@example.test`,
  effective: { status, source: 'stripe' },
  ...over,
});

// paid, trial, free and lapsed are all IN (owner 2026-08-21); banned is OUT; the override-only member has
// no address anywhere in the system.
const POPULATION = [
  member('1', 'paid'),
  member('2', 'trialing'),
  member('3', 'none'), // free
  member('4', 'expired'), // lapsed: deliberately in scope, they are who a digest wins back
  member('5', 'banned'),
  member('6', 'paid', { email: null }), // override-only, no Stripe customer
  member('7', 'paid'), // will be suppressed
  member('8', 'paid'), // will be already enrolled
];

const identities = (over = {}) => new Map(POPULATION.map((m) => [
  m.githubId,
  m.email ? { hash: `h${m.githubId}`, reason: IDENTITY_REASON.OK } : { hash: null, reason: IDENTITY_REASON.NO_EMAIL },
].map((v, i) => (i === 1 && over[m.githubId] ? over[m.githubId] : v))).map(([k, v]) => [k, over[k] ?? v]));

const ids = (rows) => rows.map((r) => r.githubId).sort();

test('the four enrollable statuses enroll, and nobody else does', () => {
  const plan = planMailEnrollment({
    members: POPULATION,
    identities: identities(),
    suppressed: new Set(['h7']),
    enrolled: new Set(['h8']),
  });

  // The positive claim.
  assert.deepEqual(ids(plan.enroll), ['1', '2', '3', '4'], 'paid, trial, free and lapsed all enroll');
  // And each exclusion landed in ITS OWN bucket, which is what makes the negatives discriminating: a member
  // who vanished entirely would leave every bucket short, and a member in the wrong bucket is a visible bug.
  assert.deepEqual(ids(plan.excludedBanned), ['5']);
  assert.deepEqual(ids(plan.unreachable), ['6']);
  assert.deepEqual(ids(plan.suppressedSkips), ['7']);
  assert.deepEqual(ids(plan.alreadyEnrolled), ['8']);
  assert.equal(plan.blocked, false);

  // Nobody is double counted and nobody is lost: every member landed in exactly one bucket.
  const all = [...plan.enroll, ...plan.excludedBanned, ...plan.unreachable, ...plan.suppressedSkips, ...plan.alreadyEnrolled];
  assert.equal(all.length, POPULATION.length, 'every member is accounted for exactly once');
});

test('a suppressed member is NEVER re-enrolled, which is the opt-out rider', () => {
  // The whole population is suppressed. If the check were absent this would enroll seven people who asked
  // not to be contacted, and a count-only assertion would not notice.
  const plan = planMailEnrollment({
    members: POPULATION,
    identities: identities(),
    suppressed: new Set(['h1', 'h2', 'h3', 'h4', 'h7', 'h8']),
    enrolled: new Set(),
  });
  assert.deepEqual(plan.enroll, [], 'not one suppressed address is swept back in');
  assert.deepEqual(ids(plan.suppressedSkips), ['1', '2', '3', '4', '7', '8']);
});

test('an unreachable member is REPORTED BY NAME, never silently skipped', () => {
  const plan = planMailEnrollment({ members: [member('6', 'paid', { email: null })], identities: identities() });
  assert.equal(plan.unreachable.length, 1);
  const row = plan.unreachable[0];
  // The owner has to be able to act on this per person, so the row has to identify the person.
  assert.equal(row.githubId, '6');
  assert.equal(row.githubLogin, 'login6');
  assert.equal(row.username, 'user6');
  assert.match(row.reason, /no email address/i);
  assert.equal(plan.enroll.length, 0);
});

test('a missing MAIL_SUPPRESS_KEY blocks the whole run rather than looking like bad data', () => {
  const noKey = new Map(POPULATION.map((m) => [m.githubId, { hash: null, reason: IDENTITY_REASON.NO_KEY }]));
  const plan = planMailEnrollment({ members: POPULATION, identities: noKey });
  assert.equal(plan.blocked, true, 'the run is blocked, not merely empty');
  assert.equal(plan.enroll.length, 0);
  // The distinction that matters: this is NOT reported as everyone being unreachable, because that would
  // send the owner chasing missing addresses when the real cause is one unset secret.
  assert.equal(plan.unreachable.length, 0);
});

test('a member with no identity at all is unreachable, not enrolled with a null hash', () => {
  const plan = planMailEnrollment({ members: [member('9', 'paid')], identities: new Map() });
  assert.equal(plan.enroll.length, 0, 'an absent identity never becomes a subscriber record');
  assert.equal(plan.unreachable.length, 1);
});

test('the follow backfill adds both house accounts, and only what is missing', () => {
  const follows = new Map([
    ['2', { following: [{ username: 'atwellpub', addedAt: 1 }], updatedAt: 1 }], // has one already
    ['3', { following: [{ username: 'atwellpub', addedAt: 1 }, { username: 'gbtilabs', addedAt: 1 }], updatedAt: 1 }],
  ]);
  const plan = planFollowBackfill({ members: POPULATION, followsByGithubId: follows, now: NOW });

  const byId = new Map(plan.writes.map((w) => [w.githubId, w]));
  assert.deepEqual(byId.get('1').add, ['atwellpub', 'gbtilabs'], 'a member with no follows gets both');
  assert.deepEqual(byId.get('2').add, ['gbtilabs'], 'a member already following one gets only the other');
  assert.deepEqual(ids(plan.alreadyComplete), ['3'], 'a member following both is a no-op');
  assert.deepEqual(ids(plan.excludedBanned), ['5'], 'banned gets ZERO KV, follows included');
  assert.ok(!byId.has('5'), 'and is not written');

  // The resulting record is a real follows object the store would accept.
  assert.deepEqual(followingUsernames(byId.get('1').next).sort(), ['atwellpub', 'gbtilabs']);
});

test('the backfill preserves an existing follow, including its notify preference', () => {
  const notify = { post: { email: true } };
  const follows = new Map([['1', { following: [{ username: 'atwellpub', addedAt: 42, notify }], updatedAt: 42 }]]);
  const plan = planFollowBackfill({ members: [member('1', 'paid')], followsByGithubId: follows, now: NOW });
  const w = plan.writes[0];
  assert.deepEqual(w.add, ['gbtilabs'], 'only the missing one is added');
  // The pre-existing entry is untouched: same addedAt, same notify. A backfill that reset these would
  // silently discard a member's own choice.
  const kept = w.next.following.find((f) => f.username === 'atwellpub');
  assert.equal(kept.addedAt, 42);
  assert.ok(followNotify(w.next, 'atwellpub'), 'the notify preference survives the backfill');
});

test('gbti-labs VALIDATES as a username, which is exactly why the target list is a constant', () => {
  // This is the trap, pinned by mechanism rather than by memory. The validator cannot catch it: it is a
  // well-formed username that simply names nobody, so it writes clean and resolves to nothing forever.
  assert.ok(normalizeUsername('gbti-labs'), 'a validator would accept it');
  assert.ok(!HOUSE_FOLLOW_TARGETS.includes('gbti-labs'), 'so the constant has to be right instead');
  assert.deepEqual([...HOUSE_FOLLOW_TARGETS], ['atwellpub', 'gbtilabs']);
});

test('an invalid target plans NOTHING rather than planning something wrong', () => {
  // A bad target would otherwise be written to every member in the population at once.
  const plan = planFollowBackfill({ members: POPULATION, targets: ['atwellpub', 'not a username!'], now: NOW });
  assert.equal(plan.writes.length, 0, 'fail closed: no member is written');
  assert.equal(plan.invalidTargets.length, 1);
  assert.equal(plan.invalidTargets[0].target, 'not a username!');
});

test('the counts tally what the planners actually produced', () => {
  const mailPlan = planMailEnrollment({
    members: POPULATION, identities: identities(), suppressed: new Set(['h7']), enrolled: new Set(['h8']),
  });
  const followPlan = planFollowBackfill({ members: POPULATION, now: NOW });
  const c = enrollmentCounts(mailPlan, followPlan);
  assert.equal(c.toEnroll, 4);
  assert.equal(c.suppressed, 1);
  assert.equal(c.unreachable, 1);
  assert.equal(c.excludedBanned, 1);
  assert.equal(c.alreadyEnrolled, 1);
  assert.equal(c.followWrites, 7, 'everyone except the banned member needs follows');
});

// ---------------------------------------------------------------------------------------------------
// The runner: identity derivation, the report, and the two gates that stand between a dry run and a write
// at full population scale. The gates are spawned for real, because a gate asserted in-process is a gate
// nobody proved actually stops the program.
// ---------------------------------------------------------------------------------------------------
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, resolveIdentities, renderReport, enactPlan, idsPresent } from '../scripts/mail-enroll.mjs';
import { listKvByPrefix } from '../scripts/lib/erase-member.mjs';
import { planMailEnrollment as planM, planFollowBackfill as planF, enrollmentCounts as counts_ } from '../scripts/lib/mail-enroll.mjs';

const execFileP = promisify(execFile);
const SCRIPT = path.resolve(fileURLToPath(import.meta.url), '../../scripts/mail-enroll.mjs');

test('dry run is the default, and --dry-run beats --apply', () => {
  assert.equal(parseArgs([]).apply, false, 'no flags means dry run');
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.equal(parseArgs(['--apply', '--dry-run']).apply, false, 'the safe flag wins when both are given');
});

test('an identity is derived only from a real address under a real key', async () => {
  const ms = [member('1', 'paid'), member('2', 'paid', { email: null })];

  const withKey = await resolveIdentities(ms, 'a-test-key');
  assert.match(withKey.get('1').hash, /^[0-9a-f]{64}$/, 'a 64-hex HMAC identity');
  assert.equal(withKey.get('1').reason, IDENTITY_REASON.OK);
  assert.equal(withKey.get('2').hash, null, 'no address means no identity');
  assert.equal(withKey.get('2').reason, IDENTITY_REASON.NO_EMAIL);

  // Same address, same hash: subscribe is idempotent and an anonymous subscriber later collapses onto the
  // same key. Different address, different hash. Both directions, because either alone would pass on a stub.
  const again = await resolveIdentities([member('1', 'paid')], 'a-test-key');
  assert.equal(again.get('1').hash, withKey.get('1').hash, 'stable for the same address');
  const other = await resolveIdentities([member('9', 'paid')], 'a-test-key');
  assert.notEqual(other.get('9').hash, withKey.get('1').hash, 'and distinct for a different one');

  // A different key yields a different identity, which is why the key must never rotate.
  const otherKey = await resolveIdentities([member('1', 'paid')], 'a-different-key');
  assert.notEqual(otherKey.get('1').hash, withKey.get('1').hash);

  const noKey = await resolveIdentities(ms, '');
  assert.equal(noKey.get('1').reason, IDENTITY_REASON.NO_KEY, 'no key is a run-level fact, not a member one');
});

test('the report NAMES unreachable members and never just counts them', () => {
  const mailPlan = planM({
    members: POPULATION, identities: identities(), suppressed: new Set(['h7']), enrolled: new Set(['h8']),
  });
  const followPlan = planF({ members: POPULATION, now: NOW });
  const text = renderReport({
    mailPlan, followPlan, counts: counts_(mailPlan, followPlan), apply: false, haveKey: true, unsubProven: false,
  });

  assert.match(text, /DRY RUN \(nothing was written\)/);
  assert.match(text, /github_id 6\s+login login6/, 'the unreachable member is named, not tallied');
  assert.match(text, /MAIL_ENROLL_UNSUB_PROVEN NOT SET/, 'and the outstanding gate is stated');
  // The sample record must never carry an address, in any field.
  assert.match(text, /SAMPLE RECORD/);
  assert.ok(!text.includes('@example.test'), 'no address reaches the report');
});

test('an EMPTY unreachable list is reported as suspect, not as clean', () => {
  // email:null exists by construction, so nobody unreachable usually means the override-only gather did not
  // run. A report that called that "clean" would launder a broken check into a green result.
  const mailPlan = planM({ members: [member('1', 'paid')], identities: identities() });
  const followPlan = planF({ members: [member('1', 'paid')], now: NOW });
  const text = renderReport({
    mailPlan, followPlan, counts: counts_(mailPlan, followPlan), apply: false, haveKey: true, unsubProven: true,
  });
  assert.match(text, /TREAT THIS AS SUSPECT/);
});

test('--apply REFUSES without MAIL_SUPPRESS_KEY, proven by running it', async () => {
  const err = await execFileP(process.execPath, [SCRIPT, '--apply'], {
    env: { ...process.env, MAIL_SUPPRESS_KEY: '', MAIL_ENROLL_UNSUB_PROVEN: 'evidence' },
  }).then(() => null, (e) => e);
  assert.ok(err, 'the process exited non-zero');
  assert.equal(err.code, 1);
  assert.match(err.stderr, /MAIL_SUPPRESS_KEY is not set/);
});

test('--apply REFUSES until an unsubscribe is proven, proven by running it', async () => {
  // This is the gate that protects the population from being enrolled with no way out. It has to stop the
  // program, so the test stops the program.
  const err = await execFileP(process.execPath, [SCRIPT, '--apply'], {
    env: { ...process.env, MAIL_SUPPRESS_KEY: 'a-test-key', MAIL_ENROLL_UNSUB_PROVEN: '' },
  }).then(() => null, (e) => e);
  assert.ok(err, 'the process exited non-zero');
  assert.equal(err.code, 1);
  assert.match(err.stderr, /MAIL_ENROLL_UNSUB_PROVEN is not set/);
  assert.match(err.stderr, /opt-out is not deferrable/);
});

test('the UNREACHABLE list survives a missing key, because it never needed one', async () => {
  // The regression this pins: reachability is a fact about the member, key availability is a fact about the
  // run. Checking the key first collapsed them, so with no key the report named nobody, and the one list
  // the owner has to act on person by person was empty precisely when it was most needed. Every run today
  // has no key, so this is the normal case, not an edge one.
  const ms = [member('1', 'paid'), member('6', 'paid', { email: null })];
  const noKey = await resolveIdentities(ms, '');
  assert.equal(noKey.get('6').reason, IDENTITY_REASON.NO_EMAIL, 'no address is still no address');
  assert.equal(noKey.get('1').reason, IDENTITY_REASON.NO_KEY);

  const plan = planM({ members: ms, identities: noKey });
  assert.equal(plan.blocked, true, 'the run still cannot write');
  assert.deepEqual(ids(plan.unreachable), ['6'], 'and the owner still gets their list');
  assert.equal(plan.enroll.length, 0);
});

test('the report opens with the population it measured everything against', async () => {
  const { populationSummary } = await import('../scripts/mail-enroll.mjs');
  const pop = populationSummary(POPULATION);
  assert.equal(pop.total, 8);
  assert.equal(pop.byStatus.banned, 1);
  assert.equal(pop.byStatus.paid, 4);

  const mailPlan = planM({ members: POPULATION, identities: identities() });
  const followPlan = planF({ members: POPULATION, now: NOW });
  const text = renderReport({
    mailPlan, followPlan, counts: counts_(mailPlan, followPlan), apply: false, haveKey: true, unsubProven: false, population: pop,
  });
  assert.match(text, /gathered, all statuses/);
  assert.match(text, /status banned/);
});

test('the two unreachable populations are reported separately, because they are different problems', () => {
  // An override-only member has no address anywhere and nothing here can fix that. A Stripe Customer with an
  // empty email is a Stripe data problem somebody can go and fix. Reporting one number for both would
  // describe the first and hide the second.
  const ms = [
    { ...member('6', 'paid', { email: null }), _gather: 'override-only' },
    { ...member('7', 'paid', { email: null }), _gather: 'stripe' },
  ];
  const idents = new Map(ms.map((m) => [m.githubId, { hash: null, reason: IDENTITY_REASON.NO_EMAIL }]));
  const mailPlan = planM({ members: ms, identities: idents });
  assert.equal(mailPlan.unreachable.length, 2);
  assert.equal(mailPlan.unreachable.find((r) => r.githubId === '6').gather, 'override-only');
  assert.equal(mailPlan.unreachable.find((r) => r.githubId === '7').gather, 'stripe');

  const text = renderReport({
    mailPlan, followPlan: planF({ members: ms, now: NOW }), counts: counts_(mailPlan, planF({ members: ms, now: NOW })),
    apply: false, haveKey: false, unsubProven: false,
  });
  assert.match(text, /OVERRIDE-ONLY, no Stripe Customer \(1\)/);
  assert.match(text, /STRIPE CUSTOMER WITH AN EMPTY EMAIL \(1\)/, 'the fixable group is called out as fixable');
});

// ---------------------------------------------------------------------------------------------------
// THE ENACT PATH, EXECUTED. Found by @QAmaster: every mutation above is planner-side, so the write guard
// had no coverage and deleting half of it changed no result. These run the writer with an injectable put.
// ---------------------------------------------------------------------------------------------------

const capture = () => { const w = []; return { w, put: async (key, value) => { w.push({ key, value }); } }; };

test('enactPlan writes a subscriber record per enrolment and a follows record per member', async () => {
  const mailPlan = planM({ members: POPULATION, identities: identities(), suppressed: new Set(['h7']), enrolled: new Set(['h8']) });
  const followPlan = planF({ members: POPULATION, now: NOW });
  const { w, put } = capture();

  const r = await enactPlan({ mailPlan, followPlan, apply: true, put });
  assert.equal(r.skipped, false);
  assert.equal(r.subscribers, 4, 'the four enrollable members');
  assert.equal(r.follows, 7, 'everyone except the banned member');
  assert.equal(w.length, 11);

  const subs = w.filter((e) => e.key.startsWith('mail:subscriber:'));
  assert.equal(subs.length, 4);
  // Every written record is a MEMBER record carrying githubId, which erasure scans for, and NO address.
  for (const e of subs) {
    assert.equal(e.value.source, 'member');
    assert.ok(e.value.githubId, 'githubId present, or erasure cannot find this record');
    assert.equal(e.value.emailEnc, null, 'a member record never stores the address');
  }
  // And the suppressed / already-enrolled hashes were not among them.
  const written = new Set(subs.map((e) => e.key));
  assert.ok(!written.has('mail:subscriber:h7'), 'the unsubscribed member was not written');
  assert.ok(!written.has('mail:subscriber:h8'), 'the already-enrolled member was not rewritten');

  const foll = w.filter((e) => e.key.startsWith('follows:'));
  assert.ok(!foll.some((e) => e.key === 'follows:5'), 'the banned member got no follows record');
});

test('enactPlan writes NOTHING on a dry run', async () => {
  const mailPlan = planM({ members: POPULATION, identities: identities() });
  const followPlan = planF({ members: POPULATION, now: NOW });
  const { w, put } = capture();
  const r = await enactPlan({ mailPlan, followPlan, apply: false, put });
  assert.equal(r.skipped, true);
  assert.equal(w.length, 0, 'not one put');
});

test('enactPlan writes NOTHING when the plan is blocked, even with apply set', async () => {
  // The guard QAmaster found surviving. It is unreachable in production today, because --apply without a key
  // exits at the first gate, but `blocked` is a general cannot-write flag: the day anything else sets it,
  // this is the only thing between a blocked plan and a write at population scale.
  const noKey = new Map(POPULATION.map((m) => [m.githubId, { hash: null, reason: IDENTITY_REASON.NO_KEY }]));
  const mailPlan = planM({ members: POPULATION, identities: noKey });
  assert.equal(mailPlan.blocked, true);
  const followPlan = planF({ members: POPULATION, now: NOW });
  const { w, put } = capture();

  const r = await enactPlan({ mailPlan, followPlan, apply: true, put });
  assert.equal(r.skipped, true, 'blocked beats apply');
  assert.equal(w.length, 0, 'and in particular the follow writes did not proceed either');
});

// ---------------------------------------------------------------------------------------------------
// The suppression read. Found by @QAmaster: an existence check built from `entries` loses any key whose
// VALUE read failed, so one transient 500 turned somebody who had unsubscribed into somebody who appeared
// never to have. These run the REAL listKvByPrefix against a fetch that fails a value read.
// ---------------------------------------------------------------------------------------------------

/** A KV REST fake: lists three markers, and fails the value read for whichever key is named. */
const kvFetchFailingValueFor = (failKey) => async (url) => {
  const u = String(url);
  if (u.includes('/keys?')) {
    return { ok: true, json: async () => ({
      result: ['mail:suppress:h1', 'mail:suppress:h2', 'mail:suppress:h3'].map((name) => ({ name })),
      result_info: {},
    }) };
  }
  if (u.includes(encodeURIComponent(failKey))) return { ok: false, status: 500 };
  return { ok: true, json: async () => ({ suppressed: true }) };
};
const CF_ENV = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };

test('a suppression marker survives a failed VALUE read, so an unsubscribed member is not re-enrolled', async () => {
  const listing = await listKvByPrefix({
    prefix: 'mail:suppress:', env: CF_ENV, fetchImpl: kvFetchFailingValueFor('mail:suppress:h2'),
  });

  // The instrument itself, asserted first: the listing really did lose one to `entries`. Without this the
  // test could pass against a fake that never failed anything, proving nothing.
  assert.equal(listing.keys.length, 3, 'all three keys were listed');
  assert.equal(listing.entries.length, 2, 'and one really was dropped from entries');
  assert.equal(listing.unreadable, 1);

  // The fix: the existence set is built from keys, so it still has all three.
  const suppressed = idsPresent(listing, 'mail:suppress:');
  assert.deepEqual([...suppressed].sort(), ['h1', 'h2', 'h3']);

  // And the member behind the dropped marker is NOT enrolled, which is the consequence that matters.
  const members = [member('1', 'paid'), member('2', 'paid'), member('3', 'paid')];
  const idents = new Map(members.map((m, i) => [m.githubId, { hash: `h${i + 1}`, reason: IDENTITY_REASON.OK }]));
  const plan = planM({ members, identities: idents, suppressed });
  assert.deepEqual(plan.enroll, [], 'nobody who unsubscribed is swept back in');
  assert.deepEqual(ids(plan.suppressedSkips), ['1', '2', '3']);

  // The old behaviour, shown failing, so the regression is pinned by contrast rather than by assertion alone.
  const fromEntries = new Set(listing.entries.map((e) => e.key.slice('mail:suppress:'.length)));
  const oldPlan = planM({ members, identities: idents, suppressed: fromEntries });
  assert.deepEqual(ids(oldPlan.enroll), ['2'], 'reading entries would have enrolled the dropped one');
});

test('a follows record that exists but cannot be READ is skipped, never overwritten', async () => {
  // Strictly worse than the suppression bug: that one enrols somebody who opted out, this one would replace
  // every follow a member chose, and their per-follow notify preferences, with just the two house accounts.
  const members = [member('1', 'paid'), member('2', 'paid')];
  const readable = new Map([['1', { following: [{ username: 'someone-else', addedAt: 1 }], updatedAt: 1 }]]);
  const plan = planF({
    members, followsByGithubId: readable, followsUnreadable: new Set(['2']), now: NOW,
  });

  assert.deepEqual(plan.unreadable.map((r) => r.githubId), ['2']);
  assert.ok(!plan.writes.some((w) => w.githubId === '2'), 'the unreadable member is not written');

  // The readable member is still processed normally, so this is a targeted skip and not a blanket stop.
  const w1 = plan.writes.find((w) => w.githubId === '1');
  assert.deepEqual(w1.add, ['atwellpub', 'gbtilabs']);
  assert.ok(followingUsernames(w1.next).includes('someone-else'), 'and their existing follow is preserved');
});

test('the report names the members whose follows could not be read', () => {
  const members = [member('2', 'paid')];
  const followPlan = planF({ members, followsUnreadable: new Set(['2']), now: NOW });
  const mailPlan = planM({ members, identities: identities() });
  const text = renderReport({
    mailPlan, followPlan, counts: counts_(mailPlan, followPlan), apply: false, haveKey: true, unsubProven: false,
  });
  assert.match(text, /could not be read/);
  assert.match(text, /github_id 2/, 'named, not just counted');
  assert.match(text, /replaced every follow they chose/, 'and the consequence of not skipping is stated');
});
