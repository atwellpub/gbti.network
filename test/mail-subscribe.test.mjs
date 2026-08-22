// SOW-166: the anonymous double-opt-in subscribe + confirm routes. Fake KV, injected mail sender, no network.
//
// The load-bearing test is the END-TO-END SEAM: a real subscribe (real mailHash + real encryptEmail) writes a
// pending opt-in and hands back a confirm link; the confirm POST promotes it into a real subscriber; and the
// drain's own resolver (resolveSubscriberEmail) then recovers the ORIGINAL address from the stored record. That
// proves the emailEnc survives the subscribe -> pending -> confirm -> subscriber -> drain chain intact, which no
// single-function test can, and it is mutation-checked (a confirm that stored a wrong emailEnc reds it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSubscribe, handleConfirm } from '../workers/signup/mail-subscribe.mjs';
import {
  isValidEmailShape, buildPendingOptIn, normalizePendingOptIn, optinKey, OptInError, MAIL_OPTIN_PREFIX,
} from '../membership/mail-optin.mjs';
import { mailHash, suppressKey, subscriberKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { resolveSubscriberEmail } from '../membership/mail-address.mjs';

const SUPPRESS_KEY = 'test-suppress-signing-key';
// MAIL_EMAIL_KEY is provisioned as a STRING secret (a base64 32-byte AES-256 key), so the test uses that exact
// form, not a raw Uint8Array: the handler reads it as a string, and crypto-assets accepts a base64 key string.
const EMAIL_KEY = Buffer.from(new Uint8Array(32).fill(7)).toString('base64');

// Env with the crypto keys + a from-address configured; the send is always injected so no network is touched.
const ENV = {
  MAIL_SUPPRESS_KEY: SUPPRESS_KEY,
  MAIL_EMAIL_KEY: EMAIL_KEY,
  MAIL_FROM: 'digest@gbti.network',
  PUBLIC_BASE_URL: 'https://signup.gbti.network',
  // no TURNSTILE_SECRET_KEY (challenge skipped), no RESEND_API_KEY (the injected sender stands in)
};

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
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

// A recording sender + a rate-limiter that always allows, so each test isolates the branch it exercises.
function sink() {
  const sent = [];
  return { sent, send: async (m) => { sent.push(m); return { id: 'x' }; } };
}
const allow = async () => ({ allowed: true });

const jsonReq = (body) => new Request('https://signup.gbti.network/mail/subscribe', {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json' },
  body: JSON.stringify(body),
});

// ---------- pure core ----------

test('isValidEmailShape accepts ordinary addresses and rejects garbage', () => {
  for (const ok of ['a@b.co', 'Reader@Example.com', 'a.b+c@sub.domain.io', '  a@b.co  ']) {
    assert.equal(isValidEmailShape(ok), true, ok); // leading/trailing whitespace is trimmed, not rejected
  }
  for (const bad of ['', 'no-at', '@nodomain.com', 'nolocal@', 'a@b', 'a@.com', 'a@b..com', 'a b@c.com', 'x'.repeat(255) + '@b.com', 'twö@b.com']) {
    assert.equal(isValidEmailShape(bad), false, bad); // internal whitespace, non-ASCII, no domain dot, over-length
  }
});

test('buildPendingOptIn requires every field; normalize round-trips and rejects junk', () => {
  const rec = buildPendingOptIn({ hash: 'a'.repeat(64), emailEnc: '{"ct":"x"}', nonce: 'n' }, { now: () => 5 });
  assert.deepEqual(rec, { hash: 'a'.repeat(64), emailEnc: '{"ct":"x"}', nonce: 'n', createdAt: 5 });
  assert.deepEqual(normalizePendingOptIn(rec), rec);
  for (const bad of [{ emailEnc: 'e', nonce: 'n' }, { hash: 'h', nonce: 'n' }, { hash: 'h', emailEnc: 'e' }]) {
    assert.throws(() => buildPendingOptIn(bad), OptInError);
  }
  for (const bad of [null, {}, { hash: 'h' }, { hash: 'h', emailEnc: 'e' }]) {
    assert.equal(normalizePendingOptIn(bad), null);
  }
});

// ---------- subscribe ----------

test('subscribe: a new address writes a pending opt-in under mail:optin:, sends a confirm link, enrolls nobody', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const res = await handleSubscribe(jsonReq({ email: 'Reader@Example.com' }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: allow });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });

  const hash = await mailHash(SUPPRESS_KEY, 'Reader@Example.com');
  // a pending opt-in exists with a TTL; NO active subscriber yet
  assert.ok(kv.m.get(optinKey(hash)), 'pending opt-in written');
  assert.ok(kv.m.get(optinKey(hash)).opts.expirationTtl > 0, 'pending opt-in self-prunes');
  assert.equal(kv.m.get(subscriberKey(hash)), undefined, 'no subscriber is created at subscribe time');

  // the confirmation email carries a confirm link bound to THIS hash and the stored nonce
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'Reader@Example.com');
  const pending = JSON.parse(kv.m.get(optinKey(hash)).value);
  const wanted = `https://signup.gbti.network/mail/confirm?h=${hash}&t=${encodeURIComponent(pending.nonce)}`;
  assert.ok(sent[0].text.includes(wanted), 'the plain-text email carries the confirm link (raw &)');
  // the html email escapes & to &amp; in the href, which is correct HTML and still resolves in a browser
  assert.ok(sent[0].html.includes(wanted.replace(/&/g, '&amp;')), 'the html email carries the (escaped) confirm link');
  // the raw address never lands in KV
  assert.ok(!kv.m.get(optinKey(hash)).value.includes('Reader@Example.com'), 'no raw address in the pending record');
});

test('subscribe: a FAILED confirmation send stays NEUTRAL (anti-enumeration) but is LOGGED, not swallowed', async () => {
  // SecurityMaster, 2026-08-22: discarding sendConfirmationEmail's return meant a mail-provisioning gap failed
  // EVERY subscriber silently. The response must stay byte-identical (neutral is the anti-enumeration answer);
  // the boolean must be captured so the failure is visible, not discovered by a subscriber who never gets a link.
  const kv = makeKV();
  const throwingSend = async () => { throw new Error('resend down'); };
  const warnings = [];
  const origWarn = console.warn;
  console.warn = (...a) => { warnings.push(a.map(String).join(' ')); };
  let res;
  try {
    res = await handleSubscribe(jsonReq({ email: 'reader@example.com' }), { ...ENV, SIGNUP_KV: kv }, { send: throwingSend, rateLimitFn: allow });
  } finally {
    console.warn = origWarn;
  }
  assert.equal(res.status, 200, 'the response is byte-identical to the happy path: a failed provider is not an enumeration oracle');
  assert.deepEqual(await res.json(), { ok: true });
  const hash = await mailHash(SUPPRESS_KEY, 'reader@example.com');
  assert.ok(kv.m.get(optinKey(hash)), 'the pending opt-in is still written (the send failure is downstream of the write)');
  assert.ok(warnings.some((w) => /confirmation send did not complete/.test(w)), 'the failed confirmation send is LOGGED, not swallowed');
});

test('subscribe: a malformed email is a 400 with no opt-in and no send', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const res = await handleSubscribe(jsonReq({ email: 'not-an-email' }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: allow });
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_email');
  assert.equal(sent.length, 0);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith(MAIL_OPTIN_PREFIX)).length, 0);
});

test('subscribe: a SUPPRESSED address is not re-contacted (no send) and returns the SAME neutral response', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const hash = await mailHash(SUPPRESS_KEY, 'gone@example.com');
  await kv.put(suppressKey(hash), SUPPRESS_VALUE);
  const res = await handleSubscribe(jsonReq({ email: 'gone@example.com' }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: allow });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true }, 'identical to a new subscribe: no enumeration signal');
  assert.equal(sent.length, 0, 'a prior opt-out is honored: no confirmation email');
  assert.equal(kv.m.get(optinKey(hash)), undefined, 'no pending opt-in for a suppressed address');
});

test('subscribe: an already-ACTIVE subscriber gets no second confirmation (idempotent, neutral)', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const hash = await mailHash(SUPPRESS_KEY, 'member@example.com');
  await kv.put(subscriberKey(hash), JSON.stringify({ hash, source: 'anon', status: 'active', emailEnc: '{"ct":"x"}', createdAt: 1, updatedAt: 1 }));
  const res = await handleSubscribe(jsonReq({ email: 'member@example.com' }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: allow });
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
  assert.equal(kv.m.get(optinKey(hash)), undefined);
});

test('subscribe: rate-limited is a 429 before any work', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const res = await handleSubscribe(jsonReq({ email: 'a@b.co' }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: async () => ({ allowed: false }) });
  assert.equal(res.status, 429);
  assert.equal(sent.length, 0);
});

test('subscribe: Turnstile is required when a secret is set; a bad token is a 403', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const env = { ...ENV, SIGNUP_KV: kv, TURNSTILE_SECRET_KEY: 'ts-secret' };
  const res = await handleSubscribe(jsonReq({ email: 'a@b.co', turnstileToken: 'bad' }), env, { send, rateLimitFn: allow, verifyTurnstileFn: async () => false });
  assert.equal(res.status, 403);
  assert.equal(sent.length, 0);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith(MAIL_OPTIN_PREFIX)).length, 0);
});

test('subscribe: unprovisioned (no MAIL_SUPPRESS_KEY) is inert - neutral response, no opt-in, no send', async () => {
  const kv = makeKV();
  const { sent, send } = sink();
  const env = { ...ENV, SIGNUP_KV: kv, MAIL_SUPPRESS_KEY: '' };
  const res = await handleSubscribe(jsonReq({ email: 'a@b.co' }), env, { send, rateLimitFn: allow });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 0);
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith(MAIL_OPTIN_PREFIX)).length, 0);
});

// ---------- confirm ----------

// Subscribe once and return the confirm URL the email carried, so confirm tests drive the real link.
async function subscribeAndGetConfirmUrl(kv, email) {
  const { sent, send } = sink();
  await handleSubscribe(jsonReq({ email }), { ...ENV, SIGNUP_KV: kv }, { send, rateLimitFn: allow });
  const line = sent[0].text.split('\n').find((l) => l.startsWith('https://'));
  return line.trim();
}

test('confirm GET renders a confirm page with a POST form and does NOT create a subscriber', async () => {
  const kv = makeKV();
  const url = await subscribeAndGetConfirmUrl(kv, 'reader@example.com');
  const res = await handleConfirm(new Request(url, { method: 'GET' }), { SIGNUP_KV: kv });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /Confirm your subscription/i);
  assert.match(html, /<form method="POST"/i);
  const hash = await mailHash(SUPPRESS_KEY, 'reader@example.com');
  assert.equal(kv.m.get(subscriberKey(hash)), undefined, 'GET never mutates: no subscriber created');
});

test('confirm GET/POST with a bad nonce is invalid and creates nothing', async () => {
  const kv = makeKV();
  await subscribeAndGetConfirmUrl(kv, 'reader@example.com');
  const hash = await mailHash(SUPPRESS_KEY, 'reader@example.com');
  const bad = `https://signup.gbti.network/mail/confirm?h=${hash}&t=WRONGNONCE`;
  const get = await handleConfirm(new Request(bad, { method: 'GET' }), { SIGNUP_KV: kv });
  assert.equal(get.status, 200);
  assert.match(await get.text(), /invalid or has expired/i);
  const post = await handleConfirm(new Request(bad, { method: 'POST' }), { SIGNUP_KV: kv });
  assert.equal(post.status, 400);
  assert.equal(kv.m.get(subscriberKey(hash)), undefined);
});

test('confirm POST with a malformed hash is a 400 and touches nothing', async () => {
  const kv = makeKV();
  const res = await handleConfirm(new Request('https://signup.gbti.network/mail/confirm?h=notahash&t=x', { method: 'POST' }), { SIGNUP_KV: kv });
  assert.equal(res.status, 400);
  assert.equal(kv.m.size, 0);
});

test('confirm POST does not activate an address suppressed between subscribe and confirm', async () => {
  const kv = makeKV();
  const url = await subscribeAndGetConfirmUrl(kv, 'reader@example.com');
  const hash = await mailHash(SUPPRESS_KEY, 'reader@example.com');
  await kv.put(suppressKey(hash), SUPPRESS_VALUE); // they opted out in the window
  const res = await handleConfirm(new Request(url, { method: 'POST' }), { SIGNUP_KV: kv });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /opted out/i);
  assert.equal(kv.m.get(subscriberKey(hash)), undefined, 'a suppressed address is never activated by confirm');
});

test('SEAM end-to-end: subscribe -> confirm POST -> the drain resolver recovers the ORIGINAL email', async () => {
  const kv = makeKV();
  const EMAIL = 'Seam.Reader@Example.com';
  const url = await subscribeAndGetConfirmUrl(kv, EMAIL);

  const res = await handleConfirm(new Request(url, { method: 'POST' }), { SIGNUP_KV: kv });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /You are subscribed/i);

  const hash = await mailHash(SUPPRESS_KEY, EMAIL);
  // the active subscriber now exists, the pending opt-in is gone
  const stored = JSON.parse(kv.m.get(subscriberKey(hash)).value);
  assert.equal(stored.status, 'active');
  assert.equal(stored.source, 'anon');
  assert.equal(kv.m.get(optinKey(hash)), undefined, 'the pending opt-in is deleted after confirm');
  assert.ok(!kv.m.get(subscriberKey(hash)).value.includes(EMAIL), 'the stored record carries no raw address');

  // THE POINT: the drain's own resolver decrypts the promoted emailEnc back to the original address (trimmed).
  const recovered = await resolveSubscriberEmail(stored, { key: EMAIL_KEY });
  assert.equal(recovered, EMAIL, 'the emailEnc survived subscribe->pending->confirm->subscriber and decrypts back');
});
