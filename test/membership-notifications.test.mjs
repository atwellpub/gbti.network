// SOW-150 / SOW-186: the notification Worker handler. Signed-in auth (stubbed), KV read-modify-write, the
// server-side deliver primitive, and erasure. No network/secrets: a fake KV + a stubbed authorizer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleNotifications, deliverNotification, eraseMemberNotifications, NOTIFICATIONS_KEY,
} from '../workers/signup/membership-notifications.mjs';

function fakeKv(initial = {}) {
  const m = new Map(Object.entries(initial));
  return {
    store: m,
    async get(k, type) { const v = m.get(k); return type === 'json' && typeof v === 'string' ? JSON.parse(v) : (v ?? null); },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
const req = (method, body) => ({
  method,
  headers: { get: () => 'Bearer tok' },
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
});
const member = async () => ({ ok: true, githubId: '42' });
const now = () => 5000;
let seq = 0;
const genId = () => `id${++seq}`;
const share = (slug) => ({ type: 'share', slug, url: `/shares/${slug}/`, title: 'A share' });

test('GET: an empty store returns no notifications and zero unseen', async () => {
  const r = await handleNotifications(req('GET'), {}, { kv: fakeKv(), authorize: member, now });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, notifications: [], unseen: 0 });
});

test('deliverNotification writes under notifications:<recipient> and GET reads it back', async () => {
  seq = 0;
  const kv = fakeKv();
  const d = await deliverNotification({}, '42', { type: 'mention', actor: 'alice', target: share('bob/xyz') }, { kv, now, genId });
  assert.deepEqual(d, { ok: true, unseen: 1 });
  assert.ok(kv.store.has(NOTIFICATIONS_KEY('42')), 'stored under the RECIPIENT github_id key');
  const r = await handleNotifications(req('GET'), {}, { kv, authorize: member, now });
  assert.equal(r.body.unseen, 1);
  assert.equal(r.body.notifications[0].actor, 'alice');
  assert.equal(r.body.notifications[0].target.slug, 'bob/xyz');
});

test('POST /seen with no body marks ALL of the caller\'s notifications seen', async () => {
  seq = 0;
  const kv = fakeKv();
  await deliverNotification({}, '42', { type: 'mention', actor: 'alice', target: share('bob/a') }, { kv, now, genId });
  await deliverNotification({}, '42', { type: 'mention', actor: 'dave', target: share('bob/b') }, { kv, now, genId });
  const r = await handleNotifications(req('POST'), {}, { kv, authorize: member, now }); // no body
  assert.equal(r.status, 200);
  assert.equal(r.body.unseen, 0, 'all marked seen');
  assert.ok(r.body.notifications.every((n) => n.seen === true));
});

test('POST /seen with { ids } marks only those seen', async () => {
  seq = 0;
  const kv = fakeKv();
  await deliverNotification({}, '42', { type: 'mention', actor: 'alice', target: share('bob/a') }, { kv, now, genId }); // id1
  await deliverNotification({}, '42', { type: 'mention', actor: 'dave', target: share('bob/b') }, { kv, now, genId }); // id2
  const r = await handleNotifications(req('POST', { ids: ['id1'] }), {}, { kv, authorize: member, now });
  assert.equal(r.body.unseen, 1);
  assert.equal(r.body.notifications.find((n) => n.id === 'id1').seen, true);
  assert.equal(r.body.notifications.find((n) => n.id === 'id2').seen, false);
});

test('a member reads/marks only THEIR OWN key (the authorized github_id), never a recipient in the body', async () => {
  seq = 0;
  const kv = fakeKv();
  // Someone else's store exists; the caller (42) must never see or touch it.
  await deliverNotification({}, '99', { type: 'mention', actor: 'alice', target: share('bob/z') }, { kv, now, genId });
  const r = await handleNotifications(req('POST', { ids: ['id1'], githubId: '99', recipient: '99' }), {}, { kv, authorize: member, now });
  assert.equal(r.status, 200);
  // 99's notification is untouched (still unseen) -- the handler ignored the body's recipient fields.
  const other = JSON.parse(kv.store.get(NOTIFICATIONS_KEY('99')));
  assert.equal(other.items[0].seen, false, "another member's store is never mutated by this caller");
});

test('an unauthorized / banned caller is denied (fail-closed), no read, no write', async () => {
  const kv = fakeKv();
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'sign in to view notifications' } });
  const r = await handleNotifications(req('GET'), {}, { kv, authorize: deny, now });
  assert.equal(r.status, 403);
  assert.equal(kv.store.size, 0, 'nothing read or written for a denied caller');
});

test('GET after a POST persists (the seen flip is written back)', async () => {
  seq = 0;
  const kv = fakeKv();
  await deliverNotification({}, '42', { type: 'mention', actor: 'alice', target: share('bob/a') }, { kv, now, genId });
  await handleNotifications(req('POST'), {}, { kv, authorize: member, now });
  const r = await handleNotifications(req('GET'), {}, { kv, authorize: member, now });
  assert.equal(r.body.unseen, 0, 'the seen state survives the round-trip through KV');
});

test('PUT (or any non GET/POST) is 405', async () => {
  const r = await handleNotifications(req('PUT'), {}, { kv: fakeKv(), authorize: member, now });
  assert.equal(r.status, 405);
});

test('a missing store is a 500 misconfigured (fail-closed, not a silent empty)', async () => {
  const r = await handleNotifications(req('GET'), {}, { kv: null, authorize: member, now });
  assert.equal(r.status, 500);
});

test('deliverNotification is a reported no-op without a store or recipient (a delivery failure never throws upward)', async () => {
  assert.deepEqual(await deliverNotification({}, '42', { type: 'mention', target: share('a/b') }, { kv: null }), { ok: false, error: 'the notification store is not configured' });
  assert.deepEqual(await deliverNotification({}, '', { type: 'mention', target: share('a/b') }, { kv: fakeKv(), now, genId }), { ok: false, error: 'a recipient github_id is required' });
});

test('eraseMemberNotifications hard-deletes the record (right-to-erasure)', async () => {
  const kv = fakeKv({ [NOTIFICATIONS_KEY('42')]: JSON.stringify({ items: [{ id: 'x', type: 'mention', target: { type: 'share', slug: 'a/b' }, createdAt: 1 }] }) });
  const r = await eraseMemberNotifications({}, '42', { kv });
  assert.deepEqual(r, { ok: true, key: 'notifications:42' });
  assert.equal(kv.store.has('notifications:42'), false);
});
