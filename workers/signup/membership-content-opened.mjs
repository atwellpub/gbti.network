// SOW-126: POST /membership/content-opened { type, slug } — the member-content detail-open engagement beacon.
// Records the member's github_id in a per-item distinct-opener set (content-opens:<type>:<slug>,
// membership/content-opens.mjs). Unlike the SOW-111 news beacon it does NOT auto-post: promotion to the
// `popular` channels is RECONCILE-periodic (the owner's choice), so this endpoint only tallies opens. The
// reconcile aggregates the sets (excluding the item author) into house/open-counts.yml and promotes past the
// threshold.
//
// Gating: content_engagement.enabled AND the `opens` signal must be on, and the CONFIGURABLE
// content_engagement.tier decides whose opens count ('signed-in' default = any non-banned member; a banned
// account is denied by authorizeMember before any KV write). Off-tier / disabled / signal-off -> a 200 clean
// no-op ({ counted:false }) so the reader beacon never surfaces an error. Pure over injected authorize/kv/now.
//
// GDPR: the opener set holds raw github_ids outside the per-member activity key; erasure scrubs content-opens:*
// via scrubOpener (scripts/lib/erase-member.mjs).

import { authorizeMember } from './membership-content.mjs';
import { readSyndicationConfig } from './syndication-store.mjs';
import { contentEngagement } from '../../membership/syndication-config-core.mjs';
import { normalizeContentOpens, applyOpen, distinctOpenerCount, contentOpensKey, CONTENT_OPEN_TYPES } from '../../membership/content-opens.mjs';
import { tierAdmits } from './membership-news-opened.mjs';

// A bare content slug (post/product/prompt) or a share composite <author>/<id>. Bounded + no traversal.
function validSlug(type, slug) {
  const s = String(slug || '').trim();
  if (!s || s.length > 200 || s.includes('..')) return false;
  if (type === 'share') return /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/i.test(s);
  return /^[a-z0-9][a-z0-9-]*$/i.test(s);
}

export async function membershipContentOpened(request, env, {
  authorize = authorizeMember,
  fetchImpl = globalThis.fetch,
  kv = env?.SIGNUP_KV,
  now = Date.now,
  allowCookie = false, // sow-158: the website /browse reader opts in (a POST, so CSRF is enforced in resolveIdentity)
} = {}) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the open store is not configured' } };

  // Non-banned member gate first (a banned account never writes KV, SOW-077 posture).
  const auth = await authorize(request, env, { fetchImpl, allowCookie });
  if (!auth.ok) return auth;

  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  const type = String(payload?.type || '').trim().toLowerCase();
  const slug = String(payload?.slug || '').trim();
  if (!CONTENT_OPEN_TYPES.includes(type) || !validSlug(type, slug)) {
    return { status: 400, body: { error: 'bad_request', message: 'a valid content type + slug is required' } };
  }

  const engagement = contentEngagement(await readSyndicationConfig(kv));
  if (!engagement.enabled || !engagement.signals.opens) {
    return { status: 200, body: { ok: true, counted: false, reason: 'open-based auto-share is off' } };
  }
  if (!tierAdmits(engagement.tier, auth.status)) {
    return { status: 200, body: { ok: true, counted: false, reason: 'this membership tier does not count toward auto-share' } };
  }

  // Record the open (distinct-member set; a re-open is a no-op beyond the timestamp). The item author is NOT
  // excluded (the beacon does not know the author's github_id cheaply, and the reconcile promoter counts the raw
  // distinct openers): an author self-open counts toward their own item, an accepted bounded inflation on a
  // small network (see scripts/promote-popular.mjs header). Upvotes, by contrast, already exclude the author.
  const key = contentOpensKey(type, slug);
  const record = applyOpen(normalizeContentOpens(await kv.get(key, 'json')), { openerId: auth.githubId }, { now });
  await kv.put(key, JSON.stringify(record));
  return { status: 200, body: { ok: true, counted: true, openers: distinctOpenerCount(record) } };
}
