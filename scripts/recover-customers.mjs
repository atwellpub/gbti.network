#!/usr/bin/env node
// sow-166 / sow-157: create the Stripe Customers that make the recovered legacy members REACHABLE by email.
//
//   node scripts/recover-customers.mjs                 # dry run (the default), writes NOTHING
//   node scripts/recover-customers.mjs --apply         # create the Customers + their gh: index entries
//
//   MAIL_LEGACY_DUMP=/abs/path/to/dump.sql             # required from a detached worktree (.data/ is gitignored)
//   MAIL_ENROLL_EXTRA='login=address,login=address'    # owner-supplied addresses, same contract as the enrolment
//
// WHY THIS EXISTS, AND THE FAILURE IT IS THE FIX FOR. `scripts/lib/stripe-backfill.mjs` was written with the
// planner and the executor complete and NO CALLER, and its own header predicted exactly what would happen
// without one: a `source: 'member'` subscriber record stores no address, the drain resolves it from the
// member's Stripe Customer at send time, and a member with no Customer resolves to null and never sends.
//
// On 2026-08-25 that is precisely what happened. The first digest went out at 07:00 Central to 18 enrolled
// members and 12 of them failed inside 300ms each, terminally, because they have no Customer. The library
// said so in a comment weeks earlier. This file is the missing half.
//
// TERMINAL MEANS TERMINAL, so read this before assuming a re-run resends. The drain marks "resolved but no
// address" as failed and does NOT retry (mail-drain.mjs:312), so creating the Customers does not by itself
// deliver anything. What it does is make the NEXT welcome sweep able to reach them: their subscriber records
// still carry `welcomedAt: null`, so the next daily welcome issue re-enqueues them. Sending sooner than that
// is a separate, deliberate act.
//
// IT NEVER PRINTS, LOGS, RETURNS OR STORES AN ADDRESS. The planner is told only WHETHER one exists; the
// address is read from the dump and handed to Stripe at the moment of the POST and nowhere else. That is
// stripe-backfill's design and this file must not be the place that breaks it, so every report line here is
// keyed by github_id and login only. If you are adding a debug line, this is the paragraph you are about to
// contradict.
//
// SCOPE IS THE ALLOW-SET, ENFORCED IN CODE. The dump holds ~68 accounts, roughly 50 of whom registered on the
// old site and were never comped; reaching them was explicitly NOT approved. The allow-set is built from
// house/grandfathered.yml, exactly as the enrolment script builds it, and nothing outside it can be resolved.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { loadOverridesRaw } from '../membership/overrides.mjs';
import { createStripeClient } from '../clients/stripe.mjs';
import { putKvValue } from './lib/erase-member.mjs';
import { parseLegacyUsers, matchLegacyAddresses, applySuppliedAddresses } from './lib/legacy-addresses.mjs';
import { planCustomerCreates, createRecoveredCustomer } from './lib/stripe-backfill.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DUMP_DIR = path.join(ROOT, '.data/legacy/db');

// DUPLICATED FROM scripts/mail-enroll-legacy.mjs ON PURPOSE, and it is two functions rather than an import
// because that module calls main() at the top level: importing it to borrow a helper RUNS THE ENROLMENT and
// then exits the process. Re-homing them into lib/ is the right cleanup and is deliberately not bundled into
// an incident fix, where the smallest correct change is worth more than the tidiest one.

/** The grandfathered members, as the allow-set. A ban is not consulted: a banned account is not in this file. */
export function grandfatheredAllowSet(root = ROOT) {
  const raw = loadOverridesRaw(root);
  const list = (raw.grandfathered ?? raw.grandfathers)?.grandfathered ?? [];
  return list
    .map((g) => ({ githubId: String(g?.github_id ?? '').trim(), login: String(g?.login ?? '').trim() }))
    .filter((g) => g.githubId && g.login);
}

/** The newest .sql in the local dump directory, or null. `.data/` is gitignored, so a worktree needs the env var. */
export function findDump(dir = DUMP_DIR, env = process.env) {
  const explicit = String(env?.MAIL_LEGACY_DUMP ?? '').trim();
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort(); } catch { return null; }
  return names.length ? path.join(dir, names[names.length - 1]) : null;
}

/**
 * Which allow-set members already have a Stripe Customer. Returned as a Set of github_id STRINGS, which is
 * what planCustomerCreates expects.
 *
 * A LOOKUP FAILURE IS NOT AN ABSENCE. If Stripe cannot be reached or the key lacks the read scope, "no
 * customer found" and "could not look" are the same shape, and treating the second as the first would create
 * a duplicate Customer for every member who already has one. So an error here aborts the whole run rather
 * than degrading into a plan.
 */
export async function findExistingCustomers(members, stripe) {
  const have = new Set();
  for (const m of members) {
    let customer;
    try {
      customer = await stripe.findCustomerByGithubId(String(m.githubId));
    } catch (e) {
      throw new Error(
        `Stripe lookup failed for github_id ${m.githubId} (${e?.message ?? e}). Aborting: an unreadable `
        + 'Stripe looks identical to an absent Customer, and acting on that would double-create.',
      );
    }
    if (customer?.id) have.add(String(m.githubId));
  }
  return have;
}

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const env = process.env;

  const members = grandfatheredAllowSet();
  if (!members.length) {
    console.error('No grandfathered members found in house/grandfathered.yml. Nothing to do.');
    process.exit(1);
  }

  const dump = findDump(DUMP_DIR, env);
  if (!dump) {
    console.error('No legacy dump found. Set MAIL_LEGACY_DUMP to the .sql file (required from a worktree).');
    process.exit(1);
  }

  const key = String(env.STRIPE_SECRET_KEY ?? '').trim();
  if (!key) {
    console.error('STRIPE_SECRET_KEY is not set.');
    process.exit(1);
  }
  // A test key here would create the Customers in the WRONG MODE, the run would report success, and the
  // digest would still not reach anybody. That failure is silent and expensive, so it is checked rather than
  // trusted: this whole exercise exists because a member with no LIVE Customer cannot be emailed.
  if (!/^(sk|rk)_live_/.test(key)) {
    console.error(`STRIPE_SECRET_KEY is not a LIVE key (starts "${key.slice(0, 8)}"). Refusing: a Customer `
      + 'created in test mode makes nobody reachable and reports success while doing it.');
    process.exit(1);
  }

  const stripe = createStripeClient({ apiKey: key });

  // Addresses, resolved exactly as the enrolment resolved them so the two agree on who is reachable.
  const users = parseLegacyUsers(fs.readFileSync(dump, 'utf8'));
  const base = matchLegacyAddresses(users, members);
  const { matched, rejected } = applySuppliedAddresses(
    base.matched, base.unmatched, members, String(env.MAIL_ENROLL_EXTRA ?? ''),
  );
  // A Set of github_ids, NOT of addresses. The planner is told only whether one exists.
  const withAddress = new Set(matched.map((r) => String(r.githubId)));
  const addressFor = new Map(matched.map((r) => [String(r.githubId), r.email]));

  console.log(`dump:            ${path.basename(dump)}`);
  console.log(`allow-set:       ${members.length} grandfathered members`);
  console.log(`with an address: ${withAddress.size}`);
  if (rejected.length) console.log(`supplied but REJECTED (outside the allow-set): ${rejected.length}`);

  const existing = await findExistingCustomers(members, stripe);
  console.log(`already have a Stripe Customer: ${existing.size}`);

  // The allow-set calls it `login`; the planner and recoveredCustomerMetadata read `githubLogin`/`username`.
  // Without this mapping every Customer would be created with NO github_login in its metadata, and every
  // report line would print "?" for the name. Both are silent: the run would look like it worked.
  const planMembers = members.map((m) => ({ githubId: m.githubId, githubLogin: m.login, username: m.login }));

  const plan = planCustomerCreates({ members: planMembers, withAddress, existingCustomerIds: existing });
  console.log('');
  console.log(`TO CREATE:        ${plan.create.length}`);
  for (const r of plan.create) console.log(`  ${(r.username || r.githubLogin || '?').padEnd(24)} github_id ${r.githubId}`);
  console.log(`already covered:  ${plan.alreadyHasCustomer.length}`);
  console.log(`no address:       ${plan.noAddress.length}`);
  for (const r of plan.noAddress) console.log(`  ${(r.username || r.githubLogin || '?').padEnd(24)} github_id ${r.githubId}  (unreachable)`);

  if (!apply) {
    console.log('');
    console.log('DRY RUN, nothing written. Re-run with --apply to create the Customers.');
    return;
  }

  console.log('');
  let created = 0;
  const failures = [];
  for (const row of plan.create) {
    const email = addressFor.get(String(row.githubId)); // resolved here, passed straight through, never held
    try {
      const res = await createRecoveredCustomer({
        row,
        email,
        stripe,
        kv: { put: (k, v) => putKvValue({ key: k, value: v, env }) },
      });
      created += 1;
      console.log(`  created  ${(row.username || row.githubLogin || '?').padEnd(24)} github_id ${res.githubId}`);
    } catch (e) {
      failures.push({ githubId: row.githubId, login: row.username || row.githubLogin, error: e?.message ?? String(e) });
      console.error(`  FAILED   ${(row.username || row.githubLogin || '?').padEnd(24)} github_id ${row.githubId}: ${e?.message ?? e}`);
    }
  }

  console.log('');
  console.log(`CREATED ${created} Stripe Customer(s). ${failures.length} failure(s).`);
  console.log('');
  console.log('This does NOT deliver anything on its own. The failed sends are terminal and are not retried.');
  console.log('These members still carry welcomedAt: null, so the next daily welcome sweep re-enqueues them');
  console.log('and the drain can now resolve their address. Verify with a send record carrying status "sent".');

  if (failures.length) process.exit(1);
}

// GUARDED, unlike scripts/mail-enroll-legacy.mjs, and that difference is the reason this file has tests at
// all. That script calls main() unconditionally, so importing it to reuse a helper runs the enrolment and
// exits the process, which is why two of its helpers are duplicated at the top of this file instead of
// imported. Running only when invoked directly costs one line and keeps the module testable.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err); process.exit(1); });
}
