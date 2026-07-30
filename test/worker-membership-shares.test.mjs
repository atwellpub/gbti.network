// sow-158 Part 3: the tier-gated community Shares feed (GET /membership/shares). Verifies the Trees enumeration
// + newest-first read, the KV cache, and the SERVER-SIDE tier gate: a paid/trialing caller sees the members +
// public stream; every other signed-in tier (free/expired/banned) sees ONLY public shares, and a members share's
// body never travels (pointer-only). Injected token + fetch + auth: no network, no secrets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enumerateShares, listSharesFeed } from '../workers/signup/membership-shares.mjs';

// A minimal share file (frontmatter + body) as GitHub Contents returns it (base64 content).
function shareFile({ id, author, visibility = 'members', title = 'A share', body = 'hello', enc = null }) {
  const fm = [
    '---',
    'type: share',
    `id: "${id}"`,
    `author: ${author}`,
    `title: "${title}"`,
    `visibility: ${visibility}`,
    `createdAt: "${id.slice(0, 4)}-${id.slice(4, 6)}-${id.slice(6, 8)}T00:00:00Z"`,
    'status: published',
    ...(enc ? [`encryptedBody: ${enc}`] : []),
    '---',
    '',
    // a members share ships an EMPTY body in the stub (its plaintext lives in the .enc)
    visibility === 'members' ? '' : body,
    '',
  ].join('\n');
  return { content: Buffer.from(fm, 'utf8').toString('base64') };
}

// A fake GitHub that answers the Trees call then per-file Contents reads from a fixture map.
function fakeGitHub(files) {
  return async (url) => {
    if (url.includes('/git/trees/')) {
      return { ok: true, json: async () => ({ tree: Object.keys(files).map((path) => ({ path, type: 'blob' })) }) };
    }
    const m = url.match(/\/contents\/(.+?)\?ref=/);
    const path = m ? decodeURIComponent(m[1]) : '';
    if (files[path]) return { ok: true, json: async () => files[path] };
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

const FIXTURE = {
  'members/alice/shares/20260101000000-oldest.md': shareFile({ id: '20260101000000-oldest', author: 'alice', visibility: 'public', body: 'public-old' }),
  'members/bob/shares/20260201000000-mid.md': shareFile({ id: '20260201000000-mid', author: 'bob', visibility: 'members', enc: 'members/bob/_enc/share-x.enc' }),
  'members/alice/shares/20260301000000-newest.md': shareFile({ id: '20260301000000-newest', author: 'alice', visibility: 'public', body: 'public-new' }),
  'members/carol/shares/20260115000000-draft.md': { content: Buffer.from('---\ntype: share\nid: "d"\nauthor: carol\nstatus: draft\nvisibility: public\n---\nx', 'utf8').toString('base64') },
};

const deps = () => ({ fetchImpl: fakeGitHub(FIXTURE), kv: null, useCache: false, getToken: async () => 'tok', upstream: 'gbti-network/gbti.network' });

test('enumerateShares reads published shares newest-first and drops drafts; members body is pointer-only', async () => {
  const items = await enumerateShares({}, deps());
  assert.deepEqual(items.map((s) => s.id), ['20260301000000-newest', '20260201000000-mid', '20260101000000-oldest']);
  const members = items.find((s) => s.visibility === 'members');
  assert.equal(members.body, '', 'a members share never carries its plaintext body here');
  assert.equal(members.encryptedBody, 'members/bob/_enc/share-x.enc', 'the pointer is preserved for client-side decrypt');
});

test('enumerateShares serves the KV cache when present (no Trees call)', async () => {
  let calls = 0;
  const kv = { get: async () => ({ items: [{ id: 'cached', visibility: 'public' }] }), put: async () => {} };
  const items = await enumerateShares({}, { fetchImpl: async () => { calls += 1; return { ok: true, json: async () => ({}) }; }, kv, getToken: async () => 'tok' });
  assert.deepEqual(items.map((s) => s.id), ['cached']);
  assert.equal(calls, 0, 'the cache short-circuits GitHub entirely');
});

const req = (qs = '') => new Request('https://signup.gbti.network/membership/shares' + qs);
const paidAuth = async () => ({ ok: true, githubId: '1', login: 'alice', status: 'paid' });
const freeAuth = async () => ({ ok: true, githubId: '2', login: 'dan', status: 'none' });
const bannedAuth = async () => ({ ok: true, githubId: '3', login: 'x', status: 'banned' });
const denyAuth = async () => ({ ok: false, status: 401, body: { error: 'unauthorized' } });

test('listSharesFeed: a paid caller sees the members + public stream', async () => {
  const r = await listSharesFeed(req(), {}, { ...deps(), authorize: paidAuth });
  assert.equal(r.status, 200);
  assert.equal(r.body.canSeeMembers, true);
  assert.deepEqual(r.body.items.map((s) => s.visibility).sort(), ['members', 'public', 'public']);
});

test('listSharesFeed: a free caller sees ONLY public shares (members stream is filtered server-side)', async () => {
  const r = await listSharesFeed(req(), {}, { ...deps(), authorize: freeAuth });
  assert.equal(r.status, 200);
  assert.equal(r.body.canSeeMembers, false);
  assert.ok(r.body.items.every((s) => s.visibility === 'public'), 'no members share leaks to a free tier');
  assert.equal(r.body.items.length, 2);
});

test('listSharesFeed: a banned caller still reads PUBLIC shares (community ban), never members', async () => {
  const r = await listSharesFeed(req(), {}, { ...deps(), authorize: bannedAuth });
  assert.equal(r.status, 200);
  assert.equal(r.body.canSeeMembers, false);
  assert.ok(r.body.items.every((s) => s.visibility === 'public'));
});

test('listSharesFeed: an unauthenticated caller is refused (401 passes through)', async () => {
  const r = await listSharesFeed(req(), {}, { ...deps(), authorize: denyAuth });
  assert.equal(r.status, 401);
  assert.equal(r.body.error, 'unauthorized');
});

test('listSharesFeed: limit + before cursor paginate newest-first', async () => {
  const first = await listSharesFeed(req('?limit=2'), {}, { ...deps(), authorize: paidAuth });
  assert.deepEqual(first.body.items.map((s) => s.id), ['20260301000000-newest', '20260201000000-mid']);
  assert.equal(first.body.nextBefore, '20260201000000-mid');
  const older = await listSharesFeed(req('?limit=2&before=' + first.body.nextBefore), {}, { ...deps(), authorize: paidAuth });
  assert.deepEqual(older.body.items.map((s) => s.id), ['20260101000000-oldest']);
  assert.equal(older.body.nextBefore, null, 'no full page -> no further cursor');
});

test('listSharesFeed: a Trees failure is a 502, never a partial open', async () => {
  const boom = { fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }), kv: null, useCache: false, getToken: async () => 'tok' };
  const r = await listSharesFeed(req(), {}, { ...boom, authorize: paidAuth });
  assert.equal(r.status, 502);
});
