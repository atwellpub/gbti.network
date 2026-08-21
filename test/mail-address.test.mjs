// SOW-166: the emailEnc encrypt/decrypt helper. The two load-bearing assertions are (1) the envelope binds the
// mailHash, not the address (nothing readable in the envelope is the email), and (2) an envelope is only
// decryptable under the hash it was bound to (the confused-deputy guard), proven with a positive and a negative
// control on the SAME envelope so the null cannot come from a broken decrypt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptEmail, decryptEmail } from '../membership/mail-address.mjs';

const KEY = new Uint8Array(32).fill(7);       // deterministic 32-byte AES-256 key
const OTHER_KEY = new Uint8Array(32).fill(9); // a different valid key
const HASH_A = 'a'.repeat(64);                // valid 64-hex mailHashes
const HASH_B = 'b'.repeat(64);
const EMAIL = 'Reader@Example.com';

test('round-trip: decryptEmail recovers exactly what encryptEmail bound (trimmed)', async () => {
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: `  ${EMAIL}  ` });
  assert.ok(env && typeof env === 'object');
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_A, envelope: env }), EMAIL);
});

test('TRAP 1 - the envelope binds the HASH, and the address is nowhere readable in it', async () => {
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  assert.equal(env.aad, HASH_A, 'aad is the mailHash, not the email');
  const serialized = JSON.stringify(env);
  assert.ok(!serialized.includes(EMAIL), 'the plaintext email does not appear anywhere in the envelope');
  assert.ok(!serialized.toLowerCase().includes('example.com'), 'not even the domain leaks in cleartext');
});

test('TRAP 2 - confused deputy: the SAME envelope decrypts under its own hash and returns null under another', async () => {
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  // Positive control: correct hash -> the address. Negative control: same envelope + same key, only the expected
  // hash differs -> null. GCM would happily decrypt this internally-consistent envelope; only the aad assertion
  // rejects it. A helper missing that assertion would return the email on BOTH lines and fail this test.
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_A, envelope: env }), EMAIL);
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_B, envelope: env }), null);
});

test('fail-closed: absent key returns null on both encrypt and decrypt', async () => {
  assert.equal(await encryptEmail({ key: null, hash: HASH_A, email: EMAIL }), null);
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  assert.equal(await decryptEmail({ key: null, hash: HASH_A, envelope: env }), null);
});

test('fail-closed: a malformed hash is rejected on both encrypt and decrypt', async () => {
  assert.equal(await encryptEmail({ key: KEY, hash: 'not-hex', email: EMAIL }), null);
  assert.equal(await encryptEmail({ key: KEY, hash: 'abc', email: EMAIL }), null);
  assert.equal(await encryptEmail({ key: KEY, hash: '', email: EMAIL }), null);
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  assert.equal(await decryptEmail({ key: KEY, hash: 'not-hex', envelope: env }), null);
});

test('fail-closed: a blank email is not encryptable (never store an empty or unbound address)', async () => {
  assert.equal(await encryptEmail({ key: KEY, hash: HASH_A, email: '   ' }), null);
  assert.equal(await encryptEmail({ key: KEY, hash: HASH_A, email: null }), null);
});

test('fail-closed: the wrong key returns null, not a throw', async () => {
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  assert.equal(await decryptEmail({ key: OTHER_KEY, hash: HASH_A, envelope: env }), null);
});

test('fail-closed: a tampered ciphertext returns null (GCM auth failure is swallowed)', async () => {
  const env = await encryptEmail({ key: KEY, hash: HASH_A, email: EMAIL });
  const c = env.ct[10] === 'A' ? 'B' : 'A';
  const tampered = { ...env, ct: env.ct.slice(0, 10) + c + env.ct.slice(11) };
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_A, envelope: tampered }), null);
});

test('fail-closed: a non-object envelope returns null', async () => {
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_A, envelope: null }), null);
  assert.equal(await decryptEmail({ key: KEY, hash: HASH_A, envelope: 'nope' }), null);
});
