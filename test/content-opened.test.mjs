// SOW-126: the member-content detail-open engagement beacon + its pure core. Distinct-opener counting, the
// configurable tier + signal gate, validation, and GDPR scrub. Fake KV + injected authorize; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipContentOpened } from '../workers/signup/membership-content-opened.mjs';
import { applyOpen, distinctOpenerCount, scrubOpener, normalizeContentOpens, contentOpensKey } from '../membership/content-opens.mjs';

const req = (body) => ({ method: 'POST', headers: { get: () => 'Bearer t' }, json: async () => body });
const memberAs = (githubId, status) => async () => ({ ok: true, githubId, login: `u${githubId}`, status });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const fakeKv = (seed = {}) => {
  const m = new Map(Object.entries(seed));
  return { store: m, get: async (k, t) => (m.has(k) ? (t === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); } };
};
const CONFIG = (ce = {}) => JSON.stringify({ enabled: true, content_engagement: { enabled: true, threshold: 3, tier: 'signed-in', signals: { opens: true, favorites: false, upvotes: false, comments: false }, ...ce } });

test('content-opens core: distinct openers, re-open no-op, scrub', () => {
  let r = applyOpen(null, { openerId: '1' }, { now: () => 10 });
  r = applyOpen(r, { openerId: '2' }, { now: () => 20 });
  r = applyOpen(r, { openerId: '1' }, { now: () => 30 }); // dup
  assert.equal(distinctOpenerCount(r), 2);
  const { record, changed } = scrubOpener(r, '1');
  assert.equal(changed, true);
  assert.equal(distinctOpenerCount(record), 1);
  assert.throws(() => applyOpen(r, { openerId: '' }));
  assert.equal(contentOpensKey('share', 'alice/x'), 'content-opens:share:alice/x');
  assert.deepEqual(normalizeContentOpens('junk'), { openers: [], updatedAt: null });
});

test('records a distinct open for a signed-in member and dedupes a re-open', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  const deps = (id) => ({ authorize: memberAs(id, 'none'), kv, now: () => 1000 });
  const r1 = await membershipContentOpened(req({ type: 'post', slug: 'my-post' }), {}, deps('1'));
  assert.equal(r1.body.counted, true);
  assert.equal(r1.body.openers, 1);
  const r2 = await membershipContentOpened(req({ type: 'post', slug: 'my-post' }), {}, deps('2'));
  assert.equal(r2.body.openers, 2);
  const rDup = await membershipContentOpened(req({ type: 'post', slug: 'my-post' }), {}, deps('1'));
  assert.equal(rDup.body.openers, 2); // same member re-opening does not double count
  assert.equal(distinctOpenerCount(await kv.get(contentOpensKey('post', 'my-post'), 'json')), 2);
});

test('a share keys on the composite <author>/<id>', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  const r = await membershipContentOpened(req({ type: 'share', slug: 'alice/20260101-x' }), {}, { authorize: memberAs('9', 'paid'), kv, now: () => 1 });
  assert.equal(r.body.counted, true);
  assert.ok(kv.store.has('content-opens:share:alice/20260101-x'));
});

test('a disabled config, opens-signal off, or off-tier member is a clean no-op (counted:false)', async () => {
  const off = fakeKv({ 'synd:config': JSON.stringify({ enabled: true, content_engagement: { enabled: false } }) });
  const r1 = await membershipContentOpened(req({ type: 'post', slug: 'p' }), {}, { authorize: memberAs('1', 'paid'), kv: off, now: () => 1 });
  assert.equal(r1.body.counted, false);
  const noOpens = fakeKv({ 'synd:config': CONFIG({ signals: { opens: false } }) });
  const r2 = await membershipContentOpened(req({ type: 'post', slug: 'p' }), {}, { authorize: memberAs('1', 'paid'), kv: noOpens, now: () => 1 });
  assert.equal(r2.body.counted, false);
  const paidOnly = fakeKv({ 'synd:config': CONFIG({ tier: 'paid' }) });
  const r3 = await membershipContentOpened(req({ type: 'post', slug: 'p' }), {}, { authorize: memberAs('1', 'none'), kv: paidOnly, now: () => 1 });
  assert.equal(r3.body.counted, false); // a free member does not count when the tier is paid
  assert.equal(paidOnly.store.has('content-opens:post:p'), false); // no KV write
});

test('sow-158: the allowCookie option is threaded to authorize (the website /browse reader path)', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  let seenAllowCookie;
  const spy = async (_req, _env, deps) => { seenAllowCookie = deps?.allowCookie; return { ok: true, githubId: '1', login: 'u1', status: 'paid' }; };
  await membershipContentOpened(req({ type: 'post', slug: 'p' }), {}, { authorize: spy, kv, now: () => 1, allowCookie: true });
  assert.equal(seenAllowCookie, true, 'allowCookie flows to the authorizer so the cookie session is accepted');
});

test('a banned/denied member never writes; a bad type or slug 400s', async () => {
  const kv = fakeKv({ 'synd:config': CONFIG() });
  const rBan = await membershipContentOpened(req({ type: 'post', slug: 'p' }), {}, { authorize: denied, kv, now: () => 1 });
  assert.equal(rBan.status, 403);
  assert.equal(kv.store.has('content-opens:post:p'), false);
  const rType = await membershipContentOpened(req({ type: 'news', slug: 'p' }), {}, { authorize: memberAs('1', 'paid'), kv, now: () => 1 });
  assert.equal(rType.status, 400); // news is not a content-open type
  const rSlug = await membershipContentOpened(req({ type: 'post', slug: '../evil' }), {}, { authorize: memberAs('1', 'paid'), kv, now: () => 1 });
  assert.equal(rSlug.status, 400);
  const rShareSlug = await membershipContentOpened(req({ type: 'share', slug: 'no-slash' }), {}, { authorize: memberAs('1', 'paid'), kv, now: () => 1 });
  assert.equal(rShareSlug.status, 400); // a share needs the composite <author>/<id>
});
