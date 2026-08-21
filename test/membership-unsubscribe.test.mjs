// SOW-166: the one-click unsubscribe route. Real crypto (crypto.subtle is global), real verifier, fake KV.
// Proves the RFC 8058 split (GET never mutates, POST performs), fail-closed on a bad/absent token, the
// suppress-then-erase order, the writeSuppress-failure fail-closed, and the retired-key rotation fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleUnsubscribe, parseRetiredKeys, defaultWriteSuppress } from '../workers/signup/membership-unsubscribe.mjs';
import { mailHash, suppressKey, subscriberKey } from '../membership/mail-suppress.mjs';
import { makeUnsubToken } from '../membership/mail-unsub-token.mjs';
import { enqueueIssue, getSubscriber, getSend, readPendingIndex } from '../workers/signup/mail-store.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';

const at = (t) => () => t;
const issueOf = (id) => ({ issueId: id, sections: { article: [], product: [], prompt: [], share: [] }, topNews: [], counts: {}, isEmpty: false, generatedAt: 0 });

function makeKV({ throwOn = () => false } = {}) {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      if (throwOn(key)) throw new Error('kv get failed');
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
      return e.value;
    },
    async put(key, value, opts) { m.set(key, { value: String(value), opts: opts || null }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

const SUPPRESS_SECRET = 'test-suppress-key';
const UNSUB_SECRET = 'test-unsub-key';
const EMAIL = 'member@example.com';

// A real 64-hex mailHash identity + a real capability token for it.
async function identity({ suppressSecret = SUPPRESS_SECRET, unsubSecret = UNSUB_SECRET, email = EMAIL } = {}) {
  const hash = await mailHash(suppressSecret, email);
  const token = await makeUnsubToken(unsubSecret, hash);
  return { hash, token };
}

const urlFor = (hash, token) => `https://signup.gbti.network/mail/unsubscribe?h=${hash}&t=${encodeURIComponent(token ?? '')}`;
const req = (method, hash, token) => new Request(urlFor(hash, token), { method });

test('parseRetiredKeys splits on commas/space/newlines, drops empties', () => {
  assert.deepEqual(parseRetiredKeys('a, b\nc  d,,'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(parseRetiredKeys(''), []);
  assert.deepEqual(parseRetiredKeys(null), []);
});

test('GET with a valid token renders a confirmation page that POSTs, and MUTATES NOTHING', async () => {
  const kv = makeKV();
  const { hash, token } = await identity();
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('GET', hash, token), env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.text();
  assert.match(body, /method="POST"/i, 'the page posts back');
  assert.match(body, /Unsubscribe me/i, 'the confirm button is present');
  // GET never writes a suppression marker (a mail-client prefetch must not opt anyone out)
  assert.equal(kv.m.get(suppressKey(hash)), undefined, 'GET wrote no suppression marker');
});

test('GET with an invalid token renders an invalid-link page (200), no mutation', async () => {
  const kv = makeKV();
  const { hash } = await identity();
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('GET', hash, 'not-a-real-token'), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /invalid or has expired/i);
  assert.equal(kv.m.get(suppressKey(hash)), undefined);
});

test('POST with a valid token PERFORMS: writes the marker, erases the record, returns unsubscribed', async () => {
  const kv = makeKV();
  const { hash, token } = await identity();
  // seed a full subscriber + a queued send in an issue with another recipient
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  await enqueueIssue(kv, issueOf('i1'), [hash, 'other'], { now: at(0) });
  assert.ok(await getSubscriber(kv, hash));
  assert.ok(await getSend(kv, 'i1', hash));

  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('POST', hash, token), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /unsubscribed/i);
  // the marker is written, the record + send state are erased, another recipient is untouched
  assert.ok(kv.m.get(suppressKey(hash)), 'the suppression marker is written');
  assert.equal(await getSubscriber(kv, hash), null, 'the subscriber record is erased');
  assert.equal(await getSend(kv, 'i1', hash), null, 'the send record is erased');
  assert.deepEqual(await readPendingIndex(kv, 'i1'), ['other'], 'the hash left the pending index; the other recipient stays');
});

test('POST with an INVALID token suppresses NOTHING and returns 400', async () => {
  const kv = makeKV();
  const { hash } = await identity();
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('POST', hash, 'forged-token'), env);
  assert.equal(res.status, 400);
  assert.equal(kv.m.get(suppressKey(hash)), undefined, 'a forged token wrote no marker');
  assert.ok(await getSubscriber(kv, hash), 'a forged token erased nothing');
});

test('POST with NO unsubscribe secret configured is fail-closed (400, nothing suppressed)', async () => {
  const kv = makeKV();
  const { hash, token } = await identity();
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  const env = { SIGNUP_KV: kv /* MAIL_UNSUB_KEY unset */ };
  const res = await handleUnsubscribe(req('POST', hash, token), env);
  assert.equal(res.status, 400, 'no secret => verifyUnsubRequest fails closed => 400');
  assert.equal(kv.m.get(suppressKey(hash)), undefined);
  assert.ok(await getSubscriber(kv, hash));
});

test('POST with a MALFORMED hash (not 64-hex) is rejected, nothing suppressed', async () => {
  const kv = makeKV();
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('POST', 'short-hash', 'whatever'), env);
  assert.equal(res.status, 400);
  assert.equal(kv.m.size, 0, 'a malformed hash never reached a key builder');
});

test('RETIRED-KEY FALLBACK: a token minted under an old key still verifies while the old key is in MAIL_UNSUB_KEYS', async () => {
  const kv = makeKV();
  const { hash, token } = await identity({ unsubSecret: 'old-unsub-key' }); // minted under the OLD key
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: 'new-unsub-key', MAIL_UNSUB_KEYS: 'old-unsub-key' };
  const res = await handleUnsubscribe(req('POST', hash, token), env);
  assert.equal(res.status, 200, 'a token under the retired key still unsubscribes during the grace window');
  assert.ok(kv.m.get(suppressKey(hash)));
  // and once the old key leaves MAIL_UNSUB_KEYS, the same token no longer verifies
  const kv2 = makeKV();
  await kv2.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  const res2 = await handleUnsubscribe(req('POST', hash, token), { SIGNUP_KV: kv2, MAIL_UNSUB_KEY: 'new-unsub-key' });
  assert.equal(res2.status, 400, 'after the grace window closes the retired token is rejected');
});

test('WRITESUPPRESS FAILURE is fail-closed: 503, and it does NOT erase (never delete without recording the opt-out)', async () => {
  const kv = makeKV();
  const { hash, token } = await identity();
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'anon', emailEnc: 'ENC' }, { now: at(0) })));
  let erased = 0;
  const env = { SIGNUP_KV: kv, MAIL_UNSUB_KEY: UNSUB_SECRET };
  const res = await handleUnsubscribe(req('POST', hash, token), env, {
    writeSuppress: async () => false,           // the marker did not persist
    eraseMail: async () => { erased++; return { subscriber: 1 }; },
  });
  assert.equal(res.status, 503);
  assert.equal(erased, 0, 'erasure must NOT run when the opt-out marker did not persist');
  assert.ok(await getSubscriber(kv, hash), 'the record survives a failed suppress (retryable)');
});

test('OPTIONS is a 204 preflight; an unsupported method is 405', async () => {
  const env = { SIGNUP_KV: makeKV(), MAIL_UNSUB_KEY: UNSUB_SECRET };
  const { hash, token } = await identity();
  assert.equal((await handleUnsubscribe(req('OPTIONS', hash, token), env)).status, 204);
  assert.equal((await handleUnsubscribe(req('DELETE', hash, token), env)).status, 405);
});

test('defaultWriteSuppress: refuses a missing kv or blank hash, persists otherwise', async () => {
  const kv = makeKV();
  assert.equal(await defaultWriteSuppress(null, 'h'), false);
  assert.equal(await defaultWriteSuppress(kv, ''), false, 'a blank hash never reaches a key builder');
  assert.equal(await defaultWriteSuppress(kv, 'abc'), true);
  assert.ok(kv.m.get(suppressKey('abc')));
});
