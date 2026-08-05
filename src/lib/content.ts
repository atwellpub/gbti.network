import type { CollectionEntry } from 'astro:content';
import { readMemberSignal, onMemberSignal, currentIdentity, type MemberSignal } from './member-signal';
import { canEditItem } from './content-edit.mjs';
import { contentItemPath } from './content-index.mjs';

type Gatable = { data: { status: 'draft' | 'published'; visibility: 'public' | 'members'; publicStub?: boolean } };

/**
 * Public static build shows only published + public entries.
 * Members-only and drafts are excluded from the public bundle (SOW-001 soft-gating);
 * the SOW-005 controller still reads every entry regardless of state.
 * Use this where the body must be FULLY readable (e.g. RelatedPosts, the comments feed).
 */
export function isPublic(entry: Gatable): boolean {
  return entry.data.status === 'published' && entry.data.visibility === 'public';
}

/**
 * SOW-016: does this entry get a public detail PAGE? published AND (public OR a members stub).
 * Mode A (members + no stub) and drafts get no page. This is the getStaticPaths predicate.
 */
export function hasPublicPage(entry: Gatable): boolean {
  return entry.data.status === 'published' && (entry.data.visibility === 'public' || entry.data.publicStub === true);
}

/** SOW-016: a members item that renders a public STUB (header + locked body), i.e. Mode B. */
export function isStub(entry: Gatable): boolean {
  return entry.data.visibility === 'members' && entry.data.publicStub === true;
}

/**
 * SOW-016: appears in public listings/indexes. Same predicate as hasPublicPage — a Mode B stub shows as a
 * LOCKED card; a Mode A item is absent. Use this in index pages; keep `isPublic` where a locked card is noise.
 */
export function isListed(entry: Gatable): boolean {
  return hasPublicPage(entry);
}

/**
 * SOW-016: has any public footprint (a public page or a members stub). Drives revenue eligibility: a Mode A
 * item has NO footprint, so it earns no referral share and its comments/contributions earn no delegation.
 */
export function hasPublicFootprint(entry: Gatable): boolean {
  return entry.data.visibility === 'public' || (entry.data.visibility === 'members' && entry.data.publicStub === true);
}

/**
 * SOW-022: where a directory card points. Applets link out to their running tool (`launchUrl`, e.g.
 * `/utilities/<slug>/` for GBTI's embedded ones, or an external URL), exactly the way a product card would link
 * to a download; products link to their `/products/<slug>/` detail page.
 */
export function catalogHref(entry: { data: { type?: string; slug: string; launchUrl?: string } }): string {
  return entry.data.type === 'applet' && entry.data.launchUrl ? entry.data.launchUrl : `/products/${entry.data.slug}/`;
}

/** Newest-first by publishedAt (falls back to updatedAt, then epoch). */
export function byNewest(a: { data: { publishedAt?: Date; updatedAt?: Date } }, b: { data: { publishedAt?: Date; updatedAt?: Date } }): number {
  const at = (a.data.publishedAt ?? a.data.updatedAt ?? new Date(0)).valueOf();
  const bt = (b.data.publishedAt ?? b.data.updatedAt ?? new Date(0)).valueOf();
  return bt - at;
}

/** Resolve the member/house owner segment from a content entry id (e.g. "members/hudson/posts/x" → "hudson"). */
export function ownerOf(entry: CollectionEntry<'post' | 'product' | 'prompt'>): string {
  const parts = entry.id.split('/');
  return parts[0] === 'members' ? parts[1] : 'house';
}

/**
 * The repo-relative file path for a content item, matching the ACTUAL on-disk layout the SOW-001 migration +
 * validate-content use (members/<owner>/<sub>/<slug>/index.md, profiles at members/<owner>/profile.md;
 * house/<sub>/<slug>/index.md for a house owner, no profile). The SOW-006 inline editor reads + publishes
 * this exact path (data-gbti-path).
 *
 * sow-183: the post/product/prompt case now delegates to content-index.mjs's ALREADY node-test-covered
 * contentItemPath (identical house/member logic, just without the profile case this function alone needs),
 * instead of duplicating it -- a house owner ('house' or 'gbti') resolves to `house/<sub>/<slug>/index.md`
 * rather than null. House content publish went through the website's own hosted-authoring endpoint as of
 * SOW-183 Phase 2-3 (superadmin-gated server-side), so a null here was a stale carry-over from when it could
 * not. The `!owner` fail-closed guard stays in front of BOTH branches: an empty/missing owner is a broken
 * item, not silently "house" (contentItemPath alone treats '' as house, which is right for its own build-time
 * callers but wrong for a page rendering an edit link off possibly-missing data).
 */
export function contentRepoPath(type: 'post' | 'product' | 'prompt' | 'profile', owner: string, slug?: string): string | null {
  if (!owner) return null;
  if (type === 'profile') return (owner === 'house' || owner === 'gbti') ? null : `members/${owner}/profile.md`;
  return contentItemPath(type, owner, slug);
}

/**
 * sow-183: wire a server-rendered-hidden Edit pill to the member signal, client-side. Every detail page's Edit
 * affordance (product's hero pill, the article/prompt variants) shares this one resolve/toggle instead of each
 * repeating the same few lines. `ownerAttr` names the data attribute the page stamped the item's owner into.
 * No-ops off the browser (this module is also imported server-side, e.g. EditHooks.astro's frontmatter).
 */
export function wireEditAffordance(selector: string, ownerAttr: string): void {
  if (typeof document === 'undefined') return;
  const btn = document.querySelector<HTMLElement>(selector);
  if (!btn) return;
  const owner = btn.getAttribute(ownerAttr) || '';
  const apply = (identity: MemberSignal | null) => { btn.hidden = !canEditItem(identity, owner); };
  apply(currentIdentity(readMemberSignal()));
  onMemberSignal(apply);
}
