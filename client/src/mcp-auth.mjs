// SOW-025: device-flow sign-in for the MCP server, as a TWO-CALL flow so it fits an agent's request/response
// loop. A single tool call cannot both surface the user code AND wait for approval (the user needs the code
// before they can approve), so:
//   login          -> requests a device code, stashes the pending state, returns the verification URL + code
//   login_confirm   -> polls GitHub once; returns { pending: true } until the user approves, then { ok: true }
// Uses the SAME shared GitHub OAuth app (GITHUB_CLIENT_ID, device flow, no secret) the extension + npm client
// use. The token is written to the same local store the MCP reads on every run, so once signed in the MCP
// publishes with NO browser / NO Chrome (the owner requirement). Pure over injected deps for unit tests.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { requestDeviceCode, pollForToken } from './auth-device.mjs';
import { createRepoClient } from './github-repo.mjs';
import { resolveMembership } from './membership.mjs';
import { GITHUB_CLIENT_ID, SIGNUP_BASE, activeClientId, activeScope } from './signup-base.mjs';
import { UPSTREAM } from './context.mjs';

// SOW-026: classic mode keeps the account-wide public_repo scope; app mode targets the GitHub App (fork-scoped)
// and sends no scope (GitHub Apps ignore it). The active mode picks both the client id + the scope.
const SCOPE = activeScope();

// Read a repo file from a local clone if one is configured; null when there is no clone (standalone MCP) or the
// file is absent. Used to fold the git-native overrides + the members-index into login (mirrors cmdLogin).
function readLocal(repoPath) {
  if (!repoPath) return null;
  return (p) => { try { return fs.readFileSync(path.join(repoPath, p), 'utf8'); } catch { return null; } };
}

// Resolve the member's folder username: prefer the reconcile-maintained github_id -> username map
// (members-index.yml), so a GitHub login RENAME still targets the original folder; fall back to the lowercased
// login (the folder convention) when there is no local index. Matches cli-commands.usernameFromRepo.
function resolveUsername(readFile, githubId, login) {
  if (readFile) {
    try {
      const idx = yaml.load(readFile('house/members-index.yml') || '');
      const u = (idx?.members ?? {})[String(githubId)];
      if (u) return String(u);
    } catch { /* no/invalid index: fall back */ }
  }
  return String(login || '').toLowerCase();
}

/** Start device-flow sign-in: request a code, stash the pending state in the store, return the code + URL. */
export async function startDeviceLogin(ctx, {
  clientId = activeClientId(),
  requestCode = requestDeviceCode,
  fetch = globalThis.fetch,
} = {}) {
  if (!clientId) return { error: 'misconfigured', message: 'no GitHub client id is configured' };
  const dc = await requestCode({ clientId, scope: SCOPE, fetch });
  if (!dc?.device_code || !dc?.user_code) return { error: 'login_failed', message: 'GitHub did not return a device code' };
  ctx.store.set({ pendingDeviceLogin: { deviceCode: dc.device_code, clientId } });
  return {
    userCode: dc.user_code,
    verificationUri: dc.verification_uri,
    expiresIn: dc.expires_in,
    message: `Open ${dc.verification_uri} and enter the code ${dc.user_code}. Approve it, then call login_confirm. No browser extension needed.`,
  };
}

/**
 * Complete the sign-in started by startDeviceLogin: poll GitHub ONCE. Returns { pending: true } if the user has
 * not approved yet (call again), { ok: true, login, username, membership } on success, or { error } on failure.
 * On success it persists githubToken + identity (+ best-effort membership) to the store and clears the pending state.
 */
export async function confirmDeviceLogin(ctx, {
  makeRepoClient = (token) => createRepoClient({ token, upstream: UPSTREAM }),
  pollToken = pollForToken,
  resolveMembershipImpl = resolveMembership,
  readFile = readLocal(ctx.store.get('repoPath')),
  signupBase = SIGNUP_BASE,
  fetch = globalThis.fetch,
} = {}) {
  const pending = ctx.store.get('pendingDeviceLogin');
  if (!pending?.deviceCode) return { error: 'no_pending_login', message: 'No sign-in in progress. Call login first.' };

  // A token already minted on a prior confirm (whose /user lookup blipped) is stashed in pending.accessToken;
  // reuse it WITHOUT re-polling, since the device code is single-use and is already redeemed.
  let token = pending.accessToken;
  if (!token) {
    const r = await pollToken({ clientId: pending.clientId, deviceCode: pending.deviceCode, fetch });
    if (r?.access_token) {
      token = r.access_token;
    } else if (r?.error === 'authorization_pending' || r?.error === 'slow_down') {
      return { pending: true, message: 'Not approved yet. Approve the code in your browser, then call login_confirm again.' };
    } else {
      // expired_token / access_denied / anything else: clear the pending state so the agent restarts cleanly.
      ctx.store.set({ pendingDeviceLogin: null });
      return { error: r?.error || 'login_failed', message: `Device sign-in failed (${r?.error || 'unknown'}). Call login to start over.` };
    }
  }

  let user;
  try {
    user = await makeRepoClient(token).getAuthUser(); // { login, id }
  } catch {
    // The token IS valid; only the /user lookup blipped. Stash it (do NOT discard a good token or re-poll the
    // already-redeemed device code) and let the next login_confirm retry the lookup.
    ctx.store.set({ pendingDeviceLogin: { ...pending, accessToken: token } });
    return { pending: true, message: 'Signed in; verifying your GitHub identity hit a transient error. Call login_confirm again.' };
  }

  const username = resolveUsername(readFile, user.id, user.login);
  ctx.store.set({ githubToken: token, identity: { login: user.login, githubId: user.id, username }, pendingDeviceLogin: null });

  // Membership drives the paid-only publish notice. effectiveStatus folds the git-native overrides
  // (ban > staff > grandfather > Stripe) on top of the Stripe-only oracle, so we MUST read those files to avoid
  // wrongly blocking a grandfathered/staff member who has no Stripe sub. If we cannot read them (a standalone MCP
  // with no local clone), FAIL OPEN to 'unknown' (the SOW-005 gate applies the overrides server-side and is the
  // real authority) rather than caching a misleading non-paid status.
  const overridesReadable = readFile && readFile('house/roles.yml') != null;
  if (overridesReadable) {
    try {
      const { stripeStatus, membership, couponUntil, paidTier } = await resolveMembershipImpl({ githubId: user.id, token, signupBase, readFile, fetch });
      ctx.store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null, paidTier: paidTier ?? 'none' });
    } catch { ctx.store.set({ membership: 'unknown' }); }
  } else {
    ctx.store.set({ membership: 'unknown' });
  }
  return { ok: true, login: user.login, username, membership: ctx.store.get('membership') ?? 'unknown' };
}

/** Clear the local auth state (sign out). The token also remains valid on GitHub until revoked there. */
export function logout(ctx) {
  ctx.store.set({ githubToken: null, identity: null, membership: null, stripeStatus: null, pendingDeviceLogin: null });
  return { ok: true, message: 'Signed out locally. Revoke the token at https://github.com/settings/applications to fully revoke.' };
}
