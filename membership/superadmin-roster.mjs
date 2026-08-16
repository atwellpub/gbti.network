// SOW-038 P2: a pure roster builder for the superadmin dashboard read-view. Given the parsed override files
// (roles.yml, bans.yml, grandfathered.yml, members-index.yml), enumerate every known member and resolve each
// one's OVERRIDE-derived effective status (ban > staff > grandfather) — the part that is authoritative from the
// PUBLIC repo. Live Stripe paid/trial per member is NOT available here (it needs a Stripe-key Worker endpoint),
// so the Stripe tier resolves to 'unknown' and the dashboard labels it accordingly. Node-free; unit-tested.
import { rolesFromParsed, roleLoginsFromParsed, bansFromParsed, grandfathersFromParsed, membersIndexFromParsed, roleOf, isBanned, grandfatherActive, effectiveStatus, ROLE } from './overrides-core.mjs';
import { resolveEffectiveTier } from './tier-gate.mjs'; // sow-229: the TIER axis, resolved from the SAME effectiveStatus source
import { TIER } from './tiers.mjs';

// sow-229: a grant's `reason` records provenance; a coupon fold writes `coupon:<CODE>` (scripts/lib/coupon-grants.mjs
// COUPON_REASON_PREFIX). Parse the code back out for display. Mirrors that module's code shape ([A-Z0-9]{3,32}).
const COUPON_REASON_RE = /^coupon:([A-Z0-9]{3,32})$/;

// sow-229: days from `now` to a grant's `until`, or null for a permanent/absent bound. Negative when already past.
function daysUntil(until, now) {
  if (until === undefined || until === null || String(until).trim() === '') return null;
  const d = new Date(until);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - now.getTime()) / 86400000);
}

/**
 * @param {{roles?:object, bans?:object, grandfathered?:object, membersIndex?:object, stripeStatuses?:object, stripeLogins?:object, stripeTiers?:object, pendingGrants?:object}} parsed
 *   - parsed YAML objects + optional admin-endpoint maps (SOW-038 P2 / sow-229): `stripeStatuses`
 *     ({ github_id -> stripe status }), `stripeLogins`, `stripeTiers` ({ github_id -> tier } for the live
 *     Stripe tier), and `pendingGrants` ({ github_id -> { code, until, tier } } for a coupon redemption in KV
 *     that reconcile has not yet folded into house/grandfathered.yml). With `stripeStatuses` present each row's
 *     status is the real Stripe status and a pure-Stripe member (no override, no folder) is also enumerated;
 *     absent, the Stripe status is 'unknown'. `pendingGrants` is a display ANNOTATION only: it never changes a
 *     row's effective tier/status/source (the authorization gate reads git overrides, not KV).
 * @returns {{ roster: Array, summary: {total:number, staff:number, grandfathered:number, banned:number, members:number} }}
 */
export function buildRoster({ roles, bans, grandfathered, membersIndex, stripeStatuses, stripeLogins, stripeTiers, pendingGrants } = {}, now = new Date()) {
  const roleMap = rolesFromParsed(roles);
  const roleLogins = roleLoginsFromParsed(roles); // SOW-091: staff login fallback (no members-index needed)
  const banMap = bansFromParsed(bans);
  const gfMap = grandfathersFromParsed(grandfathered);
  const idx = membersIndexFromParsed(membersIndex);
  const stripe = stripeStatuses && typeof stripeStatuses === 'object' ? stripeStatuses : {};
  const stripeLoginMap = stripeLogins && typeof stripeLogins === 'object' ? stripeLogins : {}; // SOW-091: Stripe github_login fallback
  const stripeTierMap = stripeTiers && typeof stripeTiers === 'object' ? stripeTiers : {}; // sow-229: the live Stripe TIER per member (admin endpoint); absent -> fail closed to none
  const pendingMap = pendingGrants && typeof pendingGrants === 'object' ? pendingGrants : {}; // sow-229: redeemed-but-unfolded coupon grants (KV), an ANNOTATION only
  const overrides = { bans: banMap, grandfathers: gfMap, roles: roleMap };

  // Every github_id we can see: the members index + each override map + (when the admin Stripe map is supplied)
  // every Stripe customer + any pending KV redemption, so a pure-paid or a just-invited member with no override
  // and no folder is no longer invisible.
  const ids = new Set([...idx.keys(), ...roleMap.keys(), ...banMap.keys(), ...gfMap.keys(), ...Object.keys(stripe), ...Object.keys(pendingMap)]);

  const roster = [...ids].map((id) => {
    const derived = stripe[id] || 'unknown'; // the live Stripe tier, or 'unknown' without the admin endpoint
    const eff = effectiveStatus(id, derived, overrides, now);
    const gf = gfMap.get(id);
    // sow-229: the TIER axis, resolved from the SAME { status, source } as the status axis so an override
    // (staff / grandfather) is never dropped; the Stripe tier applies only to a stripe-source paid member, and
    // an unresolved tier fails closed to none, never creator.
    const tier = resolveEffectiveTier({ source: eff.source, status: eff.status, stripeTier: stripeTierMap[id] ?? TIER.none, grant: gf ?? null });
    const grantReason = gf?.reason ?? null; // sow-229: grant provenance (e.g. `coupon:CODEABLEYEAR`)
    const couponCode = typeof grantReason === 'string' ? (grantReason.match(COUPON_REASON_RE)?.[1] ?? null) : null;
    // sow-229: a redeemed coupon grant not yet folded into git is an ANNOTATION, never effective state (the
    // authorization gate reads git overrides only). Suppress it once folded (a `coupon:` reason already exists
    // for this id) so a folded grant (authoritative) and a pending one (edge state) never render identically.
    const pend = pendingMap[id];
    const pendingGrant = (pend && !(typeof gf?.reason === 'string' && gf.reason.startsWith('coupon:')))
      ? { code: pend.code ?? null, until: pend.until ?? null, tier: pend.tier ?? null }
      : null;
    return {
      githubId: id,
      // SOW-091: resolve the display username through every known source before falling back to the raw id, so a
      // staff member (roles login) or a paid/trial member with no published content (Stripe github_login) is named.
      username: idx.get(id) || banMap.get(id)?.login || gf?.login || roleLogins.get(id) || stripeLoginMap[id] || null,
      role: roleOf(id, roleMap),
      banned: isBanned(id, banMap),
      grandfathered: grandfatherActive(id, gfMap, now),
      grandfatherUntil: gf?.until ?? null,
      expiresInDays: daysUntil(gf?.until, now), // sow-229: derived days to expiry (null = permanent / none), for the expiry treatment
      tier, // sow-229: none | member | creator (fail closed to none)
      grantReason, // sow-229: the raw grant reason
      couponCode, // sow-229: the coupon code parsed from a `coupon:<CODE>` reason, else null
      pendingGrant, // sow-229: { code, until, tier } | null — redeemed in KV, not yet folded into git (annotation only)
      stripeStatus: stripe[id] || null, // the raw Stripe-derived tier (null when the admin endpoint was not consulted)
      status: eff.status, // banned | paid | trialing | expired | cancelled | none | unknown
      source: eff.source, // ban | staff | grandfather | stripe
    };
  });

  // Order: staff first, then grandfathered, then banned, then plain members; alpha within each band.
  const band = (r) => (r.role !== ROLE.member ? 0 : r.grandfathered ? 1 : r.banned ? 2 : 3);
  roster.sort((a, b) => band(a) - band(b) || String(a.username || a.githubId).localeCompare(String(b.username || b.githubId)));

  const summary = {
    total: roster.length,
    staff: roster.filter((r) => r.role !== ROLE.member).length,
    grandfathered: roster.filter((r) => r.grandfathered).length,
    banned: roster.filter((r) => r.banned).length,
    members: roster.filter((r) => r.role === ROLE.member && !r.grandfathered && !r.banned).length,
  };
  return { roster, summary };
}
