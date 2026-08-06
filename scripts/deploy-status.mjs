#!/usr/bin/env node
// sow-185: the deploy.yml CLI wrapper for the "still deploying" public-page notice. Two subcommands, run as
// two separate steps in the SAME job (so the same runner filesystem carries state between them):
//
//   node scripts/deploy-status.mjs mark    # BEFORE the build: mark changed content items pending in KV
//   node scripts/deploy-status.mjs clear   # AFTER a successful deploy: clear those same markers
//
// `mark` diffs from a durable watermark (deploy:last-marked-sha in SIGNUP_KV), not just this push's own
// `before`, so a run skipped by deploy.yml's own concurrency group during a burst never loses its slice of
// the diff (see scripts/lib/deploy-status-kv.mjs's header comment for the full reasoning). The marked item
// list is handed to `clear` via a small JSON file in the OS temp dir, so `clear` acts on exactly what `mark`
// marked rather than re-deriving it.
//
// This is an informational nicety, never a gate: unlike scripts/lib/kv-mirror.mjs's writes (which THROW on a
// real API error, deliberately failing the reconcile run loudly), every failure here is caught and logged,
// and the process always exits 0. A KV hiccup must never be capable of failing a site deploy.
//
// `mark`/`clear` take injectable deps (env, fetchImpl, gitDiff, readState/writeState) so the orchestration
// itself -- not just the pure lib functions it calls -- is directly unit-tested (test/deploy-status.test.mjs),
// including the watermark-only-advances-on-confirmed-success sequencing this file exists to get right.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  contentPathsChanged, readWatermark, writeWatermark, markPendingDeploy, clearPendingDeploy, resolveDiffFrom,
} from './lib/deploy-status-kv.mjs';

export const STATE_FILE = path.join(os.tmpdir(), 'gbti-deploy-status-marked-items.json');

// Returns the changed paths, or null if the diff itself could not be computed (e.g. the watermark SHA no
// longer resolves after a history rewrite, or a corrupted KV value) -- null is deliberately DISTINCT from a
// genuinely empty array, so mark() never confuses "we could not tell what changed" with "nothing changed".
export function defaultGitDiff(fromSha, toSha) {
  try {
    const out = fromSha
      ? execFileSync('git', ['diff', '--name-only', fromSha, toSha], { encoding: 'utf8' })
      : execFileSync('git', ['show', '--name-only', '--format=', toSha], { encoding: 'utf8' });
    return out.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch (e) {
    console.warn(`deploy-status: git diff failed (${fromSha || '(first push)'}..${toSha}), cannot tell what changed: ${e?.message ?? e}`);
    return null;
  }
}

export async function mark({
  env = process.env, fetchImpl = globalThis.fetch, now = new Date(), gitDiff = defaultGitDiff,
  writeState = (items) => fs.writeFileSync(STATE_FILE, JSON.stringify(items)),
} = {}) {
  const before = env.EVENT_BEFORE || '';
  const after = env.GITHUB_SHA || '';
  if (!after) { console.warn('deploy-status: GITHUB_SHA not set, skipping mark'); return; }

  let watermark = null;
  try { watermark = await readWatermark({ env, fetchImpl }); }
  catch (e) { console.warn(`deploy-status: watermark read failed, falling back to this push's own before: ${e?.message ?? e}`); }
  const from = resolveDiffFrom(watermark, before);

  const paths = gitDiff(from, after);
  if (paths === null) {
    // The diff itself failed -- this is NOT the same as "nothing changed". Do not advance the watermark (it
    // would wrongly treat an unknown range as an empty one) and do not overwrite the state file (nothing was
    // marked, so there is nothing new for `clear` to act on).
    console.warn('deploy-status: skipping mark (diff unavailable); watermark left as-is so the next run retries this same range.');
    return;
  }
  const items = contentPathsChanged(paths);
  console.log(`deploy-status: ${items.length} content item(s) changed (${from ?? '(first push)'}..${after}).`);

  writeState(items);

  // The watermark must only advance once every item in this range is CONFIRMED marked (or there was nothing
  // to mark). markPendingDeploy is all-or-nothing by RETURN CONTRACT (it either loops through every item and
  // returns written:true, or throws partway through) -- note this describes the contract, not necessarily
  // every side effect: if it throws on item N, items 1..N-1 already landed in KV with their own TTL; only
  // whether the FULL batch is confirmed complete is unreliable after a throw, which is exactly why the
  // watermark must not advance on one. Advancing it unconditionally would be worse than the burst-skip
  // problem the watermark exists to solve: a transient failure on item 2 of 3 would still push the watermark
  // past item 3, permanently excluding it from every future diff (nothing re-scans a range the watermark
  // already sits past). On any failure, leave the watermark where it was; the next run's diff naturally
  // re-includes this same range (idempotent -- marking an already-pending item again is harmless).
  let okToAdvance = items.length === 0;
  if (items.length > 0) {
    try {
      const r = await markPendingDeploy(items, { env, fetchImpl, now });
      if (r.written) {
        console.log(`deploy-status: marked pending: ${items.map((i) => `${i.type}:${i.slug}`).join(', ')}`);
        okToAdvance = true;
      } else {
        console.warn(`deploy-status: mark not written (${r.reason}); no notice will show for this push, watermark not advanced`);
      }
    } catch (e) { console.warn(`deploy-status: mark failed (deploy proceeds unaffected), watermark not advanced: ${e?.message ?? e}`); }
  }

  if (!okToAdvance) { console.warn('deploy-status: watermark left as-is; the next run will re-diff this same range.'); return; }
  try {
    const r = await writeWatermark(after, { env, fetchImpl });
    if (!r.written) console.warn(`deploy-status: watermark not written (${r.reason}); next run falls back to its own before`);
  } catch (e) { console.warn(`deploy-status: watermark write failed (next run falls back to its own before): ${e?.message ?? e}`); }
}

export async function clear({
  env = process.env, fetchImpl = globalThis.fetch,
  readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return []; } },
} = {}) {
  const items = readState();
  if (!Array.isArray(items) || items.length === 0) { console.log('deploy-status: nothing to clear.'); return; }
  try {
    const r = await clearPendingDeploy(items, { env, fetchImpl });
    if (r.written) console.log(`deploy-status: cleared: ${items.map((i) => `${i.type}:${i.slug}`).join(', ')}`);
    else console.warn(`deploy-status: clear not written (${r.reason}); the 10-minute TTL backstop will still expire it`);
  } catch (e) { console.warn(`deploy-status: clear failed, the 10-minute TTL backstop will still expire it: ${e?.message ?? e}`); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cmd = process.argv[2];
  (async () => {
    try {
      if (cmd === 'mark') await mark();
      else if (cmd === 'clear') await clear();
      else console.warn(`deploy-status: unknown subcommand "${cmd}" (expected mark | clear)`);
    } catch (e) {
      // Belt and suspenders: this script must never fail the deploy job.
      console.warn(`deploy-status: unexpected error, ignoring: ${e?.message ?? e}`);
    }
  })();
}
