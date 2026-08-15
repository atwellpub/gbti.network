#!/usr/bin/env node
// `npm run release`: cut a new extension version that (after review) reaches all extension owners.
// Interactively asks how to iterate the version (patch / minor / major), where FEATURES drive a minor bump,
// then syncs both version sources (extension/manifest.json + the src/lib/extension.ts mirror), rebuilds the
// bundles + repackages the served zip and latest.json, verifies drift, and prints the remaining outward
// steps (commit, push, publish to the store). The semver + text-swap helpers are pure and unit-tested; the
// prompt + build side effects run only under the CLI entry at the bottom.
//
//   npm run release                 # interactive: prompts patch|minor|major (Enter = minor)
//   npm run release -- minor        # non-interactive bump type (for scripting / CI)
//   npm run release -- minor --publish   # also run publish:extension after building (needs CWS_* creds)
//   npm run release -- patch --no-build  # bump the version files only, skip the rebuild
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'extension/manifest.json');
const MIRROR = path.join(ROOT, 'src/lib/extension.ts');

// The version token in each file (three capture groups: prefix, X.Y.Z, suffix).
const MANIFEST_RE = /("version"\s*:\s*")(\d+\.\d+\.\d+)(")/; // "version": "0.1.0"  (not manifest_version, a number)
const MIRROR_RE = /(\bversion:\s*')(\d+\.\d+\.\d+)(')/; // version: '0.1.0'  in the EXTENSION object
const KINDS = new Set(['patch', 'minor', 'major']);

/** Compute the next semver for a bump kind. Pure. */
export function nextVersion(current, kind) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(current).trim());
  if (!m) throw new Error(`current version is not X.Y.Z: ${current}`);
  let [major, minor, patch] = m.slice(1).map(Number);
  if (kind === 'major') { major += 1; minor = 0; patch = 0; }
  else if (kind === 'minor') { minor += 1; patch = 0; }
  else if (kind === 'patch') { patch += 1; }
  else throw new Error(`unknown bump kind: ${kind} (want patch, minor, or major)`);
  return `${major}.${minor}.${patch}`;
}

/** Read the current version out of a manifest.json text blob. Pure. */
export function readManifestVersion(text) {
  const m = MANIFEST_RE.exec(text);
  if (!m) throw new Error('no "version" field in extension/manifest.json');
  return m[2];
}

/** Swap the version token in a text blob, asserting EXACTLY one replacement. Pure. */
export function swapVersion(text, re, newV) {
  let count = 0;
  const out = text.replace(re, (_full, pre, _ver, post) => { count += 1; return `${pre}${newV}${post}`; });
  if (count !== 1) throw new Error(`expected exactly one version token, found ${count}`);
  return out;
}

function bumpFile(file, re, newV, label) {
  try { fs.writeFileSync(file, swapVersion(fs.readFileSync(file, 'utf8'), re, newV)); }
  catch (e) { throw new Error(`${label}: ${e.message}`); }
}

function run(cmd, args) {
  stdout.write(`\n$ ${cmd} ${args.join(' ')}\n`);
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`\n${cmd} ${args.join(' ')} failed (exit ${r.status}). Nothing was published; review the version-file changes and re-run.`); process.exit(r.status || 1); }
}

async function promptKind(current) {
  const opts = { patch: nextVersion(current, 'patch'), minor: nextVersion(current, 'minor'), major: nextVersion(current, 'major') };
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\nCurrent extension version: ${current}\n`);
    stdout.write('How should this release iterate the version?\n');
    stdout.write(`  1) patch  ${current} -> ${opts.patch}   bug fixes only, no new behavior\n`);
    stdout.write(`  2) minor  ${current} -> ${opts.minor}   NEW FEATURES  (recommended: features drive a minor bump)\n`);
    stdout.write(`  3) major  ${current} -> ${opts.major}   breaking changes\n`);
    const ans = (await rl.question('Choose [1-3, Enter = minor]: ')).trim().toLowerCase();
    if (ans === '' || ans === '2' || ans === 'minor') return 'minor';
    if (ans === '1' || ans === 'patch') return 'patch';
    if (ans === '3' || ans === 'major') return 'major';
    throw new Error(`unrecognized choice: "${ans}" (want 1, 2, 3, patch, minor, or major)`);
  } finally { rl.close(); }
}

export async function main({ argv = process.argv.slice(2) } = {}) {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const positional = argv.find((a) => !a.startsWith('--'));
  const current = readManifestVersion(fs.readFileSync(MANIFEST, 'utf8'));

  let kind = positional && KINDS.has(positional) ? positional : null;
  if (positional && !kind) { console.error(`Unknown bump type "${positional}". Use patch, minor, or major.`); process.exit(2); }
  if (!kind) {
    if (!stdin.isTTY) { console.error('No bump type given and not an interactive terminal. Pass one, e.g. `npm run release -- minor`.'); process.exit(2); }
    kind = await promptKind(current);
  }
  const next = nextVersion(current, kind);

  bumpFile(MANIFEST, MANIFEST_RE, next, 'extension/manifest.json');
  bumpFile(MIRROR, MIRROR_RE, next, 'src/lib/extension.ts');
  stdout.write(`\nBumped ${current} -> ${next} (${kind}).\n  extension/manifest.json\n  src/lib/extension.ts (EXTENSION.version)\n`);

  if (!flags.has('--no-build')) {
    // Canonical full rebuild (the extension-build-artifacts rule): client-ui/dist, then the extension
    // bundle + the repackaged zip + latest.json, then the drift guard.
    run('node', ['client-ui/build.mjs']);
    run('npm', ['run', 'build:extension']);
    run('node', ['scripts/check-extension.mjs']);
  }

  if (flags.has('--publish')) run('npm', ['run', 'publish:extension']);

  stdout.write(`\nRelease ${next} staged.`);
  stdout.write('\n\nRemaining steps (each is an outward action, so left for you to run):\n');
  // sow-239: do NOT print `git add -A`. Several agent sessions share this clone and one index, so a broad
  // stage sweeps whatever anyone else has in flight; two published articles were once found staged as
  // drafts that way. Print the explicit paths a release actually touches.
  stdout.write('  1. Review the diff, then stage EXPLICIT paths (never `git add -A` in this shared clone):\n');
  stdout.write('       git add extension/manifest.json src/lib/extension.ts public/extension\n');
  stdout.write(`       git commit -m "Release extension v${next}"\n`);
  stdout.write('  2. Push (instantly ships the site + the direct-zip channel):  git push\n');
  if (!flags.has('--publish')) {
    stdout.write('  3. Publish to the Chrome Web Store (the step that reaches installed owners):\n');
    stdout.write('       npm run publish:extension        (once the CWS_* creds are set)\n');
    stdout.write('       or the dashboard Package tab -> upload the zip -> Submit for review\n');
  }
  stdout.write('\nOwners auto-update from the store within about a day of approval (manual-review track: ~1-7 days).\n\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`release: ${e.message}`); process.exit(1); });
}
