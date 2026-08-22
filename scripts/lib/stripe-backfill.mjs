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
export function recoveredCustomerMetadata({ githubId, githubLogin, discordUserId = null } = {}) {
  const metadata = { github_id: String(githubId ?? '') };
  if (githubLogin) metadata.github_login = String(githubLogin).toLowerCase();
  // `discord_user_id` IS AN ENFORCEMENT REQUIREMENT, NOT A CONVENIENCE, and omitting it is a regression this
  // backfill would otherwise INTRODUCE (found by @QAmaster). The two reconcile gathers source it differently:
  // the override-only path resolves it from the DISCORD_MENTION_OVERRIDES login-to-id map, while the
  // Stripe-customer path reads it straight off `meta.discord_user_id`. The moment a member acquires a
  // Customer they move from the first path to the second, so a Customer without this field resolves a null
  // discord id and THE PLANNER EMITS NO DISCORD ACTION FOR THEM AT ALL.
  //
  // Measured consequence: a banned member loses `discord:add-role:locked` entirely after the backfill. Not a
  // wrong role, no action, nothing errors, and they keep whatever role they already hold. Content-side
  // enforcement still applies, so it is a half-failure rather than an outright bypass, which is exactly the
  // kind that survives a review.
  if (discordUserId) metadata.discord_user_id = String(discordUserId);
  metadata.signup_source = 'legacy-recovery';
  return metadata;
}

/**
 * Create one recovered member's Customer and its `gh:` index entry, IN THAT ORDER.
 *
 * THIS DELIBERATELY DOES NOT WRITE THE SUBSCRIBER RECORD, and that is a change from how the work was briefed
 * (@SowMaster asked for create, then index, then subscriber last). The hazard behind that brief is real and
 * worth restating: a subscriber record written before its Customer exists is one the drain can never resolve
 * an address for, and the enrolment planner's `alreadyEnrolled` check makes every later run SKIP it, so it
 * stays dead and silent forever. Ordering it last manages that hazard. Not writing it here REMOVES it, which
 * is strictly better, because there is then no interleaving of these two writes that can produce an orphan.
 *
 * The separation buys a second thing. Creating a billing record is not sending mail, so it does not need the
 * unsubscribe-proven gate, whereas enrolment does and must keep it. Fusing them would have put Customer
 * creation behind mail provisioning that has not happened yet, delaying the one part that is ready. So this
 * script makes the fifteen REACHABLE, and `scripts/mail-enroll.mjs --apply` enrols them afterwards through
 * the single gated path that every other member goes through. That path resolves their address from Stripe
 * exactly as it does for everybody else, so they need no special case in it.
 *
 * THE ORDER OF THE TWO WRITES THAT REMAIN IS STILL THE CONTRACT. Both are idempotent, so every interruption
 * point is safely re-runnable, and an orphaned Customer is harmless because the idempotency key makes the
 * re-run reuse it rather than create a second.
 *
 * THE `gh:` INDEX IS NOT OPTIONAL. `signup.mjs:241` writes `gh:<github_id> -> customerId` as the index that
 * beats Stripe Search's indexing lag, because signup is find-before-create and Search can still be cold. Skip
 * it here and the next REAL signup by one of these members can miss on that lag and create a SECOND Customer
 * for the same `github_id`, after which `findCustomerByGithubId` returns whichever Search ranks first and
 * `gatherMembers` yields the member twice.
 *
 * `email` is passed straight through to Stripe and is never stored, logged or returned. The caller resolves it
 * immediately before this call and lets it go out of scope immediately after.
 */
export async function createRecoveredCustomer({ row, email, discordUserId = null, stripe, kv } = {}) {
  const githubId = String(row?.githubId ?? '');
  if (!githubId) throw new Error('createRecoveredCustomer: githubId is required');
  if (!email) throw new Error('createRecoveredCustomer: refusing to create a Customer with no address');

  const metadata = recoveredCustomerMetadata({ githubId, githubLogin: row.githubLogin, discordUserId });
  const customer = await stripe.createCustomer({ email, metadata }, createIdempotencyKey(githubId));
  const customerId = customer?.id ?? null;
  if (!customerId) throw new Error(`createRecoveredCustomer: Stripe returned no customer id for ${githubId}`);

  // Second, never first: an index entry pointing at a Customer that does not exist is worse than none.
  //
  // A REFUSED WRITE IS A FAILURE HERE, NOT A NO-OP. `putKvValue` returns `{written: false}` rather than
  // throwing when the Cloudflare credentials are absent, which is the right shape for a reporting step and
  // the wrong one for this: it would leave a real Customer with no index entry while the run printed a
  // success. So the caller's `put` is required to report, and anything other than a write raises.
  const wrote = await kv.put(`gh:${githubId}`, customerId);
  if (wrote && wrote.written === false) {
    throw new Error(
      `createRecoveredCustomer: created Customer ${customerId} for github_id ${githubId} but the gh: index `
      + `write did not happen (${wrote.reason ?? 'unknown reason'}). Set the Cloudflare credentials and `
      + 're-run: the Customer is idempotent, so the re-run reuses it and completes the index.',
    );
  }
  return { githubId, customerId };
}

/** Mirrors signup.mjs:234, so a re-run of the same plan cannot double-create. */
export function createIdempotencyKey(githubId) {
  return `legacy-recovery:${String(githubId ?? '')}`;
}
