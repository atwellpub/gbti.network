// Credential health check: the pure decision logic + the probe wiring (fake fetch, no network, no email).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysUntil, evaluate, buildEmail, runProbes, productionVarFromToml } from '../scripts/check-credentials.mjs';

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

// 2026-08-25: the SAME control, on the production KV WRITE token. It went unmonitored for months while this
// suite was green, because its probe reported liveness only: no `expiresAt`, no `mustExpire`. That is the
// silence `mustExpire` exists to break, and the read token having it was not enough, since the write token is
// the one with account-level Edit. These two tests fail against the probe as it stood before that date.
test('runProbes: the KV WRITE token probe declares mustExpire and reports the expiry Cloudflare returns', async () => {
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'active', expires_on: '2027-08-25T00:00:00Z' } }) });
  const results = await runProbes({ env: { CF_API_TOKEN: 'tok' }, fetch });
  const r = results.find((x) => x.name.startsWith('CF_API_TOKEN'));
  assert.ok(r, 'the probe runs when the secret is present');
  assert.equal(r.ok, true);
  assert.equal(r.mustExpire, true, 'without this an unexpiring account-wide KV WRITE token reads as healthy forever');
  assert.equal(r.expiresAt, '2027-08-25T00:00:00Z');
  assert.equal(evaluate(results, { now: new Date('2026-08-25T00:00:00Z') }).healthy, true);
});

test('runProbes: a KV WRITE token with NO expiry is reported as a PROBLEM, not as healthy', async () => {
  // Live and valid, carrying no TTL. This is the exact state the token was in before 2026-08-25, and the
  // state this monitor previously called healthy.
  const fetch = async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'active' } }) });
  const results = await runProbes({ env: { CF_API_TOKEN: 'tok' }, fetch });
  const { problems, healthy } = evaluate(results);
  assert.equal(healthy, false, 'an unexpiring account-wide KV write credential must not pass');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'no-expiry');
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

// The no-expiry alarm has a twin hole one step along, found by asking what ELSE could make it silent.
// A mustExpire credential reporting an UNPARSEABLE expiry evaluated as HEALTHY: daysUntil returns null so no
// window can contain it, and expiresAt is truthy so the no-expiry branch stays quiet. A garbage date is
// indistinguishable from a valid far-future one. Reachable whenever a provider changes its date format, and
// the probes parse two such formats from two vendors, neither of which is ours to pin.
test('evaluate: mustExpire + an UNPARSEABLE expiry is flagged, not silently healthy', () => {
  const now = new Date('2026-08-18T00:00:00Z');
  for (const bad of ['not-a-date', 'never', 'Expires: -', '???']) {
    const { problems, healthy } = evaluate([{ name: 'T', ok: true, mustExpire: true, expiresAt: bad }], { now });
    assert.equal(healthy, false, `${bad} must not read as healthy`);
    assert.equal(problems[0].kind, 'unreadable-expiry');
  }
});

test('evaluate: a PARSEABLE expiry still behaves normally, so the new branch is not swallowing the good case', () => {
  const now = new Date('2026-08-18T00:00:00Z');
  // ISO and the looser human form Cloudflare renders in its dashboard both parse.
  for (const good of ['2027-08-28T00:00:00Z', 'Aug 28, 2027']) {
    assert.equal(evaluate([{ name: 'T', ok: true, mustExpire: true, expiresAt: good }], { now }).healthy, true, good);
  }
  const soon = evaluate([{ name: 'T', ok: true, mustExpire: true, expiresAt: '2026-08-20T00:00:00Z' }], { now });
  assert.equal(soon.problems[0].kind, 'expiring', 'a near expiry is still the expiring case, not unreadable');
});

test('evaluate: the unreadable-expiry check is mustExpire-only, so opted-out credentials are unaffected', () => {
  // Same opt-in discipline as the no-expiry branch: Stripe and the Discord bot legitimately report nothing,
  // and a check that fired on them would be noise, which is how a guard gets switched off.
  const now = new Date('2026-08-18T00:00:00Z');
  assert.equal(evaluate([{ name: 'T', ok: true, expiresAt: 'not-a-date' }], { now }).healthy, true);
});

// 2026-08-24: the window has two ends. These pin the one that was never checked.
test('evaluate: a not-yet-valid credential is a problem even though every other signal reads healthy', () => {
  // The exact shape Cloudflare returns for a token whose start date is in the future: ok, active, and a
  // far-future expiry. Before this branch existed the monitor printed OK for precisely this input.
  const r = { name: 'CF', ok: true, status: 200, detail: 'active', expiresAt: '2027-08-31T23:59:59Z', notBefore: '2027-08-18T00:00:00Z', mustExpire: true };
  const { problems, healthy } = evaluate([r], { warnDays: 30, now: NOW });
  assert.equal(healthy, false);
  assert.equal(problems.length, 1, 'exactly one problem, not also an expiry warning');
  assert.equal(problems[0].kind, 'not-yet-valid');
  assert.match(problems[0].message, /NOT YET VALID/);
  assert.match(problems[0].message, /2027-08-18T00:00:00Z/);
});

test('evaluate: a not_before in the PAST is normal and flags nothing', () => {
  const r = { name: 'CF', ok: true, status: 200, expiresAt: '2027-06-09T00:00:00Z', notBefore: '2026-06-01T00:00:00Z', mustExpire: true };
  assert.deepEqual(evaluate([r], { warnDays: 30, now: NOW }).problems, []);
});

test('evaluate: an absent or unparseable notBefore is ignored, not treated as future', () => {
  const base = { name: 'CF', ok: true, status: 200, expiresAt: '2027-06-09T00:00:00Z', mustExpire: true };
  assert.deepEqual(evaluate([base], { warnDays: 30, now: NOW }).problems, []);
  assert.deepEqual(evaluate([{ ...base, notBefore: null }], { warnDays: 30, now: NOW }).problems, []);
  assert.deepEqual(evaluate([{ ...base, notBefore: 'not a date' }], { warnDays: 30, now: NOW }).problems, []);
});

test('evaluate: a failed probe still reports as failed, not as not-yet-valid', () => {
  const r = { name: 'CF', ok: false, status: 403, notBefore: '2027-08-18T00:00:00Z' };
  const { problems } = evaluate([r], { warnDays: 30, now: NOW });
  assert.equal(problems.length, 1);
  assert.equal(problems[0].kind, 'failed');
});

test('runProbes: the Cloudflare probes carry not_before through from the API response', async () => {
  const fetchStub = async () => ({
    ok: true, status: 200,
    json: async () => ({ success: true, result: { status: 'active', expires_on: '2027-08-31T23:59:59Z', not_before: '2027-08-18T00:00:00Z' } }),
  });
  const out = await runProbes({ env: { CF_KV_READ_TOKEN: 'x', CF_API_TOKEN: 'y' }, fetch: fetchStub });
  assert.equal(out.length, 2, 'both Cloudflare probes ran');
  for (const r of out) assert.equal(r.notBefore, '2027-08-18T00:00:00Z', `${r.name} lost not_before`);
  // End to end: the probe output alone is enough for evaluate to catch it.
  assert.equal(evaluate(out, { warnDays: 30, now: NOW }).problems.every((p) => p.kind === 'not-yet-valid'), true);
});

// --- sow-279: the coupon-redemption alarm self-test ------------------------------------------------------
// The alarm is the ONLY control on three uncapped free-year codes, and it has twice been in a state where it
// looked present and sent nothing. These cover the two ways the weekly probe could go quietly useless: reading
// the recipient from a place wrangler does not deploy, and treating a non-send as a pass.

test('productionVarFromToml: reads the production env block, not the base [vars] block', () => {
  // Wrangler does NOT inherit top-level [vars] into a named environment. A recipient sitting only in the base
  // block is committed and still absent from the deployed Worker, so finding it there would report a working
  // alarm that sends nowhere. Empty is the correct answer.
  const baseOnly = '[vars]\nCOUPON_ALERT_EMAIL = "wrong@example.com"\n\n[env.production.vars]\nMAIL_FROM = "a@b"\n';
  assert.equal(productionVarFromToml(baseOnly, 'COUPON_ALERT_EMAIL'), '');
  const inProd = '[vars]\nCOUPON_ALERT_EMAIL = "wrong@example.com"\n\n[env.production.vars]\nCOUPON_ALERT_EMAIL = "right@example.com"\n';
  assert.equal(productionVarFromToml(inProd, 'COUPON_ALERT_EMAIL'), 'right@example.com');
});

test('productionVarFromToml: a commented-out or absent var reads as empty, never as set', () => {
  assert.equal(productionVarFromToml('[env.production.vars]\n# COUPON_ALERT_EMAIL = "x@y"\n', 'COUPON_ALERT_EMAIL'), '');
  assert.equal(productionVarFromToml('[env.production.vars]\nMAIL_FROM = "a@b"\n', 'COUPON_ALERT_EMAIL'), '');
  assert.equal(productionVarFromToml('', 'COUPON_ALERT_EMAIL'), '');
  assert.equal(productionVarFromToml(null, 'COUPON_ALERT_EMAIL'), '');
});

test('the live Worker config carries the alarm recipient in the DEPLOYED section', async () => {
  // Reads the real file on purpose. If someone moves COUPON_ALERT_EMAIL up into [vars] the diff looks harmless,
  // the repo still "has" it, and the deployed Worker silently stops alerting. This is the guard for that.
  const { readFileSync } = await import('node:fs');
  const toml = readFileSync(new URL('../workers/signup/wrangler.toml', import.meta.url), 'utf8');
  assert.match(productionVarFromToml(toml, 'COUPON_ALERT_EMAIL'), /@/, 'no coupon alarm recipient in [env.production.vars]');
  assert.match(productionVarFromToml(toml, 'MAIL_FROM'), /@/, 'no sender in [env.production.vars]');
});

test('runProbes: the coupon alarm probe sends through the real alert path and passes only on a real send', async () => {
  const calls = [];
  const sendAlert = async (env, record, opts) => { calls.push({ env, record, opts }); return { sent: true }; };
  const out = await runProbes({ env: { RESEND_API_KEY: 're_x' }, fetch: async () => { throw new Error('no probe should fetch here'); }, sendAlert });
  const probe = out.find((r) => /COUPON_ALERT_EMAIL/.test(r.name));
  assert.ok(probe, 'the coupon alarm probe did not run with RESEND_API_KEY set');
  assert.equal(probe.ok, true);
  assert.equal(calls.length, 1, 'the probe must send exactly one notice');
  assert.equal(calls[0].opts.selfTest, true, 'the weekly email must be marked as a self-test, not look like a redemption');
  assert.match(calls[0].env.COUPON_ALERT_EMAIL, /@/, 'the probe must address the configured recipient');
  assert.equal(calls[0].env.RESEND_API_KEY, 're_x');
});

test('runProbes: a coupon alarm that does not send is a FAILED probe, with the reason carried', async () => {
  // sendCouponRedemptionAlert is fail-soft and never throws, so `sent: false` is the only signal there is.
  // Reading an unconfigured or rejected send as a pass would restore exactly the silence this probe exists for.
  const sendAlert = async () => ({ sent: false, reason: 'error', message: 'Resend rejected the sender domain' });
  const out = await runProbes({ env: { RESEND_API_KEY: 're_x' }, sendAlert });
  const probe = out.find((r) => /COUPON_ALERT_EMAIL/.test(r.name));
  assert.equal(probe.ok, false);
  assert.match(probe.detail, /Resend rejected the sender domain/);
  assert.equal(evaluate([probe], { warnDays: 30, now: NOW }).healthy, false, 'a dead alarm must make the run red');
});

test('runProbes: no Resend key means the coupon probe is skipped, not silently passed', async () => {
  const sendAlert = async () => { throw new Error('must not be called without a key'); };
  const out = await runProbes({ env: { CF_API_TOKEN: 'tok' }, fetch: async () => ({ ok: true, status: 200, json: async () => ({ result: { status: 'active', expires_on: '2027-01-01T00:00:00Z' } }) }), sendAlert });
  assert.equal(out.some((r) => /COUPON_ALERT_EMAIL/.test(r.name)), false);
});
// ---------------------------------------------------------------------------------------------------
// The html body. This alert fires when a credential has already failed or is about to, so it is the one
// email where legibility under stress matters most, and a wall of console text is the worst way to deliver it.
// ---------------------------------------------------------------------------------------------------

// The markup of the cell a given string was rendered into. Used to prove that a failure and an expiry warning
// are rendered DIFFERENTLY, without hard-coding the layout module's palette, which is free to change.
function cellAround(html, needle) {
  const at = html.indexOf(needle);
  assert.notEqual(at, -1, `the html body is missing: ${needle}`);
  return html.slice(html.lastIndexOf('<td', at), html.indexOf('</td>', at));
}

test('buildEmail: the html body carries the same facts as the text body', () => {
  const problems = [
    { name: 'GH', kind: 'failed', message: 'GH FAILED its live check (status 401).' },
    { name: 'CF', kind: 'expiring', message: 'CF expires in 5 day(s).' },
  ];
  const { text, html } = buildEmail(problems, { now: NOW });
  assert.match(html, /^<!doctype html>/, 'a full document, not a fragment');
  assert.match(html, /Credential health alert/);
  assert.match(html, /2 credentials need attention/, 'the lead says how many credentials need attention');
  assert.match(html, /2026-06-20/, 'the run date travels with it, as in the text body');
  for (const p of problems) assert.ok(html.includes(p.message), `${p.name}: the html dropped a message the text body carries`);
  assert.match(html, /EXPIRING/, 'the kind is labelled, the way the text body prints [EXPIRING]');
  assert.match(html, /secrets-ops\/README\.md/, 'the remediation guidance is in both bodies');
  assert.match(html, /credential-health GitHub Action/, 'the automated-message footer is in both bodies');
  // The plain text body stays the fallback and keeps its own shape.
  assert.match(text, /\[FAILED\] GH FAILED its live check/);
});

test('buildEmail: a hard failure is visually distinct from an expiry warning', () => {
  // Same message, two kinds. A credential that is dead right now and one that expires in three weeks call for
  // different actions in the next hour, and a uniform list hides that.
  const message = 'TOKEN is in trouble.';
  const failed = buildEmail([{ name: 'T', kind: 'failed', message }], { now: NOW }).html;
  const expiring = buildEmail([{ name: 'T', kind: 'expiring', message }], { now: NOW }).html;
  assert.match(cellAround(failed, message), /border-left/, 'an outright failure must get the emphasised band');
  assert.doesNotMatch(cellAround(expiring, message), /border-left/, 'an expiry warning must not shout like a failure');
});

test('buildEmail: an unrecognised kind is treated as a failure, not quietly listed as a warning', () => {
  // The classification names the CALM kinds, so anything added to evaluate() later lands on the loud side until
  // somebody classifies it. Over-emphasis costs one glance; under-emphasis is how an outage reads as routine.
  const message = 'SOMETHING new went wrong.';
  const html = buildEmail([{ name: 'T', kind: 'some-future-kind', message }], { now: NOW }).html;
  assert.match(cellAround(html, message), /border-left/);
  assert.match(html, /SOME FUTURE KIND/, 'the kind is shouted as words, hyphens and all');
});

test('buildEmail: every interpolated value is escaped', () => {
  // A credential name and a probe detail both reach this body from outside (a provider response, a config value),
  // and an ops mailbox is exactly where broken-out markup would be read by someone with privilege.
  const nasty = '<script>alert("x" & \'y\')</script>';
  const { html } = buildEmail([
    { name: nasty, kind: 'failed', message: `${nasty} FAILED its live check.` },
    { name: nasty, kind: 'expiring', message: `${nasty} expires soon.` },
  ], { now: NOW });
  assert.ok(!html.includes('<script>'), 'a raw script tag reached the html body');
  assert.ok(html.includes('&lt;script&gt;'), 'the tag should be present, escaped');
  assert.ok(html.includes('&amp;'), 'the ampersand should be escaped');
  assert.ok(html.includes('&quot;') || html.includes('&#34;'), 'the double quote should be escaped');
});

test('buildEmail: an empty or missing problem list still builds both bodies', () => {
  // main() only emails when there ARE problems, but a builder that throws on the empty case is a trap for any
  // later caller, and a throw here means no notice arrives at all.
  for (const input of [[], undefined, null]) {
    const { subject, text, html } = buildEmail(input, { now: NOW });
    assert.match(subject, /0 issues/);
    assert.ok(text.length > 0);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /0 credentials need attention/);
  }
});

// ---------------------------------------------------------------------------------------------------
// THE CALL SITE, not the builder. A perfect html body that no caller passes to sendEmail is the failure this
// project keeps repeating: the builder and the send live in different places, so `buildEmail` returning html
// proves nothing about what leaves the machine. This runs the script for real, with fetch replaced before it
// loads, and asserts on the request that reaches Resend. Delete the `html` from the sendEmail call in main()
// and this test goes red; a test on buildEmail alone stays green.
// ---------------------------------------------------------------------------------------------------

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CRED_SCRIPT = path.resolve(fileURLToPath(import.meta.url), '../../scripts/check-credentials.mjs');

// Preloaded with --import so it replaces fetch BEFORE the script under test runs. It records every request and
// answers Resend with a success; every other url is a credential probe and is failed, so the run has a problem
// to report and therefore reaches the email. Nothing here touches the network.
const FETCH_STUB = `
import { appendFileSync } from 'node:fs';
const capture = process.env.CRED_HEALTH_CAPTURE;
globalThis.fetch = async (url, init = {}) => {
  const entry = { url: String(url), method: (init && init.method) || 'GET', body: init && init.body ? String(init.body) : null };
  appendFileSync(capture, JSON.stringify(entry) + '\\n');
  if (entry.url.startsWith('https://api.resend.com/')) {
    return { ok: true, status: 200, text: async () => '{"id":"stub"}', headers: { get: () => null } };
  }
  return { ok: false, status: 401, text: async () => '', json: async () => ({}), headers: { get: () => null } };
};
`;

test('the script SENDS the html body, not only the text one', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cred-health-'));
  const capture = path.join(dir, 'requests.jsonl');
  const stub = path.join(dir, 'fetch-stub.mjs');
  writeFileSync(capture, '');
  writeFileSync(stub, FETCH_STUB);

  // A MINIMAL env on purpose: inheriting process.env would let a real STRIPE_SECRET_KEY or CF_API_TOKEN on the
  // developer's machine turn this into live probes of production credentials.
  const run = spawnSync(process.execPath, ['--import', pathToFileURL(stub).href, CRED_SCRIPT], {
    encoding: 'utf8',
    timeout: 60000,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      CRED_HEALTH_CAPTURE: capture,
      GITHUB_BOT_TOKEN: 'ghp_stub',
      RESEND_API_KEY: 're_stub',
      ALERT_EMAIL: 'ops@example.test',
      RESEND_FROM: 'noreply@example.test',
    },
  });

  assert.equal(run.status, 1, `the run should exit non-zero on a problem. stderr: ${run.stderr}`);
  assert.match(run.stderr, /Alert emailed to ops@example\.test/, `main() did not reach the send. stderr: ${run.stderr}`);

  const sends = readFileSync(capture, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((r) => r.url.startsWith('https://api.resend.com/emails') && r.body)
    .map((r) => JSON.parse(r.body))
    .filter((b) => /credential alert/i.test(String(b.subject)));
  assert.equal(sends.length, 1, 'exactly one credential alert should have been sent');

  const sent = sends[0];
  assert.equal(sent.to, 'ops@example.test');
  assert.ok(typeof sent.html === 'string' && sent.html.length > 0,
    'the html body never reached sendEmail: main() must pass html, not only text');
  assert.match(sent.html, /^<!doctype html>/);
  assert.match(sent.html, /GH_BOT_TOKEN/, 'the alert should name the credential that failed');
  assert.ok(typeof sent.text === 'string' && sent.text.length > 0, 'the plain-text fallback must still be sent');
});
