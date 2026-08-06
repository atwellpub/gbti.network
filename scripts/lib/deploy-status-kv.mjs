// sow-185: the "still deploying" signal for public content pages. deploy.yml calls this on every push to
// main: before the build, mark whichever content items changed as pending (so a visitor lands on a page and
// can be told a fresher version is on the way); after a successful deploy, clear those same markers. Runs in
// GitHub Actions (no native KV binding), so it talks to SIGNUP_KV over the Cloudflare REST API, gated behind
// CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN exactly like scripts/lib/kv-mirror.mjs's writes -- missing
// credentials is a reported no-op, not a throw; a real API error throws so the workflow fails loudly.
//
// The watermark (deploy:last-marked-sha) is what makes this robust to deploy.yml's own concurrency group: that
// workflow already serializes all deploys one at a time and SKIPS (never runs) every queued run except the
// newest once a new push arrives mid-deploy. A skipped run's steps never execute, so diffing only that push's
// own immediate before/after would silently lose whatever changed in the skipped runs. Diffing from a durable
// watermark instead means whichever run actually executes always closes the FULL range since the last run
// that ran, no matter how many were skipped in between.
//
// Accepted tradeoff: a batch only advances the watermark once EVERY item in it is confirmed marked (see
// scripts/deploy-status.mjs's mark()) -- a single durably-failing item (not just a transient one) would
// freeze the watermark, so every subsequent push re-diffs the same growing range and re-attempts the FULL
// accumulated list, not just the stuck item. No per-item retry/skip-and-continue is implemented; this is a
// deliberate simplicity choice for a small-scale site, not an oversight -- a durable KV failure would show up
// loudly in every deploy's logs long before the accumulated batch became a real cost.

import { classifyContentPath } from './content-syndication.mjs';

export const WATERMARK_KV_KEY = 'deploy:last-marked-sha';
// Real deploys observed end to end in under 2 minutes; 10 minutes is generous headroom so a failed or stuck
// deploy self-clears rather than telling visitors a page is "still deploying" indefinitely.
export const PENDING_TTL_SECONDS = 600;
// The SHA GitHub sends as `before` for a push with no prior history (a brand new branch, or the repo's very
// first push) -- there is nothing to diff against, so this must NOT be treated as a real commit to diff from.
export const NULL_SHA = '0000000000000000000000000000000000000000';

function pendingKey(type, slug) {
  return `pendingdeploy:${type}:${slug}`;
}

/**
 * Decide which SHA to diff FROM: the durable watermark if one is stored (closes the full accumulated range
 * since the last run that actually executed, robust to any number of runs skipped in between by deploy.yml's
 * own concurrency group); otherwise this push's own `before` (the ordinary case, e.g. the very first run
 * before this watermark has ever been written); otherwise null (a genuinely first push, nothing to diff --
 * the caller falls back to `git show` against just the one new commit). Pure: no I/O.
 */
export function resolveDiffFrom(watermark, pushBefore) {
  if (watermark) return watermark;
  if (pushBefore && pushBefore !== NULL_SHA) return pushBefore;
  return null;
}

/**
 * Classify a list of changed repo-relative paths down to the distinct { type, slug } content items among them.
 * Path-only (it never reads the file's own frontmatter), so a draft or a members-only Mode A edit (no public
 * page ever renders for it) still gets marked pending -- an accepted, self-bounding tradeoff: the marker is
 * simply never queried (no [slug].astro page exists to embed the notice for it) and expires via the TTL.
 */
export function contentPathsChanged(paths) {
  const seen = new Map();
  for (const p of Array.isArray(paths) ? paths : []) {
    const item = classifyContentPath(p);
    if (!item || item.type === 'share') continue; // shares have no public page (hasPublicPage is always false)
    seen.set(`${item.type}:${item.slug}`, item);
  }
  return [...seen.values()];
}

function creds(env) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  return accountId && namespaceId && apiToken ? { accountId, namespaceId, apiToken } : null;
}

function kvUrl({ accountId, namespaceId }, key, query = '') {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}${query}`;
}

const NO_CREDS = 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set';

/**
 * Read the watermark SHA, or null if unset or credentials are missing (the caller falls back to the push
 * event's own `before` SHA in that case -- e.g. the very first run before this key has ever been written).
 */
export async function readWatermark({ env = process.env, fetchImpl = globalThis.fetch, key = WATERMARK_KV_KEY } = {}) {
  const c = creds(env);
  if (!c) return null;
  const res = await fetchImpl(kvUrl(c, key), { headers: { Authorization: `Bearer ${c.apiToken}` } });
  if (!res || res.status === 404) return null;
  if (!res.ok) throw new Error(`watermark read failed: ${res.status}`);
  const text = (await res.text()).trim();
  return text || null;
}

/** Advance the watermark to the given SHA. Creds-gated no-op, like kv-mirror.mjs's writes. */
export async function writeWatermark(sha, { env = process.env, fetchImpl = globalThis.fetch, key = WATERMARK_KV_KEY } = {}) {
  const c = creds(env);
  if (!c) return { written: false, reason: NO_CREDS };
  const res = await fetchImpl(kvUrl(c, key), {
    method: 'PUT',
    headers: { Authorization: `Bearer ${c.apiToken}`, 'Content-Type': 'text/plain' },
    body: sha,
  });
  if (!res || !res.ok) throw new Error(`watermark write failed: ${res ? res.status : 'no response'}`);
  return { written: true };
}

/** Mark each { type, slug } item pending, with the TTL safety backstop. Creds-gated no-op. */
export async function markPendingDeploy(items, { env = process.env, fetchImpl = globalThis.fetch, now = new Date(), ttlSeconds = PENDING_TTL_SECONDS } = {}) {
  const c = creds(env);
  if (!c) return { written: false, reason: NO_CREDS, marked: [] };
  const body = JSON.stringify({ startedAt: now.toISOString() });
  const marked = [];
  for (const { type, slug } of items) {
    const key = pendingKey(type, slug);
    const res = await fetchImpl(kvUrl(c, key, `?expiration_ttl=${ttlSeconds}`), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${c.apiToken}`, 'Content-Type': 'text/plain' },
      body,
    });
    if (!res || !res.ok) throw new Error(`mark pending failed for ${key}: ${res ? res.status : 'no response'}`);
    marked.push(key);
  }
  return { written: true, marked };
}

/** Clear the pending markers for each { type, slug } item (the deploy succeeded). Creds-gated no-op. */
export async function clearPendingDeploy(items, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const c = creds(env);
  if (!c) return { written: false, reason: NO_CREDS, cleared: [] };
  const cleared = [];
  for (const { type, slug } of items) {
    const key = pendingKey(type, slug);
    const res = await fetchImpl(kvUrl(c, key), { method: 'DELETE', headers: { Authorization: `Bearer ${c.apiToken}` } });
    // Cloudflare's KV DELETE is idempotent (a missing key still returns 200), so no special 404 handling needed.
    if (!res || !res.ok) throw new Error(`clear pending failed for ${key}: ${res ? res.status : 'no response'}`);
    cleared.push(key);
  }
  return { written: true, cleared };
}
