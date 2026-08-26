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
    // sow-279: the running per-code total INCLUDING this redemption, supplied by redeemCoupon which already
    // holds it. 0 means "not supplied" rather than "zero redemptions", since a record only exists because one
    // just happened; the notice therefore omits the line rather than printing a number it cannot stand behind.
    redemptionCount: Number(couponGrant.redemptionCount) > 0 ? Number(couponGrant.redemptionCount) : 0,
  };
}

/**
 * The owner-facing email for one new redemption. Pure projection of a record from newRedemptionRecord.
 * Carries no secret and no member email: only the public grant facts the owner needs to spot abuse.
 *
 * sow-279 `selfTest`: the weekly credential-health probe sends a real email through this same helper, so that
 * what is exercised weekly is the path a real redemption takes rather than a copy of it. The flag exists only
 * to make that email UNMISTAKABLE. A weekly notice that reads like a redemption would train the owner to
 * ignore the one line this control exists to make them read, which would break the alarm more thoroughly than
 * leaving it untested. Nothing else branches on it.
 * @returns `{ subject, text }`
 */
export function couponRedemptionNotice(record, { selfTest = false } = {}) {
  const code = record?.code ? String(record.code) : '(unknown code)';
  const campaign = record?.campaign ? String(record.campaign) : '';
  const login = record?.login ? String(record.login) : '(unknown github login)';
  const githubId = record?.githubId ? String(record.githubId) : '?';
  const tier = record?.tier ? String(record.tier) : 'member';
  const until = record?.until ? String(record.until) : '(no end date)';
  const redeemedAt = record?.redeemedAt ? String(record.redeemedAt) : '';
  // sow-279: house/coupons.yml asks for the running count so a BURST is legible without counting emails.
  // Omitted rather than guessed when it is absent or unusable: a wrong number here would be read as fact.
  const n = Number(record?.redemptionCount);
  const redemptionCount = Number.isFinite(n) && n > 0 ? n : 0;

  const subject = selfTest
    ? `[alarm self-test] Coupon redemption alarm is reachable (${code})`
    : `Coupon redeemed: ${code} by ${login}`;
  const lines = [
    selfTest
      ? 'THIS IS NOT A REDEMPTION. It is the scheduled self-test of the coupon-redemption alarm, and the'
      : 'A free-year coupon was just redeemed.',
    selfTest ? 'values below are synthetic. No grant was written and no member was touched.' : null,
    '',
    `Code:       ${code}`,
    campaign && campaign !== code ? `Campaign:   ${campaign}` : null,
    `Member:     ${login} (github_id ${githubId})`,
    `Tier:       ${tier}`,
    `Free until: ${until}`,
    redeemedAt ? `Redeemed:   ${redeemedAt}` : null,
    redemptionCount ? `Total:      ${redemptionCount} redemptions of this code, including this one` : null,
    '',
    selfTest ? 'Receiving this means the alarm can still reach you: the key, the sender domain and the address' : null,
    selfTest ? 'all work. Its ABSENCE is the signal, not its arrival, so a silent week is worth checking.' : null,
    !selfTest ? 'This is your standing record of every coupon redemption, the abuse control for the uncapped codes.' : null,
    !selfTest ? 'If this one looks wrong, set the code to active: false in house/coupons.yml.' : null,
    !selfTest && redemptionCount ? 'The count can lag by one under simultaneous redemptions; the emails are the record, not it.' : null,
  ].filter((line) => line !== null);
  return { subject, text: lines.join('\n') };
}
