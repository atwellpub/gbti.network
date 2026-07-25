// SOW-157: the hosted draft store — pure transforms (membership/member-drafts.mjs) + the Worker handler
// (workers/signup/membership-drafts.mjs, fake KV + stubbed authorizer) + the client transport branch map.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeDrafts, applyDraftPut, applyDraftDelete, listDraftRecords, DraftError, DRAFTS_MAX_ITEMS,
} from '../membership/member-drafts.mjs';
import { handleDrafts, eraseMemberDrafts, DRAFTS_KEY } from '../workers/signup/membership-drafts.mjs';
import { hostedPublishFiles } from '../client/src/hosted-publish.mjs';

const draft = (over = {}) => ({ type: 'post', slug: 'my-post', path: 'members/a/posts/my-post/index.md', frontmatter: { title: 'X' }, body: 'hello', ...over });

test('applyDraftPut: upserts by type:slug; re-put replaces; list is newest first', () => {
  let s = applyDraftPut(normalizeDrafts(null), draft(), { now: () => '2026-01-01T00:00:00Z' });
  s = applyDraftPut(s, draft({ slug: 'second' }), { now: () => '2026-01-02T00:00:00Z' });
  s = applyDraftPut(s, draft({ body: 'updated' }), { now: () => '2026-01-03T00:00:00Z' });
  const list = listDraftRecords(s);
  assert.equal(list.length, 2);
  assert.equal(list[0].slug, 'my-post', 'newest first');
  assert.equal(list[0].body, 'updated');
});

test('applyDraftPut: rejects bad types/slugs, oversized drafts, and the item cap (fail closed)', () => {
  const s0 = normalizeDrafts(null);
  assert.throws(() => applyDraftPut(s0, draft({ type: 'house' })), DraftError);
  assert.throws(() => applyDraftPut(s0, draft({ slug: 'Bad Slug' })), DraftError);
  assert.throws(() => applyDraftPut(s0, draft({ body: 'x'.repeat(200_000) })), DraftError);
  let s = s0;
  for (let i = 0; i < DRAFTS_MAX_ITEMS; i++) s = applyDraftPut(s, draft({ slug: `d${i}` }));
  assert.throws(() => applyDraftPut(s, draft({ slug: 'one-too-many' })), DraftError);
  // a re-put of an EXISTING draft still works at the cap
  assert.ok(applyDraftPut(s, draft({ slug: 'd0', body: 'edit' })));
});

test('applyDraftDelete: idempotent', () => {
  let s = applyDraftPut(normalizeDrafts(null), draft());
  s = applyDraftDelete(s, { type: 'post', slug: 'my-post' });
  assert.equal(listDraftRecords(s).length, 0);
  assert.equal(listDraftRecords(applyDraftDelete(s, { type: 'post', slug: 'my-post' })).length, 0);
});

// ---- the Worker handler ----

const fakeKv = () => {
  const m = new Map();
  return { store: m, async get(k) { const v = m.get(k); return typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
};
const memberOk = async () => ({ ok: true, githubId: '77', status: 'trialing' }); // TRIAL may stage
const req = (method, body) => ({ method, headers: { get: () => 'Bearer tok' }, json: async () => body });

test('handleDrafts: put -> list -> delete round-trip for a signed-in (trial) member', async () => {
  const kv = fakeKv();
  const put = await handleDrafts(req('POST', { op: 'put', draft: draft() }), {}, { kv, authorize: memberOk });
  assert.equal(put.status, 200);
  assert.equal(put.body.drafts.length, 1);
  const list = await handleDrafts(req('GET'), {}, { kv, authorize: memberOk });
  assert.equal(list.body.drafts[0].slug, 'my-post');
  const del = await handleDrafts(req('POST', { op: 'delete', type: 'post', slug: 'my-post' }), {}, { kv, authorize: memberOk });
  assert.equal(del.body.drafts.length, 0);
});

test('handleDrafts: denies an unauthorized caller and maps a DraftError to 400', async () => {
  const deny = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
  const r = await handleDrafts(req('GET'), {}, { kv: fakeKv(), authorize: deny });
  assert.equal(r.status, 403);
  const bad = await handleDrafts(req('POST', { op: 'put', draft: draft({ slug: 'NOPE!' }) }), {}, { kv: fakeKv(), authorize: memberOk });
  assert.equal(bad.status, 400);
});

test('eraseMemberDrafts: a hard KV delete (SOW-024)', async () => {
  const kv = fakeKv();
  await kv.put(DRAFTS_KEY('77'), JSON.stringify({ items: { 'post:x': draft() } }));
  const r = await eraseMemberDrafts({}, '77', { kv });
  assert.equal(r.ok, true);
  assert.equal(await kv.get(DRAFTS_KEY('77')), null);
});

// ---- the hosted publishFiles seam (branch -> itemId mapping) ----

test('hostedPublishFiles: maps the gbti/ branch identity to the hosted itemId', async () => {
  const calls = [];
  const ctx = {
    store: { get: (k) => (k === 'githubToken' ? 'tok' : undefined) },
    fetch: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return { ok: true, branch: 'hosted/1/share-x', number: 5, html_url: 'u' }; } }; },
  };
  const r = await hostedPublishFiles(ctx, { branch: 'gbti/share-20260725193000-my-share', files: [{ path: 'members/a/shares/x.md', content: 'c' }], title: 'New Share' });
  assert.equal(r.prNumber, 5);
  assert.equal(calls[0].body.itemId, 'share-20260725193000-my-share');
  assert.match(calls[0].url, /\/membership\/author$/);
});
