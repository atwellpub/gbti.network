// Shared request context (SOW-006): the collaborators the operations core needs (store, local reader,
// a repo-client factory, identity resolver). Built once from the store and passed to api.mjs and the MCP
// tools, so the CMS HTTP server and the stdio MCP entry are wired identically.

import { createReader, createStager } from './repo-fs.mjs';
import { createGithubReader } from './github-reader.mjs'; // sow-193: the clone-free reader, shared with the extension
import { createRepoClient } from './github-repo.mjs';
import { roleOf, rolesFromText, curatorsFromText, canCurateNews } from './roles.mjs';
import { resolveMembership } from './membership.mjs';
import { SIGNUP_BASE, authModeFor } from './signup-base.mjs';
import { createDevlog } from '../../membership/devlog-core.mjs';

export const UPSTREAM = process.env.GBTI_UPSTREAM || 'gbti-network/gbti.network';

// SOW-124: the npm host's devlog. Gated on GBTI_DEVLOG (the node host has no superadmin UI toggle; the operator
// who runs the local CMS is already the trusted node owner). Redaction is enforced by the core regardless.
const npmDevlog = createDevlog({ enabled: () => !!process.env.GBTI_DEVLOG, sink: console });

// The node host wires a Reader + Stager into the host-agnostic core. The extension host builds the same shape
// with GitHub-Contents-API + chrome.storage implementations, so api.mjs / operations.mjs / the MCP tools run
// identically on both.
//
// sow-193: the node host NO LONGER REQUIRES A CLONE. The reader is chosen by whether `repoPath` is configured:
//   - repoPath set   -> the fs reader (repo-fs.mjs). Faster, offline, and the maintainer workflow.
//   - repoPath unset -> the SAME GitHub Contents-API reader the extension uses (github-reader.mjs).
// Before this, an unset repoPath left every reader method returning [] or null, so a clone-less MCP host
// silently reported "no content" instead of failing, which is why nobody noticed it was unusable. The FORK is
// unaffected and still required for MCP publishing by the sow-193 split-by-host decision: a fork lives on
// GitHub, a clone lives on disk, and only the clone goes away here.
export function buildContext(store) {
  const repoPath = store.get('repoPath');
  // Read the token at construction, exactly as the extension does (ext-context.mjs:14,28). Safe because the
  // node host builds a FRESH context per request (index.mjs:60,68), so a token that arrives at sign-in is
  // picked up by the next call rather than being pinned for the process lifetime.
  const reader = repoPath
    ? createReader(repoPath)
    : createGithubReader({ upstream: UPSTREAM, token: store.get('githubToken'), devlog: npmDevlog });
  let membershipFlight = null;
  return {
    store,
    devlog: npmDevlog, // SOW-124: host-agnostic devlog (GBTI_DEVLOG gated; a no-op otherwise)
    reader,
    stager: createStager(repoPath),
    getRepoClient() {
      const token = store.get('githubToken');
      // SOW-157: app AND hosted read through the Worker proxies; only classic reads GitHub directly.
      return token ? createRepoClient({ token, upstream: UPSTREAM, appMode: authModeFor(store) !== 'classic' }) : null;
    },
    identity() {
      const id = store.get('identity');
      if (!id) return null;
      return { login: id.login, githubId: id.githubId, username: (id.username || id.login || '').toLowerCase() };
    },
    /** The signed-in user's role from the LOCAL house/roles.yml via the reader (UX gating only; the gate is
     * authoritative). Going through the reader keeps role resolution host-agnostic. */
    role() {
      const id = store.get('identity');
      if (!id?.githubId) return 'member';
      return roleOf(id.githubId, rolesFromText(reader.readFile('house/roles.yml')));
    },
    /** SOW-046 C: whether the signed-in user may publish news to Discord (admin/superadmin OR a roles.yml
     * `curators:` listing). UX gating only: the Worker re-checks server-side on every publish. */
    canCurate() {
      const id = store.get('identity');
      if (!id?.githubId) return false;
      const text = reader.readFile('house/roles.yml');
      return canCurateNews(roleOf(id.githubId, rolesFromText(text)), curatorsFromText(text).has(String(id.githubId)));
    },
    /** SOW-011: the effective membership cached at login (paid/trialing/...). Gates publish + the UI notice. */
    membership() {
      return store.get('membership') ?? 'unknown';
    },
    /** SOW-089 fix: self-heal an 'unknown' cache (see ext-context.mjs for the full story). */
    async membershipResolved() {
      const cached = store.get('membership');
      if (cached && cached !== 'unknown') return cached;
      const token = store.get('githubToken');
      const id = store.get('identity');
      if (!token || !id?.githubId) return 'unknown';
      if (!membershipFlight) {
        membershipFlight = resolveMembership({ githubId: String(id.githubId), token, signupBase: SIGNUP_BASE, readFile: (p) => reader.readFile(p) })
          .then(({ stripeStatus, membership, couponUntil }) => { store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null }); return membership ?? 'unknown'; })
          .catch(() => 'unknown')
          .finally(() => { membershipFlight = null; });
      }
      return membershipFlight;
    },
  };
}
