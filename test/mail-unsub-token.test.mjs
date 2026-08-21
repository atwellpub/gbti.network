// SOW-166: the one-click unsubscribe capability token. The route is unauthenticated by necessity, so this
// token IS the authorization and these tests are the only thing standing between a link in an email and
// somebody unsubscribing a stranger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeUnsubToken, verifyUnsubToken, verifyUnsubRequest, timingSafeEqual } from '../membership/mail-unsub-token.mjs';
import { mailHash } from '../membership/mail-suppress.mjs';

const SECRET = 'unsub-key-under-test';
const OTHER = 'a-different-key';
const HASH = 'a'.repeat(64);
const HASH2 = 'b'.repeat(64);

test('sow-166: a token is deterministic, and bound to BOTH the hash and the key', async () => {
  const t = await makeUnsubToken(SECRET, HASH);
  assert.equal(t, await makeUnsubToken(SECRET, HASH), 'same inputs, same token: the link must survive a re-send');
  assert.notEqual(t, await makeUnsubToken(SECRET, HASH2), 'a different subscriber gets a different token');
  assert.notEqual(t, await makeUnsubToken(OTHER, HASH), 'a different key gets a different token');
  assert.match(t, /^[A-Za-z0-9_-]{43}$/, 'unpadded base64url, so a query string cannot mangle it');
});

test('sow-166: NOT FORGEABLE. A token minted under another key is rejected', async () => {
  const forged = await makeUnsubToken(OTHER, HASH);
  assert.equal(await verifyUnsubToken(SECRET, HASH, forged), false);
});

test('sow-166: NOT TRANSFERABLE. One subscriber cannot unsubscribe another with their own valid token', async () => {
  // The attack this closes: a real subscriber holds a real token, swaps the hash in the URL, and opts someone
  // else out. The token is an HMAC OVER the hash, so it does not travel.
  const mine = await makeUnsubToken(SECRET, HASH);
  assert.equal(await verifyUnsubToken(SECRET, HASH, mine), true, 'valid for its own hash');
  assert.equal(await verifyUnsubToken(SECRET, HASH2, mine), false, 'and useless against any other');
});

test('sow-166: FAIL CLOSED. No configured secret admits nobody, rather than admitting everybody', async () => {
  // The dangerous reading is that a missing secret makes the comparison trivially pass. It must deny.
  for (const missing of [undefined, null, '', '   ']) {
    assert.equal(await makeUnsubToken(missing, HASH), null, 'no secret mints no token');
    assert.equal(await verifyUnsubToken(missing, HASH, 'anything'), false, 'and verifies nothing');
    assert.equal(await verifyUnsubToken(missing, HASH, ''), false);
  }
  // A blank hash is the same story from the other side.
  assert.equal(await makeUnsubToken(SECRET, ''), null);
  assert.equal(await verifyUnsubToken(SECRET, '', 'anything'), false);
});

test('sow-166: an empty or missing token never verifies, even with a good key and hash', async () => {
  for (const t of [undefined, null, '', '   ']) {
    assert.equal(await verifyUnsubToken(SECRET, HASH, t), false, `${JSON.stringify(t)} must not verify`);
  }
});

test('sow-166: the route verifier rejects a malformed identifier before it can reach a KV key builder', async () => {
  const good = await makeUnsubToken(SECRET, HASH);
  for (const bad of ['', '   ', 'not-a-hash', 'A'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), '../../etc', `${HASH}x`, null, undefined]) {
    const r = await verifyUnsubRequest({ hash: bad, token: good, secret: SECRET });
    assert.equal(r.ok, false, `${JSON.stringify(bad)} must be refused`);
    assert.equal(r.hash, null, 'and must hand back no hash for a key builder to use');
  }
});

test('sow-166: the route verifier returns the hash on success, so the route needs no second parse', async () => {
  const r = await verifyUnsubRequest({ hash: HASH, token: await makeUnsubToken(SECRET, HASH), secret: SECRET });
  assert.deepEqual(r, { ok: true, hash: HASH });
});

test('sow-166: ROTATION. A token minted under a retired key still works during the grace window', async () => {
  // The property an expiry field would have destroyed: links in already-delivered issues keep working across
  // a key rotation. Without this, rotating MAIL_UNSUB_KEY silently breaks every outstanding opt-out.
  const old = await makeUnsubToken(OTHER, HASH);
  assert.equal((await verifyUnsubRequest({ hash: HASH, token: old, secret: SECRET })).ok, false, 'not accepted without the retired key');
  assert.equal((await verifyUnsubRequest({ hash: HASH, token: old, secret: SECRET, retired: [OTHER] })).ok, true, 'accepted while it is still listed');
  // And retiring it does not weaken the current key: garbage is still garbage.
  assert.equal((await verifyUnsubRequest({ hash: HASH, token: 'x'.repeat(43), secret: SECRET, retired: [OTHER] })).ok, false);
});

test('sow-166: a non-array retired list cannot crash the route or widen it', async () => {
  const good = await makeUnsubToken(SECRET, HASH);
  for (const junk of [null, 'a-string', 42, {}]) {
    assert.equal((await verifyUnsubRequest({ hash: HASH, token: good, secret: SECRET, retired: junk })).ok, true, 'current key still works');
    assert.equal((await verifyUnsubRequest({ hash: HASH, token: 'x'.repeat(43), secret: SECRET, retired: junk })).ok, false, 'and junk still fails');
  }
});

test('sow-166: timingSafeEqual is correct, and is not the identity function', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false, 'differs in the LAST byte');
  assert.equal(timingSafeEqual('abc', 'zbc'), false, 'differs in the FIRST byte');
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.equal(timingSafeEqual(null, undefined), true, 'both coerce to empty; callers reject blanks before this');
});

test('sow-166: end to end from a real address, and the ADDRESS NEVER APPEARS in the link', async () => {
  const address = 'Someone@Example.COM';
  const h = await mailHash('suppress-key-under-test', address);
  const token = await makeUnsubToken(SECRET, h);
  const link = `https://signup.gbti.network/mail/unsubscribe?h=${h}&t=${token}`;

  assert.equal((await verifyUnsubRequest({ hash: h, token, secret: SECRET })).ok, true);
  // The whole point of keying the identity: the URL is safe to sit in logs, Referer headers and mail archives.
  assert.equal(link.toLowerCase().includes('someone'), false, 'no local part in the URL');
  assert.equal(link.toLowerCase().includes('example.com'), false, 'no domain in the URL');
  // Case-insensitivity comes from mailHash, so the same person clicking from a differently-cased send matches.
  assert.equal(await mailHash('suppress-key-under-test', 'someone@example.com'), h);
});

test('sow-166: surrounding whitespace is NORMALIZED, and the hash handed back is the clean one', async () => {
  // Mail clients wrap and pad URLs, so a padded identifier has to keep working. The safety property is not
  // that padding is refused, it is that the token must still match the NORMALIZED hash and that no raw
  // whitespace can ride through into a KV key builder. Uppercase is still refused: mailHash emits lowercase
  // hex, so an uppercase digest did not come from us.
  const token = await makeUnsubToken(SECRET, HASH);
  for (const padded of [`${HASH}\n`, ` ${HASH}`, `${HASH}  `, `\t${HASH}\r\n`]) {
    const r = await verifyUnsubRequest({ hash: padded, token, secret: SECRET });
    assert.equal(r.ok, true, 'padding must not break a real opt-out link');
    assert.equal(r.hash, HASH, 'and the returned hash is clean, so suppressKey never sees whitespace');
  }
  // Padding buys an attacker nothing: the token still has to match.
  assert.equal((await verifyUnsubRequest({ hash: `${HASH}\n`, token: 'x'.repeat(43), secret: SECRET })).ok, false);
});

// MUTATION 4, WHICH SURVIVED THE FIRST PASS. Deleting the identifier validation left every test green,
// because a malformed hash also fails the TOKEN check and the outcome is ok:false either way. That made the
// validation look like belt-and-braces. It is not, and the case that proves it is one WE can cause rather than
// one an attacker can: makeUnsubToken will happily sign whatever string it is handed, so a mint-side caller
// that passes an EMAIL where a hash belongs produces a perfectly valid token over a raw address. Without this
// check the verifier accepts it, hands the address back as `hash`, and it goes straight into a KV key builder
// and the logs, which is the exact leak the keyed identity exists to prevent.
test('sow-166: a well-signed token over a MALFORMED identifier is still refused', async () => {
  for (const wrong of ['someone@example.com', 'not-a-hash', 'A'.repeat(64), 'a'.repeat(63)]) {
    const validTokenForTheWrongThing = await makeUnsubToken(SECRET, wrong);
    assert.equal(await verifyUnsubToken(SECRET, wrong, validTokenForTheWrongThing), true, 'the HMAC itself matches');
    const r = await verifyUnsubRequest({ hash: wrong, token: validTokenForTheWrongThing, secret: SECRET });
    assert.equal(r.ok, false, `a signed token over ${JSON.stringify(wrong)} must STILL be refused by the route`);
    assert.equal(r.hash, null, 'and nothing malformed is handed back for a key builder or a log line');
  }
});

// MUTATION 5, WHICH SURVIVES ON PURPOSE AND IS RECORDED RATHER THAN HIDDEN. Replacing the accumulating
// compare in timingSafeEqual with `A === B` leaves every test in this file green, because the two are
// FUNCTIONALLY IDENTICAL and differ only in how long they take to say no. No assertion over return values can
// separate them, a statistical timing assertion is too flaky to gate CI on, and asserting on the source text
// would be testing the prose rather than the behaviour.
//
// So this property is held by review, not by this suite, and the next person should know that rather than
// read the green tick as coverage. It matters: the comparison is against an attacker-supplied 43-character
// token on an unauthenticated public route, which is precisely where a byte-at-a-time timing oracle turns
// forgery from infeasible into a few thousand requests. If you are editing timingSafeEqual, the tests will
// not stop you.
