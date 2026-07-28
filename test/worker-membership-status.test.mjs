// SOW-011: the signup Worker's /membership/status oracle. Verifies the bearer GitHub token is required and
// verified, and the Stripe-derived status is returned. Injected fetchUser + Stripe client: no network, no secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipStatus } from '../workers/signup/membership-status.mjs';
import { signSession } from '../workers/signup/session.mjs'; // sow-158 Phase 1b: mint a website session cookie

const req = (auth) => new Request('https://signup.gbti.network/membership/status', { headers: auth ? { Authorization: auth } : {} });
const ENV = { STRIPE_SECRET_KEY: 'rk_test' };

const paidCustomer = { id: 'cus_1', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } };

test('requires a bearer token', async () => {
  assert.equal((await membershipStatus(req(null), ENV)).status, 401);
  assert.equal((await membershipStatus(req('Basic xyz'), ENV)).status, 401);
});

test('401 when the GitHub token cannot be verified', async () => {
  const r = await membershipStatus(req('Bearer bad'), ENV, { fetchUser: async () => { throw new Error('401'); } });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'unauthorized');
});

test('verifies the token -> github_id and returns the Stripe-derived status (canCurate false with no mirror)', async () => {
  const r = await membershipStatus(req('Bearer good'), ENV, {
    fetchUser: async () => ({ githubId: '1', githubLogin: 'alice' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
  });
  assert.equal(r.status, 200);
  // No SIGNUP_KV on ENV -> readCanCurate fails closed to false; the status itself is unaffected.
  assert.deepEqual(r.body, { ok: true, github_id: '1', login: 'alice', status: 'paid', canCurate: false, couponUntil: null }); // SOW-119 QA: the grant end date field (null for Stripe-paid)
});

test('SOW-046 C: canCurate is true for a roles.yml curator (read from the fresh KV overrides mirror)', async () => {
  const now = new Date('2026-06-18T00:00:00Z');
  const mirror = {
    generatedAt: new Date(now.getTime() - 60_000).toISOString(),
    roles: { superadmins: [], admins: [], moderators: [], curators: [{ github_id: '7' }] },
  };
  const env = { STRIPE_SECRET_KEY: 'rk_test', SIGNUP_KV: { get: async () => mirror } };
  // a curator
  const r = await membershipStatus(req('Bearer good'), env, {
    fetchUser: async () => ({ githubId: '7', githubLogin: 'cara' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
    now,
  });
  assert.equal(r.body.canCurate, true);
  // a plain member with the same fresh mirror is not a curator
  const r2 = await membershipStatus(req('Bearer good'), env, {
    fetchUser: async () => ({ githubId: '9', githubLogin: 'dan' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
    now,
  });
  assert.equal(r2.body.canCurate, false);
});

test('fails closed to none when the member has no Stripe customer', async () => {
  const r = await membershipStatus(req('Bearer good'), ENV, {
    fetchUser: async () => ({ githubId: '2', githubLogin: 'bob' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => null }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'none');
});

test('500 when Stripe is not configured', async () => {
  const r = await membershipStatus(req('Bearer good'), {}, { fetchUser: async () => ({ githubId: '1', githubLogin: 'a' }) });
  assert.equal(r.status, 500);
});

test('sow-158 Phase 1b: accepts the website session cookie and makes NO GitHub /user call', async () => {
  const SESSION_SECRET = 'status-cookie-secret';
  const session = await signSession({ githubId: '1', githubLogin: 'alice' }, SESSION_SECRET);
  const reqCookie = new Request('https://signup.gbti.network/membership/status', { headers: { Cookie: 'gbti_session=' + session } });
  const r = await membershipStatus(reqCookie, { STRIPE_SECRET_KEY: 'rk_test', SESSION_SECRET }, {
    fetchUser: async () => { throw new Error('the cookie path must not call GitHub /user'); }, // proves no round-trip
    makeStripe: () => ({ findCustomerByGithubId: async () => paidCustomer }),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.github_id, '1');
  assert.equal(r.body.status, 'paid');
});

test('sow-158 Phase 1b: an unsigned/absent cookie and no bearer fails closed (401)', async () => {
  const r = await membershipStatus(req(null), { STRIPE_SECRET_KEY: 'rk_test', SESSION_SECRET: 'x' });
  assert.equal(r.status, 401);
});
