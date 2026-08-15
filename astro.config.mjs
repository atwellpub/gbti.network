// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';
import mdx from '@astrojs/mdx';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import { remarkContentBlocks } from './src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from './src/lib/markdown-sanitize.mjs';

// SOW-001: static site for gbti.network, deployed on Cloudflare Pages.
// Output is the default `static` — Pages serves `dist/` directly; no adapter needed.

// Each content page's .astro template owns the single page <h1> (the title). Some migrated Markdown bodies
// also open with a `# ` heading, which would emit a SECOND h1 and break the document outline (WCAG 1.3.1).
// This rehype pass demotes any body h1 to h2 so the page keeps exactly one h1. Manual tree walk, no new dep.
function rehypeDemoteBodyH1() {
  return (tree) => {
    const walk = (node) => {
      if (node && node.type === 'element' && node.tagName === 'h1') node.tagName = 'h2';
      if (node && Array.isArray(node.children)) for (const c of node.children) walk(c);
    };
    walk(tree);
  };
}

export default defineConfig({
  site: 'https://gbti.network',
  // The About and Co-op pages were retired and folded into the Revenue Model lander; keep old links working.
  // One key per source (no trailing slash): with trailingSlash:'ignore' each serves both /x and /x/, and a
  // second key for the same path would collide ("route defined more than once" build warning).
  redirects: { '/model': '/revenue-model', '/about': '/revenue-model', '/co-op': '/revenue-model' },
  // SOW-062 5d: remarkContentBlocks renders the body ```callout / ```embed fences (runs on mdast, before Shiki).
  // sow-158 Phase 1a: member markdown is SANITIZED at build. ORDER IS LOAD-BEARING: rehypeRaw first
  // (parses the raw-HTML nodes the fences + Shiki emit into real elements; sanitize alone would DELETE
  // the legitimate embeds), then the allowlist sanitize, then the backstops for what the attribute
  // schema cannot express: the iframe host allowlist, the style-attribute allowlist (hast-util-sanitize
  // never parses CSS, so this kills clickjacking / url() beacons / legacy expression()/-moz-binding),
  // and the id/name safety pass (neutralizes DOM clobbering while keeping the footnote anchors). All
  // three were hardened after an adversarial red-team (see markdown-sanitize.mjs). Every member body
  // sink (Content + rendered.html) flows through this one config.
  markdown: {
    remarkPlugins: [remarkContentBlocks],
    rehypePlugins: [rehypeDemoteBodyH1, rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety],
  },
  // Dev-only Astro toolbar — hidden so local testing matches the published view.
  devToolbar: { enabled: false },
  integrations: [
    mdx(),
    // Keep the auth shell / noindex stubs (and the archived v1 homepage) out of the sitemap so crawl
    // budget goes to public content.
    // sow-230: linkedin-invite joins the unlisted set for the same reason codeable-invite is in it. An invite
    // landing carries a live free-year coupon in plain sight, so indexing it turns a private invitation into a
    // public giveaway. Both pages also set a noindex meta; this filter is the second half, and they are not
    // redundant (the meta asks a crawler, the sitemap stops advertising the URL in the first place).
    sitemap({ filter: (page) => !/\/(account|welcome|codeable-invite(\/v1)?|linkedin-invite|home\/v1|news\/item)\/?$/.test(page) }),
  ],
  image: {
    // The legacy archive includes oversized animated GIFs (~40 MB across 12 files). Don't let
    // sharp's pixel guard fail the build. Proper handling — convert to YouTube/Vimeo embeds or
    // optimized loops + a CI size cap — is SOW-001 Phase 5 (media pipeline) per content-schemas.md.
    service: { entrypoint: 'astro/assets/services/sharp', config: { limitInputPixels: false } },
    // Responsive images: emit srcset + sizes for <Image>/<Picture> AND Markdown content images, so a heavy
    // full-resolution content image (some legacy posts shipped multi-MB pages) serves a right-sized variant
    // per viewport instead of the full original. Astro generates the smaller widths already; this makes the
    // rendered <img> actually reference them.
    layout: 'constrained',
    responsiveStyles: true,
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
