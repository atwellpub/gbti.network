// The digest OPEN counter rules, the pure half (the IO half is workers/signup/mail-open-route.mjs). Mirrors
// membership/mail-click.mjs: a per-ISSUE aggregate, anonymous by construction.
//
//   GET /o/<issueId>  ->  a 1x1 gif, and one open counted against that issue
//
// NOTHING ABOUT THE READER IS RECORDED. Not a recipient hash, address, IP, or user agent. The store answers
// "how many opens did this issue get" and is structurally incapable of answering "did this person open it",
// exactly like the click store. An open pixel is the industry-standard open signal, and it is inherently
// approximate: image-proxying clients (Apple Mail Privacy Protection, Gmail's proxy) pre-fetch it, inflating
// the count, and image-blocking clients never fetch it, deflating it. The number is a trend, not a headcount.
//
// A pixel URL is public and un-authenticated, so a stranger could hit /o/<id> to nudge a count. The id shape
// gate below keeps a junk id from creating an arbitrary KV key; beyond that, an inflated count on our own
// analytics is not worth per-IP state (same posture as the click route).

export const OPEN_PREFIX = 'mail:opens:';
export const openKey = (issueId) => `${OPEN_PREFIX}${issueId}`;

// The three issue-id kinds are weekly-/welcome-/test- followed by an ISO date (membership/mail-compile-core.mjs).
// A strict shape gate means /o/<garbage> returns the pixel but writes no junk key.
const ISSUE_ID_RE = /^[a-z][a-z0-9]*-\d{4}-\d{2}-\d{2}$/;
export function isIssueIdShape(id) {
  return ISSUE_ID_RE.test(String(id ?? ''));
}

export function parseOpenPath(pathname) {
  const m = /^\/o\/([^/]+)\/?$/.exec(String(pathname ?? ''));
  if (!m) return null;
  try {
    return { issueId: decodeURIComponent(m[1]) };
  } catch {
    return null;
  }
}

export function emptyOpens(issueId) {
  return { issueId: String(issueId ?? ''), total: 0, firstAt: null, lastAt: null };
}

/** Fold one open into the per-issue aggregate. Read-modify-write; the lost-count race is real and accepted, the
 *  same trade the click store makes. */
export function applyOpen(record, { now = Date.now } = {}) {
  const at = Number(typeof now === 'function' ? now() : now);
  const r = record && typeof record === 'object'
    ? { ...emptyOpens(record.issueId), ...record }
    : emptyOpens('');
  r.total += 1;
  if (!Number.isFinite(r.firstAt)) r.firstAt = at;
  r.lastAt = at;
  return r;
}

// A 1x1 transparent GIF. The pixel loads (not display:none) so an image-loading client actually fetches it,
// which is the only way the open registers.
export const TRANSPARENT_GIF_BASE64 = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
