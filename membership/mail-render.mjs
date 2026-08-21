// SOW-166: renderIssue v2, the SEND-READY table template behind the injected `renderIssue` seam. Built from the
// owner's design handoff (`.data/sow/1_progressing/cf-server/sow-166-assets/`), reconciled to our systems by the
// owner's 2026-08-21 rulings: it ships the design's skeleton, typography and visual language, and takes its
// facts, ordering and fields from the composition core, never from the mockup. Two 600px table-based palettes
// share one skeleton; this renders the LIGHT variant by default (the design's own note calls it safest across
// inboxes, and prefers-color-scheme is unreliable in email, so the dark/light choice is a PICK via `ctx.theme`,
// not a both). No JavaScript, no web fonts, all inline styles: static table HTML plus a plain-text alternative.
//
// PURE and node-free. It reads only the frozen issue (layout, counts, generatedAt, launchNote) and the injected
// ctx, calls no Date.now (it formats the FROZEN generatedAt in UTC, deterministic), and returns
// { subject, html, text }. Ordering, the filled-before-empty split, and the empty-section copy are decided once
// in the composition core (membership/mail-digest.mjs buildLayout) and never re-derived here.
//
// WHAT RENDERS FROM ABSENT DATA, NEVER A PLACEHOLDER (each is gated upstream, so the row degrades rather than
// inventing content that could ship wrong):
//   - blurb: an OPTIONAL item field carrying the item's PUBLIC frontmatter excerpt / shortDescription. The
//     renderer reads `it.blurb` and NOTHING ELSE: it NEVER falls back to `it.body` or any ciphertext. That
//     no-fallback behaviour is the security control, not a nicety, and a test pins it (an item with a body and
//     no blurb renders an empty row). The composition projection is public-safe by construction and carries no
//     body field at all; this keeps the guard true even if a caller hand-builds an item.
//   - thumb: an OPTIONAL item field (already present in activity-index.json). Rendered through safeUrl, so an
//     unsafe value drops to no image. Absent means a single-column row.
//   - avatar: DERIVED from `it.author` (github.com/<login>.png), so it needs no new field. Decorative, empty
//     alt, and images are blocked by default in email, so a wrong or missing login shows nothing, never a
//     broken label.
//   - NO Sponsored card and NO standalone Plans card (owner ruling: dropped from this template).
//   - NO greeting personalisation beyond the design's `simple` default (a first name is stored nowhere).
//   - postal address: rendered ONLY from ctx.postalAddress, and ONLY when the drain supplies it (the CAN-SPAM
//     7704(a)(5) footer slot). There is no default and nothing hardcoded: absent ctx renders no address at all,
//     which is the permanent contract that keeps the value off the default render path. OWNER 2026-08-21: the
//     address is provided and used, but it is per-recipient CONFIG, not source. The value lives in the
//     MAIL_POSTAL_ADDRESS Worker secret, the drain reads it and passes it in ctx, and it must NEVER reach a
//     committed file: the content repo is public, so a street address in git history is a permanent, forkable,
//     crawlable exposure that an email to a subscriber is not. For that reason the test fixture is an obviously
//     fake address, and the real value appears in no comment, doc, or commit message.
//
// UNSUBSCRIBE. `ctx.unsubscribeUrl` is per-recipient and arrives from the drain at send time; the renderer mints
// no token. With a real url the footer carries a one-click Unsubscribe link. WITHOUT one it renders a
// managed-subscription prose line with NO link. That prose branch is NOT a supported degraded SEND mode: an
// email with no working opt-out must never be sent, and enforcing that is owed to the drain, which MUST refuse a
// recipient with no unsubscribeUrl rather than render this branch. The branch exists for the public web archive
// (a permalink issue is not a mailed message and needs no opt-out), and as a fail-safe that shows no dead link.
// It sets NO email headers: List-Unsubscribe and the multipart assembly are the sendEmail wrapper's job.

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** Escape for HTML text nodes and double-quoted attributes. Layout items are public content, so this is the
 *  primary guard against a stray angle bracket or quote in a title breaking the markup. */
export function escapeHtml(v) {
  return str(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** A URL safe to place in an href/src: only http(s) and site-relative urls survive; anything else
 *  (javascript:, data:, a malformed value) becomes '' so it renders as plain text or no image, never a live
 *  link. Fail-closed. */
export function safeUrl(v) {
  const s = str(v).trim();
  if (!s) return '';
  if (s.startsWith('/')) return s;
  if (/^https?:\/\//i.test(s)) return s;
  return '';
}

/** A member item's byline, preferring the display name, then the handle, else nothing. */
function byline(it) {
  const name = str(it.authorName).trim() || str(it.author).trim();
  return name ? `by ${name}` : '';
}

/** The canonical GitHub avatar for a login, derived (no stored field). GitHub serves every account's avatar at
 *  github.com/<login>.png and 404s for an unknown login; here that means a blocked or broken decorative image,
 *  which shows nothing. Mirrors src/lib/avatars.ts githubAvatarUrl. */
function avatarUrl(login) {
  const l = str(login).trim();
  return l ? `https://github.com/${encodeURIComponent(l)}.png?size=32` : '';
}

/** An ABSOLUTE, safe url for an email. safeUrl fails an unsafe value closed to ''; a surviving site-relative
 *  path is then prefixed with siteUrl, because a bare "/blog/x/" href is a dead link in a mail client (there is
 *  no page base). An external http(s) url passes through unchanged. Absolute urls are correct for the web
 *  archive too, so this one path serves both outputs. */
function absUrl(url, siteUrl) {
  const u = safeUrl(url);
  if (!u) return '';
  return u.startsWith('/') ? `${siteUrl}${u}` : u;
}

// The PALETTE TOKEN LAYER. Both variants are copied verbatim from the design's Light and Dark blocks, so the
// owner's choice is one value in ctx and never a template edit. LIGHT is the default and the shipping variant.
const PALETTES = {
  light: {
    pageBg: '#efece7', cardBg: '#ffffff', cardBorder: '#e0dbd3', hairline: '#eae6df',
    ink: '#232029', inkSoft: '#4a4653', meta: '#7c7784', accent: '#187a4b', rule: '#187a4b',
    footerLink: '#4a4653', postalMeta: '#9b96a1',
  },
  dark: {
    pageBg: '#1b1922', cardBg: '#232029', cardBorder: '#35313d', hairline: '#302c37',
    ink: '#f3f2f0', inkSoft: '#bdbac4', meta: '#847f8d', accent: '#5fd49a', rule: '#1f9e5f',
    footerLink: '#bdbac4', postalMeta: '#847f8d',
  },
};

// Per-type public feed routes (SOW-131 / SOW-139), the only link targets the renderer invents, each a real
// public route.
const SECTION_FEED = {
  article: '/feeds/articles/', product: '/feeds/products/', prompt: '/feeds/prompts/',
  share: '/feeds/shares/', news: '/feeds/news/',
};
const COUNT_ORDER = ['article', 'prompt', 'product', 'share', 'news'];
const COUNT_NOUNS = {
  article: ['article', 'articles'], prompt: ['prompt', 'prompts'], product: ['product', 'products'],
  share: ['member share', 'member shares'], news: ['news pick', 'news picks'],
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 3600 * 1000;

function plural(n, key) {
  const [one, many] = COUNT_NOUNS[key];
  return `${n} ${n === 1 ? one : many}`;
}

// The 7-day display range ending at the compile day, formatted in UTC from the FROZEN generatedAt. A plain ASCII
// hyphen is a range hyphen, not an en dash, so "Aug 15-21" is compliant with the no-dash writing rule.
function weekRange(generatedAt) {
  const end = Number(generatedAt);
  if (!Number.isFinite(end)) return null;
  const s = new Date(end - 6 * DAY_MS);
  const e = new Date(end);
  const sM = MONTHS[s.getUTCMonth()];
  const eM = MONTHS[e.getUTCMonth()];
  const sD = s.getUTCDate();
  const eD = e.getUTCDate();
  const y = e.getUTCFullYear();
  const short = sM === eM ? `${sM} ${sD}-${eD}` : `${sM} ${sD} to ${eM} ${eD}`;
  return { short, mono: `${short}, ${y}`.toUpperCase() };
}

function totalItems(counts) {
  if (!counts) return 0;
  return COUNT_ORDER.reduce((n, k) => n + (Number(counts[k]) || 0), 0);
}

// The preheader summary, natural language, non-zero sections only: "4 articles, 2 products and 3 news picks".
function countsSummary(counts) {
  const parts = COUNT_ORDER.filter((k) => (Number(counts?.[k]) || 0) > 0).map((k) => plural(Number(counts[k]), k));
  if (parts.length === 0) return 'Your weekly roundup from the GBTI Network.';
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list} from the network this week.`;
}

// The counts subject "GBTI Digest · 18 items · Aug 15-21", built only when the issue carries both counts and a
// finite generatedAt. Absent either, the caller falls back to the plain default (so a bare fixture is unaffected).
function computedSubject(counts, range) {
  if (!counts || !range) return '';
  const n = totalItems(counts);
  return `GBTI Digest · ${n} ${n === 1 ? 'item' : 'items'} · ${range.short}`;
}

// The empty-section collapse: one compact line naming the empty sections, cadence-anchored so it stays true
// across the smoothed send (the last recipient may open days after the first). First issue swaps the clause.
function emptyPhrase(empties, firstIssue) {
  const labels = empties.map((s) => str(s.label));
  const list = labels.length === 1
    ? labels[0]
    : `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
  return `Nothing new in ${list} ${firstIssue ? 'in the past week' : 'since the last issue'}.`;
}

// The meta line under a title: a monospace byline (member) or source (news), with the member author's derived
// avatar to its left. News has no author, so no avatar.
function metaLineHtml(sectionKey, it, p) {
  const meta = sectionKey === 'news' ? escapeHtml(str(it.source).trim()) : escapeHtml(byline(it));
  if (!meta) return '';
  const metaText = `<span style="font-family:'Courier New',monospace;font-size:10.5px;letter-spacing:.05em;color:${p.meta}">${meta}</span>`;
  const avatar = sectionKey === 'news' ? '' : avatarUrl(it.author);
  if (!avatar) return `<div style="padding-top:7px;mso-line-height-rule:exactly;line-height:16px">${metaText}</div>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="padding-top:7px"><tr>`
    + `<td width="16" valign="middle" style="width:16px;padding-right:7px">`
    + `<img src="${escapeHtml(avatar)}" width="16" height="16" alt="" style="display:block;width:16px;height:16px;border-radius:8px" />`
    + `</td>`
    + `<td valign="middle">${metaText}</td>`
    + `</tr></table>`;
}

// A single item: a linked (or plain, fail-closed) title, an OPTIONAL blurb (public frontmatter only, bare when
// absent), the meta line, and an OPTIONAL thumbnail (member items only). No blurb ever comes from a body.
function itemHtml(sectionKey, it, p, siteUrl) {
  const title = escapeHtml(str(it.title).trim() || '(untitled)');
  const url = absUrl(it.url, siteUrl);
  const titleStyle = `font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${p.ink};text-decoration:none;mso-line-height-rule:exactly;line-height:19px`;
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" style="${titleStyle}">${title}</a>`
    : `<span style="${titleStyle}">${title}</span>`;
  const blurb = str(it.blurb).trim();
  const blurbHtml = blurb
    ? `<div style="padding-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:17px">${escapeHtml(blurb)}</div>`
    : '';
  const left = `${titleHtml}${blurbHtml}${metaLineHtml(sectionKey, it, p)}`;
  const thumb = sectionKey === 'news' ? '' : absUrl(it.thumb, siteUrl);

  const inner = thumb
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
      + `<td width="368" valign="top" style="width:368px">${left}</td>`
      + `<td width="16" style="width:16px">&nbsp;</td>`
      + `<td width="96" valign="top" style="width:96px">`
      + `<img src="${escapeHtml(thumb)}" width="96" alt="${title}" style="display:block;width:96px;max-width:96px;height:auto;border:1px solid ${p.cardBorder};border-radius:6px" />`
      + `</td></tr></table>`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
      + `<td width="480" valign="top" style="width:480px">${left}</td></tr></table>`;

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:15px 28px;border-bottom:1px solid ${p.hairline}">${inner}</td></tr></table>`;
}

// One FILLED section: a header row (name + monospace count label), a 2px brand rule, the item rows, and a
// "See all" link into that type's public feed. Empty sections never reach here; they collapse (see emptyLineHtml).
function sectionHtml(section, p, siteUrl) {
  const name = escapeHtml(str(section.label));
  const n = Array.isArray(section.items) ? section.items.length : 0;
  const feed = absUrl(SECTION_FEED[section.key] || '/feeds/', siteUrl);

  const head = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:44px 28px 0">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
    + `<td align="left" style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:18px">${name}</td>`
    + `<td align="right" style="font-family:'Courier New',monospace;font-size:10.5px;font-weight:700;letter-spacing:.09em;color:${p.accent};mso-line-height-rule:exactly;line-height:18px">${escapeHtml(`${n} NEW`)}</td>`
    + `</tr></table></td></tr>`
    + `<tr><td width="536" style="width:536px;padding:9px 28px 0"><div style="height:2px;background-color:${p.rule};font-size:0;line-height:0">&nbsp;</div></td></tr></table>`;

  const items = section.items.map((it) => itemHtml(section.key, it, p, siteUrl)).join('');
  const seeAll = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:14px 28px 0">`
    + `<a href="${escapeHtml(feed)}" style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};text-decoration:underline">See all in the ${name} feed</a>`
    + `</td></tr></table>`;
  // An invisible sentinel marking an editorial section start. The CAN-SPAM primary-purpose guards read it to
  // assert editorial content precedes the membership CTA and nothing editorial follows the CTA. Comments are
  // inert in every mail client; this is a test locator, not visible copy.
  return `<div><!--editorial:${escapeHtml(section.key)}-->${head}${items}${seeAll}</div>`;
}

function emptyLineHtml(empties, p, firstIssue, siteUrl) {
  if (!empties.length) return '';
  const phrase = escapeHtml(emptyPhrase(empties, firstIssue));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:34px 28px 0">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};mso-line-height-rule:exactly;line-height:18px">`
    + `${phrase} <a href="${escapeHtml(absUrl('/feeds/', siteUrl))}" style="color:${p.footerLink};text-decoration:underline">Browse the archive</a></div>`
    + `</td></tr></table>`;
}

// THE MEMBERSHIP CTA, and the CAN-SPAM primary-purpose position makes its SHAPE a compliance constraint, not a
// design choice (see .data/ops/mail-ops/can-spam-primary-purpose-position.md). It is deliberately ONE modest
// block, placed AFTER all editorial content and before the footer, and it renders only for an issue that has at
// least one editorial section (an all-empty issue carrying a solicitation would read as primarily promotional).
// Modest by construction: body-size type, no filled button, no accent background, one text link, no price (the
// membership page carries the current price). It reuses the perks language the footer already shipped rather
// than introducing new promotional copy. The sentinels are inert test locators for the placement/proportion/
// emphasis guards. The same block renders for every recipient of the issue (compile-once, Q12): harmless to a
// paid member, and per-recipient targeting would break the single frozen issue. Suppress a given issue's CTA
// with ctx.membershipCta === false.
function membershipCtaHtml(p, siteUrl) {
  const href = escapeHtml(absUrl('/membership/', siteUrl));
  return `<!--membership-cta-->`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:30px 28px 0">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:18px">`
    + `Reading the digest is free. Membership adds commenting, collections, member Shares and the Discord community. `
    + `<a href="${href}" style="color:${p.footerLink};text-decoration:underline">See membership</a>`
    + `</div>`
    + `</td></tr></table>`
    + `<!--/membership-cta-->`;
}

function headerHtml(p, ctx, range, launchNote) {
  const greeting = escapeHtml(str(ctx.greeting).trim() || 'This week on the network');
  const headerLine = escapeHtml(str(ctx.headerLine).trim() || 'Everything new across the network since the last issue.');
  const dateCell = range
    ? `<td align="right" style="font-family:'Courier New',monospace;font-size:10.5px;letter-spacing:.1em;color:${p.meta};mso-line-height-rule:exactly;line-height:22px">${escapeHtml(range.mono)}</td>`
    : '';
  const launchHtml = launchNote
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-style:italic;color:${p.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px">${escapeHtml(str(launchNote))}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:22px 28px 18px;border-bottom:1px solid ${p.hairline}">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
    + `<td align="left" style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:18px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:22px">GBTI <span style="color:${p.accent}">Digest</span></td>`
    + dateCell
    + `</tr></table>`
    + `<div style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14.5px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:20px;padding-top:12px">${greeting}</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:19px;padding-top:5px">${headerLine}</div>`
    + launchHtml
    + `</td></tr></table>`;
}

function footerHtml(p, ctx, siteUrl) {
  const unsub = safeUrl(ctx.unsubscribeUrl);
  const feedAbs = `${siteUrl}/feeds/`;
  // A real url renders a one-click Unsubscribe link; without one a managed-subscription line with NO link. That
  // fallback is NOT permission to send without an opt-out (the drain must refuse such a recipient); in a real
  // send this branch is unreachable, and it exists for the web archive and as a no-dead-link fail-safe.
  const unsubLink = unsub
    ? `<a href="${escapeHtml(unsub)}" style="color:${p.footerLink};text-decoration:underline">Unsubscribe</a>`
    : `manage your subscription from <a href="${escapeHtml(siteUrl)}" style="color:${p.footerLink};text-decoration:underline">gbti.network</a>`;
  const links = `<a href="${escapeHtml(feedAbs)}" style="color:${p.footerLink};text-decoration:underline">Open the feed</a> &middot; ${unsubLink}`;
  // The CAN-SPAM postal slot. Rendered ONLY when the drain supplies ctx.postalAddress (from the MAIL_POSTAL_ADDRESS
  // secret); absent means no address line. The value is never defaulted or hardcoded here (see the header note).
  const postal = str(ctx.postalAddress).trim();
  const postalLine = postal
    ? `<div style="font-family:'Courier New',monospace;font-size:10px;color:${p.postalMeta};mso-line-height-rule:exactly;line-height:16px;padding-top:12px">${escapeHtml(postal)}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:28px 28px 24px">`
    + `<div style="height:1px;background-color:${p.hairline};font-size:0;line-height:0">&nbsp;</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:14px">You get this digest every week because you are on the GBTI Network list.</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px">${links}</div>`
    + postalLine
    + `</td></tr></table>`;
}

function sectionText(section, siteUrl) {
  const n = Array.isArray(section.items) ? section.items.length : 0;
  return `${str(section.label).toUpperCase()} (${n})\n${section.items.map((it) => itemText(section.key, it, siteUrl)).join('\n')}`;
}

function itemText(sectionKey, it, siteUrl) {
  const title = str(it.title).trim() || '(untitled)';
  const url = absUrl(it.url, siteUrl);
  const meta = sectionKey === 'news' ? str(it.source).trim() : byline(it);
  const suffix = meta ? ` (${meta})` : '';
  return url ? `- ${title}${suffix}\n  ${url}` : `- ${title}${suffix}`;
}

/**
 * Render the frozen issue into { subject, html, text }. Reads only the render-ready `layout` (ordering + the
 * filled-before-empty split owned by the composition core), `counts` and `generatedAt` for the subject and
 * preheader, `launchNote` for the first-issue clause, and ctx.
 *
 * @param issue  the frozen composeIssue output ({ issueId, layout, counts, generatedAt, launchNote, ... })
 * @param ctx    { theme?, unsubscribeUrl?, siteUrl?, subject?, greeting?, headerLine?, postalAddress? }, per recipient
 */
export function renderIssue(issue, ctx = {}) {
  const p = PALETTES[ctx.theme === 'dark' ? 'dark' : 'light'];
  const layout = Array.isArray(issue?.layout) ? issue.layout : [];
  const filled = layout.filter((s) => !s.empty);
  const empties = layout.filter((s) => s.empty);
  const firstIssue = Boolean(issue?.launchNote);
  const counts = issue?.counts || null;
  const range = weekRange(issue?.generatedAt);
  const siteUrl = safeUrl(ctx.siteUrl) || 'https://gbti.network';
  const subject = str(ctx.subject).trim() || computedSubject(counts, range) || 'The GBTI Network weekly digest';

  const preheaderText = escapeHtml(counts ? countsSummary(counts) : 'Your weekly roundup from the GBTI Network.');
  const preheader = `<span style="display:none;font-size:1px;color:${p.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheaderText}</span>`;

  // The membership CTA renders only when the issue has editorial content AND the caller did not suppress it. An
  // all-editorial-empty issue carrying a solicitation would read as primarily promotional (see the CTA note).
  const showCta = filled.length > 0 && ctx.membershipCta !== false;
  const body = filled.map((s) => sectionHtml(s, p, siteUrl)).join('')
    + emptyLineHtml(empties, p, firstIssue, siteUrl)
    + (showCta ? membershipCtaHtml(p, siteUrl) : '');

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${p.pageBg}">`
    + preheader
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width:600px;background-color:${p.pageBg}">`
    + `<tr><td width="600" align="center" style="width:600px;padding:24px 0 40px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px;background-color:${p.cardBg};border:1px solid ${p.cardBorder}">`
    + `<tr><td width="536" style="width:536px;padding:0">`
    + headerHtml(p, ctx, range, issue?.launchNote)
    + body
    + footerHtml(p, ctx, siteUrl)
    + `</td></tr></table>`
    + `</td></tr></table>`
    + `</body></html>`;

  const unsub = safeUrl(ctx.unsubscribeUrl);
  const unsubText = unsub
    ? `Unsubscribe from the weekly digest: ${unsub}`
    : 'Manage your subscription from the GBTI Network site.';
  const postal = str(ctx.postalAddress).trim();
  const postalText = postal ? `\n${postal}` : '';
  const greetingText = str(ctx.greeting).trim() || 'This week on the network';
  const headerLineText = str(ctx.headerLine).trim() || 'Everything new across the network since the last issue.';
  const launchText = issue?.launchNote ? `${str(issue.launchNote)}\n` : '';
  const filledText = filled.map((s) => sectionText(s, siteUrl)).join('\n\n');
  const emptyText = empties.length ? `\n\n${emptyPhrase(empties, firstIssue)}` : '';
  // The text-side CTA mirrors the html: one modest line, after all editorial, only when the html renders it.
  const ctaText = showCta
    ? `\n\nReading the digest is free. Membership adds commenting, collections, member Shares and the Discord community: ${siteUrl}/membership/`
    : '';

  const text = `GBTI DIGEST${range ? ` (${range.short})` : ''}\n`
    + `${greetingText}\n${headerLineText}\n${launchText}\n`
    + `${filledText}${emptyText}${ctaText}\n\n`
    + `----\n${siteUrl}\n${unsubText}${postalText}\n`;

  return { subject, html, text };
}
