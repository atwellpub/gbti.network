// Canonical content schemas for the CLIENT (SOW-006). These mirror the site's src/content.config.ts
// FIELD FOR FIELD so the client validates authored content before opening a PR, catching errors the
// SOW-005 gate / CI would otherwise reject.
//
// Why a second copy and not one shared module: the Astro site's `astro:content` re-exports its own
// bundled zod 3, while this client stack uses zod 4 (the top-level dep). The two zod majors are not
// interchangeable inside Astro's defineCollection, so a single imported schema object cannot serve both.
// Instead these definitions are kept in lockstep with content.config.ts and PINNED TO REALITY by
// test/client-schemas.test.mjs, which validates real repo content against them (a drift tripwire). Image
// fields are plain path strings here (the client commits files; Astro's image() optimization is build-time).
//
// The authoritative validator is still the gate / `npm run check:content`; this is the pre-flight copy.

import { z } from 'zod';
import { isImageGenTarget } from './image-models.mjs';
import { BANNER_PRESET_KEYS } from '../../src/lib/banner-presets.mjs';

export const STATUS = z.enum(['draft', 'published']);
export const VISIBILITY = z.enum(['public', 'members']);

// SYSTEM-MANAGED, never authored from the client (the merge automation owns it). Mirrors content.config.ts.
// SOW-100 tag policy (owner, 2026-07-08): tags are DASH-CONNECTED going forward. Member input normalizes
// (lowercase; spaces/underscores collapse to hyphens; duplicate hyphens collapse; dedupe), so "Claude Code"
// becomes "claude-code" at build time; anything left non-kebab rejects. Existing content is grandfathered
// (the CI check is diff-scoped).
export function normalizeTag(t) {
  return String(t ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}
const TAG_KEBAB_RE = /^[a-z0-9][a-z0-9.-]*$/;
const tagsSchema = z.array(z.string()).default([]).transform((arr) => {
  const out = [];
  for (const raw of arr) {
    const t = normalizeTag(raw);
    if (!t) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}).refine((arr) => arr.every((t) => TAG_KEBAB_RE.test(t)), { message: 'tags must be dash-connected (lowercase letters, digits, dots, hyphens)' });

const contributors = z
  .array(
    z.object({
      login: z.string(),
      commit: z.string().optional(),
      url: z.string().url().optional(),
      class: z.enum(['grammar', 'correction', 'addition']).optional(),
      at: z.string().optional(), // SOW-059: merge date (ISO); the payout collaboration gather windows on it
    }),
  )
  .default([]);

// SOW-014: typed, visibility-tagged links for products + prompts. Mirrors src/content.config.ts.
const contentLinks = z
  .array(
    z.object({
      type: z.enum(['homepage', 'repository', 'mirror', 'download', 'documentation', 'support']),
      url: z.string().url(),
      label: z.string().optional(),
      visibility: z.enum(['public', 'members']).default('public'),
      primary: z.boolean().default(false),
      encrypted: z.boolean().default(false), // SOW-015: url is an AES-256-GCM .enc ciphertext; client-decrypted for paid members
    }),
  )
  .default([]);

const socialLinks = z
  .object({
    github: z.string().optional(),
    website: z.string().optional(),
    x: z.string().optional(),
    bluesky: z.string().optional(),
    youtube: z.string().optional(),
    devto: z.string().optional(),
    reddit: z.string().optional(),
    mastodon: z.string().optional(),
    linkedin: z.string().optional(),
    discord: z.string().optional(),
    // SOW-129: the comprehensive set (kept in sync with src/content.config.ts).
    instagram: z.string().optional(),
    threads: z.string().optional(),
    tiktok: z.string().optional(),
    twitch: z.string().optional(),
    facebook: z.string().optional(),
    dailydev: z.string().optional(),
    producthunt: z.string().optional(),
    rumble: z.string().optional(),
    // SOW-131: audio, publishing, dev, and creator platforms (kept in sync with src/content.config.ts).
    soundcloud: z.string().optional(),
    mixcloud: z.string().optional(),
    spotify: z.string().optional(),
    bandcamp: z.string().optional(),
    wordpress: z.string().optional(),
    substack: z.string().optional(),
    medium: z.string().optional(),
    hashnode: z.string().optional(),
    peerlist: z.string().optional(),
    gitlab: z.string().optional(),
    stackoverflow: z.string().optional(),
    patreon: z.string().optional(),
    kofi: z.string().optional(),
    telegram: z.string().optional(),
  })
  .partial();

export const postSchema = z.object({
  type: z.literal('post').default('post'),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'kebab-case, globally unique -> /articles/<slug>/'),
  author: z.string(),
  contributors,
  status: STATUS.default('draft'),
  visibility: VISIBILITY.default('public'),
  publicStub: z.boolean().default(false), // SOW-016
  encryptedBody: z.string().optional(), // SOW-016: set by the publish flow (encrypt-on-publish), not hand-authored
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  excerpt: z.string().max(200).optional(),
  categories: z.array(z.string()).default([]),
  tags: tagsSchema,
  coverImage: z.string().optional(),
  coverAlt: z.string().max(250).optional(), // SOW-062 P3: cover-image alt text (accessibility)
  video: z.string().optional(),
  featured: z.boolean().default(false),
  canonicalUrl: z.string().url().optional(),
  redirectFrom: z.array(z.string()).default([]),
});

export const productSchema = z.object({
  type: z.literal('product').default('product'),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  author: z.string(),
  contributors,
  status: STATUS.default('draft'),
  visibility: VISIBILITY.default('public'),
  publicStub: z.boolean().default(false), // SOW-016
  encryptedBody: z.string().optional(), // SOW-016: set by the publish flow (encrypt-on-publish)
  shortDescription: z.string(),
  // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml). Same shape as posts
  // so all content types share one taxonomy (SOW-012). Mirrors src/content.config.ts.
  categories: z.array(z.string()).default([]),
  tags: tagsSchema,
  platforms: z.array(z.string()).default([]),
  pricing: z.enum(['free', 'freemium', 'paid']).optional(),
  version: z.string().optional(),
  pricingUrl: z.string().url().optional(),
  icon: z.string(), // REQUIRED, 1:1. The SMALL icon: the directory card renders it at 64 (shown 56).
  // Optional 1:1 LARGE icon for the detail page's 96px slot, which a 128px source cannot serve crisply at
  // 2x. Optional on purpose: every existing product predates it, and their 128x128 sources cannot be
  // upscaled into a genuine large asset. The render falls back to `icon`.
  iconLarge: z.string().optional(),
  banner: z.string().optional(),
  // sow-174: mirrors src/content.config.ts. Mutually exclusive with `banner` in the editor.
  bannerPreset: z.enum(BANNER_PRESET_KEYS).optional(),
  featuredImage: z.string(), // REQUIRED, mirrors src/content.config.ts (the 16:10 spotlight cover). Was optional
  // here: a product published without it passed the client but broke the Astro build (SOW-025, same drift class).
  // sow-172/174: a gallery entry is EITHER a bare path OR { src, caption }. Mirrors src/content.config.ts.
  // The union matters beyond validation: zod STRIPS unknown keys, so without it a caption would silently
  // vanish the next time this schema validated a save.
  gallery: z.array(z.union([z.string(), z.object({ src: z.string(), caption: z.string().optional() })])).default([]),
  galleryStyle: z.enum(['grid', 'carousel']).optional(), // sow-172: unset resolves by shot count
  video: z.string().optional(),
  links: contentLinks,
  publishedAt: z.coerce.date().optional(),
  redirectFrom: z.array(z.string()).default([]),
});

export const profileSchema = z.object({
  type: z.literal('profile').default('profile'),
  username: z.string(),
  displayName: z.string(),
  tier: z.enum(['trial', 'paid']).default('trial'), // SYSTEM-MANAGED (SOW-002)
  directory: z.boolean().default(false),
  status: STATUS.default('published'),
  visibility: VISIBILITY.default('public'),
  headline: z.string().optional(),
  avatar: z.string().optional(),
  location: z.string().optional(),
  forHire: z.boolean().default(false),
  roles: z.array(z.string()).default([]),
  skills: z.array(z.string()).default([]),
  links: socialLinks.optional(),
  joinedAt: z.coerce.date().optional(), // system-set
});

export const promptSchema = z.object({
  type: z.literal('prompt').default('prompt'),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  shortDescription: z.string(), // REQUIRED, mirrors src/content.config.ts (one-line blurb on cards + the feed).
  // Was missing from this mirror: a prompt published without it passed the client but broke the Astro build (SOW-025).
  author: z.string(),
  contributors,
  status: STATUS.default('draft'),
  visibility: VISIBILITY.default('public'),
  publicStub: z.boolean().default(false), // SOW-016
  encryptedBody: z.string().optional(), // SOW-016: set by the publish flow (encrypt-on-publish)
  targets: z.array(z.string()).default([]),
  // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml). Same shape as posts
  // so all content types share one taxonomy (SOW-012). Mirrors src/content.config.ts.
  categories: z.array(z.string()).default([]),
  tags: tagsSchema,
  variables: z.array(z.string()).default([]),
  exampleOutput: z.string().optional(),
  sourceUrl: z.string().url().optional(),
  pricing: z.enum(['free', 'freemium', 'paid']).optional(),
  links: contentLinks,
  // An optional result image (a repo path string, like coverImage/icon). Only meaningful for image
  // generators: a prompt may carry an `image` ONLY when one of its `targets` is an image-gen model.
  // Recommended ratio 4:3 (e.g. 1200x900); the directory grid card crops the lead to 4:3.
  image: z.string().optional(),
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(),
  redirectFrom: z.array(z.string()).default([]),
}).superRefine((data, ctx) => {
  if (data.image && !isImageGenTarget(data.targets)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['image'],
      message: 'an image is only allowed when a target is an image-gen model (e.g. Nano Banana, MidJourney)',
    });
  }
});

// SOW-024: the SOW-013 favoritesSchema (members/<username>/favorites.yml) is RETIRED. Favorites moved off the
// public git repo onto the deletable edge store (KV); the client writes them via the activity store
// (member-activity-client.mjs / mutateMemberActivity), validated by membership/member-activity.mjs, so there is
// no git favorites file and no schema for one here.

/** SOW-018: a member "Share" (members/<username>/shares/<id>.md) — a short status update. Like favorites and
 *  comments, it has its OWN file layout + a dedicated publish path (NOT the generic <slug>/index.md form), so
 *  it is deliberately NOT in SCHEMAS / AUTHORABLE_TYPES / FIELDS (which drive the per-type form + its drift
 *  test). Exported standalone for the share publish path + tests. Mirrors `share` in src/content.config.ts. */
export const shareSchema = z.object({
  type: z.literal('share').default('share'),
  id: z.string().min(1),
  author: z.string(),
  status: STATUS.default('draft'),
  visibility: VISIBILITY.default('members'), // Shares default to the members-only stream
  publicStub: z.boolean().default(false), // SOW-016 consistency
  encryptedBody: z.string().optional(), // SOW-016: set by the publish flow (encrypt-on-publish) for a members Share
  title: z.string().optional(),
  shortDescription: z.string().max(200).optional(), // SOW-032: optional one-line blurb (mirrors src/content.config.ts)
  url: z.string().url().optional(),
  image: z.string().optional(), // SOW-057: the featured image (an absolute OG URL or a repo-relative path)
  category: z.string().optional(), // SOW-087: one flat topic key (house/topics.yml); routes the share's category Discord post
  tags: tagsSchema,
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});

/** SOW-027: a member comment (members/<username>/comments/<id>.md). Like shares/favorites it has its OWN flat
 *  file layout + a dedicated publish/edit path (NOT the generic <slug>/index.md form), so it is deliberately NOT
 *  in SCHEMAS / AUTHORABLE_TYPES / FIELDS. Mirrors `comment` in src/content.config.ts (incl. authorNote +
 *  updatedAt; the data model + render were built in SOW-014). Exported standalone for the comment publish/edit
 *  path + tests. Public comments are the v1 focus; a members comment encrypts its body (encryptedBody, SOW-016). */
export const commentSchema = z.object({
  type: z.literal('comment').default('comment'),
  id: z.string().min(1),
  author: z.string(),
  targetType: z.enum(['post', 'product', 'prompt', 'share', 'news']), // SOW-032: 'share'; SOW-046 D: 'news' discussion
  targetSlug: z.string(), // a share comment targets "<author>/<shareId>"; a news comment targets "news-<hash of guid>"
  status: STATUS.default('published'),
  visibility: VISIBILITY.default('members'), // SOW-044: members-only + encrypted by default; only a from-the-author intro (authorNote) on a post/product/prompt may be public
  authorNote: z.boolean().default(false), // the deliberate "From the author" note (pinned), vs an ordinary comment
  encryptedBody: z.string().optional(), // SOW-016: a members comment encrypts its body to this .enc
  parentId: z.string().optional(), // threaded reply (still one file each)
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date().optional(),
});

/** Schemas keyed by content type. */
export const SCHEMAS = Object.freeze({
  post: postSchema,
  product: productSchema,
  profile: profileSchema,
  prompt: promptSchema,
});

/** The content types a member can author through the client. */
export const AUTHORABLE_TYPES = Object.freeze(['post', 'product', 'prompt', 'profile']);

/**
 * Fields the client must NEVER let a member set (the merge automation / gate own them). author is also
 * forced to the owner, handled in content-ops rather than listed here.
 */
export const SYSTEM_MANAGED = Object.freeze({
  post: ['contributors'],
  product: ['contributors'],
  prompt: ['contributors'],
  profile: ['tier', 'joinedAt'],
});

export function schemaFor(type) {
  return SCHEMAS[type] ?? null;
}
