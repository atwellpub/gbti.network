// sow-172: pure helpers for the product detail page's "Doc Shell" layout (design direction 1b).
//
// Deliberately node-free and Astro-free so the unit suite can cover the decisions the page makes without a
// build: which shape a gallery entry is, whether the screenshots render as a grid or a carousel, what goes in
// the contents rail, and which link earns the green install button versus a quiet row in the rail.
//
// The page itself then stays declarative: it renders what these return and branches on nothing.

/** At or above this many screenshots an unset `galleryStyle` resolves to the carousel. */
export const CAROUSEL_THRESHOLD = 6;

/** Below this many contents entries the rail drops the list entirely (no one-item table of contents). */
export const TOC_MIN_ENTRIES = 3;

/** Links that never appear as the primary install call to action. */
const REPOSITORY = 'repository';

/**
 * True when `v` is an Astro ImageMetadata rather than a `{ src, caption }` wrapper.
 *
 * Both shapes carry a `src`, so the key alone cannot tell them apart. ImageMetadata is the one whose `src` is
 * a resolved URL string AND which carries real pixel dimensions; a wrapper has either an object `src` (the
 * site build, where `src` is itself ImageMetadata) or a bare path string with no dimensions (the client, which
 * validates paths and never resolves images).
 */
function isImageValue(v) {
  if (!v || typeof v !== 'object') return false;
  return typeof v.src === 'string' && typeof v.width === 'number' && typeof v.height === 'number';
}

/**
 * Normalize a `gallery[]` to one shape the page can render without branching.
 *
 * Accepts the pre-caption form (a bare path or ImageMetadata per entry) and the captioned form
 * (`{ src, caption }`), in any mix, and drops empties rather than rendering a hole in the grid.
 *
 * @param {Array<any>} gallery
 * @returns {{ src: any, caption: string }[]}
 */
export function normalizeGallery(gallery) {
  if (!Array.isArray(gallery)) return [];
  const out = [];
  for (const entry of gallery) {
    if (!entry) continue;
    if (typeof entry === 'string') {
      out.push({ src: entry, caption: '' });
      continue;
    }
    if (isImageValue(entry)) {
      out.push({ src: entry, caption: '' });
      continue;
    }
    if (typeof entry === 'object' && entry.src) {
      out.push({ src: entry.src, caption: typeof entry.caption === 'string' ? entry.caption : '' });
    }
  }
  return out;
}

/** True when at least one normalized entry carries a caption (the grid tightens up when none do). */
export function hasCaptions(entries) {
  return (entries ?? []).some((e) => Boolean(e && e.caption));
}

/**
 * Resolve how the screenshots render.
 *
 * An explicit `galleryStyle` always wins. Unset, it follows the rule the design handoff states in prose: the
 * captioned grid suits a small set where every shot needs explaining, the carousel suits a long set where the
 * first shot leads and the rest are supporting detail.
 *
 * @param {string|undefined} style
 * @param {number} count
 * @returns {'grid'|'carousel'}
 */
export function resolveGalleryStyle(style, count) {
  if (style === 'grid' || style === 'carousel') return style;
  return (count ?? 0) >= CAROUSEL_THRESHOLD ? 'carousel' : 'grid';
}

/**
 * Build the contents rail.
 *
 * The body's own h2s are rarely enough to navigate by (most products run to two), so the list is bracketed by
 * the landmarks a reader actually jumps to: the top of the write-up, the screenshots, and the discussion. A
 * synthetic entry is dropped when a real heading already owns that id, so an anchor is never ambiguous.
 *
 * Returns an empty list when the result would be too short to be worth a rail, which is the handoff's
 * "under three headings the contents rail collapses" behaviour.
 *
 * @param {{depth:number, slug:string, text:string}[]} headings  from Astro's render()
 * @param {{hasBody?:boolean, hasGallery?:boolean, hasDiscussion?:boolean}} opts
 * @returns {{id:string, label:string}[]}
 */
export function buildToc(headings, opts = {}) {
  const { hasBody = true, hasGallery = false, hasDiscussion = true } = opts;
  const body = (headings ?? [])
    .filter((h) => h && h.depth === 2 && h.slug && String(h.text ?? '').trim())
    .map((h) => ({ id: String(h.slug), label: String(h.text).trim() }));

  const taken = new Set(body.map((e) => e.id));
  const entries = [];
  if (hasBody) entries.push({ id: 'pd-overview', label: 'Overview' });
  entries.push(...body);
  if (hasGallery && !taken.has('pd-screenshots')) entries.push({ id: 'pd-screenshots', label: 'Screenshots' });
  if (hasDiscussion && !taken.has('comments')) entries.push({ id: 'comments', label: 'Discussion' });

  return entries.length >= TOC_MIN_ENTRIES ? entries : [];
}

/** The repository URL, which the page surfaces as its own "View on GitHub" button rather than a Get row. */
export function repoUrl(links) {
  const hit = (links ?? []).find((l) => l && l.type === REPOSITORY && l.url);
  return hit ? hit.url : null;
}

/**
 * Pick the one link that earns the green install button.
 *
 * Order: an author-marked `primary`, then a download, then a homepage, then whatever else is left. Public links
 * are preferred at every step, because the install bar is the page's cold-traffic call to action and a locked
 * members-only control there reads as a dead end. A members-only link is still returned when it is all the
 * product has, and the page renders it inert exactly as SOW-014 requires.
 *
 * Falls back to `pricingUrl` so a paid product with no link array still has something to click.
 *
 * @returns {{type:string, url:string, label?:string, visibility?:string, primary?:boolean, encrypted?:boolean}|null}
 */
export function resolvePrimaryCta(links, pricingUrl) {
  const candidates = (links ?? []).filter((l) => l && l.url && l.type !== REPOSITORY);
  const isPublic = (l) => (l.visibility ?? 'public') !== 'members';

  // The whole ladder runs over the public links first, then over everything. Interleaving the two (preferring
  // public within each rung) would let a members-only `primary` outrank a public download, which is the exact
  // dead-end this is meant to avoid.
  const ladder = (pool) =>
    pool.find((l) => l.primary === true) ??
    pool.find((l) => l.type === 'download') ??
    pool.find((l) => l.type === 'homepage') ??
    pool[0];

  const hit = ladder(candidates.filter(isPublic)) ?? ladder(candidates);

  if (hit) return hit;
  if (pricingUrl) return { type: 'pricing', url: pricingUrl, label: 'Pricing', visibility: 'public' };
  return null;
}

/**
 * The remaining links, for the rail's compact list.
 *
 * The old right-hand "Get" card held every non-repository link; the doc shell has room for one call to action,
 * so documentation, support, mirrors and the rest move here rather than being dropped. The repository is
 * excluded (it has its own button) and so is whatever became the primary.
 */
export function railLinks(links, primary, pricingUrl, pricing) {
  const rest = (links ?? []).filter((l) => l && l.url && l.type !== REPOSITORY && l !== primary);
  const seen = new Set(rest.map((l) => l.url));
  // A paid product's pricing page is a real destination, but only when it is not already the install button.
  if (pricingUrl && pricing && pricing !== 'free' && !seen.has(pricingUrl) && primary?.url !== pricingUrl) {
    rest.push({ type: 'pricing', url: pricingUrl, label: 'Pricing', visibility: 'public' });
  }
  return rest;
}

const LINK_LABELS = {
  homepage: 'Homepage',
  repository: 'Repository',
  mirror: 'Mirror',
  download: 'Download',
  documentation: 'Documentation',
  support: 'Support',
  pricing: 'Pricing',
};

/** The user-facing label for a link: the author's override, else the type's own word. */
export function linkLabel(link) {
  if (!link) return '';
  return link.label ?? LINK_LABELS[link.type] ?? link.type;
}

/** True when a link must render inert on the public static site (SOW-014). */
export function isLockedLink(link) {
  return Boolean(link) && link.visibility === 'members';
}

/**
 * Resolve the hero: an uploaded banner image, a chosen color preset, or the fallback chain.
 *
 * An explicit preset beats the implicit `featuredImage` fallback: it is a deliberate choice the author made,
 * not a last resort, so it should not be second-guessed by whatever image happened to be handy. An explicit
 * uploaded banner beats both, since it is the richest option and the two are mutually exclusive in the editor.
 * `'ink'` is today's existing default look, reached only when nothing at all is set.
 *
 * @returns {{ image: any, preset: string|null }} exactly one of `image` or `preset` is set, never both.
 */
export function resolveHero(banner, bannerPreset, featuredImage) {
  if (banner) return { image: banner, preset: null };
  if (bannerPreset) return { image: null, preset: bannerPreset };
  return { image: featuredImage ?? null, preset: featuredImage ? null : 'ink' };
}

/**
 * `{ owner, repo }` from a github.com repository URL, or `null` for anything else (a non-GitHub host, a
 * malformed URL, GitHub's own non-repo pages). Used both to build the releases-API URL and, via
 * `detectLinkSource`, to decide whether a pasted link is a GitHub repository at all.
 */
export function parseGithubRepo(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'github.com' && u.hostname !== 'www.github.com') return null;
  const [owner, repo] = u.pathname.split('/').filter(Boolean);
  if (!owner || !repo) return null;
  return { owner, repo: repo.replace(/\.git$/, '') };
}

/**
 * Which well-known destination a URL points at, or `null`. Drives two independent things from one place
 * so they can never disagree: the editor's auto-detected link type + button-text placeholder (sow-175),
 * and the published page's decision to show the WordPress mark next to the install button.
 * @returns {'wordpress'|'github'|null}
 */
export function detectLinkSource(url) {
  if (!url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  if (host === 'wordpress.org') return 'wordpress';
  if (host === 'github.com') return 'github';
  return null;
}

/**
 * Shapes one GitHub releases-API response into what the rail renders. Kept separate from the fetch itself
 * so the decision of "does this count as a real, displayable release" is unit-testable without mocking
 * network: a draft is withheld (not yet a real release), and a response missing `tag_name` (an error body,
 * or GitHub's shape changing under us) is treated as absent rather than rendering a blank row.
 * @returns {{ tag: string, url: string, publishedAt: string }|null}
 */
export function formatRelease(release) {
  if (!release || release.draft || !release.tag_name) return null;
  return { tag: release.tag_name, url: release.html_url, publishedAt: release.published_at };
}

/**
 * Whether a signed-in identity may see the page's Edit affordance: they own the item, or they are superadmin.
 * Presentation only, matching every other use of the member signal (member-signal.ts) — the SOW-005 gate is
 * the real boundary on publish, so a false positive here only offers a link, never a write.
 * @param {{ login?: string|null, role?: string }|null} identity
 * @param {string} owner
 */
export function canEditItem(identity, owner) {
  if (!identity) return false;
  if (identity.role === 'superadmin') return true;
  return !!identity.login && !!owner && identity.login.toLowerCase() === String(owner).toLowerCase();
}
