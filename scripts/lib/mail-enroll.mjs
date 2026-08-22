// SOW-166: the PURE planning core for the weekly-digest member backfill. No IO, no crypto, no Date.now()
// inside (callers inject `now`), so the whole decision surface is unit-testable with plain objects. The
// runner (scripts/mail-enroll.mjs) does the Stripe walk, the HMAC and the KV writes around these transforms.
//
// TWO BACKFILLS, ONE POPULATION WALK. Enrolment writes `mail:subscriber:<hash>`; the follow backfill writes
// `follows:<github_id>`. They are planned together because they answer the same question about the same
// people and a second enumeration is how two counts start disagreeing.
//
// POPULATION (owner, 2026-08-21): every Stripe Customer carrying a github_id, MINUS banned. Paid, trial,
// free and lapsed are all IN. Lapsed are deliberately in scope: they are the ones a digest wins back.
//
// AUTO-ENROLMENT IS THE APPROVED DESIGN (sow-166 questions 3 and 4, resolved 2026-08-16), and it is approved
// WITH A RIDER: the opt-out is not deferrable. That rider is enforced here rather than trusted, in the one
// way a planner can enforce it: a suppressed address is NEVER re-enrolled, so somebody who has already
// unsubscribed cannot be swept back in by a later run of this backfill. The marker outlives the record
// precisely so this check has something to read (membership/mail-suppress.mjs).
//
// WHY UNREACHABLE IS A FIRST-CLASS RESULT AND NOT A SKIP. Override-only members (grandfathered, no Stripe
// Customer) carry `email: null` at scripts/reconcile.mjs:488. There is no address for them ANYWHERE in the
// system, so they cannot be enrolled by any means, and no amount of retrying changes that. A silent skip
// would be indistinguishable from success in every count the owner reads. They are returned BY NAME so the
// owner can decide per person.

import { normalizeFollows, applyFollow, followingUsernames, normalizeUsername } from '../../membership/member-follows.mjs';

/**
 * The two house accounts every member is backfilled to follow (owner, 2026-08-21).
 *
 * `gbti-labs` IS NOT A USERNAME and writing it is the trap this constant exists to close. The folder is
 * `members/gbtilabs`. USERNAME_RE in member-follows.mjs permits internal hyphens, so `gbti-labs` VALIDATES,
 * stores clean, and then resolves against the activity index to nothing, forever. The failure is silent in
 * both directions: the write reports success and the feed reports an empty follow.
 */
export const HOUSE_FOLLOW_TARGETS = Object.freeze(['atwellpub', 'gbtilabs']);

/** Why a member has no mail identity. `no-email` is per person; `no-key` is the whole run. */
export const IDENTITY_REASON = Object.freeze({ OK: 'ok', NO_EMAIL: 'no-email', NO_KEY: 'no-key' });

const idOf = (m) => String(m?.githubId ?? '').trim();
const isBanned = (m) => m?.effective?.status === 'banned';

/** The person-identifying fields carried into a report row. Never an email address. */
function who(m) {
  return {
    githubId: idOf(m),
    githubLogin: m?.githubLogin ?? null,
    username: m?.username ?? null,
    status: m?.effective?.status ?? null,
    // Which gather produced this member. The two unreachable populations are DIFFERENT PROBLEMS with
    // different fixes, and lumping them together is how a report describes one and hides the other:
    //   'override-only' -> a grandfather grant with no Stripe Customer. No address was ever collected.
    //                      Nothing in this system can fix it; somebody has to ask the person.
    //   'stripe'        -> a real Customer whose email field is empty. That IS fixable in Stripe.
    // The first version of this report asserted "they are override-only" as static copy, which happened to
    // be true and would have gone on reading true if it stopped being so.
    gather: m?._gather ?? 'unknown',
  };
}

/**
 * Plan the subscriber backfill.
 *
 * @param {object[]} members      reconcile gather output (memberEntryFor / gatherOverrideOnlyMembers)
 * @param {Map} identities        githubId -> { hash: string|null, reason }
 * @param {Set} suppressed        hashes carrying a `mail:suppress:<hash>` marker
 * @param {Set} enrolled          hashes that ALREADY have a `mail:subscriber:<hash>` record
 * @returns {object} the plan; `blocked` is true when the run cannot write anything at all
 */
export function planMailEnrollment({ members = [], identities = new Map(), suppressed = new Set(), enrolled = new Set() } = {}) {
  const plan = {
    enroll: [],
    alreadyEnrolled: [],
    suppressedSkips: [],
    unreachable: [],
    excludedBanned: [],
    blocked: false,
  };

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue; // not a membership customer; the gather already filters these, belt and braces

    // A ban is a community ban and it is the one exclusion that happens before anything else is considered.
    // A banned account gets ZERO KV by the standing tier ruling, and a digest subscription is KV.
    if (isBanned(m)) { plan.excludedBanned.push(who(m)); continue; }

    const ident = identities.get(githubId) ?? { hash: null, reason: IDENTITY_REASON.NO_EMAIL };

    // Recorded BEFORE the blocked check: a member with no address is unreachable whether or not a key is
    // configured, and the owner needs that list now rather than after provisioning.
    if (ident.reason === IDENTITY_REASON.NO_EMAIL) {
      plan.unreachable.push({ ...who(m), reason: 'no email address anywhere in the system' });
      continue;
    }

    if (ident.reason === IDENTITY_REASON.NO_KEY) {
      // MAIL_SUPPRESS_KEY is absent, so mailHash returns null and NO identity can be minted for anyone.
      // This is a property of the run, not of this member, so it stops the whole plan rather than
      // accumulating one indistinguishable "unreachable" row per member and looking like a data problem.
      plan.blocked = true;
      continue;
    }

    // Belt and braces: an identity map that omitted this member entirely, or handed back a blank hash under
    // an 'ok' reason, must still never become a subscriber record keyed on nothing.
    if (!ident.hash) { plan.unreachable.push({ ...who(m), reason: 'no email address anywhere in the system' }); continue; }

    // THE OPT-OUT RIDER, ENFORCED. Somebody who unsubscribed stays unsubscribed through a backfill.
    if (suppressed.has(ident.hash)) { plan.suppressedSkips.push({ ...who(m), hash: ident.hash }); continue; }

    // Idempotent: a second run of this backfill is a no-op rather than a rewrite, so re-running it after a
    // partial failure is safe and the counts stay meaningful.
    if (enrolled.has(ident.hash)) { plan.alreadyEnrolled.push({ ...who(m), hash: ident.hash }); continue; }

    plan.enroll.push({ ...who(m), hash: ident.hash });
  }

  return plan;
}

/**
 * Plan the follow backfill: the two house accounts into each member's `follows:<github_id>`.
 *
 * BACKFILL ONCE ONLY, NO AUTO-FOLLOW AT SIGNUP (owner, 2026-08-21, made against the router's recommendation
 * and recorded here so it is not "improved" later). The consequence is on the record: coverage decays from
 * the day this runs and nothing corrects it, because every member who joins afterwards has neither follow.
 *
 * A member who already follows a target keeps their existing entry untouched, including any `notify`
 * preference on it, since applyFollow is a no-op for a username already present.
 */
export function planFollowBackfill({ members = [], followsByGithubId = new Map(), targets = HOUSE_FOLLOW_TARGETS, now = Date.now } = {}) {
  const plan = { writes: [], alreadyComplete: [], excludedBanned: [], invalidTargets: [] };

  // Validate the targets ONCE, loudly, before touching anybody. A bad target here would be written to every
  // member in the population and yield nothing forever, which is the `gbti-labs` failure at full scale.
  const clean = [];
  for (const t of targets) {
    const u = normalizeUsername(t);
    if (!u) { plan.invalidTargets.push({ target: t, reason: 'not a valid username' }); continue; }
    clean.push(u);
  }
  if (plan.invalidTargets.length) return plan; // fail closed: plan nothing rather than plan something wrong

  for (const m of members) {
    const githubId = idOf(m);
    if (!githubId) continue;
    if (isBanned(m)) { plan.excludedBanned.push(who(m)); continue; }

    const before = normalizeFollows(followsByGithubId.get(githubId) ?? null);
    const have = new Set(followingUsernames(before));
    const add = clean.filter((u) => !have.has(u));
    if (!add.length) { plan.alreadyComplete.push(who(m)); continue; }

    let next = before;
    for (const username of add) next = applyFollow(next, { username, on: true }, { now });
    plan.writes.push({ ...who(m), add, next });
  }

  return plan;
}

/** Counts for the report header. Kept beside the planners so a new bucket cannot be forgotten in the tally. */
export function enrollmentCounts(mailPlan, followPlan) {
  return {
    toEnroll: mailPlan.enroll.length,
    alreadyEnrolled: mailPlan.alreadyEnrolled.length,
    suppressed: mailPlan.suppressedSkips.length,
    unreachable: mailPlan.unreachable.length,
    excludedBanned: mailPlan.excludedBanned.length,
    followWrites: followPlan.writes.length,
    followAlreadyComplete: followPlan.alreadyComplete.length,
  };
}
