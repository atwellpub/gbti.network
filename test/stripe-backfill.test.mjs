// SOW-166: planning the Stripe Customers that make the legacy-recovered members reachable. No network.
//
// The structural claim under test is that THE PLANNER NEVER HANDLES AN ADDRESS. It is told only whether one
// exists, so no plan, report or log has a field that could carry one. That is asserted directly below rather
// than left as a property of the current implementation.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  planCustomerCreates, recoveredCustomerMetadata, createIdempotencyKey,
} from '../scripts/lib/stripe-backfill.mjs';

const m = (githubId, login) => ({ githubId, githubLogin: login, username: login });

// One member of each kind IN THE SAME RUN, so an exclusion that stopped working cannot pass unnoticed.
const MEMBERS = [m('1', 'recoverable'), m('2', 'alreadyhas'), m('3', 'noaddress')];

test('only a member with an address and no Customer is planned for creation', () => {
  const plan = planCustomerCreates({
    members: MEMBERS,
    withAddress: new Set(['1', '2']),
    existingCustomerIds: new Set(['2']),
  });
  assert.deepEqual(plan.create.map((r) => r.githubId), ['1']);
  assert.deepEqual(plan.alreadyHasCustomer.map((r) => r.githubId), ['2'], 'having an address does not override having a Customer');
  assert.deepEqual(plan.noAddress.map((r) => r.githubId), ['3']);
  const total = plan.create.length + plan.alreadyHasCustomer.length + plan.noAddress.length;
  assert.equal(total, MEMBERS.length, 'every member lands in exactly one bucket');
});

test('an existing Customer is checked BEFORE the address, and the ordering is pinned', () => {
  // The key protects a RE-RUN of the same plan. It cannot protect a plan built against a stale read, because
  // a different key would be a different create. This ordering is what covers that case.
  const both = planCustomerCreates({
    members: [m('9', 'raced')], withAddress: new Set(['9']), existingCustomerIds: new Set(['9']),
  });
  assert.equal(both.create.length, 0, 'nobody is created twice');
  assert.equal(both.alreadyHasCustomer.length, 1);

  // THE INPUT THAT ACTUALLY DISCRIMINATES THE ORDER, and the reason this test was rewritten: with an address
  // AND a Customer, both orderings agree, so the assertion above passes whichever way round the checks go. A
  // member with a Customer and NO address is the case that separates them. Correct order files them under
  // alreadyHasCustomer (the true and more useful fact); the reverse files them under noAddress, which reads
  // as "we could not reach them" about somebody who is perfectly reachable.
  const customerNoAddress = planCustomerCreates({
    members: [m('9', 'raced')], withAddress: new Set(), existingCustomerIds: new Set(['9']),
  });
  assert.deepEqual(customerNoAddress.alreadyHasCustomer.map((r) => r.githubId), ['9']);
  assert.equal(customerNoAddress.noAddress.length, 0, 'not reported as unreachable when they have a Customer');
});

test('THE PLAN CARRIES NO ADDRESS, structurally', () => {
  // Feed the planner a members list contaminated with an address field, as a hostile caller would, and prove
  // it does not survive into the plan. The planner has no parameter for an address at all; this pins that a
  // stray one on the input cannot ride along either.
  const contaminated = [{ ...m('1', 'x'), email: 'someone@example.test', emailEnc: 'ciphertext' }];
  const plan = planCustomerCreates({ members: contaminated, withAddress: new Set(['1']) });
  const serialized = JSON.stringify(plan);
  assert.ok(!serialized.includes('@'), 'no address reaches the plan');
  assert.ok(!serialized.includes('ciphertext'), 'and neither does an encrypted one');
  assert.deepEqual(Object.keys(plan.create[0]).sort(), ['githubId', 'githubLogin', 'username']);
});

test('the metadata mirrors a normal signup, and deliberately carries NO trial clock', () => {
  const md = recoveredCustomerMetadata({ githubId: '42', githubLogin: 'SomeOne' });
  assert.equal(md.github_id, '42');
  assert.equal(md.github_login, 'someone', 'lowercased, as the folder convention requires');
  assert.equal(md.signup_source, 'legacy-recovery', 'so this Customer can be accounted for later');

  // A trial clock would make deriveStatusFromCustomer return `expired` once elapsed, which account.astro
  // renders literally. With no clock it returns `none`, and the grandfather grant supplies their real access.
  assert.equal('trial_started_at' in md, false);

  // No address field exists on the metadata either.
  assert.ok(!JSON.stringify(md).includes('@'));
});

test('the idempotency key is per member, so a re-run cannot double-create', () => {
  assert.equal(createIdempotencyKey('42'), 'legacy-recovery:42');
  assert.notEqual(createIdempotencyKey('42'), createIdempotencyKey('43'), 'and is distinct per member');
});
