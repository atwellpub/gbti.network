// sow-218: disconnecting Discord. Every dependency is injected, so there is no network and no secrets here.
//
// The tests that matter most are about ORDER. Clearing the Stripe link before the roles are stripped would
// leave the member holding @Member in the guild while becoming invisible to reconcile, which is the one
// outcome this feature must never produce, and it is invisible from the outside once it happens.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unlinkDiscord, MANAGED_ROLE_KEYS } from '../workers/signup/discord-unlink.mjs';

const CONFIG = { guildId: 'g1', memberRoleId: 'r-member', trialRoleId: 'r-trial', lockedRoleId: 'r-locked' };
const linked = { id: 'cus_1', metadata: { github_id: '12345', discord_user_id: 'd-987' } };

function fakes({ removeRoleImpl, updateImpl, customer = linked } = {}) {
  const order = [];
  const stripe = {
    async searchCustomerByGithubId() { return customer; },
    async updateCustomer(id, patch) { order.push('unlink'); if (updateImpl) return updateImpl(id, patch); return { id }; },
  };
  const discord = {
    async removeRole(g, u, roleId) { order.push(`role:${roleId}`); if (removeRoleImpl) return removeRoleImpl(roleId); return null; },
  };
  return { stripe, discord, order };
}

test('strips every managed role, THEN clears the link', async () => {
  const { stripe, discord, order } = fakes();
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
  assert.equal(r.ok, true);
  assert.equal(r.unlinked, true);
  assert.equal(r.rolesRemoved, 3);
  assert.deepEqual(order, ['role:r-member', 'role:r-trial', 'role:r-locked', 'unlink'], 'the unlink is LAST');
});

test('a failed role removal KEEPS the link, so a retry can still find the member', async () => {
  // The load-bearing case. Clearing the link here would strand @Member in the guild with nothing able to
  // revoke it, because discord_user_id is the only pointer reconcile has.
  const { stripe, discord, order } = fakes({ removeRoleImpl: (id) => { if (id === 'r-trial') throw new Error('discord 500'); } });
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.unlinked, false);
  assert.equal(r.reason, 'roles_failed');
  assert.ok(!order.includes('unlink'), 'the Stripe link must NOT have been cleared');
});

test('the metadata write CLEARS the key rather than blanking it to a present-but-empty value', async () => {
  let patch = null;
  const { stripe, discord } = fakes({ updateImpl: (_id, p) => { patch = p; return { id: 'cus_1' }; } });
  await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
  // Stripe DELETES a metadata key set to an empty string. Anything else would leave discord_user_id present,
  // and discordLinkedFor tests presence, so the member would keep reading as linked.
  assert.deepEqual(patch, { metadata: { discord_user_id: '' } });
});

test('an unlinked member is a no-op, not an error (idempotent)', async () => {
  for (const customer of [null, { id: 'cus_1', metadata: {} }, { id: 'cus_1' }]) {
    const { stripe, discord, order } = fakes({ customer });
    const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
    assert.equal(r.ok, true);
    assert.equal(r.unlinked, false);
    assert.equal(r.reason, 'not_linked');
    assert.deepEqual(order, [], 'nothing was written');
  }
});

test('an unset role id is SKIPPED, never sent to Discord as undefined', async () => {
  const { stripe, discord, order } = fakes();
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: { guildId: 'g1', memberRoleId: 'r-member' } });
  assert.equal(r.rolesRemoved, 1);
  assert.deepEqual(order, ['role:r-member', 'unlink']);
});

test('a Stripe lookup failure writes nothing at all', async () => {
  const stripe = { async searchCustomerByGithubId() { throw new Error('stripe down'); }, async updateCustomer() { throw new Error('must not reach'); } };
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord: null, config: CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'lookup_failed');
});

test('a failed unlink write reports failure rather than claiming success', async () => {
  const { stripe, discord } = fakes({ updateImpl: () => { throw new Error('stripe 500'); } });
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unlink_failed');
});

test('it NEVER kicks: no guild-removal call exists on the injected client', async () => {
  // SOW-011 standing rule. A kick would be reachable only by adding a method here, so assert the surface.
  const { stripe, order } = fakes();
  const discord = { async removeRole(g, u, id) { order.push(`role:${id}`); }, async kick() { throw new Error('must never be called'); } };
  const r = await unlinkDiscord({ githubId: '12345', stripe, discord, config: CONFIG });
  assert.equal(r.ok, true);
  assert.ok(order.every((o) => o.startsWith('role:') || o === 'unlink'));
});

test('MANAGED_ROLE_KEYS covers all three managed roles', () => {
  assert.deepEqual([...MANAGED_ROLE_KEYS].sort(), ['lockedRoleId', 'memberRoleId', 'trialRoleId']);
});
