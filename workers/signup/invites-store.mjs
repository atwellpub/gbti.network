// sow-231: KV access for issued invites, shared by the admin routes and the redemption path.
//
// WHY THIS EXISTS RATHER THAN coupons.mjs IMPORTING FROM THE ADMIN MODULE. `readInvite` was private to
// membership-invites-admin.mjs, and Phase 2 needs the same read on the redemption path. Importing it from
// there would point the signup chain at an ADMIN module, which is the wrong dependency direction: a route
// that any signup hits should not load the superadmin surface, and the next person to add an admin-only
// import would silently pull it into signup. Both sides depend on this instead.
//
// Reads FAIL SOFT to null. A malformed or unreadable record must behave exactly like an absent one, because
// every caller's next step is the fail-closed path (no coupon, plain signup), and a throw here would turn a
// corrupt record into a 500 on someone's signup.
import { inviteKey } from '../../membership/invites.mjs';

/** The invite record for `code`, or null when absent, unreadable, or not an object. */
export async function readInvite(kv, code) {
  if (!kv || !code) return null;
  try {
    const rec = await kv.get(inviteKey(code), 'json');
    return rec && typeof rec === 'object' && !Array.isArray(rec) ? rec : null;
  } catch {
    return null;
  }
}

/**
 * Write an invite record back.
 *
 * Returns true on success and FALSE on failure rather than throwing, so a caller mid-redemption can decide
 * what a failed write means. It means different things in different places: for the admin routes it is an
 * error to report, and on the redemption path it must NOT undo a grant that already succeeded.
 */
export async function writeInvite(kv, rec) {
  if (!kv || !rec?.code) return false;
  try {
    await kv.put(inviteKey(rec.code), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}
