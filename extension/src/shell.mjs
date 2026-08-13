// extension/src/shell.mjs (SOW-036/039): the SHARED member-hub shell for every extension page. initShell({active})
// injects the top bar + the left rail into the [data-shell] container (before its <main class="nt-main">) and
// wires the theme toggle, the daily.dev switcher, and the account dropdown (identity, sign-in -> onboarding,
// sign-out, role-gated Admin). One implementation so the chrome stays identical across newtab / browse / workspace
// / shares / admin. CSP-safe: trusted constant markup, no inline handlers, inline-SVG icons. The icon set + esc are
// exported so the new-tab feed reuses them.

import '../../client-ui/src/elements/gbti-share-composer.mjs'; // SOW-041 P5: the top-bar "+" mounts this composer
import '../../client-ui/src/elements/gbti-activity-bell.mjs'; // SOW-042 P3: the top-bar activity bell
import '../../client-ui/src/elements/gbti-social-queue.mjs'; // SOW-121: the avatar-menu Social Queue popup
import '../../client-ui/src/elements/gbti-debug-panel.mjs'; // SOW-124: the superadmin Debug panel (devlog viewer)
import '../../client-ui/src/elements/gbti-welcome.mjs'; // SOW-048: dual-purposed as the forced-sign-in login splash
import { wbCacheSet } from '../../client-ui/src/workbench-cache.mjs'; // SOW-073 P5: warm the workbench cache from the create-recent prefetch
import { expiryPopupDecision, expiryPopupCopy } from '../../client-ui/src/membership-expiry.mjs'; // SOW-119 QA: the coupon-expiry countdown
import { devlog, devlogFlagOn, setDevlogFlag } from './devlog.mjs'; // SOW-124: the page realm's devlog + the shared flag

const SITE = 'https://gbti.network';
const DAILYDEV_ID = 'jlmpjdjjbgclbocgajdjefcidcncaied';
const DAILYDEV_APP_URL = 'https://app.daily.dev/';
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Inline SVG icon set (CSP forbids external requests for these). Shared by the shell + the new-tab feed.
export const SVG = {
  prompt: '<path d="M5 4h14a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9l-4 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M9 9.5h6M9 12.5h4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  article: '<path d="M4.5 14.5h6.6v3.2a1.9 1.9 0 0 1-1.9 1.9H6.4a1.9 1.9 0 0 1-1.9-1.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8.4 14.6C10.5 9.4 14.4 5.2 20 3.4c.5 5.6-2.4 10.1-7 12.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/><path d="M10.8 11.6l3 .4M13.4 8.2l2.7 .4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>', // inkwell + quill (Articles)
  product: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="m4 8.5 8 4.5 8-4.5M12 13v7" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  coin: '<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.5c-.6-.8-1.6-1.2-2.7-1.2-1.5 0-2.6.8-2.6 2s1 1.7 2.6 1.9c1.6.2 2.7.7 2.7 2s-1.1 2-2.7 2c-1.2 0-2.2-.5-2.8-1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  news: '<path d="M4 5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M18 9h2a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  activity: '<path d="M3 12h4l2.5-7 5 14 2.5-7H21" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="4" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="4" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="13" y="13" width="7" height="7" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  search: '<circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="m16 16 4.5 4.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  sun: '<circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  moon: '<path d="M20 13.5A8 8 0 1 1 10.5 4a6.5 6.5 0 0 0 9.5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  chev: '<path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  mCompact: '<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>',
  mDetailed: '<rect x="3.5" y="4.5" width="5" height="5" rx="1" fill="currentColor"/><rect x="3.5" y="14.5" width="5" height="5" rx="1" fill="currentColor"/><path d="M11 6h9M11 9h6M11 16h9M11 19h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  mCard: '<rect x="4" y="4" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="13" y="4" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="4" y="13" width="7" height="7" rx="1.3" fill="currentColor"/><rect x="13" y="13" width="7" height="7" rx="1.3" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mega: '<path d="M4 10v4a1 1 0 0 0 1 1h2l5 3.5V5.5L7 9H5a1 1 0 0 0-1 1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M16 9.2a4 4 0 0 1 0 5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', // megaphone (Share)
  share: '<path d="m3 11 18-5v12L3 14v-3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>', // SOW-069: paper-plane (Shares rail + card cat-glyph; matches the "New Share" composer card), replacing a coin
  // SOW-052: the WorkBench rail glyphs.
  bookmark: '<path d="M6 4h12a1 1 0 0 1 1 1v15l-7-4-7 4V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  users: '<circle cx="9" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.2a3 3 0 0 1 0 5.6M16.5 13.5a5.5 5.5 0 0 1 4 5.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  user: '<circle cx="12" cy="8" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 19.5a7 7 0 0 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>', // SOW-129: Profile rail glyph
  gear: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M19.4 13a7.8 7.8 0 0 0 0-2l1.7-1.3-1.7-3-2 .8a7.6 7.6 0 0 0-1.7-1l-.3-2.1H10l-.3 2.1a7.6 7.6 0 0 0-1.7 1l-2-.8-1.7 3L6 11a7.8 7.8 0 0 0 0 2l-1.7 1.3 1.7 3 2-.8a7.6 7.6 0 0 0 1.7 1l.3 2.1h3.6l.3-2.1a7.6 7.6 0 0 0 1.7-1l2 .8 1.7-3z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  pr: '<circle cx="6" cy="6" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="6" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="18" r="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M6 8.2v7.6M18 15.8V11a4 4 0 0 0-4-4h-3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>',
  // SOW-052: the "Network" rail item (back to the co-op feed) — connected nodes.
  network: '<circle cx="6" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="18" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="18" r="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 7h8M7.7 8.6 10.7 16M16.3 8.6 13.3 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
};
export const ico = (k) => (SVG[k] ? `<svg viewBox="0 0 24 24" aria-hidden="true">${SVG[k]}</svg>` : '');

// SOW-052: two rail variants. The FEED rail (new tab) is the content browser — its destinations open the feed
// pre-filtered to one type (newtab.html#type=<X>); it also carries a top control block (feed search + Latest/
// Following). The WORKBENCH rail (workspace / account / admin) is the member's management nav — what used to live
// in the avatar dropdown. `initShell({ nav })` picks the variant.
const RAIL_FEED = [
  { group: 'Feeds' },
  // SOW-063: an explicit #type=all so a rail click goes straight to the Activity feed; the BARE newtab.html (a fresh
  // Chrome new tab + the brand logo) is what lands on the landing splash.
  { key: 'activity', href: 'newtab.html#type=all', ico: 'activity', nm: 'Activity', sub: 'The latest across the co-op' },
  // News is a curated feed open to the limited trial (not members-only), so it sits with Activity, not Browse.
  { key: 'news', href: 'newtab.html#type=news', ico: 'news', nm: 'News', sub: 'Curated, limited trial' },
  { group: 'Member Activity' },
  // No "All" item: Activity (bare newtab.html) IS the all-types river. These narrow to a single member-content type.
  { key: 'articles', href: 'newtab.html#type=post', ico: 'article', nm: 'Articles', sub: 'Posts and tutorials' },
  { key: 'products', href: 'newtab.html#type=product', ico: 'product', nm: 'Products', sub: 'Plugins and tools' },
  { key: 'prompts', href: 'newtab.html#type=prompt', ico: 'prompt', nm: 'Prompts', sub: 'Reusable prompts' },
  { key: 'shares', href: 'newtab.html#type=share', ico: 'share', nm: 'Shares', sub: 'The co-op stream' }, // SOW-069: a share glyph, not a coin (Shares are not monetary)
  { div: true },
  // SOW-069: the WorkBench item carries quick deep-links into the workspace tabs (always-visible indented children).
  { key: 'workspace', href: 'workspace.html', ico: 'grid', nm: 'WorkBench', sub: 'Your content + tools', children: [
    // SOW-101: quick deep-links into the member's OWN content-management tabs (distinct from the Member Activity
    // browse feeds above). The wb- key prefix avoids a highlight collision with the articles/products/prompts/shares
    // feed items. Shares has no workspace tab yet (SOW-093), so it points at the co-op stream like the feed item.
    { key: 'wb-post', href: 'workspace.html#tab=post', ico: 'article', nm: 'Articles' },
    { key: 'wb-product', href: 'workspace.html#tab=product', ico: 'product', nm: 'Products' },
    { key: 'wb-prompt', href: 'workspace.html#tab=prompt', ico: 'prompt', nm: 'Prompts' },
    { key: 'wb-shares', href: 'newtab.html#type=share', ico: 'share', nm: 'Shares' },
    { key: 'prs', href: 'workspace.html#tab=prs', ico: 'pr', nm: 'Pull requests' },
    { key: 'saved', href: 'workspace.html#tab=saved', ico: 'bookmark', nm: 'Saved' },
    { key: 'subs', href: 'workspace.html#tab=subs', ico: 'users', nm: 'Following' },
  ] },
];

const RAIL_WORKBENCH = [
  // SOW-052: a "Network" item up top takes the member back to the main co-op feed (newtab). No "WorkBench" eyebrow.
  { key: 'network', href: 'newtab.html', ico: 'network', nm: 'Network', sub: 'Exit WorkBench' },
  // Explicit #tab=overview so clicking it ON workspace.html is a same-document switch (no reload), like the others.
  { key: 'overview', href: 'workspace.html#tab=overview', ico: 'grid', nm: 'Overview', sub: 'Your hub at a glance' },
  { group: 'My Content' },
  { key: 'post', href: 'workspace.html#tab=post', ico: 'article', nm: 'Articles', sub: 'Your posts' },
  { key: 'prompt', href: 'workspace.html#tab=prompt', ico: 'prompt', nm: 'Prompts', sub: 'Your prompts' },
  { key: 'product', href: 'workspace.html#tab=product', ico: 'product', nm: 'Products', sub: 'Your products' },
  { group: 'Activity' },
  { key: 'prs', href: 'workspace.html#tab=prs', ico: 'pr', nm: 'Pull requests', sub: 'Proposed + accepted' },
  { key: 'saved', href: 'workspace.html#tab=saved', ico: 'bookmark', nm: 'Saved', sub: 'Favorites + collections' },
  { key: 'subs', href: 'workspace.html#tab=subs', ico: 'users', nm: 'Following', sub: 'Members, channels, topics' },
  { key: 'earnings', href: 'workspace.html#tab=earnings', ico: 'coin', nm: 'Earnings', sub: 'Referrals + rewards' },
  { div: true },
  // sow-204: the extension stops being an authoring host, so Profile opens the WEBSITE WorkBench instead of
  // a bundled page. `ext` marks it as leaving the extension, which the renderer turns into target/rel.
  { key: 'profile', href: `${SITE}/workbench/`, ext: true, ico: 'user', nm: 'Profile', sub: 'Your public profile' }, // SOW-129, repointed sow-204
  { key: 'settings', href: 'account.html', ico: 'gear', nm: 'Settings', sub: 'Membership + account' },
  { key: 'admin', href: 'admin.html', ico: 'lock', nm: 'Admin tools', sub: 'Moderation', adminOnly: true },
];

const RAILS = { feed: RAIL_FEED, workbench: RAIL_WORKBENCH };

// The feed rail's top control block (SOW-052): the persistent feed search + the Latest/Following toggle, moved out
// of the new-tab content header. newtab.mjs wires these by selector ([data-filter] / [data-tab]).
function feedControlsHtml() {
  return `<div class="nt-rail-feedctrls">
    <label class="nt-rsrch"><span class="gl" data-ico="search"></span><input type="search" data-filter placeholder="Filter the feed" autocomplete="off" aria-label="Filter the feed" /></label>
    <div class="nt-tabs" role="tablist" aria-label="Activity view">
      <button class="nt-tab on" type="button" data-tab="latest" role="tab" aria-selected="true">Latest</button>
      <button class="nt-tab" type="button" data-tab="following" role="tab" aria-selected="false">Following</button>
    </div>
  </div>`;
}

// SOW-052: the relocatable control cluster (no longer a full-width bar). initShell appends it to the page's
// top-right [data-topbar] slot. Order: apps, the view-mode slot (the new tab moves its .nt-modes here), bell,
// theme, account, then the "+" compose to the right of the avatar. The account dropdown is collapsed to just
// "My WorkBench" + Sign out (the old section deep-links moved to the WorkBench rail).
function controlsHtml() {
  return `<div class="nt-controls" data-controls>
    <button class="nt-icobtn nt-burger" data-drawer-toggle data-ico="mCompact" type="button" title="Menu" aria-label="Open navigation" aria-expanded="false"></button>
    <span class="nt-apps" data-apps>
      <span class="nt-app gbti" title="GBTI Network (you are here)">GBTI</span>
      <button class="nt-app" data-open-dailydev type="button" title="Switch to daily.dev"><img data-dd-img src="https://app.daily.dev/favicon.ico" alt="daily.dev" /></button>
    </span>
    <span class="nt-modes-slot" data-modes-slot></span>
    <gbti-activity-bell></gbti-activity-bell>
    <button class="nt-icobtn" data-theme-toggle title="Toggle theme" aria-label="Toggle theme"></button>
    <div class="nt-acctwrap" data-me-wrap>
      <button class="nt-signin" data-signin-btn type="button" hidden>Sign in</button>
      <button class="nt-acct" data-me-btn type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu" hidden>
        <img class="av" data-me-av alt="" width="34" height="34" />
        <span data-ico="chev"></span>
      </button>
      <div class="me-menu" data-me-menu role="menu" hidden>
        <div class="me-head" data-me-head></div>
        <div class="me-sep" role="separator"></div>
        <a class="mi" role="menuitem" href="workspace.html">WorkBench</a>
        <a class="mi" role="menuitem" href="${SITE}/workbench/" target="_blank" rel="noopener">Profile</a>
        <a class="mi" role="menuitem" href="account.html">Settings</a>
        <a class="mi" role="menuitem" href="admin.html" data-admin-only hidden>Admin tools</a>
        <button class="mi" role="menuitem" type="button" data-social-queue data-super-only hidden>Social Queue</button>
        <button class="mi" role="menuitem" type="button" data-debug-panel data-super-only hidden>Debug</button>
        <div class="me-sep" role="separator"></div>
        <button class="mi mi-signout" role="menuitem" type="button" data-me-signout>Sign out</button>
      </div>
    </div>
    <button class="nt-icobtn" data-compose data-ico="plus" title="Create" aria-label="Create" aria-haspopup="dialog"></button>
  </div>`;
}

// SOW-052: the GBTI Network brand mark, pinned to the very top of the rail (above the feed search / workbench
// nav). Links home (newtab.html). The icon is the packaged extension logo, accessible by a page-relative path.
function brandHtml() {
  return `<a class="nt-brand" href="newtab.html" aria-label="GBTI Network home">
    <img class="nt-brand-mk" src="icons/icon-128.png" alt="" width="26" height="26" />
    <span class="nt-brand-tx">GBTI <b>Network</b></span>
  </a>`;
}

function railHtml(active, nav = 'feed') {
  const rail = RAILS[nav] || RAIL_FEED;
  const items = rail.map((r) => {
    if (r.group) return `<div class="nt-rail-h">${esc(r.group)}</div>`;
    if (r.div) return `<hr class="nt-rail-div" />`;
    const on = r.key === active ? ' on' : '';
    const admin = r.adminOnly ? ' data-admin-only hidden' : ''; // role-gated after /api/status resolves
    const sub = r.sub ? `<span class="sub">${esc(r.sub)}</span>` : '';
    // sow-204: an `ext` entry leaves the extension for gbti.network, so it opens in a new tab and never
    // hands the site a window opener over an extension page.
    const ext = r.ext ? ' target="_blank" rel="noopener"' : '';
    const self = `<a class="nav-i${on}" data-key="${r.key}"${admin} href="${r.href}"${ext}><span class="gl" data-ico="${r.ico}"></span><span class="tx"><span class="nm">${esc(r.nm)}</span>${sub}</span></a>`;
    // SOW-069: a rail item may carry indented child links (WorkBench -> quick deep-links into the workspace tabs).
    const kids = (r.children || []).map((c) => `<a class="nav-i nav-sub${c.key === active ? ' on' : ''}" data-key="${c.key}" href="${c.href}"><span class="gl" data-ico="${c.ico}"></span><span class="tx"><span class="nm">${esc(c.nm)}</span></span></a>`).join('');
    return self + kids;
  }).join('');
  // The feed rail leads with the feed search + Latest/Following; the workbench rail does not. The brand sits above
  // either, at the very top of the rail.
  const top = nav === 'feed' ? feedControlsHtml() : '';
  return `<nav class="nt-rail">${brandHtml()}${top}${items}<div class="nt-rail-foot"><a class="nt-coop" href="${SITE}/">View the co-op <span data-ico="arrow"></span></a></div></nav>`;
}

/** Re-highlight the rail to `key` (or clear when null). The rail renders its active item ONCE at initShell, but
 *  the new-tab feed switches type via same-document hash navigation (no reload), so it calls this to keep the
 *  left rail in lockstep with the chips + feed. */
export function setRailActive(key) {
  document.querySelectorAll('.nt-rail .nav-i').forEach((a) => a.classList.toggle('on', a.dataset.key === key));
  applyHeadingIcon(key);
}

// SOW-064: prefix the page's main heading (the [data-topbar] <h1>) with the ACTIVE rail item's icon, sized to the
// heading, so the section the member is in is echoed at the start of the welcome/heading line. The icon key is read
// from the active rail item in the DOM, so this is nav-agnostic and follows the selection (initShell sets it once;
// setRailActive updates it when the new-tab feed switches Activity <-> News, etc.).
function applyHeadingIcon(key) {
  const h1 = document.querySelector('[data-topbar] h1');
  if (!h1) return;
  const icoKey = key ? document.querySelector(`.nt-rail .nav-i[data-key="${key}"] [data-ico]`)?.dataset.ico : null;
  let holder = h1.querySelector('.head-ico');
  if (!icoKey) { holder?.remove(); return; }
  if (!holder) { holder = document.createElement('span'); holder.className = 'head-ico'; holder.setAttribute('aria-hidden', 'true'); h1.prepend(holder); }
  holder.innerHTML = ico(icoKey);
}

/** GET /api/* via the background worker; null on any failure. */
async function api(pathname, query = {}) {
  try {
    const r = await chrome.runtime.sendMessage({ type: 'api', req: { method: 'GET', pathname, query } });
    return r?.json ?? null;
  } catch { return null; }
}

/** Reflect the signed-in status into the account control + (if present) the greeting suffix. */
function applyAccount(root, status) {
  const meBtn = root.querySelector('[data-me-btn]');
  const signinBtn = root.querySelector('[data-signin-btn]');
  const greetName = document.querySelector('[data-greet-name]');
  if (status) {
    const login = status.identity.login;
    const av = root.querySelector('[data-me-av]');
    if (av) { av.src = `https://github.com/${encodeURIComponent(login)}.png?size=64`; av.alt = `@${login}`; }
    const head = root.querySelector('[data-me-head]');
    if (head) head.innerHTML = `Signed in as <b>@${esc(login)}</b>`;
    // The Admin entry lives in BOTH the WorkBench rail and (re-added) the avatar dropdown, so role-gate EVERY
    // [data-admin-only] node (querySelectorAll, not querySelector). Shown for staff (moderator and up); admin.html
    // self-gates each tool and the SOW-005 gate + CODEOWNERS stay the real boundary.
    const showAdmin = (RANK[status.role] ?? 0) >= RANK.moderator;
    root.querySelectorAll('[data-admin-only]').forEach((el) => { el.hidden = !showAdmin; });
    // SOW-121: the Social Queue is superadmin-only (the Worker read is superadmin-gated too).
    const showSuper = (RANK[status.role] ?? 0) >= RANK.superadmin;
    root.querySelectorAll('[data-super-only]').forEach((el) => { el.hidden = !showSuper; });
    if (greetName) greetName.textContent = `, @${login}`;
    if (meBtn) meBtn.hidden = false;
    if (signinBtn) signinBtn.hidden = true;
  } else {
    if (greetName) greetName.textContent = '';
    if (meBtn) meBtn.hidden = true;
    if (signinBtn) signinBtn.hidden = false;
  }
}

/** SOW-048: the gate decision (PURE, testable). A signed-in caller has both a token (authenticated) and a GitHub
 *  login. Everything else (signed out, malformed status) is gated to the login splash. AUTH, not membership. */
export function shouldGate(status) {
  return !(status?.authenticated && status?.identity?.login);
}

/** sow-228: the STAFF gate decision for admin.html (PURE, testable). Same contract as shouldGate: TRUE means DENY.
 *  `data-admin-only` hid the rail's Admin LINK at moderator and up, but the PAGE had no check and is directly
 *  navigable, so any signed-in member who reached the URL got the whole staff surface. Uses RANK.moderator so the
 *  entrance and the door share one threshold; if they ever diverge we are back to this defect.
 *  FAILS CLOSED on purpose: signed out, malformed, or a role this build does not recognize all deny. An
 *  unrecognized role must render nothing rather than everything, including one a future release adds.
 *  This is UX and disclosure control, NEVER the boundary. The Worker's authorizeStaff/authorizeAdmin, the SOW-005
 *  gate and CODEOWNERS remain the authority; do not let a green client gate justify relaxing any of them. */
export function shouldGateStaff(status) {
  if (shouldGate(status)) return true;
  // Require a STRING before the lookup. `RANK[['admin']]` coerces the array to the key 'admin' and would otherwise
  // resolve to rank 2, so a non-string role is denied on its type rather than on its stringification.
  if (typeof status.role !== 'string') return true;
  const rank = RANK[status.role];
  return typeof rank !== 'number' || rank < RANK.moderator;
}

// The last raw /api/status, kept so the gate can tell an EXPIRED session (token died) from a never-signed-in one
// and label the splash accordingly. Not exported; read only by initShell's gate handler.
let _lastStatus = null;

/** Load /api/status and reflect it into the account control. Returns the status (or null when not signed in). */
export async function loadShellAccount(root = document.querySelector('[data-shell]')) {
  const status = await api('/api/status');
  _lastStatus = status;
  const signedIn = !shouldGate(status);
  if (root) applyAccount(root, signedIn ? status : null);
  if (signedIn) prefetchCreateRecent(); // SOW-064: warm the 24h Recent-drafts cache before the "+" is opened
  return signedIn ? status : null;
}

// SOW-048: run the GitHub App device flow via the background worker (same contract as onboarding/page-client).
// `onPrompt` receives the user code to display; resolves on success, rejects on failure/cancel.
function shellLogin(onPrompt) {
  return new Promise((resolve, reject) => {
    const onMsg = (m) => { if (m?.type === 'login-prompt') onPrompt?.({ userCode: m.userCode, verificationUri: m.verificationUri }); };
    try { chrome.runtime.onMessage.addListener(onMsg); } catch { reject(new Error('messaging unavailable')); return; }
    chrome.runtime.sendMessage({ type: 'login' })
      .then((r) => { chrome.runtime.onMessage.removeListener(onMsg); r?.ok ? resolve(r) : reject(new Error(r?.error || 'sign-in failed')); })
      .catch((e) => { chrome.runtime.onMessage.removeListener(onMsg); reject(e); });
  });
}

/** SOW-048: the forced-sign-in gate. With no token, hide the app (data-unauth) and overlay ONLY the dual-purpose
 *  <gbti-welcome> login splash. Its Sign in button runs the device flow; on success we reload into the signed-in
 *  app (initShell re-runs, now signed in, no gate). Idempotent. */
function mountAuthGate(root, { expired = false } = {}) {
  if (!root || document.querySelector('.gbti-authwrap')) return;
  document.documentElement.setAttribute('data-unauth', '1');
  const wrap = document.createElement('div');
  wrap.className = 'gbti-authwrap';
  const el = document.createElement('gbti-welcome');
  el.setAttribute('auth-gate', '');
  if (expired) el.setAttribute('expired', ''); // SOW: token-expiry detected -> the splash explains the re-sign-in
  wrap.appendChild(el);
  root.appendChild(wrap);
  let signingIn = false; // guard against click-spam starting parallel device flows (+ leaking login-prompt listeners)
  el.addEventListener('gbti:welcome-signin', () => {
    if (signingIn) return;
    signingIn = true;
    shellLogin(({ userCode, verificationUri }) => el.setCode?.(userCode, verificationUri))
      .then(() => location.reload())                          // signed in -> re-run initShell -> the app renders
      .catch(() => { el.setCode?.(null); signingIn = false; }); // failed/cancelled -> allow another attempt
  });
}

function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('gbti-theme', t); } catch (e) {}
  const b = document.querySelector('[data-theme-toggle]');
  if (b) b.innerHTML = ico(t === 'dark' ? 'sun' : 'moon');
}

const openOnboarding = () => (chrome.tabs?.create
  ? chrome.tabs.create({ url: chrome.runtime.getURL('onboarding.html') })
  : window.open(chrome.runtime.getURL('onboarding.html'), '_blank'));

function wireAccount(root) {
  const menu = () => root.querySelector('[data-me-menu]');
  const btn = root.querySelector('[data-me-btn]');
  const close = () => { const m = menu(); if (m) m.hidden = true; btn?.setAttribute('aria-expanded', 'false'); };
  const open = () => { const m = menu(); if (m) m.hidden = false; btn?.setAttribute('aria-expanded', 'true'); m?.querySelector('.mi')?.focus(); };
  root.querySelector('[data-me-av]')?.addEventListener('error', (e) => { e.target.src = 'icons/icon-32.png'; });
  btn?.addEventListener('click', (e) => { e.stopPropagation(); menu()?.hidden ? open() : close(); });
  document.addEventListener('click', (e) => { const m = menu(); if (m && !m.hidden && !root.querySelector('[data-me-wrap]')?.contains(e.target)) close(); });
  document.addEventListener('keydown', (e) => { const m = menu(); if (e.key === 'Escape' && m && !m.hidden) { close(); btn?.focus(); } });
  root.querySelector('[data-signin-btn]')?.addEventListener('click', openOnboarding);
  root.querySelector('[data-me-signout]')?.addEventListener('click', async () => {
    close();
    try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
    location.reload(); // re-evaluate identity + the membership lock gate on this page
  });
  // SOW-121: the superadmin Social Queue opens as a centered popup (the item is superadmin-gated in render()).
  root.querySelector('[data-social-queue]')?.addEventListener('click', () => { close(); openSocialQueueModal(); });
  // SOW-124: the superadmin Debug panel (the devlog viewer; the item is superadmin-gated by [data-super-only]).
  root.querySelector('[data-debug-panel]')?.addEventListener('click', () => { close(); openDebugPanelModal(); });
}

// SOW-124: the avatar-menu "Debug" opens a centered popup mounting <gbti-debug-panel>. The panel is a
// host-agnostic view; here we inject the `adapter` that does the realm plumbing: the toggle writes the shared
// flag, refresh MERGES this page's ring with the background service worker's ring (fetched over one message,
// superadmin-gated on the worker side), and clear empties both. Every logged value is already redacted.
function openDebugPanelModal() {
  if (document.querySelector('.debug-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal debug-modal';
  overlay.innerHTML = `<gbti-debug-panel></gbti-debug-panel>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.addEventListener('gbti-debug-close', close);
  document.addEventListener('keydown', onEsc);
  const panel = overlay.querySelector('gbti-debug-panel');
  panel.adapter = {
    isEnabled: () => devlogFlagOn(),
    async refresh() {
      const page = devlog.recent().map((e) => ({ ...e, realm: 'page' }));
      let bg = [];
      try { const r = await chrome.runtime.sendMessage({ type: 'devlog-recent' }); if (r?.ok && Array.isArray(r.entries)) bg = r.entries.map((e) => ({ ...e, realm: 'bg' })); } catch { /* worker unreachable */ }
      return page.concat(bg);
    },
    async toggle(on) { await setDevlogFlag(on); },
    async clear() { devlog.clear(); try { await chrome.runtime.sendMessage({ type: 'devlog-clear' }); } catch { /* best-effort */ } },
  };
  document.body.appendChild(overlay);
}

// SOW-121: the avatar-menu "Social Queue" opens a centered popup mounting <gbti-social-queue> (the superadmin
// manual-assist worklist). Reuses the .compose-modal overlay (backdrop + Esc); the component's X close button
// dispatches gbti-social-close, which we catch to close.
function openSocialQueueModal() {
  if (document.querySelector('.social-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal social-modal';
  overlay.innerHTML = `<gbti-social-queue></gbti-social-queue>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }); // backdrop click closes
  overlay.addEventListener('gbti-social-close', close);
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
}

// SOW-041 P5: the top-bar "+" opens a modal that mounts the existing <gbti-share-composer> (the literal owner ask:
// a URL + a comment -> the members-only Shares area). The composer self-gates paid/trial/locked and routes through
// the normal paid-only publish flow; on its gbti-share-posted event we close (any open feed refreshes itself).
function openComposeModal() {
  if (document.querySelector('.compose-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal';
  overlay.innerHTML = `<div class="compose-panel"><div class="compose-head"><b>Post a Share</b><button class="compose-x" type="button" aria-label="Close">${ico('x')}</button></div><gbti-share-composer></gbti-share-composer></div>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  // SOW-041 follow-up: deliberately NO backdrop-click-to-close on the Share composer — an accidental click on the
  // overlay must never discard an in-progress draft. The member closes intentionally (the X, Esc, or a successful post).
  overlay.querySelector('.compose-x')?.addEventListener('click', close);
  // SOW-092: posted -> close, then redirect the member to their new share. A page with a share reader
  // (the new-tab feed, the shares feed) claims the event during dispatch (detail.handled) and opens it in
  // place; on a page with no reader (workspace/admin/account) we stash the optimistic item and land on
  // shares.html, whose feed opens it on connect. Deferred a tick so the document listeners run first.
  overlay.addEventListener('gbti-share-posted', (e) => {
    close();
    setTimeout(() => {
      if (e.detail?.handled || !e.detail?.item) return;
      try { sessionStorage.setItem('gbti-open-share', JSON.stringify(e.detail.item)); } catch { /* fail-soft */ }
      location.href = 'shares.html';
    }, 0);
  });
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  overlay.querySelector('gbti-share-composer')?.querySelector?.('input, textarea')?.focus?.();
}
// SOW-064: the "+" opens a CENTERED create popup, following the "Content Creation Popup" Claude Design: a header
// ("Create" eyebrow + "What would you like to create today?" + sub), four COLOR-CODED format cards in one row
// (Share=green, article=blue, prompt=purple, product=amber) with Share pre-selected, a workbench search input, and
// a "Recent drafts" list loaded from the member's content. Cards: Share -> the composer modal; the others navigate
// to the WorkBench (#new=<type>, a blank <gbti-content-editor>). Reuses the .compose-modal overlay (centered,
// backdrop + Esc).
const cSvg = (inner, { size = 21, sw = 1.75 } = {}) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const CREATE_CARDS = [
  { type: 'share', cls: 'share', t: 'New Share', s: 'A quick update', svg: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>' },
  { type: 'post', cls: 'article', t: 'New article', s: 'Write a post', svg: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>' },
  { type: 'prompt', cls: 'prompt', t: 'New prompt', s: 'Share a prompt', svg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>' },
  { type: 'product', cls: 'product', t: 'New product', s: 'List a product', svg: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>' },
];
const CREATE_FILE_ICO = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/>';
const CREATE_TYPE_LABEL = { post: 'Article', prompt: 'Prompt', product: 'Product' };

function openCreateModal() {
  if (document.querySelector('.compose-modal')) return; // already open
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal create-modal';
  const cards = CREATE_CARDS.map((c, i) => `<button class="cc-card${i === 0 ? ' sel' : ''}" data-new="${c.type}" type="button">
      <span class="cc-ico ${c.cls}">${cSvg(c.svg)}</span>
      <span class="cc-tx"><span class="cc-t">${c.t}</span><span class="cc-s">${c.s}</span></span>
    </button>`).join('');
  overlay.innerHTML = `<div class="compose-panel create-panel">
    <button class="create-x" type="button" aria-label="Close">${cSvg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>', { size: 17, sw: 2 })}</button>
    <div class="create-eyebrow">Create</div>
    <h2 class="create-h2">What would you like to create today?</h2>
    <p class="create-sub">Choose a format to start a new post.</p>
    <div class="create-grid">${cards}</div>
    <div class="create-search">${cSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.4-3.4"/>', { size: 17, sw: 2 })}
      <input type="text" placeholder="Search through my workbench files to find my content quickly." data-create-search aria-label="Search my workbench" />
      <span class="create-kbd">&#8984;K</span>
    </div>
    <div class="create-recent" data-create-recent hidden>
      <div class="create-recent-h">Recent drafts</div>
      <div data-create-recent-list></div>
    </div>
  </div>`;
  const onEsc = (e) => { if (e.key === 'Escape') close(); };
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onEsc); };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); }); // backdrop click
  overlay.querySelector('.create-x')?.addEventListener('click', close);
  overlay.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    close();
    const t = b.dataset.new;
    if (t === 'share') openComposeModal();
    else window.location.href = `workspace.html#new=${t}`; // a blank editor of that type (works from any page)
  }));
  document.addEventListener('keydown', onEsc);
  document.body.appendChild(overlay);
  overlay.querySelector('[data-create-search]')?.focus?.();
  loadCreateRecent(overlay); // best-effort; populates / hides the Recent drafts list + wires the search filter
}

// SOW-064: the member's WorkBench content powers the popup's Recent drafts + search. It is fetched once and cached
// in chrome.storage.local for 24h, warmed by prefetchCreateRecent() on shell load, so the "+" popup renders the
// list instantly. Only a non-empty result is cached, so a signed-out / pre-auth miss never poisons the cache.
const CREATE_RECENT_KEY = 'gbti:create-recent';
const CREATE_RECENT_TTL = 24 * 60 * 60 * 1000; // 24h
function createCacheGet(key) {
  return new Promise((res) => { try { chrome.storage.local.get(key, (o) => res(o?.[key] ?? null)); } catch { res(null); } });
}
function createCacheSet(key, val) {
  return new Promise((res) => { try { chrome.storage.local.set({ [key]: val }, () => res()); } catch { res(); } });
}
async function fetchCreateContent() {
  const types = ['post', 'prompt', 'product'];
  // The WorkBench "Drafts" tab lists the member's FORK-STAGED drafts (listDrafts / gbti/<type>-<slug> branches),
  // which are NOT in the committed /api/content set. Fetch them too and list them FIRST, so the popup's Recent
  // drafts matches the Drafts tab (staged drafts before committed content). One extra request, cached 24h.
  const [draftsRes, ...results] = await Promise.all([
    api('/api/drafts'),
    ...types.map((t) => api('/api/content', { type: t })),
  ]);
  const items = [];
  // Staged drafts first (forced status 'draft' so they badge as drafts and sort ahead of published content).
  const stagedKeys = new Set();
  for (const d of (Array.isArray(draftsRes?.drafts) ? draftsRes.drafts : [])) {
    stagedKeys.add(`${d.type}:${d.slug}`);
    items.push({ type: d.type, title: d.title || d.slug || 'Untitled', status: 'draft' });
  }
  // SOW-073 P5: the workbench SWR cache reads the SAME per-type content. Warm it here from the FULL items this
  // prefetch already fetched (free, no extra request), so the first workbench open is an instant cache hit.
  // Success-only: api() returns null on failure, so a missing items array never poisons the cache.
  const mk = _lastStatus?.identity?.githubId || _lastStatus?.identity?.login || null;
  results.forEach((r, i) => {
    const full = Array.isArray(r?.items) ? r.items : null;
    if (mk && full) { try { wbCacheSet(String(mk), types[i], full, { allowEmpty: true }); } catch { /* best-effort */ } }
    for (const it of full || []) {
      if (stagedKeys.has(`${types[i]}:${it.slug}`)) continue; // already shown as a staged draft above
      items.push({ type: types[i], title: it.title || it.slug || 'Untitled', status: it.status || '' });
    }
  });
  return items;
}
async function getCreateRecent({ force = false } = {}) {
  try {
    const c = await createCacheGet(CREATE_RECENT_KEY);
    if (!force && c && Array.isArray(c.items) && c.items.length && (Date.now() - (c.at || 0)) < CREATE_RECENT_TTL) return c.items;
  } catch { /* fall through to a fresh fetch */ }
  const items = await fetchCreateContent();
  if (items.length) await createCacheSet(CREATE_RECENT_KEY, { at: Date.now(), items });
  return items;
}
/** Warm the 24h cache on shell load (signed-in) so the "+" popup's Recent drafts render instantly. */
function prefetchCreateRecent() { try { getCreateRecent(); } catch { /* best-effort */ } }

// Populate the popup's "Recent drafts" + wire the workbench search. With no query it shows ALL DRAFTS first, then
// published; each row is badged with its publish state. Typing filters by title (drafts still first). A row opens
// that type's WorkBench list. Best-effort: an empty content set leaves the section hidden.
const CREATE_STATE = (s) => (s === 'draft' ? { cls: 'draft', label: 'Draft' } : (s === 'published' ? { cls: 'pub', label: 'Published' } : null));
async function loadCreateRecent(overlay) {
  const wrap = overlay.querySelector('[data-create-recent]');
  const list = overlay.querySelector('[data-create-recent-list]');
  const search = overlay.querySelector('[data-create-search]');
  if (!wrap || !list) return;
  const all = await getCreateRecent();
  if (!all.length) { wrap.hidden = true; return; }
  const draftsFirst = (arr) => [...arr.filter((x) => x.status === 'draft'), ...arr.filter((x) => x.status !== 'draft')];
  const rowHtml = (x) => {
    const st = CREATE_STATE(x.status);
    const meta = `${CREATE_TYPE_LABEL[x.type] || ''}${st ? ` <span class="create-state ${st.cls}">${st.label}</span>` : ''}`;
    return `<button class="create-row" data-go="${x.type}" type="button">
      <span class="create-row-ico">${cSvg(CREATE_FILE_ICO, { size: 15, sw: 1.9 })}</span>
      <span class="create-row-tx"><span class="create-row-t">${esc(x.title)}</span><span class="create-row-s">${meta}</span></span>
      ${cSvg('<path d="m9 6 6 6-6 6"/>', { size: 17, sw: 2 })}
    </button>`;
  };
  const wireRows = () => list.querySelectorAll('[data-go]').forEach((b) =>
    b.addEventListener('click', () => { window.location.href = `workspace.html#tab=${b.dataset.go}`; }));
  const render = (q) => {
    const ql = String(q || '').trim().toLowerCase();
    const matched = ql ? all.filter((x) => x.title.toLowerCase().includes(ql)) : all;
    const rows = draftsFirst(matched).slice(0, 3); // show at most three (drafts first, then published)
    list.innerHTML = rows.length ? rows.map(rowHtml).join('') : `<div class="create-empty">No matching files.</div>`;
    wireRows();
  };
  wrap.hidden = false;
  render('');
  search?.addEventListener('input', () => render(search.value));
}

function wireCompose(root) {
  root.querySelector('[data-compose]')?.addEventListener('click', () => openCreateModal());
}

async function wireApps(root) {
  const apps = root.querySelector('[data-apps]');
  if (!apps) return;
  apps.querySelector('[data-open-dailydev]')?.addEventListener('click', () => { window.location.href = DAILYDEV_APP_URL; });
  const img = apps.querySelector('[data-dd-img]');
  img?.addEventListener('error', () => { const b = document.createElement('span'); b.className = 'dd'; b.textContent = 'dd'; img.replaceWith(b); }, { once: true });
  let installed = null;
  try { if (chrome.management?.get) { const info = await chrome.management.get(DAILYDEV_ID).catch(() => null); installed = Boolean(info && info.enabled); } } catch { /* no management permission */ }
  if (installed === true || installed === null) apps.classList.add('show'); // show when present, or when we cannot tell
}

/** Inject + wire the shell into [data-shell]. `active` = the rail key to highlight (or null); `nav` = which rail
 *  variant ('feed' for the new tab, 'workbench' for the management pages). SOW-052: there is no top bar anymore —
 *  the control cluster is appended to the page's top-right [data-topbar] slot (created at the top of <main> if the
 *  page does not provide one), and the rail varies by `nav`. */
// SOW-062 5e: under 800px the rail becomes an off-canvas drawer; the top-bar hamburger toggles it. Mirrors
// wireAccount (outside-click + Escape close); tapping a rail link closes it. Above 800px the rail is static (the
// hamburger is CSS-hidden), so this is inert on desktop.
function wireDrawer(root) {
  const rail = root.querySelector('.nt-rail');
  const btn = root.querySelector('[data-drawer-toggle]');
  if (!rail || !btn) return;
  let scrim = document.querySelector('.nt-scrim');
  if (!scrim) { scrim = document.createElement('div'); scrim.className = 'nt-scrim'; document.body.appendChild(scrim); }
  const close = () => { rail.classList.remove('open'); scrim.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); };
  const open = () => { rail.classList.add('open'); scrim.classList.add('open'); btn.setAttribute('aria-expanded', 'true'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); rail.classList.contains('open') ? close() : open(); });
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rail.classList.contains('open')) close(); });
  rail.querySelectorAll('a').forEach((a) => a.addEventListener('click', close));
}

export function initShell({ active = null, nav = 'feed' } = {}) {
  const root = document.querySelector('[data-shell]');
  if (!root) return { ico, loadShellAccount: () => loadShellAccount(null) };
  const main = root.querySelector('.nt-main');
  // The rail is the left column (a direct child of [data-shell], before <main>).
  if (main) main.insertAdjacentHTML('beforebegin', railHtml(active, nav));
  else root.insertAdjacentHTML('afterbegin', railHtml(active, nav));
  // The controls live top-right of the content: append them to the page's [data-topbar] row (create a bare one at
  // the top of <main> when the page does not wrap its heading in one).
  if (main) {
    let topbar = main.querySelector('[data-topbar]');
    if (!topbar) { topbar = document.createElement('div'); topbar.className = 'nt-top'; topbar.setAttribute('data-topbar', ''); main.prepend(topbar); }
    topbar.insertAdjacentHTML('beforeend', controlsHtml());
  }
  // Fill the inline-SVG glyphs (rail + controls + any static [data-ico] in the page main). Trusted constants.
  root.querySelectorAll('[data-ico]').forEach((el) => { el.innerHTML = ico(el.dataset.ico); });
  applyHeadingIcon(active); // SOW-064: lead the page heading with the active section's icon
  const themeBtn = root.querySelector('[data-theme-toggle]');
  if (themeBtn) {
    themeBtn.innerHTML = ico(document.documentElement.getAttribute('data-theme') === 'dark' ? 'sun' : 'moon');
    themeBtn.addEventListener('click', () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'));
  }
  wireApps(root);
  wireAccount(root);
  wireCompose(root);
  wireDrawer(root);
  // SOW-048: gate AFTER the status round-trip. Signed in -> the app stays; signed out -> the login splash overlays
  // it (data-unauth hides the rest). Kept off the synchronous path so initShell's return shape is unchanged.
  loadShellAccount(root).then((status) => {
    if (!status) { mountAuthGate(root, { expired: _lastStatus?.sessionExpired === true }); return; }
    maybeShowExpiryPopup(status).catch(() => {}); // SOW-119 QA: the coupon-expiry countdown (all shell pages)
  });
  return { ico, loadShellAccount: () => loadShellAccount(root) };
}

// SOW-119 QA (2026-07-18): the coupon-expiry countdown popup. Shows for a member whose PAID status is a
// coupon grant (the status oracle emits couponUntil only then), inside the final EXPIRY_POPUP_START_DAYS,
// at most once per cooldown (7 days, collapsing to daily in the final week; the pure decision lives in
// client-ui/src/membership-expiry.mjs). Every close path persists the dismissal instant, so the cadence
// re-derives instead of sleeping through the deadline. The CTA is the established outbound membership
// deep-link (there is no in-extension checkout by design). Before nagging it re-verifies the grant against
// the live oracle (/api/coupon-refresh), so a member who converted to a real subscription is never nagged
// off a stale cached date.
const EXPIRY_DISMISS_KEY = 'gbti-expiry-dismissed';
async function maybeShowExpiryPopup(status) {
  const cachedUntil = status?.couponUntil;
  if (!cachedUntil || document.querySelector('.expiry-modal')) return;
  let dismissedAt = null;
  try { dismissedAt = JSON.parse(localStorage.getItem(EXPIRY_DISMISS_KEY) || 'null')?.at ?? null; } catch { dismissedAt = null; }
  if (!expiryPopupDecision({ until: cachedUntil, dismissedAt, now: Date.now() }).show) return;
  // The CACHED date says nag; re-verify against the live oracle first. couponUntil is seeded at sign-in and
  // never re-resolved while membership stays paid, so a member who already converted to a real subscription
  // would otherwise be nagged until a re-login. The recheck rewrites the store from the oracle (which
  // suppresses couponUntil for Stripe-paid); an error answer leaves the store untouched and defers the
  // popup to the next page load.
  const fresh = await api('/api/coupon-refresh');
  const until = fresh && !fresh.error ? fresh.couponUntil : null;
  if (!until) return;
  const { show, daysLeft } = expiryPopupDecision({ until, dismissedAt, now: Date.now() });
  if (!show) return;
  // The first-run welcome overlay (newtab, z-1200) paints opaque ABOVE this popup; mounted beneath it, an
  // Escape meant for the welcome would burn a snooze on a popup the member never saw. Defer to the next load.
  if (document.querySelector('.nt-welcome-overlay')) return;
  const { headline, dateLabel, count } = expiryPopupCopy(daysLeft, until, Date.now());
  const overlay = document.createElement('div');
  overlay.className = 'compose-modal expiry-modal';
  overlay.innerHTML = `<div class="compose-panel expiry-panel">
    <div class="compose-head"><b>Membership</b><button class="compose-x" type="button" aria-label="Close">${ico('x')}</button></div>
    <div class="expiry-body">
      <div class="expiry-count">${count}</div>
      <h2>${headline}</h2>
      ${dateLabel ? `<p class="expiry-date">Your complimentary year runs through <b>${dateLabel}</b>.</p>` : ''}
      <p class="expiry-note">Becoming a paying member keeps your profile, articles, products, and prompts
        published, your Discord access open, and your revenue share active. Nothing bills automatically;
        if you do nothing, your work simply unpublishes at the end and comes back whenever you join.</p>
      <a class="expiry-cta" href="https://gbti.network/membership/" target="_blank" rel="noopener">Become a paying member</a>
      <button class="expiry-later" type="button">Remind me later</button>
    </div>
  </div>`;
  const dismiss = () => {
    try { localStorage.setItem(EXPIRY_DISMISS_KEY, JSON.stringify({ at: Date.now() })); } catch { /* no storage */ }
    overlay.remove();
    document.removeEventListener('keydown', onEsc);
  };
  // Ignore Escape while a welcome overlay covers the popup (it can mount after us): that keypress belongs
  // to the welcome, and honoring it would record a dismissal the member never saw.
  const onEsc = (e) => { if (e.key === 'Escape' && !document.querySelector('.nt-welcome-overlay')) dismiss(); };
  document.addEventListener('keydown', onEsc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) dismiss(); }); // nothing in-progress to lose
  overlay.querySelector('.compose-x')?.addEventListener('click', dismiss);
  overlay.querySelector('.expiry-later')?.addEventListener('click', dismiss);
  overlay.querySelector('.expiry-cta')?.addEventListener('click', dismiss); // following the CTA also stops the nagging
  document.body.appendChild(overlay);
}
