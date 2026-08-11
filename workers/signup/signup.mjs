// Signup orchestration (membership-and-access.md section 3). Given the identity already resolved by
// the two OAuth callbacks (github_id + login, discord_user_id + email + access_token), this:
//   1. creates OR reuses the Stripe Customer keyed by the immutable github_id (idempotent),
//   2. NEVER resets trial_started_at on an existing Customer (the trial clock is set once, at first
//      creation, and is sacred),
//   3. writes the github_id -> customer_id KV index entry for instant, consistent gate lookups,
//   4. adds the user to the Discord guild with the Trial role (guilds.join via the user's token),
//   5. returns the customer id + a flag for the caller to mint a signed session cookie.
//
// Pure-ish: all side-effecting collaborators (stripe, discord, kv) are injected, so the whole chain
// is fixture-testable with no network. Fail closed only applies to membership STATUS decisions; here
// we surface errors to the caller so a failed signup is retried (the customer step is idempotent).
//
// This module imports the frozen Stripe + Discord client contracts via the orchestrator's injected
// instances; it does not construct them itself (the Worker entrypoint wires them with real secrets).

import { resolveReferral } from './referral.mjs';
import { SESSION_RE } from './membership-touches.mjs'; // SOW-059 P1c: validate the bound touch-session shape
import { redeemCoupon } from './coupons.mjs'; // SOW-119

/**
 * Decide whether to reuse an existing Stripe Customer or create a new one for this github_id.
 * Pure and separately tested: returns { action:'reuse'|'create', customerId? }.
 *
 * @param {object|null} existingCustomer  the result of stripe.searchCustomerByGithubId(github_id).
 */
export function decideCustomer(existingCustomer) {
  if (existingCustomer && existingCustomer.id) {
    return { action: 'reuse', customerId: existingCustomer.id };
  }
  return { action: 'create' };
}

/**
 * The content the new member first landed on, e.g. `post:my-slug` (SOW-007/008, repurposed by SOW-059 as the
 * touch pointer). Stored verbatim so the conversion/payout job can attribute the first/last-touch item and its
 * contributors + commenters. Validated to a strict `<type>:<kebab-slug>` shape; anything else is dropped (fail
 * safe: a bad/spoofed via just yields no attribution, the owner keeps their share). It is NOT the earner key,
 * only the content pointer: the earner is `referred_by` (the content author's github_id), set independently.
 */
const VIA_RE = /^(post|product|prompt):[a-z0-9-]+$/;
export function normalizeVia(via) {
  if (!via) return null;
  const v = String(via).trim().slice(0, 200);
  return VIA_RE.test(v) ? v : null;
}

/**
 * Build the metadata for a brand-new Customer. trial_started_at is set HERE and only here.
 * referred_by is included only when a valid (non-self) referral resolved. via is the landed-on content.
 */
export function buildNewCustomerMetadata({ githubId, githubLogin, discordUserId, trialStartedAt, signupSource, referredBy, via, touchSession, coupon }) {
  const metadata = {
    github_id: String(githubId),
    github_login: githubLogin ? String(githubLogin) : '',
    trial_started_at: trialStartedAt,
  };
  // SOW: Discord is DEFERRED -> discord_user_id is set only when the member linked Discord (at signup or via the
  // extension-welcome link). Omit it entirely for a GitHub-only signup; the deferred link + reconcile fill it later.
  if (discordUserId) metadata.discord_user_id = String(discordUserId);
  if (signupSource) metadata.signup_source = String(signupSource);
  if (referredBy) metadata.referred_by = String(referredBy);
  const v = normalizeVia(via);
  if (v) metadata.via = v;
  // SOW-059 P1c: bind the visitor's pre-signup touch-session id so the conversion handler can locate touch:<sid>
  // and freeze the attribution snapshot. New-customer-only (like referred_by + trial_started_at) and never
  // refreshed, so a re-run cannot rewrite the binding. Validated to the session shape; a bad value is dropped.
  if (touchSession && SESSION_RE.test(String(touchSession))) metadata.touch_session = String(touchSession);
  // SOW-119: the redeemed coupon code (already validated + normalized by the caller). New-customer-only,
  // like referred_by: a record of how this member arrived, never an access signal (KV + git grants are).
  if (coupon) metadata.coupon = String(coupon);
  return metadata;
}

/**
 * Metadata to refresh on an EXISTING Customer. We opportunistically refresh the display login and
 * the discord id (a member may have re-linked), but we deliberately OMIT trial_started_at,
 * signup_source, and referred_by so a re-run can never reset the trial clock or rewrite first-touch
 * referral attribution.
 */
export function buildRefreshMetadata({ githubLogin, discordUserId }) {
  const metadata = {};
  if (githubLogin) metadata.github_login = String(githubLogin);
  if (discordUserId) metadata.discord_user_id = String(discordUserId);
  return metadata;
}

/**
 * Run the signup chain.
 *
 * @param {object} a
 * @param {object} a.identity   { githubId, githubLogin, discordUserId, email, discordAccessToken }
 * @param {object} a.stripe     a createStripeClient() instance (frozen client).
 * @param {object} a.discord    a createDiscordClient() instance (frozen client).
 * @param {object} a.kv         KV namespace for the github_id -> customer_id index: put(key,value).
 * @param {object} a.config     { guildId, trialRoleId, signupSource? }.
 * @param {string} [a.refCode]  raw ?ref value carried from the entry redirect (first-touch referral).
 * @param {string} [a.via]      raw ?via value (the content the reader landed on, e.g. `post:slug`).
 * @param {(code:string)=>string|null} [a.resolveReferral]  ref-code resolver (defaults to identity).
 * @param {Date}   [a.now]      injectable clock (trial_started_at source).
 * @returns {Promise<{ customerId:string, created:boolean, referredBy:string|null }>}
 */
export async function runSignup({ identity, stripe, discord, kv, config, refCode, via, touchSession, coupon, couponLockSecret = null, resolveReferral: resolver, now = new Date() }) {
  const { githubId, githubLogin, discordUserId, email, discordAccessToken } = identity;
  if (!githubId) throw new Error('runSignup: githubId is required');
  // SOW: Discord is now DEFERRED + optional. A GitHub-only signup creates the trial Customer with no
  // discord_user_id and skips the guild join; the member links Discord later from the extension welcome (which
  // re-runs this chain with a Discord identity, idempotently attaching discord_user_id + the role to the Customer).
  const hasDiscord = Boolean(discordUserId && discordAccessToken);

  // First-touch referral, self-reject. Only used when we create a new Customer.
  const referredBy = resolveReferral({ refCode, newMemberGithubId: githubId, resolve: resolver });

  // Idempotent by github_id: look up an existing Customer first.
  const existing = await stripe.searchCustomerByGithubId(String(githubId));
  const plan = decideCustomer(existing);

  let customerId;
  let created = false;
  if (plan.action === 'reuse') {
    customerId = plan.customerId;
    // Opportunistic refresh of mutable display fields. trial_started_at is NEVER touched here.
    const refresh = buildRefreshMetadata({ githubLogin, discordUserId });
    const update = { metadata: refresh };
    if (email) update.email = email; // keep Stripe's email current for receipts + day-87 reminder
    if (Object.keys(refresh).length > 0 || email) {
      await stripe.updateCustomer(customerId, update);
    }
  } else {
    const metadata = buildNewCustomerMetadata({
      githubId,
      githubLogin,
      discordUserId,
      trialStartedAt: now.toISOString(),
      signupSource: config?.signupSource,
      referredBy,
      via,
      touchSession,
      coupon, // SOW-119: pre-validated by handleStart (only a redeemable code ever reaches the state)
    });
    // Idempotency key derived from github_id so a retried create cannot double-insert.
    const customer = await stripe.createCustomer({ email: email || undefined, metadata }, `signup:${githubId}`);
    customerId = customer.id;
    created = true;
  }

  // Write the github_id -> customer_id index for instant, consistent gate lookups (beats Search lag).
  if (kv && customerId) {
    await kv.put(`gh:${githubId}`, customerId);
  }

  // SOW-119: redeem the coupon (idempotent; the grant record is the lock, so the GitHub-then-Discord
  // re-run of this chain cannot double-redeem). Fail closed: any problem means a normal trial signup.
  let couponGrant = null;
  if (coupon && kv) {
    couponGrant = await redeemCoupon({ kv, code: coupon, githubId, login: githubLogin, now, lockSecret: couponLockSecret });
  }

  // Add the user to the guild (guilds.join uses the user's OAuth access token). The `roles` param is
  // honored ONLY when Discord actually adds a brand-new member; for a user already in the guild Discord
  // returns 204 and ignores it. So we ALSO assign the Trial role explicitly, which is idempotent and
  // works for both new and existing members. (The bot's role must sit above the Trial role.)
  // Add the user to the guild + Trial role ONLY when Discord was linked. A GitHub-only signup skips this; reconcile
  // keeps roles in sync once discord_user_id exists, and the deferred welcome link runs this same join.
  if (hasDiscord) {
    await discord.addGuildMember(config.guildId, discordUserId, {
      accessToken: discordAccessToken,
      roles: [config.trialRoleId],
    });
    await discord.addRole(config.guildId, discordUserId, config.trialRoleId);
  }

  return {
    customerId,
    created,
    referredBy: created ? (referredBy ?? null) : null,
    discordLinked: hasDiscord,
    couponApplied: Boolean(couponGrant), // SOW-119
    couponUntil: couponGrant?.until ?? null,
  };
}
