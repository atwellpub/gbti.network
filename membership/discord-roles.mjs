// sow-218: which managed Discord role an effective membership status should hold. Node-free and
// dependency-free, because BOTH the reconcile script and the signup Worker need it and they had no shared
// place to read it from.
//
// WHY THIS FILE EXISTS. The rule lived only in scripts/lib/reconcile-plan.mjs, which the Worker cannot import
// (it reaches membership/overrides.mjs, which touches the filesystem). So the Worker did not consult the rule
// at all: workers/signup/signup.mjs assigned ONE hardcoded role to every member who linked Discord, and
// reconcile silently corrected it on the next daily run.
//
// That is exactly the drift the `9363229` change tried to close and made worse. It swapped signup's hardcoded
// trial role for a hardcoded LOCKED role, which is right for a fresh free signup and wrong for everyone else:
// a paying subscriber, any grandfathered member, a superadmin, and a Codeable coupon invitee all linked
// Discord and were handed Locked. Since a coupon grant is folded into house/grandfathered.yml AFTER roles are
// computed in the same reconcile run, an invitee waited up to two daily cycles to be corrected.
//
// A hardcoded role at one call site can only ever be right for one kind of member. Sharing the rule is the fix;
// keeping the ORDER in one place is the point, exactly as membership/tiers.mjs owns the tier ordering.

/** Effective statuses that hold the full member role (community access). */
export const PUBLISHED_STATUSES = new Set(['paid']);

/** Effective statuses that hold the read-only trial role. The 90-day trial is retired (2026-08-11) and no NEW
 *  account can reach `trialing`, but existing trials run to term, so this stays until that population drains. */
export const TRIAL_STATUSES = new Set(['trialing']);

/**
 * Map an effective membership status to its managed Discord role: 'member' | 'trial' | 'locked'.
 *
 * Fail closed by construction: anything unrecognized, absent, or malformed falls to `locked`, which grants
 * nothing. That matters more than it looks, because this guild is ALLOW-based. Verified 2026-08-11 across 157
 * channels: the Locked role denies VIEW_CHANNEL nowhere, and the member role allows it on 12 channels. So
 * access is removed by LOSING the member role rather than by gaining a deny, and returning `locked` for an
 * unknown status withholds the grant rather than relying on an overwrite that does not exist.
 */
export function discordRoleTarget(effectiveStatus) {
  if (PUBLISHED_STATUSES.has(effectiveStatus)) return 'member';
  if (TRIAL_STATUSES.has(effectiveStatus)) return 'trial';
  return 'locked';
}

/**
 * The three EXCLUSIVE access roles. A member holds exactly one; assigning a target means REMOVING the others.
 *
 * Signup used to only ever ADD, which is how the test account ended up holding Applicant AND Locked at the same
 * time: the trial role from its original signup, plus Locked from a later Discord link, with nothing removing
 * the first. Only the daily reconcile swapped, so any account that linked Discord more than once accumulated
 * roles until the next run. Adding without removing is not idempotent, it is additive.
 */
export const MANAGED_ACCESS_ROLES = ['member', 'trial', 'locked'];

/**
 * sow-185: the stackable Content Creator BADGE, a separate axis from the access role above. A Content Creator
 * holds member AND creator; a Network Member holds member alone. Deliberately NOT in MANAGED_ACCESS_ROLES, so
 * the exclusive access swap never strips it.
 */
export const CREATOR_ROLE = 'creator';

/** True when an effective TIER should hold the stackable Creator badge. Absent or unknown tier -> false. */
export function discordCreatorTarget(tier) {
  return tier === 'creator';
}
