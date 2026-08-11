// sow-212: the test-account reset CLI. Wipes ONE allowlisted test account's signup state so the signup +
// coupon flow (https://gbti.network/codeable-invite/) can be run again from scratch.
//
// Usage:
//   node scripts/reset-test-member.mjs --github-id 12345                      # dry-run: print the plan
//   node scripts/reset-test-member.mjs --github-id 12345 --apply              # enact
//   node scripts/reset-test-member.mjs --github-id 12345 --apply --with-content   # + draft their content
//   node scripts/reset-test-member.mjs --github-id 12345 --apply --operator hudson  # tag the audit record
//
// TWO REFUSALS, both computed before anything is written:
//   - the id must be listed in house/test-accounts.yml (a reviewed change, not a shell variable),
//   - STRIPE_SECRET_KEY must not be a live-mode key.
//
// Dry-run is the default. The KV deletes + audit need CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN;
// the house-records PR needs GITHUB_BOT_TOKEN + GITHUB_CONTENT_REPO; the Stripe delete needs
// STRIPE_SECRET_KEY. A missing client makes its step a reported no-op, never a silent skip.
//
// Read `.data/ops/member-ops/runbook-test-account-reset.md` before the first run.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createStripeClient } from '../clients/stripe.mjs';
import { createGitHubClient } from '../clients/github.mjs';
import { buildRepoIndex } from './lib/repo-content.mjs';
import { readTestAccounts, runReset, planReset, refusalsFor } from './lib/reset-test-member.mjs';
import { MEMBERS_INDEX_PATH } from './lib/erase-member.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

export function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  return {
    githubId: get('--github-id'),
    username: get('--username'),
    operator: get('--operator'),
    apply: argv.includes('--apply') && !argv.includes('--dry-run'),
    withContent: argv.includes('--with-content'),
  };
}

/** Only the clients whose credentials are present, so a partial run (KV-only) still works. */
export function buildResetClients(env, fetchImpl = globalThis.fetch) {
  return {
    stripe: env.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null,
    github: env.GITHUB_BOT_TOKEN && env.GITHUB_CONTENT_REPO ? createGitHubClient({ token: env.GITHUB_BOT_TOKEN, repo: env.GITHUB_CONTENT_REPO, fetch: fetchImpl }) : null,
  };
}

function readMembersIndex(root) {
  const file = path.join(root, MEMBERS_INDEX_PATH);
  if (!fs.existsSync(file)) return null;
  try { return yaml.load(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

async function main() {
  const { githubId, username, operator, apply, withContent } = parseArgs(process.argv.slice(2));
  if (!githubId) {
    console.error('error: --github-id <id> is required');
    console.error('usage: node scripts/reset-test-member.mjs --github-id <id> [--username <name>] [--operator <id>] [--apply] [--with-content]');
    process.exitCode = 1;
    return;
  }

  const env = process.env;
  const allowedIds = readTestAccounts(ROOT);
  const membersIndexParsed = readMembersIndex(ROOT);

  console.log(`\nTest-account reset for github_id=${githubId}  [${apply ? 'APPLY' : 'DRY-RUN'}${withContent ? ' +CONTENT' : ''}]\n`);

  // Refuse BEFORE printing the plan or reading the repo. A refusal that arrives after a full plan listing
  // reads, in a scrollback, as though the plan ran.
  const refusals = refusalsFor({ githubId, allowedIds, env });
  if (refusals.length) {
    console.error('REFUSED. Nothing was read or written.\n');
    for (const r of refusals) console.error(`  - ${r}`);
    console.error('');
    process.exitCode = 1;
    return;
  }

  for (const s of planReset({ githubId, withContent })) {
    console.log(`  ${s.step.padEnd(20)} ${s.action}`);
  }
  console.log('');

  const clients = buildResetClients(env);
  const files = username ? buildRepoIndex(ROOT).byUsername?.[username]?.files ?? [] : [];

  const result = await runReset({
    githubId, allowedIds, apply, withContent, operator, env, clients, files, membersIndexParsed,
  });

  for (const w of result.warnings ?? []) console.log(`  [warn] ${w}`);
  if (result.warnings?.length) console.log('');

  if (!apply) {
    console.log('Dry-run: nothing was changed. Re-run with --apply to enact.\n');
    return;
  }

  console.log('Enacted steps:');
  for (const s of result.steps) console.log(`  ${s.outcome.padEnd(9)} ${s.step.padEnd(20)} ${s.detail ?? ''}`);
  console.log('');
  if (result.audit?.recorded) console.log(`Audit: recorded ${result.audit.key} (kind: ${result.record.kind}, status: ${result.record.status}).`);
  else console.log(`Audit: NOT recorded (${result.audit?.reason}).`);

  const errored = result.steps.filter((s) => s.outcome === 'error');
  if (errored.length) {
    console.error(`\n[error] ${errored.length} step(s) failed: ${errored.map((s) => s.step).join(', ')}.`);
    process.exitCode = 1;
    return;
  }

  console.log('\nThe account is reset. Before re-testing, note the house-records PR must MERGE and the site must');
  console.log('redeploy before the grandfather grant is really gone from the Worker\'s view, and the overrides');
  console.log('mirror refreshes on a 6-hourly cron. Run the "Sync overrides mirror" workflow by hand to force it.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
