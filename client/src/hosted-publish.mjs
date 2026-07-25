// SOW-156 (spike): the hosted publish transport. In hosted mode the client does NOT fork, install, or
// commit anything itself: it hands the built { path, content } file set to the signup Worker
// (POST /membership/author), which validates fail-closed, commits to a hosted/<github_id>/<itemId>
// branch on the canonical repo with GBTI's own App installation token, and opens the auto-merging PR
// (the SOW-005 gate stays the only merger). Node-free + injectable fetch, same as the other transports.

import { SIGNUP_BASE } from './signup-base.mjs';

/** The hosted item id (the branch's last segment, server-prefixed with the verified github_id). Mirrors the
 *  fork-mode branchName identity so re-publishing an item reuses one branch + PR. */
export function hostedItemId(type, slug) {
  return type === 'profile' ? 'profile' : `${type}-${slug}`;
}

/**
 * POST the file set to the Worker. Returns the publishContent-shaped result the operations layer expects
 * ({ prNumber, prUrl, branch, fork, updated }). Throws a plain Error carrying the Worker's member-safe
 * message on any denial (flag off, not paid, folder not provisioned, invalid paths).
 */
/**
 * SOW-157: the drop-in hosted twin of publishFiles for the share/comment ops. Their branch names
 * (`gbti/share-<id>`, `gbti/comment-<id>`, ...) already ARE the per-item identity, so the itemId is the
 * branch minus the `gbti/` prefix — a hosted re-publish of the same id reuses one hosted branch + PR
 * exactly as the fork flow reuses one fork branch + PR. Returns the same publishFiles result shape.
 */
export function hostedPublishFiles(ctx, { branch, files, title }) {
  const itemId = String(branch || '').replace(/^gbti\//, '');
  return hostedAuthor({
    token: ctx.store?.get?.('githubToken'), itemId, files, title,
    signupBase: SIGNUP_BASE, fetchImpl: ctx.fetch ?? globalThis.fetch,
  });
}

export async function hostedAuthor({ token, itemId, files, title, signupBase = SIGNUP_BASE, fetchImpl = globalThis.fetch }) {
  if (!token) throw new Error('sign in to publish');
  const res = await fetchImpl(`${String(signupBase).replace(/\/$/, '')}/membership/author`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, files, title }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.ok) throw new Error(body.message || `hosted publish failed (${res.status})`);
  return { prNumber: body.number, prUrl: body.html_url, branch: body.branch, fork: null, updated: !!body.already, hosted: true };
}
