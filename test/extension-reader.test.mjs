// SOW-006 v2 P4: the Chrome extension's GitHub-Contents-API Reader (pure, injectable fetch). Verifies the
// base64 round-trip, own-folder scoping, and the NESTED <slug>/index.md listing, so the extension reads the
// same content the npm host reads from disk.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createGithubReader } from '../client/src/github-reader.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const fileRes = (text) => ({ ok: true, json: async () => ({ type: 'file', content: b64(text) }) });
const dirRes = (names) => ({ ok: true, json: async () => names.map((name) => ({ type: 'dir', name })) });
const notFound = { ok: false, status: 404, json: async () => ({}) };

const POST = '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\nstatus: published\nvisibility: public\n---\n\nBody here\n';

function readerWith(routes) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    for (const [match, res] of routes) if (url.includes(match)) return res;
    return notFound;
  };
  return { reader: createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'tok', fetch }), calls };
}

test('readFile: decodes GitHub base64 to UTF-8 text, sends the token', async () => {
  const { reader, calls } = readerWith([['contents/members/alice/posts/hello/index.md', fileRes('héllo 世界')]]);
  assert.equal(await reader.readFile('members/alice/posts/hello/index.md'), 'héllo 世界');
  assert.equal(calls[0].auth, 'Bearer tok');
});

test('readFile: rejects traversal + missing files (null)', async () => {
  const { reader } = readerWith([]);
  assert.equal(await reader.readFile('members/alice/../bob/x.md'), null);
  assert.equal(await reader.readFile('/etc/passwd'), null);
  assert.equal(await reader.readFile('members/alice/posts/none/index.md'), null); // 404 -> null
});

test('get: own-folder scoped, parses frontmatter + body', async () => {
  const { reader } = readerWith([['contents/members/alice/posts/hello/index.md', fileRes(POST)]]);
  const item = await reader.get('alice', 'members/alice/posts/hello/index.md');
  assert.equal(item.frontmatter.title, 'Hello');
  assert.equal(item.body.trim(), 'Body here');
  // cannot read another member's folder
  assert.equal(await reader.get('alice', 'members/bob/posts/x/index.md'), null);
});

test('list: walks the NESTED slug dirs and reads each index.md', async () => {
  const { reader } = readerWith([
    ['contents/members/alice/posts?', dirRes(['hello', 'second'])],
    ['contents/members/alice/posts/hello/index.md', fileRes(POST)],
    ['contents/members/alice/posts/second/index.md', fileRes(POST.replace('hello', 'second').replace('Hello', 'Second'))],
  ]);
  const items = await reader.list('alice', 'post');
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.path).sort(), [
    'members/alice/posts/hello/index.md',
    'members/alice/posts/second/index.md',
  ]);
  assert.ok(items.every((i) => i.type === 'post'));
});

test('listMembersOnly: deferred to the npm host portal (returns [])', async () => {
  const { reader } = readerWith([]);
  assert.deepEqual(await reader.listMembersOnly(), []);
});

// Expired-token detection: a 401 carrying our token means the GitHub App user token died; the reader fires
// onAuthError ONCE so the host clears the dead session and forces re-auth (instead of every read failing to null,
// which reads as "you have no content"). A 401 WITHOUT a token, or a 404, is not an expired session.
const unauthorized = { ok: false, status: 401, json: async () => ({ message: 'Bad credentials' }) };

test('onAuthError fires on a 401 carrying a token (expired session), read still fails soft to null', async () => {
  let fired = 0;
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'dead', fetch: async () => unauthorized, onAuthError: () => { fired++; } });
  assert.equal(await reader.readFile('members/alice/profile.md'), null);
  assert.equal(fired, 1, 'a 401 with a token signals the expiry exactly once');
});

test('onAuthError fires at most once across many 401 reads from one reader', async () => {
  let fired = 0;
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'dead', fetch: async () => unauthorized, onAuthError: () => { fired++; } });
  await reader.list('alice', 'post');     // a dir read (401)
  await reader.readFile('house/roles.yml'); // another 401
  await reader.listShares(5);             // tree() 401 too
  assert.equal(fired, 1, 'one signal per reader, not one per request');
});

test('onAuthError does NOT fire on a 401 with no token (auth-required resource, not an expiry)', async () => {
  let fired = 0;
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', fetch: async () => unauthorized, onAuthError: () => { fired++; } });
  await reader.readFile('members/alice/profile.md');
  assert.equal(fired, 0);
});

test('onAuthError does NOT fire on a 404 (missing file with a valid token)', async () => {
  let fired = 0;
  const reader = createGithubReader({ upstream: 'gbti-network/gbti.network', token: 'good', fetch: async () => notFound, onAuthError: () => { fired++; } });
  await reader.readFile('members/alice/posts/none/index.md');
  assert.equal(fired, 0);
});
