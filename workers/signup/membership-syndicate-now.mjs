// SOW-088: the superadmin "Manually Syndicate" rail. The auto pipeline (SOW-034/058) enqueues on merge and a
// cron drain posts the stored template to the mapped channels; this endpoint lets a SUPERADMIN push one item
// to ONE destination RIGHT NOW with an edited template and (for Discord) an explicit channel, from the
// extension reader. Direct post + a tracker record (owner-decided), never through the pending queue.
//
//   GET  /membership/syndicate-now  -> { ok, destinations, templates, channelMap, featured }
//   POST /membership/syndicate-now  -> body { destination, item, template, channelId? } -> { ok, sent, id, url, itemId }
//
// Both verbs are superadmin-only (authorizeAdmin + role check, the syndication-admin pattern). The server
// renders the template itself via the shared renderTemplate (mention resolution + sanitization stay here;
// the client only ever sends a TEMPLATE, never trusted final text), and the item passes through
// buildQueueItem so the no-body leak guard and type validation apply. Re-posting an already-sent item is
// ALLOWED (the popup warns from the tracker history); the dedupe pointer is written only when absent so a
// later CI enqueue still dedupes against the manual send.

import { authorizeAdmin } from './membership-admin.mjs';
import { ROLE } from '../../membership/overrides-core.mjs';
import { buildQueueItem, dedupeKey, canCancel, markCancelled } from '../../membership/syndication-queue.mjs';
import { renderTemplate } from '../../membership/syndication-format.mjs';
import { channelLimit, secretsPresent } from '../../membership/syndication-channels.mjs';
import { templateFor, TEMPLATE_TYPES, DEFAULT_TEMPLATES, DEFAULT_STUB_TEMPLATES, DEFAULT_CHANNEL_STUB_TEMPLATES, channelCapability } from '../../membership/syndication-config-core.mjs';
import { buildAdapters } from '../../membership/syndication-adapters.mjs';
import { buildSocialTask } from '../../membership/social-queue.mjs'; // SOW-121
import { putTask } from './social-queue-store.mjs'; // SOW-121
import { postToChannel } from '../../clients/syndication/discord-channel.mjs';
import { readSyndicationConfig, readContentChannels, putItem, getItem, removeFromPending, SYND_DEDUPE_KEY } from './syndication-store.mjs';
import { createStripeClient } from '../../clients/stripe.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

// The destinations the manual flow offers (SOW-088: the Reddit adapter landed, the Radle port).
// sow-159: Mastodon retired (2026-07-28); dropped from the Manually-Syndicate destinations so no manual post can target it either.
const MANUAL_DESTS = ['discord', 'reddit', 'x', 'linkedin', 'bluesky', 'devto', 'hashnode', 'dailydev']; // SOW-137: hashnode (auto) + dailydev (manual) were missing the Manually-Syndicate surface

const FEATURED_ENV = { post: 'DISCORD_CHANNEL_POSTS', product: 'DISCORD_CHANNEL_PRODUCTS', prompt: 'DISCORD_CHANNEL_PROMPTS', share: 'DISCORD_CHANNEL_SHARES' };

async function gate(request, env, { fetchImpl, authorize }) {
  const auth = await authorize(request, env, { fetchImpl });
  if (!auth.ok) return { deny: auth };
  if (auth.role !== ROLE.superadmin) {
    return { deny: { status: 403, body: { error: 'forbidden', message: 'superadmin access is required to syndicate manually' } } };
  }
  return { auth };
}

/** GET: readiness + templates + the category channel map, one call for the whole popup. */
export async function handleSyndicateNowInfo(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, fetchImpl = globalThis.fetch, authorize = authorizeAdmin } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  const g = await gate(request, env, { fetchImpl, authorize });
  if (g.deny) return g.deny;

  const cfg = await readSyndicationConfig(kv);
  const channelMap = await readContentChannels(kv);
  const destinations = MANUAL_DESTS.map((id) => {
    // SOW-137: a MANUAL-capability destination (x, linkedin, dailydev) posts by enqueuing a Social Queue task,
    // not by calling an API, so it needs NO secrets and is always ready. Only an AUTO destination (posted via
    // its adapter) gates on secret presence.
    if (channelCapability(id) === 'manual') return { id, ready: true };
    const ready = secretsPresent(env, id);
    return ready ? { id, ready: true } : { id, ready: false, reason: 'missing secrets' };
  });
  const templates = {};
  for (const t of TEMPLATE_TYPES) templates[t] = templateFor(cfg, t) ?? DEFAULT_TEMPLATES[t] ?? '';
  // SOW-088: the per-channel overrides ride along so the popup resolves channel-aware defaults
  // (the reddit tile's own set when destination = reddit) with the same fallback chain.
  const channelTemplates = cfg.channel_templates ?? {};
  // SOW-088 Proposal A: the STUB maps + the built-in stub defaults (per-channel keyed; '' = the shared
  // fallbacks) so the popup resolves the members chain exactly like templateFor does.
  const stubTemplates = cfg.stub_templates ?? {};
  const channelTemplatesStub = cfg.channel_templates_stub ?? {};
  const stubDefaults = { ...DEFAULT_CHANNEL_STUB_TEMPLATES, '': DEFAULT_STUB_TEMPLATES };
  const featured = {};
  for (const [type, key] of Object.entries(FEATURED_ENV)) featured[type] = env?.[key] || null;
  return { status: 200, body: { ok: true, destinations, templates, channelTemplates, stubTemplates, channelTemplatesStub, stubDefaults, channelMap: channelMap?.channels ?? [], featured } };
}

/** POST: render the edited template server-side and post one item to one destination now. */
/**
 * Resolve the author's REAL Discord mention (<@id>) so {member-discord-username} links instead of reading
 * as plain text: github login -> github_id (the GitHub users API, on the caller's own bearer) -> the Stripe
 * customer's discord_user_id (the registry, SOW-002). Fail-soft: any miss returns null and the template
 * falls back to the profile handle / GitHub username.
 */
/** SOW-088: the guild leg alone (no caller bearer needed) — shared with the auto drain. */
export async function resolveGuildMention(env, item, { fetchImpl = globalThis.fetch, makeDiscord = createDiscordClient } = {}) {
  try {
    if (!env?.DISCORD_BOT_TOKEN || !env?.DISCORD_GUILD_ID) return null;
    const discord = makeDiscord({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
    const handle = String(item.authorDiscord || '').trim().replace(/^@/, '');
    const login = String(item.author || '').trim();
    for (const q of [...new Set([handle, login].filter(Boolean))]) {
      const found = await discord.searchGuildMembers(env.DISCORD_GUILD_ID, q, { limit: 5 });
      const lc = q.toLowerCase();
      const hit = (Array.isArray(found) ? found : []).find((m) =>
        String(m?.user?.username || '').toLowerCase() === lc
        || String(m?.user?.global_name || '').toLowerCase() === lc
        || String(m?.nick || '').toLowerCase() === lc);
      if (hit?.user?.id) return `<@${hit.user.id}>`;
    }
  } catch { /* fail-soft */ }
  return null;
}

async function resolveAuthorMention(request, env, item, { fetchImpl, makeStripe, makeDiscord }) {
  const login = String(item.author || '').trim();
  if (!login) return null;
  // 1. The registry: github login -> github_id -> the Stripe customer's discord_user_id (SOW-002).
  try {
    if (env?.STRIPE_SECRET_KEY) {
      const auth = request.headers.get('Authorization') || '';
      const ghRes = await fetchImpl(`https://api.github.com/users/${encodeURIComponent(login)}`, {
        headers: { 'User-Agent': 'gbti-syndicate/0.1', Accept: 'application/vnd.github+json', ...(auth ? { Authorization: auth } : {}) },
      });
      if (ghRes?.ok) {
        const githubId = String((await ghRes.json())?.id ?? '');
        if (githubId) {
          const stripe = makeStripe({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl });
          const customer = await stripe.findCustomerByGithubId(githubId);
          const discordId = String(customer?.metadata?.discord_user_id ?? '').trim();
          if (/^\d{5,}$/.test(discordId)) return `<@${discordId}>`;
        }
      }
    }
  } catch { /* fall through to the guild search */ }
  // 2. The guild itself: an exact username / display-name match via the member search (the registry has no
  // customer until the member completes signup, but the bot can see who is in the guild right now).
  return resolveGuildMention(env, item, { fetchImpl, makeDiscord });
}

export async function handleSyndicateNow(request, env, deps = {}) {
  const { kv = env?.SIGNUP_KV, now = Date.now, fetchImpl = globalThis.fetch, authorize = authorizeAdmin, adapters = null, postDiscord = postToChannel, makeStripe = createStripeClient, makeDiscord = createDiscordClient } = deps;
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the syndication store is not configured' } };
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const g = await gate(request, env, { fetchImpl, authorize });
  if (g.deny) return g.deny;

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const destination = String(payload?.destination || '');
  if (!MANUAL_DESTS.includes(destination)) return { status: 400, body: { error: 'invalid', message: 'unknown destination' } };
  const template = String(payload?.template || '').trim();
  if (!template) return { status: 400, body: { error: 'invalid', message: 'a message template is required' } };
  // Reddit options (Radle-style): the post kind (link | self) and an optional templated BODY. Both are
  // rendered/sanitized SERVER-side like the title template; other destinations ignore them.
  const redditKind = payload?.redditKind === 'self' ? 'self' : 'link';
  const bodyTemplate = String(payload?.bodyTemplate || '').trim();
  const commentTemplate = String(payload?.commentTemplate || '').trim(); // the separately-templated first comment
  // dev.to options: the byline template (rendered server-side like everything else) + the draft flag.
  const devtoIntroTemplate = String(payload?.devtoIntroTemplate || '').trim();
  const devtoFooterTemplate = String(payload?.devtoFooterTemplate || '').trim();
  const devtoStubTemplate = String(payload?.devtoStubTemplate || '').trim();
  // SOW-138: the PUBLIC body template travels RAW to the adapter ({body} resolves there, where the fetched
  // article is available); it is NOT server-rendered here like the byline/footer/stub.
  const devtoBodyTemplate = String(payload?.devtoBodyTemplate || '').trim();
  const devtoDraft = payload?.devtoDraft === true;

  // The queue-item builder is the validation boundary: type whitelist, slug required, and the no-body
  // guard (a body/encryptedBody never reaches the queue or a channel).
  let item;
  try { item = buildQueueItem({ ...(payload?.item ?? {}), trigger: 'manual' }, { now, holdMs: 0 }); }
  catch (err) { return { status: 400, body: { error: 'invalid', message: `invalid item: ${err.message}` } }; }

  // A REAL Discord mention for the author when the registry knows them (fail-soft to the text fallback).
  if (destination === 'discord' && !item.mention) {
    const mention = await resolveAuthorMention(request, env, item, { fetchImpl, makeStripe, makeDiscord });
    if (mention) item = { ...item, mention };
  }

  const cfg = await readSyndicationConfig(kv);
  const text = renderTemplate(template, item, { limit: channelLimit(destination) });

  // SOW-121: a MANUAL-capability destination (x, linkedin) is NEVER posted via an API from here. Enqueue a
  // Social Queue task with the popup's rendered text; a superadmin posts it by hand through the free web
  // composer, then marks it done. Returns "queued". An AUTO-capability destination posts directly below
  // regardless of its matrix cell: this is an explicit superadmin action, so the moderator has already seen
  // the exact text (an On-Manual cell only routes the AUTOMATIC pipeline through the queue).
  if (channelCapability(destination) === 'manual') {
    const task = buildSocialTask({ item, channel: destination, text, trigger: 'manual', now: Number(now()) });
    await putTask(kv, task);
    return { status: 200, body: { ok: true, queued: true, id: task.id, destination, message: `Queued to the Social Queue for a manual post to ${destination}.` } };
  }

  let result;
  let channelRecordKey = destination;
  if (destination === 'discord') {
    const channelId = String(payload?.channelId || '').trim();
    if (!/^\d{5,}$/.test(channelId)) return { status: 400, body: { error: 'invalid', message: 'a Discord channel id is required' } };
    if (!secretsPresent(env, 'discord')) return { status: 409, body: { error: 'not_configured', message: 'the Discord bot token is not configured' } };
    channelRecordKey = `discord:${channelId}`;
    try { result = await postDiscord(channelId, item, { env, fetchImpl, cfg, textOverride: text }); }
    catch (err) { result = { ok: false, error: err?.message || 'discord post failed' }; }
    // SOW-088: the optional SECONDARY destination — FORWARD the original post (the Discord forward, same as
    // the client UI's Forward action) to the category-mapped channel. Fail-soft: a forward miss never
    // un-sends the primary post; it is recorded separately.
    const forwardChannelId = String(payload?.forwardChannelId || '').trim();
    if (result?.ok && result.id && /^\d{5,}$/.test(forwardChannelId) && forwardChannelId !== channelId) {
      try {
        const discord = makeDiscord({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
        const fwd = await discord.forwardChannelMessage(forwardChannelId, { messageId: result.id, fromChannelId: channelId, guildId: env.DISCORD_GUILD_ID || null });
        result.forwarded = { channelId: forwardChannelId, id: fwd?.id ?? null };
      } catch (err) {
        result.forwarded = { channelId: forwardChannelId, error: err?.message || 'forward failed' };
      }
    }
  } else {
    if (!secretsPresent(env, destination)) return { status: 409, body: { error: 'not_configured', message: `${destination} is not configured (missing secrets)` } };
    const set = adapters ?? buildAdapters({ env, fetchImpl, cfg });
    const adapter = set[destination];
    if (!adapter) return { status: 400, body: { error: 'invalid', message: 'unknown destination' } };
    const extras = destination === 'reddit'
      ? {
          redditKind,
          ...(bodyTemplate ? { bodyText: renderTemplate(bodyTemplate, item, { limit: 9500 }) } : {}),
          ...(commentTemplate ? { commentText: renderTemplate(commentTemplate, item, { limit: 9500 }) } : {}),
        }
      : destination === 'devto'
        ? {
            devtoDraft,
            // The byline + the CTA footer: the popup's edits, else the stored templates
            // (channel override -> shared -> built-in).
            devtoIntro: renderTemplate(devtoIntroTemplate || templateFor(cfg, 'devto-intro', 'devto', { stub: item.membersOnly === true }) || '', item, { limit: 800 }),
            devtoFooter: renderTemplate(devtoFooterTemplate || templateFor(cfg, 'devto-footer', 'devto', { stub: item.membersOnly === true }) || '', item, { limit: 1200 }),
            devtoStub: renderTemplate(devtoStubTemplate || templateFor(cfg, 'devto-stub', 'devto', { stub: true }) || '', item, { limit: 1200 }),
            // SOW-138: RAW (unrendered) so {body} resolves in the adapter; blank => the adapter uses the stored template.
            ...(devtoBodyTemplate ? { devtoBodyTemplate } : {}),
          }
        : {};
    try { result = await adapter.post({ ...item, textOverride: text, ...extras }); }
    catch (err) { result = { ok: false, error: err?.message || `${destination} post failed` }; }
  }

  // A SKIP (dev.to: a share / members-only / unpublished item) is a refusal, not a send: tell the popup
  // why and record nothing (the item never reached the destination).
  if (result?.ok && result?.skipped) {
    return { status: 409, body: { error: 'skipped', message: result.reason || 'the destination skipped this item' } };
  }

  // Tracker record: a terminal manual item (never in the pending index), so the syndication tracker and
  // the popup's prior-send warning both see it. The dedupe pointer is set only when absent so the CI
  // enqueue path still treats the item as already syndicated.
  const at = Number(now());
  const channelRecords = { [channelRecordKey]: result?.ok ? { status: 'sent', id: result.id ?? null, url: result.url ?? null, at } : { status: 'failed', error: result?.error || 'post failed', at } };
  if (result?.forwarded) {
    channelRecords[`discord-forward:${result.forwarded.channelId}`] = result.forwarded.error
      ? { status: 'failed', error: result.forwarded.error, at }
      : { status: 'sent', id: result.forwarded.id, url: null, at };
  }
  const recorded = {
    ...item,
    status: result?.ok && !result?.skipped ? 'sent' : 'failed',
    channels: channelRecords,
    sentAt: result?.ok ? at : null,
    manualBy: g.auth.githubId ?? null,
  };
  await putItem(kv, recorded);
  let superseded = null;
  try {
    const dk = SYND_DEDUPE_KEY(dedupeKey(item));
    const pointer = await kv.get(dk);
    if (!pointer) {
      await kv.put(dk, item.id);
    } else if (result?.ok && pointer !== item.id) {
      // The item was ALREADY in the auto queue (enqueued on merge, waiting on approval/hold). The manual
      // send supersedes it: cancel the twin so it can never double-post once auto-posting is on, and
      // repoint the dedupe at the manual record.
      const twin = await getItem(kv, pointer);
      if (twin && canCancel(twin)) {
        await putItem(kv, { ...markCancelled(twin, { now, actor: g.auth.githubId }), cancelReason: 'superseded by a manual post' });
        await removeFromPending(kv, twin.id);
        superseded = twin.id;
      }
      await kv.put(dk, item.id);
    }
  } catch { /* dedupe is best-effort; the post already happened */ }

  if (!result?.ok) return { status: 502, body: { error: 'post_failed', message: result?.error || 'the destination refused the post', itemId: recorded.id } };
  return { status: 200, body: { ok: true, sent: true, destination, id: result.id ?? null, url: result.url ?? null, forwarded: result.forwarded ?? null, comment: result.comment ?? null, draft: result.draft === true, superseded, itemId: recorded.id, text } };
}
