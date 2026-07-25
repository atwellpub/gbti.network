// Checkout / conversion (membership-and-access.md section 3). The signed session identifies the
// member's github_id; we resolve their existing Stripe Customer (via the KV index, falling back to
// Search) and open a Stripe Checkout Session for the single annual price. Mode is subscription and
// there is NO trial_period_days: the 90-day evaluation already happened as a card-less trial, so the
// paid subscription bills immediately.
//
// Post-payment lag: rather than make the new member wait for the daily reconcile, the checkout
// success_url carries the github_id and points back at a Worker route that kicks a TARGETED re-gate
// for just that github_id (see kickRegate below). That nudge flips their held content PRs to
// mergeable and upgrades their Discord role right away. This is a cheap per-user dispatch, not a full
// real-time webhook.

/**
 * Resolve a member's Stripe customer id from the KV index first (instant + consistent), then fall
 * back to Search (eventually consistent). Returns the customer id or null. Fail closed: callers
 * treat null as "no checkout possible" rather than guessing.
 */
export async function resolveCustomerId({ githubId, kv, stripe }) {
  if (kv) {
    try {
      const cached = await kv.get(`gh:${githubId}`);
      if (cached) return cached;
    } catch {
      // fall through to Search
    }
  }
  try {
    const customer = await stripe.searchCustomerByGithubId(String(githubId));
    return customer?.id ?? null;
  } catch {
    return null; // fail closed
  }
}

/**
 * Build the success and cancel return URLs. The success URL carries the github_id and a re-gate token
 * so the success handler can kick the targeted nudge. The Stripe-provided {CHECKOUT_SESSION_ID}
 * template is appended so the success page can confirm the session if desired.
 */
export function buildReturnUrls({ baseUrl, githubId }) {
  const id = encodeURIComponent(String(githubId));
  return {
    successUrl: `${baseUrl}/checkout/success?gh=${id}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/account?checkout=cancelled`,
  };
}

/**
 * Create the Checkout Session for an existing customer + the annual price. No trial_period_days.
 * Returns the session object (the caller redirects to session.url).
 *
 * @param {object} a
 * @param {object} a.stripe    a createStripeClient() instance (frozen client).
 * @param {string} a.customerId the existing Stripe customer id (from resolveCustomerId).
 * @param {string} a.priceId    STRIPE_PRICE_ID (the annual $150 price).
 * @param {string} a.githubId   used to template the return URLs.
 * @param {string} a.baseUrl    the Worker public origin (no trailing slash).
 */
export async function createCheckout({ stripe, customerId, priceId, githubId, baseUrl }) {
  if (!customerId) throw new Error('createCheckout: customerId is required (resolve it from session first)');
  if (!priceId) throw new Error('createCheckout: priceId (STRIPE_PRICE_ID) is required');
  const { successUrl, cancelUrl } = buildReturnUrls({ baseUrl, githubId });
  return stripe.createCheckoutSession({
    customer: customerId,
    priceId,
    successUrl,
    cancelUrl,
    clientReferenceId: String(githubId), // so Stripe events tie back to the member
  });
}

/**
 * Kick a targeted re-gate for one github_id after a successful checkout return. Mechanism: a GitHub
 * repository_dispatch to the content repo with event_type "regate" and the github_id as the client
 * payload. The SOW-005 reconcile listens for that dispatch and reconciles ONLY that member: it
 * releases their held content PRs (flips the required check to pass) and upgrades their Discord role
 * from Trial to Member. This avoids waiting for the daily scheduled reconcile and needs no inbound
 * webhook endpoint. Injectable fetch; fail soft (a failed nudge is harmless because the daily
 * reconcile heals it, so we never block the user on it).
 *
 * @param {object} a
 * @param {string} a.githubId
 * @param {string} a.dispatchToken  a GitHub token with repository_dispatch permission (REGATE_DISPATCH_TOKEN).
 * @param {string} a.contentRepo    "owner/name" of the public content repo.
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>} true if the dispatch was accepted (204), false on any failure.
 */
export async function kickRegate({ githubId, dispatchToken, contentRepo }, fetchImpl = globalThis.fetch) {
  return kickDispatch({ eventType: 'regate', githubId, dispatchToken, contentRepo }, fetchImpl);
}

/**
 * The shared repository_dispatch sender (SOW-157): 'regate' (post-payment re-gate) and 'enroll' (hosted
 * authoring hit a member with no members-index entry) ride the same token + API. Fail soft: the daily
 * scheduled reconcile heals any missed nudge, so a failed dispatch never blocks the member.
 */
export async function kickDispatch({ eventType, githubId, dispatchToken, contentRepo }, fetchImpl = globalThis.fetch) {
  if (!eventType || !githubId || !dispatchToken || !contentRepo) return false;
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${contentRepo}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${dispatchToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-signup',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ event_type: String(eventType), client_payload: { github_id: String(githubId) } }),
    });
    return res.status === 204;
  } catch {
    return false; // fail soft; the daily reconcile heals any missed nudge
  }
}
