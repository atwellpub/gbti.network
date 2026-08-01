// SOW-031: resolve a content thumbnail/cover URL emitted by the per-type index JSON (toIndexItem.thumb) into a
// fully-qualified URL the in-extension UI can put in an <img src>. The index emits a SITE-relative
// `/_astro/...` build-optimized path (or, defensively, an already-absolute URL); the UI prefixes the gbti.network
// origin for the relative case. Pure + node-testable. Returns null for an empty/invalid value (the caller then
// renders no image, never a broken one).

const SITE = 'https://gbti.network';

/** The public content repo (jsDelivr serves committed images from it; the media convention). */
export const CONTENT_REPO = 'gbti-network/gbti.network';

/**
 * Rewrite repo-relative image srcs in RAW MARKDOWN to absolute jsDelivr URLs, using the item's repo path
 * as the base (members/<u>/posts/<slug>/index.md -> .../posts/<slug>/images/x.webp). The site build
 * resolves these relatives itself; the in-extension reader renders raw markdown, so without this pass a
 * `![](./images/x.webp)` has no meaningful src outside the repo. Absolute (http, //) and site-absolute
 * (/...) srcs pass through untouched. Pure; a null/absent path returns the markdown unchanged.
 */
export function resolveMarkdownAssets(markdown, itemPath, repo = CONTENT_REPO) {
  const md = String(markdown ?? '');
  const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
  if (!folder) return md;
  return md.replace(/(!\[[^\]]*\]\()(\.\/)([^\s)]+\))/g,
    (_m, pre, _dot, rest) => `${pre}https://cdn.jsdelivr.net/gh/${repo}@main/${folder}/${rest}`);
}

/**
 * Resolve ONE image value (a frontmatter cover, or a body image block's url) to something an <img src>
 * can actually load. Absolute, protocol-relative and build-optimized `/_astro/` values pass through;
 * anything else is treated as a REPO-relative path and resolved against the item's folder via jsDelivr,
 * exactly as resolveMarkdownAssets does for raw markdown. Without the item path there is no folder to
 * resolve against, so it falls back to the site origin.
 *
 * Shared deliberately: the editor renders `./images/x.webp` live in the page, where the browser resolves
 * it against the PAGE url (`/workbench/` -> a guaranteed 404). Only a repo-aware resolver can turn a
 * content-relative path into a loadable URL outside the site build.
 */
export function resolveContentAsset(value, itemPath, repo = CONTENT_REPO, site = SITE) {
  if (!value) return '';
  const s = String(value);
  if (/^https?:\/\//.test(s) || /^\/\//.test(s) || /^\/_astro\//.test(s)) return resolveAsset(s, site) || s;
  const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
  if (folder) return `https://cdn.jsdelivr.net/gh/${repo}@main/${folder}/${s.replace(/^\.?\/+/, '')}`;
  // No item folder means an explicitly RELATIVE path cannot be resolved. Return nothing rather than a
  // site-origin guess: `https://gbti.network/./images/x.webp` is the exact 404 this function exists to
  // stop, and an empty src renders the placeholder instead of a broken image.
  if (/^\.{1,2}\//.test(s)) return '';
  return resolveAsset(s, site) || '';
}

export function resolveAsset(thumb, site = SITE) {
  if (!thumb || typeof thumb !== 'string') return null;
  if (/^https?:\/\//.test(thumb)) return thumb; // already absolute (a raw/jsDelivr/CDN URL)
  if (/^\/\//.test(thumb)) return `https:${thumb}`; // protocol-relative
  return `${site}${thumb.startsWith('/') ? '' : '/'}${thumb}`; // SITE-relative `/_astro/...`
}
