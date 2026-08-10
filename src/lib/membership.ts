// Site-facing membership + revenue constants, single-sourced from the real systems so the marketing
// surfaces (homepage, /membership/, the CTA) never drift from the actual config or from each other.
// SOW-010 / SOW-011. The trial length and the settlement hold are imported from the membership trust
// core + the referral config; the price mirrors the Stripe annual price.
import { TRIAL_DAYS } from '../../membership/derive-status.mjs';
import { DEFAULT_REFERRAL_CONFIG } from '../../membership/referral-config.mjs';

/** Annual membership price in USD. Canonical money lives in Stripe (STRIPE_PRICE_ID, see
 *  membership-and-access.md / workers/signup/wrangler.toml); keep this equal to it.
 *
 *  DEPRECATED (sow-201): the site moved to the three-tier model. The membership page + homepage now bind to
 *  src/lib/tiers.ts (TIER_DISPLAY, from house/membership-tiers.yml), which is the single source of truth for
 *  every price and label. This single-price constant (== the legacy Content Creator annual price) survives
 *  only for the out-of-scope surfaces that still reference it (codeable-invite, handbook). Do NOT add new
 *  consumers: bind to TIER_DISPLAY instead. */
export const MEMBERSHIP_PRICE_USD = 150;
export const MEMBERSHIP_PRICE_LABEL = `$${MEMBERSHIP_PRICE_USD}`;
export const BILLING_PERIOD = 'year';

/** Trial length, from the membership trust core (the same constant the gate + reconcile use). */
export const TRIAL_DAYS_SITE: number = TRIAL_DAYS;

/** Settlement hold (days) before any distribution pays out, from the referral config (the payout job's hold). */
export const HOLD_DAYS: number = DEFAULT_REFERRAL_CONFIG.hold_days; // 90

/** Cloudflare Turnstile site key: PUBLIC, safe to ship. The signup CTA's widget renders with this and the
 *  Worker verifies the resulting token server-side with TURNSTILE_SECRET_KEY (which never leaves the Worker).
 *  The signup button stays "Coming soon" until the Worker is live; the live CTA + widget land at that point. */
export const TURNSTILE_SITE_KEY = '0x4AAAAAADg66MO1G3WyZDcL';

/** The signup Worker origin (SOW-002), where the Turnstile-gated `/signup/start` lives. Must equal the
 *  Worker `PUBLIC_BASE_URL`. The signup CTA navigates here with the Turnstile token + first-touch ref/via. */
export const SIGNUP_BASE = 'https://signup.gbti.network';

// SOW-059: the SIMPLIFIED revenue model (spec: .data/ops/revenue-ops/README.md). Touch-based + fixed + automatic:
// the first content that brought a member in earns its author 30%, the last content before they joined earns 10%,
// and a fixed 5% pool is shared automatically by members who commented on or contributed to those two items.
export const FIRST_TOUCH_PCT = '30%';
export const LAST_TOUCH_PCT = '10%';
export const COLLAB_POOL_PCT = '5%';
// SOW-059 (owner decision 2026-06-27): a SEPARATE manual-invite lane. A member who shares their personal invite link
// earns a flat 10% LIFETIME commission on anyone who joins through it, paid from the platform's retained share (so
// content first/last-touch are never diluted), with a no-double-dip rule (it does not pay when the inviter already
// earns a content share on that conversion). Platform retains 55% normally, 45% when the invite lane pays.
export const INVITE_PCT = '10%';
export const PLATFORM_RETAINED_PCT = '55%';
export const PLATFORM_RETAINED_INVITE_PCT = '45%';
