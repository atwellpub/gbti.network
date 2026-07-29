// SOW-058: the cron drain. Fake KV + fake adapters; injected now. Hold enforcement, per-channel idempotency,
// cancel-vs-drain, retry-then-fail, skip-on-missing-secret. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, getItem, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const at = (t) => () => t;
const AFTER_HOLD = 4 * 60 * 60_000;
// SOW-125: turn every ENABLED channel `on` for every type in the auto-share matrix, so the mechanics tests
// below (which enqueue a 'share') behave as before the per-type matrix landed. The matrix-gating tests set
// their own matrix explicitly.
function allOn(channels) {
  const row = {}; for (const [k, v] of Object.entries(channels)) if (v) row[k] = 'on';
  return { share: { ...row }, post: { ...row }, product: { ...row }, prompt: { ...row } };
}
// The mechanics tests below exercise the legacy auto-hold path (require_approval:false); the approval-model gate
// (the default) is covered by the dedicated block at the end.
const cfg = (channels) => JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels, auto_matrix: allOn(channels) } });
const env = (extra = {}) => ({ DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'c', ...extra });

function discordOk(calls) {
  return { discord: { name: 'discord', enabled: () => true, post: async (i) => { calls.push(i.id); return { ok: true, id: 'm1', url: 'u' }; } } };
}

test('drain posts a due item to the ready channel and marks it sent', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent');
  assert.equal(item.perChannel.discord.status, 'sent');
});

test('drain respects the hold (a not-yet-due item is not posted)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(1000), adapters: discordOk(calls) });
  assert.equal(out.drained, 0);
  assert.equal(calls.length, 0);
});

test('drain is disabled when the config master switch is off', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: false, channels: { discord: true } } }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x' }, { kv, now: at(0), cfg: { enabled: true, hold_minutes: 60 } });
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  assert.equal(out.reason, 'disabled');
});

test('drain honors a cancel landing before the tick (cancelled item is skipped)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  // simulate a cancel: flip the stored item to cancelled
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, status: 'cancelled' }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0);
  assert.equal(out.drained, 0);
});

test('drain never re-posts a channel already marked sent (per-channel idempotency)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, perChannel: { discord: { status: 'sent', id: 'old' } } }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0, 'discord not called again');
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

test('drain retries a failed channel, then marks failed after maxAttempts', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  const failing = { discord: { name: 'discord', enabled: () => true, post: async () => ({ ok: false, error: '500' }) } };
  // attempt 1: stays pending for retry
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: failing, maxAttempts: 2 });
  let item = await getItem(kv, r.id);
  assert.equal(item.status, 'pending');
  assert.equal(item.attempts, 1);
  assert.equal(item.claimedAt, null); // claim cleared so it can be retried
  // attempt 2: reaches the cap -> failed
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: failing, maxAttempts: 2 });
  item = await getItem(kv, r.id);
  assert.equal(item.status, 'failed');
});

test('a config-enabled AUTO channel with no secret is recorded skipped, not failed', async () => {
  // SOW-125 / sow-159: use bluesky (an AUTO channel) with no secret; x would be hard-excluded (manual), never
  // "skipped". (mastodon was the original fixture here; it is retired, so bluesky stands in.)
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true, bluesky: true }) }); // bluesky enabled but no secret in env
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com' }, { kv, now: at(0) });
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.bluesky.status, 'skipped');
  assert.equal(item.status, 'sent'); // discord sent, bluesky skipped -> no failure
});

// SOW-058 approval model (the DEFAULT): nothing posts until a superadmin approves it.
const cfgApproval = (channels) => JSON.stringify({ syndication: { enabled: true, channels, auto_matrix: allOn(channels) } }); // require_approval defaults true

test('with approval required (the default), a PENDING item is NEVER posted, even past the hold', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgApproval({ discord: true }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(calls.length, 0, 'an unapproved item must never reach a brand channel');
  assert.equal(out.drained, 0);
});

test('an APPROVED item IS posted on the next drain tick', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgApproval({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const stored = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...stored, status: 'approved', approvedAt: 1 }));
  const calls = [];
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

// ---- SOW-087: the category channel map + the flag-approval gate in the drain ----

test('drain records a skipped adapter result (unmapped category) as terminal, never retried', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true, 'discord-category': true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', category: 'gardening' }, { kv, now: at(0) });
  const posts = [];
  const adapters = {
    discord: { name: 'discord', enabled: () => true, post: async () => { posts.push('discord'); return { ok: true, id: 'm1' }; } },
    'discord-category': { name: 'discord-category', enabled: () => true, post: async () => ({ ok: true, skipped: true, reason: 'no channel mapped' }) },
  };
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters });
  assert.equal(out.drained, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent');
  assert.equal(item.perChannel['discord-category'].status, 'skipped');
  assert.equal(item.perChannel.discord.status, 'sent');
});

test('drain reads the synd:channels mirror and hands it to the real discord-category adapter', async () => {
  const kv = fakeKV({
    [SYND_CONFIG_KEY]: cfg({ 'discord-category': true }),
    'synd:channels': JSON.stringify({ generatedAt: 'T0', channels: [{ category: 'devops', channelId: '777' }] }),
  });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/y', url: 'https://ex.com', category: 'devops' }, { kv, now: at(0) });
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push(url); return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm7', channel_id: '777' }) }; };
  const out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), fetchImpl });
  assert.equal(out.drained, 1);
  assert.ok(calls.some((u) => u.includes('/channels/777/messages')));
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel['discord-category'].status, 'sent');
});

test('SOW-087: a flagged item never posts unapproved with require_approval off, and posts once approved', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfg({ discord: true }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/f', url: 'https://ex.com', flags: ['profanity'] }, { kv, now: at(0) });
  const calls = [];
  let out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 0);
  assert.equal(calls.length, 0); // flagged: waits for a superadmin even though require_approval is off
  // superadmin approves -> the next tick posts it (the fresh-read guard must honor the approved flagged item)
  const item = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...item, status: 'approved', approvedAt: 1, approvedBy: 'root' }));
  out = await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
});

// SOW-125: the drain enforces the per-(type,channel) matrix — the load-bearing correctness point. An item
// enqueued because ONE channel is `on` must NOT fan out to a sibling ENABLED channel that is `off` for the type.
function twoChannelAdapters(dCalls, bCalls) {
  return {
    discord: { name: 'discord', enabled: () => true, post: async (i) => { dCalls.push(i.id); return { ok: true, id: 'd', url: 'u' }; } },
    bluesky: { name: 'bluesky', enabled: () => true, post: async (i) => { bCalls.push(i.id); return { ok: true, id: 'b', url: 'u' }; } },
  };
}
const bskyEnv = (extra = {}) => env({ BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p', ...extra });

test('SOW-125: the drain posts ONLY the channels the matrix marks on for the item type', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true, bluesky: true }, auto_matrix: { post: { discord: 'on', bluesky: 'off' } } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const dCalls = [], bCalls = [];
  const out = await drainSyndication(bskyEnv(), { kv, now: at(AFTER_HOLD), adapters: twoChannelAdapters(dCalls, bCalls) });
  assert.equal(out.drained, 1);
  assert.equal(dCalls.length, 1, 'discord (on) posted');
  assert.equal(bCalls.length, 0, 'bluesky (off) never posted');
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.discord.status, 'sent');
  assert.equal(item.perChannel.bluesky.status, 'skipped');
  assert.equal(item.perChannel.bluesky.reason, 'auto-off');
  assert.equal(item.status, 'sent');
});

test('SOW-125: per-channel delay posts a short-hold channel first and holds a long-hold channel on the same item', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true, bluesky: true }, auto_matrix: { post: { discord: 'on', bluesky: 'on' } },
    channel_hold_minutes: { discord: 0, bluesky: 120 } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const dCalls = [], bCalls = [];
  const adapters = twoChannelAdapters(dCalls, bCalls);
  // availableAt = min channel hold = discord's 0, so the item is due at t=0. discord posts; bluesky (120m) holds.
  await drainSyndication(bskyEnv(), { kv, now: at(0), adapters });
  assert.equal(dCalls.length, 1);
  assert.equal(bCalls.length, 0);
  let item = await getItem(kv, r.id);
  assert.equal(item.status, 'pending'); // bluesky still holding -> the item is not terminalized
  assert.equal(item.perChannel.discord.status, 'sent');
  assert.ok(!item.perChannel.bluesky, 'a holding channel is never recorded');
  // A tick well before bluesky's hold does nothing and does NOT burn an attempt (the item is left holding).
  await drainSyndication(bskyEnv(), { kv, now: at(60 * 60_000), adapters });
  item = await getItem(kv, r.id);
  assert.equal(item.attempts, 1, 'a pure holding tick does not increment attempts');
  assert.equal(bCalls.length, 0);
  // After bluesky's 120-min hold: bluesky posts and the item terminalizes; discord is never re-posted.
  await drainSyndication(bskyEnv(), { kv, now: at(121 * 60_000), adapters });
  assert.equal(dCalls.length, 1);
  assert.equal(bCalls.length, 1);
  item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent');
});

test('SOW-125: a type set off for a manual-assist channel creates no Social Queue task', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true }, manual_assist_channels: ['x'], auto_matrix: { post: { discord: 'on', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.x.status, 'skipped'); // recorded off, no task
  assert.equal(item.perChannel.x.reason, 'auto-off');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('social:task:')).length, 0, 'no X manual task created');
  assert.equal(item.status, 'sent');
});

test('SOW-125: a type set on for a manual-assist channel DOES enqueue a Social Queue task', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true }, manual_assist_channels: ['x'], auto_matrix: { post: { discord: 'on', x: 'on', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  await drainSyndication(env(), { kv, now: at(AFTER_HOLD), adapters: discordOk([]) });
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.x.status, 'queued-manual');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('social:task:')).length, 1, 'one X manual task created');
  assert.equal(item.status, 'sent');
});

// SOW-125 (drain adversarial verify): an APPROVED item must post on the NEXT tick. The per-channel hold in the
// approval model draws ONLY from an explicit override (a no-override channel = 0 delay from approval), so the
// global hold is the pre-approval cancel window, not an additional post-approval delay.
test('SOW-125: an approved item posts on the next tick (no override does NOT re-impose the global hold)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgApproval({ discord: true }) }); // require_approval true, hold 60, no override
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const item = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...item, status: 'approved', approvedAt: 1000, approvedBy: 'root' }));
  const calls = [];
  // one minute after approval, far below the 60-minute hold -> posts now
  const out = await drainSyndication(env(), { kv, now: at(1000 + 60_000), adapters: discordOk(calls) });
  assert.equal(out.drained, 1);
  assert.equal(calls.length, 1);
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

test('SOW-125: an approved item staggers an EXPLICIT per-channel override from the approval time', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true,
    channels: { discord: true, bluesky: true }, auto_matrix: allOn({ discord: true, bluesky: true }),
    channel_hold_minutes: { bluesky: 30 } } }) }); // require_approval defaults true
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv, now: at(0) });
  const item = await getItem(kv, r.id);
  await kv.put(`synd:item:${r.id}`, JSON.stringify({ ...item, status: 'approved', approvedAt: 1000, approvedBy: 'root' }));
  const dCalls = [], bCalls = [];
  const adapters = twoChannelAdapters(dCalls, bCalls);
  // 5 min after approval: discord (no override -> 0) posts; bluesky (30 min) holds.
  await drainSyndication(bskyEnv(), { kv, now: at(1000 + 5 * 60_000), adapters });
  assert.equal(dCalls.length, 1);
  assert.equal(bCalls.length, 0);
  assert.equal((await getItem(kv, r.id)).status, 'approved'); // still pending its held channel (status stays approved)
  // 31 min after approval: bluesky posts and the item terminalizes.
  await drainSyndication(bskyEnv(), { kv, now: at(1000 + 31 * 60_000), adapters });
  assert.equal(bCalls.length, 1);
  assert.equal((await getItem(kv, r.id)).status, 'sent');
});

// SOW-125 (drain adversarial verify): a manual-assist task WRITE failure must NOT falsely terminalize the item
// 'sent' with the task lost; it retries, and a persistent failure fails out via maxAttempts.
test('SOW-125: a manual-assist task write failure does not falsely mark the item sent (retries, then fails out)', async () => {
  const base = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true }, manual_assist_channels: ['x'], auto_matrix: { post: { discord: 'on', x: 'on', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  const throwing = { store: base.store, get: base.get.bind(base), delete: base.delete.bind(base), list: base.list.bind(base),
    put: async (k, v) => { if (String(k).startsWith('social:task:')) throw new Error('kv down'); return base.put(k, v); } };
  const r = await enqueue({ SIGNUP_KV: throwing }, { source: 'post', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public' }, { kv: throwing, now: at(0) });
  // tick 1: discord posts, the X task write throws -> the item must NOT be 'sent'; it retries.
  await drainSyndication(env(), { kv: throwing, now: at(AFTER_HOLD), adapters: discordOk([]), maxAttempts: 2 });
  let item = await base.get(`synd:item:${r.id}`, 'json');
  assert.notEqual(item.status, 'sent', 'the item is never falsely sent with the manual task lost');
  assert.equal(item.status, 'pending');
  assert.equal([...base.store.keys()].filter((k) => k.startsWith('social:task:')).length, 0, 'no task was written');
  // tick 2: reaches maxAttempts -> failed (not sent).
  await drainSyndication(env(), { kv: throwing, now: at(AFTER_HOLD), adapters: discordOk([]), maxAttempts: 2 });
  item = await base.get(`synd:item:${r.id}`, 'json');
  assert.equal(item.status, 'failed');
});

// SOW-126: the `popular` drain seam. A trigger:'popular' item (the engagement engine promoted it) delivers to
// its `popular` channels; a plain publish never reaches a `popular` channel.
test('SOW-126: a trigger:popular item posts to its popular channel; a plain item does not', async () => {
  const cfgJson = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true, bluesky: true }, auto_matrix: { share: { discord: 'off', bluesky: 'popular' } } } });
  // A PLAIN share (trigger publish): bluesky is `popular` (not on) -> never posts; discord off -> never posts.
  const kv1 = fakeKV({ [SYND_CONFIG_KEY]: cfgJson });
  const r1 = await enqueue({ SIGNUP_KV: kv1 }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public', trigger: 'publish' }, { kv: kv1, now: at(0) });
  const d1 = [], b1 = [];
  await drainSyndication(bskyEnv(), { kv: kv1, now: at(AFTER_HOLD), adapters: twoChannelAdapters(d1, b1) });
  assert.equal(b1.length, 0, 'a plain publish never reaches a popular channel');
  assert.equal((await getItem(kv1, r1.id)).perChannel.bluesky.reason, 'auto-off');
  // A PROMOTED share (trigger:'popular'): bluesky (popular) DELIVERS; discord (off) still does not.
  const kv2 = fakeKV({ [SYND_CONFIG_KEY]: cfgJson });
  const r2 = await enqueue({ SIGNUP_KV: kv2 }, { source: 'share', targetSlug: 'a/x', url: 'https://ex.com', visibility: 'public', trigger: 'popular' }, { kv: kv2, now: at(0) });
  const d2 = [], b2 = [];
  const out = await drainSyndication(bskyEnv(), { kv: kv2, now: at(AFTER_HOLD), adapters: twoChannelAdapters(d2, b2) });
  assert.equal(out.drained, 1);
  assert.equal(b2.length, 1, 'the promoted item posts to its popular channel');
  assert.equal(d2.length, 0, 'a channel that is off is still never posted');
  const item2 = await getItem(kv2, r2.id);
  assert.equal(item2.perChannel.bluesky.status, 'sent');
  assert.equal(item2.perChannel.discord.reason, 'auto-off');
  assert.equal(item2.status, 'sent');
});

// SOW-126 review MUST-FIX: for a type with BOTH an `on` and a `popular` channel, the publish item and the
// popular promotion are DISTINCT queue items (trigger-scoped dedupe), and each delivers EXCLUSIVELY to its own
// channels: publish -> the `on` channel only; popular -> the `popular` channel only (never resurrecting `on`).
test('SOW-126: on+popular type -> publish hits only on, popular promotion hits only popular (not swallowed, not leaked)', async () => {
  const cfgJson = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    channels: { discord: true, bluesky: true }, auto_matrix: { post: { discord: 'on', bluesky: 'popular' } } } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: cfgJson });
  // 1) Publish the post (trigger 'publish'): delivers to discord (on), never bluesky (popular).
  const rp = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'members/a/posts/x', url: 'https://gbti.network/articles/x/', visibility: 'public', trigger: 'publish' }, { kv, now: at(0) });
  const dP = [], bP = [];
  await drainSyndication(bskyEnv(), { kv, now: at(AFTER_HOLD), adapters: twoChannelAdapters(dP, bP) });
  assert.equal(dP.length, 1, 'publish posts to the on channel');
  assert.equal(bP.length, 0, 'publish never posts to the popular channel');
  assert.equal((await getItem(kv, rp.id)).status, 'sent');
  // 2) The SAME post becomes popular -> the promoter enqueues trigger:'popular'. It must NOT be swallowed by the
  //    still-active publish item's dedupe (distinct key), and must deliver ONLY to bluesky (popular), not discord.
  const rr = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'members/a/posts/x', url: 'https://gbti.network/articles/x/', visibility: 'public', trigger: 'popular' }, { kv, now: at(AFTER_HOLD) });
  assert.equal(rr.enqueued, true, 'the popular promotion is a distinct item, not a duplicate of the publish item');
  assert.notEqual(rr.id, rp.id);
  const dR = [], bR = [];
  await drainSyndication(bskyEnv(), { kv, now: at(AFTER_HOLD * 2), adapters: twoChannelAdapters(dR, bR) });
  assert.equal(bR.length, 1, 'the popular promotion posts to the popular channel');
  assert.equal(dR.length, 0, 'the popular promotion never re-posts to the on channel');
  const promoted = await getItem(kv, rr.id);
  assert.equal(promoted.perChannel.bluesky.status, 'sent');
  assert.equal(promoted.perChannel.discord.reason, 'auto-off');
  assert.equal(promoted.status, 'sent');
});

test('On-Manual: an AUTO-capability channel set on-manual queues a task, never posts, and settles', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    auto_matrix: { post: { discord: 'on', bluesky: 'on-manual', 'discord-category': 'off', reddit: 'off', devto: 'off', mastodon: 'off', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', title: 'T', url: 'https://ex.com/t', visibility: 'public' }, { kv, now: at(0) });
  const dCalls = [];
  const adapters = {
    discord: { name: 'discord', enabled: () => true, post: async (i) => { dCalls.push(i); return { ok: true, id: 'd1' }; } },
    bluesky: { name: 'bluesky', enabled: () => true, post: async () => { throw new Error('an on-manual channel must never auto-post'); } },
  };
  const out = await drainSyndication({ DISCORD_BOT_TOKEN: 't', BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' }, { kv, now: at(AFTER_HOLD), adapters });
  assert.equal(out.drained, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.status, 'sent'); // queued-manual is terminal for the channel; the item settles
  assert.equal(item.perChannel.discord.status, 'sent');
  assert.equal(item.perChannel.bluesky.status, 'queued-manual');
  assert.equal(dCalls.length, 1);
  const taskKeys = [...kv.store.keys()].filter((k) => k.startsWith('social:task:'));
  assert.equal(taskKeys.length, 1, 'one bluesky review task created');
  assert.ok(taskKeys[0].includes('::bluesky'));
});

test('On-Manual: a transient task-write failure retries next tick (never stamped auto-off by the adapter loop)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    auto_matrix: { post: { discord: 'on', bluesky: 'on-manual', 'discord-category': 'off', reddit: 'off', devto: 'off', mastodon: 'off', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  let failTaskPuts = 1; // the first social:task write throws (a KV blip), then recovers
  const realPut = kv.put.bind(kv);
  kv.put = async (key, value) => {
    if (key.startsWith('social:task:') && failTaskPuts > 0) { failTaskPuts--; throw new Error('kv blip'); }
    return realPut(key, value);
  };
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', title: 'T', url: 'https://ex.com/t', visibility: 'public' }, { kv, now: at(0) });
  const dCalls = [];
  const adapters = {
    discord: { name: 'discord', enabled: () => true, post: async (i) => { dCalls.push(i); return { ok: true, id: 'd1' }; } },
    bluesky: { name: 'bluesky', enabled: () => true, post: async () => { throw new Error('an on-manual channel must never auto-post'); } },
  };
  const bskyEnv = { DISCORD_BOT_TOKEN: 't', BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' };
  await drainSyndication(bskyEnv, { kv, now: at(AFTER_HOLD), adapters });
  let item = await getItem(kv, r.id);
  assert.ok(!item.perChannel?.bluesky, 'the failed task write leaves NO terminal marker (the retry must survive)');
  assert.notEqual(item.status, 'sent');
  // Next tick: the write succeeds, the task exists, the item settles.
  await drainSyndication(bskyEnv, { kv, now: at(AFTER_HOLD + 60_000), adapters });
  item = await getItem(kv, r.id);
  assert.equal(item.perChannel.bluesky.status, 'queued-manual');
  assert.equal(item.status, 'sent');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('social:task:')).length, 1);
  assert.equal(dCalls.length, 1, 'discord posted exactly once across both ticks');
});

test('On-Manual: an AUTO channel with NO secrets still queues its review task (no not-configured stamp)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60,
    auto_matrix: { post: { bluesky: 'on-manual', discord: 'off', 'discord-category': 'off', reddit: 'off', devto: 'off', mastodon: 'off', x: 'off', linkedin: 'off', dailydev: 'off', hashnode: 'off' } } } }) });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'a/x', title: 'T', url: 'https://ex.com/t', visibility: 'public' }, { kv, now: at(0) });
  const out = await drainSyndication({}, { kv, now: at(AFTER_HOLD), adapters: {} }); // zero secrets anywhere
  assert.equal(out.drained, 1);
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.bluesky.status, 'queued-manual', 'a review task needs no adapter secrets');
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith('social:task:')).length, 1);
  assert.equal(item.status, 'sent');
});
