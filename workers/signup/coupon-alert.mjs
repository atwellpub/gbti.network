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
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendCouponRedemptionAlert(env, record, { sendEmail } = {}) {
  try {
    const to = String(env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    // Unprovisioned is a no-op, not a failure: nothing to alert to, or no way to send.
    if (!to || !from) return { sent: false, reason: 'unconfigured' };
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };
    const { subject, text } = couponRedemptionNotice(record);
    await send({ from, to, subject, text });
    return { sent: true };
  } catch (err) {
    // Swallow: the grant is already written and the member is already signed up. A failed notice is recoverable
    // (the redemption record persists in KV); breaking signup to report it is not.
    return { sent: false, reason: 'error', message: err?.message ?? String(err) };
  }
}
