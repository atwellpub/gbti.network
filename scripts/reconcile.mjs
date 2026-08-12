#!/usr/bin/env node
// SOW-005 reconciliation script. Brings the published-content state + Discord roles in line with the
// Stripe registry plus git-native overrides (bans, grandfather). Runs locally (owner runs --dry-run
// first, then --apply) and on a daily schedule (.github/workflows/reconcile.yml runs it with --apply).
//
//   node scripts/reconcile.mjs            # DRY RUN by default: prints the plan, changes nothing
//   node scripts/reconcile.mjs --apply    # enacts the plan via the GitHub / Discord clients
//   node scripts/reconcile.mjs --dry-run  # explicit dry run
//
// Design: all decision logic is the PURE planReconcile (scripts/lib/reconcile-plan.mjs). This file is
// the thin I/O shell: build clients, gather inputs (Stripe customers + local content index +
// overrides), call the planner, then (unless dry-run) enact each action. Idempotent: re-running after
// a successful apply yields an empty plan.
//
// Fail closed: deriveStatusFromCustomer + effectiveStatus already treat any missing or error state as
// NOT paid. sow-197 narrowed what that costs: a lapse moves the member to the Locked Discord role and
// leaves their published work alone. Only a BAN drafts content, and only ever toward draft, never back.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

import { createStripeClient } from '../clients/stripe.mjs';
import { createGitHubClient } from '../clients/github.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { createResendClient } from '../clients/resend.mjs';
import { deriveStatusFromCustomer, deriveMembershipFromCustomer, STATUS } from '../membership/derive-status.mjs';
import { loadOverrides, loadOverridesRaw, effectiveStatus, roleOf, ROLE } from '../membership/overrides.mjs';
import { buildEnvPriceTierMap, resolveEffectiveTier } from '../membership/tier-gate.mjs'; // sow-185: price map + override-aware tier
import { buildRepoIndex } from './lib/repo-content.mjs';
import { planReconcile } from './lib/reconcile-plan.mjs';
import { buildOverridesMirror, mirrorOverridesToKv, mirrorSyndicationConfigToKv, mirrorContentChannelsToKv, mirrorTopicsToKv, mirrorCouponsToKv } from './lib/kv-mirror.mjs';
import { syncFavoriteCounts, readCountsFromDisk, readFavoritedByFromDisk, readMembersIndexFromDisk } from './lib/favorite-counts.mjs';
import { syncCouponGrants, readGrandfatheredFromDisk, readCouponsFromDisk, listCouponRedemptions, planCouponGrants } from './lib/coupon-grants.mjs'; // SOW-119 (+ sow-218: pre-apply, sow-185: explicit tier)
import { syncEnrollments } from './lib/enroll-members.mjs'; // SOW-157: hosted-member index enrollment
import { syncUpvoteCounts, readCountsFromDisk as readUpvoteCountsFromDisk } from './lib/upvote-counts.mjs';
import { main as promotePopular } from './promote-popular.mjs'; // SOW-126: the engagement-triggered popular promoter
import { mergeState, alreadyLabeled, conflictComment, CONFLICT_LABEL, isStuckAutomergeBot } from './lib/pr-conflict.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

/** Parse argv into { apply } where dry-run is the default unless --apply is given. */
export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run') || !apply; // default to dry-run
  return { apply: apply && !argv.includes('--dry-run'), dryRun };
}

/** Has this customer converted to a paid (active/past_due) subscription? Used to skip the day-87 reminder. */
function isConverted(customer) {
  const derived = deriveStatusFromCustomer(customer);
  return derived === STATUS.paid;
}

/**
 * Resolve the on-disk folder (username) a Stripe customer owns. Authoritative and fail-closed.
 * Resolution order:
 *   1. overrides.membersIndex.get(githubId)         (the M0 authoritative github_id -> folder map)
 *   2. repoIndex.byGithubId.get(githubId)           (profile.md carries a github_id, when present)
 *   3. repoIndex.byGithubLogin.get(login.toLowerCase()) (profile links.github URL trailing segment)
 *   4. a case-insensitive match of github_login against the folder (byUsername) keys
 * Returns the username string, or null when nothing resolves.
 *
 * This exists because a Stripe metadata.github_login does NOT always equal the on-disk folder name.
 * Confirmed in real data: folder 'hudson' has links.github https://github.com/atwellpub, so the login
 * is 'atwellpub' and a plain login -> folder lookup misses. Steps 1 to 3 close that hole. Since sow-197
 * the stake is BAN enforcement rather than lapse enforcement: an unresolvable banned member would leave
 * their content live, which is the fail-OPEN case the planner now reports as `unresolved`.
 */
export function resolveUsername(githubId, githubLogin, overrides, repoIndex) {
  const id = String(githubId ?? '');
  const fromIndex = overrides?.membersIndex?.get(id);
  if (fromIndex) return fromIndex;

  const byGithubId = repoIndex?.byGithubId;
  if (byGithubId && byGithubId.get(id)) return byGithubId.get(id);

  const login = githubLogin ? String(githubLogin).toLowerCase() : null;
  const byGithubLogin = repoIndex?.byGithubLogin;
  if (login && byGithubLogin && byGithubLogin.get(login)) return byGithubLogin.get(login);

  const byUsername = repoIndex?.byUsername;
  if (login && byUsername) {
    for (const folder of Object.keys(byUsername)) {
      if (folder.toLowerCase() === login) return folder;
    }
  }
  return null;
}

/**
 * Turn one Stripe Customer plus overrides into a member entry for the planner. Pure given `now`.
 * `repoIndex` (from buildRepoIndex) is used to resolve the owned folder authoritatively. discordRoles is
 * passed in by gatherMembers (the set of managed roles the member currently holds, from Discord
 * getMember); it defaults to empty so the planner stays idempotent when the Discord client is absent.
 */
export function memberEntryFor(customer, overrides, now, { repoIndex = null, discordRoles = [], priceTierMap = null } = {}) {
  const meta = customer.metadata ?? {};
  const githubId = String(meta.github_id ?? '');
  const githubLogin = meta.github_login ?? null;
  const derived = deriveStatusFromCustomer(customer, now);
  const effective = effectiveStatus(githubId, derived, overrides, now);
  // sow-185: resolve the effective TIER (override-aware) for the Content-Creator Discord badge. stripeTier comes
  // from the subscription's price id; the override source wins (staff/grandfather -> creator). INERT until the
  // price env is mapped. With no price env the map is empty and tierForPrice now fails closed to `none`
  // (2026-08-11); nothing consumes this tier unless shouldSyncCreatorRole is true, which needs that same env.
  const stripeTier = deriveMembershipFromCustomer(customer, { priceTierMap, now }).tier;
  const tier = resolveEffectiveTier({ source: effective.source, status: effective.status, stripeTier, grant: overrides.grandfathers.get(githubId) });
  const username = resolveUsername(githubId, githubLogin, overrides, repoIndex);
  return {
    githubId,
    githubLogin,
    discordUserId: meta.discord_user_id ?? null,
    email: customer.email ?? null,
    username,
    derived,
    effective,
    tier, // sow-185: the effective paid tier (drives the Content-Creator Discord badge)
    role: roleOf(githubId, overrides.roles),
    trialStartedAt: meta.trial_started_at ?? null,
    converted: isConverted(customer),
    discordRoles,
    couponGrant: couponGrantFor(githubId, overrides), // SOW-119: feeds the coupon-expiry reminder
  };
}

/** SOW-119: extract a coupon grant ({ code, until }) from the member's grandfather entry, if any. */
export function couponGrantFor(githubId, overrides) {
  const entry = overrides?.grandfathers?.get?.(String(githubId));
  const reason = String(entry?.reason ?? '');
  if (!entry || !entry.until || !reason.startsWith('coupon:')) return null;
  return { code: reason.slice('coupon:'.length), until: entry.until };
}

/** Base64 a string for the GitHub Contents API putContent({ content }). */
function toBase64(str) {
  return Buffer.from(str, 'utf8').toString('base64');
}

/**
 * Flip the `status:` frontmatter line of a content file between published and draft, returning the new
 * text. Reuses the same line shape as scripts/validate-content.mjs. If the line is missing we leave the
 * file untouched (the planner should not have selected it, but we stay safe).
 */
export function flipStatus(text, to) {
  // [ \t]* (not \s*) so the trailing newline is preserved; \s would eat the line break.
  return text.replace(/^(status:[ \t]*)"?(published|draft)"?[ \t]*$/m, `$1${to}`);
}

/**
 * A branch name for a content flip PR (one per member per run kind). The timestamp has 1-second
 * resolution, so a same-second re-run would collide and createRef would 422. A short random suffix
 * keeps the branch unique across re-runs.
 */
function flipBranch(kind, githubId) {
  const stamp = new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14);
  const suffix = crypto.randomUUID().slice(0, 8);
  return `reconcile/${kind}-${githubId}-${stamp}-${suffix}`;
}

/**
 * Enact a single content action as ONE auto-merged PR that flips every selected file's `status`. The bot
 * is listed as admin in roles.yml, so the PR-gate passes it (it never runs PR code; this is a base-branch
 * metadata-only gate). We open the PR off a fresh branch, commit each file flip, then squash-merge.
 *
 * sow-197: `draft` is the ONLY content action, and this shell refuses anything else rather than defaulting
 * to publish. The planner no longer emits a publish action; this makes the enactment side incapable of
 * resurrecting one, so a future planner bug cannot quietly push a member's unfinished draft live again.
 */
async function enactContent(github, action, { base = 'main' } = {}) {
  if (action.type !== 'draft') {
    throw new Error(`reconcile: refusing content action '${action.type}': only 'draft' (ban enforcement) is permitted`);
  }
  const to = 'draft';
  const branch = flipBranch(action.type, action.githubId);

  // 1. Branch off the base head.
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`reconcile: cannot resolve base head sha for ${base}`);
  await github.createRef(branch, baseSha);

  // 2. Flip each file on the new branch.
  for (const filePath of action.files) {
    const existing = await github.getContent(filePath, branch);
    const sha = existing?.sha;
    const current = existing?.content ? Buffer.from(existing.content, 'base64').toString('utf8') : '';
    const next = flipStatus(current, to);
    if (next === current) continue; // already in the desired state: skip (idempotent)
    await github.putContent(filePath, {
      message: `reconcile: ${action.type} ${filePath} (membership state)`,
      content: toBase64(next),
      branch,
      sha,
    });
  }

  // 3. Open + squash-merge the PR. The gate passes the admin bot, so this auto-merges.
  const pull = await github.createPull({
    title: `reconcile: Disable ${action.username ?? action.githubId} content (ban)`,
    head: branch,
    base,
    body:
      `Automated ban enforcement. Flips status -> draft for ${action.files.length} file(s) ` +
      `owned by github_id ${action.githubId}. Never deletes content; lifting the ban does not ` +
      `re-publish automatically, the author republishes their own work.`,
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return pull.number;
}

/** Discord role id lookup from env for a planner role name. */
function discordRoleId(role, env) {
  if (role === 'member') return env.DISCORD_MEMBER_ROLE_ID;
  if (role === 'trial') return env.DISCORD_TRIAL_ROLE_ID;
  if (role === 'locked') return env.DISCORD_LOCKED_ROLE_ID;
  if (role === 'creator') return env.DISCORD_CREATOR_ROLE_ID; // sow-185: the stackable Content-Creator badge (unset -> enactDiscord skips)
  return null;
}

/**
 * Parse the optional DISCORD_MENTION_OVERRIDES env JSON ({ "<login>": "<discord_user_id>", ... }) into a
 * lowercased-login -> discord_user_id Map. This is the SAME map the content-syndication workflow uses to
 * resolve a content author's Discord mention; reconcile reuses it to find the discord_user_id of a
 * grandfathered/banned member who has NO Stripe customer, so it can still sync their managed Discord role.
 * discord_user_id is kept OUT of the public repo, so this rides a GitHub Actions secret, never a committed
 * file. Returns an empty Map on absent or invalid JSON (best-effort; never throws).
 */
export function parseDiscordUserMap(env = {}) {
  const map = new Map();
  const raw = env.DISCORD_MENTION_OVERRIDES;
  if (!raw) return map;
  let obj;
  try { obj = JSON.parse(raw); } catch { return map; }
  if (!obj || typeof obj !== 'object') return map;
  for (const [login, id] of Object.entries(obj)) {
    if (login && id) map.set(String(login).toLowerCase(), String(id));
  }
  return map;
}

/** Enact a single Discord role action. */
async function enactDiscord(discord, action, env) {
  const guildId = env.DISCORD_GUILD_ID;
  const roleId = discordRoleId(action.role, env);
  if (!guildId || !roleId) return; // missing config: skip rather than throw on a partial run
  try {
    if (action.type === 'add-role') await discord.addRole(guildId, action.discordUserId, roleId);
    else await discord.removeRole(guildId, action.discordUserId, roleId);
  } catch (e) {
    // Best-effort: a role op fails when the member is not in the guild (a grandfathered co-op member who
    // was granted access but never joined Discord) or on a transient Discord error. Log and continue so one
    // bad role op does not abort the rest of the run (content flips, the KV mirror, other members' roles).
    console.warn(
      `reconcile: WARNING Discord ${action.type} role=${action.role} for ${action.discordUserId} failed: ${e?.message ?? e}`,
    );
  }
}

/**
 * Enact a day-87 reminder. Email (Resend) is the PRIMARY channel because Discord server-member DMs
 * are widely disabled by default and would silently vanish (see membership-and-access.md section 0).
 * The Discord DM is an optional secondary nudge. Email is attempted first when a Resend client and a
 * recipient address exist.
 */
async function enactReminder(action, { resend, discord, env = {} } = {}) {
  // SOW-119: the coupon-expiry nudge reuses the same delivery (email primary, Discord DM secondary).
  const isCoupon = action.type === 'coupon-expiry';
  const untilDate = isCoupon && action.until ? action.until.slice(0, 10) : null;
  const body = isCoupon
    ? `Your complimentary GBTI Network membership ends on ${untilDate}. Add a membership to keep your ` +
      'profile, posts, products, and prompts published and to stay in the community. Visit your account ' +
      'to add a membership before it ends.'
    : 'Your GBTI Network trial ends in a few days. Add a membership to keep your profile, posts, ' +
      'products, and prompts published. Visit your account to add a membership before day 90.';
  const subject = isCoupon
    ? 'Your complimentary GBTI Network membership ends soon'
    : 'Your GBTI Network trial ends soon: add a membership to stay published';

  // PRIMARY: email via Resend when configured and the action carries a recipient address.
  if (resend && env.RESEND_FROM && action.email) {
    await resend.sendEmail({
      from: env.RESEND_FROM,
      to: action.email,
      subject,
      text: body,
    });
  }

  // SECONDARY (optional): a Discord DM nudge when we have a Discord user id.
  if (discord && action.discordUserId) {
    await discord.sendDirectMessage(action.discordUserId, body);
  }
}

/** Human-readable one-liner per action for the printed summary. */
function describe(action) {
  switch (action.kind) {
    case 'content':
      return `content  ${action.type.padEnd(8)} ${action.username ?? action.githubId}  (${action.files.length} file(s))`;
    case 'discord':
      return `discord  ${action.type.padEnd(8)} ${action.githubId}  role=${action.role}`;
    case 'reminder':
      return `reminder day-87    ${action.githubId}  email=${action.email ?? 'none'}`;
    case 'block':
      return `block    banned     ${action.username ?? action.githubId}`;
    case 'unresolved':
      return `UNRESOLVED ${String(action.status).padEnd(8)} ${action.githubId}  ${action.reason}`;
    default:
      return `unknown  ${JSON.stringify(action)}`;
  }
}

/** Build the clients from env. Returns { stripe, github, discord, resend }. */
export function buildClients(env, fetchImpl = globalThis.fetch) {
  const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
  const github = createGitHubClient({ token: env.GITHUB_BOT_TOKEN, repo: env.GITHUB_CONTENT_REPO, fetch: fetchImpl });
  const discord = env.DISCORD_BOT_TOKEN ? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl }) : null;
  const resend = env.RESEND_API_KEY ? createResendClient({ apiKey: env.RESEND_API_KEY, fetch: fetchImpl }) : null;
  return { stripe, github, discord, resend };
}

/**
 * SOW-053 Part B: sweep open PRs and surface true merge conflicts. Auto-merge stalls SILENTLY on a conflicting
 * member PR; this adds a `needs-rebase` label + a one-time @-mention comment telling the author to re-publish
 * (which reloads the fresh file + clears the conflict). Idempotent (skips an already-labeled PR) and fail-soft
 * (any GitHub error is swallowed so the conflict sweep never breaks the rest of reconcile). The list endpoint omits
 * mergeable_state, so each open PR is fetched once via getPull. Returns { surfaced, stuck }: `surfaced` = the
 * newly labeled+commented conflicts; `stuck` (SOW-152) = conflicting BOT superadmin-automerge PRs that the
 * auto-merge cannot land and the re-publish comment cannot fix (collected EVEN IF already needs-rebase-labeled,
 * so a persistently-stuck one stays visible in the summary instead of piling up silently).
 */
export async function surfaceConflicts({ github, dryRun = true } = {}) {
  const surfaced = [];
  const stuck = [];
  if (!github?.listOpenPulls) return { surfaced, stuck };
  let open;
  try { open = await github.listOpenPulls(); } catch { return { surfaced, stuck }; }
  for (const p of open || []) {
    let pull;
    try { pull = await github.getPull(p.number); } catch { continue; } // mergeable_state only on the single-PR GET
    if (mergeState(pull) !== 'conflicting') continue;
    const login = pull.user?.login || p.user?.login || '';
    // SOW-152: surface a stuck bot auto-merge PR distinctly, before the already-labeled skip, so it stays visible.
    if (isStuckAutomergeBot(pull)) stuck.push({ number: pull.number, login });
    if (alreadyLabeled(pull)) continue;
    surfaced.push({ number: pull.number, login });
    if (dryRun) continue;
    try {
      await github.addLabels(pull.number, [CONFLICT_LABEL]);
      await github.comment(pull.number, conflictComment(login));
    } catch (e) {
      console.error(`reconcile: WARNING could not surface conflict on PR #${pull.number}: ${e?.message ?? e}`);
    }
  }
  return { surfaced, stuck };
}

/**
 * Resolve the SET of managed Discord roles a member CURRENTLY holds (a subset of 'member' | 'trial' |
 * 'locked' | 'creator') from their live guild member record. The planner reconciles the exclusive ACCESS
 * role (member/trial/locked) to exactly one, removing any stray, AND independently syncs the stackable
 * 'creator' badge (sow-185). Best-effort: any getMember error (including a missing member) returns [] so the
 * planner treats the member as holding no managed role and simply adds the target(s).
 */
export async function resolveDiscordRoles(discord, guildId, discordUserId, env) {
  if (!discord || !guildId || !discordUserId) return [];
  let member;
  try {
    member = await discord.getMember(guildId, discordUserId);
  } catch {
    // sow-218: NULL, not []. These are different facts and returning [] for both was a fail-open: the plan
    // only emits a remove-role for a role it can SEE held, so "unknown" read as "holds nothing" and a lapsed
    // member kept @Member (the role that actually grants access) through any transient Discord error.
    // planReconcile treats null as "assume anything" and strips every non-target role.
    //
    // ONLY this path. A 404 is handled below and is a different fact.
    return null;
  }
  // A null member is the 404 path, which clients/discord.mjs maps explicitly (`getMember`, :38). That is
  // KNOWN, not unknown: they are not in the guild, so they hold nothing. Returning null here instead would
  // make the planner emit three doomed role calls for every member who left or has a stale discord_user_id,
  // which is noise, not safety. Verified against a dry run: treating 404 as unknown took the plan from 3
  // actions to 15, all of them destined to fail.
  if (!member) return [];
  const roleIds = new Set((member.roles ?? []).map(String));
  const held = [];
  if (env.DISCORD_MEMBER_ROLE_ID && roleIds.has(String(env.DISCORD_MEMBER_ROLE_ID))) held.push('member');
  if (env.DISCORD_TRIAL_ROLE_ID && roleIds.has(String(env.DISCORD_TRIAL_ROLE_ID))) held.push('trial');
  if (env.DISCORD_LOCKED_ROLE_ID && roleIds.has(String(env.DISCORD_LOCKED_ROLE_ID))) held.push('locked');
  if (env.DISCORD_CREATOR_ROLE_ID && roleIds.has(String(env.DISCORD_CREATOR_ROLE_ID))) held.push('creator'); // sow-185: the stackable badge
  return held;
}

/**
 * Gather every member entry by iterating the CONSISTENT Stripe customer list (not Search). Threads
 * the repoIndex (authoritative folder resolution) and the Discord client + env (the set of managed
 * roles each member currently holds) into each entry. A non-paid/non-grandfathered member whose
 * folder does NOT resolve is logged as a WARNING so the owner can add them to members-index.yml (we
 * never silently skip a lapse).
 */
/**
 * sow-185: whether reconcile should sync the Content-Creator Discord badge this run. BOTH conditions are
 * required: (1) the owner has provisioned DISCORD_CREATOR_ROLE_ID, and (2) reconcile's env actually carries a
 * Stripe price map (buildEnvPriceTierMap non-empty). Condition 2 remains load-bearing even after tierForPrice
 * was made fail-closed (2026-08-11): an empty map now resolves every Stripe tier to `none` rather than to
 * creator, so the badge would not flood, but a GRANDFATHER grant still resolves to creator via grantTier
 * regardless of the price map. Enabling the badge on the role id alone would therefore still stamp @Creator on
 * all 16 grandfathered members in the live guild. Tying it to a populated price map keeps the badge inert until the
 * prices are wired into reconcile's env, so the role id can be committed now and stays correctly dormant until
 * then. reconcile.yml passes no price env today, so this is false in production until that changes. Pure.
 */
export function shouldSyncCreatorRole(env = {}) {
  return !!env.DISCORD_CREATOR_ROLE_ID && buildEnvPriceTierMap(env).size > 0;
}

export async function gatherMembers(stripe, overrides, now, { repoIndex = null, discord = null, env = {} } = {}) {
  const members = [];
  const guildId = env.DISCORD_GUILD_ID ?? null;
  const priceTierMap = buildEnvPriceTierMap(env); // sow-185: built once; INERT (legacy $150 -> creator) until the $5 price is mapped
  for await (const customer of stripe.listCustomers()) {
    const meta = customer.metadata ?? {};
    if (!meta.github_id) continue; // not a membership customer
    const githubId = String(meta.github_id);
    const discordRoles = await resolveDiscordRoles(discord, guildId, meta.discord_user_id ?? null, env);
    const entry = memberEntryFor(customer, overrides, now, { repoIndex, discordRoles, priceTierMap });

    // NO "unresolved folder" WARNING HERE, deliberately. Removed 2026-08-11; do not re-add it.
    //
    // It used to fire for any member who was not effectively paid and had no resolvable folder, on the
    // rationale that "their content cannot be drafted on lapse". SOW-197 removed that behaviour: a lapse no
    // longer touches content in either direction, so the reason the warning existed is gone.
    //
    // What remained was a false positive that grew with every signup. Publishing is paid-only and a folder
    // is minted only at publish (enrollmentCandidates enrolls PAID members exclusively), so every free or
    // trial member who never published has no folder BY DESIGN and tripped it. Worse, the remediation it
    // printed, "add a members-index.yml entry", contradicts that rule: hand-adding a non-paid member is not
    // something the system would ever do for itself. It produced owner to-do items that could not be
    // correctly actioned, and two of them were carried across three band compactions before anyone checked
    // the premise.
    //
    // The case that genuinely still matters, a BANNED member whose folder cannot be resolved so the ban
    // cannot be enforced, is covered strictly better in scripts/lib/reconcile-plan.mjs by the `unresolved`
    // action: it surfaces the member AND exits non-zero, where this only printed to stderr.
    members.push(entry);
  }
  return members;
}

/**
 * Gather member entries for grandfathered / banned github_ids that have NO Stripe customer, so their
 * managed Discord role is still synced. gatherMembers iterates Stripe customers only, so a complimentary
 * co-op member granted access who never ran the paid signup (no Stripe customer) would otherwise never be
 * enumerated, and their Member role never assigned. `seen` is the set of github_ids already produced from
 * Stripe (skip those: their Stripe metadata is authoritative for trial/discord ids). discord_user_id is
 * resolved from the DISCORD_MENTION_OVERRIDES login->id map (kept out of the public repo). A member whose
 * discord_user_id does not resolve still yields an entry (so a later content reconcile can find their
 * folder), but with no discordUserId the planner emits no Discord action for them. Effective status comes
 * from the overrides alone (derived 'none', no Stripe): grandfather -> paid -> Member role; ban -> Locked.
 */
export async function gatherOverrideOnlyMembers(overrides, now, { seen = new Set(), repoIndex = null, discord = null, env = {} } = {}) {
  const members = [];
  const userMap = parseDiscordUserMap(env);
  const guildId = env.DISCORD_GUILD_ID ?? null;
  // grandfathered + banned entries each carry { github_id, login }. bans first so a banned id wins the
  // dedupe over a (contradictory) grandfather listing of the same id; effectiveStatus enforces ban anyway.
  const entries = [...(overrides?.bans?.values?.() ?? []), ...(overrides?.grandfathers?.values?.() ?? [])];
  for (const e of entries) {
    const githubId = String(e?.github_id ?? '');
    if (!githubId || seen.has(githubId)) continue;
    seen.add(githubId);
    const login = e?.login ?? null;
    const discordUserId = login ? (userMap.get(String(login).toLowerCase()) ?? null) : null;
    const effective = effectiveStatus(githubId, 'none', overrides, now);
    // sow-185: resolve the tier for the Content-Creator Discord badge. These override-only members have NO
    // Stripe subscription, so the tier comes entirely from the override (grandfather -> the grant's tier,
    // default creator; staff -> creator; ban -> none). Mirrors memberEntryFor so the Stripe-customer path and
    // this override-only path agree, and so a grandfathered creator is not stripped of @Creator every run.
    const tier = resolveEffectiveTier({ source: effective.source, status: effective.status, grant: overrides.grandfathers.get(githubId) });
    const username = resolveUsername(githubId, login, overrides, repoIndex);
    const discordRoles = await resolveDiscordRoles(discord, guildId, discordUserId, env);
    members.push({
      githubId,
      githubLogin: login,
      discordUserId,
      email: null,
      username,
      derived: 'none',
      effective,
      tier, // sow-185: keep the Content-Creator badge consistent with the Stripe-customer path + the Worker
      role: roleOf(githubId, overrides.roles),
      trialStartedAt: null,
      converted: false,
      discordRoles,
    });
  }
  return members;
}

/**
 * Enact the full plan via the clients. Returns { counts, failures }.
 *
 * sow-198: every action is ISOLATED. A failure is logged against the action that caused it and the plan
 * continues, exactly as every sync step in main() already behaves. Before this, one throw abandoned every
 * remaining action, so a single failed content flip could silently skip the Discord role swaps and the
 * day-87 reminders queued behind it. That half-apply is precisely what made the 2026-08-08 run
 * unrecoverable: it died on the last step with no record of what it had done.
 *
 * `counts` still counts ATTEMPTS per kind, so the summary line reports the plan that was run. `failures`
 * carries what went wrong so main() can exit non-zero without losing the summary.
 */
export async function enactPlan(actions, { github, discord, resend }, env) {
  const counts = {};
  const failures = [];
  for (const action of actions) {
    counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    try {
      if (action.kind === 'content') await enactContent(github, action);
      else if (action.kind === 'discord' && discord) await enactDiscord(discord, action, env);
      else if (action.kind === 'reminder') await enactReminder(action, { resend, discord, env });
      // 'block' is enacted by re-running the gate / branch protection; the reconcile logs it. The
      // content draft + role removal for a banned member are emitted as their own actions above.
    } catch (e) {
      const message = e?.message ?? String(e);
      console.error(`reconcile: action FAILED (${describe(action)}): ${message}`);
      failures.push({ action, message });
    }
  }
  return { counts, failures };
}

/**
 * Parse the targeted github_id from a repository_dispatch event payload (FIX 4). The signup Worker
 * fires repository_dispatch type 'regate' with client_payload.github_id after a payment so a single
 * member is reconciled immediately instead of waiting for the daily run. Returns the github_id string
 * or null when the event is not a usable regate dispatch.
 */
export function targetedGithubId(env = process.env) {
  if (env.GITHUB_EVENT_NAME !== 'repository_dispatch') return null;
  const eventPath = env.GITHUB_EVENT_PATH;
  if (!eventPath || !fs.existsSync(eventPath)) return null;
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
  } catch {
    return null;
  }
  const id = payload?.client_payload?.github_id;
  return id != null ? String(id) : null;
}

/**
 * Gather only the single targeted member (FIX 4). In repository_dispatch 'regate' mode we fetch ONLY
 * that customer via Stripe Search (instead of iterating every customer) and build one member entry, so
 * a just-paid member's Discord role is upgraded right away. Returns an array of zero or one member entries.
 */
export async function gatherTargetedMember(stripe, overrides, now, githubId, { repoIndex = null, discord = null, env = {} } = {}) {
  const customer = await stripe.searchCustomerByGithubId(githubId);
  if (!customer) {
    console.warn(`reconcile: targeted github_id ${githubId} has no Stripe customer (Search lag or no signup). Nothing to do.`);
    return [];
  }
  const discordRoles = await resolveDiscordRoles(discord, env.DISCORD_GUILD_ID ?? null, customer.metadata?.discord_user_id ?? null, env);
  return [memberEntryFor(customer, overrides, now, { repoIndex, discordRoles, priceTierMap: buildEnvPriceTierMap(env) })];
}

/**
 * sow-218: merge coupon grants that KV knows about but `house/grandfathered.yml` does not yet carry into the
 * in-memory overrides for THIS run. See the call site for why the durable PR fold cannot do this itself.
 *
 * Mutates `overrides.grandfathers`, which is the same Map `effectiveStatus` consults, so a fresh invitee
 * resolves effective-paid on the first run: they get @Member, they enroll into members-index, and they can
 * publish. It only ever ADDS a grant the fold is about to write anyway, so it cannot grant anything the next
 * run would take back, and it never overwrites an entry that already exists (planCouponGrants skips those,
 * including a hand-set bounded comp).
 *
 * Exported for tests. Returns the number of grants applied.
 */
export async function applyPendingCouponGrants({ overrides, env = process.env, now = new Date(), listRedemptions = listCouponRedemptions, root = ROOT } = {}) {
  if (!overrides?.grandfathers) return 0;
  let grants = [];
  try {
    const kv = await listRedemptions({ env });
    if (!kv?.available || !Array.isArray(kv.redemptions) || kv.redemptions.length === 0) return 0;
    // `.parsed`, not the wrapper: readGrandfatheredFromDisk returns { text, parsed } and planCouponGrants
    // wants the parsed document. Handing it the wrapper would make grandfathersFromParsed find nothing, so
    // EVERY already-folded grant would look new and be re-applied. Harmless in effect, wrong in reasoning,
    // and it would have masked a real regression here later.
    const { parsed } = readGrandfatheredFromDisk(root);
    // sow-185: the SAME couponsParsed the durable fold uses. Both paths run planCouponGrants, and if only
    // one of them saw the registry they could disagree about a member's tier WITHIN A SINGLE RUN: this run
    // would gate on one tier while the PR it opens records the other. One input, one answer.
    ({ grants } = planCouponGrants({ redemptions: kv.redemptions, grandfatheredParsed: parsed, couponsParsed: readCouponsFromDisk(root), now }));
  } catch (e) {
    console.warn(`reconcile: WARNING could not pre-apply coupon grants (${e?.message ?? e}); falling back to the next run.`);
    return 0;
  }
  for (const g of grants) {
    overrides.grandfathers.set(String(g.githubId), {
      github_id: String(g.githubId),
      reason: `coupon:${g.code}`,
      until: g.until,
      ...(g.tier ? { tier: g.tier } : {}),
    });
  }
  if (grants.length) {
    console.log(`reconcile: pre-applied ${grants.length} unfolded coupon grant(s) to this run (the durable fold still follows).`);
  }
  return grants.length;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));
  const now = new Date();
  const env = process.env;

  const overrides = loadOverrides(ROOT);
  const repoIndex = buildRepoIndex(ROOT);

  // sow-218: APPLY unfolded coupon grants to this run's overrides, in memory, BEFORE anything reads them.
  //
  // The durable fold (syncCouponGrants, far below) opens a PR and merges it via the API. It does NOT touch
  // this checkout, so `loadOverrides(ROOT)` above keeps reading the commit the workflow started from. That is
  // why a coupon invitee needed TWO daily runs: run one folded the grant into a PR it could not itself see,
  // and only run two, from a fresh checkout, resolved them as effective-paid. Until then they were not paid to
  // the gate and not eligible for members-index enrollment (which requires effective.status === 'paid'), so
  // the site told them they held Content Creator through 2027 while every publish was rejected.
  //
  // Reordering the fold would not have helped, for the same reason: the run cannot see its own merge. Applying
  // the grants to the in-memory map is what makes run ONE correct. The PR still lands and remains the durable
  // record; this only stops the run from being blind to a grant it is about to write down.
  //
  // Costs nothing extra: listCouponRedemptions + planCouponGrants already run in this process for the fold.
  // Best-effort by design, exactly like the fold itself: a KV hiccup leaves the previous two-run behaviour
  // rather than aborting a run that has content flips and role syncs to do.
  await applyPendingCouponGrants({ overrides, env, now });

  const { stripe, github, discord, resend } = buildClients(env);

  const targetId = targetedGithubId(env);
  let members;
  if (targetId) {
    console.log(`reconcile: TARGETED mode (repository_dispatch) for github_id ${targetId}.`);
    members = await gatherTargetedMember(stripe, overrides, now, targetId, { repoIndex, discord, env });
    // SOW-157: a targeted member with NO Stripe customer (a grandfathered comp member, exactly who the
    // 'enroll' dispatch fires for) still needs an entry, so union the override-only gather scoped to the id.
    if (!members.length) {
      const overrideOnly = await gatherOverrideOnlyMembers(overrides, now, { seen: new Set(), repoIndex, discord, env });
      members = overrideOnly.filter((m) => String(m.githubId) === targetId);
      if (members.length) console.log('reconcile: targeted member resolved from the overrides (no Stripe customer).');
    }
  } else {
    members = await gatherMembers(stripe, overrides, now, { repoIndex, discord, env });
    // Grandfathered / banned members with NO Stripe customer are not enumerated above (gatherMembers
    // iterates Stripe customers only). Union them so their managed Discord role is still synced (e.g. a
    // complimentary co-op member granted access who never ran the paid signup). The KV overrides mirror
    // below already covers their following/decrypt/publish access independent of this enumeration.
    const seen = new Set(members.map((m) => String(m.githubId)));
    const overrideOnly = await gatherOverrideOnlyMembers(overrides, now, { seen, repoIndex, discord, env });
    if (overrideOnly.length) {
      console.log(`reconcile: + ${overrideOnly.length} override-only member(s) (grandfathered/banned, no Stripe customer).`);
      members = members.concat(overrideOnly);
    }
  }

  // sow-185: only sync the Content-Creator badge when BOTH the role id is provisioned AND reconcile's Stripe
  // price map is populated (shouldSyncCreatorRole). The price-map condition is load-bearing: with an empty map,
  // tierForPrice runs in legacy mode and resolves EVERY paid member to creator, so enabling the badge on the
  // role id alone would stamp @Creator on every paid + grandfathered member in the live guild. So the role id
  // is committed but stays inert until the prices are wired into reconcile's env.
  const actions = planReconcile({ members, repoIndex: repoIndex.byUsername, now, creatorRoleEnabled: shouldSyncCreatorRole(env) });

  console.log(`reconcile: ${members.length} membership customer(s), ${actions.length} action(s) planned.`);
  for (const action of actions) console.log('  ' + describe(action));

  // FAIL CLOSED: a banned member whose folder could not be resolved cannot be deplatformed by this run.
  // Surface it loudly and set a non-zero exit so CI/the operator must fix the members-index, even though
  // the rest of the plan still applies.
  const unresolved = actions.filter((a) => a.kind === 'unresolved');
  const bannedUnresolved = unresolved.filter((a) => a.status === 'banned');
  for (const a of unresolved) {
    console.error(`reconcile: ${a.status === 'banned' ? 'CRITICAL' : 'WARNING'} unresolvable github_id ${a.githubId} — ${a.reason}. Add a house/members-index.yml entry.`);
  }
  if (bannedUnresolved.length) process.exitCode = 1;

  // SOW-015: mirror the override files (bans/roles/grandfathered) into SIGNUP_KV so the Worker's
  // GET /membership/key can apply ban > staff > grandfather server-side. This is a sync of the override
  // files, not a member action, so a dry run only reports what it would write.
  const rawOverrides = loadOverridesRaw(ROOT);
  if (dryRun) {
    const blob = buildOverridesMirror(rawOverrides, now);
    console.log(`reconcile: DRY RUN would mirror overrides to KV (${JSON.stringify(blob).length} bytes, key overrides:mirror).`);
  } else {
    try {
      const r = await mirrorOverridesToKv({ raw: rawOverrides, env, now });
      console.log(r.written ? `reconcile: mirrored overrides to KV (${r.bytes} bytes).` : `reconcile: overrides KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error('reconcile: overrides KV mirror FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-058: mirror house/syndication-config.yml -> KV key synd:config so the Worker drain reads the live channel
  // switches, require_approval, the hold, and the upvote threshold WITHOUT a redeploy (the overrides-mirror pattern).
  // Without this sync the drain falls back to the safe default (disabled), so syndication can never be enabled.
  let rawSyndication = {};
  try { rawSyndication = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'syndication-config.yml'), 'utf8')) || {}; }
  catch { rawSyndication = {}; }
  if (dryRun) {
    console.log('reconcile: DRY RUN would mirror syndication config to KV (key synd:config).');
  } else {
    try {
      const r = await mirrorSyndicationConfigToKv({ raw: rawSyndication, env });
      console.log(r.written ? `reconcile: mirrored syndication config to KV (${r.bytes} bytes).` : `reconcile: syndication config KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error('reconcile: syndication config KV mirror FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-087: mirror house/content-channels.yml -> KV synd:channels (the drain's category -> channel routing)
  // and house/topics.yml -> KV topics:vocab (the Worker's share category suggester). Same pattern as above.
  for (const { file, run, key } of [
    { file: 'content-channels.yml', run: mirrorContentChannelsToKv, key: 'synd:channels' },
    { file: 'topics.yml', run: mirrorTopicsToKv, key: 'topics:vocab' },
    { file: 'coupons.yml', run: mirrorCouponsToKv, key: 'coupons:config' }, // SOW-119
  ]) {
    let rawDoc = {};
    try { rawDoc = yaml.load(fs.readFileSync(path.join(ROOT, 'house', file), 'utf8')) || {}; } catch { rawDoc = {}; }
    if (dryRun) {
      console.log(`reconcile: DRY RUN would mirror house/${file} to KV (key ${key}).`);
      continue;
    }
    try {
      const r = await run({ raw: rawDoc, env });
      console.log(r.written ? `reconcile: mirrored house/${file} to KV (${r.bytes} bytes).` : `reconcile: house/${file} KV mirror SKIPPED (${r.reason}).`);
    } catch (e) {
      console.error(`reconcile: house/${file} KV mirror FAILED:`, e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-119: fold coupon redemptions (KV) into house/grandfathered.yml as until-bounded grants, BEFORE the
  // member gathering has to see them next run (the Worker fast-path covers the gap in the meantime). Dry
  // run reports intent; apply lists KV + opens one auto-merged PR for any missing grant.
  if (dryRun) {
    console.log('reconcile: DRY RUN would fold coupon redemptions from KV -> house/grandfathered.yml (requires CF creds + a GitHub PR).');
  } else {
    try {
      const r = await syncCouponGrants({ env, github, now, readGrandfathered: () => readGrandfatheredFromDisk(ROOT), readCoupons: () => readCouponsFromDisk(ROOT) });
      console.log(
        r.synced
          ? `reconcile: folded ${r.additions} coupon redemption(s) into grandfather grants (PR #${r.prNumber})${r.conversions ? `, ${r.conversions} converted from permanent comp (SOW-142)` : ''}.`
          : `reconcile: coupon-grants sync SKIPPED (${r.reason}).`,
      );
      if (r.skippedBounded?.length) {
        for (const s of r.skippedBounded) {
          console.log(`reconcile: coupon fold SKIPPED bounded non-coupon grant for ${s.githubId} (reason: ${s.reason}; until: ${s.until}): owner call, never rewritten silently.`);
        }
      }
    } catch (e) {
      console.error('reconcile: coupon-grants sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-157: enroll unindexed effective-paid members into house/members-index.yml so the hosted authoring
  // endpoint can resolve their folder (it reads ONLY the index; an absent entry is a 409). Candidates come
  // from the gathered members (Stripe paid + grandfathered), so a targeted 'enroll' dispatch and the daily
  // sweep both flow through here. A dry run prints the plan; rejects are per-candidate fail-closed.
  try {
    const r = await syncEnrollments({ members, overrides, root: ROOT, env, github, now, dryRun });
    if (r.additions?.length) {
      console.log(
        r.synced
          ? `reconcile: enrolled ${r.additions.length} hosted member(s) into members-index (PR #${r.prNumber}).`
          : `reconcile: ${dryRun ? 'DRY RUN would enroll' : 'enrollment planned'} ${r.additions.length} member(s): ${r.additions.map((a) => `${a.githubId}->${a.folder}`).join(', ')}${r.reason && !dryRun ? ` (SKIPPED: ${r.reason})` : ''}.`,
      );
    } else if (r.reason !== 'no unenrolled effective-paid members') {
      console.log(`reconcile: enrollment SKIPPED (${r.reason}).`);
    }
    for (const rej of r.rejects ?? []) {
      console.warn(`reconcile: enrollment REJECTED github_id ${rej.githubId}: ${rej.reason}. Provision by hand if intended.`);
    }
  } catch (e) {
    console.error('reconcile: enrollment sync FAILED:', e?.message ?? e);
    process.exitCode = 1;
  }

  // SOW-024: sync the member-identity-free favorite counts (house/favorite-counts.yml) from the deletable edge
  // store (KV) into git, so the static build shows aggregate favorite counts without committing any
  // who-favorited-what data. A dry run only reports intent; an apply lists KV + opens an auto-merged PR when
  // the counts changed (no-op when unchanged, or skipped when CF creds / a GitHub client are absent).
  if (dryRun) {
    console.log('reconcile: DRY RUN would sync favorite counts + opt-in favorited-by from KV -> house/favorite-counts.yml + house/favorited-by.yml (requires CF creds + a GitHub PR).');
  } else {
    try {
      const r = await syncFavoriteCounts({
        env, github, now,
        readCurrentCounts: () => readCountsFromDisk(ROOT),
        readCurrentFavoritedBy: () => readFavoritedByFromDisk(ROOT), // SOW-114
        readMembersIndex: () => readMembersIndexFromDisk(ROOT), // SOW-114: github_id -> username for the opt-in lists
      });
      console.log(
        r.synced
          ? `reconcile: synced favorite counts (PR #${r.prNumber}, ${r.total} target(s), ${r.publicTargets ?? 0} public favorited-by target(s)).`
          : `reconcile: favorite-counts sync SKIPPED (${r.reason}).`,
      );
    } catch (e) {
      console.error('reconcile: favorite-counts sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-057: sync the member-identity-free share upvote counts (house/upvote-counts.yml) from KV, same model.
  if (dryRun) {
    console.log('reconcile: DRY RUN would sync share upvote counts from KV -> house/upvote-counts.yml (requires CF creds + a GitHub PR).');
  } else {
    try {
      const r = await syncUpvoteCounts({ env, github, now, readCurrentCounts: () => readUpvoteCountsFromDisk(ROOT) });
      console.log(
        r.synced
          ? `reconcile: synced share upvote counts (PR #${r.prNumber}, ${r.total} target(s)).`
          : `reconcile: upvote-counts sync SKIPPED (${r.reason}).`,
      );
    } catch (e) {
      console.error('reconcile: upvote-counts sync FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  }

  // SOW-126: the engagement-triggered `popular` promoter. Reads the live content-open KV sets + the on-disk
  // favorite/upvote counts, and enqueues any content item whose engagement crossed the threshold to its
  // `popular` channels (trigger:'popular'), watermarked so it promotes once. Disabled by default (content
  // engagement off), so this is a clean no-op until the owner turns it on in the admin Channels workspace.
  try {
    const r = await promotePopular({ argv: dryRun ? [] : ['--apply'], root: ROOT, env });
    if (r?.reason && r.reason !== 'disabled') console.log(`reconcile: popular promotion SKIPPED (${r.reason}).`);
    else if ((r?.promoted ?? 0) > 0) console.log(`reconcile: promoted ${r.promoted} popular item(s) to auto-share.`);
  } catch (e) {
    console.error('reconcile: popular promotion FAILED (non-fatal):', e?.message ?? e);
  }

  // SOW-053 Part B: surface conflicting PRs (auto-merge stalls silently on them). Runs in both modes; the sweep
  // only labels + comments on --apply, and is fail-soft so it never breaks the rest of reconcile.
  try {
    const { surfaced, stuck } = await surfaceConflicts({ github, dryRun });
    if (surfaced.length) {
      console.log(`reconcile: ${surfaced.length} conflicting PR(s)${dryRun ? ' (dry-run, would label + comment)' : ' surfaced'}: ` + surfaced.map((c) => `#${c.number}`).join(', '));
    }
    // SOW-152: the class /ci health cannot see (the gate's failed merge stays a green run). A stuck bot
    // superadmin-automerge PR cannot auto-merge and the re-publish comment is a dead end for a bot, so it needs
    // a human to bring the change in or re-trigger the action. Surfaced distinctly so it never piles up unseen.
    if (stuck.length) {
      console.log(`reconcile: ${stuck.length} STUCK superadmin-automerge BOT PR(s) needing recovery (cannot auto-merge; bring the change in by hand or re-trigger the action): ` + stuck.map((c) => `#${c.number}`).join(', '));
    }
  } catch (e) {
    console.error('reconcile: conflict sweep failed (non-fatal):', e?.message ?? e);
  }

  if (dryRun) {
    console.log('reconcile: DRY RUN (no changes). Re-run with --apply to enact.');
    return;
  }

  // sow-198: enactPlan isolates each action and never throws for an action-level failure, so the summary
  // ALWAYS prints and the log always records what the run attempted. The outer catch covers only a genuine
  // programming error. A failure still turns the run red via exitCode; what it no longer does is take the
  // rest of the plan and the summary down with it.
  let counts = {};
  let failures = [];
  try {
    ({ counts, failures } = await enactPlan(actions, { github, discord, resend }, env));
  } catch (e) {
    console.error('reconcile: enact FAILED:', e?.message ?? e);
    process.exitCode = 1;
  }
  console.log('reconcile: applied. ' + JSON.stringify(counts));
  if (failures.length) {
    console.error(`reconcile: ${failures.length} action(s) failed; the rest of the plan was still enacted.`);
    process.exitCode = 1;
  }
}

// Only run the CLI when invoked directly (so the test can import the helpers without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('reconcile: failed:', err?.message ?? err);
    process.exit(1);
  });
}

export { ROLE, STATUS };
