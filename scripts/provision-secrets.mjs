// Secret provisioning helper (operational tooling, no secrets committed).
//
// Cross-references each required secret against THREE places and helps you push one to production at a time:
//   1. the production signup Worker   (`wrangler secret list --env production`, names only)
//   2. GitHub Actions                 (`gh api .../actions/secrets`, names only)
//   3. your local env files           (`.env`, `workers/signup/.dev.vars`), value never printed
//
// It NEVER prints a secret value. It reports presence, a safe length, and a type hint (e.g. Stripe TEST vs LIVE
// from the key prefix). `--put` reads the local value and pipes it straight into `wrangler secret put` /
// `gh secret set` over stdin, so the value never appears in argv, the shell history, or this script's output.
//
// Usage:
//   node scripts/provision-secrets.mjs                 # status table for every tracked secret
//   node scripts/provision-secrets.mjs NAME            # focus one: where it is, where it is missing, next step
//   node scripts/provision-secrets.mjs NAME --put      # push the LOCAL value to the prod Worker (asks first)
//   node scripts/provision-secrets.mjs NAME --put --actions   # push to GitHub Actions instead of the Worker
//
// Requires `wrangler` (logged in) for Worker checks/puts and `gh` (logged in) for Actions checks/puts. A missing
// CLI degrades to "unknown" for that location rather than crashing.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WORKER_DIR = path.join(ROOT, 'workers', 'signup');
const REPO = process.env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
const ENV_FILES = ['workers/signup/.dev.vars', '.env']; // search order; first hit wins for a value

// Each tracked secret: where it must live, whether a local value can be reused, and any caution.
// localName covers the GitHub Actions rule that secret names cannot start with GITHUB_ (GH_BOT_TOKEN <- GITHUB_BOT_TOKEN).
// pairedIdVar: a non-secret CLIENT_ID that this secret belongs to. If the prod value (wrangler.toml
// [env.production.vars]) differs from the local .dev.vars value, the local secret is for a DIFFERENT app
// (sandbox), so pushing it to prod would create a client-id/secret MISMATCH. The script refuses unless --force.
const REGISTRY = [
  { name: 'GITHUB_OAUTH_CLIENT_SECRET', targets: ['worker'], pairedIdVar: 'GITHUB_OAUTH_CLIENT_ID', note: 'Website GitHub signup (OAuth code exchange). SEPARATE sandbox vs prod apps.' },
  { name: 'DISCORD_OAUTH_CLIENT_SECRET', targets: ['worker'], pairedIdVar: 'DISCORD_OAUTH_CLIENT_ID', caution: 'human-todo flags resetting this before launch (it was read in a session). Reset, then push the fresh value.', note: 'Website Discord connect (shared app).' },
  { name: 'REGATE_DISPATCH_TOKEN', targets: ['worker'], note: 'Post-payment re-gate + the SOW-038 admin ops buttons. Same value as GH_BOT_TOKEN / GITHUB_BOT_TOKEN.', localName: 'GITHUB_BOT_TOKEN' },
  { name: 'STRIPE_SECRET_KEY', targets: ['worker', 'actions'], classify: 'stripe', note: 'Worker=write key, Actions=read key. Prod must be a LIVE key for real charges.' },
  { name: 'STRIPE_PRICE_ID', targets: ['worker'], kind: 'var', note: 'The annual $150 price id. NON-SECRET var in wrangler.toml [env.production.vars], not a secret.' },
  { name: 'STRIPE_WEBHOOK_SECRET', targets: ['worker'], optional: true, note: 'Only if the optional Stripe webhook is enabled.' },
  { name: 'SESSION_SECRET', targets: ['worker'], note: 'Signed session/state cookie.' },
  { name: 'MEMBER_CONTENT_KEY', targets: ['worker'], note: 'AES key for member-only content (never leaves the Worker).' },
  { name: 'TURNSTILE_SECRET_KEY', targets: ['worker'], note: 'Signup bot check.' },
  { name: 'DISCORD_BOT_TOKEN', targets: ['worker', 'actions'], caution: 'human-todo flags resetting this before launch (session-exposed).' },
  { name: 'GH_BOT_TOKEN', targets: ['actions'], localName: 'GITHUB_BOT_TOKEN', note: 'gbtilabs PAT for Actions (gate/reconcile/award).' },
  { name: 'CF_API_TOKEN', targets: ['actions'], note: 'Cloudflare KV write for the reconcile overrides mirror.' },
  { name: 'RESEND_API_KEY', targets: ['actions'], optional: true, note: 'Transactional email (day-87 reminder).' },
  // SOW-120: the X (Twitter) syndication destination. OAuth 1.0a user-context (long-lived, no refresh). The
  // drain runs in the Worker, so these are Worker-only (Actions only enqueues). Free tier is fine for write.
  { name: 'X_API_KEY', targets: ['worker'], optional: true, note: 'X app consumer key (Keys and tokens > Consumer Keys).' },
  { name: 'X_API_SECRET', targets: ['worker'], optional: true, note: 'X app consumer secret.' },
  { name: 'X_ACCESS_TOKEN', targets: ['worker'], optional: true, note: 'X brand-account access token (Read and Write; regenerate if it was minted read-only).' },
  { name: 'X_ACCESS_SECRET', targets: ['worker'], optional: true, note: 'X brand-account access token secret.' },
  // SOW-122: the Bluesky syndication destination (free, a normal auto channel). Worker-only.
  { name: 'BLUESKY_HANDLE', targets: ['worker'], optional: true, note: 'The brand Bluesky handle, e.g. gbti.bsky.social.' },
  { name: 'BLUESKY_APP_PASSWORD', targets: ['worker'], optional: true, note: 'A bsky.app App Password (Settings > App Passwords), NOT the account password.' },
  // SOW-123: the Mastodon syndication destination (free, a normal auto channel). Worker-only.
  // sow-159: Mastodon RETIRED (2026-07-28). Provisioning rows removed so the token is never re-added.
  // The adapter + secret-key map stay on disk; re-enable per .data/ops/channel-ops/mastadon.md.
  // SOW-134: the Hashnode syndication destination (free, a normal auto channel). Worker-only. Full-body
  // crossposts to the GBTI Hashnode publication with a canonical link home.
  { name: 'HASHNODE_TOKEN', targets: ['worker'], optional: true, note: 'A Hashnode Personal Access Token (hashnode.com/settings/developer) with publish scope.' },
  { name: 'HASHNODE_PUBLICATION_ID', targets: ['worker'], kind: 'var', optional: true, note: 'The gbti.hashnode.dev publication id (657cab5387df3eed7ba621d7). NON-SECRET var; may live in wrangler.toml [env.production.vars].' },
  // SOW-133: the Chrome Web Store Publish API credentials for the publish-extension Action (Actions secrets, not
  // the Worker). One-time Google Cloud OAuth setup in .data/ops/extension-ops/chrome-web-store.md. Optional: the
  // publish script skips cleanly when unset.
  { name: 'CWS_CLIENT_ID', targets: ['actions'], optional: true, note: 'Chrome Web Store OAuth client id (Google Cloud project, Chrome Web Store API enabled).' },
  { name: 'CWS_CLIENT_SECRET', targets: ['actions'], optional: true, note: 'The OAuth client secret paired with CWS_CLIENT_ID.' },
  { name: 'CWS_REFRESH_TOKEN', targets: ['actions'], optional: true, note: 'A refresh token for the publisher account (gbti.labs), obtained once via the OAuth consent flow.' },
];

// ---- safe local env parsing (values are read but NEVER printed) ----
function parseEnvFile(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const out = new Map();
  for (const raw of fs.readFileSync(abs, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out.set(key, val);
  }
  return out;
}
const ENV_CACHE = new Map();
function envMap(rel) { if (!ENV_CACHE.has(rel)) ENV_CACHE.set(rel, parseEnvFile(rel)); return ENV_CACHE.get(rel); }

const PLACEHOLDER = /^(REPLACE|CHANGEME|YOUR[_-]|XXX+|TODO|<.*>|sk_test_placeholder)/i;
function isPlaceholder(v) { return !v || PLACEHOLDER.test(v); }

/** Find a real local value for a secret. Tries the secret's own name first, then its localName fallback (the
 *  GITHUB_-prefix rule), across the env files in order. Returns { file, value, key } or null. NEVER printed. */
function findLocal(reg) {
  const keys = reg.localName ? [reg.name, reg.localName] : [reg.name];
  for (const f of ENV_FILES) {
    const m = envMap(f);
    if (!m) continue;
    for (const key of keys) if (m.has(key) && !isPlaceholder(m.get(key))) return { file: f, value: m.get(key), key };
  }
  return null;
}

/** Stripe key mode from the prefix (test/live), or null for non-stripe / unrecognized. The prefix is not a usable
 *  credential by itself, so reporting the MODE is safe and is exactly the live-vs-test signal we need. */
function stripeMode(v) { const m = /^(sk|rk)_(live|test)_/.exec(v || ''); return m ? m[2] : null; }

/** Read a NON-SECRET var from workers/signup/wrangler.toml [env.production.vars] (e.g. a public OAuth client id). */
function prodVar(key) {
  const abs = path.join(WORKER_DIR, 'wrangler.toml');
  if (!fs.existsSync(abs)) return null;
  let inProd = false;
  for (const raw of fs.readFileSync(abs, 'utf8').split('\n')) {
    const line = raw.trim();
    if (line.startsWith('[')) { inProd = line === '[env.production.vars]'; continue; }
    if (!inProd) continue;
    const m = new RegExp('^' + key + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s#]+))').exec(line);
    if (m) return m[2] ?? m[3] ?? m[4] ?? null;
  }
  return null;
}
function localVar(key) { for (const f of ENV_FILES) { const m = envMap(f); if (m && m.has(key)) return m.get(key); } return null; }

/** For a secret tied to a non-secret CLIENT_ID, compare prod vs local id. A mismatch means the local secret is for
 *  a DIFFERENT (sandbox) app, so pushing it to prod would create a client-id/secret mismatch. Returns null if not
 *  applicable or undeterminable. */
function pairCheck(reg) {
  if (!reg.pairedIdVar) return null;
  const prodId = prodVar(reg.pairedIdVar);
  const localId = localVar(reg.pairedIdVar);
  if (!prodId || !localId) return null;
  return { mismatch: prodId !== localId, prodId, localId };
}

/** A safe, value-free description of a local hit: length + a type hint, never the value. */
function describeLocal(reg, hit) {
  if (!hit) return 'absent';
  const v = hit.value;
  let hint = `${v.length} chars`;
  if (reg.classify === 'stripe') hint = stripeMode(v) ? `${stripeMode(v).toUpperCase()} key` : 'unknown prefix';
  else if (reg.classify === 'stripe-price') hint = v.startsWith('price_') ? 'price id (mode unknown)' : 'not a price_ id?';
  return `${path.basename(hit.file)} (${hint})`;
}

// ---- location checks (names only) ----
function sh(cmd, args, opts = {}) { return spawnSync(cmd, args, { encoding: 'utf8', ...opts }); }

let WORKER_NAMES = null; // null = unknown (cli missing/not logged in)
function workerNames() {
  if (WORKER_NAMES !== null) return WORKER_NAMES;
  const r = sh('npx', ['wrangler', 'secret', 'list', '--env', 'production'], { cwd: WORKER_DIR });
  if (r.status !== 0 || !r.stdout) { WORKER_NAMES = undefined; return WORKER_NAMES; }
  try { WORKER_NAMES = new Set(JSON.parse(r.stdout).map((x) => x.name)); } catch { WORKER_NAMES = undefined; }
  return WORKER_NAMES;
}
let ACTION_NAMES = null;
function actionNames() {
  if (ACTION_NAMES !== null) return ACTION_NAMES;
  const r = sh('gh', ['api', `repos/${REPO}/actions/secrets`, '--paginate', '--jq', '.secrets[].name']);
  if (r.status !== 0) { ACTION_NAMES = undefined; return ACTION_NAMES; }
  ACTION_NAMES = new Set(r.stdout.split('\n').map((s) => s.trim()).filter(Boolean));
  return ACTION_NAMES;
}
function mark(set, name) { return set === undefined ? '?' : set.has(name) ? 'SET' : 'MISSING'; }

// ---- report ----
function statusOf(reg) {
  // A non-secret var lives in wrangler.toml [env.production.vars], not the secret store. Check it there.
  if (reg.kind === 'var') {
    const pv = prodVar(reg.name);
    return { reg, w: pv ? 'var-set' : 'var-MISSING', a: 'n/a', local: findLocal(reg), verdict: pv ? 'ok (non-secret var in wrangler.toml)' : 'MISSING (set in wrangler.toml [env.production.vars])' };
  }
  const wn = reg.targets.includes('worker') ? workerNames() : null;
  const an = reg.targets.includes('actions') ? actionNames() : null;
  const local = findLocal(reg);
  const w = reg.targets.includes('worker') ? mark(wn, reg.name) : 'n/a';
  const a = reg.targets.includes('actions') ? mark(an, reg.name) : 'n/a';
  const targetMissing = (reg.targets.includes('worker') && w === 'MISSING') || (reg.targets.includes('actions') && a === 'MISSING');
  const setSomewhere = w === 'SET' || a === 'SET';
  let verdict;
  // Stripe is special: production MUST be a LIVE key/price, and the local .dev.vars value is the sandbox/TEST one.
  // So never auto-mark a local TEST value as push-ready, and flag a SET name that may still be test-mode.
  if (reg.classify === 'stripe' || reg.classify === 'stripe-price') {
    const mode = reg.classify === 'stripe' ? stripeMode(local?.value) : null;
    if (setSomewhere) verdict = 'SET (mode not readable here; confirm LIVE in the Stripe Dashboard)';
    else if (mode === 'live') verdict = 'READY (LIVE local -> push)';
    else if (local) verdict = 'NEEDS LIVE (local is test/unknown)';
    else verdict = 'NEEDS LIVE KEY (none local)';
  } else if (targetMissing && local && pairCheck(reg)?.mismatch) {
    // Prod is MISSING and the local value is for a different (sandbox) app -> pushing it would mismatch.
    verdict = `LOCAL IS SANDBOX (${reg.pairedIdVar} differs: prod has a different app; do NOT push local)`;
  } else if (targetMissing && local) {
    verdict = 'READY (local value -> push)';
  } else if (targetMissing && !local) {
    verdict = 'MISSING (no local value)';
  } else if (setSomewhere) {
    verdict = 'ok';
  } else {
    verdict = 'unknown';
  }
  return { reg, w, a, local, verdict };
}

function printTable() {
  const wn = workerNames(); const an = actionNames();
  if (wn === undefined) console.log('! wrangler unavailable or not logged in: Worker column shows "?"');
  if (an === undefined) console.log('! gh unavailable or not logged in: Actions column shows "?"\n');
  console.log('SECRET                         WORKER   ACTIONS  LOCAL                                   VERDICT');
  console.log('-'.repeat(108));
  for (const reg of REGISTRY) {
    const s = statusOf(reg);
    const row = `${reg.name.padEnd(30)} ${s.w.padEnd(8)} ${s.a.padEnd(8)} ${describeLocal(reg, s.local).slice(0, 38).padEnd(39)} ${s.verdict}`;
    console.log(row + (reg.optional ? '  (optional)' : ''));
  }
  console.log('\nNext: `node scripts/provision-secrets.mjs <NAME>` to focus one, then add `--put` to push the local value.');
  const ready = REGISTRY.map(statusOf).filter((s) => s.verdict.startsWith('READY')).map((s) => s.reg.name);
  if (ready.length) console.log(`\nReady to push from local right now (one at a time): ${ready.join(', ')}`);
}

function printOne(reg) {
  const s = statusOf(reg);
  console.log(`\n${reg.name}${reg.optional ? '  (optional)' : ''}`);
  console.log(`  purpose:  ${reg.note || '(see membership-and-access.md section 6)'}`);
  if (reg.caution) console.log(`  CAUTION:  ${reg.caution}`);
  if (reg.localName) console.log(`  local key name: ${reg.localName} (the Worker/Actions name is ${reg.name})`);
  if (reg.targets.includes('worker')) console.log(`  prod Worker:    ${s.w}`);
  if (reg.targets.includes('actions')) console.log(`  GitHub Actions: ${s.a}`);
  console.log(`  local value:    ${describeLocal(reg, s.local)}`);
  console.log(`  verdict:        ${s.verdict}`);
  if (s.verdict.startsWith('READY')) {
    const tgt = reg.targets.includes('worker') && s.w === 'MISSING' ? 'Worker' : 'Actions';
    console.log(`\n  To push the local value to the ${tgt}:`);
    console.log(`    node scripts/provision-secrets.mjs ${reg.name} --put${tgt === 'Actions' ? ' --actions' : ''}`);
  } else if (s.verdict.startsWith('NEEDS LIVE')) {
    console.log('\n  No local value found. Create the LIVE Stripe key in the dashboard, add it to workers/signup/.dev.vars,');
    console.log('  then re-run this with --put (or set it directly with `wrangler secret put`).');
  }
}

async function confirm(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question(q, res));
  rl.close();
  return /^y(es)?$/i.test(ans.trim());
}

async function put(reg, toActions, assumeYes) {
  const local = findLocal(reg);
  if (!local) { console.error(`No real local value for ${reg.localName || reg.name} in ${ENV_FILES.join(' or ')} (a placeholder does not count). Nothing to push.`); process.exit(1); }
  if ((reg.classify === 'stripe' || reg.classify === 'stripe-price') && stripeMode(local.value) !== 'live') {
    console.error(`Refusing to push ${reg.name}: the local value is ${stripeMode(local.value) || 'not a recognized live'} key/price, and production must be LIVE. Add the live value to workers/signup/.dev.vars first.`);
    process.exit(1);
  }
  const pc = pairCheck(reg);
  if (pc?.mismatch && !args.includes('--force')) {
    console.error(`Refusing to push ${reg.name}: ${reg.pairedIdVar} differs between local (${pc.localId}) and prod (${pc.prodId}).`);
    console.error('The local secret is for the SANDBOX app, so it would NOT match the production client id. Obtain the');
    console.error('PRODUCTION app secret (for the prod client id) and push that. Use --force only if you are certain.');
    process.exit(1);
  }
  const target = toActions ? 'GitHub Actions' : 'the production Worker';
  if (reg.caution) console.log(`CAUTION: ${reg.caution}`);
  console.log(`About to push ${reg.name} (from ${local.file}) to ${target}. The value is piped over stdin and never printed.`);
  if (!assumeYes && !(await confirm('Proceed? [y/N] '))) { console.log('Aborted.'); return; }
  let r;
  if (toActions) {
    r = sh('gh', ['secret', 'set', reg.name, '--repo', REPO], { input: local.value });
  } else {
    r = sh('npx', ['wrangler', 'secret', 'put', reg.name, '--env', 'production'], { cwd: WORKER_DIR, input: local.value });
  }
  if (r.status === 0) {
    console.log(`OK: ${reg.name} set on ${target}.`);
    if (!toActions) console.log('Note: a Worker secret takes effect on the next request (no redeploy needed).');
  } else {
    console.error(`FAILED (exit ${r.status}).`);
    if (r.stderr) console.error(r.stderr.split('\n').slice(0, 6).join('\n'));
    process.exit(1);
  }
}

// ---- main ----
const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--'));
const doPut = args.includes('--put');
const toActions = args.includes('--actions');
const assumeYes = args.includes('--yes');

if (!name) {
  printTable();
} else {
  const reg = REGISTRY.find((r) => r.name === name.toUpperCase());
  if (!reg) { console.error(`Unknown secret "${name}". Tracked: ${REGISTRY.map((r) => r.name).join(', ')}`); process.exit(1); }
  if (doPut) await put(reg, toActions, assumeYes);
  else printOne(reg);
}
