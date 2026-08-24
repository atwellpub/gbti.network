#!/usr/bin/env node
// sow-166 follow-up: enrol the GRANDFATHERED co-op members into the digest using their LEGACY WordPress
// address, because they predate Stripe and have no address anywhere in the running system.
//
//   node scripts/mail-enroll-legacy.mjs              # dry run (the default), writes NOTHING
//   node scripts/mail-enroll-legacy.mjs --apply      # enact, behind the same two gates as mail-enroll.mjs
//
// SCOPE IS THE OWNER DECISION OF 2026-08-24 AND IT IS ENFORCED IN CODE, NOT BY INVOCATION. The dump holds 68
// accounts. Roughly 50 of them are people who registered on the old site and were never comped, and reaching
// them was explicitly NOT approved. The allow-set is therefore built from house/grandfathered.yml and passed
// into matchLegacyAddresses, which cannot resolve an address outside it. Widening the scope means editing
// the allow-set in code and is not something a flag can do.
//
// THE SAME TWO GATES AS THE MAIN BACKFILL, for the same reasons:
//   1. MAIL_SUPPRESS_KEY, without which mailHash returns null and no identity can be minted at all.
//   2. MAIL_ENROLL_UNSUB_PROVEN, naming the evidence that a real unsubscribe works end to end. Auto-enrolment
//      was approved with an explicit rider that the opt-out is not deferrable.
//
// AND ONE GATE THE MAIN BACKFILL DOES NOT NEED: the SEND allowlist. These 15 hashes are not on
// MAIL_SEND_ALLOWLIST, so enrolling them writes a subscriber record that the drain will refuse until the
// owner adds the hashes. That ordering is deliberate. Enrolment is reversible, sending is not, so the
// reversible half happens first and the irreversible half needs a human. This script PRINTS the hashes for
// that purpose and NEVER prints an address.
//
// WHAT THEY RECEIVE. A newly enrolled subscriber has welcomedAt null, so the welcome sweep sends them the
// 90-day welcome issue rather than a thin weekly. That is the intended introduction for somebody who has
// not heard from the network since the WordPress site.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadOverridesRaw } from '../membership/overrides.mjs';
import { mailHash, subscriberKey, MAIL_SUBSCRIBER_PREFIX, MAIL_SUPPRESS_PREFIX } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { listKvByPrefix, putKvValue } from './lib/erase-member.mjs';
import { idsPresent } from './mail-enroll.mjs';
import { parseLegacyUsers, matchLegacyAddresses } from './lib/legacy-addresses.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DUMP_DIR = path.join(ROOT, '.data/legacy/db');

/** The grandfathered members, as the allow-set. A ban is not consulted here: a banned account is not in this file. */
export function grandfatheredAllowSet(root = ROOT) {
  const raw = loadOverridesRaw(root);
  const list = (raw.grandfathered ?? raw.grandfathers)?.grandfathered ?? [];
  return list
    .map((g) => ({ githubId: String(g?.github_id ?? '').trim(), login: String(g?.login ?? '').trim() }))
    .filter((g) => g.githubId && g.login);
}

/**
 * The newest .sql in the local dump directory, or null.
 *
 * `.data/` is gitignored, so a DETACHED WORKTREE does not have it, and the project convention is to run from
 * exactly such a worktree. MAIL_LEGACY_DUMP therefore points at the file explicitly, and without it the
 * script running from a worktree would report "no dump" for a dump that exists ten directories away.
 */
export function findDump(dir = DUMP_DIR, env = process.env) {
  const explicit = String(env?.MAIL_LEGACY_DUMP ?? '').trim();
  if (explicit) return fs.existsSync(explicit) ? explicit : null;
  let names;
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.sql')).sort(); } catch { return null; }
  return names.length ? path.join(dir, names[names.length - 1]) : null;
}

async function main() {
  const apply = process.argv.includes('--apply') && !process.argv.includes('--dry-run');
  const env = process.env;
  const secret = String(env.MAIL_SUPPRESS_KEY ?? '').trim();
  const unsubProven = String(env.MAIL_ENROLL_UNSUB_PROVEN ?? '').trim();

  const allowed = grandfatheredAllowSet();
  const dump = findDump();
  console.log('');
  console.log(apply ? 'LEGACY ENROLMENT: APPLY' : 'LEGACY ENROLMENT: DRY RUN (nothing is written)');
  console.log('');
  console.log(`  allow-set (house/grandfathered.yml):  ${allowed.length} members`);
  if (!dump) {
    console.error('  dump: NOT FOUND. Looked at MAIL_LEGACY_DUMP, then .data/legacy/db/. Both are local-only.');
    console.error('  Set MAIL_LEGACY_DUMP=/path/to/dump.sql when running from a detached worktree.');
    console.error('  Without it no legacy address can be resolved. Refusing to report an empty result as a clean one.');
    process.exit(1);
  }
  console.log(`  dump: ${path.basename(dump)}`);

  const users = parseLegacyUsers(fs.readFileSync(dump, 'utf8'));
  const withAddress = users.filter((u) => u.email).length;
  console.log(`  legacy accounts: ${users.length}, of which ${withAddress} carry an address`);
  const { matched, unmatched } = matchLegacyAddresses(users, allowed);
  console.log('');
  console.log(`RESOLVED ${matched.length} of ${allowed.length}`);
  for (const m of matched) console.log(`    ${m.login.padEnd(26)} matched on ${m.matchedOn}`);
  console.log('');
  console.log(`UNREACHABLE ${unmatched.length} (no legacy account; nothing else in the system has an address for them)`);
  for (const u of unmatched) console.log(`    ${(u.login || '(none)').padEnd(26)} ${u.reason}`);

  // Identity. The address goes into the HMAC and then out of scope: a member subscriber record stores no
  // address, and the drain resolves one at send time.
  console.log('');
  if (!secret) {
    console.log('MAIL_SUPPRESS_KEY is not set, so no identity can be minted and nothing below can be planned.');
    console.log('The two lists above are still true and are knowable without any secret.');
    process.exit(0);
  }

  const identities = new Map();
  for (const m of matched) {
    const hash = await mailHash(secret, m.email);
    if (hash) identities.set(m.githubId, { hash, login: m.login });
  }

  const [subs, supp] = await Promise.all([
    listKvByPrefix({ prefix: MAIL_SUBSCRIBER_PREFIX, env }),
    listKvByPrefix({ prefix: MAIL_SUPPRESS_PREFIX, env }),
  ]);
  const enrolled = idsPresent(subs, MAIL_SUBSCRIBER_PREFIX);
  const suppressed = idsPresent(supp, MAIL_SUPPRESS_PREFIX);

  const toEnrol = [];
  const already = [];
  const optedOut = [];
  for (const [githubId, ident] of identities) {
    // A SUPPRESSION IS AN OPT-OUT AND IT OUTRANKS THIS ENTIRE SCRIPT. Somebody who unsubscribed must not be
    // re-enrolled by a backfill; that is the single most damaging thing a bulk enrolment can do.
    if (suppressed.has(ident.hash)) { optedOut.push(ident.login); continue; }
    if (enrolled.has(ident.hash)) { already.push(ident.login); continue; }
    toEnrol.push({ githubId, ...ident });
  }

  console.log('ENROLMENT PLAN');
  console.log(`    to enrol:        ${toEnrol.length}`);
  console.log(`    already enrolled:${String(already.length).padStart(3)}  ${already.join(', ')}`);
  console.log(`    opted out:       ${String(optedOut.length).padStart(3)}  ${optedOut.join(', ')}`);

  if (!apply) {
    console.log('');
    console.log('DRY RUN. Re-run with --apply to write. Nothing was written.');
    printAllowlist(toEnrol);
    return;
  }
  if (!unsubProven) {
    console.error('');
    console.error('REFUSING TO APPLY: MAIL_ENROLL_UNSUB_PROVEN is not set.');
    console.error('Set it to the evidence that a real unsubscribe works end to end (a delivered message id, a');
    console.error('clicked link, a read-back suppression marker). Enrolment at population scale before the');
    console.error('opt-out is demonstrated is the state that rider exists to prevent.');
    process.exit(1);
  }

  let written = 0;
  for (const s of toEnrol) {
    const rec = buildSubscriber({ hash: s.hash, source: 'member', githubId: s.githubId });
    await putKvValue({ key: subscriberKey(s.hash), value: rec, env });
    written += 1;
  }
  console.log('');
  console.log(`WROTE ${written} subscriber record(s). Unsubscribe evidence: ${unsubProven}`);
  console.log('They cannot receive anything until their hashes are on MAIL_SEND_ALLOWLIST.');
  printAllowlist(toEnrol);
}

/** Hashes are HMACs, not addresses, and they are what the send gate is written in terms of. */
function printAllowlist(rows) {
  if (!rows.length) return;
  console.log('');
  console.log('FOR MAIL_SEND_ALLOWLIST (these are hashes, never addresses). The current secret cannot be read');
  console.log('back, so the new value must list these ALONGSIDE the ones already there:');
  console.log('');
  console.log(rows.map((r) => r.hash).join(','));
}

main().catch((err) => { console.error(err); process.exit(1); });
