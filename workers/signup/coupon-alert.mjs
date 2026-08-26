// sow-279: send the owner the coupon-redemption notice. FAIL-SOFT BY CONTRACT. This runs on the signup
// completion path, so it must never throw and never gate: a notice failing (or being unprovisioned) leaves the
// member fully signed up. The caller fires it through ctx.waitUntil, so it also does not delay the redirect.
//
// Inert until provisioned: with COUPON_ALERT_EMAIL unset (or the Resend send unconfigured) this is a no-op,
// matching how the rest of the mail path degrades. The signup gate stays fail-CLOSED elsewhere; only this
// notice is fail-soft, because it reports on a grant that has already been written.
import { createResendClient } from '../../clients/resend.mjs';
import { couponRedemptionNotice } from '../../membership/coupon-notify.mjs';

/**
 * @param env     the Worker env: reads COUPON_ALERT_EMAIL (recipient), MAIL_FROM/RESEND_FROM (sender, already
 *                on the Resend-verified domain), RESEND_API_KEY.
 * @param record  a NEW-redemption record from newRedemptionRecord (never null here; the caller gates on it).
 * @param sendEmail  optional injected sender for tests; defaults to the real Resend client.
 * @param selfTest   marks the email as the scheduled reachability probe rather than a real redemption. The
 *                   weekly credential-health check calls THIS function, not a copy of it, so the thing proven
 *                   working every Monday is the same path a redemption takes. See scripts/check-credentials.mjs.
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendCouponRedemptionAlert(env, record, { sendEmail, selfTest = false } = {}) {
  try {
    const to = String(env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    // Unprovisioned is a no-op, not a failure: nothing to alert to, or no way to send. It is EXPECTED in
    // sandbox, which deliberately leaves COUPON_ALERT_EMAIL unset so test redemptions do not mail. It is a
    // real problem in production, where the var is set in wrangler.toml, so say so rather than returning
    // quietly: an unconfigured alarm and a working one are otherwise indistinguishable from the outside.
    if (!to || !from) { warnUnconfigured(record, 'no recipient or no sender'); return { sent: false, reason: 'unconfigured' }; }
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) { warnUnconfigured(record, 'no RESEND_API_KEY and no injected sender'); return { sent: false, reason: 'unconfigured' }; }
    // BOTH bodies go to the sender. The html is what the owner actually reads in a modern client, and the text
    // is the fallback a plain-text client (or a spam filter comparing the parts) gets. Building the html and
    // then not passing it here is the exact way this has broken before: the builder is in another file, so
    // nothing about a correct-looking couponRedemptionNotice would reveal that the email left as plain text.
    // test/coupon-alert.test.mjs asserts on what reaches `send`, not on what the builder returns, for that
    // reason. The Resend client omits an empty html rather than sending a blank part.
    const { subject, text, html } = couponRedemptionNotice(record, { selfTest });
    await send({ from, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    // Swallow: the grant is already written and the member is already signed up. A failed notice is recoverable
    // (the redemption record persists in KV); breaking signup to report it is not.
    //
    // BUT SWALLOWING IS NOT THE SAME AS SAYING NOTHING, and until 2026-08-26 this did both. `house/coupons.yml`
    // requires this notice to fail LOUDLY, precisely because it is the ONLY control on the uncapped codes rather
    // than one of several. The caller fires it through `ctx.waitUntil` and discards the resolved value, so a
    // send that Resend rejects produced no email, no log and no trace: identical, from the outside, to a code
    // that was never redeemed. Log it here rather than at the call site so every caller inherits it.
    const message = err?.message ?? String(err);
    console.warn(`coupon-alert: notice FAILED for code ${codeOf(record)} / github_id ${idOf(record)}: ${message}. `
      + 'The grant IS written and the redemption record persists in KV, so this is recoverable, but nobody was told.');
    return { sent: false, reason: 'error', message };
  }
}

// Kept tiny and separate so the two unconfigured branches cannot drift apart, and so a record with no code or no
// github_id still produces a readable line rather than "undefined".
function codeOf(record) { return record?.code ? String(record.code) : '(unknown code)'; }
function idOf(record) { return record?.githubId ? String(record.githubId) : '?'; }

function warnUnconfigured(record, why) {
  console.warn(`coupon-alert: notice NOT SENT for code ${codeOf(record)} / github_id ${idOf(record)}: ${why}. `
    + 'Expected in sandbox; in production it means the alarm on the uncapped codes is off.');
}
