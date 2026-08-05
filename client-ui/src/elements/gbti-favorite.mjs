// <gbti-favorite> (SOW-013): upgrades the inert favorite control baked by FavoriteButton.astro. The public
// static build ships `<gbti-favorite data-gbti-target-type=.. data-gbti-target-slug=.. data-gbti-count=..>`
// with a heart + count in its light DOM (a [data-signin] nudge for visitors). When a host loads
// @gbti/client-ui, this element upgrades into a working toggle: a click calls client.toggleFavorite(), which
// (SOW-024) writes the favorite to the member's DELETABLE edge store (KV), keyed by github_id, NOT to git.
// The displayed count updates OPTIMISTICALLY (local state); the canonical public count (the member-identity-free
// aggregate in house/favorite-counts.yml) refreshes on the next reconcile + batched build (the same two-tier
// model as comments). The GitHub token never reaches the page (the host holds it).
import { GbtiElement, define } from '../base.mjs';

// Heart inlined: a Shadow-DOM <use href="#ico-heart"> cannot cross the shadow boundary to the page sprite.
const heart = (filled) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 7.6 3.7 3.7 0 0 1 19 10.7c0 4.9-7 9.3-7 9.3z" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;

const CSS = `
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  .pill svg { flex:none; }
  .pill .c { font-variant-numeric: tabular-nums; }
  /* sow-179: icon-only, count stacked below, for the Editorial/Journal sticky action rail. */
  .pill.rail { flex-direction:column; gap:2px; width:38px; height:38px; padding:0; justify-content:center;
    border-radius:7px; font-size:10.5px; }
`;

class GbtiFavorite extends GbtiElement {
  render() {
    const targetType = this.dataset?.gbtiTargetType;
    const targetSlug = this.dataset?.gbtiTargetSlug;
    const rail = this.dataset?.gbtiSize === 'rail';
    if (this._count === undefined) {
      const n = parseInt(this.dataset?.gbtiCount || '0', 10);
      this._count = Number.isFinite(n) && n > 0 ? n : 0;
    }
    if (this._faved === undefined) this._faved = false;
    const c = Math.max(0, this._count);
    const label = !this.client ? 'Sign in to favorite' : this._faved ? 'Remove favorite' : 'Add favorite';
    this.set(
      this.css(CSS) +
        `<button class="pill ${rail ? 'rail' : ''} ${this._faved ? 'on' : ''}" type="button" aria-pressed="${this._faved}" aria-label="${label}${c > 0 ? `, ${c} so far` : ''}">${heart(this._faved)}${c > 0 ? `<span class="c">${c}</span>` : ''}</button>`,
    );
    this.on('.pill', 'click', () => this._onClick(targetType, targetSlug));
  }

  _onClick(targetType, targetSlug) {
    if (!this.client) { window.location.href = '/membership/'; return; } // host present but no signed-in client
    this._toggle(targetType, targetSlug);
  }

  async _toggle(targetType, targetSlug) {
    const next = !this._faved;
    // Optimistic flip + count delta.
    this._faved = next;
    this._count = Math.max(0, this._count + (next ? 1 : -1));
    this.render();
    try {
      const res = await this.client.toggleFavorite({ targetType, targetSlug, on: next });
      if (res && typeof res.favorited === 'boolean' && res.favorited !== next) {
        // Server disagreed (e.g. already favorited): undo the optimistic delta and adopt the server truth.
        this._count = Math.max(0, this._count - (next ? 1 : -1));
        this._faved = res.favorited;
        this.render();
      }
    } catch (err) {
      this._faved = !next; // revert
      this._count = Math.max(0, this._count + (next ? -1 : 1));
      this.render();
      if (err?.code === 'not-authenticated' || err?.code === 'membership-required') window.location.href = '/membership/';
    }
  }
}

define('gbti-favorite', GbtiFavorite);
export { GbtiFavorite };
