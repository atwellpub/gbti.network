// sow-166 / sow-157: the runner that creates the Stripe Customers for the recovered legacy members.
//
// THESE TESTS EXIST BECAUSE THE AUTHOR COULD NOT RUN THE SCRIPT. Executing it needs a LIVE Stripe key with
// Customers read and write, and the session permission classifier refuses to run a script with that key in
// its environment, which is a correct boundary for a live billing mutation. So the parts that can be driven
// without a key are driven here rather than being asserted by reading, and the untested edge is named in the
// commit rather than left implied.
//
// The load-bearing one is findExistingCustomers. It decides who does NOT get a Customer created, so a lookup
// error that degrades into "no customer found" would double-create for every member who already has one, and
// the two cases are the same shape at the call site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findExistingCustomers, findDump } from '../scripts/recover-customers.mjs';

const members = [{ githubId: '1', login: 'a' }, { githubId: '2', login: 'b' }, { githubId: '3', login: 'c' }];

test('findExistingCustomers: reports exactly the ids Stripe returned a customer for', async () => {
  const stripe = { findCustomerByGithubId: async (id) => (id === '2' ? { id: 'cus_2' } : null) };
  const have = await findExistingCustomers(members, stripe);
  assert.deepEqual([...have].sort(), ['2']);
});

test('findExistingCustomers: a customer with no id is NOT counted as existing', async () => {
  // Stripe returning an object without an id is not a customer, and counting it would SKIP creating one for
  // a member who has none, leaving them unreachable while the run reported them covered.
  const stripe = { findCustomerByGithubId: async () => ({ id: null }) };
  assert.equal((await findExistingCustomers(members, stripe)).size, 0);
});

test('findExistingCustomers: a lookup ERROR aborts, it never degrades into "no customer"', async () => {
  // The whole point. "Could not look" and "nothing there" are indistinguishable downstream, and treating the
  // first as the second creates a duplicate Customer for every member who already has one. This is also the
  // exact failure the available key produces today (more_permissions_required), so it is not hypothetical.
  const stripe = {
    findCustomerByGithubId: async (id) => {
      if (id === '1') return { id: 'cus_1' };
      throw new Error('more_permissions_required');
    },
  };
  await assert.rejects(
    () => findExistingCustomers(members, stripe),
    (e) => /Stripe lookup failed for github_id 2/.test(e.message) && /double-create/.test(e.message),
    'a lookup failure must abort the run and say why',
  );
});

test('findExistingCustomers: an empty member list is an empty set, not a crash', async () => {
  const stripe = { findCustomerByGithubId: async () => { throw new Error('must not be called'); } };
  assert.equal((await findExistingCustomers([], stripe)).size, 0);
});

test('findDump: an explicit MAIL_LEGACY_DUMP wins, and a missing one is null rather than a stale fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recdump-'));
  const older = path.join(dir, 'a-20200101.sql');
  const newer = path.join(dir, 'b-20260602.sql');
  fs.writeFileSync(older, ''); fs.writeFileSync(newer, '');

  assert.equal(findDump(dir, {}), newer, 'with no env var it takes the newest .sql');
  assert.equal(findDump(dir, { MAIL_LEGACY_DUMP: older }), older, 'an explicit path wins over the newest');
  // A pointed-at file that does not exist must be null, NOT a silent fall back to the directory scan: running
  // from a worktree against the wrong path would otherwise quietly use a different dump than intended.
  assert.equal(findDump(dir, { MAIL_LEGACY_DUMP: path.join(dir, 'nope.sql') }), null);
  assert.equal(findDump(path.join(dir, 'no-such-dir'), {}), null, 'a missing directory is null, not a throw');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('the allow-set row shape survives into the Stripe metadata (the silent one)', async () => {
  // grandfatheredAllowSet yields { githubId, login }; planCustomerCreates and recoveredCustomerMetadata read
  // githubLogin/username. Without the mapping in main() every Customer is created with NO github_login and
  // every report line prints "?", and BOTH failures are invisible in a run that otherwise reports success.
  const { planCustomerCreates, recoveredCustomerMetadata } = await import('../scripts/lib/stripe-backfill.mjs');

  const raw = [{ githubId: '7', login: 'someone' }];
  const unmapped = planCustomerCreates({ members: raw, withAddress: new Set(['7']), existingCustomerIds: new Set() });
  assert.equal(unmapped.create[0].githubLogin, null, 'the raw allow-set row loses the login, which is the bug');
  assert.equal(recoveredCustomerMetadata(unmapped.create[0]).github_login, undefined,
    'and the Stripe metadata would carry no github_login at all');

  const mapped = raw.map((m) => ({ githubId: m.githubId, githubLogin: m.login, username: m.login }));
  const fixed = planCustomerCreates({ members: mapped, withAddress: new Set(['7']), existingCustomerIds: new Set() });
  assert.equal(fixed.create[0].githubLogin, 'someone');
  assert.equal(recoveredCustomerMetadata(fixed.create[0]).github_login, 'someone', 'mapped, the metadata is complete');
});
