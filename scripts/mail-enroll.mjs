#!/usr/bin/env node
// SOW-166: the weekly-digest member backfill. Enrols the member population into the digest subscriber store
// and seeds the two house follows, in one pass over one enumeration.
//
//   node scripts/mail-enroll.mjs              # dry run (the default), writes NOTHING
//   node scripts/mail-enroll.mjs --apply      # enact, and see the two gates below
//
// DRY RUN IS THE DEFAULT because this writes at full population scale and the mistake only surfaces at send.
// That is the reconcile convention and it matters more here than there.
//
// TWO HARD GATES ON --apply, BOTH MECHANISMS RATHER THAN REMINDERS:
//
//   1. MAIL_SUPPRESS_KEY must be set. mailHash returns null without it (membership/mail-suppress.mjs fails
//      closed on purpose), so no identity can be minted at all. This is not a soft degradation: with no key
//      there is nothing to write, and a run that "succeeded" having written zero records would be a lie.
//
//   2. MAIL_ENROLL_UNSUB_PROVEN must name the evidence that a real unsubscribe works end to end.
//      THE REASON IS THE ONLY REASON THAT MATTERS: auto-enrolment was approved with an explicit rider that
//      the opt-out is not deferrable. This write is close to irreversible at full population scale, so if it
//      lands before the opt-out is demonstrated, the entire member base is enrolled with no working way out,
//      which is precisely the state the rider exists to prevent. Enrolment and the unsubscribe path are
//      owned by different sessions, and each could reasonably assume the other held this gate. So it is
//      held here, in the thing that does the writing.
//      Set it to the evidence: a delivered message id, a clicked link, a read-back suppression marker.
//
// The dry run needs neither gate and is the whole point until the owner is back to provision the key.
//
// ONE INVARIANT THIS SCRIPT OWES THE REST OF THE SYSTEM: every `source: 'member'` subscriber record it
// writes carries `githubId`. Erasure cannot resolve a member's address through Stripe once their Customer is
// gone or carries no email, so it finds their records by scanning `mail:subscriber:*` and matching that
// field. A record without it would send mail perfectly well and be invisible to deletion. This is now
// enforced by buildSubscriber itself rather than by this file remembering to do it, but it is stated here
// too because THIS is the code that writes at population scale, and a future edit here is the likeliest
// place for it to be quietly dropped.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createStripeClient } from '../clients/stripe.mjs';
import { loadOverrides } from '../membership/overrides.mjs';
import { gatherMembers, gatherOverrideOnlyMembers } from './reconcile.mjs';
import { buildRepoIndex } from './lib/repo-content.mjs';
import { mailHash, subscriberKey, MAIL_SUBSCRIBER_PREFIX, MAIL_SUPPRESS_PREFIX } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { listKvByPrefix, putKvValue } from './lib/erase-member.mjs';
import {
  planMailEnrollment, planFollowBackfill, enrollmentCounts, IDENTITY_REASON, HOUSE_FOLLOW_TARGETS,
} from './lib/mail-enroll.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const FOLLOWS_PREFIX = 'follows:';

/** Dry run unless --apply, matching reconcile. */
export function parseArgs(argv) {
  const apply = argv.includes('--apply') && !argv.includes('--dry-run');
  return { apply, json: argv.includes('--json') };
}

/**
 * Derive one mail identity per member. The address is used HERE and nowhere else: it goes into the HMAC and
 * then out of scope, because a member subscriber record stores no address (data-protection.md:49) and the
 * drain resolves it from Stripe at send time.
 */
export async function resolveIdentities(members, secret) {
  const out = new Map();
  const haveKey = Boolean(String(secret ?? '').trim());
  for (const m of members) {
    const githubId = String(m?.githubId ?? '');
    if (!githubId) continue;
    // REACHABILITY IS CHECKED BEFORE THE KEY, and the order is the whole point. Whether an address exists
    // is a fact about the member; whether we can HASH it is a fact about the run. Testing the key first
    // collapsed the two, so with no key every member came back NO_KEY and the unreachable list came back
    // empty. That list is the one thing in this report the owner has to act on person by person, and it is
    // knowable today, with no secret provisioned. It must never be gated behind one.
    if (!m?.email) { out.set(githubId, { hash: null, reason: IDENTITY_REASON.NO_EMAIL }); continue; }
    if (!haveKey) { out.set(githubId, { hash: null, reason: IDENTITY_REASON.NO_KEY }); continue; }
    const hash = await mailHash(secret, m.email);
    out.set(githubId, hash ? { hash, reason: IDENTITY_REASON.OK } : { hash: null, reason: IDENTITY_REASON.NO_EMAIL });
  }
  return out;
}

/** Strip a KV prefix off a listed key. */
const bare = (key, prefix) => (key.startsWith(prefix) ? key.slice(prefix.length) : key);

/**
 * The set of bare ids present under a prefix, taken from a listKvByPrefix result's `keys`.
 *
 * Exported so the regression test can run the REAL path against a REAL listing rather than restating these
 * two lines and proving only that they agree with themselves. `keys` is every key the prefix listing
 * returned; `entries` is the subset whose value could also be fetched and parsed, which is not the question
 * an existence check is asking.
 */
export function idsPresent(listing, prefix) {
  return new Set((listing?.keys ?? []).map((k) => bare(k, prefix)));
}

function line(label, n) {
  return `  ${String(n).padStart(5)}  ${label}`;
}

/** The report. This is the deliverable the owner approves the real run from, so it names people, not counts. */
/** Total and per-status population, so the report opens with the number every other count is measured against. */
export function populationSummary(members = []) {
  const byStatus = {};
  for (const m of members) {
    const k = m?.effective?.status ?? 'unknown';
    byStatus[k] = (byStatus[k] ?? 0) + 1;
  }
  // MEASURED, not assumed. The unreachable zero-case below distinguishes "nobody is unreachable" from
  // "nobody was looked at" by citing this number, so it has to come from counting the rows that actually
  // came back from the override-only gather.
  const overrideOnlyGathered = members.filter((m) => m?._gather === 'override-only').length;
  return { total: members.length, byStatus, overrideOnlyGathered };
}

export function renderReport({ mailPlan, followPlan, counts, apply, haveKey, unsubProven, population = null }) {
  const out = [];
  out.push('');
  out.push(apply ? 'DIGEST BACKFILL: APPLY' : 'DIGEST BACKFILL: DRY RUN (nothing was written)');
  out.push('');
  out.push('POPULATION: every Stripe Customer carrying a github_id, minus banned.');
  out.push('Paid, trial, free and lapsed are all in scope.');
  if (population) {
    out.push('');
    out.push(line('gathered, all statuses', population.total));
    for (const [k, n] of Object.entries(population.byStatus).sort()) out.push(line(`  status ${k}`, n));
  }
  out.push('');
  out.push('SUBSCRIBER ENROLMENT');
  out.push(line('to enrol', counts.toEnroll));
  out.push(line('already enrolled (no-op, re-runnable)', counts.alreadyEnrolled));
  out.push(line('skipped, previously unsubscribed', counts.suppressed));
  out.push(line('UNREACHABLE, no address exists', counts.unreachable));
  out.push(line('excluded, banned', counts.excludedBanned));
  out.push('');
  out.push('FOLLOW BACKFILL');
  out.push(`  targets: ${HOUSE_FOLLOW_TARGETS.join(', ')}`);
  out.push(line('members needing at least one follow', counts.followWrites));
  out.push(line('already following both', counts.followAlreadyComplete));
  if (followPlan.unreadable?.length) {
    out.push(line('SKIPPED, their follows record could not be read', followPlan.unreadable.length));
    out.push('    Left untouched deliberately. Writing them would have replaced every follow they chose');
    out.push('    with just the two house accounts. Re-run once KV reads are healthy.');
    for (const r of followPlan.unreadable) {
      out.push(`    github_id ${r.githubId}  login ${r.githubLogin ?? '(unknown)'}`);
    }
  }

  if (followPlan.invalidTargets.length) {
    out.push('');
    out.push('  REFUSED: a follow target is not a valid username, so NOTHING was planned:');
    for (const t of followPlan.invalidTargets) out.push(`    ${JSON.stringify(t.target)}: ${t.reason}`);
  }

  // THE UNREACHABLE LIST IS THE PART THE OWNER HAS TO ACT ON, so it is named in full and never summarized.
  out.push('');
  if (mailPlan.unreachable.length) {
    const overrideOnly = mailPlan.unreachable.filter((r) => r.gather === 'override-only');
    const stripeNoEmail = mailPlan.unreachable.filter((r) => r.gather !== 'override-only');
    out.push('UNREACHABLE MEMBERS, BY NAME. These have no email address anywhere in the system, so they');
    out.push('cannot be enrolled by any means. Decide per person. The two groups are different problems:');
    out.push('');
    out.push(`  OVERRIDE-ONLY, no Stripe Customer (${overrideOnly.length}). A grandfather grant, so no address was`);
    out.push('  ever collected. Nothing in this system can recover one: somebody has to ask them.');
    for (const r of overrideOnly) {
      out.push(`    github_id ${r.githubId}  login ${r.githubLogin ?? '(unknown)'}  folder ${r.username ?? '(none)'}  status ${r.status}`);
    }
    if (stripeNoEmail.length) {
      out.push('');
      out.push(`  STRIPE CUSTOMER WITH AN EMPTY EMAIL (${stripeNoEmail.length}). This one IS fixable: set the address`);
      out.push('  on the Customer in Stripe and re-run, and they enrol like anybody else.');
      for (const r of stripeNoEmail) {
        out.push(`    github_id ${r.githubId}  login ${r.githubLogin ?? '(unknown)'}  folder ${r.username ?? '(none)'}  status ${r.status}`);
      }
    }
  } else {
    // A ZERO HERE HAS TWO CAUSES AND THEY LOOK IDENTICAL, so the report must not guess between them. It
    // reads back the number of override-only members the gather actually RETURNED, rather than asserting
    // which cause applies. The earlier wording called every zero suspect, which was right while the
    // recovered members had no Customers and goes FALSE the moment they do: once the backfill succeeds, a
    // genuinely clean zero is the expected result, and a report that still cried suspect would train its
    // reader to ignore the one line that ever matters here.
    const gathered = population?.overrideOnlyGathered;
    out.push('UNREACHABLE MEMBERS: none reported.');
    if (typeof gathered === 'number' && gathered > 0) {
      out.push(`  This is a REAL clean result. The override-only gather returned ${gathered} member(s) and an`);
      out.push('  address resolved for every one of them, so the list is empty because nobody is unreachable.');
    } else if (gathered === 0) {
      out.push('  TREAT THIS AS SUSPECT. The override-only gather returned NOBODY, so this list is empty');
      out.push('  because nothing was examined, not because everybody is reachable. Members carrying a');
      out.push('  grandfather grant and no Stripe Customer have email:null by construction');
      out.push('  (scripts/reconcile.mjs:488), so they cannot all have been reachable. Check that the');
      out.push('  grandfather list loaded before believing this line.');
    } else {
      out.push('  UNVERIFIED: this run did not measure the override-only gather, so it cannot tell an empty');
      out.push('  list apart from a gather that never ran.');
    }
  }

  if (mailPlan.enroll.length) {
    out.push('');
    out.push('SAMPLE RECORD (the first planned enrolment, as it would be written):');
    const s = mailPlan.enroll[0];
    const rec = buildSubscriber({ hash: s.hash, source: 'member', githubId: s.githubId }, { now: () => 0 });
    out.push(`    key   ${subscriberKey(s.hash)}`);
    out.push(`    value ${JSON.stringify({ ...rec, createdAt: '<now>', updatedAt: '<now>' })}`);
    out.push('    note  emailEnc is null by design: a MEMBER record never stores the address, the drain');
    out.push('          resolves it from Stripe at send time.');
  }

  out.push('');
  if (mailPlan.blocked) {
    out.push('BLOCKED: MAIL_SUPPRESS_KEY is not set, so no mail identity can be minted for anyone and this');
    out.push('run can write nothing. This is one unset secret, NOT a data problem: do not go looking for');
    out.push('missing addresses. The owner sets it; see .data/sow/human-todo.md.');
  } else if (!apply) {
    out.push('Nothing was written. To enact, both gates must be satisfied:');
    out.push(`    MAIL_SUPPRESS_KEY        ${haveKey ? 'set' : 'NOT SET'}`);
    out.push(`    MAIL_ENROLL_UNSUB_PROVEN ${unsubProven ? 'set' : 'NOT SET (a real unsubscribe must be proven first)'}`);
  }
  out.push('');
  return out.join('\n');
}

/**
 * Write the plan. Extracted from main and taking an injectable `put` so the enact path can be EXECUTED under
 * test with no network, which the mutation audit found it never was: every mutation was planner-side, so
 * deleting the `blocked` half of the write guard changed no test result.
 *
 * `blocked` is checked here and not only at the gates, and the distinction matters more than it looks.
 * Today it can only be set by a missing MAIL_SUPPRESS_KEY, and `--apply` without that key already exits at
 * the first gate, so this guard is currently unreachable in production. It is a GENERAL cannot-write flag,
 * though: the day anything else sets it, this is the only thing standing between a blocked plan and a write,
 * and an unreachable guard with no test is one that vanishes in a refactor without a single test going red.
 */
export async function enactPlan({ mailPlan, followPlan, apply = false, put } = {}) {
  if (!apply || mailPlan?.blocked) return { skipped: true, subscribers: 0, follows: 0 };

  let subscribers = 0;
  for (const s of mailPlan.enroll) {
    // buildSubscriber REQUIRES githubId on a member record: erasure finds member records by scanning
    // mail:subscriber:* and matching it, so one without it would send mail and be invisible to deletion.
    const rec = buildSubscriber({ hash: s.hash, source: 'member', githubId: s.githubId });
    await put(subscriberKey(s.hash), rec);
    subscribers += 1;
    // THE mail:member-hash:<github_id> POINTER IS DELIBERATELY NOT WRITTEN. sow-186 DROPPED that bridge once
    // it was established that a member record already carries githubId, so the fan-out and erasure both scan
    // for it instead of maintaining an index. Nothing goes here; the requirement above is what replaced it.
  }

  let follows = 0;
  for (const w of followPlan.writes) {
    await put(`${FOLLOWS_PREFIX}${w.githubId}`, w.next);
    follows += 1;
  }
  return { skipped: false, subscribers, follows };
}

async function main() {
  const { apply, json } = parseArgs(process.argv.slice(2));
  const env = process.env;
  const secret = env.MAIL_SUPPRESS_KEY ?? '';
  const haveKey = Boolean(String(secret).trim());
  const unsubProven = Boolean(String(env.MAIL_ENROLL_UNSUB_PROVEN ?? '').trim());

  if (apply && !haveKey) {
    console.error('mail-enroll: refusing to apply: MAIL_SUPPRESS_KEY is not set, so no identity can be minted.');
    process.exit(1);
  }
  if (apply && !unsubProven) {
    console.error('mail-enroll: refusing to apply: MAIL_ENROLL_UNSUB_PROVEN is not set.');
    console.error('  Auto-enrolment was approved on the condition that the opt-out is not deferrable. Prove a');
    console.error('  real delivered email whose real unsubscribe link was clicked and whose suppression marker');
    console.error('  was read back, then set this to that evidence. Enrolling first is the one mistake this');
    console.error('  backfill cannot walk back.');
    process.exit(1);
  }

  const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: globalThis.fetch });
  const overrides = loadOverrides(ROOT);
  const now = new Date();
  const repoIndex = buildRepoIndex(ROOT);

  const stripeMembers = (await gatherMembers(stripe, overrides, now, { repoIndex, discord: null, env }))
    .map((m) => ({ ...m, _gather: 'stripe' }));
  const seen = new Set(stripeMembers.map((m) => String(m.githubId)));
  // The override-only gather is what SURFACES the unreachable. Without it they are not absent from the
  // report, they are absent from the population, and the report reads clean while naming nobody.
  const overrideOnly = (await gatherOverrideOnlyMembers(overrides, now, { seen, repoIndex, discord: null, env }))
    .map((m) => ({ ...m, _gather: 'override-only' }));
  const members = [...stripeMembers, ...overrideOnly];

  const identities = await resolveIdentities(members, secret);

  // One list per prefix rather than a read per member: the same three round trips whether the population is
  // eight people or eight hundred.
  const [subs, supp, follows] = await Promise.all([
    listKvByPrefix({ prefix: MAIL_SUBSCRIBER_PREFIX, env }),
    listKvByPrefix({ prefix: MAIL_SUPPRESS_PREFIX, env }),
    listKvByPrefix({ prefix: FOLLOWS_PREFIX, env }),
  ]);
  // EXISTENCE QUESTIONS READ `keys`, NOT `entries`, and the difference is a fixed bug rather than a style
  // choice (sow-166, found by @QAmaster, `listKvByPrefix` extended by @SecurityMaster in 238ea2c3).
  // `entries` requires a second fetch per key for the VALUE, and silently omits any key whose value read
  // failed. A suppression marker carries nothing anyone needs: its EXISTENCE is the whole signal. Reading it
  // through `entries` meant one transient 500 on a value read turned somebody who had unsubscribed into
  // somebody who appeared never to have unsubscribed, and they would be enrolled. Reading `keys` cannot lose
  // a key that way, and skips a fetch per marker as a bonus.
  const enrolled = idsPresent(subs, MAIL_SUBSCRIBER_PREFIX);
  const suppressed = idsPresent(supp, MAIL_SUPPRESS_PREFIX);

  // The follow backfill genuinely needs VALUES, because it computes what is missing from what is there. So
  // it reads `entries`, and that makes the same failure DESTRUCTIVE here rather than merely permissive:
  // a member whose follows value could not be read is absent from this map, normalizeFollows(undefined)
  // yields an empty graph, and the planner would write a record containing ONLY the two house accounts,
  // OVERWRITING every follow that member had chosen and any per-follow notify preference with them.
  //
  // So the unreadable ones are identified and excluded. `keys` is every follows record that EXISTS; the map
  // holds the ones we could actually read; the difference is the set we must not touch. Not being able to
  // read somebody's follows is a reason to leave them alone, never a reason to treat them as having none.
  const followsByGithubId = new Map((follows.entries ?? []).map((e) => [bare(e.key, FOLLOWS_PREFIX), e.value]));
  const followsUnreadable = new Set(
    (follows.keys ?? []).map((k) => bare(k, FOLLOWS_PREFIX)).filter((id) => !followsByGithubId.has(id)),
  );

  const mailPlan = planMailEnrollment({ members, identities, suppressed, enrolled });
  const followPlan = planFollowBackfill({ members, followsByGithubId, followsUnreadable, now: () => now.getTime() });
  const counts = enrollmentCounts(mailPlan, followPlan);

  if (json) {
    console.log(JSON.stringify({ population: populationSummary(members), counts, unreachable: mailPlan.unreachable, blocked: mailPlan.blocked }, null, 2));
  } else {
    console.log(renderReport({ mailPlan, followPlan, counts, apply, haveKey, unsubProven, population: populationSummary(members) }));
  }

  const enacted = await enactPlan({ mailPlan, followPlan, apply, put: (key, value) => putKvValue({ key, value, env }) });
  if (enacted.skipped) return;
  console.log(`mail-enroll: wrote ${enacted.subscribers} subscriber records and ${enacted.follows} follow records.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('mail-enroll: failed:', err?.message ?? err);
    process.exit(1);
  });
}
