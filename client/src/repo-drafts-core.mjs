// sow-194: shared PURE helpers for folding the Worker's repo-drafts listing (GET /membership/repo-drafts) into
// the WorkBench Drafts view. A "repo draft" is a status:draft content item COMMITTED to the public canonical
// repo (the unpublish state), so it lives at its canonical path, on NO fork branch and in NO KV store. It
// carries store:'repo' and no branch, and both hosts (the extension/npm client/src/operations.mjs and the
// website src/lib/workbench-client.ts) map + merge it identically. No network; node-testable.

/**
 * Map one /membership/repo-drafts item ({ type, slug, path, owner, title, visibility, status:'draft' }) to the
 * WorkBench draft-row shape that mergeTypeItems + classifyDraft + the draft row read. store:'repo' marks it so
 * classifyDraft labels it "Repo draft" (not "Staged"), and branch:null / pull:null keep it off the fork-branch
 * and PR code paths. A repo draft has no synthesized branch, which is what prevents it colliding with a KV
 * draft on a synthesized branchName key.
 */
export function mapRepoDraftItem(item = {}) {
  const type = item?.type;
  const slug = item?.slug;
  return {
    type,
    slug,
    branch: null,
    path: typeof item?.path === 'string' ? item.path : null,
    pendingSlug: null,
    title: (typeof item?.title === 'string' && item.title) ? item.title : (slug || type || ''),
    visibility: item?.visibility === 'members' ? 'members' : 'public',
    status: 'draft',
    owner: item?.owner ?? null,
    valid: true,
    invalidReason: null,
    pull: null,
    store: 'repo',
  };
}

/**
 * Merge repo-draft rows into the existing (fork/KV) draft rows, dropping any repo row whose (type, slug) is
 * already represented by a fork or KV draft: that fork/KV draft is the member's newer, editable staging state
 * and wins over the committed repo copy (avoiding a duplicate row AND the synthesized-branch collision). The
 * caller tags its own rows with store ('fork' | 'kv') before calling. Optionally filter repo rows to one `type`.
 * Pure; returns a NEW array (the existing rows first, repo rows appended).
 */
export function mergeRepoDrafts(existing = [], repoItems = [], { type = null } = {}) {
  const rows = Array.isArray(existing) ? [...existing] : [];
  const seen = new Set(rows.map((d) => `${d?.type}:${d?.slug}`));
  for (const item of Array.isArray(repoItems) ? repoItems : []) {
    if (!item || !item.type || !item.slug) continue;
    if (type && item.type !== type) continue;
    const key = `${item.type}:${item.slug}`;
    if (seen.has(key)) continue; // a fork/KV draft of the same item already represents it
    seen.add(key);
    rows.push(mapRepoDraftItem(item));
  }
  return rows;
}
