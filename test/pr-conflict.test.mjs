// SOW-053 Part B: the PR-conflict surfacing helpers (scripts/lib/pr-conflict.mjs) + the reconcile sweep
// (surfaceConflicts). Pure classification + an idempotent, fail-soft, dry-run-aware sweep over a mock GitHub client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState, alreadyLabeled, conflictComment, conflictAction, CONFLICT_LABEL, hasLabel, isBotPull, isStuckAutomergeBot, AUTOMERGE_LABEL } from '../scripts/lib/pr-conflict.mjs';
import { surfaceConflicts } from '../scripts/reconcile.mjs';

test('mergeState: dirty / mergeable false = conflicting; null / unknown = unknown; else clean', () => {
  assert.equal(mergeState({ mergeable_state: 'dirty' }), 'conflicting');
  assert.equal(mergeState({ mergeable: false }), 'conflicting');
  assert.equal(mergeState({ mergeable: null }), 'unknown');           // not computed yet
  assert.equal(mergeState({ mergeable_state: 'unknown' }), 'unknown');
  assert.equal(mergeState({ mergeable: true, mergeable_state: 'clean' }), 'clean');
  assert.equal(mergeState({ mergeable: true, mergeable_state: 'behind' }), 'clean'); // behind != conflict
  assert.equal(mergeState({}), 'unknown');
});

test('alreadyLabeled reads object {name} or string labels', () => {
  assert.equal(alreadyLabeled({ labels: [{ name: 'needs-rebase' }] }), true);
  assert.equal(alreadyLabeled({ labels: ['needs-rebase'] }), true);
  assert.equal(alreadyLabeled({ labels: [{ name: 'other' }] }), false);
  assert.equal(alreadyLabeled({}), false);
});

test('conflictComment @-mentions the author: re-publish first, maintainer web-editor fallback (SOW-106)', () => {
  const c = conflictComment('alice');
  assert.match(c, /^@alice /);
  assert.match(c, /publish it again/i);
  assert.match(c, /no git or rebase/i);
  assert.match(c, /maintainer resolves it in the GitHub web editor/i); // the add/add class needs a maintainer
  assert.doesNotMatch(conflictComment(''), /^@/); // no login -> no stray mention
});

test('conflictAction surfaces only a conflicting + unlabeled PR', () => {
  assert.deepEqual(conflictAction({ mergeable_state: 'dirty', user: { login: 'bob' } }), { surface: true, login: 'bob' });
  assert.equal(conflictAction({ mergeable_state: 'dirty', labels: [{ name: CONFLICT_LABEL }] }).surface, false); // already surfaced
  assert.equal(conflictAction({ mergeable_state: 'clean' }).surface, false);
  assert.equal(conflictAction({ mergeable: null }).surface, false); // unknown -> wait
});

// ---- SOW-152: bot / label / stuck helpers ----
test('hasLabel reads object {name} or string labels for any label name', () => {
  assert.equal(hasLabel({ labels: [{ name: AUTOMERGE_LABEL }] }, AUTOMERGE_LABEL), true);
  assert.equal(hasLabel({ labels: ['superadmin-automerge'] }, AUTOMERGE_LABEL), true);
  assert.equal(hasLabel({ labels: [{ name: 'needs-rebase' }] }, AUTOMERGE_LABEL), false);
  assert.equal(hasLabel({}, AUTOMERGE_LABEL), false);
});

test('isBotPull: App bot by user.type or a [bot]-suffixed login, not a human', () => {
  assert.equal(isBotPull({ user: { type: 'Bot' } }), true);
  assert.equal(isBotPull({ user: { login: 'gbti-network-publisher[bot]' } }), true);
  assert.equal(isBotPull({ user: { login: 'atwellpub', type: 'User' } }), false);
  assert.equal(isBotPull({}), false);
});

test('isStuckAutomergeBot: conflicting AND bot AND superadmin-automerge (all three)', () => {
  const stuck = { mergeable_state: 'dirty', user: { type: 'Bot' }, labels: [{ name: AUTOMERGE_LABEL }] };
  assert.equal(isStuckAutomergeBot(stuck), true);
  // still stuck even if ALSO already needs-rebase-labeled
  assert.equal(isStuckAutomergeBot({ ...stuck, labels: [{ name: AUTOMERGE_LABEL }, { name: CONFLICT_LABEL }] }), true);
  assert.equal(isStuckAutomergeBot({ ...stuck, mergeable_state: 'clean' }), false); // not conflicting
  assert.equal(isStuckAutomergeBot({ ...stuck, user: { login: 'alice', type: 'User' } }), false); // human
  assert.equal(isStuckAutomergeBot({ ...stuck, labels: [] }), false); // not automerge
});

// ---- the sweep ----
function mockGithub(pulls) {
  const calls = { labels: [], comments: [] };
  return {
    calls,
    listOpenPulls: async () => pulls.map((p) => ({ number: p.number, user: p.user })),
    getPull: async (n) => pulls.find((p) => p.number === n),
    addLabels: async (n, labels) => { calls.labels.push({ n, labels }); },
    comment: async (n, body) => { calls.comments.push({ n, body }); },
  };
}

test('surfaceConflicts labels + comments each conflicting unlabeled PR on apply', async () => {
  const github = mockGithub([
    { number: 1, user: { login: 'alice' }, mergeable_state: 'dirty', labels: [] },          // surface
    { number: 2, user: { login: 'bob' }, mergeable: true, mergeable_state: 'clean', labels: [] }, // skip (clean)
    { number: 3, user: { login: 'cara' }, mergeable_state: 'dirty', labels: [{ name: CONFLICT_LABEL }] }, // skip (already)
    { number: 4, user: { login: 'dan' }, mergeable: null, labels: [] },                      // skip (unknown)
  ]);
  const { surfaced } = await surfaceConflicts({ github, dryRun: false });
  assert.deepEqual(surfaced.map((s) => s.number), [1]);
  assert.deepEqual(github.calls.labels, [{ n: 1, labels: [CONFLICT_LABEL] }]);
  assert.equal(github.calls.comments.length, 1);
  assert.match(github.calls.comments[0].body, /@alice/);
});

test('surfaceConflicts in dry-run reports but does not mutate', async () => {
  const github = mockGithub([{ number: 7, user: { login: 'eve' }, mergeable_state: 'dirty', labels: [] }]);
  const { surfaced } = await surfaceConflicts({ github, dryRun: true });
  assert.deepEqual(surfaced.map((s) => s.number), [7]);
  assert.equal(github.calls.labels.length, 0);
  assert.equal(github.calls.comments.length, 0);
});

test('surfaceConflicts is fail-soft (a listOpenPulls error yields empty)', async () => {
  const github = { listOpenPulls: async () => { throw new Error('boom'); } };
  assert.deepEqual(await surfaceConflicts({ github, dryRun: false }), { surfaced: [], stuck: [] });
  assert.deepEqual(await surfaceConflicts({}), { surfaced: [], stuck: [] }); // no client -> empty
});

// SOW-152: a conflicting BOT superadmin-automerge PR is collected in `stuck` (even when already needs-rebase-
// labeled, so a persistently-stuck one stays visible) while a human conflict is not.
test('surfaceConflicts collects stuck bot superadmin-automerge PRs distinctly', async () => {
  const github = mockGithub([
    { number: 10, user: { login: 'gbti-network-publisher[bot]', type: 'Bot' }, mergeable_state: 'dirty', labels: [{ name: AUTOMERGE_LABEL }] },                       // stuck (fresh)
    { number: 11, user: { login: 'gbti-network-publisher[bot]', type: 'Bot' }, mergeable_state: 'dirty', labels: [{ name: AUTOMERGE_LABEL }, { name: CONFLICT_LABEL }] }, // stuck (already labeled -> not in surfaced, still in stuck)
    { number: 12, user: { login: 'alice', type: 'User' }, mergeable_state: 'dirty', labels: [] },                                                                       // human conflict -> surfaced, NOT stuck
  ]);
  const { surfaced, stuck } = await surfaceConflicts({ github, dryRun: true });
  assert.deepEqual(stuck.map((s) => s.number), [10, 11]);
  assert.deepEqual(surfaced.map((s) => s.number), [10, 12]); // 11 skipped (already labeled); 10 not-yet-labeled + human 12
});
