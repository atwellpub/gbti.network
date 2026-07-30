// SOW-111: POST /membership/news-opened { guid, source? } — the news detail-open engagement beacon. Records
// the member's github_id in a per-guid distinct-opener set (news-opens:<guid>, membership/news-opens.mjs, the
// share-votes pattern) and, when the set reaches the configured open_threshold, AUTO-POSTS the item to its
// category-mapped Discord channel via the shared postNewsItemOnce core (one post per guid ever, across the
// curator, comment, and open triggers; stamped by:'auto:open').
//
// Gating: the CONFIGURABLE news_engagement.tier decides whose opens count — 'paid' (default), 'paid-trial',
// or 'signed-in' (any non-banned member; a banned account is always denied by authorizeMember before any KV
// write). A caller outside the tier, or a disabled config, gets a 200 clean no-op ({ counted:false }) so the
// reader beacon never surfaces an error. Fail-closed everywhere else (off-feed guid, unmapped category,
// missing bot token = nothing posts). Pure over injected authorize/kv/discord/now.
//
// GDPR: the opener set holds raw github_ids outside the per-member activity key; erasure scrubs news-opens:*
// via scrubOpener (scripts/lib/erase-member.mjs).

import { authorizeMember } from './membership-content.mjs';
import { readSyndicationConfig } from './syndication-store.mjs';
import { newsEngagement } from '../../membership/syndication-config-core.mjs';
import { normalizeNewsOpens, applyOpen, distinctOpenerCount, shouldPost, markPosted } from '../../membership/news-opens.mjs';
import { postNewsItemOnce } from './membership-news-publish.mjs';

export const NEWS_OPENS_KEY = (guid) => `news-opens:${String(guid).slice(0, 480)}`;

// Which effective statuses count for each configured tier (banned never reaches this: authorizeMember denies it).
const TIER_STATUSES = Object.freeze({
  paid: new Set(['paid']),
  'paid-trial': new Set(['paid', 'trialing']),
  'signed-in': null, // any non-banned member
});

/** Does this member's effective status count under the configured tier? An unknown tier falls back to paid. */
export function tierAdmits(tier, status) {
  const t = Object.hasOwn(TIER_STATUSES, String(tier)) ? String(tier) : 'paid';
  const allowed = TIER_STATUSES[t]; // null = any non-banned member (the signed-in tier)
  return allowed === null ? true : allowed.has(String(status || ''));
}

export async function membershipNewsOpened(request, env, {
  authorize = authorizeMember,
  fetchImpl = globalThis.fetch,
  kv = env?.SIGNUP_KV,
  discord = null,
  now = Date.now,
  postOnce = postNewsItemOnce,
  allowCookie = false, // sow-158: the website cookie session opts in (a POST, so CSRF is enforced in resolveIdentity)
} = {}) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the open store is not configured' } };

  // Non-banned member gate first (a banned account never writes KV, SOW-077 posture).
  const auth = await authorize(request, env, { fetchImpl, allowCookie });
  if (!auth.ok) return auth;

  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  const guid = String(payload?.guid || '').trim();
  const sourceHint = payload?.source ? String(payload.source) : undefined;
  if (!guid) return { status: 400, body: { error: 'bad_request', message: 'a news item guid is required' } };

  const engagement = newsEngagement(await readSyndicationConfig(kv));
  if (!engagement.enabled) return { status: 200, body: { ok: true, counted: false, reason: 'engagement auto-share is off' } };
  if (!tierAdmits(engagement.tier, auth.status)) {
    return { status: 200, body: { ok: true, counted: false, reason: 'this membership tier does not count toward auto-share' } };
  }

  // Record the open (distinct-member set; a re-open is a no-op beyond the timestamp).
  const key = NEWS_OPENS_KEY(guid);
  let record = applyOpen(normalizeNewsOpens(await kv.get(key, 'json')), { openerId: auth.githubId }, { now });

  let posted = false;
  if (shouldPost(record, engagement.open_threshold)) {
    // The shared core dedupes on news-posted:<guid>, so a comment/curator post already counts as done.
    const r = await postOnce(env, { guid, source: sourceHint, by: 'auto:open' }, { kv, fetch: fetchImpl, discord });
    posted = Boolean(r.ok && r.posted);
    // Stamp the watermark on ANY terminal outcome (posted, already posted, or unmapped): this record must not
    // re-resolve the feed on every later open. A transient not_found/discord failure leaves it unstamped so a
    // later open can retry.
    if (r.ok) record = markPosted(record, { now });
  }
  await kv.put(key, JSON.stringify(record));
  return { status: 200, body: { ok: true, counted: true, openers: distinctOpenerCount(record), posted } };
}
