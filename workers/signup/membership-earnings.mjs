// SOW-083 P2: serve a member's OWN earnings ledger (earnings:<github_id>), computed + written by the offline payout
// job (scripts/payout-referrals.mjs buildEarningsLedger). Read-only GET, per-token (the member's own), never cached.
// Signed-in + non-banned (authorizeMemberCheap, Stripe-free); a free / non-earning member simply gets an empty
// ledger. The KV value holds github_ids + amounts only (no PII), so it composes cleanly with right-to-erasure.
import { authorizeMemberCheap } from './membership-content.mjs';
import { githubFetchUser } from './oauth.mjs';

export const EARNINGS_KEY = (githubId) => `earnings:${githubId}`;
const emptyLedger = (githubId) => ({ v: 1, recipient: githubId, entries: [], totals: { held: 0, payable: 0, paid: 0, lifetime: 0 }, payoutSetup: { connected: false, ready: false } });

export async function handleEarnings(request, env, { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, kv = env?.SIGNUP_KV, authorize = authorizeMemberCheap } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the earnings store is not configured' } };
  // Same ban-aware, Stripe-free gate as activity/follows: a banned account gets ZERO KV; an unverifiable token is 401.
  const a = await authorize(request, env, { fetchImpl, fetchUser, kv, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!a.ok) return { status: a.status, body: a.body };
  let ledger = null;
  try { ledger = await kv.get(EARNINGS_KEY(a.githubId), 'json'); } catch { ledger = null; }
  // SOW-083 P3: ensure payoutSetup (the Stripe Connect readiness the payout job records) is always present so the
  // dashboard can prompt setup; a real ledger's own payoutSetup overrides the default.
  return { status: 200, body: { payoutSetup: { connected: false, ready: false }, ...(ledger || emptyLedger(a.githubId)) } };
}
