// SOW-076 P1b: the comment-echo edge store. When a member posts a comment, the client writes an optimistic ECHO
// here (instant read-your-writes) while the SOW-072 PR auto-merges + the site rebuilds behind it. Per target
// (commentecho:<targetType>:<targetSlug> in SIGNUP_KV); each echo records its AUTHOR github_id (taken from the
// verified token, NEVER trusted from the body). READ-YOUR-WRITES: a member sees only their OWN pending echoes for a
// thread (a not-yet-gate-vetted echo is never shown to other readers). Echoes self-expire (a backstop) and are reaped
// by the client when their comment lands/declines (membership/comment-echo.mjs mergeCommentEchoes) + by the reconcile
// sweep. The pure store ops are membership/comment-echo.mjs; this handler does only auth + the KV read-modify-write.
import { authorizeMemberCheap } from './membership-content.mjs';
import { githubFetchUser } from './oauth.mjs';
import { normalizeEchoRecord, addEcho, reapEchoes, CommentEchoError } from '../../membership/comment-echo.mjs';

export const ECHO_KEY = (targetType, targetSlug) => `commentecho:${targetType}:${targetSlug}`;
export const ECHO_TTL_SECONDS = 6 * 60 * 60; // a backstop: an un-reaped echo ages out in 6h (covers the gate + deploy)
// SOW-046 D allowed 'news' discussion at the client, but this whitelist never learned it, so a news
// comment stored NO echo (the write 400d fail-soft) and the fresh comment stayed invisible until the next
// deploy. Keep this set in lockstep with COMMENT_TARGET_TYPES (client/src/operations.mjs).
const TARGET_TYPES = new Set(['post', 'product', 'prompt', 'share', 'news']);
const validTarget = (t, s) => TARGET_TYPES.has(t) && typeof s === 'string' && !!s && s.length <= 200;

export async function handleCommentEcho(request, env, { fetchImpl = globalThis.fetch, fetchUser = githubFetchUser, kv = env?.SIGNUP_KV, now = Date.now, authorize = authorizeMemberCheap } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the comment echo store is not configured' } };
  const a = await authorize(request, env, { fetchImpl, fetchUser, kv, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!a.ok) return { status: a.status, body: a.body };
  const requester = String(a.githubId);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const targetType = url.searchParams.get('targetType') || '';
    const targetSlug = url.searchParams.get('targetSlug') || '';
    if (!validTarget(targetType, targetSlug)) return { status: 400, body: { error: 'bad_request', message: 'a valid targetType + targetSlug is required' } };
    const rec = normalizeEchoRecord(await kv.get(ECHO_KEY(targetType, targetSlug), 'json'));
    return { status: 200, body: { echoes: rec.echoes.filter((e) => e.author === requester) } }; // read-your-writes
  }

  if (request.method === 'POST') {
    let payload;
    try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

    if (payload?.action === 'add') {
      const echo = payload.echo || {};
      if (!validTarget(echo.targetType, echo.targetSlug)) return { status: 400, body: { error: 'bad_request', message: 'a valid target is required' } };
      const key = ECHO_KEY(echo.targetType, echo.targetSlug);
      let rec = normalizeEchoRecord(await kv.get(key, 'json'));
      try { rec = addEcho(rec, { ...echo, author: requester }, { now }); } // author = the authed member, never the body
      catch (err) { if (err instanceof CommentEchoError) return { status: 400, body: { error: 'invalid', message: err.message } }; throw err; }
      await kv.put(key, JSON.stringify(rec), { expirationTtl: ECHO_TTL_SECONDS });
      return { status: 200, body: { ok: true } };
    }

    if (payload?.action === 'reap') {
      const { targetType, targetSlug, ids } = payload;
      if (!validTarget(targetType, targetSlug) || !Array.isArray(ids)) return { status: 400, body: { error: 'bad_request', message: 'a valid target + ids[] are required' } };
      const key = ECHO_KEY(targetType, targetSlug);
      const rec = reapEchoes(normalizeEchoRecord(await kv.get(key, 'json')), ids, { author: requester }); // reap only your own
      await kv.put(key, JSON.stringify(rec), { expirationTtl: ECHO_TTL_SECONDS });
      return { status: 200, body: { ok: true } };
    }

    return { status: 400, body: { error: 'bad_request', message: 'unknown action (expected add | reap)' } };
  }

  return { status: 405, body: { error: 'method_not_allowed' } };
}
