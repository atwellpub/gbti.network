// SOW-006 MCP tool surface: the JSON-RPC dispatcher + managed-abstraction tools (same operations core the
// CMS HTTP API uses).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { dispatch, TOOLS } from '../client/src/mcp-tools.mjs';
import { createReader } from '../client/src/repo-fs.mjs';

function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-mcp-'));
  fs.mkdirSync(path.join(dir, 'members', 'alice', 'posts', 'hello'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'members', 'alice', 'posts', 'hello', 'index.md'), '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\n---\n\nx\n');
  return dir;
}

function ctxFor({ repoPath, repo, identity } = {}) {
  return {
    store: { get: (k) => ({ repoPath, githubToken: repo ? 'tok' : null, mcpEnabled: true })[k] },
    reader: createReader(repoPath ?? '/nope'),
    getRepoClient: () => repo ?? null,
    identity: () => (identity === null ? null : { login: 'alice', githubId: '1', username: 'alice' }),
  };
}

const fakeRepo = () => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile() {},
  async findOpenPull() { return null; },
  async openPull() { return { number: 11, html_url: 'u' }; },
  async listMyPulls() { return [{ number: 11, title: 'x', html_url: 'u' }]; },
  async gateStatus() { return { state: 'failure', meaning: 'held', sha: 'sha' }; },
});

const call = (name, args, ctx) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
const textOf = (res) => JSON.parse(res.result.content[0].text);

test('initialize: advertises protocol + server info', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize' }, ctxFor());
  assert.equal(res.result.serverInfo.name, 'gbti-network');
  assert.ok(res.result.protocolVersion);
  assert.ok(res.result.capabilities.tools);
});

test('tools/list: returns every managed-abstraction tool with an input schema', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctxFor());
  const names = res.result.tools.map((t) => t.name);
  for (const expected of ['login', 'login_confirm', 'logout', 'whoami', 'list_my_content', 'get_content', 'validate_content', 'publish_content', 'add_prompt', 'add_product', 'add_post', 'list_prs', 'pr_status', 'post_comment', 'edit_comment', 'list_comments']) {
    assert.ok(names.includes(expected), `missing tool ${expected}`);
  }
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.ok(res.result.tools.every((t) => t.inputSchema && t.inputSchema.type === 'object'));
});

test('tools/call whoami + list_my_content', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo() });
  const who = textOf(await call('whoami', {}, ctx));
  assert.equal(who.identity.login, 'alice');
  const list = textOf(await call('list_my_content', { type: 'post' }, ctx));
  assert.equal(list.items.length, 1);
  assert.equal(list.items[0].title, 'Hello');
});

test('tools/call validate_content: valid and invalid both return cleanly', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo() });
  const good = textOf(await call('validate_content', { type: 'post', input: { title: 'T', slug: 'ok-slug' } }, ctx));
  assert.equal(good.valid, true);
  const bad = textOf(await call('validate_content', { type: 'post', input: { title: 'T', slug: 'Bad Slug' } }, ctx));
  assert.equal(bad.valid, false);
});

test('tools/call publish_content: opens a PR via the repo client', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.notEqual(res.result.isError, true);
  assert.equal(textOf(res).prNumber, 11);
});

test('tools/call publish_content without auth is an isError tool result, not a transport error', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: null });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'my-post' } }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'not-authenticated');
});

// SOW-025: the per-type add_* wrappers forward to publish with the correct type (so the right schema applies).
test('tools/call add_prompt: publishes a prompt (the prompt schema applies) into the prompts folder', async () => {
  const puts = [];
  const repo = { ...fakeRepo(), async putFile(_full, path) { puts.push(path); } };
  const ctx = ctxFor({ repoPath: tmpRepo(), repo });
  const ok = await call('add_prompt', { status: 'published', input: { title: 'P', slug: 'my-prompt', shortDescription: 'a one-liner' }, body: 'do the thing' }, ctx);
  assert.notEqual(ok.result.isError, true);
  assert.equal(textOf(ok).prNumber, 11);
  assert.ok(puts.some((p) => p.includes('/prompts/my-prompt/')), `expected a prompts/ path, got ${JSON.stringify(puts)}`);
  // missing shortDescription -> invalid as a PROMPT (proving the prompt schema, not the post schema, is applied)
  const bad = await call('add_prompt', { status: 'published', input: { title: 'P', slug: 'no-desc' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(bad.result.isError, true);
  assert.equal(textOf(bad).error, 'invalid-content');
});

test('tools/call add_product: requires the product image fields (invalid-content without them)', async () => {
  const res = await call('add_product', { status: 'published', input: { title: 'X', slug: 'a-product', shortDescription: 'sd' } }, ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() }));
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'invalid-content'); // missing icon + featuredImage
});

// SOW-106: the publish tools require an explicit status; omitting it is a forced-intent error, not a silent draft.
test('tools/call add_prompt without status is a status-required isError (forced intent)', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('add_prompt', { input: { title: 'P', slug: 'no-status', shortDescription: 'x' }, body: 'b' }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'status-required');
});

test('tools/call with invalid content surfaces invalid-content as isError', async () => {
  const ctx = ctxFor({ repoPath: tmpRepo(), repo: fakeRepo() });
  const res = await call('publish_content', { type: 'post', status: 'published', input: { title: 'T', slug: 'Bad Slug' } }, ctx);
  assert.equal(res.result.isError, true);
  assert.equal(textOf(res).error, 'invalid-content');
});

test('unknown tool -> JSON-RPC error; unknown method -> -32601; notification -> null', async () => {
  const ctx = ctxFor();
  const unknownTool = await call('frobnicate', {}, ctx);
  assert.equal(unknownTool.error.code, -32602);
  const unknownMethod = await dispatch({ jsonrpc: '2.0', id: 9, method: 'nope/nope' }, ctx);
  assert.equal(unknownMethod.error.code, -32601);
  const notif = await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx);
  assert.equal(notif, null);
});

// ---------------------------------------------------------------------------
// sow-193: the MCP author surface can express what publish() supports, and the
// draft lifecycle is reachable at all.
// ---------------------------------------------------------------------------

test('sow-193: the four draft-lifecycle tools are exposed (an agent could create a draft it could never retrieve)', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, ctxFor());
  const names = res.result.tools.map((t) => t.name);
  for (const expected of ['list_drafts', 'read_draft', 'publish_draft', 'discard_draft']) {
    assert.ok(names.includes(expected), `missing draft tool ${expected}`);
  }
});

test('sow-193: the author tools accept path + scope (rename and house targeting were previously inexpressible)', async () => {
  const res = await dispatch({ jsonrpc: '2.0', id: 4, method: 'tools/list' }, ctxFor());
  const byName = Object.fromEntries(res.result.tools.map((t) => [t.name, t]));
  for (const name of ['publish_content', 'add_post', 'add_product', 'add_prompt']) {
    assert.ok(byName[name].inputSchema.properties.path, `${name} cannot express a rename`);
    assert.ok(byName[name].inputSchema.properties.scope, `${name} cannot express a scope`);
  }
  // scope is an enum, so an agent cannot invent a folder.
  assert.deepEqual(byName.publish_content.inputSchema.properties.scope.enum, ['member', 'house']);
  // list_my_content reads house content for a superadmin; it never forwarded scope before.
  assert.ok(byName.list_my_content.inputSchema.properties.scope);
});

test('sow-193: authorContent FORWARDS path to publish, so a changed slug renames instead of duplicating', async () => {
  // The proof is that publish() sees `path`: with it, the existing item is read and its slug compared, which
  // is what turns a re-publish into a rename. Without it publish() never enters that branch at all.
  // publish() turns `path` into a rename origin (renameOriginOf) and then reads the OLD file to merge its
  // redirectFrom and preserve publishedAt. That read is the first observable effect of `path`: with `path`
  // dropped, `origin` is null and readFile is never called for the old path at all.
  const seen = [];
  const withSpy = (repoPath) => {
    const ctx = ctxFor({ repoPath, repo: fakeRepo() });
    const orig = ctx.reader.readFile.bind(ctx.reader);
    ctx.reader.readFile = (p) => { seen.push(p); return orig(p); };
    return ctx;
  };
  const repoDir = tmpRepo();
  const args = { status: 'published', input: { title: 'Hello renamed', slug: 'hello-renamed' }, body: 'x' };
  await call('add_post', { ...args, path: 'members/alice/posts/hello/index.md' }, withSpy(repoDir)).catch(() => {});
  assert.ok(seen.includes('members/alice/posts/hello/index.md'), 'publish never read the existing item, so path was dropped');

  // Control: the SAME call without `path` must never look for the old file. This is the regression the fix
  // closes, so it is worth asserting both directions rather than only the positive.
  seen.length = 0;
  await call('add_post', args, withSpy(repoDir)).catch(() => {});
  assert.ok(!seen.includes('members/alice/posts/hello/index.md'), 'without path there is no rename origin to read');
});

test('sow-193: listMembersOnly awaits its reader (a Promise as `items` was the async-reader trap)', async () => {
  const { listMembersOnly } = await import('../client/src/operations.mjs');
  // An ASYNC reader, which is what a clone-free npm host and the extension both use.
  const ctx = {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    reader: { listMembersOnly: async () => [{ path: 'members/alice/posts/x/index.md' }] },
  };
  const out = await listMembersOnly(ctx);
  assert.ok(Array.isArray(out.items), 'items must be an array, not a pending Promise');
  assert.equal(out.items.length, 1);
});
