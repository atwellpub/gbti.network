// SOW-166 / sow-157: plan the Stripe Customers that make the recovered members reachable.
//
// WHY THIS EXISTS. The owner ruled (2026-08-22) to enrol all 17 reachable members into the digest: the 2 who
// already have a Stripe Customer, and 15 whose addresses were recovered from the legacy WordPress dump. That
// ruling does not execute as the system stands. A `source: 'member'` subscriber record never stores an
// address; the drain resolves it from the member's Stripe Customer at send time. The 15 have no Customer, so
// enrolling them as member records produces records that resolve to null and never send. On paper the reach
// would read 17 of 22 and in the drain it would still be 2.
//
// So they need a Customer. A card-less Customer carrying `github_id` metadata is exactly what a no-card
// signup creates, so this makes them ordinary members everywhere rather than only reachable by email: the
// billing registry currently skips them entirely, which means reconcile's member gather, the erasure mail
// step and any Customer-keyed reminder all skip them too.
//
// THE PLANNER NEVER SEES AN ADDRESS, AND THAT IS THE POINT OF SPLITTING IT OUT. It is told only WHETHER one
// exists. The address is read from the dump and handed to Stripe at the moment of the POST and nowhere else,
// so it cannot reach a plan, a report, a log or a committed file, because there is no field in any of them
// that could hold it. A discipline you have to remember is one you eventually forget; this is the version
// that does not depend on remembering.

/** A member already has a Customer, has none but has a recoverable address, or has neither. */
export const CREATE_STATE = Object.freeze({
  CREATE: 'create',
  HAS_CUSTOMER: 'has-customer',
  NO_ADDRESS: 'no-address',
});

/**
 * Plan the Customer creations.
 *
 * @param {object[]} members            the unreachable members (from the enrolment plan's `unreachable`)
 * @param {Set} withAddress             github_ids for which an address was found. NOT the addresses.
 * @param {Set} existingCustomerIds     github_ids that already have a Stripe Customer
 */
export function planCustomerCreates({ members = [], withAddress = new Set(), existingCustomerIds = new Set() } = {}) {
  const plan = { create: [], alreadyHasCustomer: [], noAddress: [] };
  for (const m of members) {
    const githubId = String(m?.githubId ?? '').trim();
    if (!githubId) continue;
    const row = { githubId, githubLogin: m?.githubLogin ?? null, username: m?.username ?? null };
    // Checked FIRST so a member who acquired a Customer between the match and the run is never double-created,
    // independently of the idempotency key. The key protects a re-run of the same plan; this protects a plan
    // built against a stale read, which is the case the key cannot see.
    if (existingCustomerIds.has(githubId)) { plan.alreadyHasCustomer.push(row); continue; }
    if (!withAddress.has(githubId)) { plan.noAddress.push(row); continue; }
    plan.create.push(row);
  }
  return plan;
}

/**
 * The metadata for a recovered member's Customer. Mirrors the signup path's shape (`signup.mjs`
 * buildNewCustomerMetadata) so these Customers are indistinguishable from any other member's.
 *
 * NO `trial_started_at`, deliberately: the 90-day trial is retired, and a trial clock would make
 * deriveStatusFromCustomer return `expired` once it elapsed instead of `none`. Their access comes from the
 * grandfather grant either way (ban > staff > grandfather > Stripe), but `expired` is a visible lie on the
 * account page, so the honest derived value is the one with no clock.
 *
 * `signup_source` records WHERE this came from, because a Customer nobody can account for is worse than no
 * Customer: six months from now the only way to answer "why does this person have a billing record they
 * never created" is a field that says so.
 */
export function recoveredCustomerMetadata({ githubId, githubLogin } = {}) {
  const metadata = { github_id: String(githubId ?? '') };
  if (githubLogin) metadata.github_login = String(githubLogin).toLowerCase();
  metadata.signup_source = 'legacy-recovery';
  return metadata;
}

/** Mirrors signup.mjs:234, so a re-run of the same plan cannot double-create. */
export function createIdempotencyKey(githubId) {
  return `legacy-recovery:${String(githubId ?? '')}`;
}
