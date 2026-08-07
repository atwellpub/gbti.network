#!/usr/bin/env node
// sow-194: build the repo-drafts index and write it to SIGNUP_KV `repo-drafts:index`, so the signup Worker can
// serve an owner-scoped WorkBench Drafts listing without a live repo scan (the free-tier 50-subrequest limit
// makes scanning 86 content files per request infeasible). Runs in CI on a content push (index-repo-drafts.yml)
// and is manually runnable. Same creds-gated + fail-loud posture as sync-overrides-mirror.mjs.
//
//   node scripts/index-repo-drafts.mjs            # write (needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN)
//   node scripts/index-repo-drafts.mjs --dry-run  # report what it would write, touch nothing

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRepoDraftsIndex, mirrorRepoDraftsToKv, REPO_DRAFTS_KV_KEY } from './lib/repo-drafts-index.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const dryRun = process.argv.includes('--dry-run');
  (async () => {
    try {
      const items = buildRepoDraftsIndex(ROOT);
      if (dryRun) {
        console.log(`index-repo-drafts: DRY RUN would write ${REPO_DRAFTS_KV_KEY} (${items.length} draft item${items.length === 1 ? '' : 's'}).`);
        for (const it of items) console.log(`  - ${it.owner}/${it.type}/${it.slug}  (${it.path})`);
        return;
      }
      const r = await mirrorRepoDraftsToKv({ root: ROOT });
      if (r.written) console.log(`index-repo-drafts: wrote ${REPO_DRAFTS_KV_KEY} (${items.length} draft item${items.length === 1 ? '' : 's'}, ${r.bytes} bytes).`);
      // A creds SKIP is the silent-no-op that would leave the WorkBench Drafts view empty. Fail LOUD (red run).
      else { console.error(`index-repo-drafts: ${REPO_DRAFTS_KV_KEY} NOT written (${r.reason}). Set CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN.`); process.exitCode = 1; }
    } catch (e) {
      console.error('index-repo-drafts: FAILED:', e?.message ?? e);
      process.exitCode = 1;
    }
  })();
}
