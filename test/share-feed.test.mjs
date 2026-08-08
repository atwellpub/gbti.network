// SOW-018: the Shares reading feed data path. shareSummary purity, the listShares operation (requires
// identity; async over both readers), the npm fs-walk reader, and the extension Git-Trees reader (one
// recursive tree call, newest-first by the timestamp-slug filename, drafts filtered, members body never read).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { shareSummary, byShareNewest, commentSummary, byCommentOldest } from '../client/src/content-ops.mjs';
import { listShares, listShareComments, listComments, OperationError } from '../client/src/operations.mjs';
import { createReader } from '../client/src/repo-fs.mjs';
import { createGithubReader } from '../client/src/github-reader.mjs';

// SOW-078: the list ops now tier-filter member-visibility stubs, so the ctx carries the caller's membership
// (defaults to 'paid' = sees everything, matching the prior behavior the existing tests assert).
const ctxWith = (reader, identity = { username: 'alice', login: 'alice', githubId: '1' }, membership = 'paid') => ({
  fetch: async () => ({ ok: false, status: 503 }), // SOW-089: force the reader-fallback path (no network in tests)
  identity: () => identity,
  reader,
  membership: () => membership,
});

test('shareSummary: public includes the body, members excludes it, createdAt normalized', () => {
  const pub = shareSummary('members/a/shares/x.md', { id: 'x', author: 'a', visibility: 'public', createdAt: new Date('2026-06-10T00:00:00Z'), tags: ['t'] }, 'hello');
  assert.equal(pub.body, 'hello');
  assert.equal(pub.visibility, 'public');
  assert.equal(pub.createdAt, '2026-06-10T00:00:00.000Z');
  assert.deepEqual(pub.tags, ['t']);

  const mem = shareSummary('members/a/shares/y.md', { id: 'y', author: 'a', visibility: 'members', encryptedBody: 'members/a/_enc/share-y-body.enc' }, 'SECRET PLAINTEXT');
  assert.equal(mem.body, '', 'a members Share body is never surfaced in the summary');
  assert.equal(mem.encryptedBody, 'members/a/_enc/share-y-body.enc');
});

test('byShareNewest: sorts newest-first, undated last', () => {
  const rows = [{ createdAt: '2026-01-01T00:00:00Z' }, { createdAt: null }, { createdAt: '2026-06-01T00:00:00Z' }];
  rows.sort(byShareNewest);
  assert.deepEqual(rows.map((r) => r.createdAt), ['2026-06-01T00:00:00Z', '2026-01-01T00:00:00Z', null]);
});

test('listShares: requires identity', async () => {
  await assert.rejects(() => listShares({ identity: () => null, reader: { listShares: () => [] } }), (e) => e instanceof OperationError && e.code === 'no-identity');
});

test('listShares: delegates to the reader, awaits async, caps the limit', async () => {
  const items = Array.from({ length: 5 }, (_, i) => ({ id: `s${i}` }));
  // async reader (extension-style) returns a promise; the op must await it
  const asyncReader = { listShares: async (n) => items.slice(0, n) };
  const r = await listShares(ctxWith(asyncReader), { limit: 3 });
  assert.equal(r.items.length, 3);
  // sync reader (npm-style) returns an array directly; awaiting a non-promise is fine
  const syncReader = { listShares: (n) => items.slice(0, n) };
  assert.equal((await listShares(ctxWith(syncReader))).items.length, 5);
  // a reader without listShares -> empty, no throw
  assert.deepEqual((await listShares(ctxWith({}))).items, []);
});

// SOW-078: the host op enforces the public-vs-member visibility split, so the raw op cannot be hit directly to
// harvest member-share stubs when a tier below paid/trial relaxes its client fetch-gate (SOW-077 Phase 2).
test('SOW-078: listShares returns member shares ONLY to paid/trialing; lower tiers get public shares only', async () => {
  const items = [
    { id: 'p1', visibility: 'public' },
    { id: 'm1', visibility: 'members' },
    { id: 'p2', visibility: 'public' },
  ];
  const reader = { listShares: async () => items };
  assert.equal((await listShares(ctxWith(reader, undefined, 'paid'))).items.length, 3, 'paid sees all');
  assert.equal((await listShares(ctxWith(reader, undefined, 'trialing'))).items.length, 3, 'trial sees all');
  for (const m of ['none', 'expired', 'cancelled', 'banned', 'unknown']) {
    const r = await listShares(ctxWith(reader, undefined, m));
    assert.deepEqual(r.items.map((s) => s.id), ['p1', 'p2'], `${m} gets public shares only, no member stubs`);
  }
  // a share with NO explicit visibility is treated as members (fail closed) for a lower tier
  const r = await listShares(ctxWith({ listShares: async () => [{ id: 'x' }] }, undefined, 'none'));
  assert.deepEqual(r.items, [], 'an unmarked share is withheld from a lower tier (fail closed)');
});

test('SOW-078: listShareComments + listComments hide member-visibility comment stubs below the seeing tier', async () => {
  const items = [{ id: 'cpub', visibility: 'public' }, { id: 'cmem', visibility: 'members' }];
  const reader = { listShareComments: async () => items, listComments: async () => items };
  assert.equal((await listShareComments(ctxWith(reader, undefined, 'paid'), { targetSlug: 'a/x' })).items.length, 2);
  assert.equal((await listShareComments(ctxWith(reader, undefined, 'trialing'), { targetSlug: 'a/x' })).items.length, 2);
  const freeShare = await listShareComments(ctxWith(reader, undefined, 'none'), { targetSlug: 'a/x' });
  assert.deepEqual(freeShare.items.map((c) => c.id), ['cpub'], 'a free caller gets only the public comment stub');
  const bannedGeneric = await listComments(ctxWith(reader, undefined, 'banned'), { targetType: 'post', targetSlug: 'hello' });
  assert.deepEqual(bannedGeneric.items.map((c) => c.id), ['cpub'], 'a banned caller gets only the public comment stub');
});

test('repo-fs listShares: walks members/*/shares, published-only, newest-first, public body only', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-shares-'));
  const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
  write('members/alice/shares/20260101000000-old.md', '---\ntype: share\nid: 20260101000000-old\nauthor: alice\nstatus: published\nvisibility: public\ncreatedAt: 2026-01-01T00:00:00Z\n---\n\nold public note\n');
  write('members/bob/shares/20260610000000-new.md', '---\ntype: share\nid: 20260610000000-new\nauthor: bob\nstatus: published\nvisibility: members\nencryptedBody: members/bob/_enc/share-20260610000000-new-body.enc\ncreatedAt: 2026-06-10T00:00:00Z\n---\n\n');
  write('members/alice/shares/20260605000000-draft.md', '---\ntype: share\nid: 20260605000000-draft\nauthor: alice\nstatus: draft\nvisibility: public\ncreatedAt: 2026-06-05T00:00:00Z\n---\n\ndraft, must not appear\n');

  const reader = createReader(repo);
  const items = reader.listShares();
  assert.equal(items.length, 2, 'the draft is excluded');
  assert.deepEqual(items.map((i) => i.id), ['20260610000000-new', '20260101000000-old'], 'newest-first');
  const mem = items.find((i) => i.visibility === 'members');
  assert.equal(mem.body, '', 'members Share carries no plaintext body');
  assert.equal(mem.encryptedBody, 'members/bob/_enc/share-20260610000000-new-body.enc');
  const pub = items.find((i) => i.visibility === 'public');
  assert.match(pub.body, /old public note/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('SOW-093: a share with NO status field is surfaced (treated as published); an explicit draft is still hidden', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-shares-nostatus-'));
  const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
  // the real composer bug: buildShareFile did not write status, so the merged file has NO status field.
  write('members/alice/shares/20260701000000-nostatus.md', '---\ntype: share\nid: 20260701000000-nostatus\nauthor: alice\nvisibility: public\ncreatedAt: 2026-07-01T00:00:00Z\n---\n\nno status field, must appear\n');
  // an EXPLICIT draft must still be withheld.
  write('members/alice/shares/20260601000000-draft.md', '---\ntype: share\nid: 20260601000000-draft\nauthor: alice\nstatus: draft\nvisibility: public\ncreatedAt: 2026-06-01T00:00:00Z\n---\n\ndraft, must not appear\n');
  const items = createReader(repo).listShares();
  assert.deepEqual(items.map((i) => i.id), ['20260701000000-nostatus'], 'the status-less share appears; the explicit draft does not');
  fs.rmSync(repo, { recursive: true, force: true });
});

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const SHARE = (id, vis, created, body = '') =>
  `---\ntype: share\nid: ${id}\nauthor: a\nstatus: ${id.includes('draft') ? 'draft' : 'published'}\nvisibility: ${vis}\ncreatedAt: ${created}\n---\n\n${body}\n`;

test('github-reader listShares: one recursive tree call, newest-first by filename, drafts filtered', async () => {
  const tree = {
    tree: [
      { type: 'blob', path: 'members/a/posts/x/index.md' }, // not a share -> ignored
      { type: 'blob', path: 'members/a/shares/20260101000000-old.md' },
      { type: 'blob', path: 'members/b/shares/20260610000000-new.md' },
      { type: 'blob', path: 'members/a/shares/20260605000000-draft.md' },
      { type: 'tree', path: 'members/a/shares' }, // a tree node, not a blob -> ignored
    ],
  };
  const routes = [
    ['/git/trees/', { ok: true, json: async () => tree }],
    ['contents/members/a/shares/20260101000000-old.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260101000000-old', 'public', '2026-01-01T00:00:00Z', 'old note')) }) }],
    ['contents/members/b/shares/20260610000000-new.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260610000000-new', 'public', '2026-06-10T00:00:00Z', 'new note')) }) }],
    ['contents/members/a/shares/20260605000000-draft.md', { ok: true, json: async () => ({ type: 'file', content: b64(SHARE('20260605000000-draft', 'public', '2026-06-05T00:00:00Z', 'draft note')) }) }],
  ];
  let treeCalls = 0;
  const fetch = async (url) => {
    if (url.includes('/git/trees/')) treeCalls++;
    for (const [m, res] of routes) if (url.includes(m)) return res;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch });
  const items = await reader.listShares();
  assert.equal(treeCalls, 1, 'exactly one recursive tree call');
  assert.deepEqual(items.map((i) => i.id), ['20260610000000-new', '20260101000000-old'], 'newest-first, draft excluded');
});

// ---- SOW-032: Shares discussion (threaded comments) ----

test('commentSummary: public carries the body, members excludes it; byCommentOldest sorts oldest-first', () => {
  const pub = commentSummary('members/b/comments/20260611000000-c.md', { id: '20260611000000-c', author: 'b', targetType: 'share', targetSlug: 'alice/20260610000000-new', visibility: 'public', createdAt: new Date('2026-06-11T00:00:00Z') }, 'nice');
  assert.equal(pub.body, 'nice');
  assert.equal(pub.targetType, 'share');
  assert.equal(pub.targetSlug, 'alice/20260610000000-new');
  assert.equal(pub.createdAt, '2026-06-11T00:00:00.000Z');

  const mem = commentSummary('members/b/comments/m.md', { id: 'm', author: 'b', targetType: 'share', targetSlug: 'alice/20260610000000-new', visibility: 'members', encryptedBody: 'members/b/_enc/comment-m.enc' }, 'SECRET');
  assert.equal(mem.body, '', 'a members comment body is never surfaced in the summary');
  assert.equal(mem.encryptedBody, 'members/b/_enc/comment-m.enc');

  const rows = [{ createdAt: '2026-06-11T00:00:00Z' }, { createdAt: '2026-06-09T00:00:00Z' }, { createdAt: null }];
  rows.sort(byCommentOldest);
  assert.deepEqual(rows.map((r) => r.createdAt), [null, '2026-06-09T00:00:00Z', '2026-06-11T00:00:00Z'], 'oldest-first, undated first (empty string sorts low)');
});

test('listShareComments: requires identity and a targetSlug', async () => {
  await assert.rejects(() => listShareComments({ identity: () => null, reader: {} }), (e) => e instanceof OperationError && e.code === 'no-identity');
  await assert.rejects(() => listShareComments(ctxWith({ listShareComments: async () => [] }), {}), (e) => e instanceof OperationError && e.code === 'bad-request');
});

test('listShareComments: unified onto listComments (SOW-089) — reader fallback, async, capped', async () => {
  const made = Array.from({ length: 5 }, (_, i) => ({ id: `c${i}` }));
  // the fallback path uses the GENERIC reader method (both real readers alias listShareComments to it)
  const asyncReader = { listComments: async (_type, _slug, n) => made.slice(0, n) };
  const r = await listShareComments(ctxWith(asyncReader), { targetSlug: 'a/20260101000000-x', limit: 3 });
  assert.equal(r.items.length, 3);
  // a reader without the method -> empty, no throw
  assert.deepEqual((await listShareComments(ctxWith({}), { targetSlug: 'a/20260101000000-x' })).items, []);
});

test('repo-fs listShareComments: walks members/* + house comments, published share-target match only, oldest-first', () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-comments-'));
  const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
  const SLUG = 'alice/20260610000000-new';
  const C = (id, { author = 'bob', target = SLUG, type = 'share', status = 'published', vis = 'public', created, enc } = {}, body = 'hi') =>
    `---\ntype: comment\nid: ${id}\nauthor: ${author}\ntargetType: ${type}\ntargetSlug: ${target}\nstatus: ${status}\nvisibility: ${vis}\ncreatedAt: ${created}\n${enc ? `encryptedBody: ${enc}\n` : ''}---\n\n${body}\n`;
  write('members/bob/comments/20260611000000-a.md', C('20260611000000-a', { created: '2026-06-11T00:00:00Z' }, 'second'));
  write('house/comments/20260610120000-b.md', C('20260610120000-b', { author: 'gbti', created: '2026-06-10T12:00:00Z' }, 'first'));
  write('members/carol/comments/20260612000000-mem.md', C('20260612000000-mem', { author: 'carol', vis: 'members', created: '2026-06-12T00:00:00Z', enc: 'members/carol/_enc/comment-20260612000000-mem.enc' }, 'SECRET'));
  write('members/bob/comments/20260613000000-draft.md', C('20260613000000-draft', { status: 'draft', created: '2026-06-13T00:00:00Z' }, 'draft hidden'));
  write('members/bob/comments/20260614000000-other.md', C('20260614000000-other', { target: 'alice/20260101000000-old', created: '2026-06-14T00:00:00Z' }, 'other share'));
  write('members/bob/comments/20260615000000-post.md', C('20260615000000-post', { type: 'post', target: 'some-post', created: '2026-06-15T00:00:00Z' }, 'a post comment'));

  const reader = createReader(repo);
  const items = reader.listShareComments(SLUG);
  assert.deepEqual(items.map((i) => i.id), ['20260610120000-b', '20260611000000-a', '20260612000000-mem'], 'only this share, published, oldest-first');
  const mem = items.find((i) => i.visibility === 'members');
  assert.equal(mem.body, '', 'members comment carries no plaintext');
  assert.equal(mem.encryptedBody, 'members/carol/_enc/comment-20260612000000-mem.enc');
  fs.rmSync(repo, { recursive: true, force: true });
});

const COMMENT = (id, author, slug, vis, created, body = 'hi', status = 'published') =>
  `---\ntype: comment\nid: ${id}\nauthor: ${author}\ntargetType: share\ntargetSlug: ${slug}\nstatus: ${status}\nvisibility: ${vis}\ncreatedAt: ${created}\n---\n\n${body}\n`;

test('github-reader listShareComments: one tree call, filters to the share target, oldest-first', async () => {
  const SLUG = 'alice/20260610000000-new';
  const tree = {
    tree: [
      { type: 'blob', path: 'members/a/posts/x/index.md' }, // not a comment -> ignored
      { type: 'blob', path: 'members/bob/comments/20260611000000-a.md' },
      { type: 'blob', path: 'house/comments/20260610120000-b.md' },
      { type: 'blob', path: 'members/bob/comments/20260612000000-other.md' }, // different share -> filtered
      { type: 'blob', path: 'members/bob/comments/20260613000000-draft.md' }, // draft -> filtered
      { type: 'tree', path: 'members/bob/comments' }, // a tree node -> ignored
    ],
  };
  const routes = [
    ['/git/trees/', { ok: true, json: async () => tree }],
    ['contents/members/bob/comments/20260611000000-a.md', { ok: true, json: async () => ({ type: 'file', content: b64(COMMENT('20260611000000-a', 'bob', SLUG, 'public', '2026-06-11T00:00:00Z', 'second')) }) }],
    ['contents/house/comments/20260610120000-b.md', { ok: true, json: async () => ({ type: 'file', content: b64(COMMENT('20260610120000-b', 'gbti', SLUG, 'public', '2026-06-10T12:00:00Z', 'first')) }) }],
    ['contents/members/bob/comments/20260612000000-other.md', { ok: true, json: async () => ({ type: 'file', content: b64(COMMENT('20260612000000-other', 'bob', 'alice/20260101000000-old', 'public', '2026-06-12T00:00:00Z', 'other')) }) }],
    ['contents/members/bob/comments/20260613000000-draft.md', { ok: true, json: async () => ({ type: 'file', content: b64(COMMENT('20260613000000-draft', 'bob', SLUG, 'public', '2026-06-13T00:00:00Z', 'draft', 'draft')) }) }],
  ];
  let treeCalls = 0;
  const fetch = async (url) => {
    if (url.includes('/git/trees/')) treeCalls++;
    for (const [m, res] of routes) if (url.includes(m)) return res;
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch });
  const items = await reader.listShareComments(SLUG);
  assert.equal(treeCalls, 1, 'exactly one recursive tree call');
  assert.deepEqual(items.map((i) => i.id), ['20260610120000-b', '20260611000000-a'], 'only this share, published, oldest-first');
});

test('listShareComments cap parity: both readers keep the NEWEST `limit`, shown oldest-first', async () => {
  // Three published share comments; ask for only 2. Both hosts must return the SAME set (the newest two),
  // oldest-first — so a member sees the same conversation tail regardless of which client they use.
  const SLUG = 'alice/20260610000000-new';
  const ids = ['20260101000000-a', '20260201000000-b', '20260301000000-c'];
  const created = { '20260101000000-a': '2026-01-01T00:00:00Z', '20260201000000-b': '2026-02-01T00:00:00Z', '20260301000000-c': '2026-03-01T00:00:00Z' };

  // npm host (local working copy)
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-cap-'));
  const write = (rel, txt) => { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), txt); };
  for (const id of ids) write(`members/bob/comments/${id}.md`, COMMENT(id, 'bob', SLUG, 'public', created[id], `body ${id}`));
  const npm = createReader(repo).listShareComments(SLUG, 2);
  assert.deepEqual(npm.map((i) => i.id), ['20260201000000-b', '20260301000000-c'], 'npm host keeps the newest two, oldest-first');

  // extension host (Git Trees)
  const tree = { tree: ids.map((id) => ({ type: 'blob', path: `members/bob/comments/${id}.md` })) };
  const routes = [['/git/trees/', { ok: true, json: async () => tree }]];
  for (const id of ids) routes.push([`contents/members/bob/comments/${id}.md`, { ok: true, json: async () => ({ type: 'file', content: b64(COMMENT(id, 'bob', SLUG, 'public', created[id], `body ${id}`)) }) }]);
  const fetch = async (url) => { for (const [m, res] of routes) if (url.includes(m)) return res; return { ok: false, status: 404, json: async () => ({}) }; };
  const ext = await createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch }).listShareComments(SLUG, 2);
  assert.deepEqual(ext.map((i) => i.id), npm.map((i) => i.id), 'extension host returns the SAME set as the npm host');
  fs.rmSync(repo, { recursive: true, force: true });
});
