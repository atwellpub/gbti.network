// The new-subscriber admin notice: the pure composer + the fail-soft sender. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSubscriberNotice } from '../membership/subscriber-notify.mjs';
import { sendNewSubscriberAlert } from '../workers/signup/subscriber-alert.mjs';

// ---------- pure composer ----------

test('newSubscriberNotice carries the address in the subject and body', () => {
  const { subject, text } = newSubscriberNotice({ email: 'reader@example.com', source: 'anon', at: '2026-08-26T12:00:00.000Z' });
  assert.ok(subject.includes('reader@example.com'));
  assert.ok(text.includes('reader@example.com'));
  assert.ok(text.includes('public digest form'));
  assert.ok(text.includes('2026-08-26T12:00:00.000Z'));
});

test('newSubscriberNotice degrades gracefully with no address', () => {
  const { subject, text } = newSubscriberNotice({ email: '', source: 'anon' });
  assert.equal(subject, 'New digest subscriber');
  assert.ok(text.includes('(address unavailable)'));
});

test('newSubscriberNotice labels a member-source enrollment', () => {
  const { text } = newSubscriberNotice({ email: 'm@e.co', source: 'member' });
  assert.ok(text.includes('member (signed-in enrollment)'));
});

// ---------- fail-soft sender ----------

function sink() {
  const sent = [];
  return { sent, send: async (m) => { sent.push(m); return { id: 'x' }; } };
}

test('sendNewSubscriberAlert is a no-op when unprovisioned (no recipient)', async () => {
  const { sent, send } = sink();
  const res = await sendNewSubscriberAlert({ MAIL_FROM: 'from@gbti.network' }, { email: 'a@b.co' }, { sendEmail: send });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'unconfigured');
  assert.equal(sent.length, 0);
});

test('sendNewSubscriberAlert sends to ADMIN_ALERT_EMAIL when set', async () => {
  const { sent, send } = sink();
  const env = { ADMIN_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'from@gbti.network' };
  const res = await sendNewSubscriberAlert(env, { email: 'a@b.co', source: 'anon' }, { sendEmail: send });
  assert.equal(res.sent, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'owner@example.com');
  assert.equal(sent[0].from, 'from@gbti.network');
});

test('sendNewSubscriberAlert falls back to COUPON_ALERT_EMAIL when ADMIN_ALERT_EMAIL is unset', async () => {
  const { sent, send } = sink();
  const env = { COUPON_ALERT_EMAIL: 'coupon@gbti.network', RESEND_FROM: 'from@gbti.network' };
  const res = await sendNewSubscriberAlert(env, { email: 'a@b.co' }, { sendEmail: send });
  assert.equal(res.sent, true);
  assert.equal(sent[0].to, 'coupon@gbti.network');
});

test('sendNewSubscriberAlert never throws when the sender fails', async () => {
  const env = { ADMIN_ALERT_EMAIL: 'owner@example.com', MAIL_FROM: 'from@gbti.network' };
  const res = await sendNewSubscriberAlert(env, { email: 'a@b.co' }, { sendEmail: async () => { throw new Error('resend down'); } });
  assert.equal(res.sent, false);
  assert.equal(res.reason, 'error');
});
