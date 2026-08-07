// SOW-033: pure classifier for the member workspace PR tab. Maps a pull request + its gate status to a
// member-facing label, reusing the SOW-005 gate vocabulary (interpretGateState: success=mergeable,
// pending=checking, failure=held, error). Node-free so it unit-tests without a DOM.
//
// pr: { number, title, html_url, state?, merged? } (state/merged come from the SOW-033 P4 my-pulls extension;
//   today's open-only list omits them, so an open PR with no status is "Proposed, checking").
// status: { state, meaning, description } from client.prStatus(), or null if not loaded / unreachable.

// SOW-036: the workspace deep-link tab hint. The avatar menu opens workspace.html#tab=<id>; <gbti-workspace>
// reads the hash on connect to open directly on that management tab. Returns a valid tab id, or null when the hash
// carries no/unknown tab (the caller defaults to 'post'). Kept in lockstep with the TABS list in gbti-workspace.
const WORKSPACE_TABS = new Set(['overview', 'post', 'prompt', 'product', 'prs', 'inbox', 'saved', 'subs', 'earnings']); // SOW-085: 'drafts' retired (merged into the content tabs)
export function parseWorkspaceTab(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
  return m && WORKSPACE_TABS.has(m[1]) ? m[1] : null;
}

// SOW-064: the quick-create deep-link. The "+" menu opens workspace.html#new=<type>; <gbti-workspace> reads it on
// connect to open a BLANK content editor for that type (start a new article/prompt/product). Returns a valid
// content type, or null when the hash carries no/unknown new-target.
const WORKSPACE_NEW_TYPES = new Set(['post', 'prompt', 'product']);
export function parseWorkspaceNew(hash) {
  const m = String(hash || '').replace(/^#/, '').match(/(?:^|&)new=([a-z]+)(?:&|$)/);
  return m && WORKSPACE_NEW_TYPES.has(m[1]) ? m[1] : null;
}

// SOW-106 QA fix: the editor deep-link vocabulary, so a refresh restores the open editor. `edit=` carries an
// encoded canonical content path (validated hard: anything off-shape is null, so the hash can never point the
// editor at an arbitrary file); `draft=` carries `<type>:<slug>` for a fork-staged draft.
const EDIT_PATH_RE = /^members\/[a-z0-9][a-z0-9-]*\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$|^members\/[a-z0-9][a-z0-9-]*\/profile\.md$/;

/** Parse `edit=<encoded members path>` from a hash into a validated canonical content path, or null. */
export function parseWorkspaceEdit(hash) {
  const m = /(?:^|[#&])edit=([^&]+)/.exec(String(hash || ''));
  if (!m) return null;
  let path;
  try { path = decodeURIComponent(m[1]); } catch { return null; }
  return EDIT_PATH_RE.test(path) ? path : null;
}

/** Parse `draft=<type>:<slug>` from a hash into { type, slug }, or null. */
export function parseWorkspaceDraft(hash) {
  const m = /(?:^|[#&])draft=(post|product|prompt):([a-z0-9][a-z0-9-]*)/.exec(String(hash || ''));
  return m ? { type: m[1], slug: m[2] } : null;
}

/**
 * SOW-104: decide what a hashchange should do given the current editor/tab state. PURE + testable so the element's
 * _onHash stays a thin dispatcher. A rail nav to a PLAIN tab (no new/edit/draft component) while an editor or
 * review pane is open is an explicit EXIT (matching the Back button); otherwise a #new= opens the editor and a
 * different plain tab switches. Returns { action: 'exit' | 'openNew' | 'switchTab' | 'none', tab?, type? }.
 */
export function planHashRoute(hash, { editing = false, reviewing = false, tab = 'overview' } = {}) {
  const newType = parseWorkspaceNew(hash) || null;
  const edit = parseWorkspaceEdit(hash) || null;
  const draft = parseWorkspaceDraft(hash) || null;
  const tabHash = parseWorkspaceTab(hash) || 'overview';
  if ((editing || reviewing) && !newType && !edit && !draft) return { action: 'exit', tab: tabHash };
  if (newType && !editing && !reviewing) return { action: 'openNew', type: newType };
  if (tabHash !== tab && !editing && !reviewing) return { action: 'switchTab', tab: tabHash };
  return { action: 'none' };
}

/** The content type for a canonical content path (posts -> post), or null (a profile path has no list type). */
export function typeForContentPath(path) {
  const m = /^members\/[a-z0-9][a-z0-9-]*\/(posts|products|prompts)\//.exec(String(path || ''));
  return m ? m[1].slice(0, -1) : null;
}

// SOW-173: the public site route per content type. `post` renders at /articles/ (SOW-136 flattened posts to the
// articles route); products and prompts keep their own directory route. House and member content share these.
const PUBLIC_ROUTE = { post: 'articles', product: 'products', prompt: 'prompts' };

/** SOW-173: the public page path for a published item, as a site-relative `/route/<slug>/`, or null when the
 *  type has no public route or a slug cannot be derived. `type` is the row's content type; `path` is the item's
 *  repo path (`.../<slug>/index.md`). Host-agnostic: the caller prefixes the site origin for the extension. */
export function publicPathFor({ type, path } = {}) {
  const route = PUBLIC_ROUTE[type];
  if (!route) return null;
  const clean = String(path || '').replace(/\/index\.md$/i, '').replace(/\/+$/, '');
  const slug = clean.split('/').filter(Boolean).pop();
  if (!slug || /index\.md$/i.test(slug)) return null;
  return `/${route}/${slug}/`;
}

export function classifyPull(pr = {}, status = null) {
  if (pr.merged === true || pr.state === 'merged') return { label: 'Accepted', tone: 'ok' };
  if (pr.state === 'closed') return { label: 'Declined', tone: 'muted' };
  switch (status?.state) {
    case 'success': return { label: 'Proposed', tone: 'ok' };        // mergeable / auto-merging
    case 'failure': return { label: 'Needs changes', tone: 'bad' };  // held / rejected-not-paid / changes requested
    case 'error': return { label: 'Error', tone: 'bad' };
    default: return { label: 'Proposed', tone: '' };                 // open + pending/unknown (still checking)
  }
}

// SOW-072 P2: the ONE authoring-lifecycle model, layered on classifyPull so every surface (the composer ack, the
// workspace PR tab, the activity bell) speaks the same states AND surfaces a rejection with its reason — never
// silence. Maps a PR + its gate status to:
//   phase: 'pending' (open, checking / awaiting) | 'accepted' (merged, going live) | 'rejected' (closed, not merged)
//          | 'blocked' (open but the gate fails: needs changes / error).
//   label, tone: from classifyPull (the shared five-state vocabulary), with the tone raised to 'bad' whenever the
//          author must act, so a rejection is visibly flagged instead of muted.
//   needsAttention: true when the author should look (rejected/closed, needs-changes, error) -> drives the bell badge.
//   reason: the gate status description (why), or a plain-language fallback for the attention states so the author
//          is never left guessing. Empty for a clean pending/accepted PR. Pure; node-testable.
export function prLifecycle(pull = {}, status = null) {
  const c = classifyPull(pull, status);
  const merged = pull.merged === true || pull.state === 'merged';
  const closed = !merged && pull.state === 'closed';
  let phase;
  if (merged) phase = 'accepted';
  else if (closed) phase = 'rejected';
  else if (c.label === 'Needs changes' || c.label === 'Error') phase = 'blocked';
  else phase = 'pending';
  const needsAttention = phase === 'rejected' || phase === 'blocked';
  const desc = status && typeof status.description === 'string' ? status.description.trim() : '';
  // A CLOSED PR's head-SHA gate status can be a SUCCESS message (the author closed an otherwise-passing PR); that is
  // NOT a close reason, so for 'rejected' surface the gate description only when it is an actual failure/error.
  const descIsReason = phase !== 'rejected' || status?.state === 'failure' || status?.state === 'error';
  const fallback = phase === 'rejected' ? 'This request was closed without merging.'
    : c.label === 'Error' ? 'The membership gate check errored; it will retry.'
    : c.label === 'Needs changes' ? 'The membership gate is holding this until it passes.'
    : '';
  return {
    label: c.label,
    tone: needsAttention ? 'bad' : c.tone,
    phase,
    needsAttention,
    reason: needsAttention ? ((descIsReason && desc) || fallback) : desc,
  };
}

// SOW-072 P2: the ONE submit-acknowledgement copy, so every composer confirms a submission the SAME accurate way.
// The old acks guessed ("it appears after the next build") or named only the PR; this states what actually happens
// (auto-merge makes it fast) and points at the WorkBench, where the PR is tracked and a rejection surfaces with its
// reason. `autoMerge` true = an own-folder paid publish (merges + goes live automatically); false = review-gated.
export function submitAck({ prNumber = null, autoMerge = true } = {}) {
  const pr = prNumber ? ` (PR #${prNumber})` : '';
  return autoMerge
    ? `Submitted${pr}. It merges automatically and appears shortly. Track it in your WorkBench.`
    : `Submitted${pr}. It is awaiting review. Track it in your WorkBench.`;
}

// SOW-072 P3: map a publish/comment FAILURE to consistent author-facing guidance, so every composer reports a
// failure the same accurate way (and points a non-paid member at the upgrade) instead of each surface inventing its
// own copy. Returns { text, upgrade, retryable }. Pure; node-testable.
//   membership-required           -> the publish is paid-only (upgrade, not retryable as-is)
//   not-authenticated/no-identity -> sign in first (not retryable until signed in)
//   invalid-content               -> fix the fields, then retry
//   anything else                 -> a transient error; retryable
export function failHint(err) {
  const code = err?.code || '';
  const msg = err?.message || '';
  if (code === 'membership-required') return { text: msg || 'Publishing to the network requires a paid membership.', upgrade: true, retryable: false };
  if (code === 'not-authenticated' || code === 'no-identity') return { text: 'Sign in with the GBTI client first.', upgrade: false, retryable: false };
  if (code === 'invalid-content') return { text: msg || 'Some fields need fixing before this can publish.', upgrade: false, retryable: true };
  return { text: msg || 'Could not save right now. Please try again.', upgrade: false, retryable: true };
}

// SOW-072 P3: whether the workspace PR tab should KEEP polling a PR's gate status. Only an OPEN, still-checking PR
// (phase 'pending') is worth polling; 'accepted'/'rejected' are terminal, and 'blocked' (needs-changes/error) sits
// until the author acts, so we stop there too (it re-fetches on the next manual load). Pure.
export function shouldPollPr(lifecycle) {
  return lifecycle?.phase === 'pending';
}

// SOW-082: a fork-staged draft's lifecycle state. A draft is identified by its deterministic branch
// gbti/<type>-<slug> on the member's fork; its state joins "branch exists" with the PR (if any) for that branch.
// `pull` is the matched PR ({ state, merged }) or null (no PR yet = still staged on the fork). Reuses classifyPull
// for the PR half. Pure; node-testable.
export function classifyDraft({ pull = null, status = null } = {}) {
  if (!pull) return { state: 'staged', label: 'Staged', tone: '' }; // branch on the fork, no PR opened yet
  const c = classifyPull(pull, status);
  if (c.label === 'Accepted') return { state: 'published', label: 'Published', tone: 'ok' };
  if (c.label === 'Declined') return { state: 'declined', label: 'Declined', tone: 'muted' };
  // an open PR: it has been submitted to the network and is moving through the gate
  return { state: 'review', label: c.label === 'Proposed' ? 'Submitted' : c.label, tone: c.tone };
}

// SOW-085: the WorkBench content-list controls (sort + published/draft filter + the per-type content/drafts
// merge). All PURE + node-testable; the element applies sortItems -> filterByStatus -> its existing 15/page slice.

/** The folder slug for a content or draft item (from its canonical path, else its slug/pendingSlug). Lowercased. */
function slugOf(x) {
  const m = String(x?.path || '').match(/\/([^/]+)\/index\.md$/);
  return String((m && m[1]) || x?.slug || x?.pendingSlug || '').toLowerCase();
}

/** The valid sort modes + the default. `sortModeFor` mirrors newtab-prefs `viewModeFor` (a valid stored value
 *  wins, else the default) so the element can persist the choice with one localStorage key. */
export const SORT_MODES = new Set(['newest', 'oldest', 'updated', 'title-asc', 'title-desc']);
export const DEFAULT_SORT = 'newest';
export const WORKSPACE_SORT_KEY = 'gbti-wb-sort'; // one device-local sort pref shared across the content tabs
export function sortModeFor(stored) {
  return SORT_MODES.has(stored) ? stored : DEFAULT_SORT;
}

// SOW-145: the WorkBench content SCOPE. 'member' lists the caller's own members/<username>/ folder (the default,
// and the ONLY scope a non-superadmin ever gets); 'house' lists the non-member house/ folder (a superadmin
// surface). Persisted device-local like the sort pref.
export const SCOPE_MODES = new Set(['member', 'house']);
export const DEFAULT_SCOPE = 'member';
export const WORKSPACE_SCOPE_KEY = 'gbti-wb-scope';

/**
 * Resolve the active content scope. A non-superadmin is ALWAYS 'member' (the toggle is hidden and this is the
 * client mirror of the server-side house gate). For a superadmin: a valid stored pref wins; with no stored pref,
 * default to 'member' UNLESS their personal content count is 0 (then 'house', so a superadmin whose member
 * folder is empty — e.g. gbtilabs, who owns only house content — lands on the house articles on first open).
 * @param {string|null} stored     the persisted pref (localStorage), or null.
 * @param {{ personalCount?: number, role?: string }} ctx
 */
export function scopeFor(stored, { personalCount = 0, role = 'member' } = {}) {
  if (role !== 'superadmin') return 'member';
  if (SCOPE_MODES.has(stored)) return stored;
  return Number(personalCount) > 0 ? 'member' : 'house';
}

/**
 * Sort a content list (a copy; the input is not mutated). A dateless item (a fork-staged draft carries no
 * publishedAt) sorts as the NEWEST (top for Newest, bottom for Oldest) so in-progress work stays visible; the
 * title is the stable tiebreak. `newest` (default) = publishedAt desc.
 *
 * 2026-08-07: `updated` is a SEPARATE mode sorting on updatedAt desc. Until now the two were indistinguishable
 * because publishing re-stamped publishedAt to now, so "Newest" silently meant "most recently touched" and an
 * old edited post outranked a genuinely new one. The editor no longer re-stamps publishedAt, so "Newest" means
 * first published and this mode is how you ask for recently-touched on purpose. An item with no updatedAt
 * falls back to its publishedAt rather than sorting as dateless, so a never-edited item still ranks by when it
 * actually appeared instead of jumping to the top.
 */
export function sortItems(items, sort = DEFAULT_SORT) {
  const list = Array.isArray(items) ? [...items] : [];
  const byTitle = (a, b) => String(a?.title || '').localeCompare(String(b?.title || ''), undefined, { sensitivity: 'base' });
  const dateOf = (x) => (Number.isFinite(x?.publishedAt) ? x.publishedAt : Infinity); // dateless -> newest
  const touchedOf = (x) => (Number.isFinite(x?.updatedAt) ? x.updatedAt : dateOf(x));
  switch (sort) {
    case 'oldest': return list.sort((a, b) => (dateOf(a) - dateOf(b)) || byTitle(a, b));
    case 'updated': return list.sort((a, b) => (touchedOf(b) - touchedOf(a)) || byTitle(a, b));
    case 'title-asc': return list.sort(byTitle);
    case 'title-desc': return list.sort((a, b) => byTitle(b, a));
    case 'newest':
    default: return list.sort((a, b) => (dateOf(b) - dateOf(a)) || byTitle(a, b));
  }
}

/** Filter by publish state: 'all' (everything), 'published' (status published), 'draft' (anything NOT published). */
export function filterByStatus(items, status = 'all') {
  const list = Array.isArray(items) ? items : [];
  if (status === 'published') return list.filter((x) => x?.status === 'published');
  if (status === 'draft') return list.filter((x) => x?.status !== 'published');
  return list;
}

/**
 * Merge a type's canonical content (listContent) with its fork-staged drafts (listDrafts), deduped by folder
 * slug. A fork draft whose slug matches a canonical item is that item's STAGED EDIT: it is dropped here (the
 * canonical row represents it, with the element's existing "staged edits" chip). A fork draft with no canonical
 * match is a NEW item and is kept, flagged `isDraft: true` so the element renders it as a draft row.
 */
export function mergeTypeItems(content = [], drafts = []) {
  const canon = new Set((Array.isArray(content) ? content : []).map(slugOf).filter(Boolean));
  const extra = (Array.isArray(drafts) ? drafts : [])
    .filter((d) => { const s = slugOf(d); return !s || !canon.has(s); })
    .map((d) => ({ ...d, isDraft: true }));
  return [...(Array.isArray(content) ? content : []), ...extra];
}
