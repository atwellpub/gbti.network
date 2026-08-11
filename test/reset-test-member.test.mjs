// sow-212: the test-account reset tool. Every destructive path is injectable (env + fetch + clients), so
// there is no network and no secrets here. The tests that matter most are the REFUSALS: this tool deletes
// membership state, and the interesting failure is it running against somebody real.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import {
  allowedTestIds, stripeKeyMode, refusalsFor, warningsFor, planReset, runReset,
  TEST_ACCOUNTS_PATH, RESET_AUDIT_KIND,
} from '../scripts/lib/reset-test-member.mjs';
import { parseArgs } from '../scripts/reset-test-member.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const TEST_KEY = { STRIPE_SECRET_KEY: 'rk_test_abc123' };
const ALLOWED = new Set(['9']);

// --- The allowlist ------------------------------------------------------------------------------------------

test('allowedTestIds reads numeric ids and ignores malformed rows', () => {
  const parsed = yaml.load([
    'test_accounts:',
    '  - github_id: "9"',
    '    login: throwaway',
    '  - github_id: 10',
    '  - github_id: "not-a-number"',
    '  - login: no-id-at-all',
  ].join('\n'));
  assert.deepEqual([...allowedTestIds(parsed)].sort(), ['10', '9']);
});

test('a malformed or empty allowlist admits NOBODY, never a partial set', () => {
  assert.equal(allowedTestIds(null).size, 0);
  assert.equal(allowedTestIds({}).size, 0);
  assert.equal(allowedTestIds({ test_accounts: 'oops' }).size, 0);
  assert.equal(allowedTestIds(yaml.load('test_accounts: []')).size, 0);
});

test('the shipped house/test-accounts.yml parses and is EMPTY by default', () => {
  const parsed = yaml.load(fs.readFileSync(TEST_ACCOUNTS_PATH, 'utf8'));
  assert.equal(allowedTestIds(parsed).size, 0, 'no account is resettable until the owner adds one');
});

// --- The two refusals ---------------------------------------------------------------------------------------

test('stripeKeyMode distinguishes test, live and absent', () => {
  assert.equal(stripeKeyMode('rk_test_abc'), 'test');
  assert.equal(stripeKeyMode('sk_test_abc'), 'test');
  assert.equal(stripeKeyMode('rk_live_abc'), 'live');
  assert.equal(stripeKeyMode('sk_live_abc'), 'live');
  assert.equal(stripeKeyMode(''), 'absent');
  assert.equal(stripeKeyMode(undefined), 'absent');
});

test('REFUSES an id that is not on the allowlist', () => {
  const r = refusalsFor({ githubId: '12345', allowedIds: ALLOWED, env: TEST_KEY });
  assert.equal(r.length, 1);
  assert.match(r[0], new RegExp(TEST_ACCOUNTS_PATH));
});

test('REFUSES a live-mode Stripe key even for an allowlisted id', () => {
  const r = refusalsFor({ githubId: '9', allowedIds: ALLOWED, env: { STRIPE_SECRET_KEY: 'rk_live_xyz' } });
  assert.equal(r.length, 1);
  assert.match(r[0], /LIVE-mode/);
});

test('REFUSES a non-numeric github_id without also reporting downstream noise', () => {
  const r = refusalsFor({ githubId: '../../etc/passwd', allowedIds: ALLOWED, env: TEST_KEY });
  assert.equal(r.length, 1);
  assert.match(r[0], /not a numeric github_id/);
});

test('allows an allowlisted id with a test key, or with no Stripe key at all', () => {
  assert.deepEqual(refusalsFor({ githubId: '9', allowedIds: ALLOWED, env: TEST_KEY }), []);
  assert.deepEqual(refusalsFor({ githubId: '9', allowedIds: ALLOWED, env: {} }), []);
});

// --- The members-index case that must NOT refuse -------------------------------------------------------------

test('a members-index entry is a WARNING, never a refusal', () => {
  // sow-212 proposed refusing here. A successful test signup enrolls itself into members-index.yml, so that
  // refusal would fire in exactly the case this tool exists for.
  const membersIndexParsed = { members: { 9: 'throwaway' } };
  assert.deepEqual(refusalsFor({ githubId: '9', allowedIds: ALLOWED, env: TEST_KEY }), [], 'still allowed');
  const w = warningsFor({ githubId: '9', membersIndexParsed });
  assert.equal(w.length, 1);
  assert.match(w[0], /members-index entry/);
  assert.deepEqual(warningsFor({ githubId: '9', membersIndexParsed: { members: { 10: 'someone-else' } } }), []);
});

// --- The orchestrator ---------------------------------------------------------------------------------------

test('a refused run performs NO writes at all', async () => {
  const fetchImpl = async () => { throw new Error('a refused run must not touch the network'); };
  const res = await runReset({
    githubId: '999', allowedIds: ALLOWED, apply: true, env: { ...CF, ...TEST_KEY }, fetchImpl,
    clients: { stripe: { findCustomerByGithubId: async () => { throw new Error('must not reach Stripe'); } } },
  });
  assert.equal(res.refused, true);
  assert.equal(res.steps, undefined);
});

test('a dry-run returns the plan and performs NO writes', async () => {
  const fetchImpl = async () => { throw new Error('a dry-run must not touch the network'); };
  const res = await runReset({ githubId: '9', allowedIds: ALLOWED, apply: false, env: { ...CF, ...TEST_KEY }, fetchImpl });
  assert.equal(res.apply, false);
  assert.ok(res.plan.some((s) => s.step === 'coupon-grant'));
  assert.ok(res.plan.some((s) => s.step === 'house-records'));
});

test('--apply deletes the coupon lock, resets Stripe, and removes the house records in one PR', async () => {
  const deleted = [];
  const fetchImpl = async (url, init = {}) => {
    const key = url.includes('/values/') ? decodeURIComponent(url.split('/values/')[1]) : null;
    if (init.method === 'DELETE') { deleted.push(key); return { ok: true }; }
    if (init.method === 'PUT') return { ok: true }; // the counter write + the audit record
    if (url.includes('/keys?')) return { ok: true, json: async () => ({ result: [{ name: 'redemption:CODEABLEYEAR:9' }], result_info: {} }) };
    return { ok: true, json: async () => ({ code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' }), text: async () => '3' };
  };
  let deletedCustomer = null;
  const stripe = {
    findCustomerByGithubId: async () => ({ id: 'cus_test_1' }),
    deleteCustomer: async (id) => { deletedCustomer = id; return { id, deleted: true }; },
  };
  const github = {
    getRef: async () => ({ object: { sha: 'BASE' } }),
    createRef: async () => {},
    getContent: async (p) => {
      if (p === 'house/grandfathered.yml') {
        return { sha: 'sg', content: Buffer.from('grandfathered:\n  - github_id: "9"\n    reason: coupon:CODEABLEYEAR\n    until: "2027-01-01T00:00:00.000Z"\n', 'utf8').toString('base64') };
      }
      if (p === 'house/members-index.yml') {
        return { sha: 'si', content: Buffer.from('members:\n  "9": throwaway\n', 'utf8').toString('base64') };
      }
      return null;
    },
    putContent: async () => {},
    createPull: async () => ({ number: 42 }),
    mergePull: async () => {},
  };

  const res = await runReset({
    githubId: '9', allowedIds: ALLOWED, apply: true, operator: 'tester',
    env: { ...CF, ...TEST_KEY }, fetchImpl, clients: { stripe, github },
  });

  assert.equal(res.apply, true);
  const by = Object.fromEntries(res.steps.map((s) => [s.step, s]));
  assert.equal(by['coupon-grant'].outcome, 'deleted');
  assert.ok(deleted.includes('coupon-grant:9'), 'the one-per-member lock is gone');
  assert.equal(by['coupon-redemptions'].outcome, 'deleted');
  assert.ok(deleted.includes('redemption:CODEABLEYEAR:9'));
  assert.equal(by.stripe.outcome, 'deleted');
  assert.equal(deletedCustomer, 'cus_test_1', 'the trial clock resets by deleting the customer');
  assert.match(by['house-records'].detail, /index:removed/);
  assert.match(by['house-records'].detail, /grant:removed/);
});

test('the audit record is a TEST RESET, never confused with a statutory erasure', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'DELETE' || init.method === 'PUT') return { ok: true };
    if (url.includes('/keys?')) return { ok: true, json: async () => ({ result: [], result_info: {} }) };
    return { ok: true, json: async () => null, text: async () => '0' };
  };
  const res = await runReset({ githubId: '9', allowedIds: ALLOWED, apply: true, env: { ...CF, ...TEST_KEY }, fetchImpl });
  assert.equal(res.record.kind, RESET_AUDIT_KIND);
  assert.notEqual(res.record.kind, 'erasure-audit');
});

test('one failing step never hides the others (fail-isolated)', async () => {
  const fetchImpl = async (url, init = {}) => {
    const key = url.includes('/values/') ? decodeURIComponent(url.split('/values/')[1]) : null;
    if (init.method === 'DELETE' && key === 'coupon-grant:9') return { ok: false, status: 500, text: async () => 'boom' };
    if (init.method === 'DELETE' || init.method === 'PUT') return { ok: true };
    if (url.includes('/keys?')) return { ok: true, json: async () => ({ result: [], result_info: {} }) };
    return { ok: true, json: async () => null, text: async () => '0' };
  };
  const res = await runReset({ githubId: '9', allowedIds: ALLOWED, apply: true, env: { ...CF, ...TEST_KEY }, fetchImpl });
  const by = Object.fromEntries(res.steps.map((s) => [s.step, s]));
  assert.equal(by['coupon-grant'].outcome, 'error');
  assert.equal(by['lookup-cache'].outcome, 'deleted', 'later steps still ran');
});

// --- CLI ------------------------------------------------------------------------------------------------------

test('parseArgs defaults to a dry-run and --dry-run beats --apply', () => {
  assert.equal(parseArgs(['--github-id', '9']).apply, false);
  assert.equal(parseArgs(['--github-id', '9', '--apply']).apply, true);
  assert.equal(parseArgs(['--github-id', '9', '--apply', '--dry-run']).apply, false);
  assert.equal(parseArgs(['--github-id', '9', '--with-content']).withContent, true);
  assert.equal(parseArgs(['--github-id', '9']).withContent, false);
});

test('planReset names the grandfather grant, which is the step a KV-only reset would miss', () => {
  const plan = planReset({ githubId: '9' });
  assert.match(plan.find((s) => s.step === 'house-records').action, /grandfathered\.yml/);
  assert.match(plan.find((s) => s.step === 'stripe').action, /trial_started_at/);
});
