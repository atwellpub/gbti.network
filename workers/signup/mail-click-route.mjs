// sow-273 follow-up: the digest click counter, the IO half. The rules live in membership/mail-click.mjs.
//
//   GET /c/<issueId>/<placement>/<slot>  ->  302 to the destination that slot names inside that frozen issue
//
// WHY A REDIRECT ROUTE AND NOT ANALYTICS. Cloudflare Web Analytics cannot read the digest's utm tags: its RUM
// dataset stores a url as host, path and scheme, with no query-string field anywhere across 38 types and
// 1,234 field names (verified 2026-08-24). The tags are collected and discarded. Counting here is the only
// way an issue's performance is knowable, and it is also the only way a click on a NEWS link is knowable at
// all, since those leave for a publisher we have no visibility into.
//
// THE OPEN-REDIRECT PROPERTY IS STRUCTURAL. The request carries no destination, only a hash of one. The
// destination is recovered by rebuilding the candidate set from the FROZEN issue in KV and matching. There is
// no input that can name an arbitrary target, so there is nothing to filter and no allowlist to fall behind.
// An unmatched slot sends the reader to the site root and is counted as unresolved.
//
// NOTHING ABOUT THE READER IS RECORDED. Not a recipient hash, not an address, not an IP, not a user agent.
// The store answers "how many clicks did this placement get in this issue" and is structurally incapable of
// answering "did this person click". That keeps a counting feature out of a data-protection question it has
// no need to be in, and it is why this store is deliberately NOT the sow-059 /touch store: a touch is about a
// member, a click count is about an issue, and merging them would give the merged thing the worse privacy
// posture of the two.
import { parseClickPath, resolveClick, clickKey, applyClick, taggedTarget, resolveSiteUrl } from '../../membership/mail-click.mjs';

/**
 * Handle a click. Returns a Response.
 *
 * A REDIRECT MUST HAPPEN EVEN WHEN EVERYTHING ELSE FAILS. The reader clicked a link in an email and their
 * experience cannot depend on our KV being reachable, on the issue still existing, or on the counter write
 * succeeding. So every failure path below still ends in a redirect, and the counting is best-effort around
 * it. A newsletter whose links break because a counter is down is worse than an uncounted newsletter.
 */
export async function handleMailClick(request, env, { now = Date.now } = {}) {
  const siteUrl = resolveSiteUrl(env);
  const kv = env?.SIGNUP_KV;
  const parsed = parseClickPath(new URL(request.url).pathname);
  if (!parsed) return redirect(siteUrl);

  let issue = null;
  try { issue = kv ? await kv.get(`mail:issue:${parsed.issueId}`, 'json') : null; } catch { issue = null; }

  const target = issue ? resolveClick(issue, siteUrl, parsed.slot) : null;
  const resolved = Boolean(target);
  const destination = resolved
    ? taggedTarget(target, { siteUrl, campaign: parsed.issueId, placement: parsed.placement })
    : siteUrl;

  // Best-effort, and read-modify-write. THE RACE IS REAL AND ACCEPTED: two clicks landing inside the same
  // read-write window lose one count. KV has no atomic increment, and at this newsletter's scale (tens of
  // recipients) an occasional lost count is worth far less than the complexity of a per-click key with its
  // own compaction. If the list ever reaches a size where this matters, that is the moment to revisit it,
  // and this comment is here so that decision is made deliberately rather than discovered.
  if (kv) {
    try {
      const key = clickKey(parsed.issueId);
      const current = await kv.get(key, 'json');
      const next = applyClick(current ?? { issueId: parsed.issueId }, {
        placement: parsed.placement, slot: parsed.slot, resolved, now,
      });
      next.issueId = parsed.issueId;
      await kv.put(key, JSON.stringify(next));
    } catch { /* counting is never allowed to cost the reader their click */ }
  }

  return redirect(destination);
}

function redirect(location) {
  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      // Never cached: a cached redirect would be counted once and followed many times, and the count is the
      // entire point of the route existing.
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      // A digest link is a click, not a referral into the destination's analytics as coming from the Worker.
      'Referrer-Policy': 'no-referrer',
    },
  });
}
