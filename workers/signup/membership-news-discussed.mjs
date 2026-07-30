// SOW-046 D: reflect a news DISCUSSION back onto its Discord post. When a member starts discussing a news item
// that was already posted to Discord (a news-posted:<guid> record exists), this appends a one-time notice
// ("members are discussing this") to that Discord message, so the channel learns the conversation has started.
//
// SOW-111: a comment is now also the FIRST engagement signal. When NO news-posted record exists and the
// news_engagement config allows it (enabled + comment_autopost, read from the synd:config KV mirror), the
// member's first comment AUTO-POSTS the item to its category-mapped channel via the shared postNewsItemOnce
// core (canonical resolution, fail-closed routing, guid dedupe; stamped by:'auto:comment'), and the discussion
// notice is appended in the same request. Config off, an off-feed guid, or an unmapped category = the clean
// no-op this route always returned.
//
//   POST /membership/news-discussed { guid, source? } -> { ok, reflected, posted? }   (effective-paid)
//
// Idempotent: the notice is appended ONCE (guarded by `discussionNoticedAt` on the dedupe record). The Discord
// bot token never leaves the Worker. Pure over injected authorize/discord/kv/now.

import { authorizePaid } from './membership-content.mjs';
import { NEWS_POSTED_KEY, postNewsItemOnce } from './membership-news-publish.mjs';
import { readSyndicationConfig } from './syndication-store.mjs';
import { newsEngagement } from '../../membership/syndication-config-core.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';

const NOTICE = '\n\n💬 Members are discussing this in the GBTI extension.';

/** POST /membership/news-discussed { guid, source? } -> auto-posts on the first comment (SOW-111) and appends
 *  the discussion notice to the news item's Discord post once. */
export async function membershipNewsDiscussed(request, env, { authorize = authorizePaid, fetch = globalThis.fetch, kv = env?.SIGNUP_KV, discord = null, now = () => new Date().toISOString(), postOnce = postNewsItemOnce, allowCookie = false } = {}) {
  const auth = await authorize(request, env, { allowCookie }); // sow-158: website cookie opts in (POST -> CSRF gate)
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the dedupe store is not configured' } };

  let req;
  try { req = await request.json(); } catch { req = null; }
  const guid = String(req?.guid || '').trim();
  const sourceHint = req?.source ? String(req.source) : undefined;
  if (!guid) return { status: 400, body: { error: 'bad_request', message: 'a news item guid is required' } };

  let record = await kv.get(NEWS_POSTED_KEY(guid), 'json');
  let posted = false;
  if (!record) {
    // SOW-111: the first comment on an unposted item auto-posts it when the config allows.
    const engagement = newsEngagement(await readSyndicationConfig(kv));
    if (engagement.enabled && engagement.comment_autopost) {
      const r = await postOnce(env, { guid, source: sourceHint, by: 'auto:comment' }, { kv, fetch, discord, now });
      if (r.ok && r.posted) {
        record = r.record;
        posted = true;
      }
      // not_found / unmapped / discord failure: fall through to the clean no-op below (never an error).
    }
  }
  // Not posted to Discord (or no channel/message) -> nothing to reflect; a clean no-op, not an error.
  if (!record || !record.channelId || !record.messageId) return { status: 200, body: { ok: true, reflected: false, reason: 'not posted to Discord' } };
  if (record.discussionNoticedAt) return { status: 200, body: { ok: true, reflected: false, already: true } };

  if (!env.DISCORD_BOT_TOKEN) return { status: 200, body: { ok: true, reflected: false, reason: 'Discord is not configured' } };
  const client = discord || createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch });
  const base = typeof record.content === 'string' ? record.content : '';
  try { await client.editChannelMessage(record.channelId, record.messageId, `${base}${NOTICE}`); }
  catch { return { status: 502, body: { error: 'discord_failed', message: 'could not update the Discord post' } }; }

  await kv.put(NEWS_POSTED_KEY(guid), JSON.stringify({ ...record, discussionNoticedAt: now() }));
  return { status: 200, body: { ok: true, reflected: true, posted } };
}
