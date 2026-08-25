// Tests the pure, testable logic factored out of the signup Worker (SOW-002). The Worker entrypoint
// (index.mjs) is glue and is exercised indirectly through these units. No network, no secrets: a
// recording fake fetch and in-memory fakes for the injected Stripe / Discord clients + KV.
//
// Coverage:
//   - referral: self-reject, first-touch, empty handling
//   - decideCustomer: reuse on a search hit, create on a miss
//   - session: sign + verify round trip, tamper rejection, expiry
//   - Turnstile: request shaping + fail-closed
//   - signup orchestration: existing customer reused and trial_started_at NOT rewritten; a new
//     customer gets all metadata + the trial role; KV index written

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveReferral, normalizeRefCode } from '../workers/signup/referral.mjs';
import { decideCustomer, buildNewCustomerMetadata, buildRefreshMetadata, runSignup, normalizeVia, resolveSignupRole } from '../workers/signup/signup.mjs';
import { discordRoleTarget } from '../scripts/lib/reconcile-plan.mjs'; // the steady state signup must agree with
import { signSession, verifySession } from '../workers/signup/session.mjs';
import { sessionCookieHeader } from '../workers/signup/session.mjs';
import { verifyTurnstile } from '../workers/signup/abuse.mjs';
import { isDuplicateEvent, markEventSeen, handleStripeEvent } from '../workers/signup/webhook.mjs';
import worker, { packState, unpackState, safeReturnTo } from '../workers/signup/index.mjs';
import { wlog } from '../workers/signup/wlog.mjs'; // the guard tests read its ring rather than capturing console

const SECRET = 'test-session-secret-0123456789';

/** A recording fake fetch that returns scripted responses. */
function recorder(responses) {
  const calls = [];
  let i = 0;
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method, headers: opts.headers, body: opts.body });
    const r = typeof responses === 'function' ? responses(url, opts, i) : responses[i] ?? responses[responses.length - 1];
    i++;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return { fetch, calls };
}

/** In-memory KV with the get/put surface the Worker uses. */
function fakeKv() {
  const store = new Map();
  return {
    store,
    async get(key, opts) {
      const v = store.get(key);
      if (v === undefined) return null;
      return opts?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
  };
}

/** Fake Stripe client capturing create/update/search; scriptable search hit. */
function fakeStripe({ searchHit = null } = {}) {
  const calls = { search: [], create: [], update: [] };
  return {
    calls,
    async searchCustomerByGithubId(githubId) {
      calls.search.push(githubId);
      return searchHit;
    },
    async createCustomer(args, idempotencyKey) {
      calls.create.push({ args, idempotencyKey });
      return { id: 'cus_new', metadata: args.metadata };
    },
    async updateCustomer(customerId, args) {
      calls.update.push({ customerId, args });
      return { id: customerId };
    },
  };
}

/** Fake Discord client capturing addGuildMember + addRole. */
function fakeDiscord() {
  const calls = { addGuildMember: [], addRole: [], removeRole: [] };
  return {
    calls,
    async addGuildMember(guildId, userId, opts) {
      calls.addGuildMember.push({ guildId, userId, opts });
      return null;
    },
    async addRole(guildId, userId, roleId) {
      calls.addRole.push({ guildId, userId, roleId });
      return null;
    },
    // sow-218: signup now SWAPS (add target, strip the other access roles) instead of only adding.
    async removeRole(guildId, userId, roleId) {
      calls.removeRole.push({ guildId, userId, roleId });
      return null;
    },
  };
}

// ---------------------------------------------------------------------------
// Referral
// ---------------------------------------------------------------------------

test('referral rejects self-referral (ref === new member github_id)', () => {
  const out = resolveReferral({ refCode: '777', newMemberGithubId: '777' });
  assert.equal(out, null);
});

test('referral first-touch resolves a different referrer id', () => {
  const out = resolveReferral({ refCode: ' 42 ', newMemberGithubId: '777' });
  assert.equal(out, '42');
});

test('referral with no code or empty code returns null', () => {
  assert.equal(resolveReferral({ refCode: undefined, newMemberGithubId: '1' }), null);
  assert.equal(resolveReferral({ refCode: '   ', newMemberGithubId: '1' }), null);
  assert.equal(normalizeRefCode(''), null);
  assert.equal(normalizeRefCode('x'), 'x');
});

test('referral resolver mapping a code to a different id is honored, self still rejected', () => {
  const resolve = (c) => (c === 'alice' ? '999' : null);
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve }), '999');
  // resolver maps to the new member itself -> reject
  const resolveSelf = () => '1';
  assert.equal(resolveReferral({ refCode: 'alice', newMemberGithubId: '1', resolve: resolveSelf }), null);
});

// ---------------------------------------------------------------------------
// Idempotent customer decision
// ---------------------------------------------------------------------------

test('decideCustomer reuses on a search hit', () => {
  const plan = decideCustomer({ id: 'cus_existing', metadata: { github_id: '5' } });
  assert.deepEqual(plan, { action: 'reuse', customerId: 'cus_existing' });
});

test('decideCustomer creates on a miss (null)', () => {
  assert.deepEqual(decideCustomer(null), { action: 'create' });
  assert.deepEqual(decideCustomer(undefined), { action: 'create' });
});

test('buildNewCustomerMetadata includes trial_started_at and optional referred_by; refresh omits trial', () => {
  const meta = buildNewCustomerMetadata({
    githubId: '5',
    githubLogin: 'octocat',
    discordUserId: 'd9',
    trialStartedAt: '2026-06-02T00:00:00.000Z',
    signupSource: 'signup-worker',
    referredBy: '42',
  });
  assert.equal(meta.github_id, '5');
  assert.equal(meta.trial_started_at, '2026-06-02T00:00:00.000Z');
  assert.equal(meta.referred_by, '42');
  assert.equal(meta.signup_source, 'signup-worker');

  const refresh = buildRefreshMetadata({ githubLogin: 'octocat-renamed', discordUserId: 'd9' });
  assert.equal(refresh.github_login, 'octocat-renamed');
  assert.ok(!('trial_started_at' in refresh), 'refresh metadata must never carry trial_started_at');
  assert.ok(!('referred_by' in refresh), 'refresh metadata must never carry referred_by');
  assert.ok(!('via' in refresh), 'refresh metadata must never rewrite the first-touch via');
  assert.ok(!('touch_session' in refresh), 'refresh metadata must never rewrite the touch-session binding (SOW-059 P1c)');
});

test('SOW-059 P1c: buildNewCustomerMetadata binds a valid touch_session new-customer-only; drops an invalid one', () => {
  const sid = 'abcdefghijklmnopqrstuvwxyz012345'; // 32 chars, matches the session shape
  const ok = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', touchSession: sid });
  assert.equal(ok.touch_session, sid);
  // an invalid / short / spoofed session id is dropped (never written to Stripe metadata)
  for (const bad of ['short', 'has spaces!!', 'x'.repeat(200), '', undefined]) {
    const m = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', touchSession: bad });
    assert.ok(!('touch_session' in m), `invalid sid (${bad}) must be dropped`);
  }
});

test('SOW-059 P1c: the OAuth state blob round-trips the touch sid through both hops', async () => {
  const env = { SESSION_SECRET: 'test-secret-至少-32-bytes-long-padding-xx' };
  const sid = 'abcdefghijklmnopqrstuvwxyz012345';
  const packed = await packState({ ref: '42', via: 'post:a', sid }, env);
  const back = await unpackState(packed, env);
  assert.equal(back.sid, sid);
  // re-pack at the github hop (carrying identity) preserves it
  const next = await unpackState(await packState({ ref: back.ref, via: back.via, sid: back.sid, githubId: '5', githubLogin: 'octocat' }, env), env);
  assert.equal(next.sid, sid);
  assert.equal(next.githubId, '5');
});

test('normalizeVia accepts a strict <type>:<kebab-slug> and drops anything else (fail safe)', () => {
  assert.equal(normalizeVia('post:my-slug'), 'post:my-slug');
  assert.equal(normalizeVia('product:cool-thing'), 'product:cool-thing');
  assert.equal(normalizeVia('prompt:do-x'), 'prompt:do-x');
  // dropped: wrong type, path traversal, spaces, uppercase, empty, overlong
  assert.equal(normalizeVia('page:home'), null);
  assert.equal(normalizeVia('post:../../etc/passwd'), null);
  assert.equal(normalizeVia('post: with space'), null);
  assert.equal(normalizeVia('post:UPPER'), null);
  assert.equal(normalizeVia(''), null);
  assert.equal(normalizeVia(undefined), null);
  assert.equal(normalizeVia('post:' + 'a'.repeat(500)), 'post:' + 'a'.repeat(195)); // trimmed to 200 chars total
});

test('buildNewCustomerMetadata captures a valid via and omits an invalid one', () => {
  const ok = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'product:thing' });
  assert.equal(ok.via, 'product:thing');
  const bad = buildNewCustomerMetadata({ githubId: '5', discordUserId: 'd9', trialStartedAt: 'x', via: 'evil payload' });
  assert.ok(!('via' in bad), 'an invalid via is dropped, never written to Stripe metadata');
});

// ---------------------------------------------------------------------------
// Session sign + verify
// ---------------------------------------------------------------------------

test('session sign + verify round trip preserves github_id and login', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const payload = await verifySession(token, SECRET);
  assert.ok(payload);
  assert.equal(payload.github_id, '12345');
  assert.equal(payload.github_login, 'octocat');
});

test('session verify rejects a tampered payload', async () => {
  const token = await signSession({ githubId: '12345', githubLogin: 'octocat' }, SECRET);
  const [body, sig] = token.split('.');
  // Flip the payload (different github_id) but keep the old signature -> must fail.
  const forgedBody = Buffer.from(JSON.stringify({ github_id: '999', iat: 1, exp: 9999999999 }))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const tampered = `${forgedBody}.${sig}`;
  assert.equal(await verifySession(tampered, SECRET), null);
  // Wrong secret also fails.
  assert.equal(await verifySession(token, 'a-different-secret'), null);
  // Malformed token fails.
  assert.equal(await verifySession('garbage', SECRET), null);
  assert.equal(await verifySession(`${body}.`, SECRET), null);
});

test('session verify rejects an expired token', async () => {
  const past = Date.now() - 10_000;
  const token = await signSession({ githubId: '7' }, SECRET, { ttlSeconds: 1, now: past });
  assert.equal(await verifySession(token, SECRET, { now: Date.now() }), null);
});

// ---------------------------------------------------------------------------
// Turnstile verify request shaping + fail closed
// ---------------------------------------------------------------------------

test('verifyTurnstile posts secret + response (+ remoteip) to siteverify and returns success', async () => {
  const { fetch, calls } = recorder([{ body: { success: true } }]);
  const ok = await verifyTurnstile({ token: 'tok', secret: 'sek', remoteIp: '1.2.3.4' }, fetch);
  assert.equal(ok, true);
  assert.match(calls[0].url, /challenges\.cloudflare\.com\/turnstile\/v0\/siteverify$/);
  assert.equal(calls[0].method, 'POST');
  assert.match(calls[0].headers['Content-Type'], /application\/x-www-form-urlencoded/);
  const params = new URLSearchParams(calls[0].body);
  assert.equal(params.get('secret'), 'sek');
  assert.equal(params.get('response'), 'tok');
  assert.equal(params.get('remoteip'), '1.2.3.4');
});

test('verifyTurnstile fails closed on success:false, non-2xx, and missing inputs', async () => {
  const r1 = recorder([{ body: { success: false } }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r1.fetch), false);
  const r2 = recorder([{ status: 500, body: 'err' }]);
  assert.equal(await verifyTurnstile({ token: 't', secret: 's' }, r2.fetch), false);
  // No token or no secret short-circuits to false without a fetch.
  const r3 = recorder([{ body: { success: true } }]);
  assert.equal(await verifyTurnstile({ token: '', secret: 's' }, r3.fetch), false);
  assert.equal(r3.calls.length, 0);
});

// ---------------------------------------------------------------------------
// Signup orchestration
// ---------------------------------------------------------------------------

const IDENTITY = {
  githubId: '12345',
  githubLogin: 'octocat',
  discordUserId: 'd-987',
  email: 'octo@example.com',
  discordAccessToken: 'discord-user-token',
};
// lockedRoleId is what a FRESH signup receives since the trial retirement (2026-08-11). trialRoleId stays in
// the fixture deliberately: if signup ever reaches for it again, these tests must fail rather than pass by
// its absence.
const CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', memberRoleId: 'role-member', lockedRoleId: 'role-locked', signupSource: 'signup-worker' };

test('signup with an existing customer reuses it and does NOT rewrite trial_started_at', async () => {
  const existing = {
    id: 'cus_existing',
    metadata: { github_id: '12345', trial_started_at: '2020-01-01T00:00:00.000Z' },
  };
  const stripe = fakeStripe({ searchHit: existing });
  const discord = fakeDiscord();
  const kv = fakeKv();

  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '42',
    now: new Date('2026-06-02T00:00:00.000Z'),
  });

  assert.equal(result.customerId, 'cus_existing');
  assert.equal(result.created, false);
  // No new customer created.
  assert.equal(stripe.calls.create.length, 0);
  // Update was an opportunistic refresh that must NOT contain trial_started_at or referred_by.
  assert.equal(stripe.calls.update.length, 1);
  const updateMeta = stripe.calls.update[0].args.metadata;
  assert.ok(!('trial_started_at' in updateMeta), 'must not rewrite the trial clock on reuse');
  assert.ok(!('referred_by' in updateMeta), 'must not rewrite referral attribution on reuse');
  assert.equal(updateMeta.github_login, 'octocat');
  // KV index written.
  assert.equal(kv.store.get('gh:12345'), 'cus_existing');
  // Trial role assigned via guilds.join with the user's access token.
  assert.equal(discord.calls.addGuildMember.length, 1);
  const join = discord.calls.addGuildMember[0];
  assert.equal(join.guildId, 'guild-1');
  assert.equal(join.userId, 'd-987');
  assert.deepEqual(join.opts.roles, ['role-locked']);
  assert.equal(join.opts.accessToken, 'discord-user-token');
});

test('SOW: GitHub-only signup (Discord deferred) -> Customer omits discord_user_id, no guild join, discordLinked false', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const result = await runSignup({
    identity: { githubId: '424242', githubLogin: 'octocat', discordUserId: null, email: 'octo@example.com', discordAccessToken: null },
    stripe, discord, kv, config: CONFIG,
    now: new Date('2026-06-02T00:00:00.000Z'),
  });
  assert.equal(result.created, true);
  assert.equal(result.discordLinked, false);
  const meta = stripe.calls.create[0].args.metadata;
  assert.equal(meta.github_id, '424242');
  assert.ok(!('discord_user_id' in meta), 'GitHub-only signup omits discord_user_id');
  assert.equal(stripe.calls.create[0].args.email, 'octo@example.com'); // email sourced from GitHub
  assert.equal(discord.calls.addGuildMember.length, 0, 'no guild join without Discord');
  assert.equal(discord.calls.addRole.length, 0, 'no role assignment without Discord');
  assert.equal(kv.store.get('gh:424242'), 'cus_new', 'KV index still written');
});

// --- The signup role after the trial retirement (2026-08-11) ----------------------------------------------

test('an UNSET locked role id joins the guild with NO role, never `undefined`', async () => {
  // A missing config value must not become a malformed Discord call. Sending roles:[undefined] turns a
  // config gap into an API error or, worse, a silent partial success, instead of a visible no-op.
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY,
    stripe: fakeStripe({ searchHit: null }),
    discord,
    kv: fakeKv(),
    config: { guildId: 'guild-1', signupSource: 'signup-worker' }, // no lockedRoleId
    refCode: '', via: '',
    now: new Date('2026-06-02T12:00:00.000Z'),
  });
  const join = discord.calls.addGuildMember[0];
  assert.ok(join, 'still joins the guild');
  assert.equal(join.opts.roles, undefined, 'no roles key at all, rather than [undefined]');
  assert.equal(discord.calls.addRole.length, 0, 'no role call with an undefined id');
});

test('the signup role EQUALS what reconcile would assign the same member (no drift)', async () => {
  // Signup and reconcile must never disagree about what a free member holds. Asserting against
  // discordRoleTarget rather than a hardcoded string means a future change to one side fails here rather
  // than producing a role that silently gets swapped a day later, which is the bug this replaced.
  assert.equal(discordRoleTarget('none'), 'locked');
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY,
    stripe: fakeStripe({ searchHit: null }),
    discord,
    kv: fakeKv(),
    config: CONFIG,
    refCode: '', via: '',
    now: new Date('2026-06-02T12:00:00.000Z'),
  });
  const ROLE_ID_FOR = { member: CONFIG.memberRoleId, trial: CONFIG.trialRoleId, locked: CONFIG.lockedRoleId };
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, [ROLE_ID_FOR[discordRoleTarget('none')]]);
});

test('signup with no existing customer creates one with full metadata + locked role + KV index', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const now = new Date('2026-06-02T12:00:00.000Z');

  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '42',
    via: 'post:my-first-post',
    now,
  });

  assert.equal(result.created, true);
  assert.equal(result.customerId, 'cus_new');
  assert.equal(result.referredBy, '42');
  // Exactly one create, with the idempotency key derived from github_id.
  assert.equal(stripe.calls.create.length, 1);
  const { args, idempotencyKey } = stripe.calls.create[0];
  assert.equal(idempotencyKey, 'signup:12345');
  assert.equal(args.email, 'octo@example.com');
  assert.equal(args.metadata.github_id, '12345');
  assert.equal(args.metadata.github_login, 'octocat');
  assert.equal(args.metadata.discord_user_id, 'd-987');
  // 2026-08-11: the 90-day trial is RETIRED (owner). Signup no longer mints trial_started_at, which was
  // the single tap that produced the `trialing` status, so a new customer must NOT carry the clock.
  // Asserting its ABSENCE rather than deleting the line: this is the whole retirement, and it belongs
  // pinned in the test that covers what a fresh signup writes.
  assert.equal(args.metadata.trial_started_at, undefined, 'the trial is retired: no clock is minted');
  assert.equal(args.metadata.referred_by, '42');
  assert.equal(args.metadata.via, 'post:my-first-post', 'the landed-on content is captured for the payout split');
  assert.equal(args.metadata.signup_source, 'signup-worker');
  // No update on a fresh create.
  assert.equal(stripe.calls.update.length, 0);
  // KV index written to the new customer id.
  assert.equal(kv.store.get('gh:12345'), 'cus_new');
  // The signup role is assigned on join AND explicitly via addRole (so existing guild members get it too,
  // since Discord ignores the join `roles` for a user already in the guild). Both must stay symmetric.
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-locked']);
  assert.equal(discord.calls.addRole.length, 1);
  assert.deepEqual(discord.calls.addRole[0], { guildId: 'guild-1', userId: 'd-987', roleId: 'role-locked' });
  assert.ok(!discord.calls.addRole.some((c) => c.roleId === 'role-trial'), 'never the trial role: it is retired');
});

test('signup rejects a self-referral at creation (no referred_by stored)', async () => {
  const stripe = fakeStripe({ searchHit: null });
  const discord = fakeDiscord();
  const kv = fakeKv();
  const result = await runSignup({
    identity: IDENTITY,
    stripe,
    discord,
    kv,
    config: CONFIG,
    refCode: '12345', // same as the new member's github_id -> self, must be dropped
    now: new Date('2026-06-02T00:00:00.000Z'),
  });
  assert.equal(result.referredBy, null);
  const meta = stripe.calls.create[0].args.metadata;
  assert.ok(!('referred_by' in meta), 'self-referral must not be persisted');
});

// ---------------------------------------------------------------------------
// Entrypoint coverage (FIX 5): drive the default fetch handler with synthetic Request objects and a
// fake env (fake KV + a stubbed global fetch). The OAuth helpers and the frozen Stripe / Discord
// clients all call globalThis.fetch, so we swap it per test and restore it afterward. No network and
// no real secrets.
// ---------------------------------------------------------------------------

/** A minimal env that satisfies every code path the entrypoint tests exercise. */
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

/**
 * Install a stubbed globalThis.fetch that routes by URL substring to a scripted handler, runs `fn`,
 * then restores the original fetch. The handler returns { status?, body? } and we shape a minimal
 * Response-like object (the clients and OAuth helpers only use .ok, .status, .text()).
 */
async function withFetch(router, fn) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, method: opts.method, headers: opts.headers, body: opts.body });
    const r = router(u, opts) ?? { status: 200, body: '' };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (r.body === undefined ? '' : typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

function req(method, path, { headers = {}, body } = {}) {
  return new Request(`https://gbti.test${path}`, { method, headers, body });
}

test('GET /signup/start passes abuse checks and redirects to GitHub with a signed state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => {
      if (url.includes('siteverify')) return { status: 200, body: { success: true } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&ref=alice', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      const location = res.headers.get('Location');
      assert.ok(location.startsWith('https://github.com/login/oauth/authorize'), 'redirects to GitHub authorize');
      const stateParam = new URL(location).searchParams.get('state');
      assert.ok(stateParam, 'carries a state param');
      // The state must verify and round-trip the referral code (HMAC-signed; this is the CSRF control).
      const unpacked = await unpackState(stateParam, env);
      assert.ok(unpacked, 'state verifies with SESSION_SECRET');
      assert.equal(unpacked.ref, 'alice');
      assert.ok(unpacked.nonce, 'the state carries a per-browser nonce (state-browser binding)');
      const setCookie = res.headers.get('Set-Cookie') || '';
      assert.match(setCookie, new RegExp('gbti_oauth_nonce=' + unpacked.nonce), 'the same nonce is set as a cookie');
      assert.match(setCookie, /HttpOnly/);
    },
  );
});

test('GET /signup/start fails closed (403) when Turnstile rejects', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: false } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=bad', { headers: { 'CF-Connecting-IP': '1.1.1.1' } }),
        env,
        {},
      );
      assert.equal(res.status, 403);
    },
  );
});

test('GET /signup/github/callback completes the trial signup on GitHub ALONE (Discord deferred)', async () => {
  const env = fakeEnv();
  // sow-236: a real state now carries a one-time jti, KV-consumed at the callback. The fixture reflects the new
  // state shape rather than the assertion being relaxed; a state without one is rejected, which is its own test.
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-happy-path' }, env);
  await withFetch(
    (url) => {
      if (url.includes('login/oauth/access_token')) return { status: 200, body: { access_token: 'gho_token' } };
      if (url.includes('api.github.com/user/emails')) return { status: 200, body: [{ email: 'octo@example.com', primary: true, verified: true }] };
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 424242, login: 'octocat' } };
      if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [] } };
      if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: 'cus_new', metadata: {} } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': '9.9.9.9' } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      const location = res.headers.get('Location');
      assert.ok(location.includes('/welcome/'), 'sow-207: completes signup -> the website welcome flow, not the extension page or a Discord redirect');
      assert.ok(!location.includes('discord.com'), 'no Discord hop in the signup flow');
      assert.ok(res.headers.get('Set-Cookie'), 'a session cookie is set (signup completed on GitHub alone)');
      // sow-158 Phase 1b: the callback now mints BOTH the HttpOnly session cookie and the readable CSRF cookie.
      const setCookies = res.headers.getSetCookie();
      assert.ok(setCookies.some((c) => c.startsWith('gbti_session=') && /HttpOnly/.test(c)), 'the HttpOnly session cookie is set');
      assert.ok(setCookies.some((c) => c.startsWith('gbti_csrf=') && !/HttpOnly/.test(c)), 'the readable (non-HttpOnly) CSRF cookie is set');
      assert.equal(env.SIGNUP_KV.store.get('gh:424242'), 'cus_new', 'the trial Customer was created + indexed');
    },
  );
});

// sow-236 RENAMED. This was called "REJECTS a replayed state with no matching nonce cookie", and it never tested
// replay: it tests a state TRANSPLANTED into a different browser. The nonce is client-held, so it cannot defend
// against a client replaying its OWN state, and the old name is why nobody looked for the missing consume. Anyone
// grepping for replay coverage found this and stopped. Real replay is covered in test/oauth-state-replay.test.mjs.
test('GET /signup/github/callback REJECTS a state TRANSPLANTED into another browser (login-CSRF / session-fixation defense)', async () => {
  const env = fakeEnv();
  // Carries a valid jti, so the nonce mismatch is the ONLY thing that can reject it. Without one this would 400 for
  // the sow-236 reason instead and would silently stop testing the nonce at all.
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-transplant' }, env); // legitimately signed...
  // ...delivered into a DIFFERENT browser, which lacks the matching gbti_oauth_nonce cookie. Rejected BEFORE any
  // code exchange or session mint (no global fetch needed -- the handler returns 400 first).
  const res = await worker.fetch(
    req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=WRONG' } }),
    env,
    {},
  );
  assert.equal(res.status, 400);
  assert.ok(!res.headers.get('Set-Cookie'), 'no session is minted for a transplanted state');
  assert.equal(env.SIGNUP_KV.store.get('statejti:jti-transplant'), undefined, 'a rejected state does NOT burn its jti');
});

// ---- sow-158 Phase 1b: website cookie session + CSRF (router integration; these paths short-circuit before Stripe/KV) ----

test('sow-158: a cookie POST to /membership/activity with NO CSRF is rejected (403 csrf check failed)', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const session = await signSession({ githubId: '42', githubLogin: 'gwen' }, env.SESSION_SECRET);
  const res = await worker.fetch(
    req('POST', '/membership/activity', { headers: { Cookie: 'gbti_session=' + session, Origin: 'https://gbti.test' }, body: '{}' }),
    env, {},
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).message, 'csrf check failed');
});

test('sow-158: POST /auth/logout 403s without CSRF and clears both cookies with a valid one', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const bad = await worker.fetch(req('POST', '/auth/logout', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(bad.status, 403);

  const ok = await worker.fetch(
    req('POST', '/auth/logout', { headers: { Cookie: 'gbti_csrf=T', 'X-GBTI-CSRF': 'T', Origin: 'https://gbti.test' } }),
    env, {},
  );
  assert.equal(ok.status, 200);
  const cleared = ok.headers.getSetCookie();
  assert.ok(cleared.some((c) => c.startsWith('gbti_session=') && /Max-Age=0/.test(c)), 'the session cookie is expired');
  assert.ok(cleared.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c)), 'the csrf cookie is expired');
});

// web-login fix: a user who first signed in before the fix carries BOTH a stale host-only gbti_csrf and the
// Domain=gbti.network one. The site echoes only the Domain value, which may sort second in the Cookie header;
// logout must still succeed (match-any) and must expire BOTH variants so the stale one stops colliding.
test('sow-158: logout succeeds with a stale+fresh gbti_csrf pair and clears host-only AND Domain csrf', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(
    req('POST', '/auth/logout', { headers: { Cookie: 'gbti_csrf=stale; gbti_csrf=fresh', 'X-GBTI-CSRF': 'fresh', Origin: 'https://gbti.test' } }),
    env, {},
  );
  assert.equal(res.status, 200, 'the echoed header matches the second (fresh) cookie -> not a 403');
  const cleared = res.headers.getSetCookie().filter((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c));
  assert.ok(cleared.some((c) => !/Domain=/.test(c)), 'a host-only csrf clear is emitted');
  assert.ok(cleared.some((c) => /Domain=gbti\.test/.test(c)), 'a Domain-scoped csrf clear is emitted');
});

test('sow-158: OPTIONS /membership/status reflects an allow-listed Origin with credentials, blocks others', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const ok = await worker.fetch(req('OPTIONS', '/membership/status', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test');
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');

  const blocked = await worker.fetch(req('OPTIONS', '/membership/status', { headers: { Origin: 'https://evil.example' } }), env, {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null);
});

// sow-158 auth bridge: mint the website cookie session from the extension's already-verified GitHub token, so one
// extension sign-in also signs the member into gbti.network. Bearer-authenticated; token -> own-session (no escalation).
test('sow-158: POST /auth/session-from-token mints the session + Domain-csrf cookies from a verified bearer', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  await withFetch(
    (url) => (url.includes('api.github.com/user') ? { status: 200, body: { id: 42, login: 'octocat' } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Authorization: 'Bearer good', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.4' } }), env, {});
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.equal(body.github_id, '42');
      assert.equal(body.login, 'octocat');
      assert.ok(!JSON.stringify(body).includes('good'), 'the token is never echoed back');
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.startsWith('gbti_session=') && /HttpOnly/.test(c) && !/Domain=/.test(c)), 'a host-only httpOnly session cookie is set');
      assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Domain=gbti\.test/.test(c) && !/HttpOnly/.test(c)), 'a readable Domain-scoped csrf cookie is set');
      assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', 'credentialed CORS reflects the allow-listed origin');
      assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
    },
  );
});

test('sow-158: /auth/session-from-token 401s with no bearer or an unverifiable token, minting no cookie', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const noAuth = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.headers.getSetCookie().length, 0);
  await withFetch(
    (url) => (url.includes('api.github.com/user') ? { status: 401, body: 'bad creds' } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('POST', '/auth/session-from-token', { headers: { Authorization: 'Bearer bad', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.5' } }), env, {});
      assert.equal(res.status, 401);
      assert.equal(res.headers.getSetCookie().length, 0, 'no session is minted on an unverifiable token');
    },
  );
});

// sow-158 auth bridge, sign-out counterpart: an extension sign-out expires the bridged website cookie session.
// Clearing cookies is capability-free, so it does NOT verify the token against GitHub (a signing-out token may be
// mid-revocation) -> it clears with any present bearer, and mirrors /auth/logout's dual host-only + Domain clear.
test('sow-158: POST /auth/session-clear expires the session + both csrf cookies with a present bearer', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(req('POST', '/auth/session-clear', { headers: { Authorization: 'Bearer anything', Origin: 'https://gbti.test', 'CF-Connecting-IP': '1.2.3.6' } }), env, {});
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  const cookies = res.headers.getSetCookie();
  assert.ok(cookies.some((c) => c.startsWith('gbti_session=') && /Max-Age=0/.test(c) && !/Domain=/.test(c)), 'host-only session cleared');
  assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c) && !/Domain=/.test(c)), 'host-only csrf cleared');
  assert.ok(cookies.some((c) => c.startsWith('gbti_csrf=') && /Max-Age=0/.test(c) && /Domain=gbti\.test/.test(c)), 'Domain csrf cleared');
  assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true');
});

test('sow-158: /auth/session-clear 401s with no bearer, clearing nothing', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test', COOKIE_DOMAIN: 'gbti.test' });
  const res = await worker.fetch(req('POST', '/auth/session-clear', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(res.status, 401);
  assert.equal(res.headers.getSetCookie().length, 0, 'no clear without a bearer');
});

// sow-158 News track: the news read + engagement routes are now cookie-readable (credentialed reflected-origin
// CORS), so the website /news mount can call them with the session cookie. news-publish stays bearer-only (curator).
test('sow-158 News: news routes reflect an allow-listed Origin with credentials; news-publish stays wildcard', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  for (const path of ['/membership/news', '/membership/news-categories', '/membership/news-sources', '/membership/news-opened', '/membership/news-discussed']) {
    const ok = await worker.fetch(req('OPTIONS', path, { headers: { Origin: 'https://gbti.test' } }), env, {});
    assert.equal(ok.status, 204, `${path} preflight`);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', `${path} reflects the origin`);
    assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true', `${path} allows credentials`);
    const blocked = await worker.fetch(req('OPTIONS', path, { headers: { Origin: 'https://evil.example' } }), env, {});
    assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, `${path} blocks a foreign origin`);
  }
  // news-publish is the curator (bearer-only) path: it keeps the wildcard MEMBERSHIP_CORS, never credentialed.
  const pub = await worker.fetch(req('OPTIONS', '/membership/news-publish', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.notEqual(pub.headers.get('Access-Control-Allow-Credentials'), 'true', 'news-publish must not be credentialed');
});

// sow-161 admin surface (read): the per-member Stripe status route is cookie-enabled (credentialed reflected-origin
// CORS) so the website admin dashboard reads it over the session; a foreign origin is not reflected.
test('sow-161: /membership/admin/statuses reflects an allow-listed Origin with credentials', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const ok = await worker.fetch(req('OPTIONS', '/membership/admin/statuses', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test');
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
  const blocked = await worker.fetch(req('OPTIONS', '/membership/admin/statuses', { headers: { Origin: 'https://evil.example' } }), env, {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, 'a foreign origin is blocked');
});

// sow-158 in-app browse reader: the content-open engagement beacon is cookie-enabled so the website /browse reader
// fires it over the session cookie (credentialed reflected-origin CORS), reflecting only an allow-listed origin.
test('sow-158: /membership/content-opened reflects an allow-listed Origin with credentials', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const ok = await worker.fetch(req('OPTIONS', '/membership/content-opened', { headers: { Origin: 'https://gbti.test' } }), env, {});
  assert.equal(ok.status, 204);
  assert.equal(ok.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test');
  assert.equal(ok.headers.get('Access-Control-Allow-Credentials'), 'true');
  const blocked = await worker.fetch(req('OPTIONS', '/membership/content-opened', { headers: { Origin: 'https://evil.example' } }), env, {});
  assert.equal(blocked.headers.get('Access-Control-Allow-Origin'), null, 'a foreign origin is blocked');
});

// ---- sow-158 Phase 2: website login return_to ----

test('sow-158 Phase 2: safeReturnTo allows a same-site path and rejects open-redirect attempts', () => {
  assert.equal(safeReturnTo('/account/'), '/account/');
  assert.equal(safeReturnTo('/articles/foo/?x=1#h'), '/articles/foo/?x=1#h');
  for (const bad of ['//evil.example', 'https://evil.example', '/\\evil', 'http:/evil', '', 'account', 'javascript:alert(1)', '/x\ty']) {
    assert.equal(safeReturnTo(bad), '', `must reject ${JSON.stringify(bad)}`);
  }
  assert.equal(safeReturnTo('/' + 'a'.repeat(600)), ''); // length cap
});

test('sow-158 Phase 2: return_to threads through the signed state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: true } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&return_to=%2Faccount%2F', { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal(res.status, 302);
      const state = new URL(res.headers.get('Location')).searchParams.get('state');
      assert.equal((await unpackState(state, env)).returnTo, '/account/');
    },
  );
});

test('sow-158 Phase 2: an open-redirect return_to is dropped from the state', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => (url.includes('siteverify') ? { status: 200, body: { success: true } } : { status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/start?cf-turnstile-response=tok&return_to=' + encodeURIComponent('//evil.example'), { headers: { 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal((await unpackState(new URL(res.headers.get('Location')).searchParams.get('state'), env)).returnTo, undefined);
    },
  );
});

test('sow-158 Phase 2: the github callback lands on SITE_BASE_URL + return_to when present', async () => {
  const env = fakeEnv();
  const startState = await packState({ ref: 'bob', nonce: 'n1', jti: 'jti-return-to', returnTo: '/account/' }, env);
  await withFetch(
    (url) => {
      if (url.includes('login/oauth/access_token')) return { status: 200, body: { access_token: 'gho_token' } };
      if (url.includes('api.github.com/user/emails')) return { status: 200, body: [{ email: 'o@example.com', primary: true, verified: true }] };
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 424242, login: 'octocat' } };
      if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [] } };
      if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: 'cus_new', metadata: {} } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', `/signup/github/callback?code=ghcode&state=${encodeURIComponent(startState)}`, { headers: { Cookie: 'gbti_oauth_nonce=n1', 'CF-Connecting-IP': '9.9.9.9' } }),
        env, {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account/');
      const cookies = res.headers.getSetCookie();
      assert.ok(cookies.some((c) => c.startsWith('gbti_session=')) && cookies.some((c) => c.startsWith('gbti_csrf=')), 'both cookies set');
    },
  );
});

test('SOW Part C: /discord/link/start with a session -> Discord OAuth carrying the verified github_id + a nonce', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '424242', githubLogin: 'octocat' }, env.SESSION_SECRET);
  const res = await worker.fetch(req('GET', '/discord/link/start', { headers: { Cookie: 'gbti_session=' + session } }), env, {});
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  assert.ok(location.startsWith('https://discord.com/api/oauth2/authorize'), 'redirects to Discord authorize');
  const state = await unpackState(new URL(location).searchParams.get('state'), env);
  assert.equal(state.githubId, '424242');
  assert.equal(state.link, true);
  assert.ok(state.nonce, 'carries a per-browser nonce');
  assert.match(res.headers.get('Set-Cookie') || '', new RegExp('gbti_oauth_nonce=' + state.nonce));
});

test('SOW Part C: /discord/link/start with NO session -> no Discord OAuth, lands on the welcome flow', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/discord/link/start'), env, {});
  assert.equal(res.status, 302);
  const loc = res.headers.get('Location') || '';
  assert.ok(loc.includes('/welcome/'), 'sow-207: lands on the website welcome flow');
  assert.ok(!loc.includes('discord.com'), 'never starts Discord OAuth without a verified identity');
});

test('SOW Part C: the Discord-link callback links discord_user_id + role to the EXISTING Customer (nonce-checked)', async () => {
  const env = fakeEnv({ DISCORD_INVITE_URL: 'https://discord.gg/test' });
  const startState = await packState({ githubId: '5', githubLogin: 'octocat', nonce: 'n1', link: true }, env);
  await withFetch(
    (url) => {
      if (url.includes('discord.com/api') && url.includes('oauth2/token')) return { status: 200, body: { access_token: 'dtok' } };
      if (url.includes('discord.com/api') && url.includes('users/@me')) return { status: 200, body: { id: 'd-99', email: 'd@e.com' } };
      if (url.includes('discord.com/api') && url.includes('guilds')) return { status: 204, body: '' };
      if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '5', trial_started_at: '2020-01-01T00:00:00.000Z' } }] } };
      if (url.includes('api.stripe.com/v1/customers')) return { status: 200, body: { id: 'cus_x' } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/signup/discord/callback?code=dcode&state=' + encodeURIComponent(startState), { headers: { Cookie: 'gbti_oauth_nonce=n1' } }),
        env, {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://discord.gg/test', 'redirects the member INTO Discord, not back to the site');
    },
  );
});

test('SOW: /discord/link/status reports the Customer Discord-link state, fail-closed', async () => {
  const env = fakeEnv();
  const linkedFetch = (url) => {
    if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777', discord_user_id: 'd-1' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(linkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Authorization: 'Bearer tok' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: true });
  });
  // No discord_user_id on the Customer -> not linked.
  const unlinkedFetch = (url) => {
    if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(unlinkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Authorization: 'Bearer tok' } }), env, {});
    assert.deepEqual(await res.json(), { linked: false });
  });
  // No bearer token -> fail closed to not-linked (never throws, never opens).
  const res = await worker.fetch(req('GET', '/discord/link/status'), env, {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { linked: false });
});

test('sow-207: /discord/link/status resolves the WEBSITE cookie session with credentialed CORS, fail-closed', async () => {
  const env = fakeEnv({ CORS_ALLOWED_ORIGINS: 'https://gbti.test' });
  const session = await signSession({ githubId: '777', githubLogin: 'octocat' }, env.SESSION_SECRET);
  // A cookie member whose Customer has a linked Discord -> { linked: true } + credentialed CORS for the site origin.
  const linkedFetch = (url) => {
    if (url.includes('api.stripe.com/v1/customers/search')) return { status: 200, body: { data: [{ id: 'cus_x', metadata: { github_id: '777', discord_user_id: 'd-1' } }] } };
    return { status: 200, body: '' };
  };
  await withFetch(linkedFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Cookie: 'gbti_session=' + session, Origin: 'https://gbti.test' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: true });
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://gbti.test', 'reflects the allow-listed site origin');
    assert.equal(res.headers.get('Access-Control-Allow-Credentials'), 'true', 'credentialed so the browser can read the cookie response');
  });
  // A forged/invalid session cookie -> fail closed to not-linked, and it must NOT reach Stripe.
  let stripeHit = false;
  const guardFetch = (url) => { if (url.includes('api.stripe.com')) stripeHit = true; return { status: 200, body: '' }; };
  await withFetch(guardFetch, async () => {
    const res = await worker.fetch(req('GET', '/discord/link/status', { headers: { Cookie: 'gbti_session=not-a-real-token', Origin: 'https://gbti.test' } }), env, {});
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { linked: false });
  });
  assert.equal(stripeHit, false, 'a forged session never triggers a Stripe lookup');
});

test('SOW Part C: the Discord-link callback REJECTS a state with no matching nonce cookie', async () => {
  const env = fakeEnv();
  const startState = await packState({ githubId: '5', githubLogin: 'octocat', nonce: 'n1', link: true }, env);
  const res = await worker.fetch(
    req('GET', '/signup/discord/callback?code=dcode&state=' + encodeURIComponent(startState), { headers: { Cookie: 'gbti_oauth_nonce=WRONG' } }),
    env, {},
  );
  assert.equal(res.status, 400);
});

test('SOW Part C: /discord/link/init verifies the GitHub token -> a SIGNED link URL carrying the verified github_id', async () => {
  const env = fakeEnv();
  await withFetch(
    (url) => {
      if (url.includes('api.github.com/user')) return { status: 200, body: { id: 777, login: 'octocat' } };
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(req('GET', '/discord/link/init', { headers: { Authorization: 'Bearer gho_tok' } }), env, {});
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.url.includes('/discord/link/start?lt='));
      const lt = new URL(data.url).searchParams.get('lt');
      const tok = await unpackState(lt, env);
      assert.equal(tok.githubId, '777', 'the github_id is the SERVER-verified one (from the token), not user input');
      assert.equal(tok.linkInit, true);
    },
  );
});

test('SOW Part C: /discord/link/init rejects a missing token (401)', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/discord/link/init'), env, {});
  assert.equal(res.status, 401);
});

test('SOW Part C: /discord/link/start with a link token starts Discord OAuth (no website session needed)', async () => {
  const env = fakeEnv();
  const lt = await packState({ githubId: '777', githubLogin: 'octocat', linkInit: true, jti: 'jti-ok' }, env);
  const res = await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {});
  assert.equal(res.status, 302);
  const location = res.headers.get('Location');
  assert.ok(location.startsWith('https://discord.com/api/oauth2/authorize'), 'starts Discord OAuth from the token (no session)');
  const state = await unpackState(new URL(location).searchParams.get('state'), env);
  assert.equal(state.githubId, '777');
  assert.equal(state.link, true);
  assert.ok(state.nonce);
});

test('SOW Part C: a REPLAYED link token (same jti, second use) is rejected -> no Discord OAuth (hijack defense)', async () => {
  const env = fakeEnv();
  const lt = await packState({ githubId: '777', githubLogin: 'octocat', linkInit: true, jti: 'jti-replay' }, env);
  await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {}); // first use consumes the jti
  const res2 = await worker.fetch(req('GET', '/discord/link/start?lt=' + encodeURIComponent(lt)), env, {});
  assert.equal(res2.status, 302);
  const loc = res2.headers.get('Location') || '';
  assert.ok(loc.includes('/welcome/'), 'sow-207: a replayed lt lands on the website welcome flow, not Discord');
  assert.ok(!loc.includes('discord.com'), 'a replayed lt never starts Discord OAuth');
});

test('GET /signup/github/callback rejects a forged/unsigned state with 400', async () => {
  const env = fakeEnv();
  await withFetch(
    () => ({ status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(req('GET', '/signup/github/callback?code=ghcode&state=not-a-valid-token'), env, {});
      assert.equal(res.status, 400);
    },
  );
});

test('POST /webhook with a bad signature returns 400 (fail closed)', async () => {
  const env = fakeEnv();
  await withFetch(
    () => ({ status: 200, body: '' }),
    async () => {
      const res = await worker.fetch(
        req('POST', '/webhook', {
          headers: { 'Stripe-Signature': 't=1,v1=deadbeef' },
          body: JSON.stringify({ id: 'evt_1', type: 'invoice.payment_succeeded' }),
        }),
        env,
        {},
      );
      assert.equal(res.status, 400);
    },
  );
});

test('GET /checkout/success with a matching session kicks regate and redirects to /account', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '424242', githubLogin: 'octocat' }, SECRET);
  let dispatched = null;
  await withFetch(
    (url, opts) => {
      if (url.includes('/dispatches')) {
        dispatched = JSON.parse(opts.body);
        return { status: 204 }; // GitHub repository_dispatch accepted
      }
      return { status: 200, body: '' };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/checkout/success?gh=424242&session_id=cs_test', {
          headers: { Cookie: sessionCookieHeader(session) },
        }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.ok(dispatched, 'a repository_dispatch was kicked');
      assert.equal(dispatched.event_type, 'regate');
      assert.equal(dispatched.client_payload.github_id, '424242');
    },
  );
});

test('GET /checkout/success without a session redirects to /account but does NOT kick regate (fail closed)', async () => {
  const env = fakeEnv();
  let dispatched = false;
  await withFetch(
    (url) => {
      if (url.includes('/dispatches')) dispatched = true;
      return { status: 204 };
    },
    async () => {
      const res = await worker.fetch(req('GET', '/checkout/success?gh=424242'), env, {});
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.equal(dispatched, false, 'no re-gate without a valid session');
    },
  );
});

test('GET /checkout/success with a session that does not match gh does NOT kick regate (fail closed)', async () => {
  const env = fakeEnv();
  const session = await signSession({ githubId: '111', githubLogin: 'someone' }, SECRET);
  let dispatched = false;
  await withFetch(
    (url) => {
      if (url.includes('/dispatches')) dispatched = true;
      return { status: 204 };
    },
    async () => {
      const res = await worker.fetch(
        req('GET', '/checkout/success?gh=424242', { headers: { Cookie: sessionCookieHeader(session) } }),
        env,
        {},
      );
      assert.equal(res.status, 302);
      assert.equal(res.headers.get('Location'), 'https://gbti.test/account');
      assert.equal(dispatched, false, 'gh must equal the session github_id to nudge');
    },
  );
});

test('unknown route returns 404', async () => {
  const env = fakeEnv();
  const res = await worker.fetch(req('GET', '/nope'), env, {});
  assert.equal(res.status, 404);
});

// ---------------------------------------------------------------------------
// packState / unpackState round-trip + tamper rejection (FIX 5 + FIX 4 CSRF control)
// ---------------------------------------------------------------------------

test('packState/unpackState round-trips the payload and rejects tampering', async () => {
  const env = { SESSION_SECRET: SECRET };
  const token = await packState({ ref: 'carol', githubId: '999', githubLogin: 'carol-dev' }, env);
  const unpacked = await unpackState(token, env);
  assert.ok(unpacked);
  assert.equal(unpacked.ref, 'carol');
  assert.equal(unpacked.githubId, '999');
  assert.equal(unpacked.githubLogin, 'carol-dev');

  // Tamper with the signed body: flip a character in the first segment, keep the signature.
  const [body, sig] = token.split('.');
  const flipped = (body[0] === 'A' ? 'B' : 'A') + body.slice(1);
  assert.equal(await unpackState(`${flipped}.${sig}`, env), null, 'tampered body must be rejected');

  // A wrong secret must also reject (the HMAC signature is the CSRF control).
  assert.equal(await unpackState(token, { SESSION_SECRET: 'a-different-secret' }), null);

  // Garbage and empty tokens fail closed.
  assert.equal(await unpackState('garbage', env), null);
  assert.equal(await unpackState('', env), null);
});

// ---------------------------------------------------------------------------
// Webhook dedupe split (FIX 2) and renewal no-op (FIX 3)
// ---------------------------------------------------------------------------

/** Fake Discord client capturing role mutations for the webhook handler tests. */
function fakeRoleDiscord() {
  const calls = { addRole: [], removeRole: [] };
  return {
    calls,
    async addRole(guildId, userId, roleId) {
      calls.addRole.push({ guildId, userId, roleId });
    },
    async removeRole(guildId, userId, roleId) {
      calls.removeRole.push({ guildId, userId, roleId });
    },
  };
}

/** Fake Stripe client returning a fixed customer for getCustomer (the webhook reverse lookup). */
function fakeWebhookStripe(metadata) {
  return {
    async getCustomer() {
      return { id: 'cus_x', metadata };
    },
  };
}

const WEBHOOK_CONFIG = { guildId: 'guild-1', trialRoleId: 'role-trial', memberRoleId: 'role-member' };

test('isDuplicateEvent only READS (does not mark); markEventSeen persists separately (FIX 2)', async () => {
  const kv = fakeKv();
  // First check: not seen yet, and crucially NOT marked by the read.
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), false);
  assert.equal(kv.store.has('evt:evt_42'), false, 'isDuplicateEvent must not write a seen-mark');
  // A second check still reports not-seen (a transient handler failure can safely re-process).
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), false);
  // Only after the handler succeeds do we mark it; subsequent checks then report duplicate.
  assert.equal(await markEventSeen({ kv, eventId: 'evt_42' }), true);
  assert.equal(kv.store.get('evt:evt_42'), '1');
  assert.equal(await isDuplicateEvent({ kv, eventId: 'evt_42' }), true);
});

test('handleStripeEvent upgrades on the FIRST invoice (billing_reason subscription_create)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } },
    },
    stripe,
    discord,
    config: WEBHOOK_CONFIG,
  });
  assert.match(summary, /upgraded/);
  assert.deepEqual(discord.calls.addRole[0], { guildId: 'guild-1', userId: 'd-1', roleId: 'role-member' });
  assert.deepEqual(discord.calls.removeRole[0], { guildId: 'guild-1', userId: 'd-1', roleId: 'role-trial' });
});

test('SOW-059 P1c-B: handleStripeEvent fires onConversion on the FIRST invoice with paid_at as conversionAt', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5', touch_session: 'x' });
  const seen = [];
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded', created: 1700,
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_create', status_transitions: { paid_at: 1500 } } },
    },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async (a) => { seen.push(a); },
  });
  assert.match(summary, /upgraded/);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].githubId, '5');
  assert.equal(seen[0].conversionAt, 1500 * 1000); // paid_at (ms), not event.created, not now
  assert.equal(seen[0].customer.metadata.touch_session, 'x');
  // the role swap still happened
  assert.equal(discord.calls.addRole.length, 1);
});

test('SOW-059 P1c-B: a throwing onConversion is fail-soft (role swap still happens, webhook does not fail)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', created: 1700, data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async () => { throw new Error('kv down'); },
  });
  assert.match(summary, /upgraded/); // did not throw; the conversion freeze never blocks the swap
  assert.equal(discord.calls.addRole[0].roleId, 'role-member');
});

test('SOW: a GitHub-only conversion (no discord_user_id) STILL freezes the SOW-059 snapshot; no role swap', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ github_id: '5' }); // GitHub-only member: no Discord linked yet
  let frozen = null;
  const summary = await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', created: 1700, data: { object: { customer: 'cus_x', billing_reason: 'subscription_create' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async ({ githubId }) => { frozen = githubId; },
  });
  assert.equal(frozen, '5', 'the freeze fires for a GitHub-only member -> referral attribution is NOT lost');
  assert.equal(discord.calls.addRole.length, 0, 'no role swap without a linked Discord');
  assert.equal(discord.calls.removeRole.length, 0);
  assert.match(summary, /frozen/);
});

test('SOW-059 P1c-B: onConversion does NOT fire on a renewal (only the first invoice freezes)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  let fired = false;
  await handleStripeEvent({
    event: { type: 'invoice.payment_succeeded', data: { object: { customer: 'cus_x', billing_reason: 'subscription_cycle' } } },
    stripe, discord, config: WEBHOOK_CONFIG,
    onConversion: async () => { fired = true; },
  });
  assert.equal(fired, false);
});

test('handleStripeEvent is a no-op on annual RENEWAL invoices (FIX 3)', async () => {
  const discord = fakeRoleDiscord();
  const stripe = fakeWebhookStripe({ discord_user_id: 'd-1', github_id: '5' });
  const summary = await handleStripeEvent({
    event: {
      type: 'invoice.payment_succeeded',
      data: { object: { customer: 'cus_x', billing_reason: 'subscription_cycle' } },
    },
    stripe,
    discord,
    config: WEBHOOK_CONFIG,
  });
  assert.match(summary, /renewal/);
  assert.equal(discord.calls.addRole.length, 0, 'no role swap on renewal');
  assert.equal(discord.calls.removeRole.length, 0, 'no role swap on renewal');
});

// SOW: POST /auth/refresh — the secretless token-refresh endpoint. The extension sends only its rotating
// refresh_token; the Worker adds the App client_id+secret and returns fresh tokens. githubRefreshToken (oauth.mjs)
// uses globalThis.fetch, so we stub it for the GitHub round-trip.
import { githubRefreshToken } from '../workers/signup/oauth.mjs';

function refreshReq(body) {
  return new Request('https://signup.gbti.network/auth/refresh', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}
const REFRESH_ENV = { GITHUB_PUBLISHER_CLIENT_ID: 'Iv1.app', GITHUB_PUBLISHER_CLIENT_SECRET: 'sec' };

test('githubRefreshToken: posts grant_type=refresh_token and maps the rotated response', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: opts.body }; return { ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 }) }; };
  const r = await githubRefreshToken({ clientId: 'Iv1.app', clientSecret: 'sec', refreshToken: 'ghr_old' }, fetchImpl);
  assert.match(sent.url, /login\/oauth\/access_token/);
  assert.match(sent.body, /grant_type=refresh_token/);
  assert.match(sent.body, /refresh_token=ghr_old/);
  assert.deepEqual(r, { accessToken: 'gho_new', refreshToken: 'ghr_new', expiresIn: 28800, refreshTokenExpiresIn: 15897600 });
});

test('POST /auth/refresh: returns fresh tokens on success', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ access_token: 'gho_new', refresh_token: 'ghr_new', expires_in: 28800, refresh_token_expires_in: 15897600 }) });
  try {
    const res = await worker.fetch(refreshReq({ refresh_token: 'ghr_old' }), REFRESH_ENV, {});
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.access_token, 'gho_new');
    assert.equal(body.refresh_token, 'ghr_new');
    assert.equal(body.expires_in, 28800);
  } finally { globalThis.fetch = realFetch; }
});

test('POST /auth/refresh: 501 when the App secret is not configured', async () => {
  const res = await worker.fetch(refreshReq({ refresh_token: 'x' }), { GITHUB_PUBLISHER_CLIENT_ID: 'Iv1.app' }, {});
  assert.equal(res.status, 501);
});

test('POST /auth/refresh: 400 without a refresh_token', async () => {
  const res = await worker.fetch(refreshReq({}), REFRESH_ENV, {});
  assert.equal(res.status, 400);
});

test('POST /auth/refresh: 401 when GitHub rejects the refresh token (expired/revoked)', async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ error: 'bad_refresh_token' }) });
  try {
    const res = await worker.fetch(refreshReq({ refresh_token: 'dead' }), REFRESH_ENV, {});
    assert.equal(res.status, 401);
  } finally { globalThis.fetch = realFetch; }
});

// --- sow-218: signup resolves the Discord role instead of hardcoding one -----------------------------------
//
// Two earlier versions of this handed ONE fixed role to everybody (first trial, then locked), which is right for
// exactly one kind of member and wrong for every other, with reconcile correcting it only on its next DAILY run.
// These pin the resolution, and in particular the two directions that must never swap: a banned member whose
// Stripe still says paid gets NOTHING, and an unreadable mirror withholds rather than grants.

const NOW = new Date('2026-08-11T12:00:00.000Z');
const mirrorKv = (mirror) => ({ get: async (k, t) => (k === 'overrides:mirror' ? mirror : null), put: async () => {} });
const freshMirror = (over = {}) => ({
  generatedAt: NOW.toISOString(), bans: { bans: [] }, roles: { roles: [] }, grandfathered: { grandfathered: [] }, ...over,
});
const paidCustomer = { id: 'cus_1', metadata: { github_id: '12345' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_x' } }] } }] } };

test('sow-185: a LIVE TIERLESS coupon grant resolves to member and NO creator badge', async () => {
  // The invitee case. The grant is authoritative here precisely because house/grandfathered.yml does not carry
  // it yet: reconcile folds it AFTER computing roles, so waiting for the mirror meant up to two daily cycles.
  //
  // CHANGED BY THE OWNER RULING 2026-08-24: "coupons ... should only offer membership rather than creator".
  // This test asserted `creator: true` under sow-218, when the invite promised Content Creator for a year.
  // It is now WRONG rather than broken, so it is rewritten rather than deleted: the access half of the claim
  // still needs a guard, and deleting it would quietly shrink coverage by one while looking like a fix.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false });
});

test('sow-218: an EXPIRED coupon grant grants nothing', async () => {
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2020-01-01T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false });
});

test('sow-218: a paying subscriber linking Discord gets the MEMBER role, not locked', async () => {
  const r = await resolveSignupRole({ kv: mirrorKv(freshMirror()), githubId: '12345', customer: paidCustomer, now: NOW });
  assert.equal(r.access, 'member');
});

test('sow-218: a BANNED member gets locked and NO badge, even holding a live coupon', async () => {
  // A ban outranks a coupon everywhere else, so it must here too: otherwise a banned account buys its way back
  // in with an invite code. Checked BEFORE the coupon is honoured.
  const mirror = freshMirror({ bans: { bans: [{ github_id: '12345', reason: 'test' }] } });
  const r = await resolveSignupRole({
    kv: mirrorKv(mirror), githubId: '12345', customer: paidCustomer,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false });
});

test('sow-218: a grandfathered member with NO Stripe subscription still gets the member role', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } });
  const r = await resolveSignupRole({ kv: mirrorKv(mirror), githubId: '12345', customer: null, now: NOW });
  assert.equal(r.access, 'member');
});

test('sow-218: a STALE, absent or unreadable mirror withholds the grant', async () => {
  const stale = freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' }); // older than the 48h bound
  assert.equal((await resolveSignupRole({ kv: mirrorKv(stale), githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  assert.equal((await resolveSignupRole({ kv: mirrorKv(null), githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  const throwingKv = { get: async () => { throw new Error('kv down'); } };
  assert.equal((await resolveSignupRole({ kv: throwingKv, githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
  assert.equal((await resolveSignupRole({ kv: null, githubId: '12345', customer: paidCustomer, now: NOW })).access, 'locked');
});

test('sow-218: an EXISTING coupon grant is read from KV, not just one redeemed in this run', async () => {
  // The bug the owner caught in the live guild. A member who redeemed weeks ago and links Discord later sends
  // NO coupon code, so couponGrant is null. Reading only the in-run value made the account fall through to the
  // Stripe derivation, where a stale trial_started_at from before the trial retirement derived `trialing` and
  // handed a Codeable invitee the retired Applicant role instead of Member plus Creator.
  const withGrant = {
    get: async (k) => (k === 'overrides:mirror' ? freshMirror()
      : k === 'coupon-grant:12345' ? { code: 'CODEABLEYEAR', until: '2027-08-11T00:00:00.000Z' } : null),
    put: async () => {},
  };
  const trialCustomer = { id: 'cus_old', metadata: { github_id: '12345', trial_started_at: '2026-07-01T00:00:00.000Z' } };
  const r = await resolveSignupRole({ kv: withGrant, githubId: '12345', customer: trialCustomer, couponGrant: null, now: NOW });
  // `creator: false` since the 2026-08-24 ruling. The ACCESS half is what this test is really about, and it
  // is unchanged: the stored grant still outranks a stale trial clock. Only the badge moved.
  assert.deepEqual(r, { access: 'member', creator: false }, 'the stored grant outranks a stale trial clock');
});

test('sow-218: without a grant, a stale trial clock still resolves to the trial role', async () => {
  // The other half of the same behaviour, so the fix above is not just "always return member". A genuine
  // mid-trial member keeps the trial role until their clock runs out.
  const trialCustomer = { id: 'cus_old', metadata: { github_id: '12345', trial_started_at: '2026-07-01T00:00:00.000Z' } };
  const r = await resolveSignupRole({ kv: mirrorKv(freshMirror()), githubId: '12345', customer: trialCustomer, now: NOW });
  assert.equal(r.access, 'trial');
  assert.equal(r.creator, false);
});

test('sow-218: a coupon invitee is still admitted when the mirror is unavailable', async () => {
  // The grant lives in KV and needs no mirror to be true. Denying an invitee because an unrelated blob went
  // stale would recreate the lockout this whole change exists to remove.
  //
  // The badge is now `false` for a tierless grant (ruling 2026-08-24), but ADMISSION is the point of this
  // test and must not move: an unavailable mirror may cost an invitee a badge they were never promised, and
  // must never cost them access.
  const r = await resolveSignupRole({
    kv: mirrorKv(null), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false });
});

// --- sow-185 (2026-08-24): a coupon confers its OWN tier, and the badge raises but never lowers ----------

test('sow-185 TDZ REGRESSION: a live coupon NEVER resolves to locked, on any mirror path', async () => {
  // THE BUG THIS EXISTS TO CATCH IS NOT A WRONG TIER, IT IS A SILENT LOCKOUT OF EVERY INVITEE.
  //
  // `resolveSignupRole` had a `const grant` at the foot of its try block shadowing the outer `let grant`.
  // Any read of `grant` earlier in that try throws a temporal dead zone ReferenceError, and the catch turns
  // ANY throw into `{ access: 'locked', creator: false }`. So the failure does not crash and does not log an
  // error: it presents as a policy decision. Every Codeable invitee is refused, and the refusal looks
  // deliberate. A verifier reproduced exactly that by executing the naive patch.
  //
  // Asserted as a PROPERTY over every path rather than at one input, because the shadow bites wherever the
  // outer binding is read, and which of these branches reads it first is an implementation detail that will
  // move. A single-input version of this test would go quiet the moment the code was reorganised.
  const live = { until: '2027-08-11T00:00:00.000Z' };
  const paths = [
    ['a present mirror', mirrorKv(freshMirror())],
    ['an absent mirror', mirrorKv(null)],
    ['a stale mirror', mirrorKv(freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' }))],
    ['a mirror carrying a grandfather entry', mirrorKv(freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } }))],
    ['a mirror carrying a staff entry', mirrorKv(freshMirror({ roles: { superadmins: [{ github_id: '12345' }] } }))],
  ];
  for (const [label, kv] of paths) {
    const r = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: live, now: NOW });
    assert.equal(r.access, 'member', `a live coupon must admit the invitee with ${label}`);
  }
});

test('sow-185: a MEMBER-tier coupon confers no creator badge', async () => {
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'member' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: false });
});

test('sow-185: an EXPLICIT creator-tier coupon still confers the badge', async () => {
  // The ruling moved the DEFAULT, it did not remove the capability. A campaign that really does sell the top
  // tier says so on its own record, and must still deliver it, or the ruling silently becomes "no coupon can
  // ever grant creator" and a future creator campaign fails with no error.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'creator' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: true });
});

test('sow-185: a STAFF member holding a member-tier coupon KEEPS the creator badge', async () => {
  // THE BADGE RAISES, IT NEVER LOWERS, and this is the case where getting it wrong does real damage rather
  // than merely showing the wrong label. `creator: false` calls removeRole, so a naive "the coupon decides
  // the tier" fix STRIPS a Discord badge that was granted by hand, from a superadmin, the moment they link
  // Discord while holding any member-tier coupon. The coupon deliberately no longer short-circuits ahead of
  // the role read for this reason.
  const mirror = freshMirror({ roles: { superadmins: [{ github_id: '12345' }] } });
  const r = await resolveSignupRole({
    kv: mirrorKv(mirror), githubId: '12345', customer: null,
    couponGrant: { until: '2027-08-11T00:00:00.000Z', tier: 'member' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'member', creator: true }, 'staff resolves to creator and the coupon must not lower it');
});

test('sow-185: a hand-set creator GRANDFATHER keeps the badge while holding a member coupon', async () => {
  // The second lowering case, and the one the escape hatch exists for. An entry carrying an explicit
  // `tier: creator` is somebody a human decided should keep full access; a member-tier coupon must not undo
  // that decision. The tierless entry beside it is the control: it resolves to member and gets no badge, so
  // this test would fail if the code simply returned creator for every grandfather.
  const withCreator = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp', tier: 'creator' }] } });
  const memberCoupon = { until: '2027-08-11T00:00:00.000Z', tier: 'member' };
  const kept = await resolveSignupRole({ kv: mirrorKv(withCreator), githubId: '12345', customer: null, couponGrant: memberCoupon, now: NOW });
  assert.deepEqual(kept, { access: 'member', creator: true });

  const tierless = freshMirror({ grandfathered: { grandfathered: [{ github_id: '12345', reason: 'comp' }] } });
  const plain = await resolveSignupRole({ kv: mirrorKv(tierless), githubId: '12345', customer: null, couponGrant: memberCoupon, now: NOW });
  assert.deepEqual(plain, { access: 'member', creator: false }, 'a tierless grandfather is member, so no badge');
});

test('sow-185: an absent or stale mirror reports the COUPON tier, not a hardcoded true', async () => {
  // These three branches each returned `creator: couponLive`, which was `true` for any live coupon whatever
  // its tier. They now read the coupon's own tier. Both directions are asserted on both branches, because a
  // fix applied to one branch and missed on the other is the likeliest way this half-lands.
  const member = { until: '2027-08-11T00:00:00.000Z', tier: 'member' };
  const creator = { until: '2027-08-11T00:00:00.000Z', tier: 'creator' };
  const stale = freshMirror({ generatedAt: '2026-08-01T00:00:00.000Z' });
  for (const [label, kv] of [['absent', mirrorKv(null)], ['stale', mirrorKv(stale)]]) {
    const m = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: member, now: NOW });
    assert.deepEqual(m, { access: 'member', creator: false }, `a member coupon gets no badge with a ${label} mirror`);
    const c = await resolveSignupRole({ kv, githubId: '12345', customer: null, couponGrant: creator, now: NOW });
    assert.deepEqual(c, { access: 'member', creator: true }, `a creator coupon keeps its badge with a ${label} mirror`);
  }
});

test('sow-185: an EXPIRED creator-tier coupon leaks no badge', async () => {
  // redeemCoupon returns an existing grant even when it has lapsed (`already: true`), so the tier read is
  // gated on couponLive. Without that gate a member whose creator year ran out keeps the badge forever.
  const r = await resolveSignupRole({
    kv: mirrorKv(freshMirror()), githubId: '12345', customer: null,
    couponGrant: { until: '2020-01-01T00:00:00.000Z', tier: 'creator' }, now: NOW,
  });
  assert.deepEqual(r, { access: 'locked', creator: false });
});

test('sow-218: runSignup ASSIGNS the resolved role, not a hardcoded one', async () => {
  const discord = fakeDiscord();
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.equal(result.discordLinked, true);
  assert.deepEqual(discord.calls.addRole, [{ guildId: 'guild-1', userId: 'd-987', roleId: 'role-member' }], 'a paying member gets @Member');
  // The join `roles` and the explicit addRole must stay symmetric: Discord ignores the join roles for a user
  // already in the guild, so the pair is what makes this work for both new and returning members.
  assert.deepEqual(discord.calls.addGuildMember[0].opts.roles, ['role-member'], 'and the join carries the same role');
});

test('sow-218: signup SWAPS roles, so a stale one cannot accumulate', async () => {
  // The bug the owner caught in the live guild: the test account held Applicant AND Locked at once, because
  // signup only ever ADDED. The trial role came from its first signup, Locked from a later Discord link, and
  // nothing removed either. Only the daily reconcile swapped, so linking twice stacked roles until then.
  const discord = fakeDiscord();
  const CFG = { ...CONFIG, creatorRoleId: 'r-creator' };
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CFG, now: NOW,
  });
  const added = discord.calls.addRole.map((c) => c.roleId);
  const removed = discord.calls.removeRole.map((c) => c.roleId).sort();
  assert.ok(added.includes('role-member'), 'the target access role is added');
  assert.deepEqual(removed.filter((r) => r !== 'r-creator'), ['role-locked', 'role-trial'], 'BOTH other access roles are stripped');
  assert.ok(!removed.includes('role-member'), 'and never the role just granted');
});

test('sow-218: a coupon invitee is badged Content Creator at link time, not a reconcile later', async () => {
  const discord = fakeDiscord();
  const CFG = { ...CONFIG, creatorRoleId: 'r-creator' };
  const kv = { get: async (k) => (k === 'overrides:mirror' ? freshMirror() : null), put: async () => {} };
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: null, created: { id: 'cus_new' } }), discord, kv,
    config: CFG, coupon: 'CODEABLEYEAR', now: NOW,
  });
  // No coupon config is mirrored in this fixture, so redeemCoupon returns null and the member resolves from
  // Stripe alone: the badge must then be REMOVED rather than granted. Fail-closed, and it proves the axis is
  // driven by the resolution rather than by the mere presence of a coupon parameter.
  assert.ok(discord.calls.removeRole.some((c) => c.roleId === 'r-creator'), 'no live grant -> no badge');
});

test('sow-218: the Creator badge is INERT until the role id is provisioned', async () => {
  const discord = fakeDiscord();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW, // CONFIG has no creatorRoleId
  });
  const touched = [...discord.calls.addRole, ...discord.calls.removeRole].map((c) => c.roleId);
  assert.ok(!touched.includes(undefined), 'never sends an undefined role id');
  assert.ok(!touched.includes('r-creator'));
});

// ---------------------------------------------------------------------------
// The guild calls are guarded: a transient Discord error must not discard a completed signup
//
// The incident these encode: a live member's Discord link returned `internal_error`, and their unchanged
// retry succeeded. Every durable write (Customer, discord_user_id, coupon redemption) had already landed;
// only the guild call failed, and throwing there threw the whole thing away.
// ---------------------------------------------------------------------------

// A Discord double that fails whichever calls it is told to, the way the real client does (DiscordError
// carries a numeric `.status`), so the guard is tested against the error SHAPE it will actually meet.
function failingDiscord(failing = [], status = 500) {
  const calls = { addGuildMember: [], addRole: [], removeRole: [] };
  const maybeThrow = (name) => {
    if (!failing.includes(name)) return;
    const err = new Error(`discord error ${status}: upstream hiccup`);
    err.status = status;
    throw err;
  };
  return {
    calls,
    async addGuildMember(guildId, userId, opts) { calls.addGuildMember.push({ guildId, userId, opts }); maybeThrow('addGuildMember'); return null; },
    async addRole(guildId, userId, roleId) { calls.addRole.push({ guildId, userId, roleId }); maybeThrow('addRole'); return null; },
    async removeRole(guildId, userId, roleId) { calls.removeRole.push({ guildId, userId, roleId }); maybeThrow('removeRole'); return null; },
  };
}

test('a failing guild JOIN no longer throws away a completed signup', async () => {
  const discord = failingDiscord(['addGuildMember']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  // The whole point: the call still returns, and it returns the REAL customer, because that half succeeded.
  assert.equal(result.customerId, 'cus_1');
  assert.equal(result.discordOutcome.joined, false, 'and it says plainly that the join did not happen');
});

test('a failing guild join does not stop the role assignment or the stale-role strip', async () => {
  // The failure mode a bare try/catch around the whole block would have introduced. addGuildMember is only
  // needed for a member who is not in the guild YET; for one already there it 204s. So a join error must not
  // skip the role work, or a returning member whose join errors silently keeps whatever role they had.
  const discord = failingDiscord(['addGuildMember']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(discord.calls.addRole.map((c) => c.roleId), ['role-member'], 'the role is still assigned');
  assert.deepEqual(discord.calls.removeRole.map((c) => c.roleId).sort(), ['role-locked', 'role-trial'], 'and the stale roles are still stripped');
  assert.equal(result.discordOutcome.roleAssigned, true);
});

test('a failing role assignment is reported separately from the join', async () => {
  const discord = failingDiscord(['addRole']);
  const result = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord,
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(result.discordOutcome, { joined: true, roleAssigned: false, role: 'member' });
});

test('each guild failure logs WHICH call failed, with its status', async () => {
  // The hour the incident cost was spent not knowing which of the two calls produced the 500, because this
  // file logged nothing at all. A guard that only swallows would have made that permanent.
  wlog.clear();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: failingDiscord(['addGuildMember'], 502),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  const [entry] = wlog.recent().filter((e) => e.area === 'signup');
  assert.equal(entry.msg, 'discord addGuildMember failed', 'the message names the call');
  assert.equal(entry.data.status, 502, 'and carries the upstream status');
  assert.equal(entry.data.githubId, '12345', 'and says who it happened to');

  wlog.clear();
  await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: failingDiscord(['addRole'], 403),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  const [roleEntry] = wlog.recent().filter((e) => e.area === 'signup');
  assert.equal(roleEntry.msg, 'discord addRole failed');
  assert.equal(roleEntry.data.access, 'member', 'and which role it was trying to grant');
});

test('a clean link reports both halves done, and a GitHub-only signup reports nothing attempted', async () => {
  // `discordOutcome` is null rather than false for the GitHub-only path on purpose: "never attempted" and
  // "attempted and failed" are different facts, and reading both as falsy is how the first one hides.
  const ok = await runSignup({
    identity: IDENTITY, stripe: fakeStripe({ searchHit: paidCustomer }), discord: fakeDiscord(),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.deepEqual(ok.discordOutcome, { joined: true, roleAssigned: true, role: 'member' });

  const githubOnly = await runSignup({
    identity: { ...IDENTITY, discordUserId: null, discordAccessToken: null },
    stripe: fakeStripe({ searchHit: paidCustomer }), discord: fakeDiscord(),
    kv: mirrorKv(freshMirror()), config: CONFIG, now: NOW,
  });
  assert.equal(githubOnly.discordLinked, false);
  assert.equal(githubOnly.discordOutcome, null);
});
