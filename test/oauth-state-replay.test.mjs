// sow-236: the OAuth signup state was signed and TTL-bounded but never CONSUMED, and the callback that redeems it
// was not rate-limited. Turnstile and the IP rate limit both live at /signup/start, so they are the entire economic
// control on coupon abuse, and without a consume ONE Turnstile solve bought unlimited signups for the state's whole
// 600s TTL. The controls were not bypassed, they were amortized to zero. Against the uncapped, top-tier CODEABLEYEAR
// grant each replay with a fresh GitHub account was a free Content Creator year.
//
// The per-flow nonce is NOT a defence against this. It is client-held state, so it binds the flow to THIS browser
// and stops a state transplanted into someone else's. An attacker replaying their OWN state presents their own
// cookie and passes. Worth naming, because worker.test.mjs already carried a test called "REJECTS a replayed state
// with no matching nonce cookie" which tests the TRANSPLANTED case and never tested replay. Anyone grepping for
// replay coverage would have found it and stopped looking. The name promised more than the assertion delivered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { packState, consumeStateJti } from '../workers/signup/index.mjs';

const SECRET = 'test-secret-please-ignore';

function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
  };
}

function fakeEnv(overrides = {}) {
  return {
    SESSION_SECRET: SECRET,
    PUBLIC_BASE_URL: 'https://gbti.test',
    SITE_BASE_URL: 'https://gbti.test',
    TURNSTILE_SECRET_KEY: 'turnstile-secret',
    SIGNUP_KV: fakeKv(),
    GITHUB_OAUTH_CLIENT_ID: 'gh-client',
    GITHUB_OAUTH_CLIENT_SECRET: 'gh-secret',
    DISCORD_OAUTH_CLIENT_ID: 'dc-client',
    DISCORD_OAUTH_CLIENT_SECRET: 'dc-secret',
    DISCORD_BOT_TOKEN: 'bot-token',
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_PRICE_ID: 'price_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    DISCORD_GUILD_ID: 'guild-1',
    DISCORD_TRIAL_ROLE_ID: 'role-trial',
    DISCORD_MEMBER_ROLE_ID: 'role-member',
    REGATE_DISPATCH_TOKEN: 'dispatch-token',
    GITHUB_CONTENT_REPO: 'gbti-network/content',
    ...overrides,
  };
}

function req(method, path, init = {}) {
  return new Request(`https://signup.gbti.test${path}`, { method, ...init });
}

/** The scripted GitHub + Stripe backend a successful callback talks to. Each call returns a DISTINCT github id, so
 *  a replay models the real attack (a fresh throwaway account per redemption) rather than an idempotent repeat. */
function withSignupFetch(fn, { ids = [424242, 515151, 616161, 717171] } = {}) {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('login/oauth/access_token')) return body({ access_token: 'gho_token' });
    if (url.includes('api.github.com/user/emails')) return body([{ email: 'octo@example.com', primary: true, verified: true }]);
    if (url.includes('api.github.com/user')) return body({ id: ids[Math.min(n++, ids.length - 1)], login: `octocat${n}` });
    if (url.includes('api.stripe.com/v1/customers/search')) return body({ data: [] });
    if (url.includes('api.stripe.com/v1/customers')) return body({ id: `cus_${n}`, metadata: {} });
    return body({});
  };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

const callback = (state, env, ip = '203.0.113.7') =>
  worker.fetch(
    req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': ip },
    }),
    env,
    {},
  );

// --- The regression test. This is the one that FAILS against the pre-fix worker. --------------------------------

test('sow-236: a state redeemed once CANNOT be redeemed again, even from the same browser', async () => {
  const env = fakeEnv();
  const state = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-fixed-1' }, env);
  await withSignupFetch(async () => {
    const first = await callback(state, env);
    assert.equal(first.status, 302, 'the legitimate first redemption completes');
    assert.ok(first.headers.get('Set-Cookie'), 'the first redemption mints a session');

    // The SAME state, the SAME browser, the SAME cookie. This is the attacker replaying their OWN state, which the
    // nonce check cannot see, and it is the whole defect.
    const second = await callback(state, env);
    assert.equal(second.status, 400, 'the replay is rejected');
    assert.ok(!second.headers.get('Set-Cookie'), 'no second session is minted');
  });
});

test('sow-236: replay is rejected BEFORE any GitHub or Stripe work (a replay costs us nothing)', async () => {
  const env = fakeEnv();
  const state = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-fixed-2' }, env);
  await withSignupFetch(async () => {
    await callback(state, env); // burn it
  });
  // No stubbed fetch installed for this call: if the handler reaches the code exchange it throws or fails, rather
  // than returning a clean 400. Reaching the network at all on a known-dead state is the thing being excluded.
  const res = await callback(state, env);
  assert.equal(res.status, 400);
});

test('sow-236: a state with NO jti is rejected (fail closed across a deploy rollover)', async () => {
  // A state minted by the previous deploy carries no jti and is still signature-valid inside its 600s TTL. Accepting
  // it "just during rollover" would leave the hole open for exactly as long as an attacker needed. A member caught
  // mid-signup restarts; that is the correct trade against a live, monetizable abuse path.
  const env = fakeEnv();
  const legacyState = await packState({ ref: 'bob', nonce: 'n1' }, env);
  const res = await callback(legacyState, env);
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('Set-Cookie'), 'no session is minted for a state that cannot be consumed');
});

// --- The consume itself: every uncertainty must DENY. -------------------------------------------------------------

test('consumeStateJti: succeeds exactly once for a given jti', async () => {
  const kv = fakeKv();
  assert.equal(await consumeStateJti(kv, 'abc'), true, 'first use is allowed');
  assert.equal(await consumeStateJti(kv, 'abc'), false, 'second use is denied');
  assert.equal(await consumeStateJti(kv, 'def'), true, 'an unrelated jti is unaffected');
});

test('consumeStateJti: FAILS CLOSED on a missing store, a missing jti, or a KV that throws', async () => {
  // The Discord link token's consume is best-effort on the write, which is defensible for a token that only binds an
  // account the caller already holds. This one guards signup, so "we could not check" must never mean "allowed".
  assert.equal(await consumeStateJti(null, 'abc'), false, 'no KV binding');
  assert.equal(await consumeStateJti(undefined, 'abc'), false, 'no KV binding');
  for (const bad of [undefined, null, '', 0, 123, {}, ['abc']]) {
    assert.equal(await consumeStateJti(fakeKv(), bad), false, `jti ${JSON.stringify(bad)} must be denied`);
  }
  const throwsOnRead = { async get() { throw new Error('kv down'); }, async put() {} };
  assert.equal(await consumeStateJti(throwsOnRead, 'abc'), false, 'a KV read failure denies');
  const throwsOnWrite = { async get() { return null; }, async put() { throw new Error('kv down'); } };
  assert.equal(await consumeStateJti(throwsOnWrite, 'abc'), false, 'a KV write failure denies: we cannot prove single use');
});

test('consumeStateJti: the consume record OUTLIVES the 600s state TTL', async () => {
  // If the record expired first, a still-valid state would become fresh again and the consume would be theatre.
  let ttl = null;
  const kv = { async get() { return null; }, async put(_k, _v, opts) { ttl = opts?.expirationTtl ?? null; } };
  await consumeStateJti(kv, 'abc');
  assert.ok(typeof ttl === 'number' && ttl > 600, `consume record TTL (${ttl}) must exceed the 600s state TTL`);
});

// --- The callback rate limit: the backstop for the residual the KV consume cannot close. ---------------------------

test('sow-236: the callback is rate-limited by IP, which /signup/start alone never bounded', async () => {
  // KV is eventually consistent across colos, so a distributed racer can slip a bounded number of consumes past. This
  // is the independent bound on that remainder. Deliberately loose: real signups share IPs behind carrier/office NAT.
  const env = fakeEnv();
  let last = null;
  await withSignupFetch(async () => {
    for (let i = 0; i < 25; i += 1) {
      const state = await packState({ ref: 'bob', nonce: 'n1', jti: `burst-${i}` }, env);
      last = await callback(state, env, '198.51.100.9');
    }
  }, { ids: [1, 2, 3] });
  assert.equal(last.status, 429, 'a sustained burst from one IP is rate-limited at the callback');
});

test('sow-236: the rate limit does NOT punish a different IP', async () => {
  const env = fakeEnv();
  await withSignupFetch(async () => {
    for (let i = 0; i < 25; i += 1) {
      const state = await packState({ ref: 'bob', nonce: 'n1', jti: `noisy-${i}` }, env);
      await callback(state, env, '198.51.100.10');
    }
    const state = await packState({ ref: 'bob', nonce: 'n1', jti: 'quiet-1' }, env);
    const res = await callback(state, env, '203.0.113.200');
    assert.notEqual(res.status, 429, 'an unrelated visitor is not caught by another IP window');
  }, { ids: [9001] });
});
