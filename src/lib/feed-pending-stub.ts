// sow-224: the build-time feed's client-side "in the publishing queue" stub (the homepage feed + the account
// Latest Activity). The build-time FeedView / FeedList is server-rendered and cannot know about a Share the
// member just posted, so this listens for the composer's gbti-share-posted event (and reads the shared session
// store on load) and prepends an honest pending card into [data-feedlist]. The build-time feed carries PUBLIC
// shares only, so only a public Share gets a stub here (a members Share is queued only in the member stream);
// the stub is deduped by the feed cards' data-share-slug and self-expires after ~15 min. Presentation only.
import { rememberPending, dropPublished, pendingStubView } from '../../client-ui/src/share-pending-stub.mjs';

function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]));
}

/** The slugs of shares ALREADY rendered as real cards in this feed (so a published Share evicts its stub). */
function publishedSlugs(list: Element): string[] {
  return Array.from(list.querySelectorAll('[data-share-slug]'))
    .map((el) => el.getAttribute('data-share-slug') || '')
    .filter(Boolean);
}

function stubEl(view: { slug: string; title: string; note: string; linkText: string; prsHref: string }): HTMLElement {
  const art = document.createElement('article');
  art.className = 'feed-item feed-pending nocover';
  art.setAttribute('data-fi', '');
  art.setAttribute('data-pending-slug', view.slug);
  const link = view.prsHref ? ` <a class="fp-link" href="${escapeHtml(view.prsHref)}">${escapeHtml(view.linkText)}</a>.` : '';
  art.innerHTML = `<div class="feed-main">`
    + `<div class="feed-meta"><span class="fp-tag">Queued</span></div>`
    + `<h2 class="feed-title">${escapeHtml(view.title)}</h2>`
    + `<p class="feed-ex">${escapeHtml(view.note)}${link}</p>`
    + `</div>`;
  return art;
}

function render(list: Element): void {
  list.querySelectorAll('.feed-pending').forEach((n) => n.remove()); // idempotent: clear then re-add
  const pending = dropPublished(publishedSlugs(list), {}).filter((e: any) => e.visibility === 'public');
  for (const entry of pending.slice().reverse()) { // reverse so newest ends up first after each insertBefore
    list.insertBefore(stubEl(pendingStubView(entry, { host: 'website' })), list.firstChild);
  }
}

export function initFeedPendingStubs(): void {
  if (typeof document === 'undefined') return;
  const list = document.querySelector('[data-feedlist]');
  if (!list) return;
  const w = window as unknown as { __gbtiFeedPending?: boolean };
  if (w.__gbtiFeedPending) return;
  w.__gbtiFeedPending = true;
  render(list);
  document.addEventListener('gbti-share-posted', (e: Event) => {
    const detail = (e as CustomEvent).detail;
    if (detail?.item) rememberPending({ item: detail.item, prNumber: detail.prNumber, prUrl: detail.prUrl });
    render(list);
  });
}
