// Operations, PUBLISH side (SOW-006): building, renaming, status-flipping and publishing an item through a
// PR. This decides no privilege: it scopes to the member's own folder and forces the gated fields (via
// content-ops), but the SOW-005 gate remains authoritative.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildContentFile, flipContentStatus, buildCommentFile, serializeContentFile, parseContentFile, contentPath, ContentValidationError } from './content-ops.mjs';
import { publishContent, publishFiles, branchName } from './publish.mjs';
import { isBlockedFromPublishing } from './membership.mjs';
import { splitMemberMarkdown, encAssetFor, encryptViaWorker, MemberContentLockedError, MEMBER_MARKER } from './member-content.mjs';
import { workerSyncFork } from './fork-sync-client.mjs';
import { SIGNUP_BASE, isHostedCtx } from './signup-base.mjs';
import { hostedAuthor, hostedItemId, hostedPublishFiles } from './hosted-publish.mjs';
import { NETWORK_CONTENT_PATH_RE, OperationError, isNetworkContentPath, membershipOf, requireIdentity, requireRepo, requireSuperadminForHouse } from './operations-core.mjs';
import { AUTHOR_NOTE_TYPES } from './operations-read.mjs';

/** Build + publish a content change as (or into) a PR through the gate. */
// SOW-112: the TRUE permalink rename. One PR moves the item to the new slug (redirectFrom carries the old
// public URL so the build emits a 301 and every slug-keyed reader aliases the old slug), deletes the old
// path, byte-moves the .enc sibling (the envelope AAD is self-referential, never path-bound), and moves +
// retargets the author's intro comment (the SOW-014 diff-scoped check demands it at the new slug). Blocked
// while a staged draft or an open PR exists for either slug (v1 safety), and fail-CLOSED when the old file
// cannot resolve on the branch base (the delete half needs it; the SOW-106 fork sync provides it) — never a
// half-move. Paid-only, own-folder, post/product/prompt only. publishedAt is preserved (feeds stay stable).
export const RENAME_URL_BASE = { post: '/articles', product: '/products', prompt: '/prompts' };

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;


// SOW-112 v2: resolve the ORIGIN of an edit — the canonical own-folder item the editor loaded (`path` in the
// publish/saveDraft payload). Returns { oldSlug, oldPath } when the path is the member's own item of the same
// type, else null. Identity threading: the slug in the FORM is the (possibly new) value; the path names what
// it was.
export function renameOriginOf({ path, username, type }) {
  const m = OWN_STATUS_PATH_RE.exec(String(path || ''));
  if (!m) return null;
  if (m[1] !== String(username).toLowerCase()) return null;
  if (m[2].slice(0, -1) !== type) return null;
  return { oldSlug: m[3], oldPath: String(path) };
}


// SOW-112 v2: the intro-comment move files (product/prompt): read intro-<old>.md, rewrite id + targetSlug to
// the new slug, emit the new file + the old delete. Empty when no intro exists. Shared by renameContent and
// the publish-time rename.
export async function introMoveFiles(ctx, { username, type, oldSlug, newSlug }) {
  if (!['product', 'prompt'].includes(type)) return [];
  const oldIntro = `members/${username}/comments/intro-${oldSlug}.md`;
  const introText = await ctx.reader?.readFile?.(oldIntro);
  if (introText == null) return [];
  const intro = parseContentFile(introText);
  const introFm = { ...(intro.frontmatter ?? {}), id: `intro-${newSlug}`, targetSlug: newSlug };
  return [
    { path: `members/${username}/comments/intro-${newSlug}.md`, content: serializeContentFile(introFm, intro.body) },
    { path: oldIntro, content: null },
  ];
}


export async function renameContent(ctx, { path: rel, newSlug } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
  if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|products|prompts)/<slug>/index.md');
  if (m[1] !== String(id.username).toLowerCase()) {
    throw new OperationError('forbidden', 'you may only rename your own content');
  }
  const type = m[2].slice(0, -1);
  const oldSlug = m[3];
  const slug = String(newSlug || '').trim();
  if (!SLUG_RE.test(slug)) throw new OperationError('bad-request', 'the new permalink must be lowercase letters, digits, and hyphens');
  if (slug === oldSlug) return { ok: true, noop: true, slug };
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Renaming a published item requires a paid membership.', { membership });
  }

  // SOW-157: hosted mode has no fork; the staged-work safety loop and the fork base checks below are
  // fork-mode-only (the hosted branch is always fresh-based on live main, so the SOW-112 stale-base
  // failure cannot occur and the old file is verified via the canonical reader read further down).
  const hosted = isHostedCtx(ctx);
  if (!hosted) {
    const fork = await repo.ensureFork();
    // v1 safety: no rename while staged work or an open PR exists for either slug (the rename would strand them).
    for (const s of [oldSlug, slug]) {
      const branch = branchName(type, s);
      const staged = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
      if (staged) throw new OperationError('bad-request', `a staged draft exists for "${s}" — publish or discard it first`);
      const pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }).catch(() => null);
      if (pull) throw new OperationError('bad-request', `an open pull request exists for "${s}" — wait for it to merge or close it first`);
    }
  }

  const newPath = contentPath(type, id.username, slug);
  const collision = await repo.getFileContent(newPath).catch(() => null);
  if (collision != null) throw new OperationError('bad-request', `the permalink "${slug}" is already taken`);
  const oldText = await ctx.reader?.readFile?.(rel);
  if (oldText == null) throw new OperationError('not-found', `no such file: ${rel}`);

  const { frontmatter, body } = parseContentFile(oldText);
  const fm = { ...(frontmatter ?? {}) };
  const oldUrl = `${RENAME_URL_BASE[type]}/${oldSlug}/`;
  fm.slug = slug;
  fm.redirectFrom = [...new Set([...(Array.isArray(fm.redirectFrom) ? fm.redirectFrom : []), oldUrl])];
  fm.updatedAt = ctx.now?.() ?? new Date().toISOString(); // publishedAt is deliberately untouched

  const files = [];
  // The .enc sibling byte-moves (the envelope decrypts anywhere; nothing cross-checks its aad).
  if (typeof fm.encryptedBody === 'string' && fm.encryptedBody) {
    const oldEnc = fm.encryptedBody;
    const encText = await ctx.reader?.readFile?.(oldEnc);
    if (encText == null) throw new OperationError('not-found', `the encrypted body is missing: ${oldEnc}`);
    const { path: newEnc } = encAssetFor(type, id.username, slug);
    fm.encryptedBody = newEnc;
    files.push({ path: newEnc, content: encText }, { path: oldEnc, content: null });
  }
  files.push({ path: newPath, content: serializeContentFile(fm, body) }, { path: rel, content: null });
  // The from-the-author intro comment (product/prompt) moves + retargets in the same PR.
  files.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug, newSlug: slug }));

  const branch = `gbti/rename-${type}-${oldSlug}`;
  if (hosted) {
    const pr = await hostedPublishFiles(ctx, { branch, files, title: `Rename: ${oldSlug} -> ${slug}` });
    return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  // The delete half needs the old file ON the branch base; without it the move would half-apply. Fail closed.
  const fork = await repo.ensureFork();
  const base = await repo.getDefaultBranch(repo.upstream);
  const baseSha = await repo.getBranchSha(fork.full_name, base).catch(() => null);
  const oldOnBase = baseSha ? await repo.getFileSha(fork.full_name, rel, base).catch(() => null) : null;
  if (!oldOnBase) {
    throw new OperationError('bad-request', 'the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — try again later or contact the co-op');
  }

  const pr = await publishFiles({
    repo, branch, files,
    message: `Rename ${type} ${oldSlug} -> ${slug}`,
    title: `Rename: ${oldSlug} -> ${slug}`,
    body: `Permalink rename (SOW-112). ${oldUrl} redirects to ${RENAME_URL_BASE[type]}/${slug}/ after the next deploy.`,
  });
  return { ...pr, ok: true, type, oldSlug, slug, path: newPath };
}


// SOW-106 Phase B: a member's reversible self-unpublish/republish. Only their OWN post/product/prompt, only a
// status flip (visibility and every other field untouched), through the normal gated own-folder PR so the
// SOW-005 gate stays the authority. Idempotent: already in the requested state = a clean no-op, no PR.
export const OWN_STATUS_PATH_RE = /^members\/([a-z0-9][a-z0-9-]*)\/(posts|products|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/;


export async function setOwnContentStatus(ctx, { path: rel, status } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (status !== 'published' && status !== 'draft') {
    throw new OperationError('bad-request', 'status must be "published" or "draft"');
  }
  // SOW-145: a house/ status flip is superadmin-only (re-checked); the house branch is prefixed so it cannot
  // collide with a member item of the same slug. Otherwise the path must be the caller's own member folder.
  const houseTarget = isNetworkContentPath(rel);
  let type, slug, branch;
  if (houseTarget) {
    // Validate the content-path shape BEFORE the role gate: a non-content house path (house/roles.yml, a
    // traversal) is a plain bad-request for everyone, and only a well-formed house item reaches the superadmin
    // check, so a non-superadmin cannot probe which house paths exist via the error.
    const hm = NETWORK_CONTENT_PATH_RE.exec(String(rel || ''));
    if (!hm) throw new OperationError('bad-request', 'invalid house content path');
    await requireSuperadminForHouse(ctx);
    type = hm[1].slice(0, -1);
    slug = String(rel).split('/')[2];
    branch = `gbti/status-house-${type}-${slug}`;
  } else {
    const m = OWN_STATUS_PATH_RE.exec(String(rel || ''));
    if (!m) throw new OperationError('bad-request', 'path must be members/<you>/(posts|products|prompts)/<slug>/index.md');
    if (m[1] !== String(id.username).toLowerCase()) {
      throw new OperationError('forbidden', 'you may only change the status of your own content');
    }
    type = m[2].slice(0, -1);
    slug = m[3];
    branch = `gbti/status-${type}-${slug}`;
  }
  // The publishing lifecycle is paid-only (SOW-011); the gate is the real authority (unknown fails open to it).
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Changing a published item requires a paid membership.', { membership });
  }
  const text = await ctx.reader?.readFile?.(rel); // fresh canonical read (async-safe; preserves concurrent fields)
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const flip = flipContentStatus(text, status);
  if (!flip.changed) return { ok: true, noop: true, status };
  const verb = status === 'draft' ? 'Unpublish' : 'Republish';
  if (isHostedCtx(ctx)) {
    const pr = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: flip.content }], title: `${verb}: ${slug}` });
    return { ...pr, ok: true, status };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch); // SOW-106 Phase A: fresh-base the flip branch
  const pr = await publishFiles({
    repo, branch, files: [{ path: rel, content: flip.content }],
    message: `${verb} ${slug}`, title: `${verb}: ${slug}`,
    body: status === 'draft'
      ? 'Member unpublish: a reversible status flip to draft (SOW-106). The file stays in the repo; republishing reverses it.'
      : 'Member republish: the status flips back to published (SOW-106).',
  });
  return { ...pr, ok: true, status };
}


/**
 * SOW-106 Phase A: when the publish path is about to CREATE the per-item branch, first sync the fork's main
 * with upstream via the Worker (fork-installation token), so the new branch bases on a main that CONTAINS the
 * member's already-merged files and the PR is a clean modify diff instead of an add/add conflict. An EXISTING
 * branch is NEVER synced or moved (the SOW-053 stale-base protection for in-flight edits stays intact), and
 * every failure is a silent miss: the publish proceeds exactly as before, with the needs-rebase surfacing as
 * the backstop. Exported for unit tests.
 */
export async function syncForkIfCreatingBranch(ctx, repo, branch, { sync = workerSyncFork } = {}) {
  try {
    const fork = await repo.ensureFork();
    const exists = await repo.getBranchSha(fork.full_name, branch).then((sha) => Boolean(sha)).catch(() => false);
    // A branch WITH an open PR carries in-flight edits: never sync under it (SOW-053; the stale base is
    // what protects concurrent edits). A LEFTOVER branch (exists, but its PR already merged/closed) gets
    // the sync anyway: publish is about to force-reset it to the fork main (2026-07-09, PRs 95-97), and
    // resetting onto an UNSYNCED main would re-create the very conflict the reset exists to prevent.
    if (exists) {
      let open = null;
      try { open = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }); } catch { open = { number: -1 }; }
      if (open) return { synced: false, reason: 'branch-exists' };
    }
    const token = ctx.store?.get?.('githubToken');
    return await sync({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch {
    return { synced: false, reason: 'error' };
  }
}


export async function publish(ctx, { type, input, body, message, title, prBody, authorNote, path, scope } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  // SOW-145: a house publish targets the non-member house/ folder (author stays 'gbti'). The scope is declared
  // by the caller (a NEW house item) or inferred from `path` (editing an existing house item). It is
  // superadmin-only, RE-CHECKED here server-side (never trust the client); the SOW-108 gate auto-merges a
  // superadmin house/** PR, and a forged non-superadmin one is Tier A -> rejected + closed by the gate.
  // sow-195: infer the network target from the members/gbtilabs/ prefix. Without this an edit loaded from
  // the network scope would publish into the ACTOR's own folder, silently misfiling the item instead of
  // failing visibly, so it has to move in the same change as the read side.
  const houseTarget = scope === 'house' || isNetworkContentPath(path);
  const targetScope = houseTarget ? 'house' : 'member';
  if (houseTarget) await requireSuperadminForHouse(ctx);
  // SOW-011: publishing to the canonical repo is paid-only. Block a KNOWN non-paid (trial / lapsed) member
  // BEFORE opening any PR, so their draft stays on their own fork and nothing reaches the canonical repo.
  // 'unknown' (oracle unreachable) fails OPEN to the SOW-005 gate, which is the real authority and rejects a
  // genuinely non-paid PR anyway, so a paid member is never wrongly blocked when the oracle is down.
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError(
      'membership-required',
      'Publishing on gbti.network requires a paid membership. Your draft is saved on your own fork. Upgrade to a paid membership at https://gbti.network, and your client publishes your staged drafts.',
      { membership },
    );
  }
  // SOW-112 v2 (owner-directed): the rename happens AT THE PUBLISH EVENT. `path` names the canonical item this
  // edit was loaded from; a submitted slug that differs from it makes this publish a RENAME (one PR: the new
  // path, the old path deleted, the old URL in redirectFrom so the build 301s and readers alias). Even without
  // a slug change, the old file's redirectFrom entries are merged in (a plain re-publish used to drop them).
  // House rename is deferred (SOW-145 v1): a house target never enters the rename path (origin stays null), so a
  // house edit is always a plain re-publish of the same slug. Member content keeps the full SOW-112 rename flow.
  const origin = houseTarget ? null : renameOriginOf({ path, username: id.username, type });
  let oldFm = null;
  if (origin) {
    const oldText = await ctx.reader?.readFile?.(origin.oldPath);
    if (oldText != null) oldFm = parseContentFile(oldText).frontmatter ?? {};
  }
  const effInput = { ...(input ?? {}) };
  const renaming = Boolean(oldFm) && typeof effInput.slug === 'string' && effInput.slug !== origin.oldSlug;
  if (oldFm) {
    const keep = Array.isArray(oldFm.redirectFrom) ? oldFm.redirectFrom : [];
    const oldUrl = renaming ? `${RENAME_URL_BASE[type]}/${origin.oldSlug}/` : null;
    const merged = [...new Set([...keep, ...(Array.isArray(effInput.redirectFrom) ? effInput.redirectFrom : []), ...(oldUrl ? [oldUrl] : [])])];
    if (merged.length) effInput.redirectFrom = merged;
    // A rename must not re-stamp publishedAt (feeds stay stable; the item is not new). The editor stamps it on
    // every publish, so restore the original here for the rename case only.
    if (renaming && oldFm.publishedAt) effInput.publishedAt = oldFm.publishedAt;
  }
  // Date parity with the WorkBench editor (SOW-062 P6), which stamps publishedAt/updatedAt at publish. The
  // MCP/API path never did, so an add_* item landed DATELESS: bottom of every feed, no date chip (hit live
  // 2026-07-09 with the /ci prompt). Preserve an existing item's publishedAt on a re-publish (read the
  // canonical file when the caller sent no `path`); stamp now for a genuinely new item; updatedAt bumps
  // whenever the item already existed.
  if (['post', 'product', 'prompt'].includes(type) && !effInput.publishedAt) {
    const nowIso = new Date().toISOString();
    let priorFm = oldFm;
    if (!priorFm && typeof effInput.slug === 'string' && effInput.slug) {
      const canonical = contentPath(type, id.username, effInput.slug, targetScope); // SOW-145: house -> house/<sub>/…
      let text = null;
      try { text = (await ctx.reader?.readFile?.(canonical)) ?? null; } catch { text = null; }
      // The MCP host without a local repoPath has no working reader (hit live 2026-07-10: a re-publish
      // stamped publishedAt to now); the repo client reads the canonical upstream file instead.
      if (text == null) { try { text = (await repo.getFileContent(canonical)) ?? null; } catch { text = null; } }
      if (text != null) { try { priorFm = parseContentFile(text).frontmatter ?? {}; } catch { priorFm = null; } }
    }
    effInput.publishedAt = priorFm?.publishedAt ?? nowIso;
    if (priorFm) effInput.updatedAt = nowIso;
  }
  let built;
  try {
    // SOW-106: publishing merges into the network repo, and merged content is PUBLIC. Force status: published (an
    // explicit caller status still wins), so a publish can never silently produce a hidden merged draft.
    built = buildContentFile({ type, username: id.username, input: { ...effInput, status: effInput.status || 'published' }, body, scope: targetScope });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  if (renaming) {
    // Collision pre-check (CI's unique-slug guard is the backstop) — the new path must not exist upstream.
    const collision = await repo.getFileContent(built.path).catch(() => null);
    if (collision != null) throw new OperationError('bad-request', `the permalink "${built.slug}" is already taken`);
  }

  // SOW-016: if the content is whole-item members-only or has a `<!-- members-only -->` section, encrypt the
  // gated markdown SERVER-SIDE (the Worker holds the key; it never reaches us) and commit the ciphertext plus
  // the public stub as ONE PR. Plain public content takes the unchanged single-file path.
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt });
  } catch (err) {
    // The Worker rejected encrypt with 401/403 (the author is not effective-paid). This is the fail-CLOSED
    // path when the local oracle was 'unknown': surface a clean upgrade nudge, and NO PR is opened.
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing member-only content requires a paid membership. Your draft is saved; upgrade at https://gbti.network and publish.', { membership });
    }
    throw err;
  }
  // SOW-014: a published product/prompt must carry a from-the-author intro comment IN THE SAME PR. When authorNote
  // is provided, seed intro-<slug>.md (public, authorNote:true) into this same publish, so validate-content's
  // diff-scoped intro check passes and a compliant prompt/product ships in ONE PR (deterministic id -> a re-publish
  // updates the same comment, never duplicating it).
  const introFile = buildIntroCommentFile({ username: id.username, built, authorNote, now: ctx.now?.() });
  // A descriptive PR title / commit message / body (used only when the caller gave none), so the pull request
  // reads clearly and the activity feed (which shows the PR title) is not a bare "Update".
  const desc = describeContentPublish(built, { hasIntro: Boolean(introFile) });
  const msg = message ?? desc.message;
  const ttl = title ?? desc.title;
  const bdy = prBody ?? desc.body;
  // SOW-156/157: hosted mode hands the file set to the Worker (no fork, no local commit); the Worker
  // commits to a canonical hosted branch and opens the auto-merging PR. A hosted RENAME needs none of the
  // SOW-112 fork dance below (that dance exists because fork branches base stale; the hosted branch is
  // ALWAYS fresh-based on live main), so it is just the old-path deletes + the intro move in the same
  // files[] — every path is own-folder, verified against the canonical reader.
  if (isHostedCtx(ctx)) {
    // sow-203: the NETWORK's content publishes from a hosted host like any other member folder. The refusal
    // that used to sit here (SOW-157, 2026-07-25) predated sow-195 and was broader than the rule it guarded.
    // Nothing special is needed: the Worker authorises a superadmin to write any member folder
    // (allowAnyFolder, sow-183) and the SOW-108 gate auto-merges the PR. The hosted image rule does not apply
    // either, because it is checked only against BINARY entries and a website upload is staged flat under the
    // acting caller's own folder (src/lib/workbench-client.ts stageImage), which that rule already accepts.
    const hostedRenameFiles = [];
    if (renaming) {
      const onMain = (await ctx.reader?.readFile?.(origin.oldPath)) != null;
      if (!onMain) throw new OperationError('bad-request', 'the original item could not be found on the network — refresh and try the rename again');
      hostedRenameFiles.push({ path: origin.oldPath, content: null });
      if (typeof oldFm?.encryptedBody === 'string' && oldFm.encryptedBody) hostedRenameFiles.push({ path: oldFm.encryptedBody, content: null });
      if (!introFile) {
        hostedRenameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
      } else {
        const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
        if ((await ctx.reader?.readFile?.(oldIntro)) != null) hostedRenameFiles.push({ path: oldIntro, content: null });
      }
    }
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(hostedRenameFiles);
    const r = await hostedAuthor({
      token: ctx.store?.get?.('githubToken'), itemId: hostedItemId(built.type, renaming ? origin.oldSlug : built.slug),
      files, title: ttl, signupBase: SIGNUP_BASE, fetchImpl: ctx.fetch ?? globalThis.fetch,
    });
    return renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r;
  }
  // SOW-112 v2: a rename rides the item's OWN branch (the staged-draft identity), carries the deletes of the
  // old path (+ its .enc; the new one was freshly encrypted above), and moves the intro comment — unless this
  // publish writes a fresh authorNote intro at the new slug already.
  const branch = branchName(built.type, renaming ? origin.oldSlug : built.slug, built.scope); // SOW-145: house prefix
  // SOW-106 Phase A: fresh-base a branch that is about to be created (best-effort; a miss changes nothing).
  await syncForkIfCreatingBranch(ctx, repo, branch);
  let renameFiles = [];
  if (renaming) {
    // The delete half must survive the PR DIFF, which is computed against the branch's MERGE BASE — not the
    // branch tip and not today's fork main. A draft branch cut from a stale base ADDS the old-path file (the
    // staged pending rename lives there), so deleting it on that branch nets to NOTHING in the diff and the
    // merged PR leaves the old page live (exactly how PR #67 half-landed). The only safe shape: verify the
    // old file on a FRESH fork main, then ALWAYS rebuild the branch from it — this publish rebuilds every
    // file from the submitted content, so the branch carries nothing worth keeping. An open PR blocks (the
    // rebuild would close it); the fail-closed message stays when the sync cannot provide the file.
    const fork = await repo.ensureFork();
    const base = await repo.getDefaultBranch(repo.upstream);
    const token = ctx.store?.get?.('githubToken');
    await workerSyncFork({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const onMain = await repo.getFileSha(fork.full_name, origin.oldPath, base).catch(() => null);
    if (!onMain) {
      throw new OperationError('bad-request', 'the rename needs your fork to sync with the network first (the publisher app needs its updated permissions approved) — your draft is saved; try publishing again later or contact the co-op');
    }
    const branchSha = await repo.getBranchSha(fork.full_name, branch).catch(() => null);
    if (branchSha) {
      const pull = await repo.findOpenPull({ head: `${fork.owner}:${branch}` }).catch(() => null);
      if (pull) throw new OperationError('bad-request', `an open pull request exists for this item (#${pull.number}) — wait for it to merge or close it, then publish the rename`);
      await repo.deleteBranch(fork.full_name, branch).catch(() => {});
    }
    renameFiles.push({ path: origin.oldPath, content: null });
    if (typeof oldFm.encryptedBody === 'string' && oldFm.encryptedBody) renameFiles.push({ path: oldFm.encryptedBody, content: null });
    if (!introFile) {
      renameFiles.push(...await introMoveFiles(ctx, { username: id.username, type, oldSlug: origin.oldSlug, newSlug: built.slug }));
    } else {
      // A fresh authorNote intro ships at the new slug in this same publish; the OLD intro must still be
      // deleted or it survives as an orphan the alias union surfaces as a duplicate author note (hit in PR #68:
      // the editor prefills the note field from the existing intro, so renames practically always take this arm).
      const oldIntro = `members/${id.username}/comments/intro-${origin.oldSlug}.md`;
      if ((await ctx.reader?.readFile?.(oldIntro)) != null) renameFiles.push({ path: oldIntro, content: null });
    }
  }
  const withRename = (r) => (renaming ? { ...r, renamed: { from: origin.oldSlug, to: built.slug } } : r);
  if (introFile || renaming) {
    const files = (plan ? plan.files : [{ path: built.path, content: built.markdown }]).concat(introFile ? [introFile] : []).concat(renameFiles);
    return withRename(await publishFiles({ repo, branch, files, message: msg, title: ttl, body: bdy }));
  }
  if (plan) {
    return withRename(await publishFiles({ repo, branch, files: plan.files, message: msg, title: ttl, body: bdy }));
  }
  return publishContent({ repo, change: built, message: msg, title: ttl, body: bdy });
}


/**
 * A descriptive PR title, commit message, and PR body for a content publish, built from the human title (not the
 * slug) plus the one-line description and category. Fixes the bare "Update" PR + the identical activity-feed entry
 * (gbti-activity-bell reads the PR title). Pure + exported for unit tests.
 */
export function describeContentPublish(built, { hasIntro } = {}) {
  const LABEL = { post: 'article', product: 'product', prompt: 'prompt', profile: 'profile' };
  const label = LABEL[built?.type] ?? built?.type ?? 'content';
  if (built?.type === 'profile') {
    const t = `Update the ${built.username} member profile`;
    return { title: t, message: t, body: `Update the ${built.username} member profile.` };
  }
  const name = built?.frontmatter?.title || built?.slug || label;
  const title = `Publish ${label}: ${name}`;
  const blurb = built?.frontmatter?.shortDescription || built?.frontmatter?.excerpt || '';
  const cats = Array.isArray(built?.frontmatter?.categories) ? built.frontmatter.categories.join(' > ') : '';
  const lines = [`## ${name}`, ''];
  if (blurb) lines.push(blurb, '');
  lines.push(`- Type: ${label}`);
  if (cats) lines.push(`- Category: ${cats}`);
  lines.push(`- Path: \`${built?.path ?? ''}\``);
  if (hasIntro) lines.push('- Includes the from-the-author intro comment.');
  lines.push('', '_Published through the GBTI Network client._');
  return { title, message: title, body: lines.join('\n') };
}


/**
 * SOW-014: build the from-the-author intro comment file, to commit in the SAME publish PR. Returns
 * { path, content } or null (no note, or a type that cannot carry one). Pure + exported for unit tests. The id
 * is deterministic (intro-<slug>) so a re-publish updates the same comment file, never duplicating it.
 * 2026-08-11: posts included. The note stays OPTIONAL for a post (validate-content requires one only for a
 * product/prompt); this returning null for a post is what silently discarded a note typed on an article.
 */
export function buildIntroCommentFile({ username, built, authorNote, now } = {}) {
  const note = String(authorNote ?? '').trim();
  if (!note || !built?.slug || !AUTHOR_NOTE_TYPES.has(built.type)) return null;
  const introBuilt = buildCommentFile({
    username,
    // SOW-145: a house product/prompt intro lands at house/comments/ with author 'gbti' (mirrors the item scope).
    scope: built.scope || 'member',
    input: {
      id: `intro-${built.slug}`,
      targetType: built.type,
      targetSlug: built.slug,
      createdAt: now ?? new Date().toISOString(),
      status: 'published',
      visibility: 'public',
      authorNote: true,
    },
    body: note,
  });
  return { path: introBuilt.path, content: introBuilt.markdown };
}


/**
 * SOW-016: plan the files for a member-only publish. Whole-item members-only, or a `<!-- members-only -->`
 * section, has its gated markdown encrypted (via the injected `encrypt`, which calls the Worker) and committed
 * as a sibling .enc, while index.md keeps only the public teaser plus an `encryptedBody` reference. Returns
 * { files, encPath, assetId } or null for plain public content. Pure over `encrypt`, so it is unit-testable.
 */
export async function planMemberFiles({ built, body, encrypt }) {
  if (!built?.slug) return null; // profiles + slugless types are never body-gated
  const vis = built.frontmatter?.visibility ?? 'public';
  let publicPart = '';
  let memberPart = null;
  if (vis === 'members') {
    // A members item MAY carry a public teaser: everything before the marker stays in index.md and only the
    // tail is encrypted, so a Mode B stub can say what it is instead of showing a bare title. Without a marker
    // this is unchanged from before — the ENTIRE body is gated (Mode A, or a Mode B stub with no teaser).
    // Back-compatible by measurement: no shipped members item contains the marker, and validate-content
    // rejects a committed body that does, so no existing item can change shape here.
    const split = splitMemberMarkdown(body);
    if (split.memberPart) {
      publicPart = split.publicPart; // the teaser: stays in index.md, public
      memberPart = split.memberPart; // the tail: encrypted to the .enc
    } else {
      // No marker, or a marker with an empty tail: the ENTIRE body is gated, exactly as before. Strip any
      // marker so the literal `<!-- members-only -->` never reaches index.md (validate-content rejects it).
      memberPart = String(body ?? '').replace(MEMBER_MARKER, '').trim();
      if (!memberPart) return null; // a members item with an empty body: nothing to encrypt (plain publish)
    }
  } else {
    const split = splitMemberMarkdown(body);
    if (split.memberPart == null) return null; // plain public content (no marker): no encryption
    publicPart = split.publicPart;
    memberPart = split.memberPart;
    if (!memberPart) {
      // The marker is present but the gated tail is empty. STRIP the marker (publicPart already excludes it)
      // and publish the public part as a plain post, so the literal `<!-- members-only -->` never reaches index.md.
      return { files: [{ path: built.path, content: serializeContentFile(built.frontmatter, publicPart) }] };
    }
  }
  const { assetId, path: encPath } = encAssetFor(built.type, built.username, built.slug, built.scope); // SOW-145: house -> house/_enc/
  const envelope = await encrypt(memberPart, assetId);
  const markdown = serializeContentFile({ ...built.frontmatter, encryptedBody: encPath }, publicPart);
  return {
    files: [
      { path: built.path, content: markdown },
      { path: encPath, content: JSON.stringify(envelope) },
    ],
    encPath,
    assetId,
  };
}

// ----- SOW-082: universal draft staging. A draft is the item committed to its per-item branch gbti/<type>-<slug>
// on the member's FORK with NO open PR. Save commits there (no PR); Publish opens the PR from that same branch.
// Save is trial+paid (canStageDrafts); Publish stays paid-only (the SOW-005 gate is the backstop). -----

