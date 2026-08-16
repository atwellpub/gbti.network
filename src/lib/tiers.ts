// sow-185: tier access for the site, in ONE import. Mirrors src/lib/taxonomy.ts: reads house/membership-tiers.yml
// once at build via js-yaml, through the shared pure parser membership/tiers-display.mjs, AND re-exports the tier
// AXIS (identity + ranking + membership test) from membership/tiers.mjs so a component gets both "what tiers
// exist / how they rank" and "how to display them" from a single module. The sow-192 homepage pricing accordion
// and the Your-membership / Upgrade rail cards bind to TIER_DISPLAY; the gating side (sow-185) consumes the same
// yml + axis, so the site and the server can never disagree on the tier model.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseTierDisplay } from '../../membership/tiers-display.mjs';

// Re-export the AXIS (bind, do NOT rebuild): TIER identity, ranking, and the fail-closed membership test.
export { TIER, tierRank, meetsTier, isTier } from '../../membership/tiers.mjs';

export interface TierDisplay {
  key: string;
  label: string;
  tagline: string;
  priceMonthly: number;
  priceAnnual: number;
  priceEnv: { monthly?: string; annual?: string };
  /** sow-230: a benefit is `{label, description}`. `description` is '' unless the yml gives one. */
  benefits: readonly { label: string; description: string }[];
  revenue: string;
}

const file = path.resolve(process.cwd(), 'house/membership-tiers.yml');
const RAW = yaml.load(fs.readFileSync(file, 'utf8'));

/** The three tiers (free, member, creator) in canonical display order, from the single source of truth. */
export const TIER_DISPLAY: readonly TierDisplay[] = parseTierDisplay(RAW) as readonly TierDisplay[];

/** One tier's display record by key (none | member | creator), or undefined. */
export function tierDisplay(key: string): TierDisplay | undefined {
  return TIER_DISPLAY.find((t) => t.key === key);
}

/** The purchasable tiers (a monthly or annual price above zero), in display order. */
export function paidTiers(): readonly TierDisplay[] {
  return TIER_DISPLAY.filter((t) => t.priceMonthly > 0 || t.priceAnnual > 0);
}
