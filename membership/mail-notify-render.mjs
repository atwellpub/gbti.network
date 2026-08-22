// SOW-186 phase 4 (DELIVERY): the follow-the-author notification email template, the notification-kind branch of
// the injected `renderIssue` seam (workers/signup/index.mjs dispatches on issue.kind, so the digest renderer is
// never touched). A notification issue announces ONE just-published item to a member who follows its author and
// has turned the email channel on (resolveNotify, fail-closed OFF). It is a single-item message, not a weekly
// roundup, so it ships its OWN lean shell rather than reusing the digest layout.
//
// PURE and node-free, exactly like membership/mail-render.mjs: it reads only the frozen notification issue and the
// per-recipient ctx, calls no Date.now (it formats the FROZEN generatedAt in UTC), and returns
// { subject, html, text }.
//
// WHY THIS DUPLICATES THE SHELL INSTEAD OF SHARING THE DIGEST'S (SowMaster's binding condition, 2026-08-22): the
// notification path must not weaken any guard the digest path shares, and it must not HOIST shared logic into a
// helper both call. The digest's shell (headerHtml/sectionHtml/footerHtml in mail-render.mjs) is a WEEKLY-ROUNDUP
// layout; refactoring it to serve both kinds would be exactly that forbidden hoist. So this module carries a
// minimal single-item shell of its own, and the two renderers stay independent. The ONE thing it imports is the
// generic escaping (escapeHtml/safeUrl), because those ARE the XSS/href-safety guard: re-implementing them here
// would risk a DIVERGENT, weaker escaper, which is the opposite of preserving a shared guard. They were already
// exported and used across the mail code, so importing them is not a new hoist.
//
// LEAK SAFETY (SOW-186 B3, and the SOW-166 model). A notification carries ONLY public metadata: author, a display
// name, the content type, the title, and a PUBLIC url. The url is resolved upstream (scripts/enqueue-notifications
// .mjs) through publicUrlFor, which returns null for a members-only / Mode A item and for a share, so a
// notification is never even ENQUEUED for gated content. This renderer is the second line of that defence: it
// reads a FIXED allow-list of fields and NEVER a body, blurb, or ciphertext. There is no body field on a
// notification issue, and a test pins that a body/encryptedBody smuggled onto the issue object never reaches the
// output. So even a hand-built issue cannot leak gated text into an inbox.
//
// UNSUBSCRIBE. ctx.unsubscribeUrl is per-recipient and arrives from the drain at send time (the drain mints the
// token and REFUSES a recipient with no unsubscribeUrl, so an email with no working opt-out never goes out). With
// a real url the footer carries a one-click Unsubscribe link; without one it renders a managed-subscription line
// with NO link, for the same reasons the digest does (a fail-safe that shows no dead link, never a supported send
// mode). One unsubscribe stops ALL mail (the suppression hash is shared across digest and notifications).
//
// POSTAL. ctx.postalAddress renders ONLY when the drain supplies it (the CAN-SPAM 7704(a)(5) slot); absent means
// no address line. Never defaulted or hardcoded here, exactly as in mail-render.mjs, so a real street address can
// never reach a committed file.

import { escapeHtml, safeUrl } from './mail-render.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// The light palette, the shipping variant (dark is unreliable in email; prefers-color-scheme is not honoured). A
// palette is data, not shared logic, so inlining a small copy here keeps this module self-contained rather than
// coupling it to the digest renderer's PALETTES structure.
const P = {
  pageBg: '#efece7', cardBg: '#ffffff', cardBorder: '#e0dbd3', hairline: '#eae6df',
  ink: '#232029', inkSoft: '#4a4653', meta: '#7c7784', accent: '#187a4b', footerLink: '#4a4653', postalMeta: '#9b96a1',
};

// The human label for a content type. The notification issue carries the syndication type ('post'|'product'|
// 'prompt'); 'article' is the reader-facing word for a post, matching the site and the digest.
const TYPE_LABEL = { post: 'article', article: 'article', product: 'product', prompt: 'prompt' };

/** An ABSOLUTE, safe url for an email: safeUrl fails an unsafe value closed to ''; a surviving site-relative path
 *  is prefixed with siteUrl (a bare "/articles/x/" is a dead link in a mail client); an external http(s) url
 *  passes through. Mirrors mail-render.mjs absUrl (a few lines, not worth a shared import that would couple the
 *  modules; identical behaviour is the point). */
function absUrl(url, siteUrl) {
  const u = safeUrl(url);
  if (!u) return '';
  return u.startsWith('/') ? `${siteUrl}${u}` : u;
}

/** The author's display name for the byline, preferring the stored displayName, then the handle. */
function authorLabel(issue) {
  return str(issue.authorName).trim() || str(issue.author).trim() || 'a network member';
}

function footerHtml(ctx, siteUrl, who) {
  const unsub = safeUrl(ctx.unsubscribeUrl);
  const settings = `${siteUrl}/account/`;
  // A real url renders a one-click Unsubscribe link; without one a managed-subscription line with NO link (the
  // drain refuses a recipient with no unsubscribeUrl, so in a real send this fallback branch is unreachable).
  const unsubLink = unsub
    ? `<a href="${escapeHtml(unsub)}" style="color:${P.footerLink};text-decoration:underline">Unsubscribe from these emails</a>`
    : `manage your subscription from <a href="${escapeHtml(siteUrl)}" style="color:${P.footerLink};text-decoration:underline">gbti.network</a>`;
  const links = `<a href="${escapeHtml(settings)}" style="color:${P.footerLink};text-decoration:underline">Notification settings</a> &middot; ${unsubLink}`;
  const postal = str(ctx.postalAddress).trim();
  const postalLine = postal
    ? `<div style="font-family:'Courier New',monospace;font-size:10px;color:${P.postalMeta};mso-line-height-rule:exactly;line-height:16px;padding-top:12px">${escapeHtml(postal)}</div>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:26px 28px 24px">`
    + `<div style="height:1px;background-color:${P.hairline};font-size:0;line-height:0">&nbsp;</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${P.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:14px">You get this because you follow ${escapeHtml(who)} on the GBTI Network.</div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:11.5px;color:${P.meta};mso-line-height-rule:exactly;line-height:18px;padding-top:9px">${links}</div>`
    + postalLine
    + `</td></tr></table>`;
}

/**
 * Render a follow-the-author notification issue into { subject, html, text }.
 *
 * @param issue  { issueId, kind:'notification', author, authorName?, type, title, url, generatedAt } (metadata only)
 * @param ctx    { unsubscribeUrl?, siteUrl?, postalAddress?, from?, subscriber?, recipientHash? }, per recipient
 */
export function renderNotificationEmail(issue = {}, ctx = {}) {
  const siteUrl = safeUrl(ctx.siteUrl) || 'https://gbti.network';
  const who = authorLabel(issue);
  const label = TYPE_LABEL[str(issue.type)] || 'update';
  const title = str(issue.title).trim() || '(untitled)';
  const url = absUrl(issue.url, siteUrl);

  const subject = `${who} published a new ${label}: ${title}`;
  const preheaderText = escapeHtml(`New ${label} from ${who} on the GBTI Network.`);
  const preheader = `<span style="display:none;font-size:1px;color:${P.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden">${preheaderText}</span>`;

  const heading = escapeHtml(`New ${label} from ${who}`);
  const titleStyle = `font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${P.ink};text-decoration:none;mso-line-height-rule:exactly;line-height:22px`;
  const titleHtml = url
    ? `<a href="${escapeHtml(url)}" style="${titleStyle}">${escapeHtml(title)}</a>`
    : `<span style="${titleStyle}">${escapeHtml(title)}</span>`;
  const readCta = url
    ? `<div style="padding-top:16px"><a href="${escapeHtml(url)}" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:${P.accent};text-decoration:underline">Read it on gbti.network</a></div>`
    : '';

  const header = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:24px 28px 0">`
    + `<div style="font-family:'Trebuchet MS',Verdana,sans-serif;font-size:18px;font-weight:700;color:${P.ink};mso-line-height-rule:exactly;line-height:22px">GBTI <span style="color:${P.accent}">Network</span></div>`
    + `<div style="font-family:Arial,Helvetica,sans-serif;font-size:12.5px;color:${P.inkSoft};mso-line-height-rule:exactly;line-height:19px;padding-top:10px">${heading}</div>`
    + `</td></tr></table>`;

  const card = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:16px 28px 4px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="480" style="width:480px;background-color:${P.cardBg};border:1px solid ${P.cardBorder};border-radius:8px">`
    + `<tr><td style="padding:20px 22px">`
    + titleHtml
    + `<div style="padding-top:8px;font-family:'Courier New',monospace;font-size:10.5px;letter-spacing:.05em;color:${P.meta}">by ${escapeHtml(who)}</div>`
    + readCta
    + `</td></tr></table>`
    + `</td></tr></table>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${P.pageBg}">`
    + preheader
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" align="center" style="width:600px;background-color:${P.pageBg}">`
    + `<tr><td width="600" align="center" style="width:600px;padding:24px 0 40px">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="536" style="width:536px">`
    + `<tr><td width="536" style="width:536px;padding:0">`
    + header
    + card
    + footerHtml(ctx, siteUrl, who)
    + `</td></tr></table>`
    + `</td></tr></table>`
    + `</body></html>`;

  const unsub = safeUrl(ctx.unsubscribeUrl);
  const unsubText = unsub
    ? `Unsubscribe: ${unsub}`
    : 'Manage your subscription from the GBTI Network site.';
  const postal = str(ctx.postalAddress).trim();
  const postalText = postal ? `\n${postal}` : '';
  const linkText = url ? `\n${url}` : '';

  const text = `NEW ${label.toUpperCase()} FROM ${who.toUpperCase()}\n`
    + `${title}${linkText}\n\n`
    + `You get this because you follow ${who} on the GBTI Network.\n`
    + `----\n${siteUrl}\n${unsubText}${postalText}\n`;

  return { subject, html, text };
}
