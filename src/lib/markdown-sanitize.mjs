// sow-158 Phase 1a: build-time sanitization of member-authored markdown. Every site sink for member
// bodies (the Content components AND every entry.rendered.html set:html) renders through the ONE
// markdown config in astro.config.mjs, so this pair of rehype passes closes the stored-XSS platform
// memo in one place. Order matters and is enforced by astro.config.mjs:
//   rehypeRaw FIRST (parses the raw-HTML nodes the callout/embed fences and Shiki emit into real
//   elements; without it the sanitizer would silently DELETE the legitimate embeds), then
//   rehypeSanitize(sanitizeSchema), then iframe host allowlisting (below) as the backstop.
// No existing member or house body hand-writes raw HTML (audited 2026-07-25: every apparent tag sits
// inside code fences), so the allowlist breaks nothing that authors wrote.
import { defaultSchema } from 'rehype-sanitize';

/** The only hosts an <iframe> may point at: the shared embedUrl() providers (client/src/video-embed.mjs)
 *  plus the tweet-embed host reserved for sow-152. hast-util-sanitize filters protocols, not hosts, so
 *  rehypeIframeHostAllowlist below enforces this list as a dedicated pass. */
export const IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'player.vimeo.com',
  'www.tiktok.com',
  'rumble.com',
  'platform.twitter.com',
]);

/**
 * The sanitize schema: hast-util-sanitize's GitHub-flavored default, extended for the constructs the
 * pipeline legitimately produces:
 *   - the callout/embed fence output (div.callout*, div.embed-wrap, iframe with the player attrs)
 *   - Shiki-highlighted code (pre/code/span carry class + inline style; style attributes cannot run
 *     script in any modern browser, and no author-written raw HTML exists to abuse them)
 *   - GFM footnotes: the default schema already allows the data-footnote attrs; clobberPrefix is
 *     DISABLED so the generated fn/fnref id + href pairs keep matching (the default user-content-
 *     prefix rewrites ids but not hrefs, which would break every footnote anchor). The id attribute
 *     is allowed ONLY on the elements the footnote system emits (li, a, section, sup, h2-h6), which
 *     bounds the DOM-clobbering surface the disabled prefix would otherwise open.
 */
export const sanitizeSchema = {
  ...defaultSchema,
  clobberPrefix: '',
  tagNames: [...new Set([...(defaultSchema.tagNames ?? []), 'iframe', 'section', 'sup'])],
  attributes: {
    ...defaultSchema.attributes,
    div: [...(defaultSchema.attributes?.div ?? []), ['className', /^callout(-(info|note|warning|tip|body))?$|^embed-wrap$/]],
    iframe: [['src'], 'loading', 'allowFullScreen', 'title', 'allow', 'sandbox'],
    a: [...(defaultSchema.attributes?.a ?? []), 'target', ['rel', 'noopener', 'nofollow', 'noreferrer']],
    pre: [...(defaultSchema.attributes?.pre ?? []), 'style', 'tabIndex', 'dataLanguage'],
    code: [...(defaultSchema.attributes?.code ?? []), 'style'],
    span: [...(defaultSchema.attributes?.span ?? []), 'style', 'className'],
    img: [...(defaultSchema.attributes?.img ?? []), 'loading', 'decoding', 'srcSet', 'sizes', 'width', 'height', 'style'],
    li: [...(defaultSchema.attributes?.li ?? []), 'id'],
    section: ['dataFootnotes', 'className'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['https'],
  },
};

/**
 * The iframe host backstop: after sanitize, any iframe whose src host is not an allowlisted embed
 * provider is removed entirely. The fence system only ever emits provider URLs, so this fires only on
 * a hand-written raw-HTML iframe that survived the attribute schema.
 */
export function rehypeIframeHostAllowlist() {
  const walk = (node, parent, index) => {
    if (node.tagName === 'iframe') {
      let host = null;
      try { host = new URL(String(node.properties?.src ?? '')).hostname; } catch { host = null; }
      if (!host || !IFRAME_HOSTS.has(host)) {
        parent.children.splice(index, 1);
        return true; // removed: the caller re-visits this index
      }
    }
    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i++) {
        if (walk(node.children[i], node, i)) i--;
      }
    }
    return false;
  };
  return (tree) => { walk(tree, null, 0); };
}

/**
 * The style-attribute backstop (added after the sow-158 adversarial red-team). hast-util-sanitize passes
 * `style` through as an OPAQUE string (it never parses CSS), which left three CSS-only abuse classes
 * alive on the allowed style-bearing tags (pre/code/span/img/div): legacy script-in-CSS
 * (`expression()` / `-moz-binding`, inert on modern engines but a real defense-in-depth gap),
 * clickjacking overlays (`position:fixed` + `inset` + `z-index`), and external `url()` beacons (there is
 * no CSP to stop them). This pass keeps ONLY a safe allowlist of presentational declarations (the
 * color / background-color / overflow / font / text properties Shiki + markdown legitimately emit; this
 * site inlines Shiki colors, no `--shiki-*` custom props) and drops everything else, so no positioning,
 * url(), or legacy CSS vector can reach the page.
 */
export const SAFE_STYLE_PROPS = new Set([
  'color', 'background-color', 'font-weight', 'font-style', 'font-family', 'font-size', 'font-variant',
  'text-decoration', 'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-align', 'text-transform', 'text-indent', 'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'tab-size', 'overflow', 'overflow-x', 'overflow-y', 'vertical-align', 'list-style-type',
]);
const UNSAFE_STYLE_VALUE = /url\(|expression\(|image-set\(|-moz-binding|behavior\s*:|@import|javascript:|vbscript:|[<\\]/i;
export function safeStyle(value) {
  const kept = [];
  for (const decl of String(value ?? '').replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const val = decl.slice(i + 1).trim();
    if (!SAFE_STYLE_PROPS.has(prop) || !val || UNSAFE_STYLE_VALUE.test(val)) continue;
    kept.push(`${prop}:${val}`);
  }
  return kept.join(';');
}
export function rehypeStyleAllowlist() {
  const walk = (node) => {
    if (node.properties && typeof node.properties.style === 'string') {
      const safe = safeStyle(node.properties.style);
      if (safe) node.properties.style = safe; else delete node.properties.style;
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  return (tree) => walk(tree);
}

/**
 * The id/name safety backstop (added after the red-team found DOM clobbering). The schema disables
 * clobberPrefix so the GFM footnote id/href pairs keep matching (the default `user-content-` prefix
 * rewrites ids but not hrefs, breaking every footnote anchor). That leaves author-written `id`/`name`
 * UNPREFIXED and able to clobber page globals or shadow a real element id (a member body with
 * `<div id="gbti-signin-dialog">` could shadow the sign-in dialog once the site has one; `id="__proto__"`
 * etc.). The ONLY legitimate ids a member markdown body emits are the footnote system's
 * `user-content-fn*` ids (this pipeline runs no rehype-slug, so headings carry no id), so this pass
 * keeps exactly those and strips every other id, and strips all name attributes.
 */
export function rehypeIdSafety() {
  const walk = (node) => {
    const p = node.properties;
    if (p) {
      if (p.id != null && !/^user-content-fn/.test(String(p.id))) delete p.id;
      if (p.name != null) delete p.name;
    }
    if (Array.isArray(node.children)) for (const c of node.children) walk(c);
  };
  return (tree) => walk(tree);
}
