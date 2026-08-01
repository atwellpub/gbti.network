// sow-158 Phase 3a: the website WorkBench client adapter. A FRESH thin implementation of the GbtiClient contract
// (client-ui/src/client.mjs) that talks to the signup Worker over the httpOnly-cookie session (Phase 1b/2) instead
// of a bearer token. It is HOSTED-ONLY by construction: it never forks, never installs, and never holds a GitHub
// token. Every publish rides the SOW-156/157 hosted-authoring path (POST /membership/author), which commits to a
// hosted/<github_id>/<itemId> branch on the canonical repo with GBTI's App INSTALLATION token and opens the
// SOW-005-gated auto-merging PR. The token NEVER enters the page: writes carry only `credentials:'include'` plus
// the non-secret gbti_csrf echo (double-submit CSRF), reads carry `credentials:'include'` alone.
//
// Scope (the ~15 methods gbti-workspace + gbti-content-editor actually call): status, listContent, getContentItem,
// readItem, validateContent (pure), formFields (pure), preview (pure), publish, saveDraft, listDrafts, readDraft,
// discardDraft, publishDraft, setContentStatus, decrypt, listPRs, prStatus. Everything else the components call is
// OPTIONAL-CHAINED there (getActivity, getFollows, listContributions, listComments, admin, ...), so its absence
// degrades gracefully to an empty state — deferred to a later phase per the SOW.
//
// Now live on the web (earlier phases): members-only PUBLISH (via the cookie /membership/encrypt), IMAGE upload
// (binary base64 entries), and PERMALINK RENAME (rename-at-publish, SOW-112 v2 — a changed permalink field makes
// the publish a rename: the new path + the old-path deletes + redirectFrom in ONE hosted PR). Still refused:
//   - HOUSE scope: house content publishes through fork mode (operations re-checks superadmin server-side).

import { buildContentFile, buildCommentFile, buildShareFile, shareId as makeShareId, flipContentStatus, parseContentFile, commentId } from '../../client/src/content-ops.mjs';
import { fieldsFor } from '../../client/src/form-fields.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';
import { canPublish, canStageDrafts } from '../../client/src/membership.mjs';
import { memberContent } from '../../client-ui/src/member-view-core.mjs';
import { planMemberFiles, reassembleMemberBody, filterThreadComments, coerceCommentInput, favoritedFrom, COMMENT_TARGET_TYPES, MEMBER_READ_TIER, sanitizeImageName, referencedImagePaths, base64Bytes, renameOriginOf, mergedRedirectFrom, renameIntroMoveFiles } from './workbench-client-core.mjs';

const MAX_IMAGE_BYTES = 1_048_576; // 1 MB, matching the Worker gate + check-media
const TYPE_INDEX: Record<string, string> = { post: 'blog-index.json', product: 'products-index.json', prompt: 'prompts-index.json' };
const TYPE_LABEL: Record<string, string> = { post: 'article', product: 'product', prompt: 'prompt', profile: 'profile' };
// members/<user>/<posts|products|prompts>/<slug>/index.md -> { type, slug }. Mirrors the folder->type mapping.
const FOLDER_TYPE: Record<string, string> = { posts: 'post', products: 'product', prompts: 'prompt' };
const PATH_RE = /^members\/[^/]+\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;

/** A GbtiClientError-shaped error (code + message) so the editor's failHint reads it exactly like the other hosts. */
class WorkbenchClientError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'WorkbenchClientError';
    this.code = code;
  }
}
const err = (code: string, message?: string) => new WorkbenchClientError(code, message);

/** The hosted item id (the branch's last segment; the Worker prefixes it with the verified github_id). Mirrors
 *  hosted-publish.mjs hostedItemId so a re-publish of the same item reuses one branch + PR. */
function hostedItemId(type: string, slug: string | null): string {
  return type === 'profile' ? 'profile' : `${type}-${slug}`;
}

function parseContentPath(path: string): { type: string; slug: string } | null {
  const m = PATH_RE.exec(String(path || ''));
  if (!m) return null;
  return { type: FOLDER_TYPE[m[1]], slug: m[2] };
}

/** Read the non-HttpOnly gbti_csrf cookie for the double-submit header (mirrors member-signal.ts). */
function readCsrf(): string | null {
  if (typeof document === 'undefined') return null;
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === 'gbti_csrf') return part.slice(eq + 1).trim() || null;
  }
  return null;
}

/** Seed the from-the-author intro comment (product/prompt) in the SAME publish PR, so the gate's diff-scoped
 *  intro check passes. Deterministic id (intro-<slug>): a re-publish updates the same comment. Mirrors
 *  operations.buildIntroCommentFile. Returns a { path, content } file, or null. */
function buildIntroFile(username: string, built: any, authorNote: string | undefined): { path: string; content: string } | null {
  const note = String(authorNote ?? '').trim();
  if (!note || !built?.slug || !['product', 'prompt'].includes(built.type)) return null;
  const intro = buildCommentFile({
    username,
    scope: 'member',
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: new Date().toISOString(),
      status: 'published',
      visibility: 'public',
      authorNote: true,
    },
    body: note,
  });
  return { path: intro.path, content: intro.markdown };
}

/** Map one KV draft record ({ type, slug, path, frontmatter, body, updatedAt }) to the workspace's list-item
 *  shape (mergeTypeItems + classifyDraft + the draft row read these). pull:null -> classifyDraft 'Staged'. */
function mapDraftRecord(rec: any) {
  const fm = (rec && rec.frontmatter) || {};
  return {
    type: rec?.type,
    slug: rec?.slug,
    pendingSlug: rec?.pendingSlug ?? null,
    title: fm.title || rec?.slug || '',
    path: rec?.path || null,
    status: fm.status || 'draft',
    visibility: fm.visibility || 'public',
    frontmatter: fm,
    body: rec?.body || '',
    pull: null,
    publishedAt: fm.publishedAt ? Number(fm.publishedAt) : null,
    updatedAt: rec?.updatedAt || null,
  };
}

/**
 * Build the website WorkBench client.
 * @param signupBase the signup Worker origin (stamped on <html data-signup-base> by BaseLayout).
 * @param login the signed-in member's GitHub login (the folder username; drives the own-content filter).
 * @param githubId the signed-in member's immutable id (fallback identity; the session cookie is authoritative).
 */
export function createWorkbenchClient({ signupBase, login, githubId = null }: { signupBase: string; login: string; githubId?: string | null }) {
  const base = String(signupBase || '').replace(/\/$/, '');
  const user = String(login || '');
  // sow-158 image upload: staged image binaries (base64), keyed by their own-folder repo path. stageImage fills
  // this; publish() flushes the ones the content actually references into the SAME author PR, so the image + the
  // .md land atomically and the path resolves on merge. Held in memory (a save-draft-then-reload re-picks).
  const pendingImages = new Map<string, string>();

  async function parseJson(res: Response) {
    let json: any = null;
    try { json = await res.json(); } catch { json = null; }
    if (!res.ok) throw new WorkbenchClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
    return json;
  }
  // Worker GET over the cookie session (credentials ride the httpOnly gbti_session; no token, no CSRF on GET).
  async function workerGet(path: string) {
    return parseJson(await fetch(base + path, { credentials: 'include' }));
  }
  // Worker POST over the cookie session: credentials + the double-submit X-GBTI-CSRF header (resolveIdentity gates).
  async function workerPost(path: string, body: unknown) {
    const csrf = readCsrf();
    return parseJson(await fetch(base + path, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
      body: JSON.stringify(body),
    }));
  }
  // sow-158 News: a status-aware GET for the news read routes. <gbti-news> drives its view from the ERROR CODE
  // (not-authenticated -> sign-in nudge, membership-required -> locked nudge, else the feed), so map the HTTP
  // status to those codes (mirrors operations.mapNewsErr). A signed-in member gets 200 -> the feed renders.
  async function newsGet(path: string) {
    const res = await fetch(base + path, { credentials: 'include' });
    if (res.status === 401) throw err('not-authenticated', 'Sign in to read the news.');
    if (res.status === 403) throw err('membership-required', 'News is a members-only perk.');
    return parseJson(res);
  }
  // A same-origin build-artifact index JSON (public, no credentials needed).
  async function sameOriginJson(path: string) {
    const res = await fetch(path, { credentials: 'same-origin' });
    if (!res.ok) throw err(`http-${res.status}`, `could not load ${path}`);
    return res.json();
  }

  async function readOwnFile(path: string): Promise<string | null> {
    const r = await workerGet(`/membership/file?path=${encodeURIComponent(path)}&ref=main`);
    return r?.text ?? null;
  }

  // The core publish: build the file set from PURE builders and POST it to the hosted-authoring endpoint.
  // sow-158 permalink rename (SOW-112 v2, owner-directed rename-at-publish): `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs makes this publish a RENAME (one hosted PR: the new path,
  // the old path + old .enc deleted, the old URL in redirectFrom so the build 301s, the intro moved). Even without
  // a slug change the old file's redirectFrom is merged in (a plain re-publish used to DROP it). Mirrors the
  // isHostedCtx branch of client/src/operations.mjs publish(); the website is hosted-only, so the fork dance does
  // not apply (the hosted branch is always fresh-based on live main).
  async function publish({ type, input = {}, body = '', authorNote, path, scope }: any) {
    if (scope === 'house' || String(path || '').startsWith('house/')) {
      throw err('bad-request', 'House content is published from the browser extension for now.');
    }
    // Resolve the rename origin (the own item the editor loaded) and read its frontmatter for the redirectFrom
    // merge, the publishedAt preservation, and the old .enc path.
    const origin = renameOriginOf({ path, username: user, type });
    let oldFm: any = null;
    if (origin) {
      const oldText = await readOwnFile(origin.oldPath);
      if (oldText != null) { try { oldFm = parseContentFile(oldText).frontmatter ?? {}; } catch { oldFm = null; } }
    }
    const renaming = Boolean(oldFm) && typeof input?.slug === 'string' && input.slug !== origin!.oldSlug;
    const effInput: any = { ...input };
    const redirects = mergedRedirectFrom({ oldFm, inputRedirectFrom: input?.redirectFrom, renaming, type, oldSlug: origin?.oldSlug });
    if (redirects) effInput.redirectFrom = redirects;
    // A rename must not re-stamp publishedAt (feeds stay stable; the item is not new). The editor stamps it on
    // every publish, so restore the original for the rename case only.
    if (renaming && oldFm?.publishedAt) effInput.publishedAt = oldFm.publishedAt;

    let built: any;
    try {
      built = buildContentFile({ type, username: user, input: { ...effInput, status: effInput.status || 'published' }, body, scope: 'member' });
    } catch (e: any) {
      throw new WorkbenchClientError('invalid-content', e?.message || 'the content is invalid');
    }
    if (renaming) {
      // The new path must not already exist (the CI unique-slug guard is the backstop).
      const collision = await readOwnFile(built.path);
      if (collision != null) throw err('bad-request', `the permalink "${built.slug}" is already taken`);
    }
    // SOW-016 / Phase 3c: a whole-item members body OR a `<!-- members-only -->` section is encrypted to a sibling
    // .enc (via the cookie /membership/encrypt), and index.md keeps only the public teaser + the encryptedBody
    // pointer. planMemberFiles overrides any stale encryptedBody with the deterministic path, so a re-publish
    // overwrites the same .enc (no orphan). On a rename it writes the NEW-slug .enc; the OLD one is deleted below.
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files: Array<{ path: string; content?: string | null; contentBase64?: string }> = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    const intro = buildIntroFile(user, built, authorNote);
    if (intro) files.push(intro);
    // sow-158 image upload: flush the pending images this item references into the same PR (binary base64 entries
    // the Worker commits raw). Only referenced uploads ride along; each is removed from the pending set once queued.
    for (const p of referencedImagePaths(built.frontmatter, user)) {
      const b64 = pendingImages.get(p);
      if (b64) { files.push({ path: p, contentBase64: b64 }); pendingImages.delete(p); }
    }
    // Rename cleanup: delete the old index.md + old .enc, and move the from-the-author intro (product/prompt),
    // all in the same PR. Fail closed if the original vanished from main (never a half-move).
    if (renaming) {
      const onMain = (await readOwnFile(origin!.oldPath)) != null;
      if (!onMain) throw err('bad-request', 'the original item could not be found on the network; refresh and try the rename again');
      files.push({ path: origin!.oldPath, content: null });
      if (typeof oldFm?.encryptedBody === 'string' && oldFm.encryptedBody) files.push({ path: oldFm.encryptedBody, content: null });
      if (!intro) {
        const oldIntroText = await readOwnFile(`members/${user}/comments/intro-${origin!.oldSlug}.md`);
        files.push(...renameIntroMoveFiles({ username: user, type, oldSlug: origin!.oldSlug, newSlug: built.slug, introText: oldIntroText }));
      } else {
        const oldIntro = `members/${user}/comments/intro-${origin!.oldSlug}.md`;
        if ((await readOwnFile(oldIntro)) != null) files.push({ path: oldIntro, content: null });
      }
    }
    const title = `Publish ${TYPE_LABEL[built.type] || built.type}: ${built.frontmatter?.title || built.slug || user}`;
    const itemId = hostedItemId(built.type, renaming ? origin!.oldSlug : built.slug);
    const res = await workerPost('/membership/author', { itemId, files, title });
    return {
      prNumber: res.number, prUrl: res.html_url, branch: res.branch, updated: !!res.already, hosted: true,
      encrypted: Boolean(plan?.encPath), ...(renaming ? { renamed: { from: origin!.oldSlug, to: built.slug } } : {}),
    };
  }

  async function discardDraft({ type, slug }: any) {
    await workerPost('/membership/drafts', { op: 'delete', type, slug });
    return { ok: true };
  }

  // Read an own `.enc` asset and decrypt it via the Worker (the key stays in the Worker). Returns the plaintext.
  async function decryptEnc(encPath: string): Promise<string> {
    const text = await readOwnFile(encPath);
    if (text == null) throw err('not-found', 'could not read that asset');
    let envelope: any;
    try { envelope = JSON.parse(text); } catch { throw err('undecryptable', 'the asset envelope is invalid'); }
    const r = await workerPost('/membership/decrypt', envelope);
    return r.text;
  }

  // sow-158 Phase 3c: read an own content item and reassemble its FULL authoring body. index.md holds only the
  // public part (Mode C) or an empty body (Mode A/B) — the gated text is in the sibling .enc. When encryptedBody is
  // set, decrypt it and re-join via the pure reassembleMemberBody, so the editor shows everything and a re-publish
  // re-splits identically. FAIL CLOSED: if the decrypt fails on an item that HAS an .enc, throw rather than open the
  // editor on a partial body (a re-save from a partial body would drop the members section).
  async function readAndReassemble(path: string) {
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'could not load that item');
    const { frontmatter, body } = parseContentFile(text);
    const enc = (frontmatter as any)?.encryptedBody;
    if (!enc) return { path, frontmatter, body };
    let memberText: string;
    try { memberText = await decryptEnc(enc); }
    catch { throw err('locked', 'could not load the members-only section of this item; refresh and try again'); }
    return { path, frontmatter, body: reassembleMemberBody(frontmatter, body, memberText) };
  }

  // sow-158 Phase 3b: the cookie twin of member-content.mjs encryptViaWorker. POSTs plaintext to the now-cookie-
  // enabled /membership/encrypt (credentials + CSRF); the AES key never comes back. A 401/403 (not effective-paid)
  // surfaces as the membership-required nudge through workerPost's throw.
  async function encryptViaCookie(plaintext: string, assetId: string) {
    const r = await workerPost('/membership/encrypt', { plaintext, assetId });
    if (!r || r.ok !== true || !r.envelope) throw err('encrypt-failed', 'the comment could not be encrypted');
    return r.envelope;
  }

  // Build + publish one comment file set (post or edit). Mirrors operations.publishComment/editComment: a members
  // body is encrypted to a sibling .enc (planMemberFiles) and the stub .md carries only the pointer; a public
  // author-note intro is committed plaintext. Both files live under members/<login>/, which the hosted validator
  // permits, and ride the own-folder-gated /membership/author (idempotent per comment-<id> item).
  async function commitComment(input: any, body: string) {
    let built: any;
    try { built = buildCommentFile({ username: user, input, body }); }
    catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the comment is invalid'); }
    const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
    const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
    const res = await workerPost('/membership/author', { itemId: `comment-${built.id}`, files, title: `Comment on ${input.targetType}: ${input.targetSlug}` });
    return { id: built.id, path: built.path, prNumber: res.number, prUrl: res.html_url, visibility: built.frontmatter.visibility, encrypted: Boolean(plan?.encPath) };
  }

  // Read one of the member's OWN comments (frontmatter + decrypted body), for the edit-form prefill. A members
  // comment stores its body in the .enc, so decrypt it or an edit would start blank and overwrite the gated text.
  async function getCommentLocal(id: string) {
    const path = `members/${user}/comments/${id}.md`;
    const text = await readOwnFile(path);
    if (text == null) throw err('not-found', 'no such comment in your folder');
    const { frontmatter, body } = parseContentFile(text);
    const enc = (frontmatter as any)?.encryptedBody;
    return { path, frontmatter, body: enc ? await decryptEnc(enc) : body };
  }

  // The caller's effective tier (for the SOW-078 member-stub read gate), fail-closed to a non-member on any error.
  async function currentTier(): Promise<string> {
    try { const p = await workerGet('/membership/status'); return typeof p?.status === 'string' ? p.status : 'none'; }
    catch { return 'none'; }
  }

  // A discussion thread from the same-origin comments index (public bodies inline, member rows pointer-only),
  // filtered to the target (+ rename aliases), oldest-first. A non-member viewer sees only the public rows.
  async function listCommentsLocal({ targetType, targetSlug, limit, aliases }: any = {}) {
    if (!COMMENT_TARGET_TYPES.has(targetType) || !targetSlug) return { items: [] };
    let all: any[] = [];
    try { all = (await sameOriginJson('/comments-index.json'))?.items ?? []; } catch { return { items: [] }; }
    const canSeeMembers = MEMBER_READ_TIER.has(await currentTier()); // SOW-078: gate the member stubs by tier
    return { items: filterThreadComments(all, { targetType, targetSlug, aliases, limit, canSeeMembers }) };
  }

  return {
    // ----- identity + read -----
    async status() {
      let payload: any = null;
      try { payload = await workerGet('/membership/status'); } catch { payload = null; }
      // sow-158 follow-up: prefer the oracle's effectiveStatus (ban>staff>grandfather>Stripe, folded server-side)
      // + role, which the static site cannot derive itself. So a staff/grandfathered member reads as paid and
      // staff surfaces the role for the admin gate. Falls back to the raw Stripe status for an older Worker.
      const membership = typeof payload?.effectiveStatus === 'string' ? payload.effectiveStatus
        : (typeof payload?.status === 'string' ? payload.status : 'unknown');
      const role = typeof payload?.role === 'string' && payload.role ? payload.role : 'member';
      const lg = payload?.login || user;
      const gid = payload?.github_id != null ? String(payload.github_id) : githubId;
      return {
        authenticated: payload?.ok === true,
        membership,
        role,
        canPublish: canPublish(membership),
        canStageDrafts: canStageDrafts(membership),
        couponUntil: payload?.couponUntil ?? null,
        identity: { login: lg, githubId: gid },
        login: lg,
        username: lg,
        githubId: gid,
      };
    },

    // Own + house content is fetched from the same-origin public per-type index (published items only), filtered
    // to the member's own folder. Drafts + members-only-A items are surfaced separately (listDrafts / the locked
    // card), matching the website's tokenless read reach.
    async listContent({ type, scope }: any = {}) {
      if (scope === 'house') return { items: [] }; // house listing is extension-only (the server re-checks superadmin)
      const json = TYPE_INDEX[type];
      if (!json) return { items: [] }; // profile + unknown types have no public index
      let raw: any = null;
      try { raw = await sameOriginJson('/' + json); } catch { return { items: [] }; }
      const items = memberContent(Array.isArray(raw?.items) ? raw.items : [], user, 9999).map((it: any) => ({ ...it, status: 'published' }));
      return { items };
    },

    getContentItem({ path }: any) { return readAndReassemble(path); },
    // SOW-031 reader parity: read any own published item (same source as getContentItem for the WorkBench).
    readItem({ path }: any) { return readAndReassemble(path); },

    // ----- pure form/preview/validate (no network) -----
    formFields({ type }: any) { return { type, fields: fieldsFor(type) || [] }; },
    preview({ body }: any) { return { html: renderMarkdown(body ?? '') }; },
    validateContent({ type, input, body }: any) {
      try {
        const built = buildContentFile({ type, username: user, input, body });
        return { valid: true, path: built.path };
      } catch (e: any) {
        return { valid: false, error: e?.message, issues: e?.issues };
      }
    },

    // ----- authoring -----
    publish,
    async saveDraft({ type, input = {}, body = '', path }: any) {
      // A members-only draft is allowed: its plain body stays in the private, erasable KV draft store (SOW-157),
      // never git; publishDraft() encrypts it at publish time. So no members refusal here.
      const slug = String((input && input.slug) || '');
      await workerPost('/membership/drafts', { op: 'put', draft: { type, slug, path: path || null, frontmatter: input, body } });
      return { state: 'staged' };
    },
    async listDrafts({ type }: any = {}) {
      const r = await workerGet('/membership/drafts');
      let drafts = (Array.isArray(r?.drafts) ? r.drafts : []).map(mapDraftRecord);
      if (type) drafts = drafts.filter((d: any) => d.type === type);
      return { drafts };
    },
    async readDraft({ type, slug }: any) {
      const r = await workerGet('/membership/drafts');
      const rec = (Array.isArray(r?.drafts) ? r.drafts : []).find((d: any) => d.type === type && d.slug === slug);
      if (!rec) throw err('not-found', 'could not open that draft');
      return { frontmatter: rec.frontmatter || {}, body: rec.body || '', path: rec.path || '' };
    },
    discardDraft,
    async publishDraft({ type, slug }: any) {
      const r = await workerGet('/membership/drafts');
      const rec = (Array.isArray(r?.drafts) ? r.drafts : []).find((d: any) => d.type === type && d.slug === slug);
      if (!rec) throw err('not-found', 'could not find that draft');
      const res = await publish({ type, input: rec.frontmatter || {}, body: rec.body || '', path: rec.path || undefined });
      await discardDraft({ type, slug }).catch(() => {}); // best-effort: the draft is now a submitted PR
      return { prNumber: res.prNumber, prUrl: res.prUrl };
    },
    // SOW-106: member self-unpublish/republish — flip status on the own canonical item via the gated hosted PR.
    async setContentStatus({ path, status }: any) {
      const parsed = parseContentPath(path);
      if (!parsed) throw err('bad-request', 'unsupported content path');
      const text = await readOwnFile(path);
      if (text == null) throw err('not-found', 'could not read that item');
      const flip = flipContentStatus(text, status);
      if (!flip.changed) return { noop: true };
      const title = `${status === 'draft' ? 'Unpublish' : 'Republish'} ${TYPE_LABEL[parsed.type] || parsed.type}: ${parsed.slug}`;
      const res = await workerPost('/membership/author', { itemId: hostedItemId(parsed.type, parsed.slug), files: [{ path, content: flip.content }], title });
      return { prNumber: res.number, prUrl: res.html_url };
    },

    // ----- pull requests (read via the Worker's installation-token proxy, scoped to the caller) -----
    async listPRs() {
      const r = await workerGet('/membership/my-pulls');
      return { prs: Array.isArray(r?.items) ? r.items : [] }; // the Worker returns { items }; the components read { prs }
    },
    prStatus({ number }: any) { return workerGet(`/membership/pr-status?number=${encodeURIComponent(number)}`); },

    // ----- SOW-018 Shares: post (members-default, encrypted) + read the tier-gated community stream -----
    // Post a Share through the SAME hosted-authoring PR path as content. A members share (the composer's default
    // visibility) encrypts its whole body to a sibling .enc via the cookie /membership/encrypt; the stub .md
    // carries only the pointer. Mirrors operations.publishShare. Returns the PR handle the composer's ack reads.
    async postShare({ input = {}, body = '' }: any) {
      const createdAt = new Date().toISOString();
      const id_ = (input && input.id) || makeShareId(createdAt, input?.title);
      let built: any;
      try { built = buildShareFile({ username: user, input: { ...input, id: id_, createdAt }, body }); }
      catch (e: any) { throw new WorkbenchClientError('invalid-content', e?.message || 'the share is invalid'); }
      const plan = await planMemberFiles({ built, body, encrypt: encryptViaCookie });
      const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
      const title = `New Share${built.frontmatter?.title ? `: ${built.frontmatter.title}` : ''}`;
      const res = await workerPost('/membership/author', { itemId: `share-${id_}`, files, title });
      return { id: id_, path: built.path, visibility: built.frontmatter?.visibility ?? 'members', encrypted: Boolean(plan?.encPath), prNumber: res.number, prUrl: res.html_url, updated: !!res.already };
    },
    // The community Shares stream, tier-gated server-side (paid/trial see members + public; else public only).
    // Members bodies arrive pointer-only (encryptedBody); <gbti-shares-feed> decrypts on expand via decrypt().
    async listShares({ limit, before }: any = {}) {
      const qs = new URLSearchParams();
      if (limit) qs.set('limit', String(limit));
      if (before) qs.set('before', String(before));
      const r = await workerGet('/membership/shares' + (qs.toString() ? `?${qs.toString()}` : ''));
      return { items: Array.isArray(r?.items) ? r.items : [], nextBefore: r?.nextBefore ?? null, canSeeMembers: r?.canSeeMembers ?? false };
    },

    // ----- sow-161 admin surface (read): the per-member Stripe status map for the dashboard roster. Admin-gated
    // server-side over the cookie session (authorizeAdmin + allowCookie); a non-admin session 403s. -----
    adminStatuses() { return workerGet('/membership/admin/statuses'); }, // { ok, statuses: { <github_id>: '<status>' } }

    // ----- SOW-043/046: interactive News over the cookie session (free-tier perk; authorizeSignedIn) -----
    getNews({ category, since, limit }: any = {}) {
      const qs = new URLSearchParams();
      if (category) qs.set('category', String(category));
      if (since) qs.set('since', String(since));
      if (limit) qs.set('limit', String(limit));
      return newsGet('/membership/news' + (qs.toString() ? `?${qs.toString()}` : ''));
    },
    getNewsSources() { return newsGet('/membership/news-sources'); },
    getNewsCategories() { return newsGet('/membership/news-categories'); },
    // Best-effort engagement beacons (the reader ignores their failures); cookie POST -> CSRF via workerPost.
    newsOpened({ guid, source }: any = {}) { return workerPost('/membership/news-opened', { guid, ...(source ? { source } : {}) }); },
    newsDiscussed({ guid, source }: any = {}) { return workerPost('/membership/news-discussed', { guid, ...(source ? { source } : {}) }); },
    // SOW-126 engagement beacon, positional (type, slug) to match the extension client. Best-effort: the reader
    // wraps it in a .catch, and the Worker 200-no-ops off-tier, so a signed-out/off-tier open never surfaces.
    contentOpened(type: string, slug: string) { return workerPost('/membership/content-opened', { type, slug }); },
    // Curator "Add to Discord" stays extension-only for now (news-publish is bearer/curator-gated). status() keeps
    // canCurate false on the web, so <gbti-news> never renders the button; this typed refusal is a defensive stop.
    publishNews() { throw err('curator-extension-only', 'Publishing news to Discord is available in the browser extension for now.'); },

    // ----- members-only READ (a paid/trial member reading an existing own members-only body) -----
    async decrypt({ encPath }: any) { return { text: await decryptEnc(encPath) }; },

    // ----- SOW-024: favorites + collections (Saved), all over the cookie-ready KV /membership/activity -----
    async getActivity() { const r = await workerGet('/membership/activity'); return r?.activity ?? { favorites: [], collections: [] }; },
    async toggleFavorite({ targetType, targetSlug, on }: any) {
      const r = await workerPost('/membership/activity', { action: 'favorite', targetType, targetSlug, on });
      return { favorited: favoritedFrom(r?.activity, targetType, targetSlug) };
    },
    async createCollection({ name }: any) { const r = await workerPost('/membership/activity', { action: 'collection.create', name }); return { id: r.id, activity: r.activity }; },
    addToCollection({ id, targetType, targetSlug, on = true }: any) { return workerPost('/membership/activity', { action: 'collection.item', id, targetType, targetSlug, on }); },
    renameCollection({ id, name }: any) { return workerPost('/membership/activity', { action: 'collection.rename', id, name }); },
    deleteCollection({ id }: any) { return workerPost('/membership/activity', { action: 'collection.delete', id }); },

    // ----- SOW-023/046: the follow graph + prefs (Following), cookie-ready KV -----
    getFollows() { return workerGet('/membership/follows'); }, // { following }
    setFollow({ username, on = true }: any) { return workerPost('/membership/follows', { username, on }); },
    getPrefs() { return workerGet('/membership/prefs'); }, // { categories, followedChannels }
    setPrefs(patch: any) { return workerPost('/membership/prefs', patch); },

    // ----- SOW-027/044: comments — read (public + own decrypt) + post/edit (members-encrypted) + own delete -----
    listComments(a: any = {}) { return listCommentsLocal(a); },
    listShareComments({ targetSlug, limit }: any = {}) { return listCommentsLocal({ targetType: 'share', targetSlug, limit }); },
    getComment({ id }: any) { return getCommentLocal(String(id || '')); },
    // Post a discussion reply (members-only, encrypted) or a from-the-author intro (public). Paid-only, gate-backed.
    postComment({ targetType, targetSlug, body, authorNote, parentId, visibility }: any) {
      if (!COMMENT_TARGET_TYPES.has(targetType)) throw err('bad-request', 'a valid targetType is required');
      if (!targetSlug) throw err('bad-request', 'a targetSlug is required');
      const createdAt = new Date().toISOString();
      const id = commentId(createdAt, Math.random().toString(36).slice(2, 8));
      const input = coerceCommentInput({ id, targetType, targetSlug, createdAt, authorNote, parentId, visibility });
      return commitComment(input, body ?? '');
    },
    async editComment({ id, body, authorNote }: any) {
      const cur = await getCommentLocal(String(id || ''));
      const fm: any = cur.frontmatter || {};
      const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
      const input = coerceCommentInput({
        id: fm.id, targetType: fm.targetType, targetSlug: fm.targetSlug,
        createdAt: fm.createdAt, updatedAt: new Date().toISOString(),
        authorNote: effAuthorNote, parentId: fm.parentId, visibility: fm.visibility,
      });
      const r = await commitComment(input, body ?? '');
      return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
    },
    async deleteComment({ id }: any) {
      const cid = String(id || '').trim();
      if (!cid) throw err('bad-request', 'a comment id is required');
      const res = await workerPost('/membership/author', {
        itemId: `comment-${cid}`,
        files: [{ path: `members/${user}/comments/${cid}.md`, content: null }],
        title: `Delete comment: ${cid}`,
      });
      return { ok: true, id: cid, prNumber: res.number, prUrl: res.html_url };
    },

    // sow-158 image upload: stage an image binary for the next publish. The editor already shows a local data-URL
    // preview; this validates + records the base64 (keyed by its own-folder path) and returns the path the field
    // stores. The image is committed with the content in one PR (publish flushes referencedImagePaths). png/jpg/
    // webp/gif only (no svg on web), <= 1 MB (the Worker + check-media re-enforce; this is the fast client refusal).
    stageImage({ filename, dataBase64 }: any) {
      const name = sanitizeImageName(filename);
      if (!name) throw err('bad-request', 'Use a PNG, JPG, WEBP, or GIF image (SVG is not supported on the web).');
      const b64 = String(dataBase64 || '');
      if (!b64) throw err('bad-request', 'That image had no data. Try choosing it again.');
      if (base64Bytes(b64) > MAX_IMAGE_BYTES) throw err('bad-request', 'That image is over 1 MB. Please optimize it (or pick a smaller one) first.');
      const path = `members/${user}/images/${name}`;
      pendingImages.set(path, b64);
      return { ok: true, path };
    },
  };
}

export { WorkbenchClientError };
