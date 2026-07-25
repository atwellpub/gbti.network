// SOW-157: the client transport for the hosted draft store (GET/POST /membership/drafts). A hosted member
// has no fork, so drafts live in the private, erasable edge store instead of fork branches. Mirrors
// member-follows-client.mjs: thin injectable-fetch wrappers sending the GitHub bearer token.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class DraftsClientError extends Error {}

async function call(method, body, { token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new DraftsClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/drafts', {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new DraftsClientError(data?.message || data?.error || `drafts request failed (${res.status})`);
  return data;
}

/** The caller's hosted drafts ({ drafts: [record] }, newest first). */
export async function workerListDrafts(opts) {
  return call('GET', null, opts);
}

/** Upsert one hosted draft record ({ type, slug, pendingSlug?, path, frontmatter, body }). */
export async function workerPutDraft({ draft, ...opts }) {
  return call('POST', { op: 'put', draft }, opts);
}

/** Delete one hosted draft by type + slug (idempotent). */
export async function workerDeleteDraft({ type, slug, ...opts }) {
  return call('POST', { op: 'delete', type, slug }, opts);
}
