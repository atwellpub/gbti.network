// sow-194 Phase 1b: the owner-scoped repo-drafts Worker route (workers/signup/membership-repo-drafts.mjs).
// Reads the CI-built KV index + scopes it to the caller. Injected fetchUser + fake KV: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listRepoDrafts, REPO_DRAFTS_KV_KEY } from '../workers/signup/membership-repo-drafts.mjs';
import { OVERRIDES_KV_KEY } from '../workers/signup/membership-content.mjs';
import { REPO_DRAFTS_KV_KEY as BUILDER_KEY } from '../scripts/lib/repo-drafts-index.mjs';

const GET = (auth) => new Request('https://signup.gbti.network/membership/repo-drafts', { headers: auth ? { Authorization: auth } : {} });
const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: over.roles ?? {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });
const INDEX = { generatedAt: '2026-08-07T00:00:00.000Z', items: [
  { path: 'members/alice/posts/wip/index.md', type: 'post', slug: 'wip', owner: 'alice', githubId: '10', title: 'Alice WIP', visibility: 'public' },
  { path: 'members/bob/prompts/p/index.md', type: 'prompt', slug: 'p', owner: 'bob', githubId: '20', title: 'Bob prompt', visibility: 'members' },
  { path: 'house/posts/h/index.md', type: 'post', slug: 'h', owner: 'house', githubId: null, title: 'House draft', visibility: 'public' },
] };
const kvWith = (mirror, index = INDEX) => ({ get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : k === BUILDER_KEY ? index : null) });
const ENV = (mirror = freshMirror(), index = INDEX) => ({ SIGNUP_KV: kvWith(mirror, index) });
const deps = (githubId, login) => ({ fetchUser: async () => ({ githubId, githubLogin: login }) });

test('key drift: the Worker route key equals the CI builder key', () => {
  assert.equal(REPO_DRAFTS_KV_KEY, BUILDER_KEY);
});

test('a member sees ONLY their own folder drafts, tagged store:repo + status:draft', async () => {
  const r = await listRepoDrafts(GET('Bearer g'), ENV(), deps('10', 'alice'));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.deepEqual(r.body.items.map((i) => i.slug), ['wip']);
  assert.equal(r.body.items[0].store, 'repo');
  assert.equal(r.body.items[0].status, 'draft');
  assert.equal(r.body.items[0].owner, 'alice');
});

test('a superadmin sees EVERY folder + house', async () => {
  const mirror = freshMirror({ roles: { superadmins: [{ github_id: '99', login: 'root' }] } });
  const r = await listRepoDrafts(GET('Bearer g'), ENV(mirror), deps('99', 'root'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items.map((i) => i.slug).sort(), ['h', 'p', 'wip']);
});

test('a member with no drafts gets an empty list (NEVER another folder)', async () => {
  const r = await listRepoDrafts(GET('Bearer g'), ENV(), deps('11', 'carol'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
});

test('no token -> 401; banned -> 403; stale mirror -> 403 (all fail closed)', async () => {
  assert.equal((await listRepoDrafts(GET(null), ENV(), deps('10', 'alice'))).status, 401);
  const banned = freshMirror({ bans: { bans: [{ github_id: '10' }] } });
  assert.equal((await listRepoDrafts(GET('Bearer g'), ENV(banned), deps('10', 'alice'))).status, 403);
  const stale = freshMirror(); stale.generatedAt = new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString();
  assert.equal((await listRepoDrafts(GET('Bearer g'), ENV(stale), deps('10', 'alice'))).status, 403);
});

test('a not-yet-built index -> 200 with an empty list, not an error', async () => {
  const env = { SIGNUP_KV: { get: async (k) => (k === OVERRIDES_KV_KEY ? freshMirror() : null) } };
  const r = await listRepoDrafts(GET('Bearer g'), env, deps('10', 'alice'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
});

test('a would-be superadmin whose role is not in the mirror is scoped to own folder (fail closed)', async () => {
  // '99'/'root' with EMPTY roles -> not superadmin -> only their own (empty) folder, never all.
  const r = await listRepoDrafts(GET('Bearer g'), ENV(), deps('99', 'root'));
  assert.deepEqual(r.body.items, []);
});

test('review fix: scoping is by immutable github_id, so a login "house" never leaks house drafts', async () => {
  // Pre-fix a caller whose GitHub login was literally 'house' matched owner==='house' and got every house draft.
  // House rows carry githubId null, so an id-scoped filter never returns them to a non-superadmin.
  const r = await listRepoDrafts(GET('Bearer g'), ENV(), deps('77', 'house'));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
});

test('review fix: a login reused onto a departed member folder does NOT match (id-scoped, not login)', async () => {
  // A new account that took the freed username 'bob' but has a different id (99) sees nothing of bob's (id 20).
  assert.deepEqual((await listRepoDrafts(GET('Bearer g'), ENV(), deps('99', 'bob'))).body.items, []);
  // bob's REAL id still sees bob's draft.
  assert.deepEqual((await listRepoDrafts(GET('Bearer g'), ENV(), deps('20', 'bob'))).body.items.map((i) => i.slug), ['p']);
});
