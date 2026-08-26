// Operations, DRAFT staging (SOW-006 + SOW-082): a draft is the item committed to its own per-item branch
// on the member's fork, never the canonical repo. authorContent lives here because it dispatches between
// saveDraft and publish, and putting it here keeps operations-publish.mjs free of a back-edge to this module.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildContentFile, parseContentFile, contentPath, ContentValidationError } from './content-ops.mjs';
import { commitToBranchOnFork, branchName } from './publish.mjs';
import { canStageDrafts, isBlockedFromPublishing } from './membership.mjs';
import { encryptViaWorker, decryptViaWorker, MemberContentLockedError } from './member-content.mjs';
import { SIGNUP_BASE, isHostedCtx } from './signup-base.mjs';
import { workerListDrafts, workerPutDraft, workerDeleteDraft } from './drafts-client.mjs';
import { workerListRepoDrafts } from './repo-drafts-client.mjs';
import { mergeRepoDrafts } from './repo-drafts-core.mjs';
import { OperationError, membershipOf, requireIdentity, requireRepo } from './operations-core.mjs';
import { planMemberFiles, publish, renameOriginOf, setOwnContentStatus, syncForkIfCreatingBranch } from './operations-publish.mjs';

/**
 * SOW-106: the MCP author entry. The caller MUST declare intent via `status`: "published" publishes (merge into
 * the network repo, which is public) and "draft" stages on the member fork for review. The status is the INTENT
 * and is NOT written into the content input (publish/saveDraft set the content status themselves, defaulting to
 * published), so nothing silently drafts. Throws `status-required` if the caller omits or mis-spells it.
 *
 * sow-193: `path` and `scope` are FORWARDED now. Before this they were simply absent from the signature while
 * publish() accepted both, and the three consequences were all silent:
 *   - a RENAME was impossible. publish() derives one from `path` via renameOriginOf, so with `path` undefined
 *     an agent re-publishing under a changed slug created a SECOND item and left the old page live.
 *   - `redirectFrom` was dropped, because the merge only happens inside the `if (oldFm)` branch that `path`
 *     unlocks, so the old URL never got its 301.
 *   - `scope: 'house'` could not be expressed at all from this entry point.
 * saveDraft takes `path` too (it stages a pending rename on the item's own branch) but has no house scope by
 * design (sow-145: house content publishes directly), so `scope` is only meaningful on the publish arm.
 */
export async function authorContent(ctx, { type, input, body, status, message, title, prBody, authorNote, path, scope } = {}) {
  if (status !== 'draft' && status !== 'published') {
    throw new OperationError('status-required', 'Specify status: "published" to publish (merge and go live on the network) or "draft" to stage on your fork for review before publishing.');
  }
  if (status === 'draft') return saveDraft(ctx, { type, input, body, message, path });
  return publish(ctx, { type, input, body, message, title, prBody, authorNote, path, scope });
}


/** Parse a draft branch (gbti/<type>-<slug>, or gbti/profile) back to { type, slug }. Returns null for a branch
 *  that is not a draftable content item (e.g. gbti/share-*, gbti/comment-*), so those are skipped by listDrafts. */
export function draftMetaFromBranch(branch) {
  if (branch === 'gbti/profile') return { type: 'profile', slug: null };
  const m = String(branch || '').match(/^gbti\/(post|product|prompt)-(.+)$/);
  return m ? { type: m[1], slug: m[2] } : null;
}


/** Save (stage) a content draft to the member's OWN fork on its deterministic branch, WITHOUT opening a PR.
 *  Trial + paid may stage (canStageDrafts); 'unknown' fails open (the fork write is the member's own repo).
 *  Members-only content needs the Worker to encrypt (paid only), so a trial member's members-only draft is
 *  refused with a clean upgrade nudge and NO branch is created. */
export async function saveDraft(ctx, { type, input, body, message, path } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (membership !== 'unknown' && !canStageDrafts(membership)) {
    throw new OperationError('forbidden', 'Saving drafts requires an active trial or paid membership.', { membership });
  }
  let built;
  try {
    // SOW-106: a fork-staged draft carries status: published (it is ready to publish; the "draft" is the fork
    // LOCATION, and the Drafts tab derives Staged/Submitted from the PR, not this field). So it merges public with
    // no publishDraft content rewrite. status: draft is reserved for the unpublish/disable state in the canonical repo.
    built = buildContentFile({ type, username: id.username, input: { ...(input ?? {}), status: (input && input.status) || 'published' }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  // SOW-112 v2: a permalink change stages ON THE ITEM'S OWN branch at its OLD path (the frontmatter slug is
  // the pending new value; the folder names what the item still is). Identity stays with the item — no silent
  // fork — and the publish event performs the actual move.
  const origin = renameOriginOf({ path, username: id.username, type: built.type });
  const staging = origin && built.slug !== origin.oldSlug ? origin : null;
  const branch = branchName(built.type, staging ? staging.oldSlug : built.slug);
  // SOW-157: a hosted member has no fork; drafts stage in the private, erasable KV store instead (which
  // also serves trial members: nothing staged here ever touches the canonical repo). The body is stored
  // plain (the store is per-member private); encryption happens at PUBLISH time via the normal plan.
  if (isHostedCtx(ctx)) {
    let fm = {};
    try { fm = parseContentFile(built.markdown).frontmatter ?? {}; } catch { fm = {}; }
    await workerPutDraft({
      draft: {
        type: built.type, slug: staging ? staging.oldSlug : built.slug,
        pendingSlug: staging ? built.slug : null,
        path: staging ? staging.oldPath : built.path, frontmatter: fm, body,
      },
      token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
    });
    return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: 'staged', hosted: true, ...(staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {}) };
  }
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) => encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Staging members-only content requires a paid membership. Save it as public, or upgrade to a paid membership.', { membership });
    }
    throw err;
  }
  let files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  if (staging) files = files.map((f) => (f.path === built.path ? { ...f, path: staging.oldPath } : f)); // the index stays at the old path
  // SOW-106 Phase A: fresh-base a branch that is about to be created (best-effort; a miss changes nothing).
  await syncForkIfCreatingBranch(ctx, repo, branch);
  await commitToBranchOnFork({ repo, branch, files, message: message ?? `Draft: ${built.slug ?? built.type}` });
  return { ok: true, branch, type: built.type, slug: built.slug ?? null, path: staging ? staging.oldPath : built.path, state: 'staged', ...(staging ? { renamed: { from: staging.oldSlug, to: built.slug } } : {}) };
}


/** List the member's fork-staged drafts (the gbti/* branches on their fork). Each draft carries enough to render
 *  a row + open the editor; `pull` is the matched OPEN PR (or null) so the UI computes the lifecycle state via
 *  classifyDraft. Fail-soft per draft (an unreadable branch is skipped). */
/**
 * SOW-106 Phase 2: is a fork-staged file byte-identical to the LIVE network version (fully merged, nothing
 * pending)? Reads the live content via the reader (upstream is public) and compares the parsed frontmatter + body.
 * ANY difference, an unreadable live file, or a member-only item (encrypted body, which the stub alone cannot
 * compare) returns false, so a pending edit is NEVER mistaken for merged. Read-only; never throws.
 */
export async function forkContentMatchesLive(ctx, path, forkText) {
  try {
    const staged = parseContentFile(forkText);
    if (staged.frontmatter?.encryptedBody) return false; // member-only: the stub cannot prove the .enc is unchanged
    const live = await ctx.reader?.read?.(path);
    if (!live) return false;
    return String(staged.body ?? '').trim() === String(live.body ?? '').trim()
      && JSON.stringify(staged.frontmatter ?? {}) === JSON.stringify(live.frontmatter ?? {});
  } catch { return false; }
}


/**
 * sow-194: fetch the caller's committed repo drafts (status:draft items in the public repo) and merge them into
 * the fork/KV draft rows. FAIL-SOFT: a repo-drafts error (route down, not signed in) must NOT blank the Drafts
 * list, so a member still sees their fork/KV drafts. mergeRepoDrafts drops a repo row whose (type,slug) already
 * has a fork/KV draft (the editable copy wins) and filters repo rows to `type` when one is given.
 */
export async function foldRepoDrafts(ctx, drafts, type) {
  let items = [];
  try {
    const token = ctx.store?.get?.('githubToken');
    const r = await workerListRepoDrafts({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    items = Array.isArray(r?.items) ? r.items : [];
  } catch { items = []; }
  return mergeRepoDrafts(drafts, items, { type });
}


export async function listDrafts(ctx, { type } = {}) {
  const id = requireIdentity(ctx);
  // SOW-157: hosted drafts come from the KV store; the same row shape, with no PR (drafts never open one).
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const drafts = [];
    for (const r of recs ?? []) {
      if (type && r.type !== type) continue;
      let valid = true;
      let invalidReason = null;
      try {
        buildContentFile({ type: r.type, username: id.username, input: r.frontmatter ?? {}, body: r.body ?? '' });
      } catch (err) {
        valid = false;
        invalidReason = err?.message || 'this draft no longer matches the current schema';
      }
      let rowPath = r.path;
      if (!rowPath) { try { rowPath = contentPath(r.type, id.username, r.slug); } catch { rowPath = null; } }
      drafts.push({
        type: r.type, slug: r.slug, branch: branchName(r.type, r.slug), path: rowPath,
        pendingSlug: r.pendingSlug ?? null,
        title: r.frontmatter?.title || r.frontmatter?.displayName || r.slug || r.type,
        visibility: r.frontmatter?.visibility || 'public',
        status: r.frontmatter?.status || 'draft',
        valid, invalidReason, pull: null,
        store: 'kv', // sow-194: the store discriminator, so a repo draft never collides with a KV draft
      });
    }
    return { drafts: await foldRepoDrafts(ctx, drafts, type) };
  }
  const repo = requireRepo(ctx);
  const fork = await repo.ensureFork();
  const refs = await repo.listMatchingRefs(fork.full_name, 'gbti/');
  const drafts = [];
  for (const { branch, sha } of refs) {
    const meta = draftMetaFromBranch(branch);
    if (!meta) continue;
    if (type && meta.type !== type) continue;
    let path;
    try { path = contentPath(meta.type, id.username, meta.slug); } catch { continue; }
    // Read by the ref's TIP SHA (immutable, never stale), NOT the branch name: a by-name contents read can lag
    // a just-pushed commit and serve the branch's CREATION state. A branch cut from a freshly SYNCED main is
    // live-identical at creation, so that stale read made the merged-branch cleanup below eat a brand-new
    // draft seconds after it was saved (hit in the wild 2026-07-06).
    let text = null;
    try { text = await repo.getForkFileContent(fork.full_name, path, sha || branch); } catch { text = null; }
    if (!text) continue;
    let fm = {};
    let draftBody = '';
    try { const parsed = parseContentFile(text); fm = parsed.frontmatter ?? {}; draftBody = parsed.body ?? ''; } catch { fm = {}; }
    // SOW-106 Phase C: schema-drift check. A draft saved under an older schema may no longer validate; surface
    // that on the row (and the editor prompts on open) instead of failing at publish time. One extra safeParse
    // on data already in hand; never throws the listing.
    let valid = true;
    let invalidReason = null;
    try {
      buildContentFile({ type: meta.type, username: id.username, input: fm, body: draftBody });
    } catch (err) {
      valid = false;
      invalidReason = err?.message || 'this draft no longer matches the current schema';
    }
    let pull = null;
    try { pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { pull = null; }
    // SOW-106 Phase 2: a staged draft with NO open PR whose content EXACTLY matches the LIVE network version is
    // fully merged (nothing pending). Clean up the lingering fork branch (member token; the content is preserved on
    // the network, so this loses nothing) and drop it, so a published item never lingers as a "Staged" draft.
    // Conservative: any pending edit, an open PR, or a member-only item keeps the draft.
    if (!pull && (await forkContentMatchesLive(ctx, path, text))) {
      try { await repo.deleteBranch(fork.full_name, branch); } catch { /* best-effort; a stale fork branch is harmless */ }
      continue;
    }
    drafts.push({
      type: meta.type,
      slug: meta.slug,
      branch,
      path,
      // SOW-112 v2: a frontmatter slug that differs from the branch identity is a PENDING RENAME (it applies
      // when the draft publishes). Surfaced so same-titled drafts are tellable apart in the Drafts tab.
      pendingSlug: typeof fm.slug === 'string' && fm.slug !== meta.slug ? fm.slug : null,
      title: fm.title || fm.displayName || meta.slug || meta.type,
      visibility: fm.visibility || 'public',
      status: fm.status || 'draft',
      valid,
      invalidReason,
      pull: pull ? { number: pull.number, html_url: pull.html_url } : null,
      store: 'fork', // sow-194: the store discriminator, so a repo draft never collides with a fork draft
    });
  }
  return { drafts: await foldRepoDrafts(ctx, drafts, type) };
}


/** Read one fork-staged draft (frontmatter + body) for the editor prefill. A members-only draft stores its body
 *  in the sibling .enc; decrypt it (the author is paid) so a re-save never replaces the gated text with a stub. */
export async function readDraft(ctx, { type, slug, store, path: repoPath } = {}) {
  const id = requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is a committed status:draft item at its canonical path in the PUBLIC repo. Read it via
  // the reader (upstream/canonical, not a fork branch or the KV store), decrypting a members-only body like a
  // fork draft. Route it BEFORE the hosted/fork branches so a repo draft never reads the wrong record. (The
  // canonical path arrives as `repoPath` to avoid shadowing the fork branch's own `let path` below.)
  if (store === 'repo') {
    let rel = repoPath;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path');
    let text = null;
    try { text = await ctx.reader?.readFile?.(rel); } catch { text = null; }
    if (text == null) throw new OperationError('not-found', `could not read the repo draft: ${rel}`);
    const { frontmatter, body } = parseContentFile(text);
    if (frontmatter?.encryptedBody) {
      try {
        const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
        return { path: rel, branch: null, store: 'repo', frontmatter, body: plain };
      } catch { /* the decrypt is unavailable (not paid): fall through to the public part */ }
    }
    return { path: rel, branch: null, store: 'repo', frontmatter, body };
  }
  // SOW-157: a hosted draft's restore state (frontmatter + plain body) comes straight from the KV record.
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
    if (!rec) throw new OperationError('not-found', 'no such draft');
    let recPath = rec.path;
    if (!recPath) { try { recPath = contentPath(type, id.username, slug); } catch { recPath = null; } }
    return { path: recPath, branch: branchName(type, slug), frontmatter: rec.frontmatter ?? {}, body: rec.body ?? '' };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let path;
  try { path = contentPath(type, id.username, slug); } catch (err) { throw new OperationError('bad-request', err.message); }
  const text = await repo.getForkFileContent(fork.full_name, path, branch);
  if (!text) throw new OperationError('not-found', 'no such draft on your fork');
  const { frontmatter, body } = parseContentFile(text);
  if (frontmatter?.encryptedBody) {
    try {
      const { text: plain } = await decryptMemberAsset(ctx, { encPath: frontmatter.encryptedBody });
      return { path, branch, frontmatter, body: plain };
    } catch { /* the decrypt is unavailable (not paid): fall through to the public part */ }
  }
  return { path, branch, frontmatter, body };
}


/** Discard a fork-staged draft (delete its branch). Refuses when an open PR exists (deleting the branch would
 *  abruptly close the PR + lose the review thread); the member withdraws the PR first. */
export async function discardDraft(ctx, { type, slug, store } = {}) {
  requireIdentity(ctx);
  if (!type) throw new OperationError('bad-request', 'type is required');
  // sow-194: a repo draft is committed to the public repo; discarding it is a delete request, not a from-here
  // action. Refuse with a recognizable code (never a silent no-op, and never a KV/fork delete of the wrong
  // record). Route BEFORE the hosted/fork branches.
  if (store === 'repo') throw new OperationError('unsupported', 'This draft is committed to the network and cannot be discarded here. Publish it, or open a removal request.');
  // SOW-157: a hosted discard is a KV delete (idempotent; no branch, no PR to strand).
  if (isHostedCtx(ctx)) {
    await workerDeleteDraft({ type, slug, token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { ok: true, branch: branchName(type, slug), hosted: true };
  }
  const repo = requireRepo(ctx);
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  let pull = null;
  try { pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { pull = null; }
  if (pull) throw new OperationError('bad-request', 'This draft has an open pull request; withdraw it from review before discarding.', { prNumber: pull.number });
  try {
    await repo.deleteBranch(fork.full_name, branch);
  } catch (err) {
    // SOW-112 QA fix: the branch may already be gone (the merged-branch cleanup runs during any drafts
    // listing, so a stale row can outlive its branch). An already-deleted branch IS the discarded state —
    // verify and succeed instead of surfacing GitHub's 422 "Reference does not exist" for a done deed.
    const still = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (still) throw err; // the branch exists but the delete failed: a real error
    return { ok: true, branch, alreadyGone: true };
  }
  return { ok: true, branch };
}


/** Publish a staged draft to the network: open the canonical PR from the branch Save already created (no rebuild,
 *  so a members-only draft's encrypted files round-trip untouched). Paid-only — the gate stays the backstop. */
export async function publishDraft(ctx, { type, slug, title, prBody, store, path } = {}) {
  const id = requireIdentity(ctx);
  // sow-194: publishing a repo draft is the draft->published status flip on the canonical item, NOT a fork PR.
  // setOwnContentStatus handles hosted-vs-fork AND member-vs-house scope AND the paid gate, so route to it BEFORE
  // requireRepo/the fork path (the 5th short-circuit site PublicationMaster flagged is covered inside it).
  if (store === 'repo') {
    let rel = path;
    if (!rel) { try { rel = contentPath(type, id.username, slug); } catch { rel = null; } }
    if (!rel) throw new OperationError('bad-request', 'a repo draft needs its path to publish');
    return setOwnContentStatus(ctx, { path: rel, status: 'published' });
  }
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.', { membership });
  }
  // SOW-157: a hosted draft publishes through the normal publish op (validation + member-content encryption
  // + the hosted Worker commit), then leaves the staging store — its content now lives on the network and
  // the submitted PR shows in the workspace via the hosted my-pulls match.
  if (isHostedCtx(ctx)) {
    const opts = { token: ctx.store?.get?.('githubToken'), signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
    const { drafts: recs } = await workerListDrafts(opts);
    const rec = (recs ?? []).find((r) => r.type === type && r.slug === slug);
    if (!rec) throw new OperationError('not-found', 'no such draft');
    const r = await publish(ctx, {
      type, input: rec.frontmatter ?? {}, body: rec.body ?? '', title, prBody,
      ...(rec.pendingSlug && rec.path ? { path: rec.path } : {}), // a pending rename applies at the publish event (SOW-112)
    });
    try { await workerDeleteDraft({ type, slug, ...opts }); } catch { /* best-effort; a stale staged copy is harmless */ }
    return { ...r, ok: true, hosted: true };
  }
  const branch = branchName(type, slug);
  const fork = await repo.ensureFork();
  const head = `${fork.owner}:${branch}`;
  const existing = await repo.findOpenPull({ head });
  if (existing) return { prNumber: existing.number, prUrl: existing.html_url, branch, updated: true };
  // SOW-112 v2: a PENDING-RENAME draft (frontmatter slug differs from the branch identity) must NOT ship the
  // raw branch (its file sits at the old path with the new slug — a half-rename). Route it through the full
  // publish, which performs the move (deletes + intro + redirectFrom) from this same branch. The draft's
  // frontmatter is input-shaped (the same round-trip the schema-drift check uses).
  if (type !== 'profile') {
    const oldPath = contentPath(type, id.username, slug);
    const text = await repo.getForkFileContent(fork.full_name, oldPath, branch).catch(() => null);
    if (text != null) {
      const parsed = parseContentFile(text);
      const fm = parsed.frontmatter ?? {};
      if (typeof fm.slug === 'string' && fm.slug !== slug) {
        // Publishing IS the publish event: force status published (the staged file may carry status draft).
        return publish(ctx, { type, input: { ...fm, status: 'published' }, body: parsed.body, path: oldPath, title, prBody });
      }
    }
  }
  const base = await repo.getDefaultBranch(repo.upstream);
  const titleText = title ?? (type === 'profile' ? `Update ${id.username}'s profile` : `${type}: ${slug}`);
  const pull = await repo.openPull({ title: titleText, head, base, body: prBody ?? '' });
  return { prNumber: pull.number, prUrl: pull.html_url, branch, updated: false };
}


/**
 * SOW-016 read path: decrypt a member-only .enc asset for the signed-in member. The host reads the ciphertext
 * via its reader (fs / GitHub Contents API) and asks the Worker to decrypt it; the AES key never reaches the
 * client. Returns { text } (the plaintext markdown). A non-effective-paid member -> membership-required.
 */
// A member-only asset path is ALWAYS members/<owner>/_enc/<name>.enc or house/_enc/<name>.enc (encAssetFor).
// Validate it so the decrypt route cannot be pointed at an arbitrary repo file (a member can hand-edit their
// frontmatter encryptedBody): only an .enc under an _enc/ dir, no traversal. SOW-031 hardening.
export const ENC_PATH_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/_enc\/[a-z0-9][a-z0-9._-]*\.enc$/;


export async function decryptMemberAsset(ctx, { encPath } = {}) {
  requireIdentity(ctx);
  if (!encPath || typeof encPath !== 'string') throw new OperationError('bad-request', 'encPath is required');
  if (!ENC_PATH_RE.test(encPath)) throw new OperationError('bad-request', 'invalid encrypted-asset path');
  let raw;
  try {
    raw = await ctx.reader.readFile(encPath);
  } catch {
    throw new OperationError('not-found', `could not read the encrypted asset: ${encPath}`);
  }
  let envelope;
  try { envelope = JSON.parse(raw); } catch { throw new OperationError('bad-request', 'the encrypted asset is not a valid envelope'); }
  const token = ctx.store?.get?.('githubToken');
  try {
    const text = await decryptViaWorker({ envelope, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { text };
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'This content is for paid members. Upgrade at https://gbti.network to unlock.');
    }
    throw new OperationError('decrypt-failed', err?.message || 'could not decrypt the asset');
  }
}

