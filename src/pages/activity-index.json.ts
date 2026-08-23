// SOW-017: emits /activity-index.json at build time, the newest-first list of published works the extension
// new-tab "Latest Activity" feed reads. Published-works metadata only (title/author/date/url), no behavioral
// data; Mode A (no public page) items are excluded by isListed (SOW-016). The extension fetches this over its
// gbti.network host permission (no CORS needed). Refreshes on each deploy (two-tier freshness, like counts).
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isListed } from '../lib/content';
import { buildActivityIndex } from '../lib/activity.mjs';
import { contentItemPath } from '../lib/content-index.mjs';
import { resolveThumb } from '../lib/index-thumb';
import { breadcrumb } from '../lib/taxonomy';

// SOW-023: `visibility` lets the extension "Following" feed know which entries are member-only (a Mode B stub)
// so it renders them locked until decrypted via the SOW-016 Worker. Mode A items are already excluded (isListed).
// SOW-031: `path` is the repo-relative index.md path so a feed-row click can deep-link into the in-extension
// reader (newtab.html#tab=<type>&read=<path>) instead of navigating out to gbti.network.
// SOW-039: `thumb` is the per-item content image (the same getImage-optimized URL the per-type indexes ship, so
// it resolves in /dist), or null -> the extension feed falls back to a type glyph. Still metadata only.
// SOW-050: `thumbCard` is the larger card-grid derivative (the small `thumb` upscaled blurry in card view);
// `thumbWide` is the full-res reader cover; `categoryLabels` is the human breadcrumb the reader shows as chips.
// sow-166 (2026-08-23): `description` is the item's PUBLIC, AUTHOR-WRITTEN frontmatter blurb (post.excerpt,
// product/prompt.shortDescription), added so the weekly email digest can show a line under each title. It is
// the SAME string already served in the item page's own HTML and meta description, so this publishes nothing
// that was not public; it is still an additive change to a public build artifact and is recorded as one.
// NEVER derive this from a body. post.excerpt is optional, and the obvious repair for a missing one is a body
// excerpt, which for a Mode B stub would put member-only text into a public JSON and into an email. Absent
// means absent: null here, and the digest renders a bare row (membership/mail-digest.mjs publicItem).
type ActivityEntry = { type: 'post' | 'product' | 'prompt'; slug: string; title: string; author: string; url: string; path: string | null; thumb: string | null; thumbCard: string | null; thumbWide: string | null; categoryLabels: string[]; description: string | null; publishedAt: number | null; visibility: 'public' | 'members' };

export const prerender = true;

const ms = (d: Date | undefined) => (d ? Number(d) : null);

export const GET: APIRoute = async () => {
  const posts = await Promise.all((await getCollection('post')).filter(isListed).map(async (p): Promise<ActivityEntry> => ({
    type: 'post', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/articles/${p.data.slug}/`, path: contentItemPath('post', p.data.author, p.data.slug), ...(await resolveThumb(p.data, 'post')), categoryLabels: breadcrumb(p.data.categories), description: p.data.excerpt ?? null, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  })));
  const products = await Promise.all((await getCollection('product')).filter(isListed).map(async (p): Promise<ActivityEntry> => ({
    type: 'product', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/products/${p.data.slug}/`, path: contentItemPath('product', p.data.author, p.data.slug), ...(await resolveThumb(p.data, 'product')), categoryLabels: breadcrumb(p.data.categories), description: p.data.shortDescription ?? null, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  })));
  const prompts = await Promise.all((await getCollection('prompt')).filter(isListed).map(async (p): Promise<ActivityEntry> => ({
    type: 'prompt', slug: p.data.slug, title: p.data.title, author: p.data.author, url: `/prompts/${p.data.slug}/`, path: contentItemPath('prompt', p.data.author, p.data.slug), ...(await resolveThumb(p.data, 'prompt')), categoryLabels: breadcrumb(p.data.categories), description: p.data.shortDescription ?? null, publishedAt: ms(p.data.publishedAt), visibility: p.data.visibility,
  })));
  // SOW-018: Shares are deliberately EXCLUDED here. Shares are an extension-only experience (no public website
  // surface), so they never appear in this public activity index; the extension reads them directly (authenticated).

  const entries = buildActivityIndex([...posts, ...products, ...prompts]);
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: entries.length, entries });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
