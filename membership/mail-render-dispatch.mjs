// SOW-186 phase 4: the kind dispatcher for the injected `renderIssue` seam. Exported so the ONE line that runs
// in production (workers/signup/index.mjs `mailDrainDeps`) is the SAME line the tests exercise, instead of a
// hand-copy in the test that can silently drift from the real one (QAmaster, 2026-08-22).
//
// This is ROUTING between two independent renderers, NOT a hoist of a shared guard. The leak guard, the
// fail-closed send gate, the rate budget, the per-recipient suppression re-check and the one-click unsubscribe all
// live in the UNCHANGED mail drain, which both issue kinds flow through; nothing guard-bearing is shared here. A
// digest issue renders through the weekly-roundup template; a `kind:'notification'` issue renders through the lean
// follow template. Both are pure, so this dispatcher is pure.
import { renderIssue } from './mail-render.mjs';
import { renderNotificationEmail } from './mail-notify-render.mjs';

/** Route a frozen mail issue to its renderer by kind. `{ subject, html, text }` either way. */
export function renderMailIssue(issue, ctx) {
  return issue && issue.kind === 'notification'
    ? renderNotificationEmail(issue, ctx)
    : renderIssue(issue, ctx);
}
