// SOW-038 P3: the admin-gated operations dispatch (reconcile / E2E-smoke). Fail-closed admin gate FIRST; an
// allow-list maps action -> repository_dispatch event_type (no arbitrary workflow/event); the dispatch token stays
// in the Worker. Pure over injected authorize/fetch; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminOps } from '../workers/signup/membership-admin-ops.mjs';

const req = (body) => ({ headers: { get: () => 'Bearer t' }, json: async () => body });
const okAuth = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const denyAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'admin access is required' } });
const ENV = { REGATE_DISPATCH_TOKEN: 'tok', GITHUB_CONTENT_REPO: 'gbti-network/gbti.network' };

test('admin-ops: a non-admin is forbidden BEFORE any dispatch', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: denyAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 403);
  assert.equal(called, false);
});

test('admin-ops: reconcile -> repository_dispatch "admin-reconcile" with NO github_id (full --apply), bot token', async () => {
  let sent = null;
  const fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization }; return { status: 204 }; };
  const r = await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch });
  assert.equal(r.status, 200);
  assert.equal(r.body.triggered, 'reconcile');
  assert.match(sent.url, /\/repos\/gbti-network\/gbti\.network\/dispatches$/);
  assert.equal(sent.body.event_type, 'admin-reconcile');
  assert.equal(sent.body.client_payload.github_id, undefined); // NOT targeted -> reconcile runs a full --apply
  assert.equal(sent.body.client_payload.by, '1');
  assert.equal(sent.auth, 'Bearer tok'); // the Worker-held dispatch token, never the caller's
});

test('admin-ops: e2e -> "admin-e2e"', async () => {
  let evt = null;
  const r = await membershipAdminOps(req({ action: 'e2e' }), ENV, { authorize: okAuth, fetch: async (_u, init) => { evt = JSON.parse(init.body).event_type; return { status: 204 }; } });
  assert.equal(r.status, 200);
  assert.equal(evt, 'admin-e2e');
});

// sow-213: the mirror refresh is the fast path after a ban. Before this op existed, nothing fired
// repository_dispatch 'sync-mirror' at all (sync-overrides-mirror.yml accepted the type and a comment claimed the
// Worker fired it), so a ban reached the edge only on the next 6-hour cron tick. These pin the op AND the gate.
test('admin-ops: sync-mirror -> repository_dispatch "sync-mirror" (the post-ban fast path)', async () => {
  let evt = null;
  const r = await membershipAdminOps(req({ action: 'sync-mirror' }), ENV, { authorize: okAuth, fetch: async (_u, init) => { evt = JSON.parse(init.body).event_type; return { status: 204 }; } });
  assert.equal(r.status, 200);
  assert.equal(evt, 'sync-mirror', 'must fire the exact type sync-overrides-mirror.yml listens for');
});

test('admin-ops: sync-mirror is admin-gated like every other op, and denies BEFORE dispatching', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'sync-mirror' }), ENV, { authorize: denyAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 403);
  assert.equal(called, false, 'a refused caller must not reach the dispatch');
});

test('admin-ops: an unknown action -> 400 (allow-list), no dispatch', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'deploy' }), ENV, { authorize: okAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 400);
  assert.equal(called, false);
});

test('admin-ops: misconfigured (no dispatch token) -> 500, no dispatch (inert until provisioned)', async () => {
  let called = false;
  const r = await membershipAdminOps(req({ action: 'reconcile' }), { GITHUB_CONTENT_REPO: 'x/y' }, { authorize: okAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal(r.status, 500);
  assert.equal(called, false);
});

test('admin-ops: a GitHub non-204 / network error -> 502', async () => {
  assert.equal((await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch: async () => ({ status: 422 }) })).status, 502);
  assert.equal((await membershipAdminOps(req({ action: 'reconcile' }), ENV, { authorize: okAuth, fetch: async () => { throw new Error('net'); } })).status, 502);
});

test('admin-ops: category-migrate forwards validated migration params as client_payload (SOW-055)', async () => {
  let sent = null;
  const fetch = async (_u, init) => { sent = JSON.parse(init.body); return { status: 204 }; };
  const r = await membershipAdminOps(req({ action: 'category-migrate', params: { action: 'move', from: 'devops/frameworks', toParent: '', apply: true } }), ENV, { authorize: okAuth, fetch });
  assert.equal(r.status, 200);
  assert.equal(sent.event_type, 'category-migrate');
  assert.equal(sent.client_payload.action, 'move');
  assert.equal(sent.client_payload.from, 'devops/frameworks');
  assert.equal(sent.client_payload.apply, 'true');
  assert.equal(sent.client_payload.by, '1');
});

test('admin-ops: category-migrate with bad params -> 400, no dispatch', async () => {
  let called = false;
  const bad = (p) => membershipAdminOps(req({ action: 'category-migrate', params: p }), ENV, { authorize: okAuth, fetch: async () => { called = true; return { status: 204 }; } });
  assert.equal((await bad({ action: 'nope', from: 'x' })).status, 400); // unknown inner action
  assert.equal((await bad({ action: 'move' })).status, 400);            // missing from
  assert.equal(called, false);
});
