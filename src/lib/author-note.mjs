// sow-219 Phase 2: the from-the-author note, expressed ONCE so the WorkBench preview and the published page
// cannot drift apart the way the article layout and the markdown renderer did.
//
// The published block is rendered by src/components/blog/Comments.astro (the `{intro && ...}` branch). The
// preview renders on the CLIENT from fetched files, so it cannot run an Astro component; what it can share is
// the STRUCTURE. Every class and inline style below was read off that component, and
// test/author-note.test.mjs re-reads the component's source and fails if they diverge.
//
// Two things are deliberately NOT shared, because the preview has no server render behind it:
//   - the edit control (CommentBox) and the "edited / view history" link, which need live comment state
//   - the avatar <img>, which the published page resolves from the profile collection at build time; the
//     preview resolves the same URL from /members-index.json instead, so the picture matches even though the
//     code path does not.

/** The class + style contract of the pinned block, read off Comments.astro. */
export const AUTHOR_NOTE_BLOCK = {
  card: 'card',
  cardStyle: 'padding:24px;border-color:var(--green);background:var(--green-tint)',
  head: 'flex items-center g12',
  eyebrow: 'eyebrow',
  eyebrowStyle: 'color:var(--green-700)',
  eyebrowText: 'From the author',
  name: 'link',
  nameStyle: 'font-weight:700;display:inline-flex',
  body: 'cmt-rich',
  bodyStyle: 'margin-top:14px;color:var(--fg)',
  avatarSize: 44,
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The repo path of an item's intro comment, derived from the item's own content path. Mirrors
 * workbench-client-core.mjs introFolderFor, but works from a PATH rather than a { scope, username }, because
 * that is what the preview has in hand. Returns null for a path that is not member or house content.
 */
export function introPathFor(repoPath, slug) {
  const parts = String(repoPath ?? '').split('/').filter(Boolean);
  if (!slug || parts.length < 2) return null;
  if (parts[0] === 'house') return `house/comments/intro-${slug}.md`;
  if (parts[0] !== 'members') return null;
  return `members/${parts[1]}/comments/intro-${slug}.md`;
}

/**
 * The pinned block as an HTML string. `bodyHtml` is already-rendered markdown and is injected as-is (the
 * caller renders it through the same renderMarkdown the preview body uses); everything else is escaped here.
 */
export function buildAuthorNoteHtml({ name, href, avatarUrl, bodyHtml } = {}) {
  const b = AUTHOR_NOTE_BLOCK;
  const initial = String(name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const avatar = avatarUrl
    ? `<img src="${esc(avatarUrl)}" alt="" width="${b.avatarSize}" height="${b.avatarSize}" class="rounded-full" style="width:${b.avatarSize}px;height:${b.avatarSize}px;object-fit:cover" />`
    : `<span class="rounded-full" style="width:${b.avatarSize}px;height:${b.avatarSize}px;display:inline-flex;align-items:center;justify-content:center;background:var(--ink-3);font-weight:700">${esc(initial)}</span>`;
  return `<article class="${b.card}" style="${b.cardStyle}">`
    + `<div class="${b.head}">`
    + `<a href="${esc(href)}" class="shrink-0">${avatar}</a>`
    + `<div><p class="${b.eyebrow}" style="${b.eyebrowStyle}">${b.eyebrowText}</p>`
    + `<a href="${esc(href)}" class="${b.name}" style="${b.nameStyle}">${esc(name)}</a></div>`
    + `</div>`
    + `<div class="${b.body}" style="${b.bodyStyle}">${bodyHtml ?? ''}</div>`
    + `</article>`;
}
