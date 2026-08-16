// sow-185: the PURE parser + validator for the tier DISPLAY data (house/membership-tiers.yml). Node-free and
// dependency-free (like membership/tiers.mjs and membership/topics-vocab.mjs), so the Astro build
// (src/lib/tiers.ts) AND scripts/validate-content.mjs share ONE shape definition and never disagree. This carries
// ONLY presentation data (label, tagline, prices, benefit bullets, revenue copy) plus the price-id ENV VAR NAMES
// for the phase-3b checkout allowlist. The tier IDENTITY + ranking + price-id->tier resolution live in
// membership/tiers.mjs (the gating axis), and the actual Stripe price ids live in the Worker env. The benefit
// copy is governed by sow-185 section 7: a tier may ship with unbuilt benefits removed, but it must never
// advertise a benefit that does not exist.
import { TIER, isTier } from './tiers.mjs';

// Every axis tier must appear, in canonical display order (free -> member -> creator).
export const TIER_ORDER = Object.freeze([TIER.none, TIER.member, TIER.creator]);

export class TierDisplayError extends Error {
  constructor(message) { super(message); this.name = 'TierDisplayError'; }
}

/**
 * A benefit is either a bare string or `{ label, description }`, and BOTH normalize to the object form so
 * every consumer reads one shape. The string form stays valid on purpose: most surfaces (the pricing
 * accordion, the membership table) render a one-line bullet and have nothing to do with a description, so
 * requiring one everywhere would be churn for no reader.
 *
 * WHY A DESCRIPTION BELONGS HERE AND NOT ON THE PAGE THAT SHOWS IT. sow-230: a member-tier invite went live
 * advertising Creator benefits because its benefit prose was hand-written into the page and inherited from
 * the page it was copied from. The fix was to render benefits from this file, so no page types a benefit
 * sentence. A design then asked for a headline plus a supporting line per benefit, and the tempting shortcut
 * was to write those lines into the template, which would have reopened exactly that hole one field over.
 * The description is benefit copy, it is a legal line under this file's own header rule, and it lives where
 * the rest of the benefit copy is reviewed.
 */
function normalizeBenefit(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.freeze({
      label: String(raw.label ?? '').trim(),
      description: String(raw.description ?? '').trim(),
    });
  }
  return Object.freeze({ label: String(raw ?? '').trim(), description: '' });
}

function normalizeTier(raw, i) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TierDisplayError(`tiers[${i}] must be an object`);
  const key = String(raw.key ?? '');
  if (!isTier(key)) throw new TierDisplayError(`tiers[${i}].key "${key}" is not a valid tier (none|member|creator)`);
  const label = String(raw.label ?? '').trim();
  if (!label) throw new TierDisplayError(`${key}: label is required`);
  const priceMonthly = Number(raw.priceMonthly);
  const priceAnnual = Number(raw.priceAnnual);
  if (!Number.isFinite(priceMonthly) || priceMonthly < 0) throw new TierDisplayError(`${key}: priceMonthly must be a number >= 0`);
  if (!Number.isFinite(priceAnnual) || priceAnnual < 0) throw new TierDisplayError(`${key}: priceAnnual must be a number >= 0`);
  const benefits = Array.isArray(raw.benefits) ? raw.benefits.map(normalizeBenefit).filter((b) => b.label) : [];
  if (benefits.length === 0) throw new TierDisplayError(`${key}: benefits[] must be a non-empty list`);
  const rawEnv = raw.priceEnv && typeof raw.priceEnv === 'object' && !Array.isArray(raw.priceEnv) ? raw.priceEnv : {};
  const priceEnv = Object.freeze({
    ...(rawEnv.monthly ? { monthly: String(rawEnv.monthly) } : {}),
    ...(rawEnv.annual ? { annual: String(rawEnv.annual) } : {}),
  });
  // A purchasable price MUST name its Stripe price-id env var, or the checkout allowlist (phase 3b) has no id to
  // validate the requested tier+period against.
  if (priceMonthly > 0 && !priceEnv.monthly) throw new TierDisplayError(`${key}: priceMonthly is set but priceEnv.monthly is missing`);
  if (priceAnnual > 0 && !priceEnv.annual) throw new TierDisplayError(`${key}: priceAnnual is set but priceEnv.annual is missing`);
  return Object.freeze({
    key,
    label,
    tagline: String(raw.tagline ?? '').trim(),
    priceMonthly,
    priceAnnual,
    priceEnv,
    benefits: Object.freeze(benefits),
    revenue: String(raw.revenue ?? '').trim(),
  });
}

/**
 * Parse the raw yaml object (`{ tiers: [...] }`) into a frozen, canonically-ordered array of tier display
 * records. Pure. Throws TierDisplayError when the file lacks a `tiers:` list, a tier is duplicated or unknown, an
 * axis tier is missing, or a field is malformed.
 */
export function parseTierDisplay(raw) {
  const list = raw && Array.isArray(raw.tiers) ? raw.tiers : null;
  if (!list) throw new TierDisplayError('the tier file must have a top-level `tiers:` list');
  const byKey = new Map();
  list.forEach((t, i) => {
    const rec = normalizeTier(t, i);
    if (byKey.has(rec.key)) throw new TierDisplayError(`duplicate tier key "${rec.key}"`);
    byKey.set(rec.key, rec);
  });
  for (const k of TIER_ORDER) {
    if (!byKey.has(k)) throw new TierDisplayError(`the tier file is missing the "${k}" tier`);
  }
  return Object.freeze(TIER_ORDER.map((k) => byKey.get(k)));
}

/** Boolean form for CI (scripts/validate-content.mjs): { ok, error }. Never throws. */
export function validateTierDisplay(raw) {
  try { parseTierDisplay(raw); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e instanceof TierDisplayError ? e.message : String(e?.message || e) }; }
}
