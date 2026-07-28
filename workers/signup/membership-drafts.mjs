// SOW-157: the hosted draft store endpoint over KV (the follows/activity pattern).
//   GET  /membership/drafts                           -> { ok, drafts: [record] }   (the caller's own drafts)
//   POST /membership/drafts { op:'put', draft }       -> { ok, drafts }
//   POST /membership/drafts { op:'delete', type, slug } -> { ok, drafts }
//
// Auth = SIGNED-IN, non-banned (authorizeMember): TRIAL members may stage drafts (SOW-011 lets trials
// author; hosted trials have no fork, so this store IS their staging area, and nothing here ever reaches
// the canonical repo). Data is keyed `drafts:<github_id>`: per-member, private, ERASABLE (a hard KV delete,
// the SOW-024 right-to-erasure runbook). Pure transforms in membership/member-drafts.mjs; this handler only
// does auth + the read-modify-write, unit-tested with a fake KV + a stubbed authorizer.

import { authorizeMember } from './membership-content.mjs';
import { DraftError, normalizeDrafts, applyDraftPut, applyDraftDelete, listDraftRecords } from '../../membership/member-drafts.mjs';

export const DRAFTS_KEY = (githubId) => `drafts:${githubId}`;

export async function handleDrafts(request, env, { kv = env?.SIGNUP_KV, now, authorize = authorizeMember, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the draft store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const key = DRAFTS_KEY(auth.githubId);
  const method = request.method;

  if (method === 'GET') {
    const stored = await kv.get(key, 'json');
    return { status: 200, body: { ok: true, drafts: listDraftRecords(stored) } };
  }
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  const state = normalizeDrafts(await kv.get(key, 'json'));
  let next;
  try {
    if (payload?.op === 'put') next = applyDraftPut(state, payload.draft, now ? { now } : undefined);
    else if (payload?.op === 'delete') next = applyDraftDelete(state, { type: payload.type, slug: payload.slug });
    else return { status: 400, body: { error: 'bad_request', message: 'op must be put or delete' } };
  } catch (err) {
    if (err instanceof DraftError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }
  await kv.put(key, JSON.stringify(next));
  return { status: 200, body: { ok: true, drafts: listDraftRecords(next) } };
}

/** SOW-024 right-to-erasure: hard-delete a member's draft store. */
export async function eraseMemberDrafts(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the draft store is not configured' };
  const key = DRAFTS_KEY(String(githubId));
  await kv.delete(key);
  return { ok: true, key };
}
