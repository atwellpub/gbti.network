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
