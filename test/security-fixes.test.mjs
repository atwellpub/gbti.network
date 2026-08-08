// Regression tests for the 9 confirmed security-audit findings (SEC1). Each asserts the fixed behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { grandfatherActive } from '../membership/overrides.mjs';
import { planReconcile } from '../scripts/lib/reconcile-plan.mjs';
import { buildContentFile, ContentValidationError } from '../client/src/content-ops.mjs';
import { deplatformContent, removeContent } from '../client/src/admin-ops.mjs';
import { startServer, send } from '../client/src/server.mjs';

// #5 trust-core: unparseable grandfather `until` must FAIL CLOSED (expire), not grant permanent access.
test('grandfatherActive: unparseable until expires the grant (fail closed)', () => {
  assert.equal(grandfatherActive('1', new Map([['1', { github_id: '1', until: 'not-a-date' }]]), new Date()), false);
  assert.equal(grandfatherActive('1', new Map([['1', { github_id: '1', until: null }]]), new Date()), true); // permanent still works
  assert.equal(grandfatherActive('1', new Map([['1', { github_id: '1', until: '2099-01-01' }]]), new Date()), true); // future still works
});

// #3/#4 reconcile: a BANNED member with no resolvable folder yields an `unresolved` action (fail closed).
// sow-197 narrowed this to bans only. A lapse no longer touches content, so an unresolvable lapsed member is
// not a deplatforming failure to report; a ban still is, and that is the case that must stay loud.
test('planReconcile: a banned member with null username emits an unresolved action', () => {
  const banned = planReconcile({ members: [{ githubId: '9', username: null, effective: { status: 'banned' } }], repoIndex: {} });
  const u = banned.find((a) => a.kind === 'unresolved');
  assert.ok(u && u.status === 'banned', 'banned + no folder => unresolved');
  assert.equal(banned.filter((a) => a.kind === 'content').length, 0, 'no content action without a folder');

  // a lapsed member with no folder is NOT flagged: there is nothing to enforce against their content
  const lapsed = planReconcile({ members: [{ githubId: '8', username: null, effective: { status: 'cancelled' } }], repoIndex: {} });
  assert.equal(lapsed.filter((a) => a.kind === 'unresolved').length, 0);

  // a paid member with no folder is NOT flagged (nothing to deplatform)
  const paid = planReconcile({ members: [{ githubId: '7', username: null, effective: { status: 'paid' } }], repoIndex: {} });
  assert.equal(paid.filter((a) => a.kind === 'unresolved').length, 0);
});

// #9 content-ops: an oversized body is rejected.
test('buildContentFile: body over the size cap is rejected', () => {
  assert.throws(
    () => buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 's' }, body: 'x'.repeat(1_000_001) }),
    (e) => e instanceof ContentValidationError && /body exceeds/.test(e.message),
  );
});

// #1/#8 admin-ops: moderation rejects ./ traversal and out-of-scope (house/) paths.
test('deplatform/remove: ./ prefix and non-member paths are rejected', async () => {
  const repoPath = '/nope';
  const ctx = { role: () => 'moderator', getRepoClient: () => ({}), store: { get: (k) => ({ repoPath })[k] } };
  const adminCtx = { role: () => 'admin', getRepoClient: () => ({}), store: { get: (k) => ({ repoPath })[k] } }; // SOW-071: remove is admin+
  await assert.rejects(deplatformContent(ctx, { path: './members/bob/posts/x.md' }), (e) => e.code === 'bad-request');
  await assert.rejects(removeContent(adminCtx, { path: 'members/bob/../alice/posts/x.md' }), (e) => e.code === 'bad-request');
  await assert.rejects(removeContent(adminCtx, { path: 'house/bans.yml' }), (e) => e.code === 'forbidden');
  await assert.rejects(deplatformContent(ctx, { path: 'CODEOWNERS' }), (e) => e.code === 'forbidden');
});

// #7 server: the per-install token is stripped from the URL before the handler sees it.
test('hardened server: query token is stripped before reaching the handler', async () => {
  const srv = await startServer({
    token: 'tk-strip', preferredPort: 4910,
    handler: (req, res, url) => send(res, 200, { hasToken: url.searchParams.has('token') }),
  });
  try {
    const body = await new Promise((resolve, reject) => {
      // authorize via the query token (no header), as the initial UI navigation does
      const r = http.request({ host: '127.0.0.1', port: srv.port, path: '/x?token=tk-strip' }, (res) => {
        let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve(JSON.parse(b)));
      });
      r.on('error', reject); r.end();
    });
    assert.equal(body.hasToken, false, 'handler must not see the token in the URL');
  } finally {
    await srv.close();
  }
});
