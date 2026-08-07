// SOW-005 reconcile: PURE planning. No I/O, no clients, no dates from the wall clock except the
// injected `now`. planReconcile turns the current Stripe-derived + git-native state plus the local
// content index into an ordered list of actions. scripts/reconcile.mjs enacts them via the GitHub,
// Discord, and email clients (unless --dry-run).
//
// Fail closed everywhere: a member with an unknown or error status is treated as NOT paid, so their
// published content is flipped to draft. We never default-open.
//
// Idempotency is the core contract: an action is only emitted when the desired state does NOT already
// hold. Running the plan against an already-correct repo + role set yields an empty action list.
//
// Effective-status precedence (from membership/overrides.mjs effectiveStatus): ban > staff >
// grandfather > Stripe. We re-read effective.status here rather than re-deriving, so the two cannot diverge.

import { ROLE } from '../../membership/overrides.mjs';
import { TRIAL_DAYS } from '../../membership/derive-status.mjs';
import { TIER } from '../../membership/tiers.mjs'; // sow-185: the paid tier axis (for the Content-Creator Discord badge)

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAY = 87; // day-87 trial reminder window opens here and closes at TRIAL_DAYS (90)
const COUPON_REMINDER_DAYS = 14; // SOW-119: the coupon-expiry reminder window opens 14 days before `until`

// Which effective statuses keep a member's content published (and grant the full member Discord role).
// A grandfather grant resolves to effective.status === 'paid' (source 'grandfather'), so it is covered.
const PUBLISHED_STATUSES = new Set(['paid']);
// Which effective statuses grant the trial (not full member) Discord role.
const TRIAL_STATUSES = new Set(['trialing']);

// The three managed Discord roles. A known member holds EXACTLY ONE of these at a time; the reconcile
// swaps between them and never kicks, so a lapsed or banned account is locked out (the Locked role's
// channel overwrites, owner-configured) while staying in the guild (SOW-011).
export const MANAGED_DISCORD_ROLES = ['member', 'trial', 'locked'];

/**
 * Discord role target for an effective status. Every known member maps to EXACTLY ONE managed role.
 *   paid / grandfather                  -> 'member'
 *   trialing                            -> 'trial'
 *   banned / expired / cancelled / none -> 'locked' (locked out of the channels, NOT kicked)
 * Returns one of 'member' | 'trial' | 'locked'.
 */
export function discordRoleTarget(effectiveStatus) {
  if (PUBLISHED_STATUSES.has(effectiveStatus)) return 'member';
  if (TRIAL_STATUSES.has(effectiveStatus)) return 'trial';
  return 'locked';
}

// sow-185: the Content-Creator Discord badge is a SEPARATE, STACKABLE axis from the exclusive access role above.
// A Content Creator holds @Member (access) AND @Creator (badge); a Network Member holds @Member only. It is kept
// OUT of MANAGED_DISCORD_ROLES so the exclusive access swap never strips it. Inert until DISCORD_CREATOR_ROLE_ID
// is provisioned (an unset id is a no-op in enactDiscord).
export const CREATOR_DISCORD_ROLE = 'creator';

/** True when an effective TIER should hold the stackable @Creator badge (Content Creator only). */
export function discordCreatorTarget(tier) {
  return tier === TIER.creator;
}

/** True when this effective status means the member's public content should be published. */
function shouldBePublished(effectiveStatus) {
  return PUBLISHED_STATUSES.has(effectiveStatus);
}

/**
 * Compute the day-87 reminder eligibility for a trial member.
 * Eligible when trial_started_at + 87d <= now < trial_started_at + 90d AND the member has not
 * converted to a paid subscription. Returns false on a missing or unparseable start date (fail closed
 * means we simply do not nag, which is the safe direction for a reminder).
 */
function inReminderWindow(trialStartedAt, converted, now) {
  if (converted) return false;
  if (!trialStartedAt) return false;
  const started = new Date(trialStartedAt);
  if (Number.isNaN(started.getTime())) return false;
  const windowOpen = started.getTime() + REMINDER_DAY * DAY_MS;
  const windowClose = started.getTime() + TRIAL_DAYS * DAY_MS;
  const t = now.getTime();
  return t >= windowOpen && t < windowClose;
}

/**
 * The files for a member that are currently published but should be drafted (lapse / cancel / ban),
 * in stable path order. repoEntry is { files: [{ path, status, visibility }] } or undefined.
 */
function filesToDraft(repoEntry) {
  if (!repoEntry?.files) return [];
  return repoEntry.files
    .filter((f) => f.status === 'published')
    .map((f) => f.path)
    .sort();
}

/**
 * The files for a member that are currently draft but should be published (resubscribe / grandfather),
 * in stable path order.
 */
function filesToPublish(repoEntry) {
  if (!repoEntry?.files) return [];
  return repoEntry.files
    .filter((f) => f.status === 'draft')
    .map((f) => f.path)
    .sort();
}

/**
 * Pure reconcile planner.
 *
 * @param {object}  args
 * @param {Array}   args.members      one entry per Stripe Customer we know about:
 *   {
 *     githubId:       string,            // immutable primary key
 *     githubLogin?:   string,            // for log lines only
 *     discordUserId?: string|null,       // for role sync + reminder DM
 *     email?:         string|null,       // for the day-87 email reminder
 *     username?:      string|null,       // owned folder (members-index), null if none
 *     derived:        string,            // deriveStatusFromCustomer result (informational)
 *     effective:      { status, source },// effectiveStatus result (the authority)
 *     discordRoles?:  Array<'member'|'trial'|'locked'>, // the managed roles the member currently holds
 *     trialStartedAt?: string|null,      // metadata.trial_started_at
 *     converted?:     boolean,           // has a paid/active subscription (skip the reminder)
 *   }
 * @param {object}  args.repoIndex    map username -> { files: [{ path, status, visibility }] }
 * @param {Date}    [args.now]
 * @returns {Array} ordered actions. Action shapes:
 *   { kind:'content', type:'draft'|'publish', githubId, username, files:[...] }
 *   { kind:'discord', type:'add-role'|'remove-role', githubId, discordUserId, role:'member'|'trial'|'locked' }
 *   { kind:'reminder', type:'day-87', githubId, email, discordUserId }
 *   { kind:'block', githubId, username }   // informational: a ban deplatforms; content draft + the
 *                                          // Locked-role swap are emitted as their own actions above it.
 */
export function planReconcile({ members = [], repoIndex = {}, now = new Date(), creatorRoleEnabled = false } = {}) {
  const actions = [];

  for (const m of members) {
    const githubId = String(m.githubId);
    const username = m.username ?? null;
    const status = m.effective?.status ?? 'none';
    const repoEntry = username ? repoIndex[username] : undefined;
    const banned = status === 'banned';

    // 1. Content: bring the published/draft state of this member's files in line with effective status.
    //    FAIL CLOSED: a member who must be deplatformed (banned) or un-published (lapsed) but whose folder
    //    cannot be resolved gets an `unresolved` action instead of a silent no-op, so the reconcile surfaces
    //    it (and exits non-zero on a banned one) rather than leaving their content live.
    if (banned) {
      if (!username) {
        actions.push({ kind: 'unresolved', githubId, status, reason: 'banned member has no resolvable folder; ban cannot be enforced' });
      } else {
        const files = filesToDraft(repoEntry); // ban overrides paid AND grandfather: drafted, never published
        if (files.length) actions.push({ kind: 'content', type: 'draft', githubId, username, files });
      }
    } else if (shouldBePublished(status)) {
      // Paid or grandfathered: any drafted file should be (re)published. Already-published files are skipped.
      const files = filesToPublish(repoEntry);
      if (files.length) {
        actions.push({ kind: 'content', type: 'publish', githubId, username, files });
      }
    } else if (!username && (status === 'cancelled' || status === 'expired')) {
      // A lapsed member who likely HAD published content but whose folder cannot be resolved.
      actions.push({ kind: 'unresolved', githubId, status, reason: 'lapsed member has no resolvable folder; content cannot be drafted' });
    } else {
      // Lapsed / cancelled / expired / trialing / none with a resolvable folder: draft anything live.
      const files = filesToDraft(repoEntry);
      if (files.length) {
        actions.push({ kind: 'content', type: 'draft', githubId, username, files });
      }
    }

    // 2. Discord role sync: a known member holds EXACTLY ONE of the three managed roles. Add the target
    //    for their effective status, then remove any OTHER managed role they still hold (so a stray left
    //    by a prior partial run self-heals). Banned -> 'locked' (locked out, NOT kicked). Idempotent:
    //    when they already hold exactly the target, no action is emitted. The reconcile only assigns
    //    roles; the Locked role's owner-configured channel overwrites enforce the actual lockout.
    if (m.discordUserId) {
      // Access role: EXACTLY ONE of member/trial/locked (the exclusive swap; unchanged).
      const target = discordRoleTarget(status); // 'member' | 'trial' | 'locked'
      const held = new Set((Array.isArray(m.discordRoles) ? m.discordRoles : []).filter((r) => MANAGED_DISCORD_ROLES.includes(r)));
      if (!held.has(target)) {
        actions.push({ kind: 'discord', type: 'add-role', githubId, discordUserId: m.discordUserId, role: target });
      }
      for (const role of MANAGED_DISCORD_ROLES) {
        if (role !== target && held.has(role)) {
          actions.push({ kind: 'discord', type: 'remove-role', githubId, discordUserId: m.discordUserId, role });
        }
      }
      // sow-185: the Content-Creator badge is an INDEPENDENT, stackable axis (a creator holds member + creator).
      // Add it for a creator-tier account, remove it otherwise. It is NEVER touched by the access swap above (it
      // is not in MANAGED_DISCORD_ROLES). Gated on creatorRoleEnabled (reconcile passes !!DISCORD_CREATOR_ROLE_ID):
      // until the owner provisions the role, the axis emits NOTHING, so the plan stays idempotent (pre-provision
      // EVERY paid member resolves to creator via the inert price map, which would otherwise flood the plan with
      // no-op adds). m.tier absent -> discordCreatorTarget false -> no badge, the safe direction.
      if (creatorRoleEnabled) {
        const wantsCreator = discordCreatorTarget(m.tier);
        const hasCreator = (Array.isArray(m.discordRoles) ? m.discordRoles : []).includes(CREATOR_DISCORD_ROLE);
        if (wantsCreator && !hasCreator) {
          actions.push({ kind: 'discord', type: 'add-role', githubId, discordUserId: m.discordUserId, role: CREATOR_DISCORD_ROLE });
        } else if (!wantsCreator && hasCreator) {
          actions.push({ kind: 'discord', type: 'remove-role', githubId, discordUserId: m.discordUserId, role: CREATOR_DISCORD_ROLE });
        }
      }
    }

    // 3. Day-87 reminder: trial member inside the [87d, 90d) window who has not converted. Gated on the
    //    EFFECTIVE status actually being a trial (SOW-142): a member who is effective-paid another way
    //    (grandfather, staff, a coupon free year) has a Stripe trial customer too, and without this gate
    //    they would get a bogus "trial ending" nag at day 87 of an entitlement that does not end then.
    if (!banned && TRIAL_STATUSES.has(status) && inReminderWindow(m.trialStartedAt, m.converted, now)) {
      actions.push({ kind: 'reminder', type: 'day-87', githubId, email: m.email ?? null, discordUserId: m.discordUserId ?? null });
    }

    // 3b. SOW-119 coupon-expiry reminder: a coupon grant inside its final COUPON_REMINDER_DAYS window and
    //     not converted. `couponGrant` is populated by the caller from the grandfather entry when the
    //     reason carries the coupon: prefix. Same safe direction as day-87: any doubt means no nag.
    if (!banned && !m.converted && m.couponGrant?.until) {
      const until = new Date(m.couponGrant.until);
      if (!Number.isNaN(until.getTime())) {
        const windowOpen = until.getTime() - COUPON_REMINDER_DAYS * DAY_MS;
        if (now.getTime() >= windowOpen && now.getTime() < until.getTime()) {
          actions.push({
            kind: 'reminder',
            type: 'coupon-expiry',
            githubId,
            email: m.email ?? null,
            discordUserId: m.discordUserId ?? null,
            until: until.toISOString(),
            code: m.couponGrant.code ?? null,
          });
        }
      }
    }

    // 4. Block marker: a ban is a hard deplatform. Emit it after the draft + role-removal actions so an
    //    enactor can log the deplatform once the content and roles are handled.
    if (banned) {
      actions.push({ kind: 'block', githubId, username });
    }
  }

  return actions;
}

export { ROLE, REMINDER_DAY, COUPON_REMINDER_DAYS };
