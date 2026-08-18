// SOW-166: the one-way email identity + unsubscribe suppression. Uses crypto.subtle (global in Node 18+), no
// network, no stored secret. Modeled on the coupon-lock guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mailHash, normalizeEmail, suppressKey, subscriberKey, SUPPRESS_VALUE,
  MAIL_SUPPRESS_PREFIX, MAIL_SUBSCRIBER_PREFIX,
} from '../membership/mail-suppress.mjs';

const SECRET = 'test-mail-suppress-key-0123456789';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Foo@Example.COM '), 'foo@example.com');
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
});

test('mailHash is deterministic, case-insensitive, and a bare hex digest (no address)', async () => {
  const h1 = await mailHash(SECRET, 'person@example.com');
  const h2 = await mailHash(SECRET, '  Person@Example.com '); // same address, different case/space
  assert.equal(h1, h2, 'the hash is stable across case and surrounding whitespace');
  assert.match(h1, /^[0-9a-f]{64}$/, 'a SHA-256 HMAC is 64 hex chars');
  assert.ok(!h1.includes('@'), 'the hash never contains the address');
  assert.ok(!h1.includes('example.com'));
  // different addresses hash differently
  assert.notEqual(h1, await mailHash(SECRET, 'other@example.com'));
});

test('mailHash is KEYED: a different secret yields a different identity', async () => {
  const a = await mailHash(SECRET, 'person@example.com');
  const b = await mailHash('a-completely-different-secret-value', 'person@example.com');
  assert.notEqual(a, b, 'the address identity depends on the key, so an unkeyed guess cannot reproduce it');
});

test('mailHash FAILS CLOSED to null when the secret or the email is absent', async () => {
  assert.equal(await mailHash('', 'person@example.com'), null);
  assert.equal(await mailHash('   ', 'person@example.com'), null);
  assert.equal(await mailHash(null, 'person@example.com'), null);
  assert.equal(await mailHash(SECRET, ''), null);
  assert.equal(await mailHash(SECRET, '   '), null);
  assert.equal(await mailHash(SECRET, null), null);
});

test('suppressKey + subscriberKey build prefixed keys from the bare hash and reject a blank hash', () => {
  assert.equal(suppressKey('deadbeef'), `${MAIL_SUPPRESS_PREFIX}deadbeef`);
  assert.equal(subscriberKey('deadbeef'), `${MAIL_SUBSCRIBER_PREFIX}deadbeef`);
  assert.equal(suppressKey(''), null);
  assert.equal(subscriberKey('  '), null);
  // the two derived keys share the same hash, so a subscriber can be suppressed by the same identity
  const h = 'abc123';
  assert.equal(suppressKey(h), 'mail:suppress:abc123');
  assert.equal(subscriberKey(h), 'mail:subscriber:abc123');
});

test('SUPPRESS_VALUE is a bare marker carrying no address, id, or timestamp', () => {
  const parsed = JSON.parse(SUPPRESS_VALUE);
  assert.deepEqual(parsed, { suppressed: true });
  assert.ok(!SUPPRESS_VALUE.includes('@'));
});
