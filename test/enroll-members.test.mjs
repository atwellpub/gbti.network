// SOW-157: hosted-member enrollment (scripts/lib/enroll-members.mjs). The security rules under test are the
// adversarial-review findings: folder-hijack guard, evidence-folder preference over login, casing, immutable
// id-keyed login resolve, and the parse round-trip proof before any PR.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  enrollmentCandidates,
  planEnrollments,
  appendIndexEntries,
  syncEnrollments,
} from '../scripts/lib/enroll-members.mjs';

const idx = (entries = {}) => new Map(Object.entries(entries));

test('enrollmentCandidates: unindexed effective-paid only (banned + trial + indexed excluded)', () => {
  const members = [
    { githubId: '1', githubLogin: 'Alice', effective: { status: 'paid' }, username: null },
    { githubId: '2', githubLogin: 'bob', effective: { status: 'paid' }, username: 'bobfolder' },
    { githubId: '3', githubLogin: 'carol', effective: { status: 'trialing' }, username: null },
    { githubId: '4', githubLogin: 'dan', effective: { status: 'banned' }, username: null },
    { githubId: '5', githubLogin: 'indexed', effective: { status: 'paid' }, username: 'indexed' },
  ];
  const c = enrollmentCandidates(members, idx({ 5: 'indexed' }));
  assert.deepEqual(c.map((x) => x.githubId), ['1', '2']);
  assert.equal(c[1].evidenceFolder, 'bobfolder', 'profile-evidence folder carried through');
});

test('planEnrollments: evidence folder wins over login; minted folder comes from the API login, lowercased', () => {
  const { additions, rejects } = planEnrollments({
    candidates: [
      { githubId: '1', evidenceFolder: 'hudson' }, // real case: folder differs from login
      { githubId: '2', evidenceFolder: null },
    ],
    loginById: new Map([['2', 'NewMember']]),
    existingFolders: new Set(['hudson']),
    membersIndex: idx(),
  });
  assert.equal(rejects.length, 0);
  assert.deepEqual(additions, [
    { githubId: '1', folder: 'hudson' },
    { githubId: '2', folder: 'newmember' },
  ]);
});

test('planEnrollments: folder-hijack guard rejects a minted folder that exists without evidence', () => {
  const { additions, rejects } = planEnrollments({
    candidates: [{ githubId: '9', evidenceFolder: null }],
    loginById: new Map([['9', 'legacy-folder']]),
    existingFolders: new Set(['legacy-folder']),
    membersIndex: idx(),
  });
  assert.equal(additions.length, 0);
  assert.match(rejects[0].reason, /already exists without index evidence/);
});

test('planEnrollments: rejects unresolvable logins, invalid folder names, and already-claimed folders', () => {
  const { additions, rejects } = planEnrollments({
    candidates: [
      { githubId: '1', evidenceFolder: null }, // no API login
      { githubId: '2', evidenceFolder: null }, // login with an underscore (invalid folder)
      { githubId: '3', evidenceFolder: 'takenfolder' }, // claimed by another id in the index
    ],
    loginById: new Map([['2', 'bad_name']]),
    existingFolders: new Set(),
    membersIndex: idx({ 8: 'takenfolder' }),
  });
  assert.equal(additions.length, 0);
  assert.equal(rejects.length, 3);
  assert.match(rejects[0].reason, /could not re-resolve/);
  assert.match(rejects[1].reason, /does not fit the folder rules/);
  assert.match(rejects[2].reason, /already claimed/);
});

test('planEnrollments: two candidates resolving to the same folder — second rejected', () => {
  const { additions, rejects } = planEnrollments({
    candidates: [
      { githubId: '1', evidenceFolder: null },
      { githubId: '2', evidenceFolder: null },
    ],
    loginById: new Map([['1', 'same'], ['2', 'Same']]),
    existingFolders: new Set(),
    membersIndex: idx(),
  });
  assert.equal(additions.length, 1);
  assert.equal(rejects.length, 1);
});

const INDEX = '# header\nmembers:\n  "2002207": atwellpub\n';

test('appendIndexEntries: appends inside the mapping and round-trips both parsers', () => {
  const next = appendIndexEntries(INDEX, [{ githubId: '55', folder: 'newbie' }], new Date('2026-07-25T00:00:00Z'));
  assert.match(next, /"55": newbie\n$/);
  assert.match(next, /SOW-157/);
  // idempotence guard: appending a duplicate id throws
  assert.throws(() => appendIndexEntries(next, [{ githubId: '55', folder: 'other' }]), /duplicate github_id|round-trip|duplicated mapping key/);
});

test('syncEnrollments: dry run plans but never writes; apply opens + merges ONE PR', async () => {
  const members = [{ githubId: '55', githubLogin: 'Newbie', effective: { status: 'paid' }, username: null }];
  const overrides = { membersIndex: idx({ 2002207: 'atwellpub' }) };
  const resolveLogin = async (id) => (id === '55' ? 'Newbie' : null);
  const root = process.cwd(); // members/ exists; 'newbie' is not a real folder so no hijack trigger

  const dry = await syncEnrollments({ members, overrides, root, env: {}, github: null, dryRun: true, resolveLogin });
  assert.equal(dry.synced, false);
  assert.deepEqual(dry.additions, [{ githubId: '55', folder: 'newbie' }]);

  const calls = [];
  const github = {
    async getRef() { return { object: { sha: 'mainsha' } }; },
    async createRef(branch, sha) { calls.push({ op: 'ref', branch, sha }); },
    async getContent() { return { sha: 'filesha' }; },
    async putContent(p, opts) { calls.push({ op: 'put', path: p, content: Buffer.from(opts.content, 'base64').toString('utf8') }); },
    async createPull(opts) { calls.push({ op: 'pull', ...opts }); return { number: 7 }; },
    async mergePull(n, opts) { calls.push({ op: 'merge', n, method: opts.method }); },
  };
  const applied = await syncEnrollments({ members, overrides, root, env: {}, github, dryRun: false, resolveLogin, now: new Date('2026-07-25T00:00:00Z') });
  assert.equal(applied.synced, true);
  assert.equal(applied.prNumber, 7);
  const put = calls.find((c) => c.op === 'put');
  assert.equal(put.path, 'house/members-index.yml');
  assert.match(put.content, /"55": newbie/);
  assert.match(put.content, /"2002207": atwellpub/, 'existing entries preserved');
  assert.equal(calls.at(-1).op, 'merge', 'the PR merges in the same run (no open PR left to conflict)');
});

test('syncEnrollments: no candidates is a quiet no-op', async () => {
  const r = await syncEnrollments({
    members: [{ githubId: '2002207', githubLogin: 'atwellpub', effective: { status: 'paid' }, username: 'atwellpub' }],
    overrides: { membersIndex: idx({ 2002207: 'atwellpub' }) },
    root: process.cwd(), env: {}, dryRun: true,
  });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'no unenrolled effective-paid members');
});
