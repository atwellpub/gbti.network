// sow-187: the ONE source for the feed navigation, so the seven feed entries are not duplicated across the
// header dropdown, the FeedView tab strip, and the footer (they were, and would drift). A future label change,
// for example the Products -> Projects rename carried by sow-196, is then a single edit here rather than three.

export interface FeedNavItem {
  /** The narrow key (matches src/pages/feeds/[narrow].astro getStaticPaths + FeedView Props['narrow']). */
  key: string;
  label: string;
  href: string;
  /** The footer feed column omits Network; everything else appears there. */
  inFooter: boolean;
}

/** The six public feed narrows (All is the /feeds/ index) in nav order. */
export const FEED_NAV: readonly FeedNavItem[] = [
  { key: 'all', label: 'All', href: '/feeds/', inFooter: true },
  { key: 'news', label: 'News', href: '/feeds/news/', inFooter: true },
  { key: 'network', label: 'Network', href: '/feeds/network/', inFooter: false },
  { key: 'articles', label: 'Articles', href: '/feeds/articles/', inFooter: true },
  { key: 'products', label: 'Products', href: '/feeds/products/', inFooter: true },
  { key: 'prompts', label: 'Prompts', href: '/feeds/prompts/', inFooter: true },
  { key: 'shares', label: 'Shares', href: '/feeds/shares/', inFooter: true },
];

/** The footer's feed column (omits Network), as [label, href] pairs to match the existing footer shape. */
export const FOOTER_FEED_LINKS: readonly [string, string][] = FEED_NAV
  .filter((i) => i.inFooter)
  .map((i) => [i.label, i.href] as [string, string]);

/**
 * sow-187: the flat SIGNED-IN header nav (no Feeds dropdown, drops All + Network). News points at the GATED
 * interactive `/news/` experience (owner decision 2), not the public `/feeds/news/` list. "Products" keeps its
 * current label until sow-196 renames the content type to Projects and ships `/projects/` (owner decision 1).
 */
export const SIGNED_IN_NAV: readonly { label: string; href: string }[] = [
  { label: 'News', href: '/news/' },
  { label: 'Articles', href: '/feeds/articles/' },
  { label: 'Products', href: '/feeds/products/' },
  { label: 'Prompts', href: '/feeds/prompts/' },
  { label: 'Shares', href: '/feeds/shares/' },
];
