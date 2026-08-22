// SOW-024: the right-to-erasure tool. The KV DELETE (CF REST API) + the activity erase + the runbook plan,
// all injectable (env + fetch), so no network and no secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  deleteKvKey, eraseActivity, eraseFollows, eraseLookupCache, eraseShareVotes, eraseNewsOpens, planErasure, runErasure,
  eraseDiscordRoles, eraseContent, eraseStripeCustomer, ACTIVITY_KEY, FOLLOWS_KEY, LOOKUP_KEY, MEMBERS_INDEX_PATH,
  eraseCouponGrant, eraseCouponRedemptions, COUPON_GRANT_KEY, minimizeCouponGrant, eraseCouponLock,
  minimizeRedeemedInvites, eraseNotifications, NOTIFICATIONS_KEY,
} from '../scripts/lib/erase-member.mjs';
import { GRANDFATHERED_PATH } from '../scripts/lib/coupon-grants.mjs';
import { couponLockKey } from '../membership/coupon-lock.mjs';
import { parseArgs } from '../scripts/erase-member.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

test('deleteKvKey is a reported no-op without CF credentials (never throws)', async () => {
  const r = await deleteKvKey({ key: 'activity:1', env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.deleted, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('deleteKvKey DELETEs the right CF URL with the bearer token', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return { ok: true }; };
  const r = await deleteKvKey({ key: 'activity:42', env: CF, fetchImpl });
  assert.equal(r.deleted, true);
  assert.equal(seen.init.method, 'DELETE');
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.ok(seen.url.includes('/accounts/acct/storage/kv/namespaces/ns/values/activity%3A42'));
});

test('deleteKvKey throws on a real API error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 500, async text() { return 'boom'; } });
  await assert.rejects(() => deleteKvKey({ key: 'k', env: CF, fetchImpl }), /KV delete failed: 500/);
});

test('eraseActivity targets activity:<github_id> and requires an id', async () => {
  let key;
  await eraseActivity({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, ACTIVITY_KEY('7'));
  await assert.rejects(() => eraseActivity({ githubId: '' }), /github_id is required/);
});

test('eraseNotifications targets notifications:<github_id> (SOW-150/186)', async () => {
  let key;
  await eraseNotifications({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, NOTIFICATIONS_KEY('7'));
  await assert.rejects(() => eraseNotifications({ githubId: '' }), /github_id is required/);
});

test('eraseFollows targets follows:<github_id> (SOW-023)', async () => {
  let key;
  await eraseFollows({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, FOLLOWS_KEY('7'));
  await assert.rejects(() => eraseFollows({ githubId: '' }), /github_id is required/);
});

test('eraseLookupCache targets gh:<github_id> (the Stripe-customer lookup cache)', async () => {
  let key;
  await eraseLookupCache({ githubId: 42, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, LOOKUP_KEY('42'));
});

// --- Discord role removal -----------------------------------------------------------------------------------

const DENV = { ...CF, DISCORD_GUILD_ID: 'g', DISCORD_MEMBER_ROLE_ID: 'rm', DISCORD_TRIAL_ROLE_ID: 'rt', DISCORD_LOCKED_ROLE_ID: 'rl' };

test('eraseDiscordRoles removes only the managed roles the member actually holds', async () => {
  const calls = [];
  const stripe = { findCustomerByGithubId: async () => ({ metadata: { discord_user_id: 'u1' } }) };
  const discord = {
    getMember: async () => ({ roles: ['rm', 'other-unmanaged'] }), // holds Member + an unmanaged role
    removeRole: async (g, u, r) => { calls.push([g, u, r]); },
  };
  const res = await eraseDiscordRoles({ githubId: 1, stripe, discord, env: DENV });
  assert.deepEqual(res.removed, ['member']);
  assert.deepEqual(calls, [['g', 'u1', 'rm']]); // only the held managed role, not the unmanaged one
});

test('eraseDiscordRoles is a reported no-op without a client, guild, or discord_user_id', async () => {
  assert.match((await eraseDiscordRoles({ githubId: 1, discord: null, env: DENV })).reason, /no Discord client/);
  assert.match((await eraseDiscordRoles({ githubId: 1, discord: {}, env: { ...DENV, DISCORD_GUILD_ID: '' } })).reason, /DISCORD_GUILD_ID/);
  const stripe = { findCustomerByGithubId: async () => ({ metadata: {} }) }; // no discord_user_id
  assert.match((await eraseDiscordRoles({ githubId: 1, stripe, discord: { getMember: async () => ({}) }, env: DENV })).reason, /no discord_user_id/);
});

// --- Content draft-flip + members-index removal (one PR) -----------------------------------------------------

function fakeGithub({ contents }) {
  // contents keyed by PATH only: a branch created from base has the same content at creation, so getContent
  // returns the same blob whether read from base (phase 1) or the new branch (phase 2). This also exercises
  // the TOCTOU-safe ordering: phase 2 reads from the branch before putContent.
  const seen = { puts: [], pull: null, merged: null, branch: null, reads: [] };
  return {
    seen,
    getRef: async () => ({ object: { sha: 'BASE' } }),
    createRef: async (branch) => { seen.branch = branch; },
    getContent: async (p, ref) => { seen.reads.push({ p, ref }); return contents[p] ?? null; },
    putContent: async (p, opts) => { seen.puts.push({ path: p, text: Buffer.from(opts.content, 'base64').toString('utf8'), branch: opts.branch, sha: opts.sha }); },
    createPull: async (o) => { seen.pull = o; return { number: 77 }; },
    mergePull: async (n, o) => { seen.merged = { n, ...o }; },
  };
}

test('eraseContent flips published files to draft and removes the members-index entry in one merged PR', async () => {
  const post = '---\ntitle: x\nstatus: published\nvisibility: public\n---\nbody\n';
  const index = 'members:\n  "9": alice\n  "10": bob\n';
  const github = fakeGithub({
    contents: {
      'members/alice/posts/x/index.md': { sha: 's1', content: b64(post) },
      [MEMBERS_INDEX_PATH]: { sha: 'si', content: b64(index) },
    },
  });
  const res = await eraseContent({
    github, githubId: '9', username: 'alice',
    files: [{ path: 'members/alice/posts/x/index.md', status: 'published' }],
    now: new Date('2026-06-13T00:00:00Z'),
  });
  assert.equal(res.pr, 77);
  assert.equal(res.flipped, 1);
  assert.equal(res.indexRemoved, true);
  const postPut = github.seen.puts.find((p) => p.path.endsWith('index.md') && p.path.includes('posts'));
  assert.match(postPut.text, /status: draft/);
  assert.equal(postPut.branch, github.seen.branch, 'committed on the erase branch, not base');
  assert.equal(postPut.sha, 's1', 'used the blob sha read from the branch (TOCTOU-safe)');
  const idxPut = github.seen.puts.find((p) => p.path === MEMBERS_INDEX_PATH);
  assert.ok(!idxPut.text.includes('alice'), 'the erased member is gone from the index');
  assert.ok(idxPut.text.includes('bob'), 'other members are untouched');
  assert.equal(github.seen.merged.method, 'squash');
  // TOCTOU-safe ordering: the branch is created before the committing reads.
  const branchCreatedAtRead = github.seen.reads.findIndex((r) => r.ref && r.ref.startsWith('erase/'));
  assert.ok(branchCreatedAtRead >= 0, 'phase 2 reads each target from the new branch before putContent');
});

test('eraseContent is a no-op (no branch, no PR) when there is nothing to change', async () => {
  const draft = '---\nstatus: draft\n---\nbody\n';
  const github = fakeGithub({
    contents: {
      'members/alice/posts/x/index.md': { sha: 's1', content: b64(draft) }, // already draft
      [MEMBERS_INDEX_PATH]: { sha: 'si', content: b64('members:\n  "10": bob\n') }, // no entry for 9
    },
  });
  const res = await eraseContent({ github, githubId: '9', username: 'alice', files: [{ path: 'members/alice/posts/x/index.md' }] });
  assert.equal(res.skipped, true);
  assert.equal(github.seen.branch, null, 'no branch created');
  assert.equal(github.seen.pull, null, 'no PR opened');
});

test('eraseContent skips without a github client', async () => {
  assert.match((await eraseContent({ github: null, githubId: '9', username: 'alice' })).reason, /no GitHub client/);
});

// Rewritten 2026-08-11, not deleted: this used to assert that a missing username SKIPPED the whole step.
// That guard was removed deliberately. A username is needed only for the CONTENT flip; the two house-record
// removals (members-index and the grandfather grant) are keyed on github_id alone, and a member with no
// content folder is precisely the one most likely to hold a grant and no folder. Skipping on a missing
// username left their public records in place, which is the gap SecurityMaster adjudicated.
const GRANTS_YML = [
  '# Grandfathered github_ids (ADMIN-owned). Header comment that must survive a removal.',
  'grandfathered:',
  '  - github_id: "9"       # github.com/alice',
  '    login: alice',
  '    reason: coupon:CODEABLEYEAR',
  '    until: "2027-01-01T00:00:00.000Z"',
  '  - github_id: "10"      # github.com/bob',
  '    login: bob',
  '    reason: complimentary access (grandfathered co-op member)',
  '    until: null',
  '',
].join('\n');

test('eraseContent still strips house records for a member with no folder (no username)', async () => {
  const github = fakeGithub({
    contents: { [GRANDFATHERED_PATH]: { sha: 'sg', content: b64(GRANTS_YML) } },
  });
  const res = await eraseContent({ github, githubId: '9', username: null, files: [] });
  assert.equal(res.skipped, undefined, 'must not skip: there is a grant to remove');
  assert.equal(res.grantRemoved, true);
  assert.equal(res.flipped, 0);
  const put = github.seen.puts.find((p) => p.path === GRANDFATHERED_PATH);
  assert.ok(put, 'the grant file was committed');
  assert.equal(put.branch, github.seen.branch, 'committed on the erase branch, not base');
  assert.equal(put.sha, 'sg', 'used the blob sha read from the branch (TOCTOU-safe)');
  assert.doesNotMatch(put.text, /github_id: "9"/, "the erased member's block is gone");
  assert.match(put.text, /github_id: "10"/, "every other member's block survives");
  assert.match(put.text, /# github\.com\/bob/, 'per-person comments survive (a line splice, not a yaml re-dump)');
  assert.match(put.text, /^# Grandfathered github_ids/m, 'the file header survives');
});

test('eraseContent removes the grandfather grant in the SAME PR as the content flip and the index entry', async () => {
  const post = '---\ntitle: x\nstatus: published\n---\nbody\n';
  const github = fakeGithub({
    contents: {
      'members/alice/posts/x/index.md': { sha: 's1', content: b64(post) },
      [MEMBERS_INDEX_PATH]: { sha: 'si', content: b64('members:\n  "9": alice\n  "10": bob\n') },
      [GRANDFATHERED_PATH]: { sha: 'sg', content: b64(GRANTS_YML) },
    },
  });
  const res = await eraseContent({
    github, githubId: '9', username: 'alice',
    files: [{ path: 'members/alice/posts/x/index.md', status: 'published' }],
  });
  assert.equal(res.flipped, 1);
  assert.equal(res.indexRemoved, true);
  assert.equal(res.grantRemoved, true);
  assert.equal(github.seen.pull.head, github.seen.branch, 'all three changes ride one PR');
  assert.equal(github.seen.puts.filter((p) => p.branch === github.seen.branch).length, 3);
  assert.match(github.seen.pull.body, /grandfather grant/);
});

test('eraseContent refuses to commit a grant removal that does not actually remove the member', async () => {
  // A splice that leaves the id resolvable means the removal silently did nothing. The step must ERROR
  // rather than open a PR that claims a removal it did not perform.
  const twice = GRANTS_YML + '  - github_id: "9"\n    reason: a duplicate block\n    until: null\n';
  const github = fakeGithub({ contents: { [GRANDFATHERED_PATH]: { sha: 'sg', content: b64(twice) } } });
  const res = await eraseContent({ github, githubId: '9', username: null, files: [] });
  assert.match(res.error, /still resolves a grant for 9/);
  assert.equal(github.seen.pull, null, 'no PR opened');
  assert.equal(github.seen.puts.length, 0, 'nothing committed');
});

// --- Coupon grant + redemptions (SOW-119 / sow-212) ----------------------------------------------------------

test('eraseCouponGrant targets coupon-grant:<github_id> and requires an id', async () => {
  let key;
  await eraseCouponGrant({ githubId: 7, env: CF, fetchImpl: async (url) => { key = decodeURIComponent(url.split('/values/')[1]); return { ok: true }; } });
  assert.equal(key, COUPON_GRANT_KEY('7'));
  assert.equal(key, 'coupon-grant:7');
  await assert.rejects(() => eraseCouponGrant({ githubId: '' }), /github_id is required/);
});

/** Fake CF KV REST for the redemption sweep: a key list, per-key value GETs, DELETEs and counter PUTs. */
function fakeKvFetch({ keys, values }) {
  const calls = { deleted: [], put: [] };
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'DELETE') {
      calls.deleted.push(decodeURIComponent(url.split('/values/')[1]));
      return { ok: true };
    }
    if (init.method === 'PUT') {
      calls.put.push({ key: decodeURIComponent(url.split('/values/')[1]), body: init.body });
      return { ok: true };
    }
    if (url.includes('/keys?')) {
      return { ok: true, json: async () => ({ result: keys.map((name) => ({ name })), result_info: {} }) };
    }
    const key = decodeURIComponent(url.split('/values/')[1]);
    const v = values[key];
    if (v === undefined) return { ok: false };
    return { ok: true, json: async () => (typeof v === 'string' ? JSON.parse(v) : v), text: async () => String(v) };
  };
  return { fetchImpl, calls };
}

test('sow-231: minimizeRedeemedInvites nulls the redeemer on THIS member\'s invites only', async () => {
  // An invite is keyed by its CODE and names the member only INSIDE the record, so there is no key to
  // compute from a github_id and erasure has to sweep the prefix and filter, exactly as the redemption
  // records do. This test exists because that asymmetry is the easy thing to miss.
  const { fetchImpl, calls } = fakeKvFetch({
    keys: ['invite:AAA', 'invite:BBB', 'invite:CCC'],
    // Values are JSON STRINGS: readKvValue reads the raw body, and an object here would stringify to
    // "[object Object]" and be skipped as corrupt, which would make this test pass for the wrong reason.
    values: {
      'invite:AAA': JSON.stringify({ code: 'AAA', campaign: 'CODEABLEYEAR', note: 'sent to the lead', redeemedBy: '9', redeemedByLogin: 'nine', redeemedAt: '2026-08-01T00:00:00.000Z' }),
      'invite:BBB': JSON.stringify({ code: 'BBB', campaign: 'CODEABLEYEAR', redeemedBy: '10', redeemedByLogin: 'ten' }),
      'invite:CCC': JSON.stringify({ code: 'CCC', campaign: 'CODEABLEYEAR', redeemedBy: null }),
    },
  });
  const res = await minimizeRedeemedInvites({ githubId: '9', env: CF, fetchImpl });
  assert.equal(res.minimized, 1, 'only the one this member redeemed');

  assert.equal(calls.put.length, 1, 'exactly one record rewritten');
  const rec = JSON.parse(calls.put[0].body);
  assert.equal(calls.put[0].key, 'invite:AAA');
  assert.equal(rec.code, 'AAA', 'the invite still exists and still says which link it was');
  assert.equal(rec.redeemedBy, null, 'the redeemer is gone');
  assert.equal(rec.redeemedByLogin, null);
  assert.ok(rec.redeemedAt, 'the date stays: it identifies nobody on its own and it is the audit trail');
  assert.equal(rec.note, 'sent to the lead', 'the admin note is NOT touched here (owner call, flagged in the SOW)');
});

test('sow-231: minimizeRedeemedInvites is a reported no-op without CF credentials', async () => {
  const r = await minimizeRedeemedInvites({ githubId: '9', env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.skipped, true);
});

test('eraseCouponRedemptions deletes only THIS member\'s records and decrements the shared counter', async () => {
  const { fetchImpl, calls } = fakeKvFetch({
    keys: ['redemption:CODEABLEYEAR:9', 'redemption:CODEABLEYEAR:10', 'redemption:OTHER:9'],
    values: {
      'redemption:CODEABLEYEAR:9': { code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' },
      'redemption:CODEABLEYEAR:10': { code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' },
      'redemption:OTHER:9': { code: 'OTHER', until: '2027-01-01T00:00:00.000Z' },
      'redemptions:CODEABLEYEAR': '5',
      'redemptions:OTHER': '2',
    },
  });
  const res = await eraseCouponRedemptions({ githubId: '9', env: CF, fetchImpl });
  assert.equal(res.scrubbed, 2, 'both of member 9 codes');
  assert.deepEqual(calls.deleted.sort(), ['redemption:CODEABLEYEAR:9', 'redemption:OTHER:9']);
  assert.ok(!calls.deleted.includes('redemption:CODEABLEYEAR:10'), "another member's redemption is untouched");
  // The counter is SHARED: decremented, never deleted, or every other member's redemption is un-burned.
  const counters = Object.fromEntries(calls.put.map((p) => [p.key, p.body]));
  assert.equal(counters['redemptions:CODEABLEYEAR'], '4', '5 -> 4');
  assert.equal(counters['redemptions:OTHER'], '1', '2 -> 1');
  assert.ok(!calls.deleted.some((k) => k.startsWith('redemptions:')), 'the counter is never deleted');
});

test('eraseCouponRedemptions clamps the counter at zero and is a reported no-op without CF creds', async () => {
  const { fetchImpl, calls } = fakeKvFetch({
    keys: ['redemption:ABC:9'],
    values: { 'redemption:ABC:9': { code: 'ABC', until: '2027-01-01T00:00:00.000Z' }, 'redemptions:ABC': '0' },
  });
  await eraseCouponRedemptions({ githubId: '9', env: CF, fetchImpl });
  assert.equal(calls.put.find((p) => p.key === 'redemptions:ABC').body, '0', 'never goes negative on a repeat run');

  const r = await eraseCouponRedemptions({ githubId: '9', env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(r.skipped, true);
  await assert.rejects(() => eraseCouponRedemptions({ githubId: '' }), /github_id is required/);
});

// --- The minimized coupon lock (owner ruling 2026-08-11) -----------------------------------------------------

test('couponLockKey is keyed, stable, id-specific, and null without a salt', async () => {
  const a = await couponLockKey('s3cret', '9');
  const b = await couponLockKey('s3cret', '9');
  const c = await couponLockKey('s3cret', '10');
  const d = await couponLockKey('other-salt', '9');
  assert.equal(a, b, 'stable for the same salt + id');
  assert.notEqual(a, c, 'different members get different locks');
  assert.notEqual(a, d, 'the salt actually keys it');
  assert.match(a, /^coupon-lock:[0-9a-f]{64}$/);
  // The id is not embedded: the digest is fixed-width regardless of how long the id is. (Irreversibility
  // itself rests on the salt being secret, which no unit test can demonstrate.)
  const long = await couponLockKey('s3cret', '123456789012345678');
  assert.equal(long.length, a.length, 'fixed-width digest, so the key carries no trace of the id');
  // Fail closed rather than fall back to an unkeyed hash: github_ids are enumerable, so an unsalted digest
  // would be reversible in seconds and would be security theatre.
  assert.equal(await couponLockKey('', '9'), null);
  assert.equal(await couponLockKey(null, '9'), null);
});

test('minimizeCouponGrant writes the hashed lock BEFORE deleting the raw record', async () => {
  const order = [];
  const fetchImpl = async (url, init = {}) => {
    const key = decodeURIComponent(url.split('/values/')[1]);
    if (init.method === 'PUT') { order.push(`put:${key}`); return { ok: true }; }
    if (init.method === 'DELETE') { order.push(`del:${key}`); return { ok: true }; }
    return { ok: true, text: async () => JSON.stringify({ code: 'CODEABLEYEAR', until: '2027-01-01T00:00:00.000Z' }) };
  };
  const env = { ...CF, COUPON_LOCK_KEY: 's3cret' };
  const res = await minimizeCouponGrant({ githubId: '9', env, fetchImpl });
  assert.equal(res.deleted, true);
  const lockKey = await couponLockKey('s3cret', '9');
  // Order is load-bearing: dying between the two must leave a duplicate lock (harmless), never no lock.
  assert.deepEqual(order, [`put:${lockKey}`, 'del:coupon-grant:9']);
});

test('minimizeCouponGrant KEEPS the raw record when no salt is configured (fail closed)', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => { calls.push(init.method ?? 'GET'); return { ok: true, text: async () => '{}' }; };
  const res = await minimizeCouponGrant({ githubId: '9', env: CF, fetchImpl });
  assert.equal(res.skipped, true);
  assert.match(res.reason, /COUPON_LOCK_KEY/);
  assert.match(res.reason, /KEPT/, 'says plainly that the raw record was left in place');
  assert.equal(calls.length, 0, 'nothing is deleted: losing the lock would restore the coupon exploit');
});

test('erasure MINIMIZES the coupon grant; it does not delete it (owner ruling)', async () => {
  const plan = planErasure({ githubId: '9', username: 'alice' });
  const step = plan.find((s) => s.step === 'coupon-grant');
  assert.match(step.action, /MINIMIZE/);
  assert.doesNotMatch(step.action, /Hard-delete/);
});

// --- Stripe delete (opt-in) ---------------------------------------------------------------------------------

test('eraseStripeCustomer deletes the resolved customer; skips without a client/customer', async () => {
  let deletedId = null;
  const stripe = { findCustomerByGithubId: async () => ({ id: 'cus_1' }), deleteCustomer: async (id) => { deletedId = id; return { id, deleted: true }; } };
  const r = await eraseStripeCustomer({ githubId: 1, stripe });
  assert.equal(r.deletedCustomer, true);
  assert.equal(deletedId, 'cus_1');
  assert.match((await eraseStripeCustomer({ githubId: 1, stripe: null })).reason, /no Stripe client/);
  const none = { findCustomerByGithubId: async () => null };
  assert.match((await eraseStripeCustomer({ githubId: 1, stripe: none })).reason, /no Stripe customer/);
});

// --- Orchestrator -------------------------------------------------------------------------------------------

test('runErasure dry-run returns the plan and changes nothing', async () => {
  const r = await runErasure({ githubId: '9', username: 'alice', apply: false });
  assert.equal(r.apply, false);
  assert.ok(Array.isArray(r.plan));
});

test('runErasure --apply composes the auto steps, fail-isolates a thrown step, and records the audit', async () => {
  const fetchCalls = [];
  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, method: init.method });
    if (init.method === 'PUT') return { ok: true }; // the audit write
    return { ok: true }; // the KV deletes
  };
  // discord throws -> must become an 'error' outcome, not abort the run
  const clients = {
    discord: { getMember: async () => { throw new Error('discord down'); }, removeRole: async () => {} },
    stripe: { findCustomerByGithubId: async () => ({ metadata: { discord_user_id: 'u1' } }) },
    github: null,
  };
  const r = await runErasure({ githubId: '9', username: 'alice', apply: true, env: CF, fetchImpl, clients, files: [] });
  assert.equal(r.apply, true);
  const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s.outcome]));
  assert.equal(byStep['activity'], 'deleted');
  assert.equal(byStep['follows'], 'deleted');
  assert.equal(byStep['notifications'], 'deleted'); // SOW-150/186: the inbound notification store joins the sweep
  assert.equal(byStep['lookup-cache'], 'deleted');
  assert.equal(byStep['content'], 'skipped'); // no github client
  // discord getMember threw inside eraseDiscordRoles, which catches it -> member null -> skipped (not error)
  assert.ok(['skipped', 'error'].includes(byStep['discord']));
  assert.equal(r.audit.recorded, true);
  // the audit record is identity-minimal: github_id pseudonym only, no username/email/discord id
  assert.equal(r.record.githubId, '9');
  assert.ok(!JSON.stringify(r.record).includes('alice'), 'no username in the audit record');
  assert.ok(!JSON.stringify(r.record).includes('u1'), 'no discord id in the audit record');
  assert.ok(fetchCalls.some((c) => c.method === 'PUT'), 'an audit PUT was issued');
});

test('runErasure skips the Stripe step unless --delete-stripe (deleteStripe) is set', async () => {
  let stripeDeleted = false;
  const clients = { stripe: { findCustomerByGithubId: async () => ({ id: 'cus_1', metadata: {} }), deleteCustomer: async () => { stripeDeleted = true; } } };
  const fetchImpl = async () => ({ ok: true });
  const without = await runErasure({ githubId: '9', apply: true, env: CF, fetchImpl, clients, deleteStripe: false });
  assert.ok(!without.steps.find((s) => s.step === 'stripe'), 'no stripe step without the opt-in');
  assert.equal(stripeDeleted, false);
  const withFlag = await runErasure({ githubId: '9', apply: true, env: CF, fetchImpl, clients, deleteStripe: true });
  assert.equal(withFlag.steps.find((s) => s.step === 'stripe').outcome, 'deleted');
  assert.equal(stripeDeleted, true);
});

test('SOW-057: eraseShareVotes scrubs the github_id from every per-target voter set', async () => {
  const puts = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('/keys')) {
      return { ok: true, json: async () => ({ result: [{ name: 'upvotes:share:alice/x' }, { name: 'upvotes:share:bob/y' }], result_info: { cursor: '' } }) };
    }
    if ((init?.method || 'GET') === 'GET' && url.includes('/values/')) {
      const key = decodeURIComponent(url.split('/values/')[1]);
      const store = {
        'upvotes:share:alice/x': { voters: ['9', 'v2'], author: null, enqueuedAt: null },
        'upvotes:share:bob/y': { voters: ['v3'], author: null, enqueuedAt: 5 }, // does not include 9 -> unchanged
      };
      return { ok: true, json: async () => store[key] };
    }
    if (init?.method === 'PUT') { puts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; }
    return { ok: true };
  };
  const r = await eraseShareVotes({ githubId: '9', env: CF, fetchImpl });
  assert.equal(r.scrubbed, 1); // only alice/x contained '9'
  assert.equal(puts.length, 1);
  assert.ok(!puts[0].body.voters.includes('9'), 'the erased id is removed from the voter set');
  assert.deepEqual(puts[0].body.voters, ['v2']);
});

test('eraseShareVotes is a reported no-op without CF credentials', async () => {
  const r = await eraseShareVotes({ githubId: '9', env: {}, fetchImpl: () => { throw new Error('no fetch'); } });
  assert.equal(r.skipped, true);
});

test('planErasure marks the auto-driven steps auto and keeps the irreversible ones manual', () => {
  const plan = planErasure({ githubId: '9', username: 'alice' });
  const activity = plan.find((s) => s.step === 'activity');
  assert.ok(activity.action.includes('activity:9'));
  assert.ok(activity.action.includes('follows:9'), 'the auto step also deletes the follow graph');
  // SOW-024: content, activity, lookup-cache, discord, members-index are now AUTO-DRIVEN
  for (const step of ['content', 'activity', 'notifications', 'lookup-cache', 'discord', 'members-index']) {
    assert.equal(plan.find((s) => s.step === step).auto, true, step);
  }
  const notif = plan.find((s) => s.step === 'notifications');
  assert.ok(notif.action.includes('notifications:9'), 'the notifications step names the per-member key');
  // crypto-shred, stripe (irreversible, opt-in), kv-mirror, de-index stay MANUAL
  for (const step of ['crypto-shred', 'stripe', 'kv-mirror', 'de-index']) {
    assert.equal(plan.find((s) => s.step === step).auto, false, step);
  }
});

test('CLI parseArgs: dry-run default, --apply opt-in, --delete-stripe + --operator read', () => {
  assert.deepEqual(parseArgs(['--github-id', '5', '--username', 'bob']), { githubId: '5', username: 'bob', operator: null, apply: false, deleteStripe: false });
  assert.equal(parseArgs(['--github-id', '5', '--apply']).apply, true);
  assert.equal(parseArgs(['--github-id', '5', '--apply', '--dry-run']).apply, false); // dry-run wins
  assert.equal(parseArgs(['--github-id', '5', '--apply', '--delete-stripe']).deleteStripe, true);
  assert.equal(parseArgs(['--github-id', '5', '--operator', 'hudson']).operator, 'hudson');
  assert.equal(parseArgs([]).githubId, null);
});

// SOW-111: the per-item news detail-open sets join the erasure sweep.
test('eraseNewsOpens scrubs the id from every news-opens:* set (and only writes changed sets)', async () => {
  const puts = [];
  const fetchImpl = async (url, init) => {
    if (url.includes('/keys')) {
      return { ok: true, json: async () => ({ result: [{ name: 'news-opens:g1' }, { name: 'news-opens:g2' }], result_info: { cursor: '' } }) };
    }
    if ((init?.method || 'GET') === 'GET' && url.includes('/values/')) {
      const key = decodeURIComponent(url.split('/values/')[1]);
      const store = {
        'news-opens:g1': { openers: ['42', '7'], postedAt: null, updatedAt: 1 },
        'news-opens:g2': { openers: ['7'], postedAt: 5, updatedAt: 1 }, // does not include 42 -> unchanged
      };
      return { ok: true, json: async () => store[key] };
    }
    if (init?.method === 'PUT') { puts.push({ url, body: JSON.parse(init.body) }); return { ok: true }; }
    return { ok: true };
  };
  const r = await eraseNewsOpens({ githubId: '42', env: CF, fetchImpl });
  assert.equal(r.scrubbed, 1); // only g1 contained '42'
  assert.equal(puts.length, 1);
  assert.deepEqual(puts[0].body.openers, ['7']);
});

test('planErasure includes the news-opens auto step', () => {
  const plan = planErasure({ githubId: '42', username: 'alice' });
  const step = plan.find((s) => s.step === 'news-opens');
  assert.ok(step);
  assert.equal(step.auto, true);
});
