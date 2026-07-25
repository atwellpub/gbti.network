// SOW-053 Part B: surface auto-merge conflicts. A member content PR that GitHub marks conflicting (mergeable_state
// "dirty") cannot auto-publish, and today that stalls SILENTLY. These PURE helpers classify a PR's merge state,
// detect whether we have already surfaced it (idempotency), and build the one-time @-mention comment. Node-free,
// no network, so they unit-test without a harness. The reconcile sweep (scripts/reconcile.mjs) calls them.
//
// Why a member's fix is just "re-publish": the GBTI client loads the file FRESH from upstream for editing, so
// re-publishing re-reads the latest (now-conflicting) version, re-applies the member's edit, and the updated branch
// merges cleanly. No manual git rebase is ever asked of the member.

export const CONFLICT_LABEL = 'needs-rebase';
// SOW-108: the label the gate assigns a superadmin PR that auto-merges on any path (membership/classify-pr.mjs).
export const AUTOMERGE_LABEL = 'superadmin-automerge';

/** Does a PR carry a given label? Same labels-array read as alreadyLabeled (string or {name}). Pure. */
export function hasLabel(pull = {}, name) {
  return (pull.labels || []).some((l) => (typeof l === 'string' ? l : l && l.name) === name);
}

/**
 * SOW-152: is this PR authored by an App BOT (the gbti-network-publisher publisher app that opens the extension's
 * superadmin config PRs)? A conflicting BOT superadmin-automerge PR is a DEAD END for the SOW-053 "re-publish"
 * comment (a bot never re-publishes), so the sweep surfaces it distinctly for recovery. Pure: reads only the PR's
 * user.type / user.login (GitHub tags an App author type 'Bot' and suffixes its login with '[bot]').
 */
export function isBotPull(pull = {}) {
  const u = pull.user || {};
  if (u.type === 'Bot') return true;
  const login = String(u.login || '');
  return login.endsWith('[bot]');
}

/** SOW-152: a conflicting, bot-authored, superadmin-automerge PR that the auto-merge cannot land and the
 *  re-publish comment cannot fix. Surfaced distinctly so the stuck-bot class never silently piles up again. Pure. */
export function isStuckAutomergeBot(pull = {}) {
  return mergeState(pull) === 'conflicting' && isBotPull(pull) && hasLabel(pull, AUTOMERGE_LABEL);
}

/**
 * Classify a single-PR GET payload's merge state.
 *   - 'conflicting': GitHub computed a real conflict (mergeable_state 'dirty' or mergeable === false).
 *   - 'unknown': not computed yet (mergeable null / mergeable_state 'unknown') — skip, retry next sweep.
 *   - 'clean': everything else (mergeable true; 'clean'/'unstable'/'behind'/'blocked'/'has_hooks').
 * Note: only the single-PR GET carries mergeable/mergeable_state; the list endpoint does not.
 */
export function mergeState(pull = {}) {
  if (pull.mergeable_state === 'dirty' || pull.mergeable === false) return 'conflicting';
  if (pull.mergeable == null || pull.mergeable_state === 'unknown') return 'unknown';
  return 'clean';
}

/** Already surfaced? The conflict label being present means we already commented once (idempotency guard). */
export function alreadyLabeled(pull = {}, label = CONFLICT_LABEL) {
  return (pull.labels || []).some((l) => (typeof l === 'string' ? l : l && l.name) === label);
}

/** The one-time conflict comment body, @-mentioning the PR author so they get a GitHub notification.
 *  SOW-106: re-publishing clears an EDIT conflict (the reload re-bases the content), but an add/add conflict
 *  (the branch predates the Worker fork-sync and its base lacks the file) needs a maintainer, so the copy
 *  covers both instead of promising re-publish always works. */
export function conflictComment(login) {
  const who = login ? `@${login} ` : '';
  return (
    `${who}heads up: this pull request has a merge conflict, so it cannot auto-publish yet. A change landed on the ` +
    `same file after you started editing. First, open this item in the GBTI client or extension and **publish it ` +
    `again** — that reloads the latest version and usually clears the conflict (no git or rebase needed). If this ` +
    `pull request still shows a conflict after re-publishing, a maintainer resolves it in the GitHub web editor ` +
    `(choose the pull request's version of your file).`
  );
}

/**
 * Decide what to do for one PR. Returns { surface: boolean, login } — surface when it is conflicting AND not yet
 * labeled. Pure (no I/O), so the sweep is trivially testable.
 */
export function conflictAction(pull = {}) {
  const surface = mergeState(pull) === 'conflicting' && !alreadyLabeled(pull);
  return { surface, login: pull.user && pull.user.login ? pull.user.login : '' };
}
