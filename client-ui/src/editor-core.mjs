// SOW-184: pure, node-free helpers for the WorkBench content editor's sidebar (design handoff 3a). The editor
// element (gbti-content-editor.mjs) imports GbtiElement, which is browser-only, so it cannot be unit-tested under
// node. These two descriptors are the parts of the rail that are worth testing, kept here so test/editor-core.test.mjs
// can exercise them without a DOM. No imports, no side effects.

/** ISO date (YYYY-MM-DD) from a date-ish value, or '' when empty or unparseable. Mirrors the element's own fmtD. */
export function fmtDate(value) {
  if (!value) return '';
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

/**
 * SOW-184: the Status card descriptor for the editor rail. A fork-staged draft carries status: 'published' BY
 * DESIGN (the "draft" is its fork location, not a draft status -- see gbti-content-editor render()), so the
 * `staged` flag WINS over the status field, exactly as the doc-slug meta does.
 * @param {{ staged?: boolean, status?: string, publishedAt?: string }} item
 * @returns {{ label: string, tone: 'live'|'staged'|'draft', publishedLabel: string }}
 */
export function editorStatus({ staged = false, status = '', publishedAt = '' } = {}) {
  if (staged) return { label: 'Staged draft', tone: 'staged', publishedLabel: '' };
  if (String(status).toLowerCase() === 'published') {
    return { label: 'Live', tone: 'live', publishedLabel: fmtDate(publishedAt) };
  }
  return { label: 'Draft', tone: 'draft', publishedLabel: '' };
}

// The image field(s) the Media rail section shows per type, plus the noun to summarize them with. Kept in lockstep
// with RAIL_SCHEMA's Media section keys in gbti-content-editor.mjs. Post has one true cover; product's Media holds
// icon + featuredImage + banner; prompt has one image.
const MEDIA_FIELDS = {
  post: { keys: ['coverImage'], one: 'cover', many: 'covers' },
  product: { keys: ['icon', 'featuredImage', 'banner'], one: 'image', many: 'images' },
  prompt: { keys: ['image'], one: 'image', many: 'images' },
};

/** True when a preset field holds a real value (a non-empty string, or a non-empty array). */
export function hasValue(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

/**
 * SOW-184: the at-a-glance summary shown on the Media rail section's header (the mockup's "1 cover" hint). Counts
 * the set image fields for the type's Media section. Returns '' for an unknown type or when nothing is set, so the
 * header simply shows no hint.
 * @returns {string} e.g. '1 cover', '2 images', or ''
 */
export function mediaSummary(type, preset = {}) {
  const spec = MEDIA_FIELDS[type];
  if (!spec) return '';
  const n = spec.keys.reduce((acc, k) => acc + (hasValue(preset[k]) ? 1 : 0), 0);
  if (!n) return '';
  return `${n} ${n === 1 ? spec.one : spec.many}`;
}
