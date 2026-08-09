// CLI command implementations (SOW-006). Scriptable, JSON-returning command functions so agents/CI can
// drive the same managed PR flow headless. The thin arg-parsing shell is cli.mjs; the logic lives here so
// it is unit-testable with injected collaborators. login is the one command that writes auth state (the
// device-flow token + resolved identity) into the store; everything else reads through the shared
// operations core, so the CLI, CMS UI, and MCP tools all behave identically.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { buildContentFile, parseContentFile } from './content-ops.mjs';
import * as ops from './operations.mjs';
import { resolveMembership } from './membership.mjs';
import { SIGNUP_BASE } from './settings-ops.mjs';
import { activeClientId, activeScope } from './signup-base.mjs';

/** Resolve a github_id to its folder username via the local repo's members-index, else fall back to login. */
export function usernameFromRepo(repoPath, githubId, fallbackLogin) {
  try {
    const parsed = yaml.load(fs.readFileSync(path.join(repoPath, 'house', 'members-index.yml'), 'utf8'));
    const u = (parsed?.members ?? {})[String(githubId)];
    if (u) return String(u);
  } catch {
    // no local index yet: fall back to the login (the folder convention is the lowercased login)
  }
  return String(fallbackLogin || '').toLowerCase();
}

/**
 * `gbti login`: GitHub device flow -> token -> resolve identity -> resolve membership -> persist to the store.
 * @param deps { store, clientId, deviceFlowLogin, makeRepoClient, onPrompt, signupBase?, fetchImpl? }
 */
export async function cmdLogin(deps) {
  const { store, clientId = activeClientId(), deviceFlowLogin, makeRepoClient, onPrompt, signupBase = SIGNUP_BASE, fetchImpl = globalThis.fetch } = deps;
  if (!clientId) throw new Error('no GitHub client id; set GBTI_GITHUB_CLIENT_ID (device-flow OAuth app, see human-todo)');

  // SOW-026: the active auth mode picks the client id + scope. Classic mode keeps the account-wide
  // public_repo scope; app mode targets the GitHub App (fork-scoped) and sends no scope (GitHub Apps ignore it).
  const { accessToken } = await deviceFlowLogin({ clientId, scope: activeScope(), onPrompt });
  const user = await makeRepoClient(accessToken).getAuthUser(); // { login, id }
  const repoPath = store.get('repoPath');
  const username = repoPath ? usernameFromRepo(repoPath, user.id, user.login) : String(user.login).toLowerCase();

  store.set({ githubToken: accessToken, identity: { login: user.login, githubId: user.id, username } });

  // SOW-011: resolve + cache the effective membership so the client can show the "membership required to
  // publish" notice and block a trial publish before opening any canonical PR. Best-effort: any failure
  // leaves membership 'unknown', which fails OPEN to the gate (a paid member is never wrongly blocked).
  try {
    const readLocal = repoPath
      ? (p) => {
          try {
            return fs.readFileSync(path.join(repoPath, p), 'utf8');
          } catch {
            return null;
          }
        }
      : undefined;
    const { stripeStatus, membership, couponUntil, paidTier } = await resolveMembership({ githubId: user.id, token: accessToken, signupBase, readFile: readLocal, fetch: fetchImpl });
    store.set({ stripeStatus, membership, couponUntil: couponUntil ?? null, paidTier: paidTier ?? 'none' });
  } catch {
    // leave membership unset (treated as 'unknown')
  }
  return { ok: true, login: user.login, username, membership: store.get('membership') ?? 'unknown' };
}

/** `gbti whoami`: identity + auth/membership status + settings. */
export function cmdWhoami(ctx) {
  return ops.getStatus(ctx);
}

/** `gbti new <type> --title ... [--slug ...] [...]`: scaffold a validated file into the local working copy. */
export function cmdNew(ctx, { type, input, body }) {
  const id = ctx.identity?.();
  if (!id?.username) throw new Error('no identity; run `gbti login`');
  const repoPath = ctx.store.get('repoPath');
  if (!repoPath) throw new Error('no repoPath set; configure the local content repo first');

  const built = buildContentFile({ type, username: id.username, input, body: body ?? '' });
  const abs = path.join(repoPath, built.path);
  if (fs.existsSync(abs)) throw new Error(`already exists: ${built.path}`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, built.markdown);
  return { ok: true, path: built.path };
}

/** `gbti publish <file>`: read a staged local content file and open/update its PR through the gate. */
export async function cmdPublish(ctx, { file }) {
  if (!file) throw new Error('usage: gbti publish <file>');
  const repoPath = ctx.store.get('repoPath');
  const abs = path.isAbsolute(file) ? file : path.join(repoPath ?? '.', file);
  const { frontmatter, body } = parseContentFile(fs.readFileSync(abs, 'utf8'));
  return ops.publish(ctx, { type: frontmatter.type, input: frontmatter, body });
}

/** `gbti pr [number]`: list the member PRs, or the gate status of one. */
export async function cmdPr(ctx, { number }) {
  if (number === undefined || number === null || number === '') return ops.listPRs(ctx);
  return ops.prStatus(ctx, { number });
}
