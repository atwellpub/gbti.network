// SOW-058: the channel adapters + the run resolver. Fake fetch / fake Discord client; no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDiscordAdapter, createDiscordCategoryAdapter } from '../clients/syndication/discord-channel.mjs';
import { createMastodonAdapter } from '../clients/syndication/mastodon.mjs';
import { createBlueskyAdapter } from '../clients/syndication/bluesky.mjs';
import { createXAdapter } from '../clients/syndication/x.mjs';
import { createLinkedinAdapter } from '../clients/syndication/linkedin.mjs';
import { resolveAdapterRun } from '../membership/syndication-adapters.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config.mjs';

const item = { source: 'share', author: 'alice', title: 'Read this', blurb: 'b', url: 'https://ex.com/a', mention: '<@123>' };

test('discord adapter posts to the per-source channel with a ping-safe author mention', async () => {
  const calls = [];
  const client = { postChannelMessage: async (channelId, content, opts) => { calls.push({ channelId, content, opts }); return { id: 'm1', channel_id: channelId }; } };
  const a = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client });
  assert.equal(a.enabled(), true);
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.equal(r.id, 'm1');
  assert.equal(calls[0].channelId, 'chan-share');
  assert.deepEqual(calls[0].opts.allowedMentions, { parse: [], users: ['123'] }); // only the author may be pinged
  // SOW-088: EVERY type now has the one owner-directed default template, mention-first.
  assert.equal(calls[0].content, 'New link published by <@123>: "Read this" https://ex.com/a');
  const postCalls = [];
  const clientB = { postChannelMessage: async (channelId, content, opts) => { postCalls.push({ content }); return { id: 'm2' }; } };
  const b = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_POSTS: 'chan-posts' }, client: clientB });
  await b.post({ ...item, source: 'post' });
  assert.equal(postCalls[0].content, 'New article published by <@123>: "Read this" https://ex.com/a');
});

test('discord adapter fails cleanly when no channel is configured for the source', async () => {
  const a = createDiscordAdapter({ env: { DISCORD_BOT_TOKEN: 't' }, client: { postChannelMessage: async () => ({}) } });
  const r = await a.post({ source: 'post', author: 'x' });
  assert.equal(r.ok, false);
});

test('mastodon adapter posts a status and returns the url', async () => {
  let body;
  const fetchImpl = async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ id: '99', url: 'https://m/@gbti/99' }) }; };
  const a = createMastodonAdapter({ env: { MASTODON_BASE_URL: 'https://m/', MASTODON_ACCESS_TOKEN: 't' }, fetchImpl });
  assert.equal(a.enabled(), true);
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://m/@gbti/99');
  assert.match(body.status, /Read this/);
});

test('bluesky adapter creates a session then a post record', async () => {
  const urls = [];
  const fetchImpl = async (url, opts) => {
    urls.push(url);
    if (url.includes('createSession')) return { ok: true, json: async () => ({ accessJwt: 'jwt', did: 'did:plc:me' }) };
    return { ok: true, json: async () => ({ uri: 'at://did:plc:me/app.bsky.feed.post/1' }) };
  };
  const a = createBlueskyAdapter({ env: { BLUESKY_HANDLE: 'gbti.bsky.social', BLUESKY_APP_PASSWORD: 'pw' }, fetchImpl });
  const r = await a.post(item);
  assert.equal(r.ok, true);
  assert.ok(urls[0].includes('createSession'));
  assert.ok(urls[1].includes('createRecord'));
});

test('x + linkedin adapters post via their endpoints (shape only)', async () => {
  const x = createXAdapter({ env: { X_API_KEY: 'a', X_API_SECRET: 'b', X_ACCESS_TOKEN: 'c', X_ACCESS_SECRET: 'd' }, fetchImpl: async () => ({ ok: true, json: async () => ({ data: { id: '7' } }) }) });
  assert.equal(x.enabled(), true);
  assert.equal((await x.post(item)).url, 'https://x.com/i/web/status/7');

  const li = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 't', LINKEDIN_ORG_URN: 'urn:li:organization:1' },
    fetchImpl: async () => ({ ok: true, headers: { get: () => 'urn:li:share:5' } }),
  });
  assert.equal(li.enabled(), true);
  assert.equal((await li.post(item)).ok, true);
});

test('an adapter with missing secrets reports enabled() false', () => {
  assert.equal(createMastodonAdapter({ env: {} }).enabled(), false);
  assert.equal(createXAdapter({ env: { X_API_KEY: 'only-one' } }).enabled(), false);
});

test('resolveAdapterRun splits ready (secrets) vs skipped (enabled-but-no-secret); a manual channel is hard-excluded', () => {
  // SOW-131: enablement is MATRIX-DERIVED. The default matrix enables every auto channel (post/product/prompt on),
  // so with only DISCORD_BOT_TOKEN present, discord + discord-category are ready (they share the bot token) and the
  // other auto channels are enabled-but-secretless -> skipped. x + linkedin are MANUAL -> hard-excluded (never
  // auto-posted), belt-and-suspenders behind the matrix gate.
  const cfg = syndicationConfigFromParsed({ enabled: true });
  const env = { DISCORD_BOT_TOKEN: 't' };
  const { ready, skipped } = resolveAdapterRun({ cfg, env });
  assert.deepEqual(ready.map((a) => a.name).sort(), ['discord', 'discord-category']);
  assert.deepEqual(skipped.sort(), ['bluesky', 'devto', 'reddit']); // sow-159: mastodon retired (out of CHANNELS); hashnode is MANUAL: hard-excluded
});

// SOW-087: the second Discord post, routed by the item's category via the KV-mirrored map.
test('discord-category adapter posts to the mapped channel for the item category', async () => {
  const calls = [];
  const client = { postChannelMessage: async (channelId, content, opts) => { calls.push({ channelId, content, opts }); return { id: 'm2', channel_id: channelId }; } };
  const channelMap = { channels: [{ category: 'devops', channelId: '777' }] };
  const a = createDiscordCategoryAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client, channelMap });
  assert.equal(a.name, 'discord-category');
  const r = await a.post({ ...item, category: 'DevOps' }); // case-insensitive match
  assert.equal(r.ok, true);
  assert.equal(calls[0].channelId, '777');
  assert.deepEqual(calls[0].opts.allowedMentions, { parse: [], users: ['123'] }); // same ping-safety as discord
});

test('discord-category adapter is a clean skip for an unmapped/absent category or a duplicate channel', async () => {
  let posted = 0;
  const client = { postChannelMessage: async () => { posted++; return { id: 'x' }; } };
  const channelMap = { channels: [{ category: 'devops', channelId: 'chan-share' }] };
  const a = createDiscordCategoryAdapter({ env: { DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'chan-share' }, client, channelMap });
  const unmapped = await a.post({ ...item, category: 'gardening' });
  assert.equal(unmapped.ok, true);
  assert.equal(unmapped.skipped, true);
  const noCategory = await a.post({ ...item, category: null });
  assert.equal(noCategory.skipped, true);
  // the mapped channel equals the per-type channel: never double-post one channel
  const dupe = await a.post({ ...item, category: 'devops' });
  assert.equal(dupe.skipped, true);
  assert.equal(posted, 0);
});

test('resolveAdapterRun readies discord-category off the same bot token and hands it the channel map', async () => {
  // SOW-131: the default matrix enables the auto channels; discord + discord-category ready off the shared bot token.
  const cfg = syndicationConfigFromParsed({ syndication: { enabled: true } });
  const channelMap = { channels: [{ category: 'ai', channelId: '555' }] };
  const calls = [];
  const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'm9', channel_id: '555' }) }; };
  const { ready } = resolveAdapterRun({ cfg, env: { DISCORD_BOT_TOKEN: 't' }, fetchImpl, channelMap });
  assert.deepEqual(ready.map((a) => a.name).sort(), ['discord', 'discord-category']);
  const dc = ready.find((a) => a.name === 'discord-category');
  const r = await dc.post({ ...item, category: 'ai' });
  assert.equal(r.ok, true);
  assert.ok(calls.some((c) => c.url.includes('/channels/555/messages')));
});

// SOW-088: the LinkedIn adapter targets the versioned Posts API and posts a rich article card.
test('linkedin: versioned /rest/posts, org author, article card with url, none without, error snippet', async () => {
  const calls = [];
  const li = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 'tok', LINKEDIN_ORG_URN: 'urn:li:organization:99' },
    fetchImpl: async (url, opts) => { calls.push({ url, opts, body: JSON.parse(opts.body) }); return { ok: true, headers: { get: (h) => (h === 'x-restli-id' ? 'urn:li:share:42' : null) } }; },
  });
  const r = await li.post({ ...item, textOverride: 'Edited text wins' });
  assert.equal(calls[0].url, 'https://api.linkedin.com/rest/posts');
  assert.equal(calls[0].opts.headers['X-Restli-Protocol-Version'], '2.0.0');
  assert.match(calls[0].opts.headers['LinkedIn-Version'], /^\d{6}$/);
  assert.equal(calls[0].body.author, 'urn:li:organization:99');
  assert.equal(calls[0].body.commentary, 'Edited text wins'); // the manual override wins
  assert.deepEqual(calls[0].body.content.article, { source: 'https://ex.com/a', title: 'Read this', description: 'b' });
  assert.equal(calls[0].body.visibility, 'PUBLIC');
  assert.equal(r.url, 'https://www.linkedin.com/feed/update/urn:li:share:42');
  // No url -> commentary only, no content block.
  await li.post({ source: 'share', author: 'alice', title: 'T' });
  assert.equal('content' in calls[1].body, false);
  // A refusal surfaces the response snippet so the popup says WHY.
  const bad = createLinkedinAdapter({
    env: { LINKEDIN_ACCESS_TOKEN: 'tok', LINKEDIN_ORG_URN: 'urn:li:organization:99' },
    fetchImpl: async () => ({ ok: false, status: 422, text: async () => '{"message":"ACCESS_DENIED: not permitted"}' }),
  });
  const err = await bad.post(item);
  assert.equal(err.ok, false);
  assert.match(err.error, /linkedin 422 .*ACCESS_DENIED/);
});

// SOW-088: the Reddit adapter (the Radle port) — refresh-then-submit, clean api_type=json parsing.
test('reddit: refreshes with Basic auth then submits a link post with the required UA', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at1' }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'abc123', url: 'https://www.reddit.com/r/GBTI_network/comments/abc123/x/' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const rd = createRedditAdapter({ env, fetchImpl });
  assert.equal(rd.enabled(), true);
  const r = await rd.post({ ...item, textOverride: 'A natural Reddit title' });
  // Refresh call shape.
  assert.match(calls[0].url, /www\.reddit\.com\/api\/v1\/access_token/);
  assert.match(calls[0].opts.headers.Authorization, /^Basic /);
  assert.match(calls[0].opts.body, /grant_type=refresh_token/);
  // Submit call shape.
  assert.match(calls[1].url, /oauth\.reddit\.com\/api\/submit/);
  assert.equal(calls[1].opts.headers.Authorization, 'Bearer at1');
  assert.ok(calls[1].opts.headers['User-Agent'], 'Reddit requires a User-Agent');
  const p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('sr'), 'GBTI_network');
  assert.equal(p.get('kind'), 'link');
  assert.equal(p.get('title'), 'A natural Reddit title');
  assert.equal(p.get('url'), 'https://ex.com/a');
  assert.equal(p.get('api_type'), 'json');
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://www.reddit.com/r/GBTI_network/comments/abc123/x/');
});

// SOW-088 Radle-style post kinds: an explicit redditKind=self makes a TEXT post whose body is the
// Worker-rendered bodyText; a link post carries a provided bodyText as body text under the link.
test('reddit: redditKind self posts text with the body, and a link post carries bodyText', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at1' }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'x1', url: 'https://r/x1' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const rd = createRedditAdapter({ env, fetchImpl });
  await rd.post({ ...item, textOverride: 'T', redditKind: 'self', bodyText: 'Body https://ex.com/a' });
  let p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('kind'), 'self');
  assert.equal(p.get('text'), 'Body https://ex.com/a');
  assert.equal(p.get('url'), null, 'a self post sends no url param');
  // A link post's body rides NATIVELY as selftext (field-proven 2026-07-10 by post 1u35tf7; the earlier
  // first-comment detour was a stale-background misdiagnosis).
  await rd.post({ ...item, textOverride: 'T', redditKind: 'link', bodyText: 'extra context' });
  p = new URLSearchParams(calls[3].opts.body);
  assert.equal(p.get('kind'), 'link');
  assert.equal(p.get('url'), 'https://ex.com/a');
  assert.equal(p.get('text'), 'extra context', 'the body is a submit param, never a comment');
  assert.equal(calls.length, 4, 'no follow-up comment call');
  // A url-less item can never be a link post regardless of the requested kind.
  await rd.post({ ...item, url: null, textOverride: 'T', redditKind: 'link' });
  p = new URLSearchParams(calls[5].opts.body);
  assert.equal(p.get('kind'), 'self');
});

test('reddit: a dead refresh token and json.errors both surface readable failures', async () => {
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const dead = createRedditAdapter({ env, fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({}) }) });
  const r1 = await dead.post(item);
  assert.equal(r1.ok, false);
  assert.match(r1.error, /refresh token may be revoked/);
  const errs = createRedditAdapter({ env, fetchImpl: async (url) => (url.includes('access_token')
    ? { ok: true, status: 200, json: async () => ({ access_token: 'at' }) }
    : { ok: true, status: 200, json: async () => ({ json: { errors: [['SUBREDDIT_NOTALLOWED', 'not allowed to post there', 'sr']] } }) }) });
  const r2 = await errs.post(item);
  assert.equal(r2.ok, false);
  assert.match(r2.error, /SUBREDDIT_NOTALLOWED/);
});

// SOW-088: the two Discord adapters name their template channel, so a per-channel override diverges the
// featured post from the category post while an override-less config falls back to the shared map.
test('discord adapters pick their channel template set', async () => {
  const { createDiscordAdapter, createDiscordCategoryAdapter } = await import('../clients/syndication/discord-channel.mjs');
  const { syndicationConfigFromParsed } = await import('../membership/syndication-config-core.mjs');
  const cfg = syndicationConfigFromParsed({ syndication: {
    templates: { prompt: 'Shared {title}' },
    channel_templates: { 'discord-category': { prompt: 'In {category}: {title}' } },
  } });
  const sent = [];
  const client = { async postChannelMessage(channelId, content) { sent.push({ channelId, content }); return { id: '1', channel_id: channelId }; } };
  const env = { DISCORD_BOT_TOKEN: 'b', DISCORD_CHANNEL_PROMPTS: '111' };
  const it = { source: 'prompt', title: 'T', category: 'ai', author: 'a', url: 'https://x/y' };
  await createDiscordAdapter({ env, client, cfg }).post(it);
  assert.equal(sent[0].content, 'Shared T', 'featured: no override -> the shared map');
  const catAdapter = createDiscordCategoryAdapter({ env, client, cfg, channelMap: { channels: [{ category: 'ai', channelId: '222' }] } });
  await catAdapter.post(it);
  assert.equal(sent[1].content, 'In ai: T', 'category: its own override wins');
});

// SOW-088 (owner-directed): the FIRST COMMENT is its own templated leg, independent of the post body —
// a link post carries the body natively AND may post a separately-rendered first comment.
test('reddit: commentText posts as the first comment alongside the native body', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'at1' }) };
    if (url.includes('/api/comment')) return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { things: [{ data: { id: 'c9' } }] } } }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'x1', name: 't3_x1', url: 'https://r/x1' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'id', REDDIT_CLIENT_SECRET: 'sec', REDDIT_REFRESH_TOKEN: 'rt', REDDIT_SUBREDDIT: 'GBTI_network' };
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const rd = createRedditAdapter({ env, fetchImpl });
  const r = await rd.post({ ...item, textOverride: 'T', redditKind: 'link', bodyText: 'the description', commentText: 'From GBTI...' });
  const p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('text'), 'the description', 'the body stays on the post');
  const cp = new URLSearchParams(calls[2].opts.body);
  assert.equal(cp.get('thing_id'), 't3_x1');
  assert.equal(cp.get('text'), 'From GBTI...');
  assert.equal(r.comment.id, 'c9');
});

// SOW-088 Proposal A: a members-only item renders the channel's STUB template on both Discord legs.
test('discord legs render the stub template for members items', async () => {
  const { createDiscordAdapter, createDiscordCategoryAdapter } = await import('../clients/syndication/discord-channel.mjs');
  const { syndicationConfigFromParsed } = await import('../membership/syndication-config-core.mjs');
  const cfg = syndicationConfigFromParsed({});
  const sent = [];
  const client = { async postChannelMessage(channelId, content) { sent.push(content); return { id: '1', channel_id: channelId }; } };
  const env = { DISCORD_BOT_TOKEN: 'b', DISCORD_CHANNEL_PROMPTS: '111' };
  const it = { source: 'prompt', title: 'Secret Skill', category: 'ai', author: 'a', url: 'https://x/y', membersOnly: true, visibility: 'members' };
  await createDiscordAdapter({ env, client, cfg }).post(it);
  assert.match(sent[0], /members-only prompt/, 'the featured leg uses the Discord stub default');
  await createDiscordCategoryAdapter({ env, client, cfg, channelMap: { channels: [{ category: 'ai', channelId: '222' }] } }).post(it);
  assert.match(sent[1], /landed in ai/, 'the category leg uses its own stub default');
  // A public item is untouched.
  await createDiscordAdapter({ env, client, cfg }).post({ ...it, membersOnly: false, visibility: 'public' });
  assert.match(sent[2], /^New prompt published by/);
});

// Adversarial follow-up: the reddit AUTO rail renders the channel templates (stub-aware), not
// buildChannelText, when cfg is provided.
test('reddit auto rail renders templates: public {title} default and the members stub', async () => {
  const { createRedditAdapter } = await import('../clients/syndication/reddit.mjs');
  const { syndicationConfigFromParsed } = await import('../membership/syndication-config-core.mjs');
  const cfg = syndicationConfigFromParsed({});
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.includes('/api/v1/access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'a' }) };
    return { ok: true, status: 200, json: async () => ({ json: { errors: [], data: { id: 'x', url: 'u' } } }) };
  };
  const env = { REDDIT_CLIENT_ID: 'i', REDDIT_CLIENT_SECRET: 's', REDDIT_REFRESH_TOKEN: 'r', REDDIT_SUBREDDIT: 'GBTI_network' };
  const rd = createRedditAdapter({ env, fetchImpl, cfg });
  await rd.post({ source: 'prompt', title: 'Public Skill', author: 'a', url: 'https://x/y', visibility: 'public' });
  let p = new URLSearchParams(calls[1].opts.body);
  assert.equal(p.get('title'), 'Public Skill', 'public auto title = the {title} channel default');
  await rd.post({ source: 'prompt', title: 'Secret Skill', author: 'a', url: 'https://x/y', visibility: 'members', membersOnly: true, blurb: 'Teaser.' });
  p = new URLSearchParams(calls[3].opts.body);
  assert.match(p.get('title'), /Secret Skill.*members-only prompt from the GBTI Network/, 'members auto title = the reddit title stub');
  assert.match(p.get('text') || '', /members library/, 'members auto body = the reddit-body stub');
});

// SOW-088: a members SHARE posts its external link directly on Discord (no "read it on gbti.network"),
// distinct from the members post/product/prompt stub.
test('discord share stub shares the link directly, not a read-on-site line', async () => {
  const { createDiscordAdapter } = await import('../clients/syndication/discord-channel.mjs');
  const { syndicationConfigFromParsed } = await import('../membership/syndication-config-core.mjs');
  const cfg = syndicationConfigFromParsed({});
  const sent = [];
  const client = { async postChannelMessage(id, content) { sent.push(content); return { id: '1', channel_id: id }; } };
  const env = { DISCORD_BOT_TOKEN: 'b', DISCORD_CHANNEL_SHARES: '111' };
  await createDiscordAdapter({ env, client, cfg }).post({ source: 'share', title: 'A Video', author: 'a', url: 'https://youtu.be/x', membersOnly: true, visibility: 'members' });
  assert.match(sent[0], /shared the following link/);
  assert.ok(!sent[0].includes('read it on gbti.network'), 'no read-on-site line for a share');
  assert.match(sent[0], /https:\/\/youtu\.be\/x/);
});
