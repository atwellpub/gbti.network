// SOW-029: pure helpers for the post-setup welcome view (<gbti-welcome>). Node-free so `node --test` imports
// them directly without a DOM; the component is the only DOM consumer. Keep this dependency-light.

/** Map the effective membership status to the welcome-banner phase. NEVER throws (unknown -> neutral).
 *  SOW-119 QA (2026-07-21): a coupon member's oracle status is 'paid' (publishing is unlocked), but the
 *  welcome banner must not claim they PAID. When couponUntil marks a live coupon grant, the phase says the
 *  free period plainly and names its end date. An absent, expired, or malformed couponUntil falls through
 *  to the plain paid banner (the oracle only emits couponUntil when the coupon IS the paid source). */
export function phaseLabel(membership, { couponUntil = null, now = Date.now() } = {}) {
  if (membership === 'paid' && couponUntil) {
    const until = new Date(couponUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() > now) {
      const end = until.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
      return {
        phase: 'coupon',
        title: 'Your free membership period is active',
        body: `Your coupon covers full membership through ${end}: your profile, posts, products, and prompts publish under your name. No card is on file and nothing bills automatically.`,
        upgrade: false,
        until: until.toISOString(),
      };
    }
  }
  switch (membership) {
    case 'paid':
      return { phase: 'paid', title: 'You are a paid member', body: 'Your profile, posts, products, and prompts publish under your name. Welcome to the co-op.', upgrade: false };
    case 'trialing':
      return { phase: 'trial', title: 'You are in your 90-day trial', body: 'Explore the community and stage drafts on your own fork now. Upgrade to a paid membership any time to publish under your name.', upgrade: true };
    default:
      // unknown / unreachable oracle, or a status that should not reach this view: a neutral welcome, no claim.
      return { phase: 'neutral', title: 'Welcome to GBTI Network', body: 'You are set up to author and publish through the co-op.', upgrade: false };
  }
}

/** Fisher-Yates shuffle. Tests pass a deterministic rng(); runtime defaults to Math.random (UX shuffle only).
 *  Pure: returns a new array, does not mutate the input. */
export function shuffle(list, rng = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Drop the signed-in member's OWN username (case-insensitive) from a member list (no following yourself). */
export function excludeSelf(members, ownUsername) {
  const me = String(ownUsername || '').toLowerCase();
  return me ? members.filter((m) => String(m?.username || '').toLowerCase() !== me) : [...members];
}

/**
 * sow-207 QA: the step a RETURNING member should land on, given a per-step "is this already done" flag list.
 *
 * The wizard used to open at step 0 every time, so a refresh (or following the "Skip for now" link and coming
 * back) sent a member who had already connected Discord, followed channels and members, and picked topics all
 * the way back to "Connect Discord" with the rail's checkmarks cleared. None of their work was lost, since all
 * of it persists server-side, but the wizard could not see what it had already achieved.
 *
 * DERIVED, NOT A SAVED CURSOR. The flags come from real state (the Discord link, the followed channels, the
 * saved socials, the follow graph, the stored topic prefs), so a member who did some of this SOMEWHERE ELSE
 * gets credit for it: linking Discord from the extension, or following people from their profile pages, both
 * count here. A persisted step number would instead replay a stale position and re-ask for work already done.
 *
 * Returns the FIRST incomplete step. When everything is complete it returns the LAST step rather than a
 * done-state, deliberately: the done card is a place you arrive by pressing "I am all set", and auto-jumping
 * a returning member straight to it would hide the wizard they came back to use. Landing them on the final
 * step lets them keep adjusting and finish on their own action.
 */
export function resumeStep(done, count) {
  const flags = Array.isArray(done) ? done : [];
  const n = Number.isInteger(count) && count > 0 ? count : flags.length;
  if (n <= 0) return 0;
  for (let i = 0; i < n; i++) if (!flags[i]) return i;
  return n - 1;
}

/** 1-based page `p` of `size` from `list`, clamped. Returns { page, pages, items }. */
export function paginate(list, p, size = 10) {
  const pages = Math.max(1, Math.ceil(list.length / size));
  const page = Math.min(Math.max(1, p | 0 || 1), pages);
  const start = (page - 1) * size;
  return { page, pages, items: list.slice(start, start + size) };
}
