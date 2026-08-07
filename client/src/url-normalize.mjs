// sow-190: strip known TRACKING parameters from a member-supplied outbound link (a share's url). A DENYLIST,
// never an allowlist and never a blanket query strip: a share is often a video whose query carries FUNCTIONAL
// params (YouTube's `v` is the video id, `t` a start timestamp, `list`/`start_radio` a playlist), and dropping
// those breaks both the destination AND the SOW-092 inline player (embedUrl in ./video-embed.mjs). So only
// tokens that are UNAMBIGUOUSLY tracking/attribution are removed here; ambiguous short ones (s, ref, feature,
// pp, spm, share_id) are deliberately LEFT for a later owner decision on how aggressive to be, and playlist
// context (list/start_radio) is left as functional. (Note: YouTube's attribution param is `si`; a pasted `is`
// is a typo for it and is left alone as an unknown param, not stripped.) Pure, node-free, imported by every host + the Astro site,
// mirroring the one-shared-extractor pattern of video-embed.mjs.
//
// Fails OPEN: a non-http(s) string, or an unparseable URL, is returned UNCHANGED (a bad link must still be
// shareable, never blocked by normalization). Preserves the original string EXACTLY when nothing is stripped
// (no gratuitous re-encoding of a clean url).

// Exact-match tracking keys (compared case-insensitively). Universally-recognized attribution/analytics only.
const TRACKING_KEYS = new Set([
  'si',          // YouTube per-share attribution token (the reported case)
  'fbclid',      // Facebook click id
  'gclid',       // Google Ads click id
  'igshid',      // Instagram share id
  'mc_cid',      // Mailchimp campaign id
  'mc_eid',      // Mailchimp recipient id
  'ab_channel',  // YouTube channel-attribution on a watch url
]);

// Prefix families (case-insensitive): utm_source, utm_medium, utm_campaign, utm_term, utm_content, ...
const TRACKING_PREFIXES = ['utm_'];

function isTrackingKey(key) {
  const k = String(key).toLowerCase();
  if (TRACKING_KEYS.has(k)) return true;
  return TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Remove unambiguous tracking parameters from an http(s) URL. Returns the cleaned URL string, or the input
 * unchanged when it is not a parseable http(s) URL or carries no tracking parameter. Pure.
 */
export function stripTrackingParams(input) {
  const s = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return s; // fail open: not an http(s) URL, leave it alone
  let u;
  try { u = new URL(s); } catch { return s; } // unparseable, leave it alone
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingKey(key)) { u.searchParams.delete(key); changed = true; }
  }
  if (!changed) return s; // nothing tracking: preserve the original string exactly (no re-encoding)
  const qs = u.searchParams.toString();
  u.search = qs ? `?${qs}` : ''; // drop a now-empty '?' so a fully-cleaned url is bare
  return u.toString();
}
