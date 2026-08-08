// sow-194: the client transport for the repo-drafts listing (GET /membership/repo-drafts). A repo draft is a
// status:draft content item committed to the public canonical repo (the unpublish state); the Worker returns the
// caller's OWN folder drafts (+ house for a re-verified superadmin), scoped server-side by the immutable
// github_id. Mirrors drafts-client.mjs: a thin injectable-fetch bearer wrapper, no SDK.

const trimBase = (b) => String(b || '').replace(/\/$/, '');

export class RepoDraftsClientError extends Error {}

/** The caller's repo drafts ({ ok, items: [{ type, slug, path, owner, title, visibility, status:'draft',
 *  store:'repo' }], generatedAt }). Bearer-authed; the Worker scopes server-side. */
export async function workerListRepoDrafts({ token, signupBase, fetch = globalThis.fetch } = {}) {
  if (!token || !signupBase) throw new RepoDraftsClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/repo-drafts', { headers: { Authorization: 'Bearer ' + token } });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new RepoDraftsClientError(data?.message || data?.error || `repo-drafts request failed (${res.status})`);
  return data;
}
