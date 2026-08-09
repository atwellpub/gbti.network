// Thin Stripe REST client (no SDK, Cloudflare-Worker safe). Injectable `fetch` so every call is
// fixture-testable. Stripe wants application/x-www-form-urlencoded with bracket notation for nested
// objects and arrays (metadata[github_id]=..., expand[]=data.subscriptions). `findCustomerByGithubId`
// satisfies the deriveStatus() client contract in membership/derive-status.mjs.

export class StripeError extends Error {
  constructor(status, body) {
    super(`stripe error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

/** Flatten a nested object into Stripe's bracketed form pairs. */
export function toFormPairs(obj, prefix = '', pairs = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === 'object') toFormPairs(item, `${key}[]`, pairs);
        else pairs.push([`${key}[]`, String(item)]);
      }
    } else if (typeof v === 'object') {
      toFormPairs(v, key, pairs);
    } else {
      pairs.push([key, String(v)]);
    }
  }
  return pairs;
}

export function encodeForm(obj) {
  return toFormPairs(obj)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

export function createStripeClient({ apiKey, fetch = globalThis.fetch, baseUrl = 'https://api.stripe.com/v1' }) {
  if (!apiKey) throw new Error('createStripeClient: apiKey is required');

  async function req(method, path, params, { idempotencyKey } = {}) {
    const isGet = method === 'GET';
    const qs = params ? encodeForm(params) : '';
    const url = baseUrl + path + (isGet && qs ? `?${qs}` : '');
    const headers = { Authorization: `Bearer ${apiKey}` };
    if (!isGet) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    const res = await fetch(url, { method, headers, body: !isGet && qs ? qs : undefined });
    const text = await res.text();
    if (!res.ok) throw new StripeError(res.status, text);
    return text ? JSON.parse(text) : {};
  }

  const EXPAND_SUBS = { 'expand[]': 'data.subscriptions' };

  return {
    _req: req,

    /** Stripe Search (eventually consistent ~1 min). Returns the first match with subs expanded, or null. */
    async searchCustomerByGithubId(githubId) {
      const r = await req('GET', '/customers/search', {
        query: `metadata['github_id']:'${githubId}'`,
        limit: 1,
        ...EXPAND_SUBS,
      });
      return r.data?.[0] ?? null;
    },

    /** Consistent point lookup by customer id (used after a KV-index hit). */
    async getCustomer(customerId) {
      return req('GET', `/customers/${customerId}`, { 'expand[]': 'subscriptions' });
    },

    /** Satisfies the deriveStatus() client contract. */
    async findCustomerByGithubId(githubId) {
      return this.searchCustomerByGithubId(githubId);
    },

    /** Consistent iteration for the reconcile (NOT Search). Async-generates every customer with subs. */
    async *listCustomers({ limit = 100 } = {}) {
      let startingAfter;
      for (;;) {
        const page = await req('GET', '/customers', {
          limit,
          ...EXPAND_SUBS,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const c of page.data ?? []) yield c;
        if (!page.has_more || !page.data?.length) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    },

    /** Idempotent by github_id: pass an idempotencyKey to make retries safe. */
    async createCustomer({ email, metadata }, idempotencyKey) {
      return req('POST', '/customers', { ...(email ? { email } : {}), metadata }, { idempotencyKey });
    },

    async updateCustomer(customerId, { email, metadata }) {
      return req('POST', `/customers/${customerId}`, { ...(email ? { email } : {}), ...(metadata ? { metadata } : {}) });
    },

    /** SOW-024 right-to-erasure: permanently delete a Stripe Customer (removes the email + all metadata).
     *  Irreversible; the erasure tool only calls this behind an explicit --delete-stripe opt-in. Where tax-record
     *  retention forces a hold, anonymize via updateCustomer instead. Returns Stripe's { id, deleted } object. */
    async deleteCustomer(customerId) {
      return req('DELETE', `/customers/${customerId}`);
    },

    // ----- Catalog (products + prices): SETUP-ONLY. These MUTATE the account catalog, so they need a key with
    // Products + Prices WRITE scope, which the runtime restricted key deliberately lacks (least privilege). Used
    // by scripts/provision-stripe-prices.mjs, never by the Worker. The account MODE (test vs live) is the key's.
    async createProduct({ name, metadata } = {}) {
      return req('POST', '/products', { name, ...(metadata ? { metadata } : {}) });
    },
    /** Every product (active + archived), so a re-run reuses a product it created before by name. */
    async *listProducts({ limit = 100 } = {}) {
      let startingAfter;
      for (;;) {
        const page = await req('GET', '/products', { limit, ...(startingAfter ? { starting_after: startingAfter } : {}) });
        for (const p of page.data ?? []) yield p;
        if (!page.has_more || !page.data?.length) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    },
    /** A recurring price. Stripe prices are IMMUTABLE, so a re-run must reuse a match (see listPrices) rather
     *  than edit; this only ever creates. unitAmount is in the currency's minor unit (cents). */
    async createPrice({ product, unitAmount, currency = 'usd', interval, nickname, metadata } = {}) {
      return req('POST', '/prices', {
        product, currency, unit_amount: unitAmount, recurring: { interval },
        ...(nickname ? { nickname } : {}),
        ...(metadata ? { metadata } : {}),
      });
    },
    /** Active prices under a product, so provisioning can find an existing match and stay idempotent. */
    async *listPrices({ product, limit = 100 } = {}) {
      let startingAfter;
      for (;;) {
        const page = await req('GET', '/prices', { active: true, ...(product ? { product } : {}), limit, ...(startingAfter ? { starting_after: startingAfter } : {}) });
        for (const p of page.data ?? []) yield p;
        if (!page.has_more || !page.data?.length) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    },

    async createCheckoutSession({ customer, priceId, successUrl, cancelUrl, clientReferenceId, couponId }) {
      // SOW-119: couponId applies a STRIPE coupon to the session (a card-first discount path). The live
      // coupon flow (the no-card free year) never uses this; it exists for future card-first promotions.
      return req('POST', '/checkout/sessions', {
        mode: 'subscription',
        customer,
        success_url: successUrl,
        cancel_url: cancelUrl,
        'line_items': [{ price: priceId, quantity: 1 }],
        ...(clientReferenceId ? { client_reference_id: clientReferenceId } : {}),
        ...(couponId ? { discounts: [{ coupon: couponId }] } : {}),
      });
    },

    // ---- SOW-007 referral revenue-share: invoices, Connect onboarding, payout transfers ----

    /**
     * Async-generate a customer's invoices (default paid only) with the underlying charge expanded so
     * the commission ledger can read refunds/disputes without a second call. Consistent (list, not Search).
     */
    async *listInvoices({ customer, status = 'paid', limit = 100 } = {}) {
      let startingAfter;
      for (;;) {
        const page = await req('GET', '/invoices', {
          customer,
          ...(status ? { status } : {}),
          limit,
          'expand[]': 'data.charge',
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const inv of page.data ?? []) yield inv;
        if (!page.has_more || !page.data?.length) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    },

    /**
     * Async-generate Connect transfers, optionally filtered to one destination account. Used to find
     * which referral invoices have ALREADY been paid out (transfer.metadata.referral_invoice), so a
     * re-run never double-pays even after Stripe's 24h idempotency-key window has lapsed.
     */
    async *listTransfers({ destination, limit = 100 } = {}) {
      let startingAfter;
      for (;;) {
        const page = await req('GET', '/transfers', {
          ...(destination ? { destination } : {}),
          limit,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const t of page.data ?? []) yield t;
        if (!page.has_more || !page.data?.length) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    },

    /** Create a Connect Express account for a referrer to receive payouts (Stripe-hosted KYC). */
    async createConnectAccount({ email, metadata, type = 'express' } = {}) {
      return req('POST', '/accounts', {
        type,
        ...(email ? { email } : {}),
        ...(metadata ? { metadata } : {}),
        capabilities: { transfers: { requested: true } },
      });
    },

    /** Read a Connect account (to check details_submitted / payouts_enabled before paying out). */
    async getConnectAccount(accountId) {
      return req('GET', `/accounts/${accountId}`);
    },

    /** Create an onboarding Account Link (the Stripe-hosted Express onboarding URL the referrer visits). */
    async createAccountLink({ account, refreshUrl, returnUrl, type = 'account_onboarding' }) {
      return req('POST', '/account_links', {
        account,
        refresh_url: refreshUrl,
        return_url: returnUrl,
        type,
      });
    },

    /**
     * Create a Connect transfer (a referral payout). Pass an idempotencyKey to make in-run retries safe;
     * cross-run safety comes from the caller pre-checking listTransfers by metadata.referral_invoice.
     */
    async createTransfer({ amount, currency, destination, metadata, transferGroup }, idempotencyKey) {
      return req('POST', '/transfers', {
        amount,
        currency,
        destination,
        ...(metadata ? { metadata } : {}),
        ...(transferGroup ? { transfer_group: transferGroup } : {}),
      }, { idempotencyKey });
    },
  };
}
