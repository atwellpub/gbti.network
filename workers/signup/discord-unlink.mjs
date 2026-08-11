// sow-218: disconnect a member's Discord account.
//
// There was no disconnect anywhere, UI or backend. The welcome step rendered a permanently disabled
// "Discord connected" button and that was the end of it, so a member who linked the wrong Discord account, or
// simply wanted out, had no route back except asking an admin.
//
// THE ORDER OF THE TWO WRITES IS THE WHOLE DESIGN, and getting it backwards is the trap this exists to avoid.
//
// The obvious implementation clears `discord_user_id` from the Stripe Customer and stops. That is the version
// that leaves a hole: the managed role is what grants access (this guild is ALLOW-based, verified 2026-08-11
// across 157 channels, where the member role allows VIEW_CHANNEL on 12 and Locked denies it nowhere), and
// reconcile can only sync a member it can still SEE. Clear the link and the member keeps @Member in the guild
// while becoming invisible to the thing that would revoke it. The access becomes permanent and ungoverned, and
// nothing in the system would ever report it.
//
// So: STRIP THE ROLES FIRST, then clear the link. If role removal fails we keep the link and report the
// failure, because the link is the only pointer back to that Discord user. A retry then still works. Clearing
// first and failing second would destroy the pointer and strand the grant.
//
// It never KICKS. The member stays in the guild with no managed role, holding whatever @everyone allows, which
// is the same standing rule reconcile follows for a lapsed or banned account (SOW-011).

/** The managed roles, in the order they are stripped. Removing a role the member does not hold is a no-op at
 *  Discord, so all three are always attempted and the result is idempotent. */
export const MANAGED_ROLE_KEYS = ['memberRoleId', 'trialRoleId', 'lockedRoleId'];

/**
 * Unlink `githubId`'s Discord account.
 *
 * @returns {Promise<{ok:boolean, unlinked:boolean, reason?:string, rolesRemoved?:number}>}
 *   - { ok:true, unlinked:false, reason:'not_linked' } when there is nothing to do (idempotent, not an error)
 *   - { ok:false, unlinked:false, reason:'roles_failed' } when Discord refused; the link is DELIBERATELY kept
 *   - { ok:true, unlinked:true, rolesRemoved:n } on success
 */
export async function unlinkDiscord({ githubId, stripe, discord, config = {}, now = new Date() } = {}) {
  if (!githubId || !stripe) return { ok: false, unlinked: false, reason: 'misconfigured' };

  let customer = null;
  try { customer = await stripe.searchCustomerByGithubId(String(githubId)); }
  catch { return { ok: false, unlinked: false, reason: 'lookup_failed' }; }
  if (!customer?.id) return { ok: true, unlinked: false, reason: 'not_linked' };

  const discordUserId = customer.metadata?.discord_user_id;
  if (!discordUserId) return { ok: true, unlinked: false, reason: 'not_linked' };

  // 1. Strip every managed role. A missing role id is skipped rather than sent as `undefined`; a role the
  //    member does not hold is a no-op at Discord. Any hard failure ABORTS before the link is cleared.
  let rolesRemoved = 0;
  if (discord && config.guildId) {
    for (const key of MANAGED_ROLE_KEYS) {
      const roleId = config[key];
      if (!roleId) continue;
      try { await discord.removeRole(config.guildId, discordUserId, roleId); rolesRemoved += 1; }
      catch { return { ok: false, unlinked: false, reason: 'roles_failed' }; }
    }
  }

  // 2. Only now clear the pointer. Stripe deletes a metadata key whose value is an empty string, so this
  //    REMOVES the field rather than storing a blank one that later reads as present.
  try { await stripe.updateCustomer(customer.id, { metadata: { discord_user_id: '' } }); }
  catch { return { ok: false, unlinked: false, reason: 'unlink_failed' }; }

  return { ok: true, unlinked: true, rolesRemoved, at: now.toISOString() };
}
