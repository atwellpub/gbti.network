// SOW-088: the superadmin "Manually Syndicate" rail. Fake KV + injected authorizer/poster; no network,
// no secrets. The gate, readiness, server-side render + sanitization, channel targeting, the adapter text
// override, the tracker record, and the no-body leak guard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleSyndicateNowInfo, handleSyndicateNow } from '../workers/signup/membership-syndicate-now.mjs';
import { SYND_CONFIG_KEY, SYND_CHANNELS_KEY } from '../workers/signup/syndication-store.mjs';

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
const req = (body = null, method = 'POST') => ({ method, headers: { get: () => 'Bearer t' }, async json() { return body; } });
const superadmin = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const adminOnly = async () => ({ ok: true, githubId: '2', role: 'admin' });
const CFG = JSON.stringify({ syndication: { enabled: true, hold_minutes: 0, channels: { discord: true }, templates: { prompt: 'New prompt: {title} {url}' } } });
const CHANNELS = JSON.stringify({ channels: [{ category: 'ai', channelId: '111222333444555666' }] });
const ENV_DISCORD = { DISCORD_BOT_TOKEN: 'bot', DISCORD_CHANNEL_PROMPTS: '999' };
const ITEM = { source: 'prompt', targetSlug: 'ci-skill', targetType: 'prompt', author: 'atwellpub', title: 'CI Skill', url: 'https://gbti.network/prompts/ci-skill/', category: 'ai', visibility: 'public' };

test('both verbs are superadmin-only (an admin is 403)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const g = await handleSyndicateNowInfo(req(null, 'GET'), { SIGNUP_KV: kv }, { kv, authorize: adminOnly });
  assert.equal(g.status, 403);
  const p = await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x', channelId: '111222333444555666' }), { SIGNUP_KV: kv }, { kv, authorize: adminOnly });
  assert.equal(p.status, 403);
});

test('GET: readiness (secrets decide for AUTO; manual is always ready), templates with defaults, the channel map', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG, [SYND_CHANNELS_KEY]: CHANNELS });
  const r = await handleSyndicateNowInfo(req(null, 'GET'), { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(r.status, 200);
  const byId = Object.fromEntries(r.body.destinations.map((d) => [d.id, d]));
  assert.equal(byId.discord.ready, true);
  assert.equal(byId.x.ready, true); // SOW-137: X is manual-assist -> always ready (enqueues a Social Queue task, no secrets)
  assert.equal(byId.linkedin.ready, true); // manual-assist -> always ready
  assert.equal(byId.dailydev.ready, true); // SOW-135/136: daily.dev is manual-only -> always ready
  assert.equal(byId.reddit.ready, false); // AUTO destination, just missing its secrets in this env
  assert.match(byId.reddit.reason, /missing secrets/);
  // sow-217: Hashnode is RETIRED and out of MANUAL_DESTS, so it is no longer OFFERED as a destination at all.
  // Asserting its ABSENCE rather than deleting the line, because this surface is one of the three
  // hand-maintained channel lists: if MANUAL_DESTS ever drifts back out of step with CHANNELS, this fails.
  assert.equal(byId.hashnode, undefined, 'a retired channel must not be offered as a manual destination');
  assert.equal(r.body.templates.prompt, 'New prompt: {title} {url}');
  assert.equal(r.body.templates.share, 'Shared on the GBTI Network: "{title}" {url}'); // sow-180: the share default is content-first, no member credit
  assert.deepEqual(r.body.channelMap, [{ category: 'ai', channelId: '111222333444555666' }]);
  assert.equal(r.body.featured.prompt, '999');
});

test('POST discord: renders the edited template server-side (sanitized) and posts to the GIVEN channel', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const calls = [];
  const postDiscord = async (channelId, item, { textOverride }) => { calls.push({ channelId, textOverride }); return { ok: true, id: 'm1', url: 'https://discord.com/x' }; };
  const evil = { ...ITEM, title: 'Ping @everyone <@123> now' };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: evil, template: 'Hot: {title} -> {url}', channelId: '111222333444555666' }),
    { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin, now: () => 1000, postDiscord },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.sent, true);
  assert.equal(calls[0].channelId, '111222333444555666');
  assert.match(calls[0].textOverride, /^Hot: /);
  assert.ok(!/@everyone\b/.test(calls[0].textOverride), 'mass ping neutralized');
  assert.ok(!/<@123>/.test(calls[0].textOverride), 'raw mention tokens stripped');
  // The tracker record landed as a terminal sent item with the manual actor + the channel record.
  const itemKey = [...kv.store.keys()].find((k) => k.startsWith('synd:item:'));
  const rec = JSON.parse(kv.store.get(itemKey));
  assert.equal(rec.status, 'sent');
  assert.equal(rec.trigger, 'manual');
  assert.equal(rec.manualBy, '1');
  assert.equal(rec.channels['discord:111222333444555666'].status, 'sent');
  assert.ok(!('body' in rec) && !('encryptedBody' in rec), 'no body ever reaches the tracker');
  // Dedupe pointer written once (absent before), so a later CI enqueue dedupes.
  assert.ok(kv.store.get('synd:dedupe:prompt:ci-skill'));
});

test('POST validations: unknown destination, missing template/channel, missing secrets (reddit included)', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const deps = { kv, authorize: superadmin };
  assert.equal((await handleSyndicateNow(req({ destination: 'reddit', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps)).status, 409); // a real destination now; no secrets in this env
  assert.equal((await handleSyndicateNow(req({ destination: 'myspace', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps)).status, 400);
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: '' }), { SIGNUP_KV: kv }, deps)).status, 400);
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x' }), { ...ENV_DISCORD, SIGNUP_KV: kv }, deps)).status, 400); // no channelId
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: ITEM, template: 'x', channelId: '111222333444555666' }), { SIGNUP_KV: kv }, deps)).status, 409); // no bot token
  // X is MANUAL capability: it always queues to the Social Queue (no secrets involved), never 409s.
  const xr = await handleSyndicateNow(req({ destination: 'x', item: ITEM, template: 'x' }), { SIGNUP_KV: kv }, deps);
  assert.equal(xr.status, 200);
  assert.equal(xr.body.queued, true);
  assert.equal((await handleSyndicateNow(req({ destination: 'discord', item: { ...ITEM, source: 'page' }, template: 'x', channelId: '111222333444555666' }), { ...ENV_DISCORD, SIGNUP_KV: kv }, deps)).status, 400); // bad type
});

test('POST text adapter: receives the pre-rendered override; a failed post records failed + 502', async () => {
  // An AUTO-capability text channel (bluesky): X/LinkedIn are manual capability and always queue instead.
  // (sow-159: mastodon was the original fixture here; it is retired, so bluesky stands in.)
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const seen = [];
  const adapters = { bluesky: { name: 'bluesky', enabled: () => true, post: async (it) => { seen.push(it.textOverride); return { ok: true, id: 't1', url: 'https://bsky.app/t1' }; } } };
  const env = { BLUESKY_HANDLE: 'gbti.bsky.social', BLUESKY_APP_PASSWORD: 'a', SIGNUP_KV: kv };
  const ok = await handleSyndicateNow(req({ destination: 'bluesky', item: ITEM, template: '{title} {url}' }), env, { kv, authorize: superadmin, adapters });
  assert.equal(ok.status, 200);
  assert.match(seen[0], /^CI Skill https:/);
  const failing = { bluesky: { name: 'bluesky', enabled: () => true, post: async () => ({ ok: false, error: 'rate limited' }) } };
  const bad = await handleSyndicateNow(req({ destination: 'bluesky', item: ITEM, template: '{title}' }), env, { kv, authorize: superadmin, adapters: failing });
  assert.equal(bad.status, 502);
  const failedRec = [...kv.store.keys()].filter((k) => k.startsWith('synd:item:')).map((k) => JSON.parse(kv.store.get(k))).find((r) => r.status === 'failed');
  assert.equal(failedRec.channels.bluesky.status, 'failed');
});

// SOW-088 follow-ups: the author's REAL Discord mention resolves via github login -> github_id -> the
// Stripe registry's discord_user_id (fail-soft), and a secondary channel receives the Discord FORWARD of
// the original post (never un-sending the primary on a forward failure).
test('discord: the author mention resolves from the registry and the forward hits the secondary channel', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ channelId, textOverride, mention: item.mention }); return { ok: true, id: 'msg9', url: 'https://discord.com/m9' }; };
  const forwards = [];
  const makeDiscord = () => ({ forwardChannelMessage: async (to, ref) => { forwards.push({ to, ref }); return { id: 'fwd1' }; } });
  const fetchImpl = async (url) => {
    if (String(url).startsWith('https://api.github.com/users/')) return { ok: true, async json() { return { id: 2002207 }; } };
    throw new Error(`unexpected fetch ${url}`);
  };
  const makeStripe = () => ({ findCustomerByGithubId: async (id) => (id === '2002207' ? { metadata: { discord_user_id: '777888999000' } } : null) });
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', DISCORD_GUILD_ID: 'g1', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}: {title}', channelId: '111222333444555666', forwardChannelId: '999888777666555444' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200);
  assert.equal(posts[0].mention, '<@777888999000>'); // the registry mention reached the renderer
  assert.match(posts[0].textOverride, /^By <@777888999000>: CI Skill$/);
  assert.deepEqual(forwards[0], { to: '999888777666555444', ref: { messageId: 'msg9', fromChannelId: '111222333444555666', guildId: 'g1' } });
  assert.deepEqual(r.body.forwarded, { channelId: '999888777666555444', id: 'fwd1' });
  const rec = JSON.parse(kv.store.get([...kv.store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(rec.channels['discord-forward:999888777666555444'].status, 'sent');
});

test('discord: the GUILD member search resolves the mention when the registry has no customer', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ textOverride }); return { ok: true, id: 'm', url: 'u' }; };
  const makeDiscord = () => ({
    searchGuildMembers: async (guild, q) => (q === 'atwellpub' ? [{ user: { id: '424242424242', username: 'atwellpub' } }] : []),
    forwardChannelMessage: async () => ({ id: 'f' }),
  });
  const fetchImpl = async (url) => (String(url).startsWith('https://api.github.com/') ? { ok: true, async json() { return { id: 2002207 }; } } : (() => { throw new Error('no'); })());
  const makeStripe = () => ({ findCustomerByGithubId: async () => null }); // the registry misses (status: none)
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', DISCORD_GUILD_ID: 'g1', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}', channelId: '111222333444555666' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200);
  assert.equal(posts[0].textOverride, 'By <@424242424242>'); // the guild search produced a REAL mention
});

test('discord: a mention-resolution miss falls back to the text username; a forward failure never un-sends', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const posts = [];
  const postDiscord = async (channelId, item, { textOverride }) => { posts.push({ textOverride }); return { ok: true, id: 'msg1', url: 'u' }; };
  const makeDiscord = () => ({ searchGuildMembers: async () => [], forwardChannelMessage: async () => { throw new Error('missing access'); } });
  const fetchImpl = async () => ({ ok: false, status: 404 }); // the GitHub lookup misses
  const makeStripe = () => ({ findCustomerByGithubId: async () => null });
  const env = { ...ENV_DISCORD, STRIPE_SECRET_KEY: 'rk', SIGNUP_KV: kv };
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: 'By {member-discord-username}', channelId: '111222333444555666', forwardChannelId: '999888777666555444' }),
    env, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord, makeStripe, fetchImpl },
  );
  assert.equal(r.status, 200); // the primary send survives the forward failure
  assert.match(posts[0].textOverride, /^By @.?atwellpub$/);
  assert.match(r.body.forwarded.error, /missing access/);
  const rec = JSON.parse(kv.store.get([...kv.store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(rec.status, 'sent');
  assert.equal(rec.channels['discord-forward:999888777666555444'].status, 'failed');
});

// SOW-088: leaf-first category routing. One leaf mapping (skill -> a channel) wins over the broad
// top-level row, for the manual forward default AND the auto discord-category post alike.
test('channelForCategoryPath resolves the DEEPEST mapped key first', async () => {
  const { channelForCategoryPath } = await import('../membership/news-channels.mjs');
  const map = { channels: [{ category: 'ai', channelId: '100' }, { category: 'skill', channelId: '200' }] };
  assert.equal(channelForCategoryPath(map, ['ai', 'prompts', 'skill']), '200'); // the leaf wins
  assert.equal(channelForCategoryPath(map, ['ai', 'prompts']), '100'); // unmapped leaf walks up
  assert.equal(channelForCategoryPath(map, ['business']), null);
  assert.equal(channelForCategoryPath(map, 'ai'), '100'); // a bare key degrades to the flat lookup
});

test('the queue item carries categoryPath and the drain resolves the guild mention (auto path parity)', async () => {
  const { buildQueueItem } = await import('../membership/syndication-queue.mjs');
  const it = buildQueueItem({ ...ITEM, categoryPath: ['ai', 'prompts', 'skill'], authorDiscord: 'hudshandle' }, { now: () => 1, holdMs: 0 });
  assert.deepEqual(it.categoryPath, ['ai', 'prompts', 'skill']);
  assert.equal(it.authorDiscord, 'hudshandle');
  const { resolveGuildMention } = await import('../workers/signup/membership-syndicate-now.mjs');
  const makeDiscord = () => ({ searchGuildMembers: async (g, q) => (q === 'hudshandle' ? [{ user: { id: '55555555', username: 'hudshandle' } }] : []) });
  const m = await resolveGuildMention({ DISCORD_BOT_TOKEN: 'b', DISCORD_GUILD_ID: 'g' }, it, { makeDiscord });
  assert.equal(m, '<@55555555>');
  assert.equal(await resolveGuildMention({}, it, { makeDiscord }), null); // no bot/guild -> fail-soft
});

// SOW-088: a manual send SUPERSEDES its auto-queue twin (enqueued on merge, still pending) so flipping
// require_approval off can never double-post an already-manually-published item.
test('a manual send cancels the pending queue twin and repoints the dedupe at the manual record', async () => {
  const { enqueue } = await import('../workers/signup/syndication-store.mjs');
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const twin = await enqueue({ SIGNUP_KV: kv }, { ...ITEM, trigger: 'publish' }, { kv, now: () => 500 });
  const postDiscord = async () => ({ ok: true, id: 'm', url: 'u' });
  const r = await handleSyndicateNow(
    req({ destination: 'discord', item: ITEM, template: '{title}', channelId: '111222333444555666' }),
    { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin, now: () => 1000, postDiscord, makeDiscord: () => ({}), makeStripe: () => ({ findCustomerByGithubId: async () => null }), fetchImpl: async () => ({ ok: false }) },
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.superseded, twin.id);
  const cancelled = JSON.parse(kv.store.get(`synd:item:${twin.id}`));
  assert.equal(cancelled.status, 'cancelled');
  assert.match(cancelled.cancelReason, /superseded/);
  assert.ok(!JSON.parse(kv.store.get('synd:pending')).ids.includes(twin.id), 'the twin left the pending index');
  assert.equal(kv.store.get('synd:dedupe:prompt:ci-skill'), r.body.itemId); // the dedupe points at the manual record
});

// SOW-088 Radle-style Reddit options: redditKind + a bodyTemplate rendered SERVER-side (same sanitization
// boundary as the title template) reach the adapter as redditKind/bodyText; other destinations never see them.
test('POST reddit: redditKind and a server-rendered bodyTemplate reach the adapter', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const envReddit = { REDDIT_CLIENT_ID: 'i', REDDIT_CLIENT_SECRET: 's', REDDIT_REFRESH_TOKEN: 'r', REDDIT_SUBREDDIT: 'GBTI_network', SIGNUP_KV: kv };
  let seen = null;
  const adapters = { reddit: { name: 'reddit', enabled: () => true, post: async (it) => { seen = it; return { ok: true, id: 'p1', url: 'https://r/p1' }; } } };
  const r = await handleSyndicateNow(
    req({ destination: 'reddit', item: ITEM, template: '{title}', redditKind: 'self', bodyTemplate: 'Read it: {url}' }),
    envReddit, { kv, authorize: superadmin, adapters });
  assert.equal(r.status, 200);
  assert.equal(seen.redditKind, 'self');
  assert.equal(seen.bodyText, 'Read it: https://gbti.network/prompts/ci-skill/');
  assert.equal(seen.textOverride, 'CI Skill', 'the payload template is the title, never the stored default');
  // An invalid kind degrades to link; a missing bodyTemplate sends no bodyText.
  await handleSyndicateNow(req({ destination: 'reddit', item: ITEM, template: '{title}', redditKind: 'weird' }), envReddit, { kv, authorize: superadmin, adapters });
  assert.equal(seen.redditKind, 'link');
  assert.equal(seen.bodyText, undefined);
});

// SOW-088: the GET carries the per-channel template overrides for the popup's channel-aware defaults.
test('GET: channelTemplates ride along', async () => {
  const withOverrides = JSON.stringify({ syndication: { enabled: true, channel_templates: { reddit: { prompt: 'R "{title}"' } } } });
  const kv = fakeKV({ [SYND_CONFIG_KEY]: withOverrides });
  const r = await handleSyndicateNowInfo(req(null, 'GET'), { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.channelTemplates, { reddit: { prompt: 'R "{title}"' } });
});

// SOW-088 dev.to: the manual rail renders the byline server-side, passes the draft flag, and a SKIP
// (members/share/unpublished) returns 409 with the reason instead of recording a phantom send.
test('POST devto: the byline + draft flag reach the adapter; a skip is a 409', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const envDevto = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466', SIGNUP_KV: kv };
  let seen = null;
  const adapters = { devto: { name: 'devto', enabled: () => true, post: async (it) => { seen = it; return { ok: true, id: '7', url: 'https://dev.to/x', draft: it.devtoDraft === true }; } } };
  const r = await handleSyndicateNow(
    req({ destination: 'devto', item: ITEM, template: '{title}', devtoIntroTemplate: 'By {fullName}.', devtoDraft: true }),
    envDevto, { kv, authorize: superadmin, adapters });
  assert.equal(r.status, 200);
  assert.equal(r.body.draft, true);
  assert.equal(seen.devtoDraft, true);
  assert.match(seen.devtoIntro, /^By @?.?atwellpub\.|^By /);
  // A skip surfaces as a refusal, never a sent record.
  const skipping = { devto: { name: 'devto', enabled: () => true, post: async () => ({ ok: true, skipped: true, reason: 'members-only items never crosspost' }) } };
  const sk = await handleSyndicateNow(req({ destination: 'devto', item: ITEM, template: '{title}' }), envDevto, { kv, authorize: superadmin, adapters: skipping });
  assert.equal(sk.status, 409);
  assert.match(sk.body.message, /members-only/);
});

// SOW-088 Proposal A: the GET serves the stub maps + built-in stub defaults for the popup's chain.
test('GET: the stub template maps ride along', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, channel_templates_stub: { discord: { post: 'S {title}' } } } }) });
  const r = await handleSyndicateNowInfo(req(null, 'GET'), { ...ENV_DISCORD, SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.channelTemplatesStub, { discord: { post: 'S {title}' } });
  assert.ok(r.body.stubDefaults.discord.post.includes('members-only'), 'built-in channel stub defaults ride along');
  assert.ok(r.body.stubDefaults[''].post.includes('Members-only'), 'the shared fallback rides under the empty key');
});

// Adversarial follow-up: devtoStubTemplate forwards into the adapter extras rendered.
test('POST devto: devtoStubTemplate renders into item.devtoStub', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const envDevto = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466', SIGNUP_KV: kv };
  let seen = null;
  const adapters = { devto: { name: 'devto', enabled: () => true, post: async (it) => { seen = it; return { ok: true, id: '7', url: 'https://dev.to/x' }; } } };
  const r = await handleSyndicateNow(
    req({ destination: 'devto', item: ITEM, template: '{title}', devtoStubTemplate: 'Teaser: {title}' }),
    envDevto, { kv, authorize: superadmin, adapters });
  assert.equal(r.status, 200);
  assert.equal(seen.devtoStub, 'Teaser: CI Skill');
});

// SOW-138: unlike the byline/footer/stub, the public BODY template travels RAW to the adapter ({body} resolves
// in the adapter, where the fetched article is available), so it must NOT be server-rendered here.
test('POST devto: devtoBodyTemplate reaches the adapter as a RAW (unrendered) string', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: CFG });
  const envDevto = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466', SIGNUP_KV: kv };
  let seen = null;
  const adapters = { devto: { name: 'devto', enabled: () => true, post: async (it) => { seen = it; return { ok: true, id: '7', url: 'https://dev.to/x' }; } } };
  await handleSyndicateNow(
    req({ destination: 'devto', item: ITEM, template: '{title}', devtoBodyTemplate: 'Note on {title}.\n\n{body}' }),
    envDevto, { kv, authorize: superadmin, adapters });
  assert.equal(seen.devtoBodyTemplate, 'Note on {title}.\n\n{body}', 'the raw template: {title} and {body} are NOT expanded here');
});
