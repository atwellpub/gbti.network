// THE SHARED OPERATIONAL-EMAIL LAYOUT. One place that turns a described email (a title, a lead, an ordered list
// of blocks) into send-ready html, so an ops notice stops being a `<pre>` block of console output pasted into a
// message body. The scripts that report to the owner (KV usage, credential expiry, reconcile summaries) each grew
// their own crude markup; every one of them was a different shape, and none of them survived a dark-mode client.
//
// PURE and node-free: no `node:` imports, no fs, no process, no Date. It runs inside the Cloudflare Worker and in
// a plain script alike, and its output depends only on its argument.
//
// WHY THE HTML LOOKS THE WAY IT DOES. It follows the idiom already established in membership/mail-render.mjs, and
// that idiom is not a style preference: Gmail strips a `<style>` block, Outlook renders through Word and ignores
// most modern layout, and several clients drop classes entirely. So every layout is a `role="presentation"` table
// with cellpadding/cellspacing/border at zero, and EVERY style is inline. Do not "clean this up" into a
// stylesheet or flexbox; the result renders correctly in a browser and falls apart in the inboxes that matter.
//
// EVERY INTERPOLATED VALUE GOES THROUGH escapeHtml, without exception: the title, the lead, a field label, a
// table cell, the footer. These notices carry a github login, a coupon code and raw command output, all of which
// are attacker-influenced, and an ops mailbox is exactly where a broken-out tag would be read by someone with
// privilege. The escaping is imported rather than re-implemented because a second, divergent escaper is how a
// weaker one gets shipped.
//
// COLOURS ARE EXPLICIT ON EVERY ELEMENT, background and text both. A client in dark mode inverts what it can and
// leaves what it cannot, so an element that states only its text colour ends up dark ink on a dark ground. Stating
// both means the worst case is a light card in a dark client, which is readable.
//
// RESTRAINT IS THE BRIEF. This is an operational notice, not a campaign: no logo, no hero, no button, no
// background image. The single brand touch is the GBTI green rule under the title.

import { escapeHtml } from './mail-render.mjs';

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

// The palette. Light, and only light: prefers-color-scheme is unreliable in email, so the digest renderer PICKS a
// variant rather than shipping both, and an ops notice has even less reason to offer the choice.
const P = {
  pageBg: '#f2f0ec',
  cardBg: '#ffffff',
  cardBorder: '#e0dbd3',
  hairline: '#e8e4dd',
  headBg: '#f7f6f3',
  ink: '#232029',
  inkSoft: '#4a4653',
  meta: '#6f6a78',
  accent: '#1f9e5f',
  alertBg: '#fdf6e6',
  alertBorder: '#d9a827',
  alertInk: '#5a4413',
  preBg: '#f6f5f2',
  preBorder: '#e4e0d9',
};

const SANS = 'Arial,Helvetica,sans-serif';
const MONO = "'Courier New',Consolas,monospace";

// The card is 640px at most and fluid below it: width:100% with a max-width, plus the width attribute Outlook
// reads instead of the style. On a narrow phone the percentage wins and the card fills the screen.
const MAX_W = 640;

// Long values must WRAP rather than widen the table. An unbroken token (a base64 blob, a long slug, a url out of
// raw command output) has no break opportunity, so overflow-wrap alone is not enough in every client; break-word
// is the belt to its braces.
const WRAP = 'word-break:break-word;overflow-wrap:break-word';

/** One horizontal block inside the card. Every block gets the same top padding, so the vertical rhythm does not
 *  depend on which kinds a caller happened to use or on what order they came in. */
function block(inner) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">'
    + `<tr><td style="padding:18px 0 0;font-size:0;line-height:0">${inner}</td></tr></table>`;
}

/** A label/value block. The label column is muted and right-aligned so the values line up on their left edge and
 *  read as a column; it is given a nominal width rather than a fixed one, because a long label must be allowed to
 *  take the room it needs instead of clipping. */
function fieldsHtml(section) {
  const rows = Array.isArray(section.rows) ? section.rows : [];
  if (!rows.length) return '';
  const body = rows.map((row) => {
    const pair = Array.isArray(row) ? row : [row, ''];
    const label = escapeHtml(str(pair[0]));
    const value = escapeHtml(str(pair[1]));
    return '<tr>'
      + `<td align="right" valign="top" width="34%" style="width:34%;padding:5px 12px 5px 0;font-family:${SANS};`
      + `font-size:13px;color:${P.meta};background-color:${P.cardBg};mso-line-height-rule:exactly;line-height:19px;${WRAP}">${label}</td>`
      + `<td align="left" valign="top" style="padding:5px 0;font-family:${SANS};font-size:13px;color:${P.ink};`
      + `background-color:${P.cardBg};mso-line-height-rule:exactly;line-height:19px;${WRAP}">${value}</td>`
      + '</tr>';
  }).join('');
  return block('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
    + `style="width:100%;background-color:${P.cardBg}">${body}</table>`);
}

/**
 * The alignment of one column. THE DEFAULT IS LABEL-THEN-NUMBERS: the first column left, every other column
 * right, because that is the shape these tables almost always have (an issue name and then counts). An explicit
 * `align` entry overrides it PER COLUMN, and an entry that is missing, short or not a recognised keyword falls
 * back to the default for that column rather than to left. A short array is therefore a partial override, not a
 * silent reset of the columns it does not mention.
 */
function alignFor(index, align) {
  const raw = Array.isArray(align) ? str(align[index]).trim().toLowerCase() : '';
  if (raw === 'left' || raw === 'right' || raw === 'center') return raw;
  return index === 0 ? 'left' : 'right';
}

/**
 * Whether a cell may be broken across lines. Numbers must NOT be, and that is not a nicety: a fixed-width table
 * measured at the card's own 640px gave each of eight columns 51px, which broke `350.0%` across two lines and
 * `Suppressed` one character per line. A percentage split into pieces is not a number any more, and a reader
 * comparing down a column cannot do it at all.
 *
 * So a SHORT value is held on one line, in ANY column. LENGTH is the safety condition and alignment is not: a
 * long token held on one line is what would push the table past the card, so the guard applies only where it
 * cannot, and anything longer keeps the wrapping behaviour and breaks inside its own cell.
 *
 * Alignment was the condition first, which exempted the left-hand label column, and measuring showed that was
 * backwards. In a five-column report the numeric columns hold their width, so the label column is the only one
 * that can give, and `2026-08-24` stacked one part per line into a 206px row. A date is not a long value and had
 * no business wrapping. A genuinely long label, a credential name, still exceeds the threshold and still wraps.
 */
function nowrapCell(value) {
  return value.length <= 12 ? 'white-space:nowrap;' : WRAP + ';';
}

/** A real html table with a header row. A real table and not a fields block, because these carry more than two
 *  columns and a reader compares DOWN a column; a list of pairs cannot be read that way. */
function tableHtml(section) {
  const columns = Array.isArray(section.columns) ? section.columns : [];
  const rows = Array.isArray(section.rows) ? section.rows : [];
  if (!columns.length && !rows.length) return '';
  const align = section.align;

  const head = columns.length
    ? '<tr>' + columns.map((c, i) => {
      const label = str(c);
      const a = alignFor(i, align);
      return `<td align="${a}" valign="bottom" style="padding:7px 10px;`
        + `background-color:${P.headBg};border-bottom:2px solid ${P.accent};font-family:${SANS};font-size:11px;`
        + `font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${P.meta};`
        + `mso-line-height-rule:exactly;line-height:15px;${nowrapCell(label)}">${escapeHtml(label)}</td>`;
    }).join('') + '</tr>'
    : '';

  const body = rows.map((row) => {
    const cells = Array.isArray(row) ? row : [row];
    return '<tr>' + cells.map((cell, i) => {
      const value = str(cell);
      const a = alignFor(i, align);
      return `<td align="${a}" valign="top" style="padding:7px 10px;`
        + `background-color:${P.cardBg};border-bottom:1px solid ${P.hairline};font-family:${SANS};font-size:13px;`
        + `color:${P.ink};mso-line-height-rule:exactly;line-height:19px;${nowrapCell(value)}">${escapeHtml(value)}</td>`;
    }).join('') + '</tr>';
  }).join('');

  // table-layout:AUTO, deliberately, and this was fixed until it was measured. A fixed layout splits the width by
  // rule rather than by content, so an eight-column report gave every numeric column 51px while the name column
  // sat on 228px it did not need. Auto sizes each column to what is actually in it, which for a report is exactly
  // right: the numbers are short and take little, and the name column absorbs the remainder.
  //
  // What fixed was protecting against, one long value dragging the table past the card, is handled per cell
  // instead: every cell still carries the wrap rule, and only SHORT values are held on one line (see nowrapCell).
  return block('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" '
    + `style="width:100%;table-layout:auto;border-collapse:collapse;background-color:${P.cardBg}">${head}${body}</table>`);
}

function paragraphHtml(section) {
  const text = str(section.text);
  if (!text.trim()) return '';
  return block(`<div style="font-family:${SANS};font-size:14px;color:${P.inkSoft};background-color:${P.cardBg};`
    + `mso-line-height-rule:exactly;line-height:21px;${WRAP}">${escapeHtml(text)}</div>`);
}

/** A caveat: smaller and muted, so it reads as an aside rather than as a finding. */
function noteHtml(section) {
  const text = str(section.text);
  if (!text.trim()) return '';
  return block(`<div style="font-family:${SANS};font-size:12px;color:${P.meta};background-color:${P.cardBg};`
    + `mso-line-height-rule:exactly;line-height:18px;${WRAP}">${escapeHtml(text)}</div>`);
}

/** Something that needs attention. Emphasis comes from a tinted band and a thick left edge, NOT from a shouting
 *  colour on the text: the band survives a client that drops backgrounds (the left border and the weight remain),
 *  and coloured text alone would be the thing that vanished. */
function alertHtml(section) {
  const text = str(section.text);
  if (!text.trim()) return '';
  return block('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">'
    + `<tr><td style="padding:12px 14px;background-color:${P.alertBg};border-left:4px solid ${P.alertBorder};`
    + `font-family:${SANS};font-size:13px;font-weight:700;color:${P.alertInk};mso-line-height-rule:exactly;`
    + `line-height:19px;${WRAP}">${escapeHtml(text)}</td></tr></table>`);
}

/** Raw output, whitespace preserved. pre-wrap rather than pre, because a mail client has no horizontal scroll to
 *  offer: a line longer than the card would simply be cut off, and a wrapped line is worse only in appearance. */
function preHtml(section) {
  const text = str(section.text);
  if (!text) return '';
  return block('<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">'
    + `<tr><td style="padding:12px 14px;background-color:${P.preBg};border:1px solid ${P.preBorder}">`
    + `<div style="font-family:${MONO};font-size:12px;color:${P.ink};white-space:pre-wrap;`
    + `mso-line-height-rule:exactly;line-height:18px;${WRAP}">${escapeHtml(text)}</div>`
    + '</td></tr></table>');
}

const KINDS = {
  fields: fieldsHtml,
  table: tableHtml,
  paragraph: paragraphHtml,
  note: noteHtml,
  alert: alertHtml,
  pre: preHtml,
};

/**
 * Render an operational notice.
 *
 * @param {object} spec
 * @param {string} spec.title     the heading at the top of the body.
 * @param {string} [spec.lead]    one or two sentences under the title.
 * @param {Array}  [spec.sections] the ordered blocks; see KINDS for the kinds understood.
 * @param {string} [spec.footer]  a small muted line at the very bottom.
 * @returns {{ html: string }}
 *
 * An unknown kind renders NOTHING rather than throwing. These emails are sent from unattended scripts and a
 * scheduled Worker, where a throw means the notice never arrives at all; a missing block still delivers the rest
 * of the report, and the caller's own tests are where a typo in a kind should be caught.
 */
export function opsEmail({ title, lead, sections, footer } = {}) {
  const heading = escapeHtml(str(title).trim());
  const leadText = str(lead).trim();
  const footerText = str(footer).trim();
  const list = Array.isArray(sections) ? sections : [];

  const body = list.map((s) => {
    const render = s && typeof s === 'object' ? KINDS[str(s.kind).trim()] : null;
    return render ? render(s) : '';
  }).join('');

  const leadHtml = leadText
    ? `<div style="padding-top:8px;font-family:${SANS};font-size:14px;color:${P.inkSoft};`
      + `background-color:${P.cardBg};mso-line-height-rule:exactly;line-height:21px;${WRAP}">${escapeHtml(leadText)}</div>`
    : '';

  // The title, its green rule, and the lead. The rule is a filled div rather than a border, because Outlook drops
  // a border on an empty element but paints a background on one that carries a non-breaking space.
  const header = `<div style="font-family:${SANS};font-size:19px;font-weight:700;color:${P.ink};`
    + `background-color:${P.cardBg};mso-line-height-rule:exactly;line-height:25px;${WRAP}">${heading}</div>`
    + `<div style="height:3px;width:44px;background-color:${P.accent};font-size:0;line-height:0;`
    + 'margin-top:10px">&nbsp;</div>'
    + leadHtml;

  const footerBlock = footerText
    ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%">'
      + `<tr><td style="padding:22px 0 0"><div style="height:1px;background-color:${P.hairline};font-size:0;`
      + 'line-height:0">&nbsp;</div>'
      + `<div style="padding-top:12px;font-family:${SANS};font-size:11.5px;color:${P.meta};`
      + `background-color:${P.cardBg};mso-line-height-rule:exactly;line-height:17px;${WRAP}">${escapeHtml(footerText)}</div>`
      + '</td></tr></table>'
    : '';

  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + `<title>${heading}</title></head>`
    + `<body style="margin:0;padding:0;background-color:${P.pageBg};color:${P.ink}">`
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${P.pageBg}">`
    + '<tr><td align="center" style="padding:24px 12px 36px">'
    + `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${MAX_W}" `
    + `style="width:100%;max-width:${MAX_W}px;background-color:${P.cardBg};border:1px solid ${P.cardBorder}">`
    + '<tr><td style="padding:26px 26px 28px">'
    + header
    + body
    + footerBlock
    + '</td></tr></table>'
    + '</td></tr></table>'
    + '</body></html>';

  return { html };
}
