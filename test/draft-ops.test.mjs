// SOW-082: the universal draft-staging operations. A draft is the item committed to its per-item branch
// gbti/<type>-<slug> on the member's FORK with NO open PR. Save commits there (trial+paid); Publish opens the
// canonical PR from that branch (paid-only). Tested against a fake ctx/repo (no network, no Worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveDraft, listDrafts, readDraft, discardDraft, publishDraft, OperationError } from '../client/src/operations.mjs';

function draftCtx({ membership = 'paid', refs = [], files = {}, openPull = null } = {}) {
  const calls = { put: [], deleteBranch: [], openPull: [] };
  return {
    calls,
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    membership: () => membership,
    store: { get: () => 'tok' },
    fetch: async () => { throw new Error('no network in this unit test'); },
    getRepoClient: () => ({
      upstream: 'gbti-network/gbti.network',
      ensureFork: async () => ({ full_name: 'alice/gbti.network', owner: 'alice' }),
      getDefaultBranch: async () => 'main',
      getBranchSha: async () => 'sha',
      ensureBranch: async () => {},
      getFileSha: async () => null,
      putFile: async (_r, _p, opts) => { calls.put.push({ path: _p, branch: opts.branch }); },
      deleteFile: async () => {},
      findOpenPull: async () => openPull,
      openPull: async (o) => { calls.openPull.push(o); return { number: 99, html_url: 'pr-url' }; },
      // listDrafts reads by the ref's TIP SHA (never the branch name — a by-name read can serve a stale state);
      // the fake mints a per-branch sha and resolves reads by either.
      listMatchingRefs: async () => refs.map((branch) => ({ branch, sha: `sha:${branch}` })),
      getForkFileContent: async (_r, _path, ref) => files[String(ref).replace(/^sha:/, '')] ?? files[ref] ?? null,
      deleteBranch: async (_r, b) => { calls.deleteBranch.push(b); },
    }),
  };
}

test('saveDraft: a TRIAL member stages to the fork branch and NEVER opens a PR', async () => {
  const ctx = draftCtx({ membership: 'trialing' });
  const out = await saveDraft(ctx, { type: 'post', input: { title: 'Hello', slug: 'my-post' }, body: 'Body' });
  assert.equal(out.state, 'staged');
  assert.equal(out.branch, 'gbti/post-my-post');
  assert.equal(ctx.calls.put[0].branch, 'gbti/post-my-post');
  assert.equal(ctx.calls.openPull.length, 0, 'Save must never open a PR');
});

test('saveDraft: free/lapsed/banned are forbidden to stage; unknown fails OPEN', async () => {
  for (const m of ['none', 'expired', 'cancelled', 'banned']) {
    await assert.rejects(
      () => saveDraft(draftCtx({ membership: m }), { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' }),
      (e) => { assert.ok(e instanceof OperationError); assert.equal(e.code, 'forbidden'); return true; },
    );
  }
  const out = await saveDraft(draftCtx({ membership: 'unknown' }), { type: 'post', input: { title: 'T', slug: 'my-post' }, body: 'x' });
  assert.equal(out.state, 'staged'); // unknown -> fail open
});

test('listDrafts: enumerates gbti/* branches, reads each, skips non-content (share/comment) branches', async () => {
  const post = '---\ntitle: My Post\nstatus: draft\nvisibility: public\n---\nBody';
  const profile = '---\ndisplayName: Alice\n---\nabout';
  const ctx = draftCtx({
    refs: ['gbti/post-my-post', 'gbti/share-12345', 'gbti/profile'],
    files: { 'gbti/post-my-post': post, 'gbti/profile': profile },
  });
  const { drafts } = await listDrafts(ctx, {});
  assert.deepEqual(drafts.map((d) => d.type).sort(), ['post', 'profile']); // gbti/share-* is skipped
  const p = drafts.find((d) => d.type === 'post');
  assert.equal(p.slug, 'my-post');
  assert.equal(p.title, 'My Post');
  assert.equal(p.pull, null); // no open PR -> the UI renders this as Staged
});

test('listDrafts: a type filter narrows to that content type', async () => {
  const post = '---\ntitle: P\nstatus: draft\n---\nx';
  const ctx = draftCtx({ refs: ['gbti/post-my-post', 'gbti/profile'], files: { 'gbti/post-my-post': post, 'gbti/profile': '---\ndisplayName: A\n---\n' } });
  const { drafts } = await listDrafts(ctx, { type: 'post' });
  assert.deepEqual(drafts.map((d) => d.type), ['post']);
});

test('readDraft: returns the staged frontmatter + body for the editor prefill', async () => {
  const md = '---\ntitle: My Post\nstatus: draft\n---\nThe body text';
  const ctx = draftCtx({ files: { 'gbti/post-my-post': md } });
  const out = await readDraft(ctx, { type: 'post', slug: 'my-post' });
  assert.equal(out.frontmatter.title, 'My Post');
  assert.equal(out.body, 'The body text');
  assert.equal(out.branch, 'gbti/post-my-post');
});

test('discardDraft: refuses with an open PR; deletes the branch when clean', async () => {
  const open = draftCtx({ openPull: { number: 5, html_url: 'u' } });
  await assert.rejects(
    () => discardDraft(open, { type: 'post', slug: 'my-post' }),
    (e) => { assert.match(e.message, /open pull request/i); return true; },
  );
  assert.equal(open.calls.deleteBranch.length, 0, 'must not delete a branch with an open PR');

  const clean = draftCtx({ openPull: null });
  const out = await discardDraft(clean, { type: 'post', slug: 'my-post' });
  assert.equal(out.branch, 'gbti/post-my-post');
  assert.deepEqual(clean.calls.deleteBranch, ['gbti/post-my-post']);
});

test('publishDraft: a trial member is blocked; a paid member opens the PR from the staged branch', async () => {
  await assert.rejects(
    () => publishDraft(draftCtx({ membership: 'trialing' }), { type: 'post', slug: 'my-post' }),
    (e) => { assert.equal(e.code, 'membership-required'); return true; },
  );

  const paid = draftCtx({ membership: 'paid' });
  const out = await publishDraft(paid, { type: 'post', slug: 'my-post' });
  assert.equal(out.prNumber, 99);
  assert.equal(paid.calls.openPull[0].head, 'alice:gbti/post-my-post');
  assert.equal(paid.calls.openPull[0].base, 'main');
});

test('publishDraft: reuses an already-open PR instead of opening a duplicate', async () => {
  const paid = draftCtx({ membership: 'paid', openPull: { number: 7, html_url: 'existing' } });
  const out = await publishDraft(paid, { type: 'post', slug: 'my-post' });
  assert.equal(out.updated, true);
  assert.equal(out.prNumber, 7);
  assert.equal(paid.calls.openPull.length, 0, 'must not open a second PR');
});

// SOW-106 Phase C: schema-drift validity surfaced on each draft row.
test('listDrafts: a draft that fails the CURRENT schema carries valid:false + a reason; a clean one valid:true', async () => {
  const good = '---\ntype: post\ntitle: Fine\nslug: fine\nauthor: alice\nstatus: published\n---\n\nBody.\n';
  const bad = '---\ntype: post\nslug: broken\nauthor: alice\nstatus: published\n---\n\nBody.\n'; // no title (required)
  const ctx = draftCtx({
    refs: ['gbti/post-fine', 'gbti/post-broken'],
    files: { 'gbti/post-fine': good, 'gbti/post-broken': bad },
  });
  const { drafts } = await listDrafts(ctx, {});
  const fine = drafts.find((d) => d.slug === 'fine');
  const broken = drafts.find((d) => d.slug === 'broken');
  assert.equal(fine.valid, true);
  assert.equal(fine.invalidReason, null);
  assert.equal(broken.valid, false);
  assert.match(String(broken.invalidReason), /title/i);
});

// SOW-112 QA fix: a stale drafts row can outlive its branch (the merged-branch cleanup races the list cache);
// discarding an already-deleted branch is the discarded state, not an error.
test('discardDraft succeeds (alreadyGone) when the branch no longer exists', async () => {
  const ctx = draftCtx({});
  const repo = ctx.getRepoClient();
  repo.deleteBranch = async () => { throw new Error('github error 422: Reference does not exist'); };
  repo.getBranchSha = async () => { throw new Error('404'); }; // gone
  ctx.getRepoClient = () => repo; // share the mutated instance (draftCtx builds a fresh repo per call)
  const r = await discardDraft(ctx, { type: 'prompt', slug: 'ghost' });
  assert.deepEqual(r, { ok: true, branch: 'gbti/prompt-ghost', alreadyGone: true });
});

test('discardDraft still surfaces a REAL delete failure (the branch exists)', async () => {
  const ctx = draftCtx({});
  const repo = ctx.getRepoClient();
  repo.deleteBranch = async () => { throw new Error('github error 403: forbidden'); };
  repo.getBranchSha = async () => 'still-here';
  ctx.getRepoClient = () => repo;
  await assert.rejects(discardDraft(ctx, { type: 'prompt', slug: 'held' }), /403/);
});

// sow-194: the extension/npm client-core fold of committed repo drafts into the Drafts listing + the store
// routing of the draft ops. A repo draft is a status:draft item committed to the public repo (store:'repo').
const withRepoDrafts = (ctx, items) => {
  ctx.fetch = async (url) => {
    if (String(url).includes('/membership/repo-drafts')) return { ok: true, json: async () => ({ ok: true, items }) };
    throw new Error('no other network in this unit test');
  };
  return ctx;
};

test('listDrafts: folds the caller\'s committed repo drafts (store:repo), deduped against a fork draft of the same slug', async () => {
  const fork = '---\ntitle: Forked\nstatus: published\nvisibility: public\n---\nx';
  const items = [
    { type: 'post', slug: 'committed-wip', path: 'members/alice/posts/committed-wip/index.md', owner: 'alice', title: 'Committed WIP', visibility: 'public', status: 'draft' },
    { type: 'post', slug: 'my-post', path: 'members/alice/posts/my-post/index.md', owner: 'alice', title: 'repo dupe of the fork draft', visibility: 'public', status: 'draft' },
  ];
  const ctx = withRepoDrafts(draftCtx({ refs: ['gbti/post-my-post'], files: { 'gbti/post-my-post': fork } }), items);
  const { drafts } = await listDrafts(ctx, {});
  const repoRows = drafts.filter((d) => d.store === 'repo');
  assert.deepEqual(repoRows.map((d) => d.slug), ['committed-wip']); // the my-post repo row is dropped (fork wins)
  assert.equal(repoRows[0].title, 'Committed WIP');
  assert.equal(repoRows[0].branch, null);
  assert.ok(drafts.some((d) => d.slug === 'my-post' && d.store === 'fork'), 'the fork my-post stays, not the repo dupe');
});

test('listDrafts: a repo-drafts fetch error is FAIL-SOFT (fork drafts still list; no repo rows)', async () => {
  const fork = '---\ntitle: Forked\nstatus: published\nvisibility: public\n---\nx';
  const ctx = draftCtx({ refs: ['gbti/post-my-post'], files: { 'gbti/post-my-post': fork } }); // default fetch throws
  const { drafts } = await listDrafts(ctx, {});
  assert.deepEqual(drafts.map((d) => d.slug), ['my-post']);
  assert.equal(drafts.every((d) => d.store !== 'repo'), true, 'a repo-drafts error must add no repo rows, not blank the list');
});

test('readDraft: store:repo reads the CANONICAL file via the reader (not a fork/KV record); path falls back to contentPath', async () => {
  const canonical = '---\ntitle: Committed\nstatus: draft\nvisibility: public\n---\nThe committed body';
  const ctx = draftCtx({});
  const seen = [];
  ctx.reader = { readFile: async (p) => { seen.push(p); return p === 'members/alice/posts/committed-wip/index.md' ? canonical : null; } };
  const out = await readDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' });
  assert.equal(out.store, 'repo');
  assert.equal(out.branch, null);
  assert.equal(out.frontmatter.title, 'Committed');
  assert.equal(out.body, 'The committed body');
  // no path -> contentPath(type, username, slug) resolves the same canonical path
  const out2 = await readDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo' });
  assert.equal(out2.frontmatter.title, 'Committed');
  assert.ok(seen.includes('members/alice/posts/committed-wip/index.md'));
});

test('discardDraft: store:repo is refused with a typed "unsupported" error (never a fork/KV delete)', async () => {
  const ctx = draftCtx({});
  await assert.rejects(
    () => discardDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo' }),
    (e) => { assert.ok(e instanceof OperationError); assert.equal(e.code, 'unsupported'); return true; },
  );
  assert.equal(ctx.calls.deleteBranch.length, 0, 'a repo draft must never delete a fork branch');
});

test('publishDraft: store:repo routes to the status flip (reads canonical + a status branch), NOT a PR from the draft branch', async () => {
  const canonical = '---\ntitle: Committed\nstatus: draft\nvisibility: public\n---\nBody';
  const ctx = draftCtx({ membership: 'paid' });
  const seen = [];
  ctx.reader = { readFile: async (p) => { seen.push(p); return canonical; } };
  await publishDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' });
  assert.ok(seen.includes('members/alice/posts/committed-wip/index.md'), 'the flip reads the canonical file via the reader');
  // it must NOT open a PR from the draft branch (that is the fork-publish path a repo draft must never take)
  assert.equal(ctx.calls.openPull.filter((p) => p.head === 'alice:gbti/post-committed-wip').length, 0);
});

test('publishDraft: store:repo for a non-paid member is blocked by the flip\'s own gate', async () => {
  const ctx = draftCtx({ membership: 'trialing' });
  ctx.reader = { readFile: async () => '---\ntitle: C\nstatus: draft\nvisibility: public\n---\nB' };
  await assert.rejects(
    () => publishDraft(ctx, { type: 'post', slug: 'committed-wip', store: 'repo', path: 'members/alice/posts/committed-wip/index.md' }),
    (e) => { assert.equal(e.code, 'membership-required'); return true; },
  );
});

// SOW-112 v2: a frontmatter slug differing from the branch identity is a PENDING RENAME; the row surfaces it.
test('listDrafts: a pending-rename draft carries pendingSlug (frontmatter slug differs from the branch)', async () => {
  const renamed = '---\ntitle: My Post\nslug: brand-new-name\nstatus: published\nvisibility: public\n---\nBody';
  const plain = '---\ntitle: Other\nslug: other-post\nstatus: published\nvisibility: public\n---\nBody';
  const ctx = draftCtx({
    refs: ['gbti/post-my-post', 'gbti/post-other-post'],
    files: { 'gbti/post-my-post': renamed, 'gbti/post-other-post': plain },
  });
  const { drafts } = await listDrafts(ctx, {});
  assert.equal(drafts.find((d) => d.slug === 'my-post').pendingSlug, 'brand-new-name');
  assert.equal(drafts.find((d) => d.slug === 'other-post').pendingSlug, null);
});
