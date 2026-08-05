import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { isImageGenTarget } from '../client/src/image-models.mjs';
import { BANNER_PRESET_KEYS } from './lib/banner-presets.mjs';

/**
 * Canonical content schemas — source of truth: .data/schemas/content-schemas.md.
 * These same definitions are reused by SOW-003 (CI validation) and SOW-005 (the gate).
 *
 * Repository layout (content lives at the PROJECT ROOT, not under src/):
 *   members/<username>/{profile.md, posts/, products/, prompts/, images/}
 *   house/{posts/, products/, prompts/, pages/, images/}
 *
 * The blog / products / prompts collections are the AGGREGATE of every member folder
 * plus house/, achieved with multi-pattern glob loaders rooted at the project base.
 *
 * Two independent concerns (do not conflate):
 *   status     draft | published  — lifecycle (is it live yet?)
 *   visibility public | members   — audience once published (who may read it)
 * Public-build exclusion (drop draft + members) is enforced at the ROUTE level via the
 * `publicFilter` helper below — not in the schema, so the controller (SOW-005) can still
 * read every entry regardless of state.
 *
 * Image fields are typed as path strings here (decoupled from Astro's asset pipeline);
 * optimization/CDN resolution is handled by the media pipeline (SOW-001 Phase 5).
 */

const STATUS = z.enum(['draft', 'published']);
const VISIBILITY = z.enum(['public', 'members']);

// SYSTEM-MANAGED (SOW-008): written by the contribution merge automation, never trusted from a member
// PR (CI treats it as system-managed). Each entry credits a contributor whose suggested edit the folder
// owner accepted. `class` mirrors the points classification. Drives the stacked avatars and the
// contribution credits footnote.
const contributors = z
  .array(
    z.object({
      login: z.string(), // contributor GitHub login
      commit: z.string().optional(), // merge commit SHA
      url: z.string().url().optional(), // commit URL
      class: z.enum(['grammar', 'correction', 'addition']).optional(),
      at: z.string().optional(), // SOW-059: merge date (ISO); the payout collaboration gather windows on it
    }),
  )
  .default([]);

// SOW-014: typed, visibility-tagged outbound links for products + prompts. `visibility: members`
// links are rendered INERT (locked) on the public static site (open in the client to unlock); they are
// NOT a confidentiality control (public-repo encryption is obfuscation, see SOW-014). `primary` marks
// the CTA in the "Get <product>" card.
const contentLinks = z
  .array(
    z.object({
      type: z.enum(['homepage', 'repository', 'mirror', 'download', 'documentation', 'support']),
      url: z.string().url(),
      label: z.string().optional(), // user-facing override; defaults from `type`
      visibility: z.enum(['public', 'members']).default('public'),
      primary: z.boolean().default(false),
      // SOW-015: when true, `url` points to an AES-256-GCM .enc ciphertext (public obfuscation, not a secret);
      // the GBTI client decrypts it for an effective-paid member. Only valid on a `visibility: members` link
      // (enforced by scripts/validate-content.mjs). The static site renders it inert (locked), never decrypts.
      encrypted: z.boolean().default(false),
    }),
  )
  .default([]);

// Lenient strings (real member data includes handles as well as URLs).
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
    // SOW-129: the comprehensive set (old-site parity + mainstream).
    instagram: z.string().optional(),
    threads: z.string().optional(),
    tiktok: z.string().optional(),
    twitch: z.string().optional(),
    facebook: z.string().optional(),
    dailydev: z.string().optional(),
    producthunt: z.string().optional(),
    rumble: z.string().optional(),
    // SOW-131: audio, publishing, dev, and creator platforms.
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

// 1. Blog post — members/<username>/posts/<slug>.md (or house/posts/<slug>.md)
const post = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/posts/**/*.md', 'house/posts/**/*.{md,mdx}'] }),
  schema: ({ image }) => z.object({
    type: z.literal('post').default('post'),
    title: z.string(),
    slug: z.string().regex(/^[a-z0-9-]+$/, 'kebab-case, globally unique → /articles/<slug>/'),
    author: z.string(),
    contributors,
    status: STATUS.default('draft'),
    visibility: VISIBILITY.default('public'),
    // SOW-016 member-only gating: publicStub (only meaningful when visibility=members) true -> a public stub
    // page renders (header + locked body); false -> no public page at all (Mode A). encryptedBody is the
    // repo-relative path to the AES-256-GCM .enc body envelope (Mode B whole body, or Mode C tail section,
    // split at the `<!-- members-only -->` marker at publish). Plain string (NOT image()): the build never reads it.
    publicStub: z.boolean().default(false),
    encryptedBody: z.string().optional(),
    publishedAt: z.coerce.date().optional(),
    updatedAt: z.coerce.date().optional(),
    excerpt: z.string().max(200).optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    // sow-179: which of the three article layouts renders this post (editorial/journal/card, see
    // src/components/blog/Article*.astro). Every already-published post was backfilled to an explicit
    // layout: 'card' when this default flipped, so this default only ever governs a NEW post going forward,
    // never a silent shape change to something already live. journal still resolves to Card until Phase 4.
    layout: z.enum(['editorial', 'journal', 'card']).default('journal'),
    coverImage: image().optional(),
    coverAlt: z.string().max(250).optional(), // SOW-062 P3: cover-image alt text (accessibility)
    video: z.string().optional(), // YouTube/Vimeo URL or ID — embed only
    featured: z.boolean().default(false),
    canonicalUrl: z.string().url().optional(),
    redirectFrom: z.array(z.string()).default([]),
  }),
});

// 2. Product — members/<username>/products/<slug>.md (or house/products/<slug>.md)
// The product field set is factored out so the `applet` collection (SOW-022) reuses it VERBATIM and thus
// lists/renders identically to a product (the owner's "treat applets as products in the frontmatter").
const productShape = ({ image }: { image: any }) => ({
  type: z.literal('product').default('product'),
  title: z.string(),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  author: z.string(),
  contributors,
  status: STATUS.default('draft'),
  visibility: VISIBILITY.default('public'),
  publicStub: z.boolean().default(false), // SOW-016: members + publicStub -> a public stub page (Mode B); false -> no public page (Mode A)
  encryptedBody: z.string().optional(), // SOW-016: repo-relative path to the .enc body envelope (Mode B whole body / Mode C tail)
  shortDescription: z.string(),
  // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml), validated by
  // scripts/validate-content.mjs. Same shape as posts so all content types share one taxonomy (SOW-012).
  categories: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  pricing: z.enum(['free', 'freemium', 'paid']).optional(),
  version: z.string().optional(),
  // sow-172: the minimum host/runtime the product needs ("WordPress 6.0+", "VS Code 1.90+"). Distinct
  // from `platforms`, which lists WHICH hosts it runs on; this is the version floor for one of them.
  // Rendered as a spec row in the detail page's left rail and in the end-of-body install panel.
  requires: z.string().optional(),
  pricingUrl: z.string().url().optional(), // SOW-014: where to buy/upgrade, shown when pricing !== 'free'
  // sow-140: the RSS feed of the member-owned product/site. Declaring it does NOTHING by itself: the feed
  // only reaches the network's news pool once an admin approves the product slug in the admin-owned
  // house/member-news-sources.yml registry (moderation boundary; see the ops SOP).
  newsFeed: z.string().url().optional(),
  icon: image(), // REQUIRED, 1:1. The SMALL icon (directory card renders it at 64, shown 56).
  iconLarge: image().optional(), // Optional 1:1 LARGE icon for the 96px detail slot; falls back to `icon`.
  banner: image().optional(),
  // sow-174: an alternative to uploading a banner image. Curated presets only (see banner-presets.mjs for
  // why); mutually exclusive with `banner` in the editor, resolved by resolveHero() in product-page.mjs.
  bannerPreset: z.enum(BANNER_PRESET_KEYS as [string, ...string[]]).optional(),
  featuredImage: image(), // REQUIRED marquee cover for the Featured-product spotlight. Must be 16:10 (1280x800); the spotlight media box is locked to 16:10 so the image fills it without cropping.
  // sow-172: a gallery entry is EITHER a bare image path (every product published before captions existed)
  // OR { src, caption }. Both shapes normalize through normalizeGallery() in src/lib/product-page.mjs, so
  // the page never branches on the shape. Captions are content, not decoration: the captioned-grid layout
  // is built around them.
  gallery: z.array(z.union([image(), z.object({ src: image(), caption: z.string().optional() })])).default([]),
  // sow-172: how the screenshots render. Left unset it resolves by count (6+ shots -> carousel, fewer ->
  // captioned grid), which is the rule the design handoff states in prose; set it to pin one per product.
  galleryStyle: z.enum(['grid', 'carousel']).optional(),
  video: z.string().optional(), // YouTube/Vimeo URL or id (embed-only); a product demo rendered by VideoEmbed
  links: contentLinks, // SOW-014: array of typed, visibility-tagged links (was a flat object)
  publishedAt: z.coerce.date().optional(),
  updatedAt: z.coerce.date().optional(), // sow-172: last meaningful revision; shown in the byline + rail spec block
  redirectFrom: z.array(z.string()).default([]),
});
const product = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/products/**/*.md', 'house/products/**/*.{md,mdx}'] }),
  schema: ({ image }) => z.object(productShape({ image })),
});

// 2b. Applet — house/applets/<slug>/index.md ONLY (SOW-022). A self-contained client-side tool. SUPERADMIN-only
// by construction: the glob excludes member folders entirely, CODEOWNERS makes /house/applets/ superadmin-owned,
// and the client never offers `applet` as an authorable type, so a member cannot publish one. GBTI does not host
// member code (a member links out from a normal product instead). Reuses the product field set so applets list +
// render exactly like products; `icon`/`featuredImage` are OPTIONAL here (the directory falls back to the category
// glyph), and `launchUrl` is where the running tool lives (e.g. /utilities/<slug>/ for GBTI's embedded exceptions,
// or an external URL), playing the same role a product's download/pricing link does.
const applet = defineCollection({
  loader: glob({ base: '.', pattern: ['house/applets/**/*.{md,mdx}'] }),
  schema: ({ image }) => z.object({
    ...productShape({ image }),
    type: z.literal('applet').default('applet'),
    icon: image().optional(),
    featuredImage: image().optional(),
    launchUrl: z.string(), // site-relative (/utilities/<slug>/) or an external URL
    embedded: z.boolean().default(false), // true = GBTI hosts + embeds it at launchUrl (the /tools/ exception)
  }),
});

// 3. Member profile — members/<username>/profile.md
const profile = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/profile.md'] }),
  schema: z.object({
    type: z.literal('profile').default('profile'),
    username: z.string(),
    displayName: z.string(),
    tier: z.enum(['trial', 'paid']).default('trial'), // SYSTEM-MANAGED (SOW-002)
    directory: z.boolean().default(false), // opted into the public member directory (WP include_directory)
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
  }),
});

// 4. Page — site-owned static page, authored in this repo under house/pages/
const page = defineCollection({
  loader: glob({ base: '.', pattern: ['house/pages/**/*.{md,mdx}'] }),
  schema: z.object({
    type: z.literal('page').default('page'),
    title: z.string(),
    slug: z.string(),
    status: STATUS.default('published'),
    visibility: VISIBILITY.default('public'),
    description: z.string().optional(),
    nav: z.string().optional(),
    order: z.number().optional(),
    updatedAt: z.coerce.date().optional(),
    redirectFrom: z.array(z.string()).default([]),
  }),
});

// 5. Prompt — members/<username>/prompts/<slug>.md (or house/prompts/<slug>.md)
const prompt = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/prompts/**/*.md', 'house/prompts/**/*.{md,mdx}'] }),
  schema: ({ image }) => z.object({
    type: z.literal('prompt').default('prompt'),
    title: z.string(),
    slug: z.string().regex(/^[a-z0-9-]+$/),
    shortDescription: z.string(), // one-line blurb shown on prompt cards + the activity feed
    author: z.string(),
    contributors,
    status: STATUS.default('draft'),
    visibility: VISIBILITY.default('public'),
    publicStub: z.boolean().default(false), // SOW-016: members + publicStub -> a public stub page (Mode B); false -> no public page (Mode A)
    encryptedBody: z.string().optional(), // SOW-016: repo-relative path to the .enc body envelope (Mode B whole body / Mode C tail)
    targets: z.array(z.string()).default([]),
    // Hierarchical category path into the canonical taxonomy (house/taxonomy.yml), validated by
    // scripts/validate-content.mjs. Same shape as posts so all content types share one taxonomy (SOW-012).
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    variables: z.array(z.string()).default([]),
    exampleOutput: z.string().optional(),
    sourceUrl: z.string().url().optional(),
    pricing: z.enum(['free', 'freemium', 'paid']).optional(), // SOW-014; absent => free
    links: contentLinks, // SOW-014: typed, visibility-tagged resources (Resources sidebar card)
    // Optional result image. Only allowed when a target is an image generator (gated below), so the
    // image card/detail rendering is reserved for Nano Banana / MidJourney / image-gen prompts.
    // RECOMMENDED RATIO 4:3 (e.g. 1200x900): the directory grid card crops the lead to 4:3, and the
    // detail page shows the image at its native ratio. Other ratios still work; 4:3 just crops cleanest.
    image: image().optional(),
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
  }),
});

// 6. Comment — members/<username>/comments/<id>.md (native member comments; see specs/comments.md)
const comment = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/comments/*.md', 'house/comments/*.{md,mdx}'] }),
  schema: z.object({
    type: z.literal('comment').default('comment'),
    id: z.string(),
    author: z.string(),
    targetType: z.enum(['post', 'product', 'prompt', 'share', 'news']), // SOW-032: 'share'; SOW-046 D: 'news' discussion
    targetSlug: z.string(), // a share comment targets "<author>/<shareId>"; a news comment targets "news-<hash of guid>"
    status: STATUS.default('published'),
    visibility: VISIBILITY.default('members'), // SOW-044: comments are members-only + encrypted by default; only a from-the-author intro (authorNote) on a post/product/prompt may be public
    authorNote: z.boolean().default(false), // SOW-014: the author's deliberate "From the author" note (pinned regardless of date), vs an ordinary conversational comment. Exactly one per target by the content owner.
    encryptedBody: z.string().optional(), // SOW-016: a visibility:members comment encrypts its body to this .enc; renders as a locked placeholder
    parentId: z.string().optional(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
  }),
});

// 7. Share — members/<username>/shares/<timestamp-slug>.md (SOW-018). A lightweight, status-update style
// post: a short note and/or an external link the member is sharing (off-network finds, reads, builds). One
// file per Share (append-only, like comments), owned by that member, so it auto-merges under the SOW-005
// own-folder rule with no cross-member conflicts. Default visibility is `members` (a perk-gated stream): a
// members Share encrypts its body to `encryptedBody` (Mode A); a member may opt a Share `public`.
// SOW-018 directive, SCOPED by SOW-136 (the sow-131 election): a PUBLIC share (published + visibility:public,
// the fail-closed `isPublicShare` in src/lib/home-feed.mjs) may render in the site feed (the homepage). Everything
// else stays EXTENSION-ONLY: a members-only Share (including its Mode B stub metadata, title, blurb, and
// encryptedBody) must NEVER reach a public artifact — scripts/check-build-secrets.mjs scans dist for leaks.
// sow-094 (2026-07-21): a PUBLIC share also gets its own /shares/<author>/<id>/ page (the guard proves
// dist/shares/ carries nothing else). Shares stay DELIBERATELY EXCLUDED from activity-index.json (see that
// endpoint's comment). The full stream's reader remains the GBTI
// client/extension Shares tab, which lists them authenticated (operations.listShares) and decrypts members
// bodies via the Worker (an active trial may read; posting is paid-only).
// `publicStub`/Mode B/C carry over for schema + build-guard consistency, but a one-line status has no large
// body to gate, so realistic Shares are public-or-members-A.
const share = defineCollection({
  loader: glob({ base: '.', pattern: ['members/*/shares/*.md'] }),
  schema: z.object({
    type: z.literal('share').default('share'),
    id: z.string(), // the timestamp-slug filename stem, unique within the member's folder
    author: z.string(),
    status: STATUS.default('draft'),
    visibility: VISIBILITY.default('members'), // SOW-018: Shares default to the members-only stream
    publicStub: z.boolean().default(false), // SOW-016 consistency (rarely meaningful for a short status)
    encryptedBody: z.string().optional(), // SOW-016: a members Share encrypts its body to this .enc; renders locked
    title: z.string().optional(), // optional short headline; the body carries the note
    shortDescription: z.string().max(200).optional(), // SOW-032: an optional one-line blurb shown under the title
    url: z.string().url().optional(), // the external content being shared (link, find)
    image: z.string().optional(), // SOW-057: the featured image (an absolute OG URL or a repo-relative path)
    category: z.string().optional(), // SOW-087: one flat topic key (house/topics.yml); routes the share's category Discord post
    tags: z.array(z.string()).default([]),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
  }),
});

export const collections = { post, product, applet, profile, page, prompt, comment, share };
