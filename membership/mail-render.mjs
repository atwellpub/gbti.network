// SOW-166: renderIssue v1, the PLAIN SEMANTIC digest template behind the injected `renderIssue` seam. The
// visual design is owner-gated (a claude_design template swaps in here later), so this v1 exists to prove the
// pipe end to end, not to pin an appearance. It is deliberately unremarkable: table-free semantic HTML with a
// few inline styles, plus a plain-text alternative, both generated from the frozen issue's render-ready
// `layout` (membership/mail-digest.mjs buildLayout), so the ORDER and the EMPTY-SECTION NOTES are decided once
// in the composition core and never re-derived here.
//
// PURE and node-free (no crypto, no Date.now, no IO), so it is unit-tested with plain objects. The Worker's
// drain injects it as `renderIssue(issue, ctx)` and returns { subject, html, text }.
//
// WHAT THIS RENDERER DOES NOT DO, on purpose:
//   - It mints NO unsubscribe token. The token is a keyed HMAC and this module has no secret; the drain is to
//     mint it per recipient at send time and pass the finished `unsubscribeUrl` in ctx. A missing url renders a
//     managed-subscription fallback line here, but that fallback is NOT the control and this comment must not
//     read as though the case is handled: an email with no working opt-out (or no postal address) must NEVER be
//     sent, and enforcing that is OWED to the drain's send-capability commit, which must REFUSE such a recipient
//     (leave the record pending, burn no attempt), the same shape as its unreadable-suppression defer. As of
//     this commit the drain passes only { recipientHash, subscriber, from } and does NOT yet build
//     unsubscribeUrl or postalAddress; wiring that ctx AND the refusal is a hard prerequisite of enabling any
//     send. Until then the send gate (fail-closed) is the compensating control keeping this latent.
//   - It carries NO member body or ciphertext. The layout items are already the public-safe projection
//     (kind/title/url/author/date only), so there is no field here that could leak gated content.
//   - It sets NO email headers. List-Unsubscribe / List-Unsubscribe-Post and the multipart assembly are the
//     sendEmail wrapper's job; this returns the three body parts only.

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

/** A URL safe to place in an href: only http(s) and site-relative urls survive; anything else (javascript:,
 *  data:, a malformed value) becomes '' so it renders as plain text, never a live link. Fail-closed. */
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

// A single item as an HTML list entry. News items show their source; member items show a byline. A linkable
// title becomes an anchor; an item with no safe url renders its title as text (fail-closed, never a dead link).
function itemHtml(sectionKey, it) {
  const title = escapeHtml(str(it.title).trim() || '(untitled)');
  const url = safeUrl(it.url);
  const titleHtml = url ? `<a href="${escapeHtml(url)}" style="color:#1f9e5f;text-decoration:none">${title}</a>` : title;
  const meta = sectionKey === 'news' ? escapeHtml(str(it.source).trim()) : escapeHtml(byline(it));
  const metaHtml = meta ? `<span style="color:#6c6976"> &middot; ${meta}</span>` : '';
  return `<li style="margin:0 0 .5rem">${titleHtml}${metaHtml}</li>`;
}

function itemText(sectionKey, it) {
  const title = str(it.title).trim() || '(untitled)';
  const url = safeUrl(it.url);
  const meta = sectionKey === 'news' ? str(it.source).trim() : byline(it);
  const suffix = meta ? ` (${meta})` : '';
  return url ? `- ${title}${suffix}\n  ${url}` : `- ${title}${suffix}`;
}

// One section (filled or empty) as HTML. An empty section renders its note instead of a list, so a visible
// gap invites contribution rather than disappearing.
function sectionHtml(section) {
  const label = escapeHtml(section.label);
  const heading = `<h2 style="font-size:1.05rem;margin:1.5rem 0 .5rem;color:#25232b">${label}</h2>`;
  if (section.empty) {
    return `${heading}<p style="margin:.25rem 0;color:#6c6976">${escapeHtml(str(section.note))}</p>`;
  }
  const items = section.items.map((it) => itemHtml(section.key, it)).join('');
  return `${heading}<ul style="margin:.25rem 0 0;padding-left:1.1rem;list-style:disc">${items}</ul>`;
}

function sectionText(section) {
  const heading = `${section.label.toUpperCase()}`;
  if (section.empty) return `${heading}\n${str(section.note)}`;
  return `${heading}\n${section.items.map((it) => itemText(section.key, it)).join('\n')}`;
}

/**
 * Render the frozen issue into { subject, html, text }. Reads only the render-ready `layout`, so ordering and
 * empty-section notes come from the composition core, never re-decided here.
 *
 * @param issue  the frozen composeIssue output ({ issueId, layout, ... })
 * @param ctx    { unsubscribeUrl?, siteUrl?, subject?, postalAddress? } supplied by the drain per recipient
 */
export function renderIssue(issue, ctx = {}) {
  const layout = Array.isArray(issue?.layout) ? issue.layout : [];
  const siteUrl = safeUrl(ctx.siteUrl) || 'https://gbti.network';
  const subject = str(ctx.subject).trim() || 'The GBTI Network weekly digest';
  const unsubscribeUrl = safeUrl(ctx.unsubscribeUrl);
  const postal = str(ctx.postalAddress).trim();

  const sectionsHtml = layout.map(sectionHtml).join('');
  const sectionsText = layout.map(sectionText).join('\n\n');

  // The footer's unsubscribe line. A real url renders a one-click link; without one we fall back to a managed
  // line rather than a broken link. This fallback keeps a MISUSE from crashing; it is NOT permission to send
  // without a working opt-out. The drain must refuse that send (see the header note), so in production this
  // branch is unreachable, not a supported degraded mode.
  const unsubHtml = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="color:#6c6976">Unsubscribe</a> from the weekly digest.`
    : 'You can manage your subscription from the GBTI Network site.';
  const unsubText = unsubscribeUrl
    ? `Unsubscribe from the weekly digest: ${unsubscribeUrl}`
    : 'Manage your subscription from the GBTI Network site.';
  const postalHtml = postal ? `<p style="margin:.5rem 0 0">${escapeHtml(postal)}</p>` : '';
  const postalText = postal ? `\n${postal}` : '';

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<title>${escapeHtml(subject)}</title></head>`
    + `<body style="margin:0;padding:0;background:#f4f4f5">`
    + `<div style="max-width:37.5rem;margin:0 auto;padding:1.5rem 1.25rem;`
    + `font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
    + `line-height:1.5;color:#25232b;background:#ffffff">`
    + `<h1 style="font-size:1.3rem;margin:0 0 .25rem;color:#25232b">GBTI Network</h1>`
    + `<p style="margin:0 0 1rem;color:#6c6976">The weekly digest: what is new across the network since the last issue.</p>`
    + sectionsHtml
    + `<hr style="border:0;border-top:1px solid #e5e5e7;margin:1.75rem 0 1rem">`
    + `<p style="margin:0;color:#6c6976;font-size:.85rem">`
    + `<a href="${escapeHtml(siteUrl)}" style="color:#1f9e5f">gbti.network</a> &middot; ${unsubHtml}</p>`
    + postalHtml
    + `</div></body></html>`;

  const text = `GBTI NETWORK - THE WEEKLY DIGEST\n`
    + `What is new across the network since the last issue.\n\n`
    + `${sectionsText}\n\n`
    + `----\n${siteUrl}\n${unsubText}${postalText}\n`;

  return { subject, html, text };
}
