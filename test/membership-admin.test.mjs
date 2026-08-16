// SOW-038 P2: the admin-only per-member Stripe-status Worker endpoint. Fail-closed admin gate (token -> github_id
// -> role from the SIGNUP_KV overrides mirror) + the Stripe enumeration. Pure over injected deps; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeAdmin, authorizeStaff, authorizeSuperadmin, membershipAdminStatuses } from '../workers/signup/membership-admin.mjs';
import { signSession } from '../workers/signup/session.mjs'; // sow-158 Phase 1b: mint a website session cookie

const req = (token) => ({ headers: { get: (k) => (k === 'Authorization' && token ? `Bearer ${token}` : null) } });
const now = new Date('2026-06-17T00:00:00Z');
// generatedAt sits just before `now` so the Worker's freshness check (age in [0, 48h]) passes deterministically.
const freshMirror = (overrides = {}) => ({
  generatedAt: new Date(now.getTime() - 60_000).toISOString(),
  roles: { superadmins: [{ github_id: '1' }], admins: [{ github_id: '2' }], moderators: [{ github_id: '3' }] },
  bans: { bans: [] }, grandfathered: { grandfathered: [] },
  ...overrides,
});
const envWith = (mirror, { stripe = true } = {}) => ({
  SIGNUP_KV: { get: async () => mirror },
  ...(stripe ? { STRIPE_SECRET_KEY: 'sk_test_x' } : {}),
});
// fetchUser maps a token to its github id; an unknown token throws (simulating GitHub rejecting it).
const fetchUser = async (token) => {
  const map = { sa: '1', admin: '2', mod: '3', member: '9' };
  if (!map[token]) throw new Error('bad token');
  return { githubId: map[token], login: token };
};

test('authorizeAdmin: no token -> 401', async () => {
  const r = await authorizeAdmin(req(null), envWith(freshMirror()), { fetchUser, now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('sow-158 Phase 1b: a session cookie alone does NOT authorize admin (the gate stays bearer-only)', async () => {
  // Even a valid superadmin session cookie is rejected: the admin gate never opted into cookie auth, so it
  // resolves identity from the bearer token only and 401s before it ever reads the overrides mirror.
  const session = await signSession({ githubId: '1', githubLogin: 'super' }, 'secret');
  const reqCookie = new Request('https://signup.gbti.network/membership/admin/ops', { method: 'POST', headers: { Cookie: 'gbti_session=' + session } });
  const r = await authorizeAdmin(reqCookie, envWith(freshMirror()), { now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
  assert.equal(r.body.message, 'a GitHub bearer token is required');
});

// sow-161: the website admin surface opts the admin gate INTO cookie auth (allowCookie:true). A valid staff
// session then authorizes over the httpOnly-cookie session, with the SAME fail-closed mirror/role checks.
test('sow-161: authorizeAdmin with allowCookie accepts a valid superadmin session cookie (GET, no CSRF)', async () => {
  const session = await signSession({ githubId: '1', githubLogin: 'super' }, 'secret');
  const reqCookie = new Request('https://signup.gbti.network/membership/admin/statuses', { headers: { Cookie: 'gbti_session=' + session } });
  const env = { ...envWith(freshMirror()), SESSION_SECRET: 'secret' };
  const r = await authorizeAdmin(reqCookie, env, { allowCookie: true, now });
  assert.equal(r.ok, true);
  assert.equal(r.role, 'superadmin');
  assert.equal(r.githubId, '1');
});

test('sow-161: authorizeAdmin with allowCookie still 403s a non-admin (member) session', async () => {
  const session = await signSession({ githubId: '9', githubLogin: 'member' }, 'secret');
  const reqCookie = new Request('https://signup.gbti.network/membership/admin/statuses', { headers: { Cookie: 'gbti_session=' + session } });
  const env = { ...envWith(freshMirror()), SESSION_SECRET: 'secret' };
  const r = await authorizeAdmin(reqCookie, env, { allowCookie: true, now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('sow-161: authorizeStaff admits a moderator (bearer + cookie) but forbids a plain member', async () => {
  const env = { ...envWith(freshMirror()), SESSION_SECRET: 'secret' };
  const rb = await authorizeStaff(req('mod'), env, { fetchUser, now });
  assert.equal(rb.ok, true);
  assert.equal(rb.role, 'moderator');
  const session = await signSession({ githubId: '3', githubLogin: 'mod' }, 'secret');
  const rc = await authorizeStaff(new Request('https://signup.gbti.network/x', { headers: { Cookie: 'gbti_session=' + session } }), env, { allowCookie: true, now });
  assert.equal(rc.ok, true);
  assert.equal(rc.role, 'moderator');
  const rm = await authorizeStaff(req('member'), env, { fetchUser, now });
  assert.equal(rm.ok, false);
  assert.equal(rm.status, 403);
});

test('authorizeAdmin: admin + superadmin pass; moderator + member are forbidden', async () => {
  const env = envWith(freshMirror());
  assert.equal((await authorizeAdmin(req('sa'), env, { fetchUser, now })).ok, true);
  assert.equal((await authorizeAdmin(req('admin'), env, { fetchUser, now })).ok, true);
  const mod = await authorizeAdmin(req('mod'), env, { fetchUser, now });
  assert.equal(mod.status, 403);
  const member = await authorizeAdmin(req('member'), env, { fetchUser, now });
  assert.equal(member.status, 403);
});

test('authorizeAdmin: a stale or missing mirror fails closed (403)', async () => {
  const stale = freshMirror({ generatedAt: new Date('2020-01-01').toISOString() });
  assert.equal((await authorizeAdmin(req('sa'), envWith(stale), { fetchUser, now })).status, 403);
  assert.equal((await authorizeAdmin(req('sa'), envWith(null), { fetchUser, now })).status, 403);
  // a malformed roles section (bare array) must not silently drop the gate
  const bad = freshMirror({ roles: [] });
  assert.equal((await authorizeAdmin(req('sa'), envWith(bad), { fetchUser, now })).status, 403);
});

// SOW-078: ban > staff. A banned admin/superadmin/curator must be denied, and a malformed bans section must fail
// closed (never silently drop the ban tier and grant admin).
test('authorizeAdmin: a BANNED superadmin is denied (ban overrides staff)', async () => {
  const banned = freshMirror({ bans: { bans: [{ github_id: '1' }] } }); // '1' is a superadmin in the roster
  const r = await authorizeAdmin(req('sa'), envWith(banned), { fetchUser, now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not permitted/);
});

test('authorizeAdmin: a malformed/missing bans section fails closed (403), not an open admin grant', async () => {
  const badBans = freshMirror({ bans: [] }); // a bare array, not { bans: [...] }
  assert.equal((await authorizeAdmin(req('sa'), envWith(badBans), { fetchUser, now })).status, 403);
  const noBans = freshMirror({ bans: undefined });
  assert.equal((await authorizeAdmin(req('sa'), envWith(noBans), { fetchUser, now })).status, 403);
});

test('membershipAdminStatuses: admin gets a github_id -> status map from Stripe', async () => {
  const customers = [
    { metadata: { github_id: '2' }, subscriptions: { data: [{ status: 'active' }] } },
    { metadata: { github_id: '7', trial_started_at: new Date('2026-06-10').toISOString() }, subscriptions: { data: [] } },
    { metadata: {}, subscriptions: { data: [] } }, // no github_id -> skipped
  ];
  const makeStripe = () => ({ async *listCustomers() { for (const c of customers) yield c; } });
  const r = await membershipAdminStatuses(req('admin'), envWith(freshMirror()), { fetchUser, makeStripe, now });
  assert.equal(r.status, 200);
  assert.equal(r.body.statuses['2'], 'paid');
  assert.equal(r.body.statuses['7'], 'trialing'); // within 90d of trial_started_at, no sub
  assert.equal('' in r.body.statuses, false); // the metadata-less customer was skipped
});

test('membershipAdminStatuses: a non-admin is forbidden before any Stripe call', async () => {
  let listed = false;
  const makeStripe = () => ({ async *listCustomers() { listed = true; } });
  const r = await membershipAdminStatuses(req('member'), envWith(freshMirror()), { fetchUser, makeStripe, now });
  assert.equal(r.status, 403);
  assert.equal(listed, false, 'Stripe must not be queried for a non-admin');
});

test('membershipAdminStatuses: a Stripe error fails closed to 502 (no partial data)', async () => {
  const makeStripe = () => ({ async *listCustomers() { throw new Error('stripe down'); } });
  const r = await membershipAdminStatuses(req('sa'), envWith(freshMirror()), { fetchUser, makeStripe, now });
  assert.equal(r.status, 502);
});

test('sow-229: statuses endpoint returns tiers (from the subscription price) and pendingGrants (from the KV binding)', async () => {
  const customers = [
    { metadata: { github_id: '2' }, subscriptions: { data: [{ status: 'active', items: { data: [{ price: { id: 'price_creator' } }] } }] } },
  ];
  const makeStripe = () => ({ async *listCustomers() { for (const c of customers) yield c; } });
  const mirror = freshMirror();
  // a KV that answers BOTH the auth mirror get and the redemption list/get (the Worker binding shape)
  const kv = {
    async get(key) {
      if (key === 'redemption:CODEABLEYEAR:190312419') return { until: '2027-08-16T00:00:00Z', tier: 'creator', login: 'metacast' };
      return mirror; // OVERRIDES_KV_KEY (the auth path)
    },
    async list({ prefix } = {}) {
      return prefix === 'redemption:' ? { keys: [{ name: 'redemption:CODEABLEYEAR:190312419' }], list_complete: true } : { keys: [], list_complete: true };
    },
  };
  const env = { SIGNUP_KV: kv, STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_PRICE_ID: 'price_creator' }; // seeds price_creator -> creator
  const r = await membershipAdminStatuses(req('admin'), env, { fetchUser, makeStripe, now });
  assert.equal(r.status, 200);
  assert.equal(r.body.statuses['2'], 'paid');
  assert.equal(r.body.tiers['2'], 'creator'); // derived from the active subscription's price
  assert.deepEqual(r.body.pendingGrants['190312419'], { code: 'CODEABLEYEAR', until: '2027-08-16T00:00:00Z', tier: 'creator' });
});

test('sow-229: a KV list failure omits pendingGrants without failing the roster', async () => {
  const customers = [{ metadata: { github_id: '2' }, subscriptions: { data: [{ status: 'active' }] } }];
  const makeStripe = () => ({ async *listCustomers() { for (const c of customers) yield c; } });
  const mirror = freshMirror();
  const kv = { async get() { return mirror; }, async list() { throw new Error('kv down'); } };
  const env = { SIGNUP_KV: kv, STRIPE_SECRET_KEY: 'sk_test_x' };
  const r = await membershipAdminStatuses(req('admin'), env, { fetchUser, makeStripe, now });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.pendingGrants, {}); // fail-soft: no pending annotation, roster still renders
});

// sow-183: authorizeSuperadmin gates the hosted-authoring endpoint's cross-folder write (house/ or another
// member's folder, for content authorship reassignment). Same fail-closed mirror gate as authorizeAdmin, but
// the floor is superadmin, not admin -- an admin alone must NOT pass.
test('authorizeSuperadmin: a superadmin passes; admin, moderator, and member are all forbidden', async () => {
  const env = envWith(freshMirror());
  const sa = await authorizeSuperadmin(req('sa'), env, { fetchUser, now });
  assert.equal(sa.ok, true);
  assert.equal(sa.role, 'superadmin');
  assert.equal(sa.githubId, '1');
  const admin = await authorizeSuperadmin(req('admin'), env, { fetchUser, now });
  assert.equal(admin.ok, false);
  assert.equal(admin.status, 403);
  const mod = await authorizeSuperadmin(req('mod'), env, { fetchUser, now });
  assert.equal(mod.status, 403);
  const member = await authorizeSuperadmin(req('member'), env, { fetchUser, now });
  assert.equal(member.status, 403);
});

test('authorizeSuperadmin: no token -> 401, before any mirror read', async () => {
  const r = await authorizeSuperadmin(req(null), envWith(freshMirror()), { fetchUser, now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('authorizeSuperadmin: a BANNED superadmin is denied (ban overrides staff, same as authorizeAdmin)', async () => {
  const banned = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await authorizeSuperadmin(req('sa'), envWith(banned), { fetchUser, now });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

test('authorizeSuperadmin: a stale or missing mirror fails closed (403), never silently grants', async () => {
  const stale = freshMirror({ generatedAt: new Date('2020-01-01').toISOString() });
  assert.equal((await authorizeSuperadmin(req('sa'), envWith(stale), { fetchUser, now })).status, 403);
  assert.equal((await authorizeSuperadmin(req('sa'), envWith(null), { fetchUser, now })).status, 403);
});

// GET, no CSRF: this tests authorizeSuperadmin's own role gate in isolation (matching the existing
// authorizeAdmin cookie test's convention); the mutation-path CSRF enforcement is resolveIdentity's own
// concern, already covered by its own test suite.
test('sow-161-style: authorizeSuperadmin with allowCookie accepts a valid superadmin session cookie', async () => {
  const session = await signSession({ githubId: '1', githubLogin: 'super' }, 'secret');
  const reqCookie = new Request('https://signup.gbti.network/membership/author', { headers: { Cookie: 'gbti_session=' + session } });
  const env = { ...envWith(freshMirror()), SESSION_SECRET: 'secret' };
  const r = await authorizeSuperadmin(reqCookie, env, { allowCookie: true, now });
  assert.equal(r.ok, true);
  assert.equal(r.githubId, '1');
});
