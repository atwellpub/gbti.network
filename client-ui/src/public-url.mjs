// One source of truth for the live public URL of a member content item.
// post -> /articles/<slug>/, product -> /products/<slug>/, prompt -> /prompts/<slug>/.
// SOW-062 P6 introduced this scheme in the editor's "View Public Entry"; SOW-265 shares it with the
// My Content table (<gbti-content-list>) so a row can open its live page directly, and so the two
// surfaces cannot diverge. Node-free and pure so it is unit-testable and host-portable.

export const SITE_ORIGIN = 'https://gbti.network';

// The public route base per content type. Types absent here (e.g. profile) have no such page.
export const TYPE_BASE = { post: 'articles', product: 'products', prompt: 'prompts' };

// Derive the slug from a nested item path (members/<u>/<sub>/<slug>/index.md) when the frontmatter
// carries no explicit slug. Returns '' for anything that is not a nested index file.
export function slugFromPath(path) {
  const parts = String(path || '')
    .split('/')
    .filter(Boolean);
  const last = parts[parts.length - 1];
  if (last !== 'index.md' && last !== 'index.mdx') return '';
  return parts[parts.length - 2] || '';
}

// Build the absolute live public URL for a content item, or '' when it cannot have a public page
// (unknown type, or no resolvable slug). Absolute so it works from the extension too. The slug is
// URL-encoded; valid kebab slugs pass through unchanged, and an anomalous slug can never break out
// of the path segment.
export function publicUrlFor({ type, slug, path } = {}) {
  const base = TYPE_BASE[type];
  if (!base) return '';
  const s = String(slug ?? '').trim() || slugFromPath(path);
  if (!s) return '';
  return `${SITE_ORIGIN}/${base}/${encodeURIComponent(s)}/`;
}
