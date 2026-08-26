/**
 * The prompt detail page's shell, shared by the published page and the workbench preview.
 *
 * Why this exists, and why it looks like article-page.mjs
 * ------------------------------------------------------
 * sow-214 found that the preview rendered every content type through the product Doc Shell, fixed it for
 * articles, and left the rest behind. A prompt preview was therefore a different page from the prompt: it
 * carried a product hero, a sticky spec bar, a Contents rail and a pricing badge, none of which a prompt
 * page has, and it had no prompt block, which is the one thing a prompt page is mostly made of.
 *
 * The fix follows the same shape as the article one, for the same reason. The preview's rail wiring, body
 * injection, contents scroll-spy, as-a-member toggle and the sow-235 edit path are all bound to elements
 * that already exist on that page, so emitting a second document would break working behaviour in order to
 * share markup that is not where the drift hurt. What made the two look like different pages is the
 * GEOMETRY (`.pd-*` versus `.detail-*`) and the CHROME around the body. Both come from here.
 *
 * The class names are a CONTRACT. test/prompt-page.test.mjs reads src/pages/prompts/[slug].astro from disk
 * and fails if any value below stops appearing on it, because a contract nobody checks is a copy that drifts
 * silently, and the preview is exactly where nobody notices for months.
 */

import { isImageGenTarget } from '../../client/src/image-models.mjs';

/** Minimal HTML escape for text interpolated into the shell (titles and captions are author-supplied). */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Every class the two hosts share, named for what it is rather than where it sits, so a reader of the
 * preview branch can find its counterpart on the page without diffing two files.
 *
 * `raw` is two classes because the published <pre> carries both; the drift test matches the attribute
 * verbatim, so it is stored the way the page writes it.
 */
export const PROMPT_SHELL = Object.freeze({
  section: 'band tint',
  wrap: 'wrap',
  head: 'detail-head',
  headTop: 'detail-head-top',
  crumbs: 'eyebrow detail-crumbs',
  title: 'h1 mt12',
  meta: 'mt16 flex items-center g12 wrap-w',
  lead: 'lead mt20',
  grid: 'detail-grid mt32',
  main: 'detail-main',
  aside: 'detail-aside flex col g20',
  result: 'prompt-result',
  block: 'prompt-block',
  blockBar: 'prompt-block-bar',
  blockLabel: 'prompt-block-label',
  blockActions: 'prompt-actions',
  modes: 'prompt-modes',
  body: 'prompt-body',
  view: 'prompt-view',
  raw: 'prompt-view prompt-raw',
});

/**
 * The full-width header above the grid: breadcrumb, title, a byline row and the lead paragraph.
 *
 * `metaHtml` is injected rather than built because the two hosts genuinely differ there. The page renders a
 * real byline through ContentMeta and a Paid chip; a staged draft has no publication date and no price yet,
 * so the preview passes its own inert notice instead of inventing either.
 *
 * @param {object} args
 * @param {string} args.title
 * @param {Array<{label: string, href?: string}>} [args.crumbs] breadcrumb entries, root first
 * @param {string} [args.metaHtml] the byline row's contents, or '' to omit the row
 * @param {string} [args.lead] the short description shown under the byline
 * @returns {string}
 */
export function buildPromptHeadHtml({ title, crumbs = [], metaHtml = '', lead = '' } = {}) {
  const s = PROMPT_SHELL;
  const links = (crumbs || []).filter(Boolean).map((c, i) => {
    const sep = i === 0 ? '' : '<span aria-hidden="true" style="opacity:.5"> › </span>';
    const style = i === 0 ? ' style="color:var(--green-700)"' : ' style="color:inherit"';
    const inner = c.href ? `<a href="${esc(c.href)}"${style}>${esc(c.label)}</a>` : `<span${style}>${esc(c.label)}</span>`;
    return sep + inner;
  }).join('');
  return `<header class="${s.head}">`
    + `<div class="${s.headTop}">`
    + `<nav class="${s.crumbs}" aria-label="Breadcrumb">${links}</nav>`
    + `</div>`
    + `<h1 data-gbti-region="title" class="${s.title}">${esc(title)}</h1>`
    + (metaHtml ? `<div class="${s.meta}">${metaHtml}</div>` : '')
    + (lead ? `<p class="${s.lead}" style="max-width:70ch">${esc(lead)}</p>` : '')
    + `</header>`;
}

/**
 * The optional lead image above the prompt block.
 *
 * `imgHtml` is injected for the reason the article cover is: the page emits Astro's build-time <Image> and
 * the preview a plain <img> at a CDN URL, and neither host can produce the other's element.
 *
 * The caption is optional because the image is no longer reserved for image generators. On an image-gen
 * prompt it reads "Example result"; on a Claude Code prompt there is no result to caption, and captioning
 * it anyway would describe something the reader is not looking at.
 */
export function buildPromptResultHtml({ imgHtml = '', caption = '' } = {}) {
  if (!imgHtml) return '';
  return `<figure class="${PROMPT_SHELL.result}">${imgHtml}`
    + (caption ? `<figcaption>${esc(caption)}</figcaption>` : '')
    + `</figure>`;
}

/**
 * The chrome around the prompt itself: the labelled bar, and the body wrapper the caller fills.
 *
 * Returned EMPTY (the body region has no content) because the preview does not re-render the body it has
 * already injected and wired for editing; it moves that element inside. A caller that does have HTML can
 * pass it as `bodyHtml`.
 *
 * The published bar also carries Visual/Markdown mode buttons and a Copy button. Both act on a real
 * published prompt, so the preview asks for `interactive: false` and gets the bar without them rather than
 * showing controls that would do nothing.
 */
export function buildPromptBlockHtml({ bodyHtml = '', interactive = true } = {}) {
  const s = PROMPT_SHELL;
  const modes = interactive
    ? `<div class="${s.modes}" role="group" aria-label="Prompt format">`
      + `<button type="button" class="on" data-mode-btn="visual">Visual</button>`
      + `<button type="button" data-mode-btn="markdown">Markdown</button>`
      + `</div><button type="button" data-copy class="btn btn-primary prompt-copy">Copy</button>`
    : '';
  return `<div class="${s.block}" data-mode="visual">`
    + `<div class="${s.blockBar}">`
    + `<span class="${s.blockLabel}"><svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><use href="#ico-terminal"/></svg>Prompt</span>`
    + `<div class="${s.blockActions}">${modes}</div>`
    + `</div>`
    + `<div class="${s.body}" data-gbti-region="body">${bodyHtml}</div>`
    + `</div>`;
}

/**
 * How to frame a prompt's lead image: its alt text, and whether it gets a caption.
 *
 * The image used to be reserved for image-gen targets and is now allowed on any prompt, so the frame has to
 * stop assuming a generator produced it. On an image-gen prompt it is still an example result and says so.
 * On a Claude Code or GPT prompt it is a plain lead illustration, and captioning that "Example result
 * generated with Claude Code" would describe something the reader is not looking at.
 *
 * Both hosts call this rather than repeating the two ternaries, since a caption that disagrees between the
 * preview and the page is the exact class of drift this module exists to stop.
 *
 * @param {{title?: string, targets?: string[]}} fm
 * @returns {{isResult: boolean, alt: string, caption: string}}
 */
export function promptImageFraming(fm = {}) {
  const targets = Array.isArray(fm.targets) ? fm.targets : [];
  const isResult = isImageGenTarget(targets);
  const first = targets.length ? String(targets[0]) : '';
  const title = String(fm.title || '');
  return {
    isResult,
    alt: isResult ? `${title}: example result${first ? ` generated with ${first}` : ''}` : title,
    caption: isResult ? `Example result${first ? ` \u00b7 ${first}` : ''}` : '',
  };
}
