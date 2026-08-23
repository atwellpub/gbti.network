// sow-166 follow-up (2026-08-23): ADMIN-GATED MANUAL MAIL TRIGGERS.
//
// WHY THIS EXISTS. compileWeeklyIssue and drainMail were reachable ONLY from the cron map in index.mjs
// (`0 14 * * 2` and `*/5 * * * *`). A deployed Worker offers no way to fire a scheduled handler by hand, so
// the first end-to-end proof of the mail chain (compile -> enqueue -> drain -> a real message at a real
// address) could not happen before the next Tuesday 14:00 UTC, and every subsequent re-proof, post-rotation
// check or re-send carried the same week-long turnaround. That is a long feedback loop on the ONE path that
// touches other people's inboxes, which is the path that most deserves a short one.
//
// FAIL-CLOSED, AND THIS ROUTE ADDS NO NEW SEND AUTHORITY. It reuses the exact production functions the cron
// calls, so everything downstream is unchanged: the drain still refuses every recipient outside
// MAIL_SEND_ALLOWLIST (resolveSendGate defaults to `closed`), still honours the daily/monthly/per-tick
// budgets, still re-checks suppression, and still attaches the one-click unsubscribe. An admin firing this
// with the gate closed sends to nobody, by construction. The gate remains the owner's to open.
//
// THE TRAP THIS ROUTE HAD TO DESIGN AROUND, and the reason `test-compile` exists. The issue id is the compile
// DATE (`weekly-YYYY-MM-DD`, mail-compile-core.mjs), and the section window excludes every url carried by a
// PRIOR issue. So a real `compile` fired on a Saturday to rehearse the send does not merely create a spare
// issue: it becomes Tuesday's prior, consumes the 90-day inaugural back catalogue and the launch note, and
// leaves the genuine first issue nearly empty. The rehearsal would quietly spend the thing it was rehearsing
// for. `test-compile` therefore mints a `test-YYYY-MM-DD` id, which listPriorIssueIds cannot count (it filters
// to the canonical `weekly-` shape precisely so a hand-seeded issue is never mistaken for a mailed one), so a
// rehearsal composes exactly what the real inaugural issue will compose and leaves the weekly cadence
// untouched. `discard` then removes the rehearsal so it stops appearing in activeIssueIds forever.

import { authorizeAdmin } from './membership-admin.mjs';
import { compileWeeklyIssue } from './mail-compile.mjs';
import { MAIL_PENDING_KEY } from './mail-store.mjs';
import { issueKey } from '../../membership/mail-digest.mjs';

const ACTIONS = new Set(['compile', 'test-compile', 'drain', 'discard']);

// A rehearsal id is `test-` plus the UTC date. The prefix is load-bearing twice over: listPriorIssueIds ignores
// it (so the weekly exclude window never sees it), and `discard` refuses to delete anything without it.
const TEST_PREFIX = 'test-';
export function testIssueId(nowMs) {
  const d = new Date(Number(nowMs));
  if (!Number.isFinite(d.getTime())) throw new Error('testIssueId: nowMs must be a finite timestamp');
  const p = (n) => String(n).padStart(2, '0');
  return `${TEST_PREFIX}${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Delete one REHEARSAL issue: its frozen body, its pending index, and every send record under it. Guarded to
 * the `test-` prefix, so no real weekly issue is reachable from this route however the caller spells the id.
 * Best effort per key: a delete that throws is counted, never fatal, because a half-removed rehearsal is
 * strictly better than a stuck one and the caller sees the count.
 */
async function discardTestIssue(kv, issueId) {
  if (!kv) return { ok: false, reason: 'no kv' };
  if (!String(issueId).startsWith(TEST_PREFIX)) {
    return { ok: false, status: 400, reason: 'discard is limited to test- issues' };
  }
  let deleted = 0;
  let errors = 0;
  const del = async (key) => {
    try { await kv.delete(key); deleted += 1; } catch { errors += 1; }
  };
  // Send records first: if the walk fails partway the pending index is still there to show the issue is live.
  let cursor;
  for (let page = 0; page < 100; page++) {
    let res;
    try { res = await kv.list({ prefix: `mail:send:${issueId}:`, cursor }); } catch { errors += 1; break; }
    for (const k of res?.keys ?? []) await del(k.name);
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  await del(MAIL_PENDING_KEY(issueId));
  await del(issueKey(issueId));
  return { ok: true, issueId, deleted, errors };
}

/**
 * POST /membership/admin/mail { action, issueId? }
 *
 *   compile       run the weekly compile exactly as the Tuesday cron does (idempotent by date).
 *   test-compile  the same compile under a `test-YYYY-MM-DD` id that the weekly exclude window ignores.
 *   drain         run the mail drain now instead of waiting for the next 5-minute tick. `issueId` narrows it.
 *   discard       delete a rehearsal issue (test- ids only).
 *
 * `drain` has NO in-module default: the drain's IO (Stripe address lookup, Resend, the renderer dispatch) is
 * composed in index.mjs, and duplicating that wiring here would create a second composition root that can
 * drift from the one the cron actually uses. An uninjected drain is reported as misconfigured, not improvised.
 */
export async function membershipAdminMail(request, env, {
  authorize = authorizeAdmin,
  compile = compileWeeklyIssue,
  drain = null,
  kv = env?.SIGNUP_KV,
  now = Date.now,
  ...deps
} = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };

  let body;
  try { body = await request.json(); } catch { body = null; }
  const action = String(body?.action || '').trim();
  if (!ACTIONS.has(action)) {
    return { status: 400, body: { error: 'bad_request', message: `unknown action; expected one of ${[...ACTIONS].join(', ')}` } };
  }
  const requestedIssueId = String(body?.issueId || '').trim() || null;

  try {
    if (action === 'compile' || action === 'test-compile') {
      const issueId = action === 'test-compile' ? (requestedIssueId || testIssueId(Number(now()))) : requestedIssueId;
      if (action === 'test-compile' && !issueId.startsWith(TEST_PREFIX)) {
        return { status: 400, body: { error: 'bad_request', message: 'a test-compile issueId must start with test-' } };
      }
      const result = await compile(env, issueId ? { issueId } : {});
      // recipientsTruncated is folded from a truncated page walk OR any unreadable subscriber record, and a short
      // base under-sends with no other signal, so it is surfaced at the top level rather than left inside the blob.
      return { status: 200, body: { ok: result?.ok !== false, action, ...result } };
    }

    if (action === 'drain') {
      if (typeof drain !== 'function') {
        return { status: 500, body: { error: 'misconfigured', message: 'the mail drain is not wired into this route' } };
      }
      const result = await drain(env, requestedIssueId ? { issueId: requestedIssueId } : {});
      return { status: 200, body: { ok: true, action, ...result } };
    }

    // discard
    if (!requestedIssueId) return { status: 400, body: { error: 'bad_request', message: 'discard requires an issueId' } };
    const result = await discardTestIssue(kv, requestedIssueId);
    if (!result.ok) return { status: result.status || 500, body: { error: 'bad_request', message: result.reason } };
    return { status: 200, body: { ok: true, action, ...result } };
  } catch (err) {
    return { status: 500, body: { error: 'mail_trigger_failed', message: String(err?.message ?? err) } };
  }
}
