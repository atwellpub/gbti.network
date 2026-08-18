// Credential health check: the pure decision logic + the probe wiring (fake fetch, no network, no email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, evaluate, buildEmail, runProbes } from '../scripts/check-credentials.mjs';

const NOW = new Date('2026-06-20T00:00:00Z');

test('daysUntil: whole days, null for undated/unparseable', () => {
  assert.equal(daysUntil('2026-06-30T00:00:00Z', NOW), 10);
  assert.equal(daysUntil('2026-06-10T00:00:00Z', NOW), -10);
  assert.equal(daysUntil(null, NOW), null);
  assert.equal(daysUntil('not a date', NOW), null);
});

test('evaluate: a failed probe is a problem regardless of expiry', () => {
  const { problems, healthy } = evaluate([{ name: 'X', ok: false, status: 401 }], { warnDays: 30, now: NOW });
  assert.equal(healthy, false);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'failed');
  assert.match(problems[0].message, /FAILED its live check \(status 401/);
});

test('evaluate: an ok probe expiring within the window is flagged; far-future is healthy', () => {
  const within = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2026-07-10T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.equal(within.problems.length, 1);
  assert.equal(within.problems[0].kind, 'expiring');
  assert.match(within.problems[0].message, /expires in 20 day/);

  const far = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2027-06-09T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.deepEqual(far.problems, []);
  assert.equal(far.healthy, true);
});

test('evaluate: an already-expired ok probe is flagged as expired', () => {
  const { problems } = evaluate([{ name: 'GH', ok: true, status: 200, expiresAt: '2026-06-10T00:00:00Z' }], { warnDays: 30, now: NOW });
  assert.equal(problems[0].kind, 'expired');
  assert.match(problems[0].message, /EXPIRED 10 day\(s\) ago/);
});

test('evaluate: a no-expiry credential that is ok is healthy', () => {
  const { healthy } = evaluate([{ name: 'STRIPE', ok: true, status: 200 }], { warnDays: 30, now: NOW });
  assert.equal(healthy, true);
});

test('buildEmail: subject counts issues, body lists each', () => {
  const { subject, text } = buildEmail([
    { name: 'GH', kind: 'expiring', message: 'GH expires in 5 day(s).' },
    { name: 'CF', kind: 'failed', message: 'CF FAILED.' },
  ], { now: NOW });
  assert.match(subject, /2 issues/);
  assert.match(text, /\[EXPIRING\] GH expires in 5/);
  assert.match(text, /\[FAILED\] CF FAILED/);
  assert.match(text, /secrets-ops\/README\.md/);
});

test('runProbes: reads the GitHub expiry header, skips absent credentials', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(url);
    if (url.includes('api.github.com')) {
      assert.match(init.headers.Authorization, /^Bearer /);
      return { ok: true, status: 200, headers: { get: (h) => (h === 'github-authentication-token-expiration' ? '2027-06-09 14:33:55 +0000' : null) } };
    }
    if (url.includes('api.stripe.com')) return { ok: true, status: 200, headers: { get: () => null } };
    throw new Error('unexpected url ' + url);
  };
  // Only GitHub + Stripe present -> Discord + Cloudflare are skipped.
  const results = await runProbes({ env: { GITHUB_BOT_TOKEN: 'ghp_x', STRIPE_SECRET_KEY: 'rk_live_x' }, fetch: fakeFetch });
  assert.equal(results.length, 2);
  const gh = results.find((r) => r.name.startsWith('GH_BOT_TOKEN'));
  assert.equal(gh.ok, true);
  assert.equal(gh.expiresAt, '2027-06-09 14:33:55 +0000');
  assert.ok(calls.some((u) => u.includes('api.github.com')));
  assert.ok(!calls.some((u) => u.includes('discord.com')));
});

test('runProbes: a thrown fetch becomes a failed (not a crash)', async () => {
  const results = await runProbes({ env: { DISCORD_BOT_TOKEN: 'x' }, fetch: async () => { throw new Error('network down'); } });
  assert.equal(results.length, 1);
  assert.equal(results[0].ok, false);
  assert.match(results[0].detail, /network down/);
});

// ---------------------------------------------------------------------------------------------------
// mustExpire: a credential required to carry an expiry, that reports none, is ITSELF the problem.
// Regression guard for the 2026-08-11 finding: GH_BOT_TOKEN was a no-expiration classic PAT recorded as a
// temporary stopgap, holding the rights that MERGE member PRs, and it sat 44 days past its own tightening
// deadline with a GREEN monitor. It was unflaggable by construction: no expiry means no date, so it could
// never fall within warnDays, while the liveness probe passed forever. Setting no expiry removed the alarm
// as well as the deadline.
// ---------------------------------------------------------------------------------------------------

test('evaluate: mustExpire + NO expiry is flagged (the alarm a no-expiry token would otherwise silence)', () => {
  const { problems, healthy } = evaluate([{ name: 'GH_BOT_TOKEN', ok: true, mustExpire: true }]);
  assert.equal(healthy, false);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'no-expiry');
  assert.match(problems[0].message, /NO EXPIRY/);
});

test('evaluate: mustExpire is OPT-IN, so a legitimately unexpiring credential is not a false positive', () => {
  // Stripe + Discord tokens genuinely never expire; flagging them would train the operator to ignore alerts.
  const { healthy } = evaluate([
    { name: 'STRIPE_SECRET_KEY', ok: true },
    { name: 'DISCORD_BOT_TOKEN', ok: true },
  ]);
  assert.equal(healthy, true);
});

test('evaluate: mustExpire with a real expiry keeps the ordinary expiring/healthy behaviour', () => {
  const now = new Date('2026-08-11T00:00:00Z');
  const far = evaluate([{ name: 'GH_BOT_TOKEN', ok: true, mustExpire: true, expiresAt: '2027-06-09T00:00:00Z' }], { now });
  assert.equal(far.healthy, true);
  const near = evaluate([{ name: 'GH_BOT_TOKEN', ok: true, mustExpire: true, expiresAt: '2026-08-20T00:00:00Z' }], { now });
  assert.equal(near.problems[0].kind, 'expiring');
});

test('evaluate: a FAILED probe still outranks the no-expiry check', () => {
  const { problems } = evaluate([{ name: 'GH_BOT_TOKEN', ok: false, status: 401, mustExpire: true }]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'failed');
});

test('runProbes: the GitHub token probe declares mustExpire', async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, headers: { get: () => null } });
  const results = await runProbes({ env: { GITHUB_BOT_TOKEN: 'ghp_x' }, fetch: fakeFetch });
  const gh = results.find((r) => r.name.startsWith('GH_BOT_TOKEN'));
  assert.equal(gh.mustExpire, true, 'GH_BOT_TOKEN must declare mustExpire or a no-expiration PAT goes unnoticed again');
  // And end to end: that probe result, with no expiry header, must produce a problem.
  assert.equal(evaluate(results).healthy, false);
});

// sow-213: the gate's KV read token. Its expiry is not bookkeeping, it is the compensating control, because
// Cloudflare's KV permission is account-level and the token cannot be confined by scope. So "did the TTL
// actually save" has to be answered by a machine on every run rather than by someone remembering to look:
// on day one the owner reported setting one and the Cloudflare token list showed `Expires: -`, which is how
// a no-expiry token renders. These tests pin both readings.
test('runProbes: the KV read token probe declares mustExpire and reports the expiry Cloudflare returns', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'active', expires_on: '2027-08-28T00:00:00Z' } }) });
  const results = await runProbes({ env: { CF_KV_READ_TOKEN: 'tok' }, fetch });
  const r = results.find((x) => x.name.startsWith('CF_KV_READ_TOKEN'));
  assert.ok(r, 'the probe runs when the secret is present');
  assert.equal(r.ok, true);
  assert.equal(r.mustExpire, true, 'without this the no-expiry case can never be flagged');
  assert.equal(r.expiresAt, '2027-08-28T00:00:00Z');
  assert.equal(evaluate(results, { now: new Date('2026-08-18T00:00:00Z') }).healthy, true);
});

test('runProbes: a KV read token with NO expiry is reported as a PROBLEM, not as healthy', async () => {
  // The exact doubt this probe exists to settle: live and valid, but carrying no TTL, so the control that
  // justified accepting an account-wide token does not exist. Liveness alone would call this green.
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'active' } }) });
  const results = await runProbes({ env: { CF_KV_READ_TOKEN: 'tok' }, fetch });
  const { problems, healthy } = evaluate(results, { now: new Date('2026-08-18T00:00:00Z') });
  assert.equal(healthy, false, 'a live-but-unexpiring token must not read as healthy');
  assert.equal(problems[0].kind, 'no-expiry');
  assert.match(problems[0].name, /^CF_KV_READ_TOKEN/);
});

test('runProbes: an inactive KV read token fails its live check', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'disabled' } }) });
  const results = await runProbes({ env: { CF_KV_READ_TOKEN: 'tok' }, fetch });
  assert.equal(results.find((x) => x.name.startsWith('CF_KV_READ_TOKEN')).ok, false, 'active status is required, not just HTTP 200');
});
