#!/usr/bin/env node
// SOW-005 PR-gate: the merge gate that decides whether a content PR may merge.
//
// Runs from a `pull_request_target` workflow on the BASE branch (see
// .github/workflows/pr-membership-gate.yml). It reads ONLY PR metadata (author github_id,
// changed file paths via the GitHub API) and NEVER checks out or executes the PR's code. That
// one rule is the whole security model: violating it would leak the Stripe and GitHub secrets
// this script holds. See .data/specs/roles-and-capabilities.md "The one rule that must never
// be broken".
//
// Flow per PR:
//   1. Resolve the author github_id -> effective membership status (Stripe + git-native
//      overrides: ban > grandfather > stripe; the staff tier of the full ban > staff >
//      grandfather > stripe precedence is applied in step 2 by role, not here). Fail closed:
//      any lookup error is NOT paid.
//   2. Classify the changed paths against the author's role and owned folder, then apply the
//      shared decide() merge rules (the SAME module the SOW-003 scoping CI imports, so the two
//      can never diverge).
//   3. Publish the verdict as the required status check `membership-gate` (success | failure)
//      plus a single label.
// Any thrown error sets a FAILING status (fail closed), so an outage can never default-open a
// content PR.

import path from 'node:path';
import fs from 'node:fs';

import { deriveMembership } from '../membership/derive-status.mjs';
import { loadOverrides, roleOf, effectiveStatus } from '../membership/overrides.mjs';
import { ownedFolderFor, decide, contributionTarget } from '../membership/classify-pr.mjs';
import { parseHostedRef, parseAdminHostedRef } from '../membership/hosted-author.mjs'; // SOW-156 hosted content + sow-161 hosted-admin canonical-head identity
import { buildEnvPriceTierMap, resolveEffectiveTier } from '../membership/tier-gate.mjs'; // sow-185: price -> tier + override-aware tier
import { TIER, isTier } from '../membership/tiers.mjs';

import { createStripeClient } from '../clients/stripe.mjs';
import { createGitHubClient } from '../clients/github.mjs';

export const STATUS_CONTEXT = 'membership-gate';

/** Labels the gate auto-closes (a content PR that may never merge as-is): a non-member, a non-paid
 * (trial) member whose content or contribution is paid-only, or a paid Network Member trying to publish
 * Content-Creator content (sow-185). Each carries a sign-up / upgrade nudge. */
export const CLOSE_LABELS = Object.freeze(['rejected-not-a-member', 'rejected-not-paid', 'rejected-not-creator']);

/** The close comment per auto-close label. A non-member is nudged to sign up; a trial member is nudged
 * to upgrade and reassured their work is safe on their own fork (nothing is lost by the close). */
export const CLOSE_NUDGE = Object.freeze({
  'rejected-not-a-member':
    'Thanks for your interest. Publishing on gbti.network is a paid-member feature, so this pull request ' +
    'cannot merge. A free 90-day trial (no card required) lets you join the community and author drafts, ' +
    'but those drafts stay on your own fork until you upgrade. Sign up at https://gbti.network, and once ' +
    'you are a paid member your client publishes your staged drafts as a new pull request. See ' +
    'CONTRIBUTING.md for how content authoring works.',
  'rejected-not-paid':
    'Thanks for your work. Publishing on gbti.network is a paid-member feature, so this pull request ' +
    'cannot merge during your trial. Nothing is lost: your draft stays on your own fork. Upgrade to a ' +
    'paid membership at https://gbti.network, then your client will publish your staged drafts. See ' +
    'CONTRIBUTING.md for how trial authoring works.',
  'rejected-not-creator':
    'Thanks for your work. Publishing articles, products and prompts on gbti.network is a Content Creator ' +
    'feature, so this pull request cannot merge on the Network Member plan. Nothing is lost: your draft ' +
    'stays where you staged it. Upgrade to Content Creator at https://gbti.network, then your client will ' +
    'publish your staged drafts. See CONTRIBUTING.md for how content authoring works.',
});

/**
 * Whether to auto-close a PR. We close non-member and non-paid (trial) content PRs as a courtesy, but
 * ONLY when the membership lookup was healthy: deriveStatus folds a transient Stripe error into 'none',
 * which would otherwise make a real member look like a non-member during an outage. Closing is
 * destructive, so we never close on an unhealthy lookup; the red required check already blocks the merge.
 */
export function shouldAutoClose(label, stripeHealthy) {
  return CLOSE_LABELS.includes(label) && stripeHealthy === true;
}

/**
 * SOW-072: pure decision for the auto-merge actuator. The gate computes autoMerge (paid/admin own-folder content)
 * but nothing acted on it, so passing member PRs sat open. We auto-merge when the gate passed AND autoMerge is set
 * AND either (a) every changed path is under members/ (a member's own-folder content), OR (b) the decision label is
 * `superadmin-automerge` (SOW-108: an owner-elected superadmin PR merges automatically on ANY path, including
 * house/** and Tier S). For everyone else the members/ floor is defense-in-depth so a protected-path PR (house/**,
 * .github/**, root) is NEVER machine-merged even if a future bug set the flag; those still require CODEOWNER
 * review. The caller merges directly (main has no branch protection, so a "clean" PR cannot use GitHub native
 * auto-merge); it is fail-open-safe, so a merge error just leaves the PR open for a manual merge.
 */
export function shouldAutoMerge(decision, paths) {
  if (decision?.check !== 'pass' || decision?.autoMerge !== true) return false;
  // SOW-108: a superadmin PR auto-merges on any path (the gate decision already authorized it).
  if (decision?.label === 'superadmin-automerge') return true;
  // Everyone else: auto-merge stays scoped to a member's own folder (house/** for an admin still needs review).
  return Array.isArray(paths) && paths.length > 0 && paths.every((p) => typeof p === 'string' && p.startsWith('members/'));
}

/**
 * Pure core: decide the gate verdict for one PR from already-resolved inputs.
 * No GitHub, no environment, no I/O. The runnable wrapper below feeds it real clients; the test
 * feeds it fakes.
 *
 * @param {object} a
 * @param {string|number} a.author    PR author github_id (pull_request.user.id).
 * @param {string[]}      a.paths     changed file paths (repo-relative, forward slashes).
 * @param {object}        a.overrides { roles, bans, grandfathers, membersIndex } from loadOverrides().
 * @param {object}        a.stripe    a client with findCustomerByGithubId(githubId) (may throw).
 * @param {string|number|null} [a.botId]  the reconcile bot's github_id (treated as admin).
 * @param {Date}          [a.now]     clock injection for trial/grandfather windows.
 * @returns {Promise<{check:'pass'|'fail', autoMerge:boolean, label:string, reasons:string[], status:string, role:string, ownedFolder:(string|null)}>}
 */
export async function evaluatePR({ author, paths, overrides, stripe, botId = null, now = new Date(), resolveOwner = null, priceTierMap = null }) {
  const { roles, bans, grandfathers, membersIndex } = overrides;
  const authorId = String(author);

  const role = roleOf(authorId, roles);
  const ownedFolder = ownedFolderFor(authorId, membersIndex);
  const isBot = botId != null && authorId === String(botId);

  // deriveMembership fails closed to { status:'none', tier:'none' } on any lookup error, so the gate never
  // throws on a Stripe outage: an unresolvable author is simply treated as unpaid. The STATUS still flows
  // through effectiveStatus (ban > grandfather > Stripe; staff is applied by role in decide()), so overrides
  // are preserved; the TIER is resolved additionally (sow-185) from that SAME effectiveStatus source, so a
  // grandfathered or staff account paid WITHOUT a Stripe subscription is not wrongly denied.
  const { status: stripeStatus, tier: stripeTier } = await deriveMembership(authorId, stripe, { priceTierMap, now });
  const effective = effectiveStatus(authorId, stripeStatus, { bans, grandfathers }, now);
  const tier = resolveEffectiveTier({ source: effective.source, status: effective.status, stripeTier, grant: grandfathers.get(authorId) });

  // If this is a contribution to exactly one other member's folder, resolve that owner's acceptance
  // (an APPROVED review on the head SHA), paid status, and TIER. resolveOwner is injected so the core stays
  // testable with a fake. Fail closed: no resolver or unknown owner -> not approved, not paid, tier none.
  let ownerApproved = false;
  let ownerPaid = false;
  let ownerTier = TIER.none;
  const target = contributionTarget(paths, ownedFolder);
  if (target && resolveOwner) {
    const r = await resolveOwner(target);
    ownerApproved = !!r?.ownerApproved;
    ownerPaid = !!r?.ownerPaid;
    ownerTier = isTier(r?.ownerTier) ? r.ownerTier : TIER.none;
  }

  const d = decide({ paths, role, effective, ownedFolder, isBot, ownerApproved, ownerPaid, tier, ownerTier });
  return { ...d, status: effective.status, tier, role, ownedFolder, contributionTarget: target };
}

/** Read and parse the GitHub event payload (the pull_request_target event). */
export function readEvent(eventPath, botId = null) {
  if (!eventPath) throw new Error('GITHUB_EVENT_PATH is not set');
  const raw = fs.readFileSync(eventPath, 'utf8');
  const event = JSON.parse(raw);
  return parseEvent(event, botId);
}

/** Pure event parser (unit-testable). SOW-026: when GBTI's App bot opens the publish PR on a member's behalf
 *  (the member's fork-scoped token cannot open it), the trust anchor is the PR HEAD (the fork owner), NOT the
 *  opener (now the bot). A member can only open a PR whose head is their own fork, so the head-repo owner is the
 *  real author. For any non-bot opener (a member opening their own PR directly), the opener stays the author. If
 *  a bot-opened PR has no resolvable head owner, author is null -> the gate fails closed.
 *
 *  SOW-156 (hosted authoring): a bot-opened PR whose head lives on the CANONICAL repo itself (no fork) carries
 *  the member identity in its branch name, hosted/<github_id>/<itemId>, written by the Worker from the VERIFIED
 *  token identity (members cannot open PRs as the bot and cannot push branches to canonical). For that shape the
 *  branch parse is the ONLY author source: a non-matching ref yields author null (fail closed). It must never
 *  fall back to the head-repo owner, which for a canonical head is the org account -- if that id ever mapped to
 *  a role, a malformed ref would escalate instead of failing. */
export function parseEvent(event, botId = null) {
  const pr = event.pull_request;
  if (!pr) throw new Error('event payload has no pull_request');
  const opener = pr.user?.id;
  const botOpened = botId != null && String(opener) === String(botId);
  const headRepoId = pr.head?.repo?.id ?? null;
  const baseRepoId = pr.base?.repo?.id ?? null;
  const sameRepoHead = headRepoId != null && String(headRepoId) === String(baseRepoId);
  let author;
  if (botOpened && sameRepoHead) {
    // A bot-opened canonical-head PR carries the requesting id in the branch: `hosted/<id>/...` (own-folder
    // member content, SOW-156) or `hosted-admin/<id>/...` (a sow-161 admin mutation). Either resolves the
    // author id; a non-matching ref yields null -> the gate hard-fails (never the org owner id). decide()
    // then re-checks that id's git-native role against the touched paths, so an admin branch cannot merge
    // beyond the id's actual role.
    author = parseHostedRef(pr.head?.ref) ?? parseAdminHostedRef(pr.head?.ref);
  } else if (botOpened) {
    author = pr.head?.repo?.owner?.id ?? pr.head?.user?.id ?? null; // fork head: the fork owner is the author
  } else {
    author = opener;
  }
  return {
    number: event.number ?? pr.number,
    author,
    headSha: pr.head?.sha,
    botOpened,
  };
}

/** Runnable entry point: wire real clients, evaluate, publish the status check + label. */
async function main() {
  const repoRoot = process.cwd();

  // Prefer the content-write bot PAT (it does the status + label writes). Fall back to GITHUB_TOKEN
  // only if a bot token is not provided.
  const token = process.env.GITHUB_BOT_TOKEN || process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_CONTENT_REPO;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const botId = process.env.BOT_GITHUB_ID || null;

  if (!token) throw new Error('GITHUB_BOT_TOKEN (or GITHUB_TOKEN) is required');
  if (!repo) throw new Error('GITHUB_CONTENT_REPO is required');

  const gh = createGitHubClient({ token, repo });

  // Resolve PR metadata first so that even an early failure can be reported against the head sha. SOW-026:
  // botId lets the gate resolve the member from the PR head when GBTI's App opens the PR on their behalf.
  const { number, author, headSha } = readEvent(process.env.GITHUB_EVENT_PATH, botId);
  if (!headSha) throw new Error('could not resolve pull_request.head.sha from the event');

  try {
    if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is required');
    if (author == null) throw new Error('could not resolve the PR author (pull_request.user.id, or pull_request.head owner when the App bot opened it)');

    const stripe = createStripeClient({ apiKey: stripeKey });
    const overrides = loadOverrides(repoRoot);
    // sow-185: the price-id -> tier map from the provisioned env (STRIPE_PRICE_MEMBER/CREATOR_* + legacy
    // STRIPE_PRICE_ID). Non-empty in production (the legacy $150 seeds creator), so an unmapped price fails
    // closed to `none`; empty only in a bare env, where tierForPrice's legacy single-price mode grants creator.
    const priceTierMap = buildEnvPriceTierMap(process.env);

    // METADATA ONLY: changed file paths via the API. We never check out or run PR code.
    const paths = await gh.listPullFilePaths(number);

    // Reverse the members-index (github_id -> username) so a contribution target username resolves to
    // the owner's immutable github_id. For a contribution, the owner accepts by submitting an APPROVED
    // review; we only honor an approval whose commit_id is the current head SHA, so a later malicious
    // push invalidates a stale approval. Owner identity is read by github_id, never trusted from a label.
    const usernameToGithubId = new Map([...overrides.membersIndex].map(([id, name]) => [name, id]));
    const resolveOwner = async (ownerUsername) => {
      const ownerId = usernameToGithubId.get(ownerUsername);
      if (!ownerId) return { ownerApproved: false, ownerPaid: false, ownerTier: TIER.none }; // unknown owner -> fail closed
      const ownerMembership = await deriveMembership(ownerId, stripe, { priceTierMap });
      const ownerEff = effectiveStatus(ownerId, ownerMembership.status, {
        bans: overrides.bans,
        grandfathers: overrides.grandfathers,
        roles: overrides.roles, // staff owners are paid-equivalent: a contribution to their folder must not hold on Stripe
      });
      // The owner's TIER, override-aware like the author's (staff owner -> creator via the folded roles).
      const ownerTier = resolveEffectiveTier({
        source: ownerEff.source,
        status: ownerEff.status,
        stripeTier: ownerMembership.tier,
        grant: overrides.grandfathers.get(String(ownerId)),
      });
      let ownerApproved = false;
      try {
        const reviews = await gh.listReviews(number);
        ownerApproved = reviews.some(
          (r) => String(r.user?.id) === String(ownerId) && r.state === 'APPROVED' && r.commit_id === headSha,
        );
      } catch {
        ownerApproved = false; // cannot read reviews -> not approved (fail closed)
      }
      return { ownerApproved, ownerPaid: ownerEff.status === 'paid', ownerTier };
    };

    const d = await evaluatePR({ author, paths, overrides, stripe, botId, resolveOwner, priceTierMap });

    await gh.setStatus(headSha, {
      state: d.check === 'pass' ? 'success' : 'failure',
      context: STATUS_CONTEXT,
      description: d.reasons[0],
    });
    await gh.setLabels(number, [d.label]);

    // Members only, and publishing is paid-only: auto-close a non-member PR (sign-up nudge) or a non-paid
    // trial member's content/contribution PR (upgrade nudge), but ONLY when the Stripe lookup was healthy,
    // so a transient outage never closes a real member's PR (the red check still blocks the merge regardless).
    if (CLOSE_LABELS.includes(d.label)) {
      let stripeHealthy = true;
      try {
        await stripe.findCustomerByGithubId(String(author));
      } catch {
        stripeHealthy = false;
      }
      if (shouldAutoClose(d.label, stripeHealthy)) {
        try {
          await gh.closePull(number, { comment: CLOSE_NUDGE[d.label] });
        } catch (closeErr) {
          console.error(`[pr-gate] could not auto-close PR #${number} (${d.label}): ${closeErr?.message ?? closeErr}`);
        }
      } else {
        console.error(`[pr-gate] membership lookup unavailable; leaving PR #${number} red but NOT auto-closing`);
      }
    }

    // SOW-072: actuate auto-merge. main has no branch protection today, so a passing own-folder member PR is landed
    // by a direct squash merge (a "clean" PR cannot use GitHub native auto-merge — that path errors until required
    // checks exist). Fail-OPEN-SAFE: any merge error leaves the green check + the PR open for a manual merge (never
    // worse than before, never a forced merge). When branch protection requiring this gate (+ content-check) is
    // added, switch to native auto-merge (the GraphQL enablePullRequestAutoMerge mutation) so the merge waits for
    // the other required checks. A GitHub draft PR refuses to merge, so SOW-035's draft E2E cycle is unaffected.
    if (shouldAutoMerge(d, paths)) {
      try {
        await gh.mergePull(number, { method: 'squash' });
        console.log(`[pr-gate] auto-merged PR #${number} (own-folder ${d.label} content)`);
      } catch (mergeErr) {
        // A 405 means GitHub REFUSED the merge: a draft PR, a conflict, or — once branch protection requiring
        // checks is added — required checks not yet passed (the case that needs the native auto-merge migration
        // noted above). Flag it distinctly so it is never mistaken for a transient network error and silently
        // leaves member PRs sitting open.
        const hint = mergeErr?.status === 405
          ? ' (GitHub refused the merge: draft, conflict, or pending required checks — if branch protection was just added, migrate this to native auto-merge)'
          : '';
        console.error(`[pr-gate] could not auto-merge PR #${number}${hint}: ${mergeErr?.message ?? mergeErr}`);
      }
    } else if (d.check === 'pass' && d.autoMerge === true) {
      console.error(`[pr-gate] PR #${number} flagged autoMerge but failed the own-folder path guard; NOT auto-merging`);
    }

    console.log(
      `[pr-gate] PR #${number} author=${author} role=${d.role} status=${d.status} ` +
        `-> ${d.check} (${d.label}); autoMerge=${d.autoMerge}; ${d.reasons[0]}`,
    );
    // The check itself carries the verdict; the workflow step always succeeds so the status
    // check (not the job result) is what branch protection evaluates.
  } catch (err) {
    // Fail closed: ANY error publishes a failing required check so the PR cannot merge.
    const description = `gate error: ${err?.message ?? err}`;
    console.error(`[pr-gate] ${description}`);
    try {
      await gh.setStatus(headSha, { state: 'failure', context: STATUS_CONTEXT, description });
      await gh.setLabels(number, ['gate-error']);
    } catch (reportErr) {
      // If we cannot even publish the failing status, surface the original error and exit non-zero
      // so the workflow run is visibly red.
      console.error(`[pr-gate] could not publish failing status: ${reportErr?.message ?? reportErr}`);
      process.exitCode = 1;
    }
  }
}

// Only run main() when invoked directly, not when imported by the test.
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`[pr-gate] fatal: ${err?.message ?? err}`);
    process.exitCode = 1;
  });
}
