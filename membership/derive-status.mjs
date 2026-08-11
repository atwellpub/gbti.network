// Canonical membership status derivation (SOW-002 / SOW-005).
// Mirrors .data/specs/membership-and-access.md section 2. Fail closed: any missing customer or
// lookup error resolves to "none" (treated as unpaid). Shared by the PR-gate and the reconcile so
// the two can never diverge. No Stripe SDK is imported here; callers inject a thin client, which
// keeps every branch testable against fixtures.

import { TIER, tierForSubscription } from './tiers.mjs';

export const TRIAL_DAYS = 90;
const TRIAL_MS = TRIAL_DAYS * 24 * 60 * 60 * 1000;

const PAID_SUB_STATUSES = new Set(['active', 'past_due']); // past_due = dunning grace, keep access
const DEAD_SUB_STATUSES = new Set(['canceled', 'unpaid', 'incomplete_expired']);

// Possible derived statuses (before git-native overrides are applied):
//   paid | trialing | expired | cancelled | none
export const STATUS = Object.freeze({
  paid: 'paid',
  trialing: 'trialing',
  expired: 'expired',
  cancelled: 'cancelled',
  none: 'none',
});

/** Normalize a customer's subscriptions whether they arrive as a Stripe list ({data:[...]}) or array. */
export function subscriptionsOf(customer) {
  if (!customer) return [];
  const s = customer.subscriptions;
  if (!s) return [];
  if (Array.isArray(s)) return s;
  if (Array.isArray(s.data)) return s.data;
  return [];
}

/** Pick the subscription that decides paid state: prefer an active/past_due one, else the newest. */
export function mostRelevantSubscription(subs) {
  if (!subs || subs.length === 0) return null;
  const ranked = [...subs].sort((a, b) => {
    const aPaid = PAID_SUB_STATUSES.has(a.status) ? 1 : 0;
    const bPaid = PAID_SUB_STATUSES.has(b.status) ? 1 : 0;
    if (aPaid !== bPaid) return bPaid - aPaid; // paid-ish first
    return (b.created ?? 0) - (a.created ?? 0); // then newest
  });
  return ranked[0];
}

/**
 * Pure status derivation from a fully-formed Stripe Customer object (subscriptions expanded).
 * Used directly by the reconcile, which already has each customer in hand.
 */
export function deriveStatusFromCustomer(customer, now = new Date()) {
  if (!customer) return STATUS.none;
  const sub = mostRelevantSubscription(subscriptionsOf(customer));
  if (sub) {
    if (PAID_SUB_STATUSES.has(sub.status)) return STATUS.paid;
    if (DEAD_SUB_STATUSES.has(sub.status)) return STATUS.cancelled;
    // 'incomplete' / 'trialing' (unused) fall through to the trial-clock check below.
  }
  // The 90-day trial is RETIRED (owner, 2026-08-11). Signup no longer writes trial_started_at, so no NEW
  // customer reaches this branch. It stays for the members whose clocks were already running: they finish
  // their 90 days rather than being cut mid-trial, and this is what keeps them resolving correctly until
  // they age out. Remove it in the phase-3 cleanup, once no live account can be trialing.
  const startedRaw = customer.metadata?.trial_started_at;
  if (startedRaw) {
    const started = new Date(startedRaw);
    if (!Number.isNaN(started.getTime()) && now.getTime() < started.getTime() + TRIAL_MS) {
      return STATUS.trialing;
    }
    return STATUS.expired; // their trial ran out: `expired` is the honest word for it
  }
  // No subscription and no trial clock: a FREE member. Nothing expired, because they never had anything, so
  // `expired` would be a lie told to every new signup (and account.astro renders it literally as "Expired").
  // `none` already means exactly this state and is already labelled "No active membership".
  return STATUS.none;
}

/**
 * Look up a customer by immutable github_id and derive status. Fail closed on null / error.
 * `client` must implement: findCustomerByGithubId(githubId) -> customer | null (may throw).
 */
export async function deriveStatus(githubId, client, now = new Date()) {
  let customer;
  try {
    customer = await client.findCustomerByGithubId(String(githubId));
  } catch {
    return STATUS.none; // fail closed
  }
  if (!customer) return STATUS.none;
  return deriveStatusFromCustomer(customer, now);
}

// ---------------------------------------------------------------------------------------------------
// sow-185 phase 1: the TIER axis, added ALONGSIDE the status axis rather than folded into it.
//
// deriveStatus keeps its exact signature and string return, so all fourteen authorizePaid routes, classify-pr,
// reconcile and every existing test are untouched. Tier-aware callers opt in by calling deriveMembership
// instead. That is what lets phase 1 ship inert: nothing GATES on tier yet, so a tier that resolves wrongly
// cannot deny anyone. Phase 2 turns the gates on, after the resolution has been checked against real Stripe
// data (the repo's fixtures carry no price id, so tier extraction is unverified against production shapes).
// ---------------------------------------------------------------------------------------------------

/**
 * Derive BOTH axes from a customer: `{ status, tier }`.
 *
 * The tier is read from the same subscription that decided the status, so the two can never disagree about
 * which subscription is authoritative. A non-paid status forces tier `none`: a lapsed or trialing customer
 * holds no tier privileges regardless of what they once bought, which keeps "what did they buy" from leaking
 * past "are they currently paying".
 */
export function deriveMembershipFromCustomer(customer, { priceTierMap = null, now = new Date() } = {}) {
  const status = deriveStatusFromCustomer(customer, now);
  if (status !== STATUS.paid) return { status, tier: TIER.none };
  const sub = mostRelevantSubscription(subscriptionsOf(customer));
  return { status, tier: tierForSubscription(sub, priceTierMap) };
}

/**
 * Look up a customer and derive `{ status, tier }`. Fails closed to `{ status: 'none', tier: 'none' }` on a
 * missing customer or any lookup error, mirroring deriveStatus exactly.
 */
export async function deriveMembership(githubId, client, { priceTierMap = null, now = new Date() } = {}) {
  let customer;
  try {
    customer = await client.findCustomerByGithubId(String(githubId));
  } catch {
    return { status: STATUS.none, tier: TIER.none }; // fail closed
  }
  if (!customer) return { status: STATUS.none, tier: TIER.none };
  return deriveMembershipFromCustomer(customer, { priceTierMap, now });
}
