// sow-279: the fail-soft owner-alert sender. The property that matters is that it NEVER throws and NEVER
// blocks signup: it runs on the completion path (through waitUntil) after the grant is already written.
//
// Mutation checks: remove the try/catch and the "throwing send does not throw" test goes red; remove the
// unconfigured guard and the "no recipient -> no send" test goes red (it would call an undefined sender).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sendCouponRedemptionAlert } from '../workers/signup/coupon-alert.mjs';

const RECORD = {
  code: 'CODEABLEYEAR', campaign: 'CODEABLEYEAR', tier: 'member',
  until: '2027-08-25T00:00:00.000Z', redeemedAt: '2026-08-25T00:00:00.000Z',
  login: 'octocat', githubId: '12345',
};
const ENV = { COUPON_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'noreply@gbti.network', RESEND_API_KEY: 'test' };

test('sends via the injected sender with from/to/subject/text and reports sent', async () => {
  const calls = [];
  const res = await sendCouponRedemptionAlert(ENV, RECORD, { sendEmail: async (m) => { calls.push(m); return { id: 'x' }; } });
  assert.deepEqual(res, { sent: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].to, 'owner@example.com');
  assert.equal(calls[0].from, 'noreply@gbti.network');
  assert.match(calls[0].subject, /CODEABLEYEAR/);
  assert.match(calls[0].text, /octocat/);
});

test('unconfigured (no recipient) is a no-op, not a send and not a throw', async () => {
  let called = false;
  const res = await sendCouponRedemptionAlert({ ...ENV, COUPON_ALERT_EMAIL: '' }, RECORD, { sendEmail: async () => { called = true; } });
  assert.deepEqual(res, { sent: false, reason: 'unconfigured' });
  assert.equal(called, false);
});

test('unconfigured (no MAIL_FROM) is a no-op', async () => {
  let called = false;
  const res = await sendCouponRedemptionAlert({ ...ENV, MAIL_FROM: '', RESEND_FROM: '' }, RECORD, { sendEmail: async () => { called = true; } });
  assert.deepEqual(res, { sent: false, reason: 'unconfigured' });
  assert.equal(called, false);
});

test('FAIL-SOFT: a throwing send does not throw out, it reports the error', async () => {
  const res = await sendCouponRedemptionAlert(ENV, RECORD, { sendEmail: async () => { throw new Error('resend 500'); } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'error');
  assert.match(res.message, /resend 500/);
});

// --- sow-279 follow-up (2026-08-26): the notice must fail LOUDLY, not merely fail softly. ---
//
// `house/coupons.yml` requires this control to log and surface a failure, because it is the ONLY control on the
// uncapped codes rather than one of several. It did neither until now: it swallowed the error and returned a
// result the caller discards (index.mjs fires it through ctx.waitUntil and never reads the resolved value), so a
// send Resend rejected left no email, no log and no trace. From outside, that is identical to a code that was
// never redeemed, which is the precise state the notice was built to end.
//
// These assert on console.warn because the log IS the deliverable here. Run them against the previous version of
// coupon-alert.mjs and all three go red for the right reason: zero warnings captured.

function captureWarn(fn) {
  const orig = console.warn;
  const lines = [];
  console.warn = (...a) => lines.push(a.join(' '));
  return Promise.resolve()
    .then(fn)
    .then((v) => ({ value: v, lines }))
    .finally(() => { console.warn = orig; });
}

test('LOUD: a rejected send is logged, naming the code and the github_id', async () => {
  const { value, lines } = await captureWarn(() => sendCouponRedemptionAlert(
    ENV, RECORD, { sendEmail: async () => { throw new Error('Resend 422 domain not verified'); } },
  ));
  assert.equal(value.sent, false);
  assert.equal(value.reason, 'error');
  assert.equal(lines.length, 1, 'exactly one warning, so a failure is neither silent nor duplicated');
  assert.match(lines[0], /coupon-alert: notice FAILED/);
  assert.match(lines[0], /CODEABLEYEAR/, 'the code, so the owner knows WHICH code to deactivate');
  assert.match(lines[0], /12345/, 'the github_id, so the redemption is attributable');
  assert.match(lines[0], /Resend 422 domain not verified/, 'the underlying cause, not just that it failed');
});

test('LOUD: an unconfigured alarm says so rather than returning quietly', async () => {
  const { value, lines } = await captureWarn(() => sendCouponRedemptionAlert(
    { MAIL_FROM: 'noreply@gbti.network' }, RECORD, { sendEmail: async () => ({ id: 'x' }) },
  ));
  assert.equal(value.reason, 'unconfigured');
  assert.equal(lines.length, 1);
  assert.match(lines[0], /NOT SENT/);
  assert.match(lines[0], /CODEABLEYEAR/);
});

test('QUIET on success: a working alarm logs nothing, so a warning always means something', async () => {
  const { value, lines } = await captureWarn(() => sendCouponRedemptionAlert(
    ENV, RECORD, { sendEmail: async () => ({ id: 'x' }) },
  ));
  assert.equal(value.sent, true);
  assert.deepEqual(lines, [], 'no warning on the happy path, or the signal is worthless');
});

test('a record with no code and no github_id still logs a readable line, not "undefined"', async () => {
  const { lines } = await captureWarn(() => sendCouponRedemptionAlert(
    ENV, {}, { sendEmail: async () => { throw new Error('boom'); } },
  ));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\(unknown code\)/);
  assert.doesNotMatch(lines[0], /undefined/);
});

test('sendCouponRedemptionAlert: selfTest reaches the notice, so the weekly probe exercises the real path', async () => {
  // The probe calls THIS function rather than a copy, so the flag has to survive the trip. If it did not, the
  // weekly email would arrive looking like a genuine redemption of a code nobody redeemed.
  const sent = [];
  const env = { COUPON_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'GBTI <noreply@example.com>' };
  const record = { code: 'SELF-TEST', login: 'nobody', githubId: '0' };
  const res = await sendCouponRedemptionAlert(env, record, { sendEmail: async (m) => { sent.push(m); }, selfTest: true });
  assert.equal(res.sent, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /^\[alarm self-test\]/);
  assert.match(sent[0].text, /THIS IS NOT A REDEMPTION/);
});

test('sendCouponRedemptionAlert: without the flag the email is a real redemption notice', async () => {
  const sent = [];
  const env = { COUPON_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'GBTI <noreply@example.com>' };
  const record = { code: 'HUDSINVITE', login: 'octocat', githubId: '1' };
  await sendCouponRedemptionAlert(env, record, { sendEmail: async (m) => { sent.push(m); } });
  assert.equal(sent[0].subject, 'Coupon redeemed: HUDSINVITE by octocat');
  assert.doesNotMatch(sent[0].text, /self-test/i);
});

// --- the html body must reach the SENDER, not merely the builder (2026-08-26) -------------------------------
//
// couponRedemptionNotice now returns `html` as well as `text`. The builder and the send call live in different
// files, which is precisely how this has broken here before: a perfectly good html body gets built and then
// nobody passes it, the email leaves as plain text, and every test on the builder stays green because it is one
// layer below the defect. So these assert on the message object that reaches `send`.
//
// Mutation check: change the call in coupon-alert.mjs back to `send({ from, to, subject, text })` and the first
// two go red. A test that only checked `couponRedemptionNotice(...).html` would stay green, which is the point.

import { couponRedemptionNotice } from '../membership/coupon-notify.mjs';

test('CALL SITE: the html body reaches sendEmail, byte for byte as the builder produced it', async () => {
  const calls = [];
  await sendCouponRedemptionAlert(ENV, RECORD, { sendEmail: async (m) => { calls.push(m); return { id: 'x' }; } });
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].html, 'string', 'the send must carry an html part, not just text');
  assert.ok(calls[0].html.length > 200, 'and a real body, not an empty string');
  assert.equal(calls[0].html, couponRedemptionNotice(RECORD).html, 'the sent html must be the notice, unmodified');
  assert.match(calls[0].html, /CODEABLEYEAR/);
  assert.match(calls[0].html, /octocat/);
  assert.equal(calls[0].text, couponRedemptionNotice(RECORD).text, 'and the text fallback still goes with it');
});

test('CALL SITE: the self-test html reaches sendEmail as the self-test variant, not the redemption one', async () => {
  const sent = [];
  const record = { code: 'SELF-TEST', login: 'nobody', githubId: '0' };
  await sendCouponRedemptionAlert(ENV, record, { sendEmail: async (m) => { sent.push(m); }, selfTest: true });
  assert.equal(typeof sent[0].html, 'string');
  assert.match(sent[0].html, /THIS IS NOT A REDEMPTION/);
  assert.ok(!sent[0].html.includes('A free-year coupon was just redeemed'));
  assert.equal(sent[0].html, couponRedemptionNotice(record, { selfTest: true }).html);
});
