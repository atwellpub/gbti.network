// Operations, SHARES + COMMENTS (SOW-006 / SOW-027 / SOW-032): publishing a share, and the comment
// lifecycle (post, edit, delete, read). Member-visibility bodies are encrypted through the Worker.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { buildShareFile, shareId as makeShareId, buildCommentFile, commentId as makeCommentId, parseContentFile, ContentValidationError } from './content-ops.mjs';
import { publishFiles } from './publish.mjs';
import { isBlockedFromPublishing } from './membership.mjs';
import { encryptViaWorker, MemberContentLockedError } from './member-content.mjs';
import { addCommentEcho as workerAddCommentEcho } from './member-comment-echo-client.mjs';
import { SIGNUP_BASE, isHostedCtx } from './signup-base.mjs';
import { hostedPublishFiles } from './hosted-publish.mjs';
import { OperationError, membershipOf, requireIdentity, requireRepo } from './operations-core.mjs';
import { planMemberFiles, syncForkIfCreatingBranch } from './operations-publish.mjs';
import { decryptMemberAsset } from './operations-drafts.mjs';

/**
 * SOW-018: publish a member "Share" (a status update) into the member's own shares/ folder. A members Share
 * (the default) has its body encrypted SERVER-SIDE (the Worker holds the key, SOW-016) and is committed as a
 * stub .md + a sibling .enc in ONE PR; a public Share is a single plain .md. Paid-only (SOW-011): a known
 * non-paid member is blocked BEFORE any PR opens. The id is a sortable timestamp-slug derived from createdAt.
 */
export async function publishShare(ctx, { input = {}, body = '', message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Posting Shares on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to post your Share.', { membership });
  }
  // INVARIANT (SOW-018): a Share's id ENCODES its createdAt (makeShareId derives the timestamp-slug from it),
  // and Shares are append-only — never re-timestamped after publish. So the id-filename order always tracks the
  // createdAt order, which is what lets the extension feed select the newest Shares by filename before reading.
  const createdAt = input.createdAt ?? (ctx.now?.() ?? new Date().toISOString());
  const id_ = input.id ?? makeShareId(createdAt, input.title);
  let built;
  try {
    built = buildShareFile({ username: id.username, input: { ...input, id: id_, createdAt }, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members Share -> encrypts the whole body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Publishing a members-only Share requires a paid membership. Upgrade at https://gbti.network.', { membership });
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  const shareTitle = title ?? `New Share${built.frontmatter.title ? `: ${built.frontmatter.title}` : ''}`;
  const pr = isHostedCtx(ctx)
    ? await hostedPublishFiles(ctx, { branch: `gbti/share-${id_}`, files, title: shareTitle }) // SOW-157: no fork
    : await publishFiles({
        repo,
        branch: `gbti/share-${id_}`, // idempotent by branch: re-publishing the same id updates the same PR
        files,
        message: message ?? `Share: ${built.frontmatter.title || id_}`,
        title: shareTitle,
        body: prBody,
      });
  // SOW-092: spread the PR handle (prNumber/prUrl/updated) like the comment op does, so the composer ack
  // can cite the real PR (it used to read an undefined prNumber). The explicit fields win on collision.
  return { ...pr, id: id_, path: built.path, visibility: built.frontmatter.visibility ?? 'members', encrypted: Boolean(plan?.encPath) };
}


// SOW-027: member comment authoring. Comments are one flat file per comment in the member's own comments/
// folder (auto-merge own-folder, SOW-005), paid-only to publish (SOW-011). A public comment is plain; a members
// comment encrypts its body (SOW-016, like shares). Editing re-publishes the same id with `updatedAt` set, so
// the SOW-014 "edited . view history" link (the git history) appears. The data model + render already exist.
export const commentSuffix = () => Math.random().toString(36).slice(2, 8); // short collision-avoidance suffix for the id


export async function planAndPublishComment(ctx, repo, built, body, { message, title, prBody }) {
  const token = ctx.store?.get?.('githubToken');
  const encrypt = (plaintext, assetId) =>
    encryptViaWorker({ plaintext, assetId, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  let plan;
  try {
    plan = await planMemberFiles({ built, body, encrypt }); // members comment -> encrypt the body to .enc
  } catch (err) {
    if (err instanceof MemberContentLockedError) {
      throw new OperationError('membership-required', 'Posting a members-only comment requires a paid membership. Upgrade at https://gbti.network.');
    }
    throw err;
  }
  const files = plan ? plan.files : [{ path: built.path, content: built.markdown }];
  // Idempotent by branch: re-editing the same comment id updates the same PR (hosted reuses one hosted branch).
  const pr = isHostedCtx(ctx)
    ? await hostedPublishFiles(ctx, { branch: `gbti/comment-${built.id}`, files, title })
    : await publishFiles({ repo, branch: `gbti/comment-${built.id}`, files, message, title, body: prBody });
  // SOW-072 P2: spread the PR handle (prNumber/prUrl/updated) so the comment ack + the MCP post_comment can report
  // it (publishFiles returns it; this op used to discard it). The explicit fields win on any key collision.
  return { ...pr, id: built.id, path: built.path, visibility: built.frontmatter.visibility ?? 'public', encrypted: Boolean(plan?.encPath) };
}


export async function publishComment(ctx, { targetType, targetSlug, body, authorNote, parentId, visibility, message, title, prBody } = {}) {
  const id = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Commenting on gbti.network requires a paid membership. Upgrade to a paid membership at https://gbti.network to join the conversation.', { membership });
  }
  const createdAt = ctx.now?.() ?? new Date().toISOString();
  const cid = makeCommentId(createdAt, commentSuffix());
  const input = { id: cid, targetType, targetSlug, createdAt, status: 'published' };
  // SOW-044: comments are members-only + encrypted. The ONLY public comment is a from-the-author intro
  // (authorNote) on a post/product/prompt; a discussion reply, and ANY comment on a Share, is always members. The
  // server is the boundary: coerce anything that is not a legitimate public intro to members, regardless of what
  // the client sent (a members body is then encrypted by planMemberFiles, never committed plaintext).
  const isPublicIntro = authorNote === true && ['post', 'product', 'prompt'].includes(targetType);
  input.visibility = (visibility === 'public' && isPublicIntro) ? 'public' : 'members';
  if (authorNote) input.authorNote = true;
  if (parentId) input.parentId = parentId;
  let built;
  try {
    built = buildCommentFile({ username: id.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: message ?? `Comment on ${targetType} ${targetSlug}`,
    title: title ?? `Comment on ${targetType}: ${targetSlug}`,
    prBody,
  });
  const out = { ...r, targetType: built.frontmatter.targetType, targetSlug: built.frontmatter.targetSlug };
  // SOW-076: optimistic echo so the AUTHOR's own comment appears instantly (read-your-writes) while the SOW-072 PR
  // auto-merges + the site rebuilds behind it. Best-effort + fire-and-forget; the durable PR is the source of truth.
  const echoToken = ctx.store?.get?.('githubToken');
  if (echoToken && out.prNumber) {
    workerAddCommentEcho({
      echo: { id: cid, targetType: out.targetType, targetSlug: out.targetSlug, body, prNumber: out.prNumber, createdAt },
      token: echoToken, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch,
    }).catch(() => {});
  }
  return out;
}


/** Read one of the member's OWN comments (frontmatter + body), for the edit-form prefill. A members comment
 *  stores its body in the .enc (the stub .md body is EMPTY), so decrypt it for the prefill — otherwise editing
 *  would start from a blank textarea and a save would replace the gated text (silent data loss). The signed-in
 *  author IS the owner + effective-paid, so the Worker decrypt succeeds. */
// SOW-112 QA: a member deletes their OWN comment — an own-folder file delete whose PR auto-merges through
// the gate. Paid-gated like publishComment (the gate is the backstop); the comment leaves the site at the
// next deploy. Hard delete by owner intent; git history retains it (the moderation-ops caveat applies).
export async function deleteComment(ctx, { id } = {}) {
  const identity = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  const cid = String(id || '').trim();
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(cid)) throw new OperationError('bad-request', 'a comment id is required');
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Managing comments on the network requires a paid membership.', { membership });
  }
  const rel = `members/${identity.username}/comments/${cid}.md`;
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such comment: ${cid}`);
  const fm = parseContentFile(text).frontmatter ?? {};
  if (String(fm.author || '').toLowerCase() !== String(identity.username).toLowerCase()) {
    throw new OperationError('forbidden', 'you may only delete your own comments');
  }
  const branch = `gbti/comment-delete-${cid}`;
  if (isHostedCtx(ctx)) {
    const pr = await hostedPublishFiles(ctx, { branch, files: [{ path: rel, content: null }], title: `Delete comment: ${cid}` });
    return { ...pr, ok: true, id: cid, path: rel };
  }
  await syncForkIfCreatingBranch(ctx, repo, branch);
  const pr = await publishFiles({
    repo, branch,
    files: [{ path: rel, content: null }],
    message: `Delete comment ${cid}`,
    title: `Delete comment: ${cid}`,
    body: 'The author removed their own comment.',
  });
  return { ...pr, ok: true, id: cid, path: rel };
}


export async function getComment(ctx, { id } = {}) {
  const idn = requireIdentity(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const item = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!item) throw new OperationError('not-found', 'no such comment in your folder');
  const enc = item.frontmatter?.encryptedBody;
  if (enc) {
    const { text } = await decryptMemberAsset(ctx, { encPath: enc }); // reads the .enc + Worker-decrypts; key stays in the Worker
    return { ...item, body: text };
  }
  return item;
}


export async function editComment(ctx, { id, body, authorNote } = {}) {
  const idn = requireIdentity(ctx);
  const repo = requireRepo(ctx);
  if (!id || typeof id !== 'string') throw new OperationError('bad-request', 'a comment id is required');
  const membership = await membershipOf(ctx);
  if (isBlockedFromPublishing(membership)) {
    throw new OperationError('membership-required', 'Editing a comment on gbti.network requires a paid membership. Upgrade at https://gbti.network.', { membership });
  }
  const existing = await ctx.reader.get(idn.username, `members/${idn.username}/comments/${id}.md`);
  if (!existing) throw new OperationError('not-found', 'no such comment in your folder');
  // Own-folder scope is enforced by reader.get (rejects out-of-folder paths) AND re-checked here.
  if (existing.frontmatter?.author && existing.frontmatter.author !== idn.username) {
    throw new OperationError('not-authorized', 'you can only edit your own comments');
  }
  const fm = existing.frontmatter ?? {};
  const updatedAt = ctx.now?.() ?? new Date().toISOString();
  // SOW-044: re-derive visibility the SAME way publishComment does, so an edit can NEVER strand a comment as a
  // public non-intro (or a public Share comment) with a plaintext body. A comment is public only as a
  // from-the-author intro (authorNote) on a post/product/prompt; anything else is coerced to members and its body
  // is re-encrypted on re-publish. Symmetric with publishComment (the CI guards are the backstop, not the boundary).
  const effAuthorNote = authorNote !== undefined ? Boolean(authorNote) : Boolean(fm.authorNote);
  const isPublicIntro = effAuthorNote && ['post', 'product', 'prompt'].includes(fm.targetType);
  // Preserve identity-defining fields; set updatedAt so the "edited . view history" link renders.
  const input = {
    id,
    targetType: fm.targetType,
    targetSlug: fm.targetSlug,
    status: fm.status ?? 'published',
    visibility: (fm.visibility === 'public' && isPublicIntro) ? 'public' : 'members',
    authorNote: effAuthorNote,
    parentId: fm.parentId,
    createdAt: fm.createdAt,
    updatedAt,
  };
  let built;
  try {
    built = buildCommentFile({ username: idn.username, input, body });
  } catch (err) {
    throw new OperationError('invalid-content', err.message, err instanceof ContentValidationError ? err.issues : undefined);
  }
  const r = await planAndPublishComment(ctx, repo, built, body, {
    message: `Edit comment ${id}`,
    title: `Edit comment on ${fm.targetType}: ${fm.targetSlug}`,
    prBody: undefined,
  });
  // Carry the target back (mirrors publishComment) so the gbti-comment-edited event can refresh the right open
  // thread (e.g. the SOW-032 Shares discussion, keyed on the composite targetSlug).
  return { ...r, edited: true, targetType: fm.targetType, targetSlug: fm.targetSlug };
}

