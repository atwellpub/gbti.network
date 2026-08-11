// sow-212: reset ONE test account's signup state so the signup + coupon flow can be run again.
//
// Signup is deliberately one-shot per GitHub account. Three guards make it so, and all three are correct:
//   1. the Stripe Customer is reused and NEVER resets trial_started_at (workers/signup/signup.mjs),
//   2. `coupon-grant:<githubId>` is a permanent "one coupon per member, ever" lock (workers/signup/coupons.mjs),
//   3. the daily reconcile FOLDS the redemption into house/grandfathered.yml, which then outranks Stripe in
//      the ban > staff > grandfather > Stripe precedence (scripts/lib/coupon-grants.mjs).
//
// Guard 3 is the one that makes a KV-only reset useless: leave the folded grant in place and the account stays
// effective-paid for a year, so the next test run reads as already-paid before the coupon is even redeemed.
// That is why this tool opens a PR and is not purely a set of KV deletes.
//
// THIS TOOL DELETES MEMBERSHIP STATE. Treat it like `reconcile --apply`. Dry-run is the default.
//
// It does NOT weaken any production guard. Signup keeps its idempotency exactly as it is; this removes state
// afterwards. There is no bypass added to the signup path, and adding one would be the wrong fix.
//
// Every destructive primitive is REUSED from scripts/lib/erase-member.mjs rather than reimplemented, so a
// reset and an erasure can never drift about what belongs to a member.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import {
  eraseActivity, eraseFollows, erasePrefs, eraseDrafts, eraseLookupCache, eraseConversionSnapshot,
  eraseCouponGrant, eraseCouponLock, eraseCouponRedemptions, eraseStripeCustomer, eraseContent,
} from './erase-member.mjs';
import { buildAuditRecord, storeAuditRecord } from './erase-audit.mjs';

export const TEST_ACCOUNTS_PATH = 'house/test-accounts.yml';
export const RESET_AUDIT_KIND = 'test-reset-audit';

/**
 * Pure: the github_ids allowed to be reset, from a parsed test-accounts.yml. Anything malformed yields an
 * EMPTY set rather than a partial one: a half-read allowlist that still admits somebody is worse than one
 * that admits nobody, because the failure is invisible.
 */
export function allowedTestIds(parsed) {
  const rows = parsed?.test_accounts;
  if (!Array.isArray(rows)) return new Set();
  const ids = new Set();
  for (const r of rows) {
    const id = String(r?.github_id ?? '').trim();
    if (/^\d+$/.test(id)) ids.add(id);
  }
  return ids;
}

/** Read + parse house/test-accounts.yml from a checkout. A missing file is an empty allowlist, not a throw. */
export function readTestAccounts(root) {
  const file = path.join(root, TEST_ACCOUNTS_PATH);
  if (!fs.existsSync(file)) return new Set();
  try {
    return allowedTestIds(yaml.load(fs.readFileSync(file, 'utf8')));
  } catch {
    return new Set(); // an unparseable allowlist admits nobody
  }
}

/**
 * Pure: is this Stripe key safe for a destructive test run? Only test-mode keys are. An ABSENT key is
 * allowed (the Stripe step then reports a no-op), a live key is refused outright.
 *
 * There is deliberately no override flag. When production Stripe stops being `rk_test`, this tool stops
 * working, which is the correct failure: the alternative is a tool that quietly gains the ability to delete
 * a paying customer on the day the owner provisions live billing.
 */
export function stripeKeyMode(key) {
  if (!key) return 'absent';
  return /^(rk|sk)_test_/.test(String(key)) ? 'test' : 'live';
}

/**
 * Pure: every reason this run must not proceed. Returns an array of refusal strings; empty means allowed.
 * Computed BEFORE any write, and the caller must treat a non-empty result as fatal.
 */
export function refusalsFor({ githubId, allowedIds, env = {} } = {}) {
  const refusals = [];
  const id = String(githubId ?? '').trim();
  if (!/^\d+$/.test(id)) {
    refusals.push(`"${githubId}" is not a numeric github_id`);
    return refusals;
  }
  if (!allowedIds || !allowedIds.has(id)) {
    refusals.push(
      `github_id ${id} is not in ${TEST_ACCOUNTS_PATH}. Add it there (a reviewed change) before resetting it. ` +
      'This allowlist is the only thing standing between this tool and a real member.',
    );
  }
  const mode = stripeKeyMode(env.STRIPE_SECRET_KEY);
  if (mode === 'live') {
    refusals.push('STRIPE_SECRET_KEY is a LIVE-mode key. This tool only runs against test-mode Stripe.');
  }
  return refusals;
}

/**
 * Pure: a warning is something the operator should SEE but which must not stop the run. The members-index
 * entry is the load-bearing example: sow-212 originally proposed refusing when an id appears there, but a
 * successful test signup ENROLLS itself into that file (scripts/lib/enroll-members.mjs), so that refusal
 * would fire in exactly the case this tool exists for. It is a warning; the allowlist carries the safety.
 */
export function warningsFor({ githubId, membersIndexParsed = null } = {}) {
  const warnings = [];
  const id = String(githubId);
  if (membersIndexParsed?.members && Object.prototype.hasOwnProperty.call(membersIndexParsed.members, id)) {
    warnings.push(`github_id ${id} has a members-index entry (${membersIndexParsed.members[id]}). Expected after a test signup; it will be removed.`);
  }
  return warnings;
}

/** Pure: the ordered reset plan, for the dry-run print. Mirrors planErasure's shape. */
export function planReset({ githubId, withContent = false } = {}) {
  const id = String(githubId);
  return [
    { step: 'coupon-grant', action: `Delete coupon-grant:${id} (the one-coupon-per-member lock). This is what blocks re-redeeming.` },
    { step: 'coupon-lock', action: 'Delete the minimized (hashed) lock left by a prior erasure, if any. Needs COUPON_LOCK_KEY.' },
    { step: 'coupon-redemptions', action: `Delete every redemption:<CODE>:${id} and DECREMENT each shared redemptions:<CODE> counter.` },
    { step: 'lookup-cache', action: `Delete gh:${id} (the github_id -> Stripe customer lookup cache).` },
    { step: 'conv-snapshot', action: `Delete conv:${id} (the frozen conversion attribution snapshot).` },
    { step: 'activity', action: `Delete activity:${id}, follows:${id}, prefs:${id}, drafts:${id}.` },
    { step: 'stripe', action: 'Delete the TEST-MODE Stripe customer. This is what resets trial_started_at; without it the trial clock stays set.' },
    { step: 'house-records', action: `One auto-merged PR removing the house/grandfathered.yml grant and the members-index entry${withContent ? ', and drafting their content' : ''}.` },
    { step: 'audit', action: `Record the reset to the audit log as kind=${RESET_AUDIT_KIND} (never confused with a real erasure).` },
  ];
}

/**
 * The reset orchestrator. Refuses first, then on --apply runs the steps and records ONE audit entry.
 * Each step is fail-isolated exactly as runErasure does, so one failure never hides the rest.
 *
 * Returns { refused, refusals } | { apply:false, plan, warnings } | { apply:true, steps, audit, record }.
 */
export async function runReset({
  githubId, allowedIds, apply = false, withContent = false, operator = null,
  env = process.env, fetchImpl = globalThis.fetch, clients = {}, files = [],
  membersIndexParsed = null, now = new Date(),
} = {}) {
  const refusals = refusalsFor({ githubId, allowedIds, env });
  if (refusals.length) return { refused: true, refusals };

  const warnings = warningsFor({ githubId, membersIndexParsed });
  if (!apply) return { apply: false, plan: planReset({ githubId, withContent }), warnings };

  const { stripe = null, github = null } = clients;
  const steps = [];
  const runStep = async (name, fn) => {
    let res;
    try { res = await fn(); } catch (e) { res = { error: e?.message || String(e) }; }
    steps.push(summarize(name, res));
    return res;
  };

  await runStep('coupon-grant', () => eraseCouponGrant({ githubId, env, fetchImpl }));
  // Also clear the MINIMIZED lock, for a test account that was erased before it was reset. Erasure replaces
  // the raw grant with a keyed hash (owner ruling: the lock survives erasure), so without this a previously
  // erased test account would stay permanently unredeemable and look like a broken coupon.
  await runStep('coupon-lock', () => eraseCouponLock({ githubId, env, fetchImpl }));
  await runStep('coupon-redemptions', () => eraseCouponRedemptions({ githubId, env, fetchImpl }));
  await runStep('lookup-cache', () => eraseLookupCache({ githubId, env, fetchImpl }));
  await runStep('conv-snapshot', () => eraseConversionSnapshot({ githubId, env, fetchImpl }));
  await runStep('activity', () => eraseActivity({ githubId, env, fetchImpl }));
  await runStep('follows', () => eraseFollows({ githubId, env, fetchImpl }));
  await runStep('prefs', () => erasePrefs({ githubId, env, fetchImpl }));
  await runStep('drafts', () => eraseDrafts({ githubId, env, fetchImpl }));
  await runStep('stripe', () => eraseStripeCustomer({ githubId, stripe }));
  // files stays EMPTY unless --with-content: eraseContent then removes the two house records and flips
  // nothing, which is the reset we want. The content flip is opt-in because it buys no coverage of the
  // signup flow and multiplies what a mistake costs.
  await runStep('house-records', () => eraseContent({ github, githubId, username: null, files: withContent ? files : [], now }));

  const record = buildAuditRecord({ githubId, operator, apply: true, steps, now, kind: RESET_AUDIT_KIND });
  let audit;
  try { audit = await storeAuditRecord({ record, env, fetchImpl }); }
  catch (e) { audit = { recorded: false, reason: `audit write failed: ${e?.message || e}` }; }
  return { apply: true, steps, audit, record, warnings };
}

/** Reduce a step result to its identity-free outcome. Mirrors erase-member's summarizeStep. */
function summarize(step, res) {
  if (res?.error) return { step, outcome: 'error', detail: String(res.error).slice(0, 120) };
  if (res?.skipped) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === false) return { step, outcome: 'skipped', detail: res.reason };
  if (res?.deleted === true) return { step, outcome: 'deleted' };
  if (res?.deletedCustomer) return { step, outcome: 'deleted' };
  if (typeof res?.scrubbed === 'number') return { step, outcome: res.scrubbed ? 'deleted' : 'skipped', detail: `records:${res.scrubbed}` };
  if (typeof res?.flipped === 'number') {
    return { step, outcome: 'removed', detail: `pr#${res.pr} index:${res.indexRemoved ? 'removed' : 'kept'} grant:${res.grantRemoved ? 'removed' : 'kept'}` };
  }
  return { step, outcome: 'ok' };
}
