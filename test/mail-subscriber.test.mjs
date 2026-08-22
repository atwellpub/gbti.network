// SOW-166: the pure subscriber-record core. No network, no crypto, injected `now`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSubscriber, normalizeSubscriber, canReceive, resolvesFromStripe, markActive, markUnsubscribed,
  claimForMember, SubscriberError, SUBSCRIBER_STATUS, SUBSCRIBER_SOURCE,
} from '../membership/mail-subscriber.mjs';

const at = (t) => () => t;
// a base64-ish ciphertext stand-in (the AES-GCM envelope is opaque here; base64 has no '@')
const ENC = 'eyJpdiI6IkFCQyIsImN0IjoiWFla9zero';

test('buildSubscriber makes an active anon record from emailEnc', () => {
  const r = buildSubscriber({ hash: 'h1', source: 'anon', emailEnc: ENC }, { now: at(1000) });
  assert.equal(r.status, 'active');
  assert.equal(r.source, 'anon');
  assert.equal(r.emailEnc, ENC);
  assert.equal(r.githubId, null);
  assert.equal(r.customerId, null);
  assert.equal(r.createdAt, 1000);
  assert.equal(r.updatedAt, 1000);
});

test('buildSubscriber makes a member record from githubId and stores NO address', () => {
  const r = buildSubscriber({ hash: 'h2', source: 'member', githubId: '424242', customerId: 'cus_x' }, { now: at(5) });
  assert.equal(r.source, 'member');
  assert.equal(r.githubId, '424242');
  assert.equal(r.customerId, 'cus_x');
  assert.equal(r.emailEnc, null, 'a member address stays on Stripe, never in the record');
});

test('buildSubscriber enforces a resolvable-address invariant and the no-merge-at-create rule', () => {
  assert.throws(() => buildSubscriber({ source: 'anon', emailEnc: ENC }), SubscriberError); // no hash
  assert.throws(() => buildSubscriber({ hash: 'h', source: 'anon' }), SubscriberError); // anon needs emailEnc
  assert.throws(() => buildSubscriber({ hash: 'h', source: 'member' }), SubscriberError); // member needs an id
  // claim-before-create: an anon record must not carry a member identity at create time
  assert.throws(() => buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC, githubId: '1' }), SubscriberError);
  // an unknown source defaults to anon (which then requires emailEnc)
  assert.equal(buildSubscriber({ hash: 'h', source: 'weird', emailEnc: ENC }).source, 'anon');
});

test('LEAK GUARD: a subscriber record has no field that can hold a raw address', () => {
  const r = buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC, email: 'person@example.com' }, { now: at(1) });
  assert.ok(!('email' in r));
  const s = JSON.stringify(r);
  assert.ok(!s.includes('@'), 'no raw address may appear in a stored subscriber record');
  assert.ok(!s.includes('example.com'));
});

test('normalizeSubscriber coerces a stored value and drops an unusable one', () => {
  assert.equal(normalizeSubscriber(null), null);
  assert.equal(normalizeSubscriber({ source: 'anon', emailEnc: ENC }), null); // no hash
  assert.equal(normalizeSubscriber({ hash: 'h', source: 'anon' }), null); // anon with no ciphertext
  assert.equal(normalizeSubscriber({ hash: 'h', source: 'member' }), null); // member with no id
  const n = normalizeSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC, status: 'weird', createdAt: '7' });
  assert.equal(n.status, 'active'); // bad status -> active
  assert.equal(n.createdAt, 7);
  assert.equal(n.updatedAt, 7); // falls back to createdAt
  // a member record's ciphertext (if some caller wrote one) is dropped on normalize
  const m = normalizeSubscriber({ hash: 'h', source: 'member', githubId: '9', emailEnc: ENC });
  assert.equal(m.emailEnc, null);
});

test('canReceive is true only for an active record', () => {
  const r = buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC }, { now: at(0) });
  assert.equal(canReceive(r), true);
  assert.equal(canReceive(markUnsubscribed(r, { now: at(1) })), false);
  assert.equal(canReceive(null), false);
});

test('resolvesFromStripe distinguishes a member (Stripe) from an anon (decrypt emailEnc)', () => {
  const anon = buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC }, { now: at(0) });
  const member = buildSubscriber({ hash: 'h2', source: 'member', githubId: '5' }, { now: at(0) });
  assert.equal(resolvesFromStripe(anon), false);
  assert.equal(resolvesFromStripe(member), true);
});

test('markActive / markUnsubscribed flip status and stamp updatedAt', () => {
  const r = buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC }, { now: at(0) });
  const off = markUnsubscribed(r, { now: at(10) });
  assert.equal(off.status, 'unsubscribed');
  assert.equal(off.updatedAt, 10);
  const on = markActive(off, { now: at(20) });
  assert.equal(on.status, 'active');
  assert.equal(on.updatedAt, 20);
  assert.ok(SUBSCRIBER_STATUS.has('active') && SUBSCRIBER_STATUS.has('unsubscribed'));
  assert.ok(SUBSCRIBER_SOURCE.has('anon') && SUBSCRIBER_SOURCE.has('member'));
});

test('claimForMember converts anon -> member, drops the ciphertext, writes githubId', () => {
  const anon = buildSubscriber({ hash: 'h', source: 'anon', emailEnc: ENC }, { now: at(0) });
  const claimed = claimForMember(anon, { githubId: '77', customerId: 'cus_z', now: at(50) });
  assert.equal(claimed.source, 'member');
  assert.equal(claimed.githubId, '77');
  assert.equal(claimed.customerId, 'cus_z');
  assert.equal(claimed.emailEnc, null, 'once claimed, the address resolves from Stripe, not the record');
  assert.equal(claimed.updatedAt, 50);
  // never re-claims a non-anon record, and a blank githubId is a no-op
  assert.equal(claimForMember(claimed, { githubId: '99' }).githubId, '77');
  assert.equal(claimForMember(anon, { githubId: '' }), anon);
  assert.equal(claimForMember(null, { githubId: '1' }), null);
});

test('a member record REQUIRES githubId, because erasure finds member records by scanning for it', () => {
  // Erasure cannot resolve an address through Stripe when the Customer is gone or has no email, so it scans
  // mail:subscriber:* and matches githubId. A member record carrying only customerId would send mail
  // perfectly well and be invisible to that scan, so the deletion request would silently not delete.
  assert.throws(
    () => buildSubscriber({ hash: 'h', source: 'member', customerId: 'cus_123' }),
    /requires githubId/,
    'customerId alone is no longer enough',
  );

  // The positive half, so this test cannot pass by rejecting everything.
  const ok = buildSubscriber({ hash: 'h', source: 'member', githubId: '42' }, { now: () => 0 });
  assert.equal(ok.githubId, '42');
  assert.equal(ok.emailEnc, null, 'and a member record still never stores the address');

  // customerId stays a legitimate OPTIONAL extra alongside githubId.
  const both = buildSubscriber({ hash: 'h', source: 'member', githubId: '42', customerId: 'cus_123' }, { now: () => 0 });
  assert.equal(both.customerId, 'cus_123');
  assert.equal(both.githubId, '42');
});

test('the reader stays permissive where the writer is strict, on purpose', () => {
  // A stored customerId-only member record must remain READABLE. A normalizer that rejected it would make
  // it invisible to every reader while it went on existing in KV, which hides the problem instead of
  // preventing it. Prevention is the writer's job and the test above proves the writer does it.
  const stray = normalizeSubscriber({ hash: 'h', source: 'member', customerId: 'cus_123', createdAt: 1, updatedAt: 1 });
  assert.ok(stray, 'still readable, so it can still be found and removed');
  assert.equal(stray.customerId, 'cus_123');
});
