// SOW-166: emits /shares-index.json at build time, the newest-first list of PUBLIC member shares the weekly
// email digest compile reads for its Shares section. Shares are excluded from activity-index.json (that feed
// is the extension's), so the digest needs its own public-shares artifact.
//
// PUBLIC shares ONLY (isPublicShare: status published AND visibility public, fail closed), matching the
// SOW-136/094 site feed and the /shares/<author>/<id>/ pages. The projection + guard live in the pure,
// unit-tested buildSharesIndex; this endpoint is a thin wrapper. Even a members-only share that somehow
// reached this artifact is dropped again by the digest composition core (mail-digest isPublicItem), so this
// is the first of two guards, not the only one. Metadata only (title/author/url/date), no bodies, no
// behavioral data, wildcard origin (public content), refreshed on each deploy.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { buildSharesIndex } from '../lib/shares-index.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const entries = buildSharesIndex(await getCollection('share'));
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
