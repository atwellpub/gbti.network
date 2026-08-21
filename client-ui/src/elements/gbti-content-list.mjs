// <gbti-content-list> (SOW-006 v2): the member's own content (posts/products/prompts/profile). Each row
// opens the item in the editor (emits `gbti-edit` with the loaded item so <gbti-app> seeds the editor).
// SOW-265: a published row also carries a View button that opens the live public page in a new tab,
// reusing the shared URL scheme so the table and the editor's "View Public Entry" cannot diverge.

import { GbtiElement, define, esc } from '../base.mjs';
import { publicUrlFor } from '../public-url.mjs';

class GbtiContentList extends GbtiElement {
  async render() {
    if (!this.client) return;
    let items = [];
    try {
      items = (await this.client.listContent({}))?.items ?? [];
    } catch {
      /* unauthenticated */
    }
    this.set(
      this.css() +
        `<div class="panel">
           <h2>My content</h2>
           ${items.length === 0 ? `<p class="muted">No content yet. Use the Author tab to create your first post.</p>` : ''}
           <ul class="list">${items.map((it, i) => this.rowHtml(it, i)).join('')}</ul>
         </div>`,
    );
    this.$$('button[data-i]').forEach((b) =>
      b.addEventListener('click', async () => {
        const it = items[Number(b.dataset.i)];
        try {
          const full = await this.client.getContentItem({ path: it.path });
          this.emit('gbti-edit', { type: it.type, ...full });
        } catch (err) {
          b.textContent = err.message;
        }
      }),
    );
    // SOW-265: open the live public page in a new tab (published rows only). Absolute URL, so this
    // works from the extension workspace too; matches the editor's #viewpub open behavior.
    this.$$('button[data-view]').forEach((b) =>
      b.addEventListener('click', () => {
        const url = b.dataset.view;
        if (url) window.open(url, '_blank', 'noopener');
      }),
    );
  }

  rowHtml(it, i) {
    const status = it.status ? `<span class="tag ${it.status === 'published' ? 'ok' : ''}">${esc(it.status)}</span>` : '';
    const vis = it.visibility === 'members' ? `<span class="tag">members</span>` : '';
    // SOW-265: a published item has a live page; render View only when we can resolve its URL.
    const isPub = String(it.status || '').toLowerCase() === 'published';
    const url = isPub ? publicUrlFor({ type: it.type, slug: it.slug, path: it.path }) : '';
    const view = url
      ? `<button class="ghost" data-view="${esc(url)}" title="Open the live public page in a new tab">View</button>`
      : '';
    return `<li class="row" style="justify-content:space-between">
      <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || '')}</span> ${status} ${vis}</span>
      <span class="rowacts" style="display:inline-flex;gap:6px;flex:none">${view}<button class="ghost" data-i="${i}">Edit</button></span>
    </li>`;
  }
}

define('gbti-content-list', GbtiContentList);
export { GbtiContentList };
