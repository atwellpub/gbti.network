// The owner-facing "new digest subscriber" notice. One PURE helper, node-free (no fetch, no KV), so the copy is
// unit-tested without a network. Mirrors membership/coupon-notify.mjs.
//
// WHY THIS EXISTS. The owner asked to be told when a new subscriber joins the weekly digest. With double opt-in
// disabled (MAIL_DOUBLE_OPTIN = "false") a subscriber becomes active at submit; with it on, at confirm. Either
// way the Worker fires this notice ONCE per genuinely new active subscriber (never on an idempotent re-subscribe).
//
// The address goes to the OWNER'S OWN inbox (the data controller), which is why it is included in full: it lets
// the owner spot a junk or third-party signup. When the address cannot be recovered (a confirm-path decrypt that
// fails), the notice still sends with the address omitted, because "a subscriber joined" is the useful signal.

/**
 * The owner-facing email for one new subscriber. Pure projection.
 * @param email   the subscriber's address, or '' / null when it could not be resolved.
 * @param source  'anon' (a public digest CTA) or 'member' (a signed-in enrollment).
 * @param at      an ISO instant string for when the subscriber became active (optional).
 * @returns `{ subject, text }`
 */
export function newSubscriberNotice({ email, source, at } = {}) {
  const addr = email ? String(email).trim() : '';
  const src = source ? String(source).trim() : 'anon';
  const when = at ? String(at).trim() : '';

  const subject = addr ? `New digest subscriber: ${addr}` : 'New digest subscriber';
  const lines = [
    'A new subscriber joined the GBTI Network weekly digest.',
    '',
    `Email:  ${addr || '(address unavailable)'}`,
    `Source: ${src === 'member' ? 'member (signed-in enrollment)' : 'public digest form'}`,
    when ? `When:   ${when}` : null,
    '',
    'This notice fires once per new subscriber. Manage the list from the admin mail tools.',
  ].filter((line) => line !== null);
  return { subject, text: lines.join('\n') };
}
