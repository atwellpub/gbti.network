// SOW-157: hosted-member enrollment. The hosted authoring endpoint resolves a member's folder ONLY through
// house/members-index.yml (github_id -> username), so a paid member with no entry cannot publish (409
// folder_not_provisioned). This module fills the index from the reconcile run: an idempotent sweep over the
// gathered members (Stripe paid + grandfathered), validated fail-closed, written as ONE bot PR the reconcile
// merges itself (the coupon-grants pattern; the gbtilabs bot is superadmin so this is the SOW-108 lane).
//
// Security rules (adversarial review 2026-07-25):
//   - The folder for a member with EXISTING content evidence is the resolveUsername result (profile
//     links.github / the repo tree), never their current login (real case: folder hudson, login atwellpub).
//   - A folder minted for a NEW member comes from re-resolving github_id -> login via the GitHub API
//     (the immutable id is the key; a dispatch payload login is never trusted), lowercased, FOLDER_RE-safe.
//   - A minted folder that ALREADY exists on disk without index evidence is REJECTED (folder-hijack guard:
//     renaming your GitHub account to an unclaimed legacy folder must not hand you that folder).
//   - Every planned addition must round-trip through parseMembersIndex AND js-yaml before any PR opens.
//   - Concurrency: the reconcile workflow runs in a single concurrency group and the PR is merged in the
//     same run, so enroll PRs never sit open to conflict (the SOW-152 lesson).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { parseMembersIndex } from '../../membership/hosted-author.mjs';

export const MEMBERS_INDEX_PATH = 'house/members-index.yml';
const FOLDER_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * The unenrolled effective-paid members from a reconcile gather. `members` entries carry
 * { githubId, githubLogin, effective: { status }, username } (memberEntryFor / gatherOverrideOnlyMembers);
 * banned members surface as effective 'banned' and are excluded naturally. `username` is the
 * resolveUsername result (index first, then profile-links evidence): when the INDEX already has the id the
 * member is not a candidate; a username from the evidence fallback is the folder to formalize.
 */
export function enrollmentCandidates(members, membersIndex) {
  const out = [];
  for (const m of members ?? []) {
    const id = String(m?.githubId ?? '');
    if (!id) continue;
    if (m?.effective?.status !== 'paid') continue;
    if (membersIndex?.get?.(id)) continue; // already enrolled
    out.push({ githubId: id, hintLogin: m.githubLogin ?? null, evidenceFolder: m.username ?? null });
  }
  return out;
}

/** Re-resolve github_id -> current login via the GitHub API (immutable key). Returns the login or null. */
export async function resolveLoginById(githubId, { token, fetchImpl = globalThis.fetch } = {}) {
  try {
    const res = await fetchImpl(`https://api.github.com/user/${encodeURIComponent(String(githubId))}`, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        Accept: 'application/vnd.github+json',
        'User-Agent': 'gbti-network-reconcile',
      },
    });
    if (!res?.ok) return null;
    const data = await res.json();
    return data?.login ? String(data.login) : null;
  } catch {
    return null;
  }
}

/**
 * Plan the index additions. Pure. `loginById` is a Map github_id -> API-resolved login (only consulted for
 * candidates with no evidence folder). `existingFolders` is the lowercase Set of members/ directory names.
 * Fail closed: any doubt rejects the candidate (they stay 409 and the reject is logged for the owner).
 */
export function planEnrollments({ candidates, loginById, existingFolders, membersIndex } = {}) {
  const additions = [];
  const rejects = [];
  const claimed = new Set([...(membersIndex?.values?.() ?? [])]);
  for (const c of candidates ?? []) {
    const id = String(c.githubId);
    let folder = null;
    if (c.evidenceFolder) {
      folder = String(c.evidenceFolder).toLowerCase();
      if (!FOLDER_RE.test(folder)) { rejects.push({ githubId: id, reason: `evidence folder ${c.evidenceFolder} is not a valid folder name` }); continue; }
    } else {
      const login = loginById?.get?.(id);
      if (!login) { rejects.push({ githubId: id, reason: 'could not re-resolve the login from the github_id' }); continue; }
      folder = String(login).toLowerCase();
      if (!FOLDER_RE.test(folder)) { rejects.push({ githubId: id, reason: `login ${login} does not fit the folder rules; enroll manually` }); continue; }
      if (existingFolders?.has?.(folder)) {
        // The folder exists on disk but nothing maps this id to it: minting it would hand this account
        // another member's (or a legacy) folder. Manual provisioning only.
        rejects.push({ githubId: id, reason: `members/${folder}/ already exists without index evidence for this github_id` });
        continue;
      }
    }
    if (claimed.has(folder)) { rejects.push({ githubId: id, reason: `folder ${folder} is already claimed by another github_id` }); continue; }
    claimed.add(folder);
    additions.push({ githubId: id, folder });
  }
  return { additions, rejects };
}

/**
 * Append the additions to the index text (inside the `members:` mapping) and PROVE the result parses back
 * to exactly these mappings via BOTH parsers (the Worker's line parser and real YAML). Throws on any
 * mismatch so a malformed write can never reach a PR.
 */
export function appendIndexEntries(indexText, additions, now = new Date()) {
  if (!additions?.length) return indexText;
  const stamp = now.toISOString().slice(0, 10);
  const lines = [
    `  # SOW-157: hosted-member enrollment appended by reconcile (${stamp}).`,
    ...additions.map((a) => `  "${a.githubId}": ${a.folder}`),
  ];
  const next = indexText.replace(/\n*$/, '\n') + lines.join('\n') + '\n';
  const lineParsed = parseMembersIndex(next);
  const yamlParsed = yaml.load(next)?.members ?? {};
  for (const a of additions) {
    if (lineParsed.get(a.githubId) !== a.folder) throw new Error(`enroll: appended entry for ${a.githubId} did not round-trip the line parser`);
    if (String(yamlParsed[a.githubId] ?? '') !== a.folder) throw new Error(`enroll: appended entry for ${a.githubId} did not round-trip YAML`);
  }
  const ids = [...next.matchAll(/^\s*"?(\d{1,20})"?\s*:/gm)].map((m) => m[1]);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`enroll: duplicate github_id ${dup} after the append`);
  return next;
}

/**
 * The reconcile step: plan and (unless dryRun) write the enrollment PR + merge it. Returns a summary the
 * reconcile logs. Fail soft overall (a miss heals on the next scheduled run); fail CLOSED per candidate.
 */
export async function syncEnrollments({
  members, overrides, root, env = process.env, github = null,
  now = new Date(), dryRun = true, fetchImpl = globalThis.fetch, resolveLogin = resolveLoginById,
} = {}) {
  const candidates = enrollmentCandidates(members, overrides?.membersIndex);
  if (!candidates.length) return { synced: false, reason: 'no unenrolled effective-paid members', additions: [], rejects: [] };

  const loginById = new Map();
  for (const c of candidates) {
    if (c.evidenceFolder) continue;
    const login = await resolveLogin(c.githubId, { token: env.GITHUB_BOT_TOKEN, fetchImpl });
    if (login) loginById.set(c.githubId, login);
  }
  let existingFolders = new Set();
  try { existingFolders = new Set(fs.readdirSync(path.join(root, 'members')).map((d) => d.toLowerCase())); } catch { /* keep empty; the claimed-set still guards */ }

  const { additions, rejects } = planEnrollments({ candidates, loginById, existingFolders, membersIndex: overrides?.membersIndex });
  if (!additions.length) return { synced: false, reason: 'no valid enrollment additions', additions, rejects };
  if (dryRun) return { synced: false, reason: 'dry run', additions, rejects };
  if (!github) return { synced: false, reason: 'no github client to write the enrollment PR', additions, rejects };

  const indexText = fs.readFileSync(path.join(root, MEMBERS_INDEX_PATH), 'utf8');
  const nextText = appendIndexEntries(indexText, additions, now);
  const branch = `gbti/enroll-${now.getTime()}`;
  const baseRef = await github.getRef('heads/main');
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error('enroll: cannot resolve the main head sha');
  await github.createRef(branch, baseSha);
  const existing = await github.getContent(MEMBERS_INDEX_PATH, branch);
  await github.putContent(MEMBERS_INDEX_PATH, {
    message: 'reconcile: enroll hosted members into the members index (SOW-157)',
    content: Buffer.from(nextText, 'utf8').toString('base64'),
    branch,
    sha: existing?.sha,
  });
  const pull = await github.createPull({
    title: 'reconcile: hosted-member enrollment (SOW-157)',
    head: branch,
    base: 'main',
    body: `Enrolls ${additions.length} effective-paid member(s) into house/members-index.yml so hosted authoring can resolve their folder.`,
  });
  await github.mergePull(pull.number, { method: 'squash' });
  return { synced: true, prNumber: pull.number, additions, rejects };
}
