// sow-185 phase 1: the membership TIER axis. Node-free and dependency-free (the Worker imports this), pure over
// injected inputs, and fail-closed by construction.
//
// WHY THIS EXISTS. Before sow-185 the system had no tier dimension at all: deriveStatus returns `paid` for ANY
// active subscription and never inspects which price was bought, and checkout carries a single STRIPE_PRICE_ID.
// Every gate downstream (classify-pr publish rights, the 14 authorizePaid routes, reconcile) keys off that one
// boolean. The moment a second, cheaper price exists in Stripe, every subscriber to it silently receives full
// Content Creator rights. That is a fail-OPEN in a codebase whose stated invariant is fail-closed, so the tier
// axis must exist and be enforced BEFORE any second price is created.
//
// THE ORDERING IS THE POINT: tiers are a total order (none < member < creator), so a gate declares the MINIMUM
// tier it needs and `meetsTier` answers. Adding a tier later means inserting a rank, not revisiting every gate.

/** The membership tiers, lowest to highest. `none` means "no tier privileges", NOT "no subscription". */
export const TIER = Object.freeze({
  none: 'none',       // not paid, or paid for something we cannot identify (see tierForPrice)
  member: 'member',   // Network Member: $5 monthly / $50 annual
  creator: 'creator', // Content Creator: $15 monthly / $150 annual
});

// Rank is the ONLY place the ordering lives. An unknown string ranks below everything, so a typo or a value from
// an older deploy can never satisfy a gate.
const RANK = Object.freeze({ [TIER.none]: 0, [TIER.member]: 1, [TIER.creator]: 2 });

/** Numeric rank of a tier. An unrecognized value ranks -1, below `none`, so it satisfies no requirement. */
export function tierRank(tier) {
  const r = RANK[tier];
  return Number.isInteger(r) ? r : -1;
}

/**
 * Does `actual` satisfy a gate requiring at least `required`? Fail-closed on both sides: an unrecognized ACTUAL
 * ranks -1 and passes nothing; an unrecognized REQUIRED is treated as the HIGHEST tier, so a typo in a gate
 * denies rather than admits.
 */
export function meetsTier(actual, required) {
  const need = tierRank(required);
  return tierRank(actual) >= (need < 0 ? RANK[TIER.creator] : need);
}

/** True only for the exact tier strings above. Used to reject junk before it enters a map. */
export const isTier = (t) => Object.prototype.hasOwnProperty.call(RANK, t);

/**
 * Parse a price-id -> tier map from a JSON string or a plain object, dropping any entry whose value is not a
 * real tier. Returns a Map. Unparseable input yields an EMPTY map, never a throw: the caller decides what an
 * empty map means (see buildPriceTierMap), and a crash inside a membership check would fail the request in a
 * way that is harder to reason about than an explicit empty result.
 */
export function parsePriceTiers(source) {
  let raw = source;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return new Map();
    try { raw = JSON.parse(text); } catch { return new Map(); }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return new Map();
  const out = new Map();
  for (const [priceId, tier] of Object.entries(raw)) {
    if (typeof priceId === 'string' && priceId && isTier(tier)) out.set(priceId, tier);
  }
  return out;
}

/**
 * Build the effective price -> tier map.
 *
 * `legacyCreatorPriceId` (the existing STRIPE_PRICE_ID, the single $150 annual price) is SEEDED as `creator`
 * unless the explicit map already names it. That seeding is what makes this ship inert AND fail closed at the
 * same time, which is worth spelling out because the two usually pull against each other:
 *
 *   - Inert today: the one real price maps to creator, which is exactly the current behavior.
 *   - Fail-closed tomorrow: because the map is therefore NON-EMPTY in production from day one, a newly created
 *     price (the $5 tier) is an UNKNOWN id and resolves to `none` until it is deliberately mapped. Forgetting
 *     to configure it denies, loudly, instead of silently granting creator rights.
 *
 * An empty result (no explicit map AND no legacy price id) is the only case that cannot fail closed, because
 * there is nothing to compare against; tierForPrice documents how that is handled.
 */
export function buildPriceTierMap({ priceTiers = null, legacyCreatorPriceId = null } = {}) {
  const map = parsePriceTiers(priceTiers);
  if (typeof legacyCreatorPriceId === 'string' && legacyCreatorPriceId && !map.has(legacyCreatorPriceId)) {
    map.set(legacyCreatorPriceId, TIER.creator);
  }
  return map;
}

/**
 * Resolve a Stripe price id to a tier.
 *
 * - id present in the map -> the mapped tier
 * - EVERYTHING else (unknown id, absent id, non-string, an EMPTY map, a non-Map argument) -> `none`.
 *   FAIL CLOSED, with no exceptions.
 *
 * THERE IS NO "empty map means creator" BRANCH ANY MORE, and it must not come back (2026-08-11).
 *
 * It existed to preserve pre-sow-185 single-price behaviour and its docstring claimed it was "unreachable in
 * production. Once buildPriceTierMap has a legacy price id to seed". That was false. The GitHub Actions env
 * seeded nothing, not even the legacy id, so `pr-membership-gate.yml` built an EMPTY map and this branch
 * resolved EVERY paid subscriber to `creator`. The sow-185 publish gate therefore admitted a $5 Network
 * Member as a Content Creator, live, for as long as both existed.
 *
 * A second door led to the same place: a caller passing a plain OBJECT where a Map belongs was silently
 * coerced to an empty Map and got `creator` too. Every price map here is BUILT from an object literal, so
 * that is the natural mistake, it looks correct at the call site, and it produced the highest privilege.
 *
 * A test named "a non-Map passed where a map belongs does not throw and DOES NOT GRANT" asserted this
 * returned `creator`, with a comment rationalising it as defensive. The alternative was never a crash: it was
 * `none`, which the adjacent test already asserts for every other malformed input. The intent was written
 * down correctly and the code never matched it. Deleting the branch makes that test name true.
 *
 * This now agrees with the rest of the feature: classify-pr `decide()` defaults `tier = TIER.none`, and the
 * syndication adapters collapse ambiguity to the restricted side. Absent must mean LESS privilege here.
 */
export function tierForPrice(priceId, map) {
  const m = map instanceof Map ? map : new Map();
  if (typeof priceId !== 'string' || !priceId) return TIER.none;
  return m.get(priceId) ?? TIER.none;
}

/**
 * Extract the price id from a Stripe subscription across the shapes it actually arrives in. Stripe has moved
 * this field over the years (`plan` predates `items[].price`), responses differ by API version and by whether
 * the caller expanded `items`, and the repo's existing test fixtures carry no price at all. Checking every
 * known shape is deliberate: a missed shape would resolve to `none` and deny a real paying member, which is
 * the expensive direction of a fail-closed design.
 *
 * Returns null when no price id can be found, which tierForPrice turns into `none`.
 */
export function priceIdOfSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const items = Array.isArray(sub.items) ? sub.items : (Array.isArray(sub.items?.data) ? sub.items.data : []);
  for (const item of items) {
    const id = item?.price?.id ?? item?.plan?.id ?? (typeof item?.price === 'string' ? item.price : null);
    if (typeof id === 'string' && id) return id;
  }
  const direct = sub.price?.id ?? sub.plan?.id ?? (typeof sub.price === 'string' ? sub.price : null);
  return typeof direct === 'string' && direct ? direct : null;
}

/** Convenience: subscription -> tier, via priceIdOfSubscription + tierForPrice. */
export function tierForSubscription(sub, map) {
  return tierForPrice(priceIdOfSubscription(sub), map);
}
