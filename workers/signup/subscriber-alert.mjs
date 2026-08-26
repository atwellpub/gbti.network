// Send the owner the "new digest subscriber" notice. FAIL-SOFT BY CONTRACT, exactly like coupon-alert.mjs: it
// runs on the subscribe/confirm path, so it must never throw and never gate. A subscriber is already active by
// the time this fires; a failed or unprovisioned notice must not undo that or 500 the request.
//
// Inert until provisioned: with no recipient (ADMIN_ALERT_EMAIL, falling back to COUPON_ALERT_EMAIL) or no
// sender, this is a no-op, matching how the rest of the mail path degrades.
import { createResendClient } from '../../clients/resend.mjs';
import { newSubscriberNotice } from '../../membership/subscriber-notify.mjs';

/**
 * @param env     the Worker env: reads ADMIN_ALERT_EMAIL || COUPON_ALERT_EMAIL (recipient), MAIL_FROM/RESEND_FROM
 *                (sender, already on the Resend-verified domain), RESEND_API_KEY.
 * @param info    `{ email, source, at }` for the new subscriber (email may be '' when it could not be resolved).
 * @param sendEmail  optional injected sender for tests; defaults to the real Resend client.
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendNewSubscriberAlert(env, info = {}, { sendEmail } = {}) {
  try {
    const to = String(env?.ADMIN_ALERT_EMAIL || env?.COUPON_ALERT_EMAIL || '').trim();
    const from = String(env?.MAIL_FROM || env?.RESEND_FROM || '').trim();
    const apiKey = String(env?.RESEND_API_KEY || '').trim();
    // Unprovisioned is a no-op, not a failure: nothing to alert to, or no way to send.
    if (!to || !from) return { sent: false, reason: 'unconfigured' };
    const send = sendEmail || (apiKey ? createResendClient({ apiKey }).sendEmail : null);
    if (!send) return { sent: false, reason: 'unconfigured' };
    const { subject, text } = newSubscriberNotice(info);
    await send({ from, to, subject, text });
    return { sent: true };
  } catch (err) {
    // Swallow: the subscriber is already active. A failed notice is recoverable (the subscriber record persists);
    // breaking the subscribe/confirm response to report it is not.
    return { sent: false, reason: 'error', message: err?.message ?? String(err) };
  }
}
