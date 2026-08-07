// <gbti-content-editor> (SOW-006 v2): the per-type authoring form. Renders the field descriptors from
// client.formFields(type), a markdown body with a live preview (client.preview), image staging
// (client.stageImage), validation (client.validateContent), and publish (client.publish). The same component
// powers the standalone CMS (in <gbti-app>) and is reused by the inline editor. All typing/gathering uses the
// pure form.mjs helpers, so the only DOM concern here is reading raw values + rendering.

import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck, failHint } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement
import { editorStatus, mediaSummary } from '../editor-core.mjs'; // SOW-184: pure Status-card + Media-summary helpers (design 3a)
import { gatherInput } from '../form.mjs';
import { resolveContentAsset } from '../assets.mjs'; // SOW-062 P3 + sow-165: resolve a cover/body image path to a loadable preview URL
import './gbti-doc-editor.mjs'; // SOW-062 P5: the cohesive WYSIWYG body editor (same #body.value Markdown contract)
import './gbti-discussion.mjs'; // SOW-062 P6: the shared discussion thread, embedded in the editor for published items
import { EDITOR_SURFACE } from '../tokens.mjs'; // SOW-062 P6: the solid --s-* editor palette (decoupled from glass)
import { BANNER_PRESETS } from '../../../src/lib/banner-presets.mjs'; // sow-174: the curated banner-color swatches
import { detectLinkSource } from '../../../src/lib/product-page.mjs'; // sow-175: wordpress.org/github.com URL detection

// SOW-062 P6: inline icons for the edhead toolbar + section headers (the design's sprite is not in the shadow root).
const _svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const DOC = _svg('<path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 3.2V7.5H18M9 12.5h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
const EYE = _svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>');
const SAVE = _svg('<path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 4v5h6V4M8 20v-6h8v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>');
const MERGE = _svg('<circle cx="6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="18" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="13" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 8.3v7.4M6 10.5c.4 3.4 3 5 9.4 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
// SOW-062 P6 rail: the design references these by sprite id; the shadow root has no sprite, so inline them.
const S = 'fill="none" stroke="currentColor"';
const GLOBE = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.3 5.2 3.3 8.2S14.2 17.9 12 20.2M12 3.8c-2.2 2.3-3.3 5.2-3.3 8.2S9.8 17.9 12 20.2" ${S} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`);
const LOCK = _svg(`<rect x="5" y="11" width="14" height="9" rx="2.2" ${S} stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" ${S} stroke-width="1.8"/>`);
const INFO = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M12 11v5" ${S} stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>`);
const X = _svg(`<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2" stroke-linecap="round"/>`);
const CHEV = _svg(`<path d="M6 9l6 6 6-6" ${S} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
const TAG = _svg(`<path d="M4 11.5V5a1 1 0 0 1 1-1h6.5l8 8-7.5 7.5-8-8z" ${S} stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/>`);
const COIN = _svg(`<circle cx="12" cy="12" r="8" ${S} stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1" ${S} stroke-width="1.6" stroke-linecap="round"/>`);
const LINK = _svg(`<path d="M10 14a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 8" ${S} stroke-width="1.7" stroke-linecap="round"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-2.5 2.5a3.5 3.5 0 0 0 5 5L13 16" ${S} stroke-width="1.7" stroke-linecap="round"/>`);
const IMG = _svg(`<rect x="4" y="5" width="16" height="14" rx="2.2" ${S} stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" ${S} stroke-width="1.6"/><path d="M5 17.5l4.2-4.2L13 17l2.6-2.6L19 17.8" ${S} stroke-width="1.7" stroke-linejoin="round"/>`);
const BOOK = _svg(`<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" ${S} stroke-width="1.8" stroke-linejoin="round"/>`); // SOW-062 P6: markdown cheatsheet
const COPY = _svg(`<rect x="8" y="8" width="11" height="12" rx="2" ${S} stroke-width="1.7"/><path d="M5 15.5V5.5a1.5 1.5 0 0 1 1.5-1.5H15" ${S} stroke-width="1.7" stroke-linecap="round"/>`); // SOW-062 P6: copy content id
const CODE = _svg(`<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" ${S} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: markdown view toggle
const PLUS = _svg(`<path d="M12 5.5v13M5.5 12h13" ${S} stroke-width="2" stroke-linecap="round"/>`); // SOW-062 P6: add link row
const TRASH = _svg(`<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" ${S} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: remove link row
const VIDEO = _svg(`<rect x="3.5" y="6" width="11" height="12" rx="2.2" ${S} stroke-width="1.7"/><path d="M14.5 10l6-2.8v9.6l-6-2.8" ${S} stroke-width="1.7" stroke-linejoin="round"/>`); // SOW-062 P6: product video section
const CHAT = _svg(`<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4H6.5" ${S} stroke-width="1.8" stroke-linejoin="round"/>`); // SOW-062 P6: from-the-author section
const USERS = _svg(`<circle cx="9" cy="8" r="3.2" ${S} stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.6M16.5 19a5.5 5.5 0 0 0-2.3-4.5" ${S} stroke-width="1.8" stroke-linecap="round"/>`); // SOW-062 P6: discussion section
const CHECK = _svg(`<path d="M5 12.5l4.5 4.5L19 7" ${S} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: save-chip "saved" tick
const SECTION_ICON = { Publishing: EYE, Taxonomy: TAG, Pricing: COIN, Links: LINK, Media: IMG, Details: DOC };
// SOW-062 P6: keys rendered in a DOCUMENT-CANVAS section (not the rail) for a given type, so they are excluded from
// the preserved-hidden block to avoid a duplicate [data-key]. `video` -> the product Video section.
const DOC_SECTION_KEYS = { product: new Set(['video']) };
// SOW-062 P6 rail-2: the stat tiles (hi-fi rail footer). Discussions is live now (client.listComments count); the
// rest are wired to an optional client.itemStats() that a later backend phase provides -- until then they show a
// pending dash. Order matches the mockup.
const STAT_DEFS = [
  { key: 'revisions', label: 'Live revisions' },
  { key: 'forkRevisions', label: 'Draft revisions' },
  { key: 'contributions', label: 'Contributions' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'discussions', label: 'Discussions' },
];
const TYPE_LABEL = { post: 'Article', product: 'Product', prompt: 'Prompt', profile: 'Profile' };

const TYPES = ['post', 'product', 'prompt', 'profile'];

// SOW-062 Phase 2: fields HIDDEN from the editor UI but PRESERVED on save. They are still rendered into the DOM
// (a hidden block) carrying their preset value, and gather() filters by showIf (not DOM-hidden), so it still reads
// + re-submits them — editing an item that already has a `canonicalUrl` never strips it.
const HIDDEN_KEYS = new Set(['canonicalUrl']);
// SOW-062 Phase 6: the rail follows the hi-fi mockup's CURATED per-type schema (gbti-editor-data.js RAILS), not the
// exhaustive formFields grouping. Each section lists the field keys to show, in order. Any formField NOT listed here
// is preserved HIDDEN (gather() still submits its existing value). status + publishedAt surface in the slug-meta.
// (Article deliberately has no Video section -- owner: the video sidebar is not needed for the article edit page.)
const RAIL_SCHEMA = {
  post: [
    { title: 'Details', open: true, keys: ['visibility', 'excerpt', 'categories', 'tags'] },
    // sow-179: its own section, not folded into Details or Media, since it governs how BOTH read together.
    // "Article layout" rather than "Layout" for the section title -- the field's own label is "Layout", and
    // stacking the same word as both the section header and the field label directly below it read redundant.
    { title: 'Article layout', open: true, keys: ['layout'] },
    { title: 'Media', open: false, keys: ['coverImage', 'coverAlt'] },
  ],
  product: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'categories', 'tags'] },
    { title: 'Layout', open: true, keys: ['sidebarPosition'] },
    { title: 'Pricing', open: true, keys: ['pricing', 'pricingUrl'] },
    { title: 'Links', open: true, keys: ['links'] },
    { title: 'Media', open: true, keys: ['icon', 'featuredImage', 'banner'] },
    // sow-174: gallery/galleryStyle existed in the schema + form-fields already but were never listed in any
    // section, so they were silently hidden-submitted with no control to see or change them. New section.
    { title: 'Gallery', open: false, keys: ['gallery', 'galleryStyle'] },
  ],
  prompt: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'targets', 'categories', 'tags'] },
    { title: 'Media', open: false, keys: ['image'] },
  ],
};

// SOW-062 Phase 6: the markdown cheatsheet content, shown by the toolbar's "Markdown Cheatsheet" button per type.
// Ported from the hi-fi mockup's MD_REF, but rewritten to teach GBTI's REAL body syntax from markdown-blocks.mjs
// (fenced ```callout <variant> and ```embed blocks, plus the `<!-- members-only -->` split marker), NOT the mockup's
// invented `:::` directives, so the reference matches what the serializer actually produces.
const _lines = (a) => a.join('\n');
const MEM_MARKER = '<!-- members-only -->';
const MD_CHEAT = {
  article: {
    label: 'Article',
    blurb: 'Long-form posts. The full markdown palette, plus a callout block and a members-only split.',
    directives: [
      ['```callout note', 'aside / highlight (note, tip, warning)'],
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading 1', '## Heading 2', '### Heading 3', '',
      'Paragraph with **bold**, _italic_, `inline code`,', 'and [a link](https://url).', '',
      '- Bulleted item', '- Another item', '',
      '1. Numbered item', '2. Another item', '',
      '> A blockquote.', '',
      '```js', '// fenced code block', 'const x = 1;', '```', '',
      '```callout warning', 'A highlighted aside. Variants: note, tip, warning.', '```', '',
      MEM_MARKER, '', 'Everything below the marker is visible to members only.',
    ]),
  },
  prompt: {
    label: 'Prompt',
    blurb: 'Reusable prompts. A pure markdown body, with an optional members-only split for extra guidance.',
    directives: [
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading', '',
      'Plain markdown body with **bold**, _italic_,', '`inline code`, and [links](https://url).', '',
      '- Bulleted item', '1. Numbered item', '',
      '> A blockquote.', '',
      '```json', '{ "mcpServers": {} }', '```', '',
      MEM_MARKER, '', 'Extra guidance reserved for members.',
    ]),
  },
  product: {
    label: 'Product',
    blurb: 'Software products. Adds a callout, a video embed, and a members-only split.',
    directives: [
      ['```callout tip', 'aside / highlight (note, tip, warning)'],
      ['```embed', 'video embed (YouTube or Vimeo URL)'],
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading', '',
      'Paragraph with **bold**, _italic_, `inline code`,', 'and [a link](https://url).', '',
      '- Bulleted item', '1. Numbered item', '',
      '> A blockquote.', '',
      '```bash', 'composer require gbti/taxonomy', '```', '',
      '```callout tip', 'A highlighted aside.', '```', '',
      '```embed', 'https://youtube.com/watch?v=...', '```', '',
      MEM_MARKER, '', 'Content only members can read.',
    ]),
  },
};

class GbtiContentEditor extends GbtiElement {
  constructor() {
    super();
    this.type = this.getAttribute('type') || 'post';
    this.fields = [];
    this.preset = null; // { input, body } when editing an existing item
  }

  /** Seed the editor from an existing item (used by the inline editor + "edit" from My Content). */
  // SOW-112: the item's pre-rename slugs, derived from canonical-URL-shaped redirectFrom entries. An inline
  // copy of aliasSlugsOf (canonical: src/lib/content-index.mjs); client-ui does not import src/lib.
  aliasSlugs() {
    const list = Array.isArray(this.preset?.input?.redirectFrom) ? this.preset.input.redirectFrom : [];
    const out = [];
    for (const e of list) {
      const m = /^\/(articles|products|prompts)\/([a-z0-9][a-z0-9-]*)\/$/.exec(String(e || '').trim());
      if (m && m[2] !== this.preset?.input?.slug && !out.includes(m[2])) out.push(m[2]);
    }
    return out;
  }

  load(type, input, body, path, { staged = false, scope } = {}) {
    this.type = type || this.type;
    this.preset = { input: input || {}, body: body || '' };
    this.itemPath = path || null; // SOW-062 P6: the item's index.md path, to resolve a repo-relative cover for preview
    // SOW-145: the content scope. Explicit for a NEW house item (no path yet); inferred from a house/ path when
    // editing an existing house item. House content publishes DIRECTLY (no fork-staged house drafts in v1).
    this.itemScope = scope || (path && String(path).startsWith('house/') ? 'house' : 'member');
    this.staged = Boolean(staged); // SOW-106 QA: loaded from a fork draft branch (not live until published)
    this._slugVal = null; // SOW-112 v2: the pending permalink value follows the loaded item
    if (this.isConnected) this.render();
  }

  // SOW-062 P6: resolve a cover value to a VIEWABLE url for the rail preview. An absolute or already-optimized
  // (/_astro/) url passes through resolveAsset; a repo-relative `./images/x.webp` is served from the item's folder
  // via jsDelivr over GitHub (the built site only serves the /_astro/-optimized variant, whose path the editor does
  // not have). This is why resolveAsset alone produced a broken `gbti.network/./images/...` url. Falls back safely.
  resolveCover(value) {
    // sow-165: a freshly-staged cover previews from its local data URL (jsDelivr 404s until the PR merges);
    // an already-committed value resolves against the item folder over jsDelivr.
    return (this._stagedSrc && this._stagedSrc[value]) || resolveContentAsset(value, this.itemPath);
  }

  async render() {
    if (!this.client) return;
    try {
      const res = await this.client.formFields({ type: this.type });
      this.fields = res?.fields ?? [];
    } catch {
      this.fields = [];
    }
    // SOW-011: surface the membership status so a trial member sees a "membership required to publish" notice
    // up front (the publish action is still gated server-side; this is the proactive UX). 'unknown' (oracle
    // unreachable) shows no notice and does not block, matching the fail-open publish gate.
    let membership = 'unknown';
    let canStage = true; // SOW-082: Save-draft is allowed for trial+paid; 'unknown' fails OPEN like publish
    let authorInitial = 'A'; // SOW-062 P6: the from-the-author avatar monogram
    try {
      const st = await this.client.status();
      membership = st?.membership ?? 'unknown';
      // SOW-145: house content publishes directly (fork-staged house drafts are deferred), so Save-draft is
      // hidden in house scope; a superadmin editing a house item Publishes (which auto-merges via SOW-108).
      canStage = this.itemScope !== 'house' && (membership === 'unknown' || st?.canStageDrafts === true);
      authorInitial = (st?.identity?.login || '').slice(0, 1).toUpperCase() || 'A';
    } catch {
      membership = 'unknown';
    }
    const blocked = membership !== 'paid' && membership !== 'unknown';
    const p = this.preset?.input ?? {};
    const getValPreset = (k) => this.presetStr(p[k]);
    // sow-183: the Author-reassignment picker, EXISTING items only. Sourced from an OPTIONAL client capability
    // (client.authorTargets) that only the website adapter implements so far, and only ever succeeds for a
    // superadmin -- a plain member, or a host that has not wired the capability yet (the extension, until its
    // own sow-183 phase), simply gets no options back, and the whole Author section renders nothing. This is
    // UX gating only; the Worker independently re-verifies the caller on publish either way.
    let authorMembers = null;
    if (this.itemPath) {
      try {
        const t = await this.client.authorTargets?.();
        if (t && Array.isArray(t.members)) authorMembers = t.members;
      } catch { /* not superadmin, or unsupported on this host -- no Author section */ }
    }
    const curAuthorScope = this.itemScope === 'house' ? 'house' : 'member';
    const curAuthorUsername = curAuthorScope === 'house' ? null : (this.presetStr(p.author) || '');
    // SOW-062 Phase 6: header = title + slug ONLY (the description moved into the rail Details per the mockup). The
    // rail renders the per-type RAIL_SCHEMA in order; fields NOT in the schema (nor header, nor publicStub which the
    // visibility switch folds in) are preserved HIDDEN so gather() still submits their existing values.
    const headerKeys = new Set(['title', 'slug']);
    const docSecKeys = DOC_SECTION_KEYS[this.type] || new Set(); // keys rendered in a doc section, not the hidden block
    const schema = RAIL_SCHEMA[this.type] || RAIL_SCHEMA.post;
    const schemaKeys = new Set(schema.flatMap((s) => s.keys));
    const fieldByKey = new Map(this.fields.map((f) => [f.key, f]));
    // NOTE: headerKeys (title, slug) MUST stay in hiddenFields so their hidden [data-key] mirror inputs are rendered
    // -- the inline header contenteditables (data-header) mirror INTO those inputs via _bindHeader, and gather()
    // reads them. Excluding headerKeys here drops title + slug from every publish/draft-save (both are required).
    // sow-174: bannerPreset is excluded exactly like publicStub above -- it renders its own swatch row folded
    // into the banner field's own markup (see fieldHtml), never as an independent row.
    const hiddenFields = this.fields.filter((f) => !schemaKeys.has(f.key) && !docSecKeys.has(f.key) && f.key !== 'publicStub' && f.key !== 'bannerPreset');
    const sectionsHtml = schema.map((sec) => {
      let inner = sec.keys.map((key) => {
        const f = fieldByKey.get(key);
        let html = f ? this.fieldHtml(f, p[key], this.fieldVisible(f, getValPreset)) : '';
        // SOW-112 QA: the permalink editor lives in the Details rail, directly above Short description.
        if (sec.title === 'Details' && key === 'shortDescription') html = this.permalinkFieldHtml() + html;
        return html;
      }).join('');
      if (!inner) return '';
      // sow-184 (design 3a): an at-a-glance hint on a section header, so a collapsed section still tells you what
      // it holds. Media only for now ("1 cover" / "2 images"); every other section carries no hint.
      const hint = sec.title === 'Media' ? mediaSummary(this.type, p) : '';
      const hintHtml = hint ? `<span class="rsec-sum">${esc(hint)}</span>` : '';
      return `<details ${sec.open ? 'open' : ''} class="rsec"><summary><span class="st"><span class="si">${SECTION_ICON[sec.title] || DOC}</span>${esc(sec.title)}</span>${hintHtml}<span class="chev">${CHEV}</span></summary><div class="rbody">${inner}</div></details>`;
    }).join('');
    const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join('');
    const typePath = ({ post: 'articles', product: 'products', prompt: 'prompts' })[this.type] || this.type;
    const isPub = String(p.status || '').toLowerCase() === 'published';
    const statusLabel = isPub ? (p.publishedAt ? String(p.publishedAt).slice(0, 10) : 'published') : 'draft';
    // sow-184 (design 3a): the Status-card descriptor (pill label + tone + published date). `staged` wins over the
    // status field, since a fork-staged draft carries status: published by design.
    const status = editorStatus({ staged: this.staged, status: p.status, publishedAt: p.publishedAt });
    // SOW-062 P6: the slug-meta shows when the item was last updated on LIVE (publishedAt) and LOCALLY (updatedAt,
    // stamped client-side on each save/publish). A published item edited locally shows Live older than Local.
    const fmtD = (d) => { if (!d) return ''; const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); };
    // SOW-106 QA: a fork-staged draft carries status: published BY DESIGN (the "draft" is the fork location),
    // so the meta must key off the staged flag, never the status field, or it would misread as Live.
    const liveLabel = this.staged ? 'Staged draft · not published' : isPub ? (fmtD(p.publishedAt) ? `Live ${fmtD(p.publishedAt)}` : 'Live') : 'Draft';
    const localLabel = fmtD(p.updatedAt) ? `Local ${fmtD(p.updatedAt)}` : '';
    const cheat = this.cheatData(); // SOW-062 P6: per-type markdown cheatsheet content for the modal
    // SOW-062 P6: the document-canvas sections below the body (all `.docsec`, so the md-view rule hides them).
    const slug = this.presetStr(p.slug) || '';
    const videoField = fieldByKey.get('video');
    const videoSection = (docSecKeys.has('video') && videoField) ? `
             <section class="docsec" id="secVideo">
               <div class="docsec-h">${VIDEO} Video <span class="dsub">YouTube or Vimeo, shown at the top of the product page</span></div>
               <input class="inp" data-key="video" data-kind="${esc(videoField.kind || 'text')}" type="text" value="${esc(this.presetStr(p.video) || '')}" placeholder="https://youtube.com/watch?v=…" />
             </section>` : '';
    const showAuthorNote = this.type === 'product' || this.type === 'prompt';
    const authorSection = showAuthorNote ? `
             <section class="docsec" id="secAuthorNote">
               <div class="docsec-h">${CHAT} From the author <span class="dsub">a personal note shown under the content (published in the same PR)</span></div>
               <div class="authornote"><span class="an-av">${esc(authorInitial)}</span>
                 <textarea class="an-text" id="authornote" placeholder="Add a personal note for readers…"></textarea></div>
             </section>` : '';
    const discussionSection = (isPub && slug && ['post', 'product', 'prompt'].includes(this.type)) ? `
             <section class="docsec" id="secDiscussion">
               <div class="docsec-h">${USERS} Discussion <span class="dsub">public and members-only comments</span></div>
               <gbti-discussion data-gbti-hide-author-notes data-gbti-target-type="${esc(this.type)}" data-gbti-target-slug="${esc(slug)}"${this.aliasSlugs().length ? ` data-gbti-target-aliases="${esc(this.aliasSlugs().join(','))}"` : ''}></gbti-discussion>
             </section>` : '';
    const docSections = videoSection + authorSection + discussionSection;
    // sow-183: the Author-reassignment rail section (superadmin-only; null authorMembers hides it entirely).
    // A plain <select>, read at publish time (doPublish) -- exactly like the Permalink field, a pending change
    // takes effect only when Publish is pressed, no separate action or dialog.
    const ownerFieldHtml = authorMembers ? (() => {
      const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
      const options = [opt('house', 'House / GBTI Network', curAuthorScope === 'house')]
        .concat(authorMembers.map((m) => opt(`member:${m.username}`, m.username, curAuthorScope === 'member' && m.username === curAuthorUsername)))
        .join('');
      return `<details open class="rsec"><summary><span class="st"><span class="si">${USERS}</span>Author</span><span class="chev">${CHEV}</span></summary><div class="rbody"><div class="fld"><select id="ownerSelect" class="selbox">${options}</select><div class="urlprev">Superadmin only. Reassigning moves this item to the new owner's folder when you Publish; the public link stays the same.</div></div></div></details>`;
    })() : '';
    // SOW-062 P6 rail-2: the stat tiles footer, shown for a published post/product/prompt (in the rail).
    const showStats = isPub && slug && ['post', 'product', 'prompt'].includes(this.type);
    // sow-184 (design 3a): the stat tiles now live in an "Activity" rail card (was a borderless footer), matching
    // the mockup. Same STAT_DEFS + live Discussions count + jump-to-discussion button.
    const railFootHtml = showStats ? `
             <section class="rcard rcard-activity">
               <div class="rcard-h"><span class="rcard-t">Activity</span></div>
               <div class="rcard-b">
                 <div class="rail-stats">${STAT_DEFS.map((s) => {
                   const inner = `<span class="rs-n" data-statn="${s.key}">${s.key === 'discussions' ? '…' : '—'}</span><span class="rs-l">${esc(s.label)}</span>`;
                   // SOW-112 QA: the Discussions tile links to the discussion section below the content.
                   return s.key === 'discussions' && discussionSection
                     ? `<button class="rstat rstat-link" id="statdiscuss" type="button" title="Jump to the discussion">${inner}</button>`
                     : `<div class="rstat">${inner}</div>`;
                 }).join('')}</div>
                 <p class="rail-foot-note">Live once published. Revisions, contributions, and referrals arrive with the stats backend.</p>
               </div>
             </section>` : '';
    this.set(
      this.css(EDITOR_SURFACE + `
        :host { display:block; background:var(--s-app); color:var(--s-fg); font-family:var(--font-body); container-type:inline-size; }
        /* sow-184 (design 3a): pin the action toolbar so Publish / Save draft / Preview never scroll off. It pins
           to the editor's scroll container; a solid --s-app background + a hairline let the document scroll under it.
           Under the single-column breakpoint below, it collapses back to static. */
        .edhead { display:flex; align-items:center; gap:12px; padding:12px 2px; flex-wrap:wrap; position:sticky; top:0; z-index:20; background:var(--s-app); border-bottom:1.5px solid var(--s-line); }
        .etype { font-family:var(--font-mono,monospace); font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--s-green-fg); background:var(--s-tint); border:1.5px solid var(--s-tint-2); border-radius:999px; padding:5px 12px; }
        .edhead-sp { flex:1; }
        .savechip { font-size:13px; color:var(--s-fg-mute); font-weight:500; display:inline-flex; align-items:center; gap:3px; }
        .savechip svg { width:14px; height:14px; }
        .savechip.ok { color:var(--s-green-fg); font-weight:600; }
        .savechip.busy { color:var(--s-fg-soft); }
        .ebtn[disabled] { opacity:.7; cursor:default; }
        .ebtn .spin { display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:ed-spin .7s linear infinite; }
        @keyframes ed-spin { to { transform:rotate(360deg); } }
        .ebtn { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:8px; border:1.5px solid var(--s-line-2); background:var(--s-surface); color:var(--s-fg); cursor:pointer; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
        .ebtn:hover { border-color:var(--s-fg-mute); }
        .ebtn svg { width:16px; height:16px; }
        .ebtn-primary { background:var(--s-green); border-color:var(--s-green); color:#fff; box-shadow:0 8px 20px rgba(31,158,95,.26); }
        .ebtn-primary:hover { filter:brightness(.96); border-color:var(--s-green); }
        .edgrid { display:grid; grid-template-columns:minmax(0,1fr) 350px; gap:34px; align-items:start; margin-top:18px; }
        /* sow-184's own mockup pins this at "under 1100px"; the WorkBench page shell (.wb-wrap max-width:1200px
           plus its 40px gutter) only ever hands this host ~1120px of inline-size, so a 1140px threshold matched
           unconditionally and the two-column rail could never appear on the real page at any viewport width. */
        @container (max-width:1100px) { .edgrid { grid-template-columns:1fr; } .edhead { position:static; } }
        .doc { min-width:0; background:var(--s-canvas); border:1.5px solid var(--s-line); border-radius:12px; box-shadow:var(--s-shadow-md); padding:40px 46px 52px; color:var(--s-fg); }
        .doc-title { font-family:var(--font-display); font-weight:800; font-size:34px; line-height:1.14; letter-spacing:-.015em; color:var(--s-fg); outline:none; margin-bottom:6px; }
        .doc-title:empty::before { content:attr(data-ph); color:var(--s-fg-mute); opacity:.55; }
        .doc-tagline { font-size:18px; line-height:1.5; font-weight:500; color:var(--s-fg-soft); outline:none; margin:2px 0 14px; }
        .doc-tagline:empty::before { content:attr(data-ph); color:var(--s-fg-mute); opacity:.5; }
        .doc-slug { display:flex; align-items:center; gap:9px; flex-wrap:wrap; font-family:var(--font-mono,monospace); font-size:12.5px; color:var(--s-fg-mute); margin-bottom:6px; }
        .doc-slug .slug-val { color:var(--s-green-fg); font-weight:600; outline:none; border-bottom:1.5px dashed transparent; }
        .doc-slug .slug-val:hover { border-bottom-color:var(--s-line-2); }
        .doc-slug .slug-val:focus { border-bottom-color:var(--s-green); }
        .doc-slug .slug-val.locked { border-bottom-color:transparent; cursor:default; }
        .doc-slug .slug-val.locked:hover { border-bottom-color:transparent; }
        .fld .slugrow { display:flex; align-items:center; gap:4px; font-family:var(--font-mono,monospace); font-size:12.5px; }
        .fld .slugrow .slugpre { color:var(--s-fg-mute); flex:none; }
        .fld .slugrow .slugro { color:var(--s-green-fg); font-weight:600; }
        .fld .slugrow input { flex:1; min-width:0; font:inherit; color:var(--s-green-fg); font-weight:600; background:var(--s-paper, transparent); border:1.5px solid var(--s-line); border-radius:7px; padding:6px 9px; }
        .fld .slugrow input:focus { outline:none; border-color:var(--s-green); }
        .fld .btn2 { margin-top:7px; font:inherit; font-size:12.5px; font-weight:700; color:var(--s-fg); background:none; border:1.5px solid var(--s-line); border-radius:7px; padding:5px 12px; cursor:pointer; }
        .fld .btn2:hover { color:var(--s-green-fg); border-color:var(--s-green); }
        .fld .btn2[disabled] { opacity:.45; cursor:default; }
        .fld .urlprev.danger { color:var(--s-danger, #e06c6c); }
        .doc-slug .slug-meta { display:inline-flex; align-items:center; gap:7px; }
        .doc-slug .pubdot { width:7px; height:7px; border-radius:50%; background:var(--s-fg-mute); }
        .doc-slug .slug-meta.pub .pubdot { background:var(--s-green); }
        .doc-slug .slug-meta.staged .pubdot { background:var(--s-amber, #d9a13c); }
        .doc-slug .slug-meta.staged { color:var(--s-amber, #d9a13c); font-weight:600; }
        .docsec { margin-top:38px; padding-top:30px; border-top:1.5px solid var(--s-line); }
        .docsec#secMain { margin-top:14px; padding-top:0; border-top:none; }
        .docsec-h { font-family:var(--font-mono,monospace); font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--s-fg-mute); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
        .docsec-h svg { width:15px; height:15px; }
        #body { display:block; min-height:24vh; }
        .notice { background:var(--s-tint); border:1px solid var(--s-green); border-radius:10px; padding:10px 14px; margin-bottom:16px; color:var(--s-fg); font-size:13.5px; }
        .notice a { color:var(--s-green-fg); }
        #out { margin-top:14px; }
        .preview { background:var(--s-surface-2); border:1px solid var(--s-line); border-radius:10px; padding:12px 14px; color:var(--s-fg); margin-top:12px; }
        /* sow-062 review feedback: tables render for real now; give them borders and their own horizontal
           scroll so a wide table never widens the editor column on a phone. */
        .preview table { display:block; overflow-x:auto; max-width:100%; border-collapse:collapse; margin:0 0 1.1em; font-size:14px; }
        .preview table th, .preview table td { border:1px solid var(--s-line); padding:6px 10px; text-align:left; vertical-align:top; }
        .preview table th { background:var(--s-surface); font-weight:700; white-space:nowrap; }
        /* sow-184: the rail pins BELOW the sticky toolbar (top:64px clears it), so the top Status card is never
           hidden under the pinned bar. Collapses to static under the breakpoint below. */
        .rail { display:flex; flex-direction:column; gap:14px; position:sticky; top:64px; max-height:calc(100vh - 72px); overflow-y:auto; }
        /* The rail is a height-capped flex column and .rsec has overflow:hidden (zero min size), so without
           this the flex algorithm SHRINKS the section cards to fit instead of scrolling: every card clipped
           its content mid-line (the Type card cut its own one-liner). Cards keep their natural height; the
           rail scrolls. */
        .rail > * { flex-shrink:0; }
        @container (max-width:1100px) { .rail { position:static; max-height:none; } }
        .rsec { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rsec > summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:13px 15px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary::-webkit-details-marker { display:none; }

        .rbody { padding:2px 15px 14px; display:grid; gap:8px; }
        .rbody label { font-size:12px; color:var(--s-fg-mute); font-weight:600; }
        .type-ro { font-weight:600; font-size:13px; padding:7px 11px; border:1px solid var(--s-line); border-radius:8px; background:var(--s-surface-2); color:var(--s-fg); text-transform:capitalize; }
        /* SOW-062 P6 rail controls (ported from gbti-editor.css --s-* controls) */
        .rsec > summary { padding:14px 16px; }
        .rsec > summary::after { content:none; }
        .rsec > summary .st { display:flex; align-items:center; gap:9px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary .st .si { width:17px; height:17px; color:var(--s-fg-mute); display:inline-flex; }
        .rsec > summary .chev { width:17px; height:17px; color:var(--s-fg-mute); transition:transform .18s ease; display:inline-flex; }
        .rsec[open] > summary .chev { transform:rotate(180deg); }
        /* sow-184 (design 3a): a section-header hint (Media "1 cover"), right-aligned before the chevron. */
        .rsec > summary .rsec-sum { margin-left:auto; margin-right:10px; font-family:var(--font-mono,monospace); font-size:10.5px; font-weight:500; color:var(--s-fg-mute); }
        /* sow-184 (design 3a): rail info cards. Status folds the old Type panel into a compact card; Activity holds
           the stat tiles. Same surface tokens as .rsec so the rail reads as one system. */
        .rcard { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rcard-h { display:flex; align-items:center; gap:9px; padding:13px 16px; border-bottom:1px solid var(--s-line); }
        .rcard-t { font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--s-fg-mute); }
        .rcard-b { padding:14px 16px; display:flex; flex-direction:column; gap:11px; }
        .rcard-note { font-size:12px; line-height:1.5; color:var(--s-fg-mute); margin:2px 0 0; }
        .statpill { display:inline-flex; align-items:center; gap:6px; margin-left:auto; font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; padding:3px 9px; border-radius:999px; }
        .statpill .d { width:7px; height:7px; border-radius:50%; background:currentColor; }
        .statpill-live { color:var(--s-green-fg); background:var(--s-tint); border:1.5px solid var(--s-tint-2); }
        /* sow-184: the golden #d9a13c drives the tint + border, but the TEXT uses the theme-aware --s-amber-fg so the
           small 10px label clears WCAG AA on the light card (the flat golden fails at ~2.1:1). */
        .statpill-staged { color:var(--s-amber-fg,#8a5500); background:color-mix(in srgb, var(--s-amber,#d9a13c) 14%, transparent); border:1.5px solid color-mix(in srgb, var(--s-amber,#d9a13c) 34%, transparent); }
        .statpill-draft { color:var(--s-fg-mute); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); }
        .strow { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; }
        .strow .sk { color:var(--s-fg-mute); }
        .strow .sv { font-weight:600; color:var(--s-fg); text-transform:capitalize; }
        .strow .sv.mono { font-family:var(--font-mono,monospace); font-weight:500; text-transform:none; }
        .rbody { padding:4px 16px 16px; display:flex; flex-direction:column; gap:15px; }
        .fld { display:flex; flex-direction:column; gap:6px; }
        .fld > label { font-size:12.5px; font-weight:600; color:var(--s-fg-soft); display:flex; align-items:center; gap:6px; }
        .fld .req { color:var(--s-green-fg); } .fld .hint { font-size:11.5px; color:var(--s-fg-mute); font-weight:400; }
        .inp, .ta, .selbox { width:100%; font:inherit; font-size:13.5px; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; padding:9px 11px; outline:none; box-sizing:border-box; }
        .inp:focus, .ta:focus, .selbox:focus { border-color:var(--s-green); background:var(--s-surface); }
        .ta { resize:vertical; min-height:64px; line-height:1.5; } .inp.mono, .ta.mono { font-family:var(--font-mono,monospace); font-size:12.5px; }
        .selbox { appearance:none; cursor:pointer; padding-right:34px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2384818c' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; }
        .urlprev { font-family:var(--font-mono,monospace); font-size:11.5px; color:var(--s-fg-mute); line-height:1.5; } .urlprev b { color:var(--s-green-fg); font-weight:600; }
        .tgl { width:42px; height:24px; border-radius:999px; background:var(--s-line-2); border:0; position:relative; cursor:pointer; flex:none; transition:background .18s; }
        .tgl.on { background:var(--s-green); }
        .tgl::after { content:""; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .18s cubic-bezier(.3,.7,.4,1); }
        .tgl.on::after { left:21px; }
        .tglrow { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .tglrow .tt { font-size:13px; font-weight:600; color:var(--s-fg); } .tglrow .td { font-size:11.5px; color:var(--s-fg-mute); margin-top:1px; }
        .chips { display:flex; flex-wrap:wrap; gap:6px; padding:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; }
        .chips:focus-within { border-color:var(--s-green); }
        .chip2 { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; padding:4px 6px 4px 10px; border-radius:7px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .chip2 .x { width:15px; height:15px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.65; } .chip2 .x:hover { opacity:1; background:rgba(0,0,0,.08); } .chip2 .x svg { width:11px; height:11px; }
        .chips input { flex:1; min-width:70px; border:0; background:transparent; font:inherit; font-size:13px; color:var(--s-fg); outline:none; padding:4px; }
        .chip-neutral { background:var(--s-surface-3); color:var(--s-fg-soft); border-color:var(--s-line-2); }
        .visfield { padding-bottom:4px; }
        .visswitch { position:relative; display:grid; grid-template-columns:1fr 1fr; padding:4px; border-radius:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); margin-top:2px; }
        .visswitch .vs-thumb { position:absolute; top:4px; bottom:4px; left:4px; width:calc(50% - 4px); border-radius:7px; background:var(--s-surface); box-shadow:0 1px 3px rgba(0,0,0,.12); border:1.5px solid var(--s-line-2); transition:transform .18s cubic-bezier(.3,.7,.4,1); }
        .visswitch[data-active="members"] .vs-thumb { transform:translateX(calc(100% + 4px)); background:var(--s-tint); border-color:var(--s-tint-2); }
        .visswitch .vs-opt { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 6px; border:0; background:transparent; font:inherit; font-size:13.5px; font-weight:600; color:var(--s-fg-mute); cursor:pointer; white-space:nowrap; }
        .visswitch .vs-opt svg { width:16px; height:16px; } .visswitch .vs-opt.on { color:var(--s-fg); }
        .visswitch[data-active="members"] .vs-opt[data-vis="members"].on { color:var(--s-green-fg); }
        .stubwrap { margin-top:12px; padding-top:12px; border-top:1.5px dashed var(--s-line); } .stubwrap[hidden] { display:none; }
        .infobox { display:flex; gap:9px; margin-top:10px; padding:11px 13px; border-radius:7px; background:var(--s-tint); border:1.5px solid var(--s-tint-2); font-size:12.5px; line-height:1.55; color:var(--s-fg-soft); }
        .infobox svg { width:15px; height:15px; flex:none; margin-top:1px; color:var(--s-green-fg); } .infobox b { font-weight:700; color:var(--s-fg); }
        .statusrow { display:flex; align-items:center; gap:8px; }
        .dotpill { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; padding:6px 12px; border-radius:999px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .dotpill .d { width:7px; height:7px; border-radius:50%; background:var(--s-green); }
        .cover-field .ebtn { font-size:13px; padding:7px 12px; }
        /* SOW-062 P6: reframable cover preview (single 4:3-card / Hero frame + striped placeholder) */
        .cover { display:flex; flex-direction:column; gap:10px; margin:6px 0 4px; }
        .framepick { display:inline-flex; gap:2px; padding:2px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; align-self:flex-start; }
        .framepick button { font:inherit; font-size:11.5px; font-weight:600; padding:4px 10px; border:0; background:transparent; color:var(--s-fg-mute); border-radius:5px; cursor:pointer; }
        .framepick button.on { background:var(--s-surface); color:var(--s-fg); box-shadow:0 1px 2px rgba(0,0,0,.1); }
        .coverframe { border:1.5px solid var(--s-line-2); border-radius:8px; overflow:hidden; background:var(--s-surface-2); position:relative; }
        .coverframe.card4 { aspect-ratio:4/3; } .coverframe.hero { aspect-ratio:16/7; }
        .coverframe .ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; color:var(--s-fg-mute); background-image:repeating-linear-gradient(45deg, var(--s-surface-3) 0 12px, transparent 12px 24px); }
        .coverframe .ph svg { width:26px; height:26px; opacity:.5; } .coverframe .ph .mono { font-family:var(--font-mono,monospace); font-size:11px; }
        .coverframe img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
        .coverbtns { display:flex; gap:8px; }
        /* sow-174: banner color-preset swatches, folded into the banner cover control (mutually exclusive
           with the image above it -- see doCoverImage/clearCover). */
        .swatch-or { font-size:11.5px; color:var(--s-fg-mute); text-align:center; margin:2px 0; }
        .swatchrow { display:flex; flex-wrap:wrap; gap:7px; }
        .swatch { display:inline-flex; align-items:center; gap:7px; font:inherit; font-size:12px; font-weight:600; color:var(--s-fg-soft); padding:6px 11px 6px 7px; border:1.5px solid var(--s-line-2); border-radius:999px; background:var(--s-surface); cursor:pointer; transition:border-color .15s,color .15s; }
        .swatch:hover { border-color:var(--s-fg-mute); color:var(--s-fg); }
        .swatch.on { border-color:var(--s-green); color:var(--s-fg); background:var(--s-tint); }
        .sw-dot { width:16px; height:16px; border-radius:50%; flex:none; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
        /* sow-174: gallery-layout picker (Auto / Grid / Carousel), illustrated cards instead of a <select>. */
        .gs-cards { display:flex; gap:10px; flex-wrap:wrap; }
        .gs-card { display:flex; flex-direction:column; align-items:flex-start; gap:8px; width:132px; padding:12px; border:1.5px solid var(--s-line-2); border-radius:9px; background:var(--s-surface); font:inherit; text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
        .gs-card:hover { border-color:var(--s-fg-mute); }
        .gs-card.on { border-color:var(--s-green); background:var(--s-tint); }
        .gs-shape { display:flex; align-items:center; gap:4px; width:100%; height:34px; }
        .gs-tile { flex:1; align-self:stretch; border-radius:4px; background:var(--s-surface-3); }
        .gs-frame { display:block; width:100%; height:22px; border-radius:4px; background:var(--s-surface-3); }
        .gs-strip { display:flex; gap:3px; width:100%; height:8px; margin-top:2px; }
        .gs-strip i { flex:1; border-radius:2px; background:var(--s-surface-3); font-style:normal; }
        .gs-name { font-size:12.5px; font-weight:700; color:var(--s-fg); }
        .gs-card.on .gs-name { color:var(--s-green-fg); }
        .gs-desc { font-size:11px; line-height:1.35; color:var(--s-fg-mute); }
        /* SOW-062 P6: product links[] row editor */
        .linkrows { display:flex; flex-direction:column; gap:9px; margin-bottom:8px; }
        .linkrow { display:flex; flex-direction:column; gap:8px; padding:10px; border:1.5px solid var(--s-line-2); border-radius:8px; background:var(--s-surface-2); }
        .linkrow .lr-top, .linkrow .lr-bot { display:flex; align-items:center; gap:8px; }
        .linkrow .lk-type { flex:none; width:118px; }
        .linkrow .lk-url, .linkrow .lk-label { flex:1; min-width:0; }
        .linkrow .inp { padding:7px 9px; font-size:12.5px; }
        .lr-del { flex:none; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border:1.5px solid var(--s-line-2); border-radius:7px; background:var(--s-surface); color:var(--s-fg-mute); cursor:pointer; }
        .lr-del:hover { color:#c0392b; border-color:#c0392b; } .lr-del svg { width:16px; height:16px; }
        .lr-vis { display:inline-flex; padding:2px; gap:2px; background:var(--s-surface); border:1.5px solid var(--s-line-2); border-radius:7px; flex:none; }
        .lr-vis button { font:inherit; font-size:10.5px; font-weight:600; padding:5px 9px; border:0; background:transparent; color:var(--s-fg-soft); border-radius:6px; cursor:pointer; }
        .lr-vis button.on { background:var(--s-fg); color:var(--s-canvas); }
        .addrow { font-size:13px; padding:8px 12px; align-self:flex-start; }
        /* SOW-062 P6 rail-2 + sow-184: the stat tiles, now inside the Activity card (design 3a), 2-up per the mockup. */
        .rail-stats { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
        .rstat { display:flex; flex-direction:column; align-items:center; gap:3px; padding:12px 6px; border:1.5px solid var(--s-line); border-radius:8px; background:var(--s-surface); }
        .rstat .rs-n { font-family:var(--font-display); font-weight:800; font-size:22px; line-height:1; color:var(--s-fg); }
        .rstat .rs-l { font-size:10.5px; font-weight:600; color:var(--s-fg-mute); text-align:center; line-height:1.25; }
        .rail-foot-note { font-size:11.5px; line-height:1.45; color:var(--s-fg-mute); margin-top:10px; text-align:center; }
        /* SOW-062 P6: markdown cheatsheet modal (ported from gbti-editor.css .mdRefModal onto the component tokens) */
        .mdRefModal { position:fixed; inset:0; z-index:1200; display:none; }
        .mdRefModal.show { display:block; }
        .mr-scrim { position:absolute; inset:0; background:rgba(15,14,18,.55); backdrop-filter:blur(3px); }
        .mr-panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(680px, calc(100% - 36px)); max-height:calc(100% - 48px); display:flex; flex-direction:column; background:var(--s-surface); border:1.5px solid var(--s-line-2); border-radius:12px; box-shadow:var(--s-shadow-md); overflow:hidden; }
        .mr-head { display:flex; align-items:flex-start; gap:14px; padding:22px 24px 16px; border-bottom:1.5px solid var(--s-line); }
        .mr-head > div { flex:1; }
        .mr-head h3 { font-family:var(--font-display); font-weight:800; font-size:21px; letter-spacing:-.01em; color:var(--s-fg); }
        .mr-head p { font-size:13px; color:var(--s-fg-mute); margin-top:5px; line-height:1.5; }
        .mm-x { width:36px; height:36px; flex:none; border-radius:8px; border:1.5px solid var(--s-line-2); background:var(--s-surface); color:var(--s-fg-soft); cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .mm-x:hover { background:var(--s-surface-2); } .mm-x svg { width:18px; height:18px; }
        .mr-scroll { overflow-y:auto; padding:18px 24px 24px; }
        .mr-blurb { font-size:13px; color:var(--s-fg-mute); line-height:1.55; margin-bottom:14px; }
        .mr-legend { padding:14px 16px; border-radius:8px; background:var(--s-surface-2); border:1.5px solid var(--s-line); margin-bottom:18px; }
        .mr-legend > b { font-size:12px; font-weight:700; color:var(--s-fg); }
        .mr-leg-grid { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin-top:10px; align-items:center; }
        .mr-leg-grid code { font-family:var(--font-mono,monospace); font-size:12px; color:var(--s-green-fg); white-space:pre; }
        .mr-leg-grid span { font-size:12.5px; color:var(--s-fg-mute); }
        .mr-code { font-family:var(--font-mono,monospace); font-size:12.5px; line-height:1.7; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line); border-radius:8px; padding:15px 16px; overflow-x:auto; white-space:pre; tab-size:2; margin:0; }
        /* SOW-062 P6: Visual / Markdown doc-view toggle + the read-only full-document markdown panel */
        .doc-view-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 26px; }
        .doc-view { display:inline-flex; gap:3px; padding:4px; border-radius:8px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); }
        .dv-cheat { padding:6px 12px; font-size:12.5px; }
        .ebtn[hidden] { display:none; } /* [hidden] must beat .ebtn's display:inline-flex (cheatsheet + publish) */
        /* SOW-062 P6: the publish-expectation banner above the toolbar */
        .pubinfo { display:flex; align-items:flex-start; gap:9px; padding:11px 14px; margin:0 2px 12px; border-radius:10px; background:var(--s-tint); border:1.5px solid var(--s-tint-2); font-size:12.5px; line-height:1.5; color:var(--s-fg-soft); }
        .pubinfo[hidden] { display:none; } /* the hidden attribute must win over display:flex (an empty strip showed otherwise) */
        .pubinfo svg { width:16px; height:16px; flex:none; margin-top:1px; color:var(--s-green-fg); } .pubinfo b { color:var(--s-fg); font-weight:700; }
        .pubinfo.warn { background:color-mix(in srgb, var(--s-amber, #d9a13c) 12%, transparent); border-color:var(--s-amber, #d9a13c); }
        .pubinfo.warn svg { color:var(--s-amber, #d9a13c); }
        .pubinfo.danger { background:color-mix(in srgb, var(--s-danger, #e06c6c) 12%, transparent); border-color:var(--s-danger, #e06c6c); }
        .pubinfo.danger svg { color:var(--s-danger, #e06c6c); }
        .doc-slug .meta-local { color:var(--s-fg-mute); }
        .doc-view button { display:inline-flex; align-items:center; gap:7px; padding:7px 15px; border:0; border-radius:7px; background:transparent; font:inherit; font-size:13px; font-weight:600; color:var(--s-fg-mute); cursor:pointer; white-space:nowrap; transition:color .14s ease; }
        .doc-view button svg { width:15px; height:15px; }
        .doc-view button.on { background:var(--s-surface); color:var(--s-fg); box-shadow:0 1px 3px rgba(0,0,0,.12); border:1.5px solid var(--s-line-2); padding:5.5px 13.5px; }
        .doc.md-view > .doc-title, .doc.md-view > .doc-slug, .doc.md-view > .docsec { display:none; }
        .docmd-wrap { border:1.5px solid var(--s-line-2); border-radius:8px; overflow:hidden; background:var(--s-surface); }
        .docmd-wrap[hidden] { display:none; }
        .docmd-bar { display:flex; align-items:center; gap:8px; padding:11px 15px; border-bottom:1.5px solid var(--s-line); background:var(--s-surface-2); font-size:13px; font-weight:600; color:var(--s-fg-soft); }
        .docmd-bar svg { width:15px; height:15px; color:var(--s-green-fg); }
        .docmd-note { margin-left:auto; font-family:var(--font-mono,monospace); font-size:11px; font-weight:500; color:var(--s-fg-mute); }
        .docmd { display:block; width:100%; box-sizing:border-box; border:0; resize:vertical; min-height:60vh; padding:20px 22px; font-family:var(--font-mono,monospace); font-size:13px; line-height:1.7; color:var(--s-fg); background:var(--s-surface); outline:none; white-space:pre; tab-size:2; }
        /* SOW-062 P6: the document-canvas sections (Video, From-the-author, Discussion) below the body */
        .docsec-h .dsub { text-transform:none; letter-spacing:0; font-weight:500; color:var(--s-fg-mute); }
        #secVideo .inp { width:100%; box-sizing:border-box; }
        .authornote { display:flex; gap:12px; align-items:flex-start; }
        .an-av { flex:none; width:34px; height:34px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-weight:700; font-size:14px; color:#fff; background:var(--s-green); }
        .an-text { flex:1; min-width:0; font:inherit; font-size:14px; line-height:1.55; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:9px; padding:11px 13px; outline:none; resize:vertical; min-height:70px; box-sizing:border-box; }
        .an-text:focus { border-color:var(--s-green); background:var(--s-surface); }
        #secDiscussion gbti-discussion { display:block; margin-top:2px; }
        button.rstat-link { font:inherit; background:none; border:none; padding:0; cursor:pointer; text-align:inherit; }
        button.rstat-link:hover .rs-n, button.rstat-link:hover .rs-l { color:var(--s-green-fg); }
      `) +
        `${this.staged
          ? `<div class="pubinfo warn" id="pubbanner">${INFO}<span>This staged draft is ahead of the live edge — your changes are not published yet. <b>Publish</b> to make them live.</span></div>`
          : `<div class="pubinfo" id="pubbanner" hidden></div>`}
         <div class="edhead">
           <span class="etype">${esc(this.type)}</span>
           <span class="edhead-sp"></span>
           <span class="savechip" id="savechip"></span>
           ${this.itemPath ? `<button class="ebtn" id="copyid" type="button" title="Copy this content's ID (its repo path) for the MCP server">${COPY} <span class="lbl">Copy ID</span></button>` : ''}
           ${isPub ? `<button class="ebtn" id="viewpub" type="button" title="Open the live public page in a new tab">${GLOBE} <span class="lbl">View Public Entry</span></button>` : ''}
           ${canStage ? `<button class="ebtn" id="draft" type="button">${SAVE} Save draft</button>` : ''}
           ${canStage ? `<button class="ebtn" id="preview" type="button" title="Save the draft, then open it in a new tab as the page it will become">${GLOBE} <span class="lbl">Preview</span></button>` : ''}
           <button class="ebtn${blocked ? '' : ' ebtn-primary'}" id="publish" type="button"${isPub && !this.staged ? ' hidden' : ''}${blocked ? ' title="Publishing requires a paid membership"' : ''}>${blocked ? 'Membership required' : `${MERGE} Publish`}</button>
         </div>
         <div class="edgrid">
           <article class="doc">
             ${blocked ? `<div class="notice">Publishing requires a paid membership. Use <b>Save draft</b> to keep your work on your own fork; publish it once you upgrade. <a href="https://gbti.network/membership/" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ''}
             <div class="doc-title" contenteditable="true" data-header="title" data-ph="Untitled">${esc(this.presetStr(p.title) || '')}</div>
             ${(() => {
               // SOW-106 QA fix: the slug IS the item identity (branch + path derive from it), so on an EXISTING
               // item it is set at creation, like the Type. Editing it here silently forked a NEW item.
               // SOW-112 QA (owner-directed): the inline permalink is a pure DISPLAY; the editor lives in the
               // Details rail (permalinkFieldHtml), above Short description.
               const slugVal = `<span class="slug-val locked">${esc(this.presetStr(p.slug) || '')}</span>`;
               const metaCls = this.staged ? ' staged' : (isPub ? ' pub' : '');
               return `<div class="doc-slug"><span class="slug-base">${esc(typePath)}/</span>${slugVal}<span class="slug-meta${metaCls}"><span class="pubdot"></span><span>${esc(liveLabel)}</span>${localLabel ? ` <span class="meta-local">· ${esc(localLabel)}</span>` : ''}</span></div>`;
             })()}
             <div class="doc-view-row">
               <div class="doc-view" id="docview">
                 <button type="button" class="on" data-view="visual">${DOC} Visual</button>
                 <button type="button" data-view="markdown">${CODE} Markdown</button>
               </div>
               <button class="ebtn dv-cheat" id="mdref" type="button" title="Markdown cheatsheet" hidden>${BOOK} <span class="lbl">Cheatsheet</span></button>
             </div>
             <section class="docsec" id="secMain">
               <div class="docsec-h">${DOC} Main content</div>
               <gbti-doc-editor id="body"></gbti-doc-editor>
             </section>${docSections}
             <div class="docmd-wrap" id="docmdwrap" hidden>
               <div class="docmd-bar">${CODE} <span>Full document as markdown</span><span class="docmd-note">Read-only source view</span></div>
               <textarea class="docmd" id="docmd" spellcheck="false" readonly></textarea>
             </div>
             <div id="out" class="muted"></div>
             <div hidden>${hiddenHtml}</div>
           </article>
           <aside class="rail">
             <section class="rcard rcard-status">
               <div class="rcard-h"><span class="rcard-t">Status</span><span class="statpill statpill-${status.tone}"><span class="d"></span>${esc(status.label)}</span></div>
               <div class="rcard-b">
                 <div class="strow"><span class="sk">Type</span><span class="sv">${esc(this.typeLabel())}</span></div>
                 ${status.publishedLabel ? `<div class="strow"><span class="sk">Published</span><span class="sv mono">${esc(status.publishedLabel)}</span></div>` : ''}
                 <p class="rcard-note">Type is set at creation and can't be changed here.</p>
               </div>
             </section>
             ${ownerFieldHtml}
             ${sectionsHtml}
             ${railFootHtml}
           </aside>
         </div>
         <div class="mdRefModal" id="mdrefmodal">
           <div class="mr-scrim" data-mrclose></div>
           <div class="mr-panel">
             <div class="mr-head"><div><h3>Markdown cheatsheet</h3><p>How to write ${esc(cheat.label.toLowerCase())} content in markdown: the standard elements plus the GBTI-specific blocks.</p></div><button class="mm-x" type="button" data-mrclose title="Close">${X}</button></div>
             <div class="mr-scroll">
               <p class="mr-blurb">${esc(cheat.blurb)}</p>
               <div class="mr-legend"><b>GBTI blocks</b><div class="mr-leg-grid">${cheat.directives.map(([d, t]) => `<code>${esc(d)}</code><span>${esc(t)}</span>`).join('')}</div></div>
               <pre class="mr-code">${esc(cheat.body)}</pre>
             </div>
           </div>
         </div>`,
    );

    // SOW-062 5e: the Document Type is READ-ONLY (set when the item is created; gather() reads this.type, not the DOM).
    this.on('#mdref', 'click', () => this.$('#mdrefmodal')?.classList.add('show'));
    this.$$('[data-mrclose]').forEach((el) => el.addEventListener('click', () => this.$('#mdrefmodal')?.classList.remove('show')));
    if (!this._escWired) { this._escWired = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.$('#mdrefmodal')?.classList.remove('show'); }); }
    if (this.itemPath) this.on('#copyid', 'click', () => this.copyContentId());
    this._wirePermalinkField(); // SOW-112: the Details-rail permalink editor
    this.on('#statdiscuss', 'click', () => this.$('#secDiscussion')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    this.on('#viewpub', 'click', () => { const u = this.publicUrl(); if (u) window.open(u, '_blank', 'noopener'); });
    this.$$('#docview [data-view]').forEach((b) => b.addEventListener('click', () => this.setDocView(b.dataset.view))); // SOW-062 P6: Visual/Markdown
    this.on('#draft', 'click', () => this.doDraft());
    this.on('#preview', 'click', () => this.doPreview());
    this.on('#publish', 'click', () => this.doPublish());
    // SOW-062 P6: the Publish button shows ONLY when there is something to publish -- the item is unpublished (it was
    // rendered visible above) OR it has local edits since load. Reset the dirty flag for the freshly-loaded content,
    // then mark dirty on any edit. The root-level input/change listeners persist (this.root is stable); the element
    // listeners re-bind each render.
    this._dirty = false;
    if (!this._dirtyRootWired) {
      this._dirtyRootWired = true;
      this.root.addEventListener('input', () => this._markDirty()); // header/slug/rail text + chips (input is composed)
      this.root.addEventListener('change', () => this._markDirty()); // selects + checkboxes
    }
    this.$('#body')?.addEventListener('block-change', () => this._markDirty()); // body block add/edit/delete/convert/drag
    // rail control mutations that do NOT fire input/change (visibility switch, toggles, chip remove, cover, links).
    // Text fields fire input (caught above); a section collapse (summary) or the cover frame toggle are not edits.
    this.$('.rail')?.addEventListener('click', (e) => { if (e.target.closest('button:not([data-frame]), [data-rm]') && !e.target.closest('summary')) this._markDirty(); });
    this._bindHeader(); // SOW-062 P6: the inline title/tagline/slug mirror to their hidden [data-key] inputs
    this._wireRail(); // SOW-062 P6: chips / toggles / visibility switch / status dots
    this._wireLinks(); // SOW-062 P6: the product links[] row editor (serializes into the hidden json input)
    // SOW-062 P6: prefill the from-the-author note from the existing intro-<slug> comment (product/prompt, existing item).
    const introSlug = (this.type === 'product' || this.type === 'prompt') ? this.presetStr(this.preset?.input?.slug) : '';
    if (introSlug) {
      this.client?.getComment?.({ id: `intro-${introSlug}` }).then((c) => {
        const ta = this.$('#authornote');
        if (ta && !ta.value && c?.body) ta.value = c.body;
      }).catch(() => {});
    }
    // SOW-062 P6 rail-2: fill the Discussions stat tile from the live comment count; fill the rest from an optional
    // client.itemStats() once a later backend phase provides it (until then they stay a pending dash).
    if (showStats) {
      const setStat = (key, n) => { const el = this.$(`[data-statn="${key}"]`); if (el && n != null) el.textContent = String(n); };
      // Parity with the PUBLIC thread count: union the rename aliases, exclude author notes (pinned, not
      // replies) and legacy members rows with no encrypted body (the page excludes them too). A just-posted
      // comment still counts here before the deploy (the live echo) — deliberately ahead of the public page.
      this.client?.listComments?.({ targetType: this.type, targetSlug: slug, aliases: this.aliasSlugs() })
        .then((res) => setStat('discussions', (res?.items || []).filter((c) => !c.authorNote && (c.visibility !== 'members' || c.encryptedBody)).length))
        .catch(() => setStat('discussions', 0));
      this.client?.itemStats?.({ type: this.type, slug, path: this.itemPath })
        .then((st) => { if (st) STAT_DEFS.forEach((s) => setStat(s.key, st[s.key])); }).catch(() => {});
    }

    // SOW-062 P3: the rich cover-image control(s) — preview + Choose/Replace/Remove (the kind:'image' field).
    this.$$('[data-cover]').forEach((c) => {
      const file = c.querySelector('[data-cover-file]');
      c.querySelector('[data-cover-pick]')?.addEventListener('click', () => file?.click());
      file?.addEventListener('change', (e) => this.doCoverImage(e.target.files?.[0], c));
      c.querySelector('[data-cover-clear]')?.addEventListener('click', () => this.clearCover(c));
      // SOW-062 P6: the 4:3-card / Hero frame toggle just swaps the preview aspect ratio (a preview aid).
      c.querySelectorAll('[data-frame]').forEach((fb) => fb.addEventListener('click', () => {
        c.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('on', b === fb));
        const cf = c.querySelector('[data-coverframe]');
        if (cf) cf.className = 'coverframe ' + (fb.dataset.frame === 'hero' ? 'hero' : 'card4');
      }));
    });

    // sow-174: the banner swatch row -- mutually exclusive with the image side of the SAME [data-cover]
    // control (resolveHero() only ever uses one or the other). Picking a swatch clears any staged image;
    // doCoverImage (below) clears the swatch selection back the other way when a file is chosen.
    this.$$('[data-swatches]').forEach((row) => {
      const cover = row.closest('[data-cover]');
      const hidden = row.querySelector('[data-key="bannerPreset"]');
      row.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
        row.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', b === btn));
        if (hidden) hidden.value = btn.dataset.preset;
        if (cover) this.clearCover(cover);
      }));
    });

    // sow-174: the gallery-layout cards (Auto / Grid / Carousel) -- a plain enum choice with illustrated
    // options instead of a <select>, same hidden data-key contract as every other enum field.
    this.$$('[data-gscards]').forEach((row) => {
      const hidden = row.querySelector('input[type="hidden"]');
      row.querySelectorAll('[data-gs]').forEach((btn) => btn.addEventListener('click', () => {
        row.querySelectorAll('[data-gs]').forEach((b) => b.classList.toggle('on', b === btn));
        if (hidden) hidden.value = btn.dataset.gs;
      }));
    });

    // SOW-062 P4: seed the block body editor from the preset body (its value setter parses Markdown -> blocks).
    const be = this.$('#body');
    // sow-165: hand the body editor the item's path BEFORE its value, so a repo-relative image block
    // (`./images/x.webp`) resolves against the item folder on its first render instead of 404-ing against
    // the page url.
    if (be) { be.itemPath = this.itemPath; be.value = this.preset?.body ?? ''; }

    // Live-toggle conditional fields (e.g. the image-gen-only result image) as their dependency changes.
    const deps = new Set(this.fields.filter((f) => f.showIf?.field).map((f) => f.showIf.field));
    for (const dep of deps) {
      const el = this.$(`[data-key="${dep}"]`);
      if (el) { el.addEventListener('input', () => this.syncConditional()); el.addEventListener('change', () => this.syncConditional()); }
    }
  }

  fieldHtml(f, value, visible = true) {
    const v = value == null ? '' : Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    const label = `<label>${esc(f.label || f.key)}${f.required ? ' <span class="req">*</span>' : ''}${f.hint ? ` <span class="hint">· ${esc(f.hint)}</span>` : ''}</label>`;
    const wrap = (inner, cls = '') => `<div class="fld${cls ? ' ' + cls : ''}" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${inner}</div>`;

    // SOW-062 P6: visibility -> segmented switch + optional public-stub sub-block (publicStub is folded in here).
    if (f.kind === 'enum' && f.key === 'visibility') {
      const isMembers = String(v) === 'members';
      const stubField = this.fields.find((x) => x.key === 'publicStub');
      const stubOn = this._presetBool('publicStub');
      return `<div class="fld visfield" data-fkey="visibility"${visible ? '' : ' hidden'}><label>Visibility</label>
        <div class="visswitch" data-visswitch data-active="${isMembers ? 'members' : 'public'}"><span class="vs-thumb"></span>
          <button class="vs-opt ${isMembers ? '' : 'on'}" data-vis="public" type="button">${GLOBE} Public</button>
          <button class="vs-opt ${isMembers ? 'on' : ''}" data-vis="members" type="button">${LOCK} Members only</button></div>
        <input data-key="visibility" data-kind="enum" type="hidden" value="${esc(isMembers ? 'members' : 'public')}" />
        ${stubField ? `<div class="stubwrap" data-stubwrap ${isMembers ? '' : 'hidden'}>
          <div class="tglrow"><div><div class="tt">Leave a public stub</div><div class="td">Show a teaser on the public site instead of hiding it.</div></div>
            <button class="tgl ${stubOn ? 'on' : ''}" data-k="publicStub" type="button" role="switch" aria-checked="${stubOn}"></button></div>
          <input data-key="publicStub" data-kind="boolean" type="checkbox" ${stubOn ? 'checked' : ''} hidden />
          <div class="infobox">${INFO}<div>With a stub, the public site shows the <b>title</b>, <b>author</b>, and <b>short description</b>; the content stays members-only.</div></div>
        </div>` : ''}</div>`;
    }
    // status -> dotpill + select
    if (f.kind === 'enum' && f.key === 'status') {
      const opts = (f.options || ['draft', 'published']).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('');
      return wrap(`${label}<div class="statusrow"><span class="dotpill" data-statuspill><span class="d"></span><span data-statustxt>${esc(v || 'draft')}</span></span><select class="selbox" data-key="status" data-kind="enum" style="flex:1">${opts}</select></div>`);
    }
    // sow-174: gallery layout -> three illustrated cards (Auto / Grid / Carousel) instead of a bare select,
    // matching the design mock's own live toggle. "Auto" is an empty value: the hidden input's default
    // coercion (form.mjs) already turns '' into undefined on submit, which is exactly what resolveGalleryStyle()
    // needs to fall back to picking by shot count -- no new gather/coerce path for this field.
    if (f.kind === 'enum' && f.key === 'galleryStyle') {
      const cards = [
        { key: '', name: 'Auto', desc: 'Picks a layout by shot count', shape: '' },
        { key: 'grid', name: 'Grid', desc: 'Captioned, 2-up', shape: '<span class="gs-tile"></span><span class="gs-tile"></span>' },
        { key: 'carousel', name: 'Carousel', desc: 'One large frame + a filmstrip', shape: '<span class="gs-frame"></span><span class="gs-strip"><i></i><i></i><i></i></span>' },
      ];
      const cur = v || '';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
    }
    // sow-179: article layout -> three illustrated cards (Editorial / Journal / Card), the same pattern as
    // the galleryStyle picker above (reuses its .gs-* CSS and the generic [data-gscards] click handler
    // as-is, no new wiring needed). Unlike galleryStyle there is no "Auto" option: the schema default
    // (editorial) is a real, always-on choice, not a fallback computed from something else.
    if (f.kind === 'enum' && f.key === 'layout') {
      const cards = [
        { key: 'editorial', name: 'Editorial', desc: 'Full-width cover hero, title on it', shape: '<span class="gs-frame"></span><span class="gs-strip"><i></i><i></i></span>' },
        { key: 'journal', name: 'Journal', desc: 'Sticky rail beside one reading column', shape: '<span class="gs-tile" style="flex:0 0 26%"></span><span class="gs-tile"></span>' },
        { key: 'card', name: 'Card', desc: 'Centered card, no rail', shape: '<span class="gs-tile" style="flex:0 0 62%;margin:0 auto"></span>' },
      ];
      const cur = v || 'editorial';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
    }
    // Product sidebar position -> two illustrated cards (Left / Right), same pattern as the article-layout
    // picker above (reuses its .gs-* CSS and the generic [data-gscards] click handler as-is).
    if (f.kind === 'enum' && f.key === 'sidebarPosition') {
      const cards = [
        { key: 'left', name: 'Left', desc: 'Contents rail beside the left edge', shape: '<span class="gs-tile" style="flex:0 0 26%"></span><span class="gs-tile"></span>' },
        { key: 'right', name: 'Right', desc: 'Contents rail beside the right edge', shape: '<span class="gs-tile"></span><span class="gs-tile" style="flex:0 0 26%"></span>' },
      ];
      const cur = v || 'right';
      const cardsHtml = cards.map((c) => `<button type="button" class="gs-card${c.key === cur ? ' on' : ''}" data-gs="${c.key}">
        <span class="gs-shape">${c.shape}</span><span class="gs-name">${esc(c.name)}</span><span class="gs-desc">${esc(c.desc)}</span></button>`).join('');
      return wrap(`${label}<div class="gs-cards" data-gscards>${cardsHtml}<input data-key="${f.key}" data-kind="enum" type="hidden" value="${esc(cur)}" /></div>`);
    }
    // generic enum -> styled selbox
    if (f.kind === 'enum') {
      return wrap(`${label}<select class="selbox" data-key="${f.key}" data-kind="enum">${(f.options || []).map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`);
    }
    // boolean -> toggle
    if (f.kind === 'boolean') {
      const on = !!value;
      return wrap(`<div class="tglrow"><div><div class="tt">${esc(f.label || f.key)}</div>${f.desc ? `<div class="td">${esc(f.desc)}</div>` : ''}</div><button class="tgl ${on ? 'on' : ''}" data-k="${f.key}" type="button" role="switch" aria-checked="${on}"></button></div><input type="checkbox" data-key="${f.key}" data-kind="boolean" ${on ? 'checked' : ''} hidden />`);
    }
    // array -> chips (value arrives comma-joined; hidden input keeps the comma string for gather())
    if (f.kind === 'array') {
      const arr = String(v).split(',').map((s) => s.trim()).filter(Boolean);
      const accent = f.key !== 'tags';
      const chips = arr.map((c) => `<span class="chip2 ${accent ? '' : 'chip-neutral'}">${esc(c)}<span class="x" data-rm>${X}</span></span>`).join('');
      return wrap(`${label}<div class="chips" data-chips="${f.key}" data-accent="${accent}">${chips}<input type="text" placeholder="${esc(f.placeholder || 'Add…')}"></div><input data-key="${f.key}" data-kind="array" type="hidden" value="${esc(arr.join(', '))}" />`);
    }
    // image / cover (current control; the reframe is deferred to rail-2)
    if (f.kind === 'image') {
      const url = v ? this.resolveCover(v) : '';
      const has = !!url;
      // A field that declares its own aspect (product icon 1:1, featured 16:10, banner 3:1) locks the preview
      // to it: the old shared 4:3/Hero toggle matched none of them, so an icon stretched into a 4:3 box and a
      // 16:10 cover showed letterbox bars. Fields with no declared frame keep the toggle.
      const framed = typeof f.frame === 'string' && f.frame.includes('/');
      const frameStyle = framed ? ` style="aspect-ratio:${esc(f.frame)}${f.previewPx ? `;max-width:${Number(f.previewPx)}px` : ''}"` : '';
      const picker = framed
        ? ''
        : '<div class="framepick"><button type="button" class="on" data-frame="card4">4:3 card</button><button type="button" data-frame="hero">Hero</button></div>';
      const hint = f.hint ? `<div class="urlprev" style="color:var(--s-fg-soft)">${esc(f.hint)}</div>` : '';
      // sow-174: the banner field alone also offers a curated color preset, an alternative to uploading an
      // image (resolveHero() in product-page.mjs treats an uploaded image and a chosen preset as mutually
      // exclusive). bannerPreset is not its own row -- it is excluded from RAIL_SCHEMA and hiddenFields both,
      // and folded in here exactly like publicStub is folded into the visibility field above.
      const presetVal = f.key === 'banner' ? String(this.preset?.input?.bannerPreset || '') : '';
      const swatchesHtml = f.key === 'banner' ? `<div class="swatchrow" data-swatches>${BANNER_PRESETS.map((p) =>
        `<button type="button" class="swatch${p.key === presetVal ? ' on' : ''}" data-preset="${p.key}" title="${esc(p.label)}">
          <span class="sw-dot" style="background:linear-gradient(150deg,${p.from},${p.to})"></span>${esc(p.label)}</button>`).join('')}
        <input data-key="bannerPreset" data-kind="enum" type="hidden" value="${esc(presetVal)}" /></div>` : '';
      return `<div class="fld cover-field" data-fkey="${f.key}"${visible ? '' : ' hidden'}>${label}${hint}
        <div class="cover" data-cover>
          ${picker}
          <div class="coverframe${framed ? '' : ' card4'}" data-coverframe${frameStyle}>${this._coverFrameInner(url)}</div>
          <input type="file" accept="image/*" hidden data-cover-file />
          <div class="coverbtns"><button type="button" class="ebtn" data-cover-pick>${has ? 'Replace image' : 'Choose image'}</button><button type="button" class="ebtn" data-cover-clear${has ? '' : ' hidden'}>Remove</button></div>
          ${swatchesHtml ? `<div class="swatch-or">or pick a color</div>${swatchesHtml}` : ''}
          <input data-key="${f.key}" data-kind="image" type="hidden" value="${esc(v)}" />
        </div></div>`;
    }
    // SOW-062 P6: the product links[] editor -> structured rows (was a raw JSON textarea). The rows serialize back
    // into the SAME hidden [data-key="links"] json input gather() reads, and each row preserves its original extra
    // fields (primary, encrypted, ...) so the round-trip never drops data.
    if (f.kind === 'json' && f.key === 'links') {
      return wrap(this._linksInner(f, value));
    }
    // textarea / json -> .ta
    if (f.kind === 'textarea' || f.kind === 'json') {
      return wrap(`${label}<textarea class="ta" data-key="${f.key}" data-kind="${f.kind}" rows="${f.rows || 3}" placeholder="${esc(f.placeholder || '')}">${esc(v)}</textarea>`);
    }
    // text / date / number -> .inp
    const mono = f.kind === 'date' || f.key === 'slug';
    return wrap(`${label}<input class="inp${mono ? ' mono' : ''}" data-key="${f.key}" data-kind="${f.kind}" type="text" value="${esc(v)}" placeholder="${esc(f.placeholder || '')}" />`);
  }

  // SOW-062 P6: the product links[] editor. One row per link + an Add button + a hidden json input that gather()
  // reads (unchanged contract). _serializeLinks rebuilds the array on every edit, preserving each row's extra fields.
  _linksInner(f, value) {
    let links = [];
    try { links = Array.isArray(value) ? value : (typeof value === 'string' && value ? JSON.parse(value) : []); } catch { links = []; }
    const rows = links.map((l, i) => this._linkRowHtml(l, i)).join('');
    return `<label>Links <span class="hint">· buttons on the product page</span></label>
      <div class="linkrows" data-links>${rows}</div>
      <button class="ebtn addrow" type="button" data-addlink>${PLUS} Add link</button>
      <datalist id="lk-types">${['download', 'product', 'repository', 'github', 'website', 'docs', 'demo'].map((k) => `<option value="${k}"></option>`).join('')}</datalist>
      <input data-key="${f.key}" data-kind="json" type="hidden" value="${esc(JSON.stringify(links))}" />`;
  }

  _linkRowHtml(l = {}, i) {
    const { type, kind, url, label, visibility, ...extra } = l || {};
    const t = esc(type || kind || '');
    const vis = visibility === 'members' ? 'members' : 'public';
    return `<div class="linkrow" data-li="${i}" data-hadvis="${visibility != null ? '1' : '0'}" data-extra="${esc(JSON.stringify(extra))}">
      <div class="lr-top">
        <input class="inp lk-type" list="lk-types" placeholder="type" value="${t}" />
        <input class="inp lk-url" type="text" placeholder="https://" value="${esc(url || '')}" />
        <button class="lr-del" type="button" data-lrdel title="Remove">${TRASH}</button>
      </div>
      <div class="lr-bot">
        <input class="inp lk-label" type="text" placeholder="Button label" value="${esc(label || '')}" />
        <div class="lr-vis" data-lrvis>${['public', 'members'].map((x) => `<button type="button" data-vis="${x}" class="${vis === x ? 'on' : ''}">${x}</button>`).join('')}</div>
      </div>
    </div>`;
  }

  _serializeLinks() {
    const wrap = this.$('[data-links]');
    const hidden = this.$('[data-key="links"]');
    if (!wrap || !hidden) return;
    const links = [];
    wrap.querySelectorAll('.linkrow').forEach((row) => {
      const url = (row.querySelector('.lk-url')?.value || '').trim();
      if (!url) return; // an empty row is not a link
      let extra = {};
      try { extra = JSON.parse(row.dataset.extra || '{}'); } catch { extra = {}; }
      const type = (row.querySelector('.lk-type')?.value || '').trim();
      const label = (row.querySelector('.lk-label')?.value || '').trim();
      const vis = row.querySelector('.lr-vis button.on')?.dataset.vis || 'public';
      const link = {};
      if (type) link.type = type;
      link.url = url;
      if (label) link.label = label;
      // only emit visibility if the user chose members OR the original link carried it (keeps existing PRs clean)
      if (vis === 'members' || row.dataset.hadvis === '1') link.visibility = vis;
      Object.assign(link, extra); // preserve primary / encrypted / any other original field
      links.push(link);
    });
    hidden.value = JSON.stringify(links);
  }

  _wireLinks() {
    const wrap = this.$('[data-links]');
    if (!wrap) return;
    wrap.addEventListener('input', () => this._serializeLinks());
    wrap.addEventListener('click', (e) => {
      const del = e.target.closest('[data-lrdel]');
      if (del) { e.preventDefault(); del.closest('.linkrow')?.remove(); this._serializeLinks(); return; }
      const vb = e.target.closest('.lr-vis button');
      if (vb) { e.preventDefault(); vb.parentElement.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b === vb)); this._serializeLinks(); }
    });
    // sow-175: auto-detect a wordpress.org / github.com URL on blur (not `input`, so this fires once when
    // the author leaves the field rather than re-detecting on every keystroke of a paste). Type is set as a
    // real VALUE, since it is functional (it changes how the page treats the link); label is set only as a
    // PLACEHOLDER, never a value, so an untouched field still serializes as no override -- _serializeLinks()
    // already omits an empty label, and the published page's own linkLabel() default takes over from there.
    // Never overwrites a type or label the author already touched.
    wrap.addEventListener('blur', (e) => {
      const urlEl = e.target.closest?.('.lk-url');
      if (!urlEl) return;
      const row = urlEl.closest('.linkrow');
      const source = detectLinkSource(urlEl.value.trim());
      if (!source) return;
      const typeEl = row.querySelector('.lk-type');
      const labelEl = row.querySelector('.lk-label');
      if (typeEl && !typeEl.value.trim()) {
        typeEl.value = source === 'wordpress' ? 'download' : 'repository';
        this._serializeLinks();
      }
      if (labelEl && !labelEl.value.trim()) {
        labelEl.placeholder = source === 'wordpress' ? 'Download' : 'View on GitHub';
      }
    }, true); // capture: blur does not bubble
    this.$('[data-addlink]')?.addEventListener('click', (e) => {
      e.preventDefault();
      const tmp = document.createElement('div');
      tmp.innerHTML = this._linkRowHtml({}, wrap.children.length);
      const row = tmp.firstElementChild;
      if (row) { wrap.appendChild(row); this._serializeLinks(); row.querySelector('.lk-type')?.focus(); }
    });
  }

  _presetBool(key) { return !!this.preset?.input?.[key]; }
  typeLabel() { return TYPE_LABEL[this.type] || this.type; }

  // SOW-062 P6: keep the status dot color tracking the select value.
  syncStatusDots() {
    this.$$('[data-statuspill]').forEach((p) => {
      const sel = this.$('[data-key="status"]');
      const val = sel ? sel.value : (p.querySelector('[data-statustxt]')?.textContent || '');
      const txt = p.querySelector('[data-statustxt]'); if (txt) txt.textContent = val;
      const d = p.querySelector('.d'); if (d) d.style.background = val === 'published' ? 'var(--s-green)' : 'var(--s-fg-mute)';
    });
  }

  // SOW-062 P6: wire the rail controls (chips add/remove, toggles, the visibility switch, status dots). Each writes
  // back to its hidden [data-key] input so gather()/gatherInput read the same values (no server contract change).
  _wireRail() {
    this.$$('[data-chips]').forEach((box) => {
      const persist = () => { const h = this.$(`input[data-key="${box.dataset.chips}"]`); if (h) h.value = [...box.querySelectorAll('.chip2')].map((c) => c.textContent.trim()).join(', '); };
      box.addEventListener('keydown', (e) => {
        const inp = e.target.closest('input'); if (!inp) return;
        if (e.key === 'Enter' || e.key === ',') {
          e.preventDefault(); const val = inp.value.trim().replace(/,$/, ''); if (!val) return;
          const accent = box.dataset.accent === 'true'; const chip = document.createElement('span');
          chip.className = `chip2 ${accent ? '' : 'chip-neutral'}`; chip.innerHTML = `${esc(val)}<span class="x" data-rm>${X}</span>`;
          inp.before(chip); inp.value = ''; persist();
        }
      });
      box.addEventListener('click', (e) => { const rm = e.target.closest('.chip2 .x'); if (rm) { rm.closest('.chip2').remove(); persist(); } });
    });
    this.$$('.tgl[data-k]').forEach((tg) => tg.addEventListener('click', () => { const on = tg.classList.toggle('on'); tg.setAttribute('aria-checked', on); const cb = this.$(`input[data-key="${tg.dataset.k}"]`); if (cb) cb.checked = on; }));
    this.$$('[data-visswitch]').forEach((sw) => sw.querySelectorAll('.vs-opt').forEach((opt) => opt.addEventListener('click', () => {
      const vis = opt.dataset.vis; sw.dataset.active = vis;
      sw.querySelectorAll('.vs-opt').forEach((o) => o.classList.toggle('on', o.dataset.vis === vis));
      const h = this.$('input[data-key="visibility"]'); if (h) h.value = vis;
      const stub = this.$('[data-stubwrap]'); if (stub) stub.hidden = vis !== 'members';
    })));
    this.$$('[data-key="status"]').forEach((sel) => sel.addEventListener('change', () => this.syncStatusDots()));
    this.syncStatusDots();
  }

  /** Format a value the way fieldHtml does, so showIf can read preset values before the DOM exists. */
  presetStr(value) {
    return value == null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  }

  /** Evaluate a field's `showIf` against a (key)=>string value reader. No showIf => always visible. */
  fieldVisible(f, getVal) {
    const s = f.showIf;
    if (!s) return true;
    return matchesShowIf(s, getVal(s.field));
  }

  /** Recompute conditional fields from the live DOM and toggle their wrappers. */
  syncConditional() {
    const getVal = (k) => {
      const el = this.$(`[data-key="${k}"]`);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
    };
    for (const f of this.fields) {
      if (!f.showIf) continue;
      const wrap = this.$(`.fld[data-fkey="${f.key}"]`);
      if (wrap) wrap.hidden = !this.fieldVisible(f, getVal);
    }
  }

  /** Read raw value for a field key from the rendered inputs (DOM side of the pure gatherInput). */
  rawGetter() {
    return (key, kind) => {
      const el = this.$(`[data-key="${key}"]`);
      if (!el) return undefined;
      if (kind === 'boolean') return el.checked;
      return el.value;
    };
  }

  // SOW-062 P6: two-way bind the inline document header (title/tagline/slug contenteditables) to their hidden
  // [data-key] meta inputs, so gather() -- which reads [data-key] -- stays the single source of truth for publish.
  _bindHeader() {
    this.$$('[data-header]').forEach((el) => {
      const input = this.$(`[data-key="${el.dataset.header}"]`);
      if (!input) return;
      const sync = () => { input.value = el.textContent.trim(); };
      el.addEventListener('input', sync);
      el.addEventListener('blur', sync);
      el.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); }); // single-line header fields
      el.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || ''; if (typeof document !== 'undefined') document.execCommand('insertText', false, t.replace(/\s+/g, ' ').trim()); });
      sync();
    });
  }

  gather() {
    // SOW-062 P6: flush the inline header contenteditables into their [data-key] inputs before reading.
    this.$$('[data-header]').forEach((el) => { const i = this.$(`[data-key="${el.dataset.header}"]`); if (i) i.value = el.textContent.trim(); });
    // Only gather fields that are currently visible, so a hidden conditional field (e.g. a stale image on
    // a prompt whose image-gen target was removed) is never submitted.
    const getVal = (k) => {
      const el = this.$(`[data-key="${k}"]`);
      return el ? (el.type === 'checkbox' ? el.checked : el.value) : '';
    };
    const visible = this.fields.filter((f) => this.fieldVisible(f, getVal));
    return { type: this.type, input: gatherInput(visible, this.rawGetter()), body: this.$('#body')?.value ?? '' };
  }

  out(html, cls = 'muted') {
    const o = this.$('#out');
    if (o) {
      o.className = cls;
      o.innerHTML = html;
    }
  }

  // SOW-062 Phase 6: pick the cheatsheet content for the current type (post maps to the mockup's "article" key).
  cheatData() {
    const key = this.type === 'post' ? 'article' : this.type;
    return MD_CHEAT[key] || MD_CHEAT.article;
  }

  // SOW-062 Phase 6: the "content ID" the MCP server (and every /api content route) addresses is the item's
  // repo-relative path. Copy it to the clipboard so an author can hand it to their agent. Only wired when editing an
  // existing item (a new item has no path yet, so the button is not rendered).
  // SOW-112 v2 (owner-directed): the permalink is a NORMAL editable field in the Details rail, above Short
  // description. Changing it stages like any other edit (Save draft), and the actual rename (move + redirect)
  // happens at the PUBLISH event — no separate rename action, no dialogs.
  permalinkFieldHtml() {
    const typePath = ({ post: 'articles', product: 'products', prompt: 'prompts' })[this.type] || this.type;
    const loaded = this.presetStr(this.preset?.input?.slug) || '';
    const existing = Boolean(this.itemPath);
    const val = this._slugVal ?? loaded;
    const note = existing && val && val !== loaded
      ? `<div class="urlprev">/${esc(typePath)}/${esc(loaded)}/ becomes /${esc(typePath)}/${esc(val)}/ when you publish. The old link redirects, and the discussion, saves, and counts follow.</div>`
      : existing ? `<div class="urlprev">Changing the permalink renames this item when you publish; the old link will redirect.</div>` : '';
    return `<div class="fld"><label>Permalink</label><div class="slugrow"><span class="slugpre">${esc(typePath)}/</span><input id="slugfield" type="text" spellcheck="false" value="${esc(val)}" /></div>${note}</div>`;
  }

  _wirePermalinkField() {
    const input = this.$('#slugfield');
    if (!input) return;
    const typePath = ({ post: 'articles', product: 'products', prompt: 'prompts' })[this.type] || this.type;
    const loaded = this.presetStr(this.preset?.input?.slug) || '';
    input.addEventListener('input', () => {
      const v = String(input.value || '').trim().toLowerCase();
      this._slugVal = v;
      // Mirror into the hidden gather() input + the inline display (the same live mirror on new and existing).
      const mirror = this.$('[data-key="slug"]');
      if (mirror) mirror.value = v;
      const inline = this.root?.querySelector('.doc-slug .slug-val');
      if (inline) inline.textContent = v;
      // The note switches to the concrete old -> new URLs while the value differs from the loaded slug.
      const note = input.closest('.fld')?.querySelector('.urlprev');
      if (note && this.itemPath) {
        note.textContent = v && v !== loaded
          ? `/${typePath}/${loaded}/ becomes /${typePath}/${v}/ when you publish. The old link redirects, and the discussion, saves, and counts follow.`
          : 'Changing the permalink renames this item when you publish; the old link will redirect.';
      }
    });
  }

  async copyContentId() {
    const id = this.itemPath;
    if (!id) return;
    const lbl = this.$('#copyid')?.querySelector('.lbl');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(id);
      if (lbl) { const o = lbl.textContent; lbl.textContent = 'Copied'; setTimeout(() => { lbl.textContent = o; }, 1200); }
    } catch {
      this.out(`Content ID: <code>${esc(id)}</code> (copy it manually)`);
    }
  }

  // SOW-062 Phase 6: the live public URL for a published item (post -> /articles/, product -> /products/,
  // prompt -> /prompts/). Drives the "View Public Entry" button, which is only shown when the item is published.
  publicUrl() {
    const p = this.preset?.input ?? {};
    const slug = this.presetStr(p.slug) || (this.$('[data-header="slug"]')?.textContent || '').trim();
    const base = { post: 'articles', product: 'products', prompt: 'prompts' }[this.type];
    if (!slug || !base) return '';
    return `https://gbti.network/${base}/${slug}/`;
  }

  // SOW-062 Phase 6: the Visual / Markdown doc-view toggle. Visual is the block editor; Markdown is a READ-ONLY
  // projection of the whole body as source (the same #body.value the serializer produces), matching the hi-fi
  // "full document as markdown" panel. It never edits the model, so there is no round-trip parse risk.
  setDocView(mode) {
    const on = mode === 'markdown';
    this.$('.doc')?.classList.toggle('md-view', on);
    const wrap = this.$('#docmdwrap');
    if (wrap) {
      wrap.hidden = !on;
      if (on) { const ta = this.$('#docmd'); if (ta) ta.value = this.$('#body')?.value ?? ''; }
    }
    this.$$('#docview [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
    const md = this.$('#mdref'); if (md) md.hidden = !on; // SOW-062 P6: the cheatsheet button shows only in Markdown view
  }

  // SOW-062 P6: immediate feedback at the toolbar (the #out message sits far down the canvas, so a click read as
  // "no feedback"). _setChip updates the save-chip next to the buttons; _btnBusy spins + disables the button, and
  // returns a restore fn.
  _setChip(html, cls = '') { const c = this.$('#savechip'); if (c) { c.className = 'savechip' + (cls ? ' ' + cls : ''); c.innerHTML = html; } }
  _btnBusy(sel, label) {
    const b = this.$(sel);
    if (!b) return () => {};
    const orig = b.innerHTML;
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.innerHTML = `<span class="spin"></span> ${esc(label)}`;
    return () => { b.disabled = false; b.removeAttribute('aria-busy'); b.innerHTML = orig; };
  }

  // SOW-062 P6: the content has diverged from the loaded/published version -> reveal the Publish button (once).
  _markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    this.$('#publish')?.removeAttribute('hidden');
  }

  async doPublish() {
    const restore = this._btnBusy('#publish', 'Publishing…');
    this._setChip('Publishing…', 'busy');
    this.out('Publishing…');
    try {
      const { type, input, body } = this.gather();
      // SOW-062 P6: the from-the-author note seeds/updates the intro-<slug> comment in the same PR (product/prompt).
      const authorNote = this.$('#authornote')?.value?.trim() || undefined;
      if (this.fields.some((f) => f.key === 'status')) input.status = 'published'; // status is action-driven (no rail dropdown)
      // SOW-062 P6: stamp `updatedAt` so the meta can show last-updated-on-live vs -locally.
      // publishedAt is DELIBERATELY NOT stamped here (owner bug, 2026-08-07). It used to be, so that an edit
      // re-surfaced the item in the publishedAt-sorted feed, but that overwrote the real publication date: a
      // Nov 2025 post edited today claimed to be from today, in the WorkBench list AND on the public site.
      // operations.mjs (publishContent) already sets publishedAt only when it is ABSENT and otherwise preserves
      // the prior value, so a first publish still gets its date and a re-publish keeps it. Resurfacing is now
      // the feed's job: feedTime sorts on the later of publishedAt/updatedAt and the row marks itself Updated.
      if (['post', 'product', 'prompt'].includes(type)) { input.updatedAt = new Date().toISOString(); }
      // publish() already stages to the member's OWN fork first (publishFiles -> commitToBranchOnFork) and opens the
      // network PR FROM that fork branch, so no separate pre-publish saveDraft is needed.
      // SOW-112 v2: `path` names the loaded canonical item; a changed permalink makes this publish a RENAME.
      // SOW-145: a house target publishes to house/ (author stays 'gbti'); the server re-checks superadmin.
      // sow-183: the Author picker (superadmin-only, rendered only for an existing item) -> authorTarget. Sent
      // whenever the field is present, whether or not the pick actually differs from the current owner; the
      // host resolves that diff itself (a same-owner pick is a correctly-detected no-op, same as a re-publish
      // with an unchanged permalink).
      const ownerSel = this.$('#ownerSelect')?.value;
      const authorTarget = ownerSel === 'house' ? { scope: 'house' }
        : ownerSel?.startsWith('member:') ? { scope: 'member', username: ownerSel.slice(7) }
        : undefined;
      const res = await this.client.publish({ type, input, body, authorNote, path: this.itemPath || undefined, scope: this.itemScope === 'house' ? 'house' : undefined, authorTarget });
      this._setChip(`${CHECK} Published`, 'ok');
      this._dirty = false; this.$('#publish')?.setAttribute('hidden', ''); // now live + matches -> nothing to publish
      // SOW-112 QA (owner-directed): the publish-expectation banner appears only AFTER Publish is pressed.
      this._banner(`Publishing is not instant. It opens a pull request that auto-merges, then the site rebuilds, so your change reaches the live edge in about 2 to 3 minutes. Track it in your <b>WorkBench</b> under Pull requests.`);
      const renameNote = res?.renamed ? ` The permalink changed from ${esc(res.renamed.from)} to ${esc(res.renamed.to)}; the old link starts redirecting in about 2 to 3 minutes.` : '';
      const ownerLabel = (o) => (o?.scope === 'house' ? 'House / GBTI Network' : (o?.username || 'a member'));
      const reassignNote = res?.reassigned ? ` This item moved from ${esc(ownerLabel(res.reassigned.from))} to ${esc(ownerLabel(res.reassigned.to))}.` : '';
      this.out(`<span class="tag ok">submitted</span> ${esc(submitAck({ prNumber: res.prNumber, autoMerge: true }))}${renameNote}${reassignNote}`); // SOW-072 P2: consistent ack (esc: out() writes innerHTML)
      if (res?.renamed && this.preset?.input) { this.preset.input.slug = res.renamed.to; } // the view reflects the accepted rename
      if (res?.reassigned && this.preset?.input) { this.preset.input.author = res.reassigned.to.scope === 'house' ? 'gbti' : res.reassigned.to.username; }
      // sow-183: keep itemPath/itemScope live from the Worker's own account of where the item now sits, so a
      // SECOND publish in the same session (no reload) targets the new location rather than the just-deleted
      // old one -- true for either a rename or a reassignment, and a harmless no-op for a plain edit.
      if (res?.path) { this.itemPath = res.path; this.itemScope = res.path.startsWith('house/') ? 'house' : 'member'; }
      this.emit('gbti-published', res);
    } catch (err) {
      this._setChip('');
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      const msg = h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text;
      // SOW-112 QA: the failure must be unmissable — the banner slot goes danger (the bottom status line was
      // repeatedly below the fold, so a failed publish read as "nothing happened").
      this._banner(esc(msg), 'danger');
      this.out(esc(msg), 'danger');
    } finally {
      restore();
    }
  }

  // SOW-112 QA: put a message in the top banner slot. cls '' = info (green), 'warn' = amber, 'danger' = red.
  _banner(html, cls = '') {
    const pb = this.$('#pubbanner');
    if (!pb) return;
    pb.classList.remove('warn', 'danger');
    if (cls) pb.classList.add(cls);
    pb.innerHTML = `${INFO}<span>${html}</span>`;
    pb.hidden = false;
  }

  // SOW-082: Save the current content as a draft on the member's own fork (no PR). Allowed for trial + paid; a
  // trial member's members-only content is refused server-side with a clean upgrade nudge (membership-required).
  // sow-169 phase 4: preview the item as the page it will become, in a new tab.
  //
  // It SAVES first, and that is forced rather than chosen: a new tab cannot read this editor's unsaved
  // in-memory state, and in the extension the editor runs on chrome-extension:// while the preview is
  // gbti.network, so no storage is shared at all. Saving to the draft store is the only mechanism that
  // works identically on both hosts, so the button title says so and the status line repeats it.
  //
  // The tab is opened SYNCHRONOUSLY on the click and its location set after the save resolves, because a
  // window.open() issued after an await is a popup the browser blocks.
  //
  // sow-170 fix: the open must NOT pass 'noopener' -- `window.open('', ..., 'noopener')` returns null (that is
  // what noopener does), so the code could never navigate the tab it opened and fell to a second window.open()
  // after the await, leaving a blank orphan tab beside the preview. We open with a real handle, sever the opener
  // ourselves (the security intent of noopener) and paint a same-origin interstitial so the tab is not a stark
  // blank while the draft saves.
  async doPreview() {
    const slug = String(this.gather()?.input?.slug || '').trim();
    if (!slug) { this.out('Give the item a permalink before previewing it.', 'danger'); return; }
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (tab) {
      try { tab.opener = null; } catch { /* cross-origin, already severed */ }
      try { tab.document.write('<!doctype html><title>Preparing preview</title><body style="margin:0;font:15px/1.5 system-ui,sans-serif;color:#6c6976;background:#faf9fb;display:flex;align-items:center;justify-content:center;height:100vh">Preparing your preview&hellip;</body>'); } catch { /* about:blank not writable */ }
    }
    const restore = this._btnBusy('#preview', 'Saving…');
    this._setChip('Saving…', 'busy');
    try {
      await this.doDraft();
      const url = `https://gbti.network/workbench/preview/?type=${encodeURIComponent(this.type)}&slug=${encodeURIComponent(slug)}`;
      if (tab) tab.location = url;
      else window.open(url, '_blank', 'noopener'); // the synchronous open was popup-blocked: try once directly
      this.out('<span class="tag ok">saved</span> Draft saved and opened in a new tab as a preview.');
    } catch (err) {
      if (tab) tab.close();
      const h = failHint(err);
      this.out(esc(h.text), 'danger');
    } finally {
      restore();
    }
  }

  async doDraft() {
    const restore = this._btnBusy('#draft', 'Saving…');
    this._setChip('Saving…', 'busy');
    this.out('Saving draft…');
    try {
      const { type, input, body } = this.gather();
      if (this.fields.some((f) => f.key === 'status')) input.status = 'draft'; // SOW-062 P6: status is action-driven (no rail dropdown)
      if (['post', 'product', 'prompt'].includes(type)) input.updatedAt = new Date().toISOString(); // SOW-062 P6: last-updated-locally
      const res = await this.client.saveDraft({ type, input, body, path: this.itemPath || undefined }); // SOW-112 v2: a changed permalink stages on the item's own branch
      this._setChip(`${CHECK} Draft saved`, 'ok');
      // A pending rename is a big deal — say so in the top banner too (the bottom status line hides below the fold).
      if (res?.renamed) this._banner(`Draft saved with the pending permalink change: <b>${esc(res.renamed.from)}</b> becomes <b>${esc(res.renamed.to)}</b> when you publish. The old link will redirect.`);
      this.out(res?.renamed
        ? `<span class="tag ok">saved</span> Draft staged on your fork with the pending permalink change (${esc(res.renamed.from)} to ${esc(res.renamed.to)}); the rename happens when you publish.`
        : '<span class="tag ok">saved</span> Draft staged on your fork. Open <b>Drafts</b> to review or publish it.');
      this.emit('gbti-draft-saved', res);
    } catch (err) {
      this._setChip('');
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    } finally {
      restore();
    }
  }

  async doImage(file) {
    if (!file) return;
    const dataBase64 = await fileToBase64(file);
    try {
      // sow-165: co-locate into the item folder so a dropped result image stores as ./images/x (native build).
      const res = await this.client.stageImage({ filename: file.name, dataBase64, itemPath: this.itemPath });
      // If a visible, empty image field is on the form (e.g. a prompt result image), drop the staged path
      // straight into it; otherwise the path is for the author to reference in their body.
      const imgField = this.fields.find((f) => f.kind === 'image');
      const el = imgField && this.$(`[data-key="${imgField.key}"]`);
      const wrap = imgField && this.$(`.field[data-fkey="${imgField.key}"]`);
      if (el && !el.value && wrap && !wrap.hidden) {
        el.value = res.path;
        this.out(`Image staged into <code>${esc(imgField.label || imgField.key)}</code>: <code>${esc(res.path)}</code>`);
      } else {
        this.out(`Image staged: <code>${esc(res.path)}</code> (reference it in your body)`);
      }
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  // SOW-062 P6: the inner of the reframable cover preview -- the image (object-fit:cover) when set, else the
  // striped "no image yet" placeholder. Used by the initial render, doCoverImage, and clearCover.
  _coverFrameInner(url) {
    return url
      ? `<img data-cimg src="${esc(url)}" alt="" />`
      : `<div class="ph">${IMG}<span class="mono">no image yet</span></div>`;
  }

  // SOW-062 P3/P6: stage a picked cover image — drop it into the reframable preview immediately, then stage it and
  // put the returned repo path into the field's hidden input (gather() picks it up like any field).
  async doCoverImage(file, control) {
    if (!file || !control) return;
    const dataUrl = await fileToDataUrl(file);
    const cf = control.querySelector('[data-coverframe]');
    if (cf) { cf.innerHTML = '<img data-cimg alt="" />'; const img = cf.querySelector('[data-cimg]'); if (img) img.src = dataUrl; }
    control.querySelector('[data-cover-clear]')?.removeAttribute('hidden');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Replace image';
    try {
      // sow-165: co-locate into the item folder so the cover stores as the canonical ./images/x (the old
      // per-user path could not be resolved by Astro's image() and broke the site build).
      const res = await this.client.stageImage({ filename: file.name, dataBase64: dataUrl.split(',')[1] || '', itemPath: this.itemPath });
      // Preview the just-staged cover from the local data URL keyed by the stored path; a full re-render
      // otherwise resolves it to a jsDelivr URL that 404s until the PR merges.
      (this._stagedSrc ||= {})[res.path] = dataUrl;
      // sow-174: scoped to data-kind="image" -- the banner control also holds a second [data-key] (the
      // bannerPreset swatch input), and a bare [data-key] would grab whichever comes first in DOM order.
      const el = control.querySelector('[data-key][data-kind="image"]');
      if (el) el.value = res.path;
      this.out(`Cover image staged: <code>${esc(res.path)}</code>`);
      // A picked file supersedes any chosen color preset (resolveHero() prefers an uploaded image either way,
      // but leaving a swatch marked "on" here would misrepresent which one is actually going to render).
      const swatches = control.querySelector('[data-swatches]');
      if (swatches) {
        swatches.querySelectorAll('[data-preset]').forEach((b) => b.classList.remove('on'));
        const presetInput = swatches.querySelector('[data-key="bannerPreset"]');
        if (presetInput) presetInput.value = '';
      }
    } catch (err) {
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    }
  }

  clearCover(control) {
    if (!control) return;
    // sow-174: see the matching note in doCoverImage -- scoped so this never touches the sibling bannerPreset
    // hidden input when the banner control also carries the swatch row.
    const el = control.querySelector('[data-key][data-kind="image"]');
    if (el) el.value = '';
    const cf = control.querySelector('[data-coverframe]');
    if (cf) cf.innerHTML = this._coverFrameInner('');
    control.querySelector('[data-cover-clear]')?.setAttribute('hidden', '');
    const pick = control.querySelector('[data-cover-pick]');
    if (pick) pick.textContent = 'Choose image';
  }
}

/** Normalize a model/target string to lowercase alphanumerics (mirrors client/src/image-models.mjs). */
function normTok(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Evaluate a serializable `showIf` descriptor against a raw dependency value. Currently supports
 * { field, includesModel: [...] }: visible when any comma-separated part of the value matches (by
 * normalized substring) any listed model. Mirrors isImageGenTarget so the UI and the schema agree.
 */
function matchesShowIf(showIf, raw) {
  if (!showIf) return true;
  if (Array.isArray(showIf.includesModel)) {
    const models = showIf.includesModel.map(normTok).filter(Boolean);
    const parts = String(raw ?? '').split(',').map(normTok).filter(Boolean);
    return parts.some((p) => models.some((m) => p.includes(m)));
  }
  return true;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

// SOW-062 P3: the full data: URL (for an immediate cover-image preview before the staged path is published).
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = () => reject(new Error('could not read file'));
    r.readAsDataURL(file);
  });
}

define('gbti-content-editor', GbtiContentEditor);
export { GbtiContentEditor };
