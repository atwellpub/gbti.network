// The signup funnel is instrumented, because on 2026-08-13 a real prospect could not complete signup, the owner
// asked "is this happening to other people?", and the honest answer was that we could not know. handleStart and
// handleGithubCallback made ZERO log calls between them, so the only record of a failed signup was the member
// saying so, and a funnel with no denominator cannot answer a rate question.
//
// The load-bearing property these tests defend is NOT that logging happens. It is that logging happens WITHOUT
// changing what the caller sees. The callback answers one opaque `bad_oauth_state` to seven distinct causes; that
// opacity is a security property on the way out and a blindness on the way in, and only the first needs keeping.
// So every rejection test asserts the response is unchanged AND that the reason is separable in the log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { packState, consumeStateJti } from '../workers/signup/index.mjs';
import { wlog } from '../workers/signup/wlog.mjs';

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
    DISCORD_GUILD_ID: 'guild-1',
    DISCORD_MEMBER_ROLE_ID: 'role-member',
    GITHUB_CONTENT_REPO: 'gbti-network/content',
    ...overrides,
  };
}

const req = (method, path, init = {}) => new Request(`https://signup.gbti.test${path}`, { method, ...init });

// The IP header is REQUIRED, not decoration: rateLimit denies outright when it has no ip (`!kv || !ip` fails
// closed), so a start without it 429s before it ever reaches Turnstile.
const start = (env, qs = '') =>
  worker.fetch(req('GET', `/signup/start?cf-turnstile-response=tok${qs}`, { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), env, {});

// `turnstile` scripts the siteverify answer, so a start can be driven down either branch.
function withFetch(fn, { turnstile = true, failStep = null } = {}) {
  const original = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input.url;
    const body = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('siteverify')) return body({ success: turnstile });
    if (url.includes('login/oauth/access_token')) {
      if (failStep === 'github_exchange_code') return new Response('nope', { status: 502 });
      return body({ access_token: 'gho_token' });
    }
    if (url.includes('api.github.com/user/emails')) return body([{ email: 'octo@example.com', primary: true, verified: true }]);
    if (url.includes('api.github.com/user')) {
      if (failStep === 'github_fetch_user') return new Response('nope', { status: 503 });
      return body({ id: 424242 + n++, login: 'octocat' });
    }
    if (url.includes('api.stripe.com/v1/customers/search')) return body({ data: [] });
    if (url.includes('api.stripe.com/v1/customers')) return body({ id: 'cus_1', metadata: {} });
    return body({});
  };
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = original; });
}

const callback = (state, env, { cookie = 'gbti_oauth_nonce=n1', code = 'ghcode' } = {}) =>
  worker.fetch(
    req('GET', `/signup/github/callback?${code ? `code=${code}&` : ''}state=${encodeURIComponent(state)}`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'CF-Connecting-IP': '203.0.113.7' },
    }),
    env,
    {},
  );

const funnelLines = () => wlog.recent().filter((e) => e.area === 'signup-funnel');
const reasons = () => funnelLines().map((e) => e.data?.reason).filter(Boolean);

// ---------------------------------------------------------------------------
// The denominator and the numerator
// ---------------------------------------------------------------------------

test('a completed signup logs a start and a complete, so a drop-off has a denominator', async () => {
  wlog.clear();
  const env = fakeEnv();
  await withFetch(async () => {
    const res0 = await start(env);
    assert.equal(res0.status, 302, 'start still redirects to GitHub');
    const state = new URL(res0.headers.get('Location')).searchParams.get('state');
    const nonce = /gbti_oauth_nonce=([^;]+)/.exec(res0.headers.get('Set-Cookie'))[1];
    const res = await callback(state, env, { cookie: `gbti_oauth_nonce=${nonce}` });
    assert.equal(res.status, 302, 'and the callback still completes');
  });

  const events = funnelLines().map((e) => e.msg);
  assert.deepEqual(events, ['start', 'complete'], 'exactly one of each, in order');
  const complete = funnelLines()[1];
  // A STRING, matching how github_id is keyed everywhere else in the system rather than how GitHub sends it.
  assert.equal(complete.data.githubId, '424242', 'the completion names who it was');
  assert.equal(complete.data.created, true, 'and whether they were genuinely new');
});

test('a start that never becomes a signup leaves a start with no complete', async () => {
  // The whole point of the denominator: an abandoned funnel is VISIBLE as an imbalance rather than as silence.
  wlog.clear();
  const env = fakeEnv();
  await withFetch(async () => {
    await start(env);
  });
  assert.deepEqual(funnelLines().map((e) => e.msg), ['start']);
});

// ---------------------------------------------------------------------------
// The seven causes of one opaque error, separated in the log and NOWHERE else
// ---------------------------------------------------------------------------

test('every callback rejection is separable in the log while the response stays byte-identical', async () => {
  const env = fakeEnv();
  const state = await packState({ nonce: 'n1', jti: 'j1' }, env);

  const cases = [
    ['no_code', () => callback(state, env, { code: '' })],
    ['bad_state', () => callback('not-a-real-state', env)],
    ['no_cookie_nonce', () => callback(state, env, { cookie: '' })],
    ['nonce_mismatch', () => callback(state, env, { cookie: 'gbti_oauth_nonce=someone-elses' })],
    ['no_state_nonce', async () => callback(await packState({ jti: 'j2' }, env), env)],
  ];

  for (const [expected, run] of cases) {
    wlog.clear();
    const res = await withFetch(() => run());
    // The security property: the caller learns NOTHING about which check it tripped.
    assert.equal(res.status, 400, `${expected}: same status`);
    assert.deepEqual(await res.json(), { error: 'bad_oauth_state' }, `${expected}: same body`);
    // The diagnostic property: we learn exactly which one.
    assert.ok(reasons().includes(expected), `${expected}: logged, got ${JSON.stringify(reasons())}`);
  }
});

test('a replayed state is logged as a replay, not as the same failure as a broken cookie', async () => {
  // This is the pair that mattered. sow-236 made a replayed state answer `bad_oauth_state`, the SAME string a
  // member with a dropped cookie gets. One is an attack and one is a person we are failing, and before this they
  // were the same line.
  const env = fakeEnv();
  const state = await packState({ nonce: 'n1', jti: 'j-replay' }, env);
  await withFetch(() => callback(state, env));

  wlog.clear();
  const res = await withFetch(() => callback(state, env));
  assert.equal(res.status, 400);
  assert.ok(reasons().includes('already_redeemed'), 'the consume names the replay');
  assert.ok(reasons().includes('state_not_consumed'), 'and the handler records that the gate closed');
  assert.ok(!reasons().includes('no_cookie_nonce'), 'and it is NOT confused with a cookie problem');
});

test('consumeStateJti tells its four denials apart, which only it can do', async () => {
  // The caller sees one `false` for a misconfigured binding, a pre-deploy state, a genuine replay and a KV
  // outage. Those are four different operational facts: one is an incident, one is a rollover, one is an attack.
  const kv = fakeKv();
  const throwing = { async get() { throw new Error('kv down'); }, async put() {} };

  wlog.clear();
  assert.equal(await consumeStateJti(null, 'j'), false);
  assert.equal(await consumeStateJti(kv, ''), false);
  assert.equal(await consumeStateJti(kv, 'used'), true, 'the first use is still allowed');
  assert.equal(await consumeStateJti(kv, 'used'), false);
  assert.equal(await consumeStateJti(throwing, 'j'), false);

  assert.deepEqual(reasons(), ['no_kv_binding', 'no_jti', 'already_redeemed', 'kv_error']);
});

// ---------------------------------------------------------------------------
// Naming the step that threw
// ---------------------------------------------------------------------------

test('a failure talking to GitHub names the step, and still 500s exactly as before', async () => {
  for (const step of ['github_exchange_code', 'github_fetch_user']) {
    wlog.clear();
    const env = fakeEnv();
    const state = await packState({ nonce: 'n1', jti: `j-${step}` }, env);
    const res = await withFetch(() => callback(state, env), { failStep: step });
    assert.equal(res.status, 500, `${step}: the response is unchanged, this adds a record not a behaviour`);
    const failed = funnelLines().find((e) => e.msg === 'callback failed');
    assert.equal(failed.data.step, step, 'and the log says which call it was');
  }
});

// ---------------------------------------------------------------------------
// What must never reach a log line
// ---------------------------------------------------------------------------

test('the funnel logs no jti, no coupon code and no token, on any path', async () => {
  // Signup handles three bearer values: the OAuth state jti, a per-invite coupon code (a bearer secret since
  // sow-231, when the owner reversed their own ruling to allow them), and the GitHub access token. A funnel that
  // leaked any of them into retained logs would be a worse problem than the blindness it fixes.
  wlog.clear();
  const env = fakeEnv();
  await withFetch(async () => {
    const res0 = await start(env, '&coupon=CODEABLEYEAR&ref=999');
    const state = new URL(res0.headers.get('Location')).searchParams.get('state');
    const nonce = /gbti_oauth_nonce=([^;]+)/.exec(res0.headers.get('Set-Cookie'))[1];
    await callback(state, env, { cookie: `gbti_oauth_nonce=${nonce}` });
    await callback(state, env, { cookie: `gbti_oauth_nonce=${nonce}` }); // and again, to exercise the replay path
  });

  const dump = JSON.stringify(funnelLines());
  for (const secret of ['CODEABLEYEAR', 'gho_token', 'turnstile-secret', 'gh-secret']) {
    assert.ok(!dump.includes(secret), `${secret} must never appear in a funnel log line`);
  }
  // The jti is a UUID minted inside handleStart, so assert on the shape rather than a known value.
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.test(dump), 'no uuid (jti or nonce) is logged');
});

test('the turnstile rejection separates a failed solve from a widget that never ran', async () => {
  // Same 403 either way, but one means a bot and the other means OUR page is broken. The key is deliberately
  // NOT called hadToken: devlog-core redacts any key matching /token|secret|.../i, so that name would have
  // logged "<redacted>" forever and this distinction would never once have appeared.
  wlog.clear();
  const env = fakeEnv();
  await withFetch(async () => {
    await start(env);
    await worker.fetch(req('GET', '/signup/start', { headers: { 'CF-Connecting-IP': '203.0.113.7' } }), env, {});
  }, { turnstile: false });

  const lines = funnelLines().filter((e) => e.data?.reason === 'turnstile');
  assert.deepEqual(lines.map((e) => e.data.hadResponse), [true, false]);
});
