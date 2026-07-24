// SOW-031 deferreds: the cross-member read route (npm /api/read parity with the extension), the npm reader's
// allowlist-gated read(), the shared readContent op, and the pure browse deep-link + asset helpers. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createReader } from '../client/src/repo-fs.mjs';
import { readContent, OperationError } from '../client/src/operations.mjs';
import { handleApi } from '../client/src/api.mjs';
import { buildReadHash, parseBrowseHash, stripDoParam, buildMemberHash, parseMemberHash } from '../client-ui/src/browse-hash.mjs';
import { resolveAsset } from '../client-ui/src/assets.mjs';

const POST = '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\nstatus: published\nvisibility: public\n---\n\nBody here\n';

function tmpRepoWith(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-read-'));
  for (const [rel, txt] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
    fs.writeFileSync(path.join(repo, rel), txt);
  }
  return repo;
}

// ---- repo-fs read(): cross-member, allowlist-gated ----

test('repo-fs read: reads a published index.md anywhere in the three subtrees (cross-member)', () => {
  const repo = tmpRepoWith({
    'members/alice/posts/hello/index.md': POST,
    'house/products/thing/index.md': POST.replace('post', 'product').replace('alice', 'gbti'),
  });
  const reader = createReader(repo);
  const a = reader.read('members/alice/posts/hello/index.md');
  assert.equal(a.frontmatter.title, 'Hello');
  assert.equal(a.body.trim(), 'Body here');
  assert.equal(reader.read('house/products/thing/index.md').frontmatter.type, 'product');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('repo-fs read: rejects traversal / control files / non-index paths (null), same allowlist as the extension', () => {
  const repo = tmpRepoWith({ 'house/roles.yml': 'x: 1\n', 'members/alice/posts/hello/index.md': POST });
  const reader = createReader(repo);
  for (const bad of [
    '../roles.yml', 'house/roles.yml', 'house/pages/about/index.md',
    'members/alice/posts/hello/secret.md', 'members/alice/../bob/posts/x/index.md',
    '/members/alice/posts/hello/index.md', 'members/alice/shares/s.md', '', null, 42,
  ]) {
    assert.equal(reader.read(bad), null, `should reject ${JSON.stringify(bad)}`);
  }
  // a well-formed but missing path is also null
  assert.equal(reader.read('members/alice/posts/none/index.md'), null);
  fs.rmSync(repo, { recursive: true, force: true });
});

// ---- readContent op: shared by both hosts ----

const ctxWith = (reader, identity = { username: 'alice', login: 'alice', githubId: '1' }) => ({ identity: () => identity, reader });

test('readContent: requires identity + a path; maps misses to not-found', async () => {
  await assert.rejects(() => readContent({ identity: () => null, reader: {} }, { path: 'house/posts/x/index.md' }), (e) => e instanceof OperationError && e.code === 'no-identity');
  await assert.rejects(() => readContent(ctxWith({ read: () => null }), {}), (e) => e instanceof OperationError && e.code === 'bad-request');
  await assert.rejects(() => readContent(ctxWith({ read: () => null }), { path: 'house/posts/x/index.md' }), (e) => e instanceof OperationError && e.code === 'not-found');
  await assert.rejects(() => readContent(ctxWith({}), { path: 'house/posts/x/index.md' }), (e) => e instanceof OperationError && e.code === 'not-found'); // reader without read()
});

test('readContent: awaits a sync (npm) AND an async (extension) reader identically', async () => {
  const item = { path: 'house/posts/x/index.md', frontmatter: { title: 'X' }, body: 'b' };
  assert.deepEqual(await readContent(ctxWith({ read: () => item }), { path: item.path }), item); // sync
  assert.deepEqual(await readContent(ctxWith({ read: async () => item }), { path: item.path }), item); // async
});

// ---- api.mjs /api/read route (npm host) ----

test('npm /api/read: returns the item on success, 404 on a disallowed/missing path, 409 without identity', async () => {
  const repo = tmpRepoWith({ 'members/alice/posts/hello/index.md': POST });
  const ctx = { identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }), reader: createReader(repo) };
  const ok = await handleApi({ method: 'GET', pathname: '/api/read', query: { path: 'members/alice/posts/hello/index.md' } }, ctx);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.frontmatter.title, 'Hello');

  const bad = await handleApi({ method: 'GET', pathname: '/api/read', query: { path: '../roles.yml' } }, ctx);
  assert.equal(bad.status, 404);
  assert.equal(bad.json.error, 'not-found');

  const anon = await handleApi({ method: 'GET', pathname: '/api/read', query: { path: 'members/alice/posts/hello/index.md' } }, { identity: () => null, reader: createReader(repo) });
  assert.equal(anon.status, 409); // no-identity -> 409 (STATUS_FOR)
  fs.rmSync(repo, { recursive: true, force: true });
});

// ---- pure browse deep-link hash + asset resolution ----

test('buildReadHash / parseBrowseHash round-trip (SOW-031 feed-row deep link)', () => {
  const p = 'members/alice/posts/hello/index.md';
  const hash = buildReadHash('post', p);
  assert.equal(hash, `tab=post&read=${encodeURIComponent(p)}`);
  assert.deepEqual(parseBrowseHash('#' + hash), { tab: 'post', read: p, action: null });
  // tab-only when no path
  assert.equal(buildReadHash('product', null), 'tab=product');
  assert.deepEqual(parseBrowseHash('tab=product'), { tab: 'product', read: null, action: null });
  // unknown tab -> null tab (caller defaults to post); a bad type in build falls back to post
  assert.deepEqual(parseBrowseHash('tab=bogus&read=x'), { tab: null, read: 'x', action: null });
  assert.equal(buildReadHash('bogus', p).startsWith('tab=post&read='), true);
  // malformed encoding does not throw
  assert.deepEqual(parseBrowseHash('tab=post&read=%E0%A4%A'), { tab: 'post', read: '%E0%A4%A', action: null });
});

test('do= force-action: bounded build/parse + one-shot strip (SOW-114 content-page deep link)', () => {
  const p = 'members/alice/prompts/hello/index.md';
  // Build with a valid action, round-trip through parse.
  const hash = buildReadHash('prompt', p, 'favorite');
  assert.equal(hash, `tab=prompt&read=${encodeURIComponent(p)}&do=favorite`);
  assert.deepEqual(parseBrowseHash('#' + hash), { tab: 'prompt', read: p, action: 'favorite' });
  assert.equal(parseBrowseHash(buildReadHash('post', p, 'collect')).action, 'collect');
  // An unknown action never builds and never parses (bounded set).
  assert.equal(buildReadHash('prompt', p, 'delete'), `tab=prompt&read=${encodeURIComponent(p)}`);
  assert.equal(parseBrowseHash('tab=prompt&read=x&do=delete').action, null);
  // No path -> no action (a tab-only hash cannot force anything).
  assert.equal(buildReadHash('prompt', null, 'favorite'), 'tab=prompt');
  // stripDoParam removes only the do= segment, in any position, and tolerates its absence.
  assert.equal(stripDoParam('#' + hash), `tab=prompt&read=${encodeURIComponent(p)}`);
  assert.equal(stripDoParam('do=favorite&tab=post'), 'tab=post');
  assert.equal(stripDoParam('tab=post&read=x'), 'tab=post&read=x');
  assert.equal(stripDoParam(''), '');
});

// SOW-143: the member-detail deep-link hash (tab=member&member=<username>), a DISTINCT key from read=.
test('buildMemberHash: valid username round-trips, invalid returns empty', () => {
  assert.equal(buildMemberHash('alice'), 'tab=member&member=alice');
  assert.equal(buildMemberHash('atwellpub'), 'tab=member&member=atwellpub');
  assert.equal(buildMemberHash('Alice'), 'tab=member&member=alice'); // lowercased
  assert.equal(buildMemberHash('a-b-c'), 'tab=member&member=a-b-c');
  assert.equal(buildMemberHash(''), '');
  assert.equal(buildMemberHash('-lead'), ''); // leading hyphen
  assert.equal(buildMemberHash('trail-'), ''); // trailing hyphen
  assert.equal(buildMemberHash('a--b'), ''); // double hyphen
  assert.equal(buildMemberHash('a_b'), ''); // underscore not allowed
  assert.equal(buildMemberHash('a'.repeat(40)), ''); // over length (max 39)
});

test('parseMemberHash: requires BOTH tab=member and a valid member=<u>', () => {
  assert.equal(parseMemberHash('tab=member&member=alice'), 'alice');
  assert.equal(parseMemberHash('#tab=member&member=alice'), 'alice'); // leading # optional
  assert.equal(parseMemberHash('member=alice&tab=member'), 'alice'); // order-independent
  assert.equal(parseMemberHash('tab=member&member=Alice'), 'alice'); // lowercased
  assert.equal(parseMemberHash('tab=post&member=alice'), null); // wrong tab -> no hijack
  assert.equal(parseMemberHash('tab=member'), null); // missing member key
  assert.equal(parseMemberHash('tab=member&member='), null); // empty username
  assert.equal(parseMemberHash('tab=member&member=-bad'), null); // invalid username
  assert.equal(parseMemberHash(''), null);
  assert.doesNotThrow(() => parseMemberHash('tab=member&member=%E0%A4%A')); // malformed percent-encoding
  assert.equal(parseMemberHash('tab=member&member=%E0%A4%A'), null);
});

test('parseBrowseHash: a member hash is INERT to the feed/browse consumers (all-null)', () => {
  // The single anti-regression guard: because `member` is kept out of TAB_IDS, the existing deep-read path and
  // <gbti-browse> cannot be triggered by a member hash.
  assert.deepEqual(parseBrowseHash('#tab=member&member=alice'), { tab: null, read: null, action: null });
});

test('resolveAsset: SITE-relative -> absolute, already-absolute passes through, null fallback', () => {
  assert.equal(resolveAsset('/_astro/c.webp'), 'https://gbti.network/_astro/c.webp');
  assert.equal(resolveAsset('_astro/c.webp'), 'https://gbti.network/_astro/c.webp'); // missing leading slash tolerated
  assert.equal(resolveAsset('https://cdn.jsdelivr.net/x.png'), 'https://cdn.jsdelivr.net/x.png');
  assert.equal(resolveAsset('//cdn.example/x.png'), 'https://cdn.example/x.png');
  assert.equal(resolveAsset(null), null);
  assert.equal(resolveAsset(''), null);
  assert.equal(resolveAsset(42), null);
});
