// sow-185: GET /membership/deploy-status?type=post&slug=<slug> -- PUBLIC, no auth. Tells a visitor whether
// this content item changed in a push that has not finished deploying yet, so the public page can show a
// "still deploying" notice instead of silently rendering stale content with no explanation. Reads the
// pendingdeploy:<type>:<slug> marker deploy.yml writes/clears (scripts/lib/deploy-status-kv.mjs is the
// GitHub-Actions-side writer). Not sensitive -- the same fact is derivable from the public repo's own commit
// history regardless -- so this stays a plain unauthenticated KV read with no identity/CORS-credential
// plumbing. Fails OPEN (missing KV, malformed record) to { pending: false }: this is an informational nicety,
// never a gate, so a misconfiguration must never block or blank a page render.
import { shapeDeployStatus } from '../../membership/deploy-status.mjs';

const VALID_TYPES = new Set(['post', 'product', 'prompt']);
// Must be at least as permissive as the real content schema's own slug regex (src/content.config.ts:
// z.string().regex(/^[a-z0-9-]+$/), no leading-character restriction, no length cap) -- a stricter check here
// would 400 for a schema-valid slug (e.g. a leading hyphen) and the client fails open to silently never
// showing the notice for that item. The 200-char cap is a sanity bound against abuse, not a real content limit.
const validSlug = (s) => typeof s === 'string' && s.length <= 200 && /^[a-z0-9-]+$/.test(s);

export async function membershipDeployStatus(request, env, { kv = env?.SIGNUP_KV, now = () => new Date() } = {}) {
  const url = new URL(request.url);
  const type = url.searchParams.get('type') || '';
  const slug = url.searchParams.get('slug') || '';
  if (!VALID_TYPES.has(type) || !validSlug(slug)) {
    return { status: 400, body: { error: 'bad_request', message: 'a valid type + slug is required' } };
  }
  if (!kv) return { status: 200, body: { pending: false } };
  let raw = null;
  try { raw = await kv.get(`pendingdeploy:${type}:${slug}`, 'json'); } catch { raw = null; }
  return { status: 200, body: shapeDeployStatus(raw, { now: now() }) };
}
