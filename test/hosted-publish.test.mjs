// SOW-156: the hosted publish transport (client/src/hosted-publish.mjs). Stubbed fetch, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hostedAuthor, hostedItemId } from '../client/src/hosted-publish.mjs';

test('hostedItemId mirrors the fork-mode branch identity (type-slug; profile is fixed)', () => {
  assert.equal(hostedItemId('post', 'my-first-post'), 'post-my-first-post');
  assert.equal(hostedItemId('profile', 'anything'), 'profile');
});

test('hostedAuthor POSTs the file set to /membership/author and maps the publish result shape', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return { ok: true, branch: 'hosted/1/post-x', number: 42, html_url: 'https://github.com/gbti-network/gbti.network/pull/42' }; } };
  };
  const r = await hostedAuthor({
    token: 'tok', itemId: 'post-x', title: 'post: x', signupBase: 'https://signup.example/',
    files: [{ path: 'members/a/posts/x.md', content: 'body' }], fetchImpl,
  });
  assert.equal(r.prNumber, 42);
  assert.equal(r.branch, 'hosted/1/post-x');
  assert.equal(r.fork, null);
  assert.equal(r.hosted, true);
  assert.equal(calls[0].url, 'https://signup.example/membership/author');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer tok');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.itemId, 'post-x');
  assert.equal(body.files[0].path, 'members/a/posts/x.md');
});

test('hostedAuthor: an existing PR (already) maps to updated: true', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, async json() { return { ok: true, branch: 'hosted/1/post-x', number: null, html_url: null, already: true }; } });
  const r = await hostedAuthor({ token: 'tok', itemId: 'post-x', files: [{ path: 'p', content: 'c' }], fetchImpl });
  assert.equal(r.updated, true);
});

test('hostedAuthor surfaces the Worker denial message (fail-closed member-safe error)', async () => {
  const fetchImpl = async () => ({ ok: false, status: 409, async json() { return { error: 'folder_not_provisioned', message: 'your member folder is not provisioned yet' }; } });
  await assert.rejects(
    hostedAuthor({ token: 'tok', itemId: 'x', files: [{ path: 'p', content: 'c' }], fetchImpl }),
    /not provisioned/,
  );
  await assert.rejects(hostedAuthor({ token: null, itemId: 'x', files: [], fetchImpl }), /sign in/);
});
