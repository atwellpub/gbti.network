// SOW-031: pure helpers for the per-type content index endpoints (/blog-index.json, /products-index.json,
// /prompts-index.json) AND the reader read-route allowlist. Node-free so the Astro endpoints map collections
// into it and node --test covers the edge-case logic (house vs member owner, the nested <slug>/index.md layout,
// the read allowlist regex). Metadata only (no body, no behavioral data) -> same privacy posture as
// activity-index.json. The reader fetches bodies on demand via the token-holding worker, never from this JSON.

const SUBDIR = { post: 'posts', product: 'products', prompt: 'prompts' };
const URLBASE = { post: '/articles', product: '/products', prompt: '/prompts' };

/** Repo-relative index.md path for a content item: house/gbti owner -> house/<sub>/<slug>/index.md; a member
 *  owner -> members/<owner>/<sub>/<slug>/index.md. Null when the type/slug is unsupported. */
export function contentItemPath(type, owner, slug) {
  const sub = SUBDIR[type];
  if (!sub || !slug) return null;
  const o = String(owner || '').toLowerCase();
  if (!o || o === 'house' || o === 'gbti') return `house/${sub}/${slug}/index.md`;
  return `members/${o}/${sub}/${slug}/index.md`;
}

// The image field(s) that supply a card thumbnail per type, in preference order. A product prefers its square
// `icon` for a list-row thumb (then the 16:10 featuredImage, then banner); posts use coverImage; prompts use image.
const THUMB_FIELDS = { post: ['coverImage'], product: ['iconLarge', 'icon', 'featuredImage', 'banner'], prompt: ['image'] };

/** Resolve one image field value to a URL string the in-extension UI can render. An Astro `image()` field is an
 *  ImageMetadata object ({ src, width, height }), so we emit its build-optimized `.src` (a SITE-relative
 *  `/_astro/...` path the UI prefixes with the gbti.network origin); a plain string (tests / a raw path) passes
 *  through. Returns null for anything else. NOT the Astro build hash leaking out: the index JSON is rebuilt every
 *  deploy in lockstep with `/_astro`, so the `.src` it carries always matches the live optimized asset. */
function imageSrc(v) {
  if (!v) return null;
  if (typeof v === 'string') return v || null;
  if (typeof v === 'object' && typeof v.src === 'string') return v.src || null;
  return null;
}

/** The RAW first-present thumbnail field value (an Astro ImageMetadata object or a plain string) for a type, or
 *  null. The Astro index endpoints feed this to getImage() to emit an OPTIMIZED variant whose URL actually
 *  exists in dist (the raw ImageMetadata.src is the un-emitted original, which 404s). */
export function imageFieldOf(data, type) {
  const d = data || {};
  for (const f of THUMB_FIELDS[type] || []) {
    if (d[f]) return d[f];
  }
  return null;
}

/** The thumbnail URL (SITE-relative or absolute) for a content item, or null when it has no usable image. NOTE:
 *  for an Astro image() this returns the ORIGINAL `.src`, which Astro does NOT emit unless referenced; the index
 *  endpoints override the thumb via getImage() (see src/lib/index-thumb.ts) so the shipped URL resolves. */
export function thumbOf(data, type) {
  return imageSrc(imageFieldOf(data, type));
}

/** Map a content collection entry to a metadata index item (no body). The caller filters (isListed) + sorts. */
/** SOW-112: the item's OLD slugs, derived from rename-generated redirectFrom entries (canonical URL shape;
 *  legacy migration entries are WordPress-shaped and never match). Slug-keyed readers union these. */
export function aliasSlugsOf(d) {
  const list = Array.isArray(d?.redirectFrom) ? d.redirectFrom : [];
  const out = [];
  for (const e of list) {
    const m = /^\/(articles|products|prompts)\/([a-z0-9][a-z0-9-]*)\/$/.exec(String(e || '').trim());
    if (m && m[2] !== d?.slug && !out.includes(m[2])) out.push(m[2]);
  }
  return out;
}

export function toIndexItem(entry, type) {
  const d = (entry && entry.data) || {};
  const slug = d.slug;
  const author = d.author || 'gbti';
  return {
    type,
    slug: slug || null,
    title: d.title || slug || '',
    author,
    excerpt: d.excerpt || d.shortDescription || '',
    url: `${URLBASE[type] || ''}/${slug}/`,
    path: contentItemPath(type, author, slug),
    thumb: thumbOf(d, type), // SOW-031: a card thumbnail URL (SITE-relative `/_astro/...` or null), resolved in the UI
    category: (Array.isArray(d.categories) && d.categories[0]) || null, // top-level category -> the UI's fallback glyph (cat-glyph.mjs)
    categories: Array.isArray(d.categories) ? d.categories.filter((s) => typeof s === 'string') : [], // SOW-054: full key path for the browse drill-down (paired with categoryLabels emitted by the index endpoints)
    publishedAt: d.publishedAt ? Number(d.publishedAt) : null,
    visibility: d.visibility || 'public',
    aliases: aliasSlugsOf(d), // SOW-112: old slugs after a rename (saved rows + reader discussions resolve via these)
    tags: Array.isArray(d.tags) ? d.tags.filter((t) => typeof t === 'string') : [], // SOW-100: the admin tag explorer
  };
}

// The reader read-route allowlist: ONLY a content index.md in the three public subtrees, member or house, with
// no traversal. Keeps the member token from becoming a general repo-file oracle (no roles.yml, no house/pages,
// no .. escape). Cover with the unit test.
export const READ_PATH_RE = /^(members\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;

export function isReadablePath(path) {
  return typeof path === 'string' && !path.includes('..') && !path.includes('\\') && READ_PATH_RE.test(path);
}
