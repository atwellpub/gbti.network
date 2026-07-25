// SOW-157: hosted draft staging. A hosted member has NO fork, so their drafts cannot stage on fork
// branches; they live in the deletable edge store (KV `drafts:<github_id>`) instead — private to the
// member, erasable (SOW-024), device-independent, and NEVER in git history (which also serves the SOW-011
// invariant: nothing trial-authored reaches the canonical repo; trial members may stage here too).
// Node-free pure transforms; the Worker handler does auth + the KV read-modify-write.

export const DRAFTS_MAX_ITEMS = 50;
export const DRAFT_MAX_BYTES = 150_000;
export const DRAFTS_MAX_TOTAL_BYTES = 1_000_000;

const TYPE_RE = /^(post|product|prompt|profile)$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;

export class DraftError extends Error {}

export const draftKeyOf = (type, slug) => `${type}:${slug}`;

/** Normalize a stored KV blob to { items: { "<type>:<slug>": record } }. Unknown shapes reset empty. */
export function normalizeDrafts(stored) {
  const items = stored && typeof stored === 'object' && stored.items && typeof stored.items === 'object' ? stored.items : {};
  return { items: { ...items } };
}

function utf8Bytes(s) {
  return new TextEncoder().encode(typeof s === 'string' ? s : JSON.stringify(s ?? '')).length;
}

/**
 * Upsert one draft record. The record is the editor's restore state: { type, slug, pendingSlug?, path,
 * frontmatter, body, updatedAt }. Caps: per-draft bytes, item count, total bytes. Throws DraftError on any
 * violation (the handler maps it to a 400).
 */
export function applyDraftPut(state, draft, { now = () => new Date().toISOString() } = {}) {
  const d = draft ?? {};
  const type = String(d.type ?? '');
  const slug = String(d.slug ?? '');
  if (!TYPE_RE.test(type)) throw new DraftError('a valid draft type is required');
  if (!SLUG_RE.test(slug)) throw new DraftError('a valid draft slug is required');
  const pendingSlug = d.pendingSlug != null ? String(d.pendingSlug) : null;
  if (pendingSlug != null && !SLUG_RE.test(pendingSlug)) throw new DraftError('the pending slug is invalid');
  const record = {
    type, slug, pendingSlug,
    path: typeof d.path === 'string' ? d.path : null,
    frontmatter: d.frontmatter && typeof d.frontmatter === 'object' ? d.frontmatter : {},
    body: typeof d.body === 'string' ? d.body : '',
    updatedAt: now(),
  };
  if (utf8Bytes(JSON.stringify(record)) > DRAFT_MAX_BYTES) throw new DraftError(`a draft may not exceed ${DRAFT_MAX_BYTES} bytes`);
  const next = normalizeDrafts(state);
  const key = draftKeyOf(type, slug);
  const isNew = !(key in next.items);
  if (isNew && Object.keys(next.items).length >= DRAFTS_MAX_ITEMS) throw new DraftError(`draft limit reached (${DRAFTS_MAX_ITEMS}); discard one first`);
  next.items[key] = record;
  if (utf8Bytes(JSON.stringify(next)) > DRAFTS_MAX_TOTAL_BYTES) throw new DraftError('the draft store is full; discard some drafts first');
  return next;
}

/** Delete one draft by type + slug. Deleting a missing draft is a clean no-op (idempotent discard). */
export function applyDraftDelete(state, { type, slug } = {}) {
  const next = normalizeDrafts(state);
  delete next.items[draftKeyOf(String(type ?? ''), String(slug ?? ''))];
  return next;
}

/** The list view, newest first. */
export function listDraftRecords(state) {
  return Object.values(normalizeDrafts(state).items).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
}
