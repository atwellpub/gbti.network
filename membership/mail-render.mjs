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
//     digest ships with NO postal address for now (the primary-purpose position, .data/ops/mail-ops/), and a
//     PO Box is a LATER intent. So this inert ctx.postalAddress slot is now LOAD-BEARING, not defensive: when
//     the PO Box exists it becomes a MAIL_POSTAL_ADDRESS Worker secret the drain reads and passes in ctx, a
//     config change, NOT a code change here. It must NEVER reach a committed file: the content repo is public,
//     so a street address in git history is a permanent, forkable, crawlable exposure that an email to a
//     subscriber is not. For that reason the test fixture is an obviously fake address, and the real value
//     appears in no comment, doc, or commit message.
//
// UNSUBSCRIBE. `ctx.unsubscribeUrl` is per-recipient and arrives from the drain at send time; the renderer mints
// no token. With a real url the footer carries a one-click Unsubscribe link. WITHOUT one it renders a
// managed-subscription prose line with NO link. That prose branch is NOT a supported degraded SEND mode: an
// email with no working opt-out must never be sent, and enforcing that is owed to the drain, which MUST refuse a
// recipient with no unsubscribeUrl rather than render this branch. The branch exists for the public web archive
// (a permalink issue is not a mailed message and needs no opt-out), and as a fail-safe that shows no dead link.
// It sets NO email headers: List-Unsubscribe and the multipart assembly are the sendEmail wrapper's job.

import { SECTION_FEED, clickSlot, clickPath, taggedTarget } from './mail-click.mjs';

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

// sow-273: the inbound campaign tags on a link back to OUR OWN site, so a click that started in the inbox
// arrives identifiable instead of as direct traffic. utm_source names where the click came from, utm_medium
// the channel, utm_campaign the ISSUE (so one issue is one row), and utm_content the PLACEMENT, which is the
// question actually worth answering: an item click and a footer click mean different things and today both
// arrive as the same undifferentiated visit.
const UTM_SOURCE = 'digest';
const UTM_MEDIUM = 'email';

/**
 * Tag a link that points at our own site. THREE things this deliberately does not do, each of which would be
 * a defect rather than a nicety:
 *
 *   - It never tags an EXTERNAL url. A news row links to the publisher, and stamping our campaign onto their
 *     url writes our attribution into their analytics while telling us nothing. Same-origin is checked
 *     against the resolved siteUrl rather than a hardcoded host, so a staging render tags staging links.
 *   - It is never used for an IMAGE. Thumbnails and the masthead mark keep going through absUrl: an asset
 *     fetch is not a click, and tagging one would inflate every count by the number of clients that load
 *     images.
 *   - It never touches the UNSUBSCRIBE url, which lives on the Worker, not the website, and is an opt-out
 *     rather than a campaign click.
 *
 * Existing query params survive (searchParams.set), and anything that will not parse falls through untagged
 * rather than throwing, because a broken link is worse than an unmeasured one.
 */
function trackUrl(url, links, content) {
  const abs = absUrl(url, links?.siteUrl ?? '');
  if (!abs) return '';

  // sow-273 follow-up: WHEN A CLICK BASE IS CONFIGURED, THE LINK GOES THROUGH THE COUNTER. This is the only
  // way the digest is measurable at all, because Cloudflare Web Analytics has no query-string field and
  // discards the utm tags below before storage (verified against its GraphQL schema, 2026-08-24).
  // The counter link carries an issue id, a placement and a hash of the destination, NEVER the destination,
  // so the route cannot be turned into an open redirect (see mail-click.mjs). This is the ONE place an
  // external url is rewritten, and it is deliberate: the owner elected on 2026-08-24 to count news clicks,
  // because which curated sources actually get read is the most useful thing the digest can tell us.
  // The utm tags STAY on the underlying url regardless. An email cannot be retagged after it is sent, so a
  // product that can read them later still gets a complete history from today onward.
  // The slot hashes the PLAIN absolute url, because that is what the route rebuilds from the frozen issue.
  if (links?.clickBase && links?.campaign) {
    const path = clickPath(links.campaign, content, clickSlot(abs));
    if (path) return `${String(links.clickBase).replace(/\/+$/, '')}${path}`;
  }
  return taggedTarget(abs, { siteUrl: links?.siteUrl, campaign: links?.campaign, placement: content });
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
// SECTION_FEED now lives in mail-click.mjs, imported above: the click route must resolve these exact
// paths, and a second copy here would drift and silently break those links.
const COUNT_ORDER = ['article', 'prompt', 'product', 'share', 'news'];
const COUNT_NOUNS = {
  article: ['article', 'articles'], prompt: ['prompt', 'prompts'], product: ['product', 'products'],
  share: ['member share', 'member shares'], news: ['news pick', 'news picks'],
};
const DAY_MS = 24 * 3600 * 1000;

function plural(n, key) {
  const [one, many] = COUNT_NOUNS[key];
  return `${n} ${n === 1 ? one : many}`;
}

// The date line under the wordmark, and the tail of the subject: the CALENDAR WEEK the issue went out in,
// "Week 34", not a span of dates.
//
// Owner ruling, 2026-08-24. This replaced a span, which itself replaced a fixed seven days that had been
// lying: the launch issue selects over ninety days, so an email headed "Aug 17-23" listed prompts from June
// and products from May, and the owner read it as missing content rather than as a wrong label. A week
// number cannot make that mistake, because it labels WHEN the issue was sent and claims nothing about what
// it reaches back to. What the issue covers is said in words instead, by the note under the greeting and by
// the empty-section line, where a reader can actually act on it.
//
// ISO 8601 weeks (Monday start, week 1 is the week holding January 4th), and the ISO WEEK-YEAR rather than
// the calendar year of the date. Those disagree for a few days each turn of the year: 2026-12-31 sits in
// week 1 of 2027, and printing "WEEK 1, 2026" there would be worse than the disagreement it avoids.
function coverageWeek(generatedAt) {
  const ms = Number(generatedAt);
  // `> 0` and not merely finite, because Number(null) is 0, not NaN. A null generatedAt would otherwise pass
  // a bare finite check and head the email "WEEK 1, 1970". The span version this replaced had the same hole
  // (it rendered "Dec 26, 1969 to Jan 1, 1970") and no test reached it; absent has to stay absent.
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return null;
  // Move to the Thursday of this week: the ISO year is whichever year that Thursday falls in.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const mondayIndex = (thursday.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  thursday.setUTCDate(thursday.getUTCDate() - mondayIndex + 3);
  const isoYear = thursday.getUTCFullYear();
  // January 4th is always in ISO week 1, so the Thursday of ITS week anchors the count.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Index = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(Date.UTC(isoYear, 0, 4 - jan4Index + 3));
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return { short: `Week ${week}`, mono: `WEEK ${week}, ${isoYear}` };
}

function totalItems(counts) {
  if (!counts) return 0;
  return COUNT_ORDER.reduce((n, k) => n + (Number(counts[k]) || 0), 0);
}

// "in the past 90 days" tracks BOOTSTRAP_MS, the launch/welcome window, and is the ONE copy of that phrase in
// this module. Both the preheader and the empty-section line read it, so widening the window here cannot move
// one sentence and leave the other behind, which is exactly how "this week" survived into a 90-day inbox.
const BOOTSTRAP_PHRASE = 'in the past 90 days';

// The preheader summary, natural language, non-zero sections only: "4 articles, 2 products and 3 news picks".
// It names the SPAN, and the span is not always a week: a first or welcome issue reaches back 90 days, so a
// preheader saying "this week" contradicts the header, the launch note and the date range beside it. This was
// the THIRD hardcoded copy of the cadence in the template and the last one to be found, by reading a delivered
// message rather than the source (2026-08-24).
function countsSummary(counts, firstIssue) {
  const parts = COUNT_ORDER.filter((k) => (Number(counts?.[k]) || 0) > 0).map((k) => plural(Number(counts[k]), k));
  if (parts.length === 0) return emptySummary(firstIssue);
  const list = parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `${list} from the network ${firstIssue ? BOOTSTRAP_PHRASE : 'this week'}.`;
}

// The no-counts fallback, same cadence split. Kept beside countsSummary rather than inlined at the call site,
// because a second literal at the call site is how the first two copies of this phrase drifted apart.
function emptySummary(firstIssue) {
  return firstIssue ? 'Your first roundup from the GBTI Network.' : 'Your weekly roundup from the GBTI Network.';
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
  // BOOTSTRAP_PHRASE is deliberately a copy of FIRST_ISSUE_PHRASE in membership/mail-digest.mjs rather than an
  // import, so this template stays free of digest imports and can be swapped behind the renderIssue seam. That
  // duplication already drifted once: the window moved from 7 days to 90 on 2026-08-22 and both strings were
  // left saying "week". A cross-module test now asserts the two agree, so the next move breaks a test instead
  // of a sentence in somebody's inbox.
  return `Nothing new in ${list} ${firstIssue ? BOOTSTRAP_PHRASE : 'since the last issue'}.`;
}

/**
 * What a reader should see under a news headline. `sourceName` is the display name from the sources config
 * ("The Verge"); `source` is the stored id, which is a slug and occasionally a mangled one. The first
 * delivered issue showed `object-object` under a Verge headline, because that string is literally the id in
 * house/news-sources.yml, and `engadget-technology-news-expert-reviews` under an Engadget one. Prefer the
 * name; fall back to the id so an unlisted source still identifies itself rather than rendering blank.
 */
function sourceLabel(it) {
  return str(it.sourceName).trim() || str(it.source).trim();
}

// The meta line under a title: a monospace byline (member) or source (news), with the member author's derived
// avatar to its left. News has no author, so no avatar.
function metaLineHtml(sectionKey, it, p) {
  const meta = sectionKey === 'news' ? escapeHtml(sourceLabel(it)) : escapeHtml(byline(it));
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
function itemHtml(sectionKey, it, p, links) {
  const title = escapeHtml(str(it.title).trim() || '(untitled)');
  const url = trackUrl(it.url, links, 'item');
  const titleStyle = `font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:${p.ink};text-decoration:none;mso-line-height-rule:exactly;line-height:19px`;
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" style="${titleStyle}">${title}</a>`
    : `<span style="${titleStyle}">${title}</span>`;
  const blurb = str(it.blurb).trim();
  const blurbHtml = blurb
    ? `<div style="padding-top:5px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:17px">${escapeHtml(blurb)}</div>`
    : '';
  const left = `${titleHtml}${blurbHtml}${metaLineHtml(sectionKey, it, p)}`;
  // NEWS ROWS CARRY THUMBNAILS TOO (owner, 2026-08-23). This was member-items-only, so the section with the
  // most rows was the one with no pictures. A news thumb is the publisher's own og:image on their own domain,
  // so it is an external absolute url; absUrl passes http(s) through untouched and fails anything else closed
  // to no image. Images are blocked by default in most clients, which is why the title is never inside the
  // image and the layout does not depend on it loading.
  const thumb = absUrl(it.thumb, links.siteUrl); // an image src, never tracked (see trackUrl)

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
function sectionHtml(section, p, links) {
  const name = escapeHtml(str(section.label));
  // "Latest Articles", "Latest News" (owner, 2026-08-23). The prefix is applied HERE, to the heading, and
  // NOT to SECTION_LABELS, because that same label is also the feed name in the "See all in the Articles
  // feed" link below and the type list in the collapsed empty line ("Nothing new in Articles, Products").
  // Prefixing at the source would produce "See all in the Latest Articles feed" and "Nothing new in Latest
  // Articles", both of which read as a mistake.
  const heading = escapeHtml(`Latest ${str(section.label)}`);
  const n = Array.isArray(section.items) ? section.items.length : 0;
  const feed = trackUrl(SECTION_FEED[section.key] || '/feeds/', links, 'section-feed');

  const head = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:44px 28px 0">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
    + `<td align="left" style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:18px">${heading}</td>`
    + `<td align="right" style="font-family:'Courier New',monospace;font-size:10.5px;font-weight:700;letter-spacing:.09em;color:${p.accent};mso-line-height-rule:exactly;line-height:18px">${escapeHtml(`${n} NEW`)}</td>`
    + `</tr></table></td></tr>`
    + `<tr><td width="536" style="width:536px;padding:9px 28px 0"><div style="height:2px;background-color:${p.rule};font-size:0;line-height:0">&nbsp;</div></td></tr></table>`;

  const items = section.items.map((it) => itemHtml(section.key, it, p, links)).join('');
  const seeAll = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:14px 28px 0">`
    + `<a href="${escapeHtml(feed)}" style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};text-decoration:underline">See all in the ${name} feed</a>`
    + `</td></tr></table>`;
  // An invisible sentinel marking an editorial section start. The CAN-SPAM primary-purpose guards read it to
  // assert editorial content precedes the membership CTA and nothing editorial follows the CTA. Comments are
  // inert in every mail client; this is a test locator, not visible copy.
  return `<div><!--editorial:${escapeHtml(section.key)}-->${head}${items}${seeAll}</div>`;
}

function emptyLineHtml(empties, p, firstIssue, links) {
  if (!empties.length) return '';
  const phrase = escapeHtml(emptyPhrase(empties, firstIssue));
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:34px 28px 0">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};mso-line-height-rule:exactly;line-height:18px">`
    + `${phrase} <a href="${escapeHtml(trackUrl('/feeds/', links, 'archive'))}" style="color:${p.footerLink};text-decoration:underline">Browse the archive</a></div>`
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
// paid member, and per-recipient targeting would break the single frozen issue. OWNER 2026-08-21: the CTA is
// ON by default (renders when there is editorial content and the compile has not set ctx.membershipCta ===
// false), so a compile suppresses a given issue by passing false rather than opting each one in. The COPY is
// the owner's, from the design mockup, corrected on one clause: it names comments and the members Discord
// (paid-gated) and publishing under the Content Creator plan (sow-185), and it deliberately does NOT claim
// "saved collections", which SOW-077 gives a FREE signed-in member (the /membership/activity route authorizes
// with authorizeMemberCheap, not authorizePaid). That accuracy is pinned by a guard, because the mockup keeps
// the false collections claim in two places and a future re-derivation would reintroduce it.
function membershipCtaHtml(p, links) {
  const href = escapeHtml(trackUrl('/membership/', links, 'membership-cta'));
  return `<!--membership-cta-->`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:30px 28px 0">`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:18px">`
    + `Membership adds comments on any item and the members Discord. Publishing your own prompts, skills and products is part of the Content Creator plan. `
    + `<a href="${href}" style="color:${p.footerLink};text-decoration:underline">Compare plans</a>`
    + `</div>`
    + `</td></tr></table>`
    + `<!--/membership-cta-->`;
}

// The masthead: the week on the right, the logo to the right of it, and nothing on the left.
//
// OWNER RULING, 2026-08-24: the "GBTI Digest" wordmark is gone from the top left and the logo takes the
// corner. The identity is carried by the mark and by the greeting directly beneath it, so the wordmark was
// saying the same thing a third time.
//
// THE MARK IS THEMED, because it is a solid silhouette with no contrast of its own: the ink mark disappears
// on the dark card and the white mark disappears on the light one. It is picked from the same `theme` that
// picks the palette, so the two cannot disagree.
//
// IMAGES ARE OFF BY DEFAULT IN MANY INBOXES, which is why the mark is an addition to the week rather than a
// replacement for the wordmark's job. With images blocked the reader still sees the week, the alt text and
// the greeting; nothing that identifies the sender depends on a fetch succeeding.
const LOGO_PX = 30;
function logoCellHtml(logoUrl, links) {
  if (!logoUrl) return '';
  const img = `<img src="${escapeHtml(logoUrl)}" width="${LOGO_PX}" height="${LOGO_PX}" alt="GBTI Network"`
    + ` style="display:block;border:0;outline:none;text-decoration:none;width:${LOGO_PX}px;height:${LOGO_PX}px">`;
  return `<td width="${LOGO_PX}" style="width:${LOGO_PX}px;padding-left:12px;line-height:0">`
    + `<a href="${escapeHtml(trackUrl('/', links, 'masthead'))}" style="text-decoration:none">${img}</a>`
    + `</td>`;
}

function headerHtml(p, ctx, range, launchNote, logoUrl, links) {
  const greeting = escapeHtml(str(ctx.greeting).trim() || 'This week on the network');
  const headerLine = escapeHtml(str(ctx.headerLine).trim() || 'Everything new across the network since the last issue.');
  const weekCell = range
    ? `<td align="right" style="font-family:'Courier New',monospace;font-size:10.5px;letter-spacing:.1em;color:${p.meta};mso-line-height-rule:exactly;line-height:${LOGO_PX}px">${escapeHtml(range.mono)}</td>`
    : '';
  const logoCell = logoCellHtml(logoUrl, links);
  // A right-aligned nested table rather than one cell with an inline image: Outlook does not honour
  // vertical-align on an inline img, and the week has to sit on the mark's centre line.
  const mastheadRow = weekCell || logoCell
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px"><tr>`
      + `<td align="right"><table role="presentation" cellpadding="0" cellspacing="0" border="0" align="right"><tr>`
      + weekCell
      + logoCell
      + `</tr></table></td>`
      + `</tr></table>`
    : '';
  const launchHtml = launchNote
    ? `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;font-style:italic;color:${p.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px">${escapeHtml(str(launchNote))}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:22px 28px 18px;border-bottom:1px solid ${p.hairline}">`
    + mastheadRow
    + `<div style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:14.5px;font-weight:700;color:${p.ink};mso-line-height-rule:exactly;line-height:20px;padding-top:12px">${greeting}</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${p.inkSoft};mso-line-height-rule:exactly;line-height:19px;padding-top:5px">${headerLine}</div>`
    + launchHtml
    + `</td></tr></table>`;
}

function footerHtml(p, ctx, links) {
  // The unsubscribe url is NOT tracked: it is an opt-out on the Worker, not a campaign click on the website.
  const unsub = safeUrl(ctx.unsubscribeUrl);
  const feedAbs = trackUrl('/feeds/', links, 'footer-feed');
  // A real url renders a one-click Unsubscribe link; without one a managed-subscription line with NO link. That
  // fallback is NOT permission to send without an opt-out (the drain must refuse such a recipient); in a real
  // send this branch is unreachable, and it exists for the web archive and as a no-dead-link fail-safe.
  const unsubLink = unsub
    ? `<a href="${escapeHtml(unsub)}" style="color:${p.footerLink};text-decoration:underline">Unsubscribe</a>`
    : `manage your subscription from <a href="${escapeHtml(trackUrl('/', links, 'footer-home'))}" style="color:${p.footerLink};text-decoration:underline">gbti.network</a>`;
  const footerLinks = `<a href="${escapeHtml(feedAbs)}" style="color:${p.footerLink};text-decoration:underline">Open the feed</a> &middot; ${unsubLink}`;
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
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${p.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px">${footerLinks}</div>`
    + postalLine
    + `</td></tr></table>`;
}

function sectionText(section, links) {
  const n = Array.isArray(section.items) ? section.items.length : 0;
  return `LATEST ${str(section.label).toUpperCase()} (${n})\n${section.items.map((it) => itemText(section.key, it, links)).join('\n')}`;
}

// The text alternative carries the same FACTS as the html, minus what only exists visually. The blurb is a
// fact and belongs here; the thumbnail is not and does not. Keeping the two in step matters because a client
// showing the text part must not present a thinner issue than the one that was actually composed.
function itemText(sectionKey, it, links) {
  const title = str(it.title).trim() || '(untitled)';
  const url = trackUrl(it.url, links, 'item');
  const meta = sectionKey === 'news' ? sourceLabel(it) : byline(it);
  const suffix = meta ? ` (${meta})` : '';
  const blurb = str(it.blurb).trim();
  const blurbLine = blurb ? `\n  ${blurb}` : '';
  return url ? `- ${title}${suffix}${blurbLine}\n  ${url}` : `- ${title}${suffix}${blurbLine}`;
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
  const range = coverageWeek(issue?.generatedAt);
  const siteUrl = safeUrl(ctx.siteUrl) || 'https://gbti.network';
  // The themed mark, absolute because an email has no page to be relative to. 96px source for a 30px
  // slot, so it stays sharp on a retina client without shipping the 512px brand asset to every inbox.
  const logoUrl = `${siteUrl}/brand/logo/mark-${ctx.theme === 'dark' ? 'white' : 'ink'}-96.png`;
  // The campaign is the ISSUE ID (weekly-YYYY-MM-DD, welcome-YYYY-MM-DD, test-...), so one issue reads as one
  // row and the welcome is separable from the weekly without a second scheme. Absent on a bare fixture, and an
  // absent campaign simply omits that one param rather than inventing a name.
  // sow-273 follow-up: `clickBase` is the origin of the /c/ click counter, injected by the Worker's composition
  // root. When it is absent the template renders exactly as it did before, with plain utm-tagged links, so the
  // counter is an addition to this renderer rather than a dependency of it and a bare fixture stays bare.
  const links = { siteUrl, campaign: str(issue?.issueId).trim(), clickBase: safeUrl(ctx.clickBase) };
  const subject = str(ctx.subject).trim() || computedSubject(counts, range) || 'The GBTI Network weekly digest';

  const preheaderText = escapeHtml(counts ? countsSummary(counts, firstIssue) : emptySummary(firstIssue));
  const preheader = `<span style="display:none;font-size:1px;color:${p.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheaderText}</span>`;

  // The membership CTA renders BY DEFAULT and is SUPPRESSIBLE per issue: it shows when the issue has editorial
  // content AND the caller has not set ctx.membershipCta === false. OWNER 2026-08-21: the fact of the CTA and
  // its end placement are approved and it is on by default; a caller passes membershipCta:false to suppress a
  // given issue. An all-editorial-empty issue never carries it either (a solicitation with no editorial reads
  // as primarily promotional). See the CTA note.
  const showCta = filled.length > 0 && ctx.membershipCta !== false;
  const body = filled.map((s) => sectionHtml(s, p, links)).join('')
    + emptyLineHtml(empties, p, firstIssue, links)
    + (showCta ? membershipCtaHtml(p, links) : '');

  // The open pixel. Same origin as the click counter (clickBase = PUBLIC_BASE_URL), issue-scoped so one issue is
  // one open row, matching the click campaign. Gated on both being present so a bare fixture (and the web archive,
  // which has no clickBase) renders no pixel: the counter is an ADDITION to this renderer, never a dependency. It
  // is a 1x1 that loads (not display:none) because a hidden image is not fetched, and the fetch is the signal. It
  // never touches the text alternative. See workers/signup/mail-open-route.mjs.
  const openPixel = (links.clickBase && links.campaign)
    ? `<img src="${escapeHtml(`${links.clickBase}/o/${encodeURIComponent(links.campaign)}`)}" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;overflow:hidden;line-height:1px" />`
    : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${p.pageBg}">`
    + preheader
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width:600px;background-color:${p.pageBg}">`
    + `<tr><td width="600" align="center" style="width:600px;padding:24px 0 40px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px;background-color:${p.cardBg};border:1px solid ${p.cardBorder}">`
    + `<tr><td width="536" style="width:536px;padding:0">`
    + headerHtml(p, ctx, range, issue?.launchNote, logoUrl, links)
    + body
    + footerHtml(p, ctx, links)
    + `</td></tr></table>`
    + `</td></tr></table>`
    + openPixel
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
  const filledText = filled.map((s) => sectionText(s, links)).join('\n\n');
  const emptyText = empties.length ? `\n\n${emptyPhrase(empties, firstIssue)}` : '';
  // The text-side CTA mirrors the html: one modest line, after all editorial, only when the html renders it.
  const ctaText = showCta
    ? `\n\nMembership adds comments on any item and the members Discord. Publishing your own prompts, skills and products is part of the Content Creator plan. Compare plans: ${trackUrl('/membership/', links, 'membership-cta')}`
    : '';

  const text = `GBTI DIGEST${range ? ` (${range.short})` : ''}\n`
    + `${greetingText}\n${headerLineText}\n${launchText}\n`
    + `${filledText}${emptyText}${ctaText}\n\n`
    + `----\n${trackUrl('/', links, 'footer-home')}\n${unsubText}${postalText}\n`;

  return { subject, html, text };
}
