// sow-279: the owner-facing coupon-redemption notice. Two PURE helpers, node-free (no fetch, no KV), so the
// decision ("did a NEW grant happen, and what does the owner read") is unit-tested without a network.
//
// WHY THIS EXISTS. Every live free-year coupon is UNCAPPED (house/coupons.yml carries maxRedemptions: null on
// all three). The owner ruling of 2026-08-11 made an owner notification on each redemption the compensating
// abuse control for that: Turnstile and the IP rate limit stop a flood, and this is how a slow, deliberate
// abuse of an uncapped code becomes visible in time to deactivate it. The Worker fires the notice; these
// helpers own the two decisions it must get right.
//
// FIRE EXACTLY ONCE PER MEMBER. redeemCoupon returns { ...record, already } and is idempotent: the signup
// chain runs it twice (the GitHub leg, then the deferred Discord leg), and the second run returns
// `already: true` against the grant the first wrote. newRedemptionRecord returns a record ONLY for a
// genuinely new grant, so the caller notifies on the GitHub leg and never on the Discord re-run.

/**
 * The record to notify on, or null when there is nothing new to announce.
 * @param couponGrant the redeemCoupon result: `{ code, campaign?, tier?, until, redeemedAt, login?, already }`,
 *                    or null when no redemption happened.
 * @param identity    `{ githubId, login? }` from the signup, so the notice can name the member even when the
 *                    grant record omitted the login.
 * @returns `{ code, campaign, tier, until, redeemedAt, login, githubId }` for a NEW grant, else null.
 */
export function newRedemptionRecord(couponGrant, { githubId, login = null } = {}) {
  // Null (no redemption) or an idempotent re-run (already === true) is nothing to announce. Anything else is a
  // grant written in THIS run.
  if (!couponGrant || couponGrant.already === true || !couponGrant.until) return null;
  return {
    code: couponGrant.code ? String(couponGrant.code) : '',
    campaign: couponGrant.campaign ? String(couponGrant.campaign) : (couponGrant.code ? String(couponGrant.code) : ''),
    tier: couponGrant.tier ? String(couponGrant.tier) : 'member',
    until: couponGrant.until ? String(couponGrant.until) : '',
    redeemedAt: couponGrant.redeemedAt ? String(couponGrant.redeemedAt) : '',
    login: couponGrant.login ? String(couponGrant.login) : (login ? String(login) : ''),
    githubId: githubId === undefined || githubId === null ? '' : String(githubId),
  };
}

/**
 * The owner-facing email for one new redemption. Pure projection of a record from newRedemptionRecord.
 * Carries no secret and no member email: only the public grant facts the owner needs to spot abuse.
 * @returns `{ subject, text }`
 */
export function couponRedemptionNotice(record) {
  const code = record?.code ? String(record.code) : '(unknown code)';
  const campaign = record?.campaign ? String(record.campaign) : '';
  const login = record?.login ? String(record.login) : '(unknown github login)';
  const githubId = record?.githubId ? String(record.githubId) : '?';
  const tier = record?.tier ? String(record.tier) : 'member';
  const until = record?.until ? String(record.until) : '(no end date)';
  const redeemedAt = record?.redeemedAt ? String(record.redeemedAt) : '';

  const subject = `Coupon redeemed: ${code} by ${login}`;
  const lines = [
    'A free-year coupon was just redeemed.',
    '',
    `Code:       ${code}`,
    campaign && campaign !== code ? `Campaign:   ${campaign}` : null,
    `Member:     ${login} (github_id ${githubId})`,
    `Tier:       ${tier}`,
    `Free until: ${until}`,
    redeemedAt ? `Redeemed:   ${redeemedAt}` : null,
    '',
    'This is your standing record of every coupon redemption, the abuse control for the uncapped codes.',
    'If this one looks wrong, set the code to active: false in house/coupons.yml.',
  ].filter((line) => line !== null);
  return { subject, text: lines.join('\n') };
}
