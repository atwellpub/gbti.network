// sow-208: the publish-transition selector. Publishing is a status flip now, so syndication must fire on the
// transition to published, not on the file appearing. These prove the transition logic and the git-diff
// selection against a FAKE git (no network, no real repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isContentPath, statusOf, isPublishTransition, selectPublishedTransitions } from '../scripts/lib/publish-transitions.mjs';

test('statusOf: a missing status defaults to published (matches the enqueue guard)', () => {
  assert.equal(statusOf({ status: 'draft' }), 'draft');
  assert.equal(statusOf({ status: 'published' }), 'published');
  assert.equal(statusOf({}), 'published');
  assert.equal(statusOf(null), 'published');
});

test('isContentPath: posts/products/prompts index.md + shares, nothing else', () => {
  assert.ok(isContentPath('members/gbtilabs/posts/x/index.md'));
  assert.ok(isContentPath('house/products/y/index.md'));
  assert.ok(isContentPath('members/alice/prompts/z/index.md'));
  assert.ok(isContentPath('members/bob/shares/note.md'));
  assert.ok(!isContentPath('house/taxonomy.yml'));
  assert.ok(!isContentPath('members/gbtilabs/posts/x/images/a.webp'));
  assert.ok(!isContentPath('members/gbtilabs/profile.md'));
});

test('isPublishTransition: only draft/absent -> published counts; published -> published does not', () => {
  assert.equal(isPublishTransition(null, { status: 'published' }), true);   // added, published now
  assert.equal(isPublishTransition({ status: 'draft' }, { status: 'published' }), true); // draft -> published
  assert.equal(isPublishTransition({ status: 'published' }, { status: 'published' }), false); // edit of a published item
  assert.equal(isPublishTransition({ status: 'published' }, { status: 'draft' }), false); // unpublish
  assert.equal(isPublishTransition(null, { status: 'draft' }), false); // added as a draft
  assert.equal(isPublishTransition(null, null), false); // deleted / unreadable after
  assert.equal(isPublishTransition(null, {}), true); // added, no status -> published by default
  assert.equal(isPublishTransition({}, {}), false); // published-by-default on both sides
});

// A fake git that answers `diff --name-status` with a fixed table and `show <sha>:<path>` from a file map.
function fakeGit({ nameStatus, files }) {
  return (args) => {
    if (args[0] === 'diff') return nameStatus;
    if (args[0] === 'show') {
      const ref = args[1]; // "<sha>:<path>"
      if (!(ref in files)) { const e = new Error('exists on disk, but not in the given tree'); e.status = 128; throw e; }
      return files[ref];
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}
const parseFm = (t) => { const m = String(t).match(/status:\s*([a-z]+)/); return m ? { status: m[1] } : {}; };

test('selectPublishedTransitions: the AirLLM scenario + the rename guardrail', () => {
  const before = 'b'.repeat(40);
  const after = 'a'.repeat(40);
  const nameStatus = [
    'M\tmembers/gbtilabs/posts/airllm/index.md',                             // draft -> published: SELECT
    'R100\thouse/posts/old/index.md\tmembers/gbtilabs/posts/old/index.md',   // published -> published rename: NOT
    'A\tmembers/alice/posts/new-draft/index.md',                             // added as draft: NOT
    'A\tmembers/bob/posts/fresh/index.md',                                   // added published: SELECT
    'M\tmembers/carol/posts/edit/index.md',                                  // published edit: NOT
    'D\tmembers/dan/posts/gone/index.md',                                    // deleted: NOT
    'M\thouse/taxonomy.yml',                                                 // not content: ignored
  ].join('\n');
  const files = {
    [`${after}:members/gbtilabs/posts/airllm/index.md`]: 'status: published',
    [`${before}:members/gbtilabs/posts/airllm/index.md`]: 'status: draft',
    [`${after}:members/gbtilabs/posts/old/index.md`]: 'status: published',
    [`${before}:house/posts/old/index.md`]: 'status: published',
    [`${after}:members/alice/posts/new-draft/index.md`]: 'status: draft',
    [`${after}:members/bob/posts/fresh/index.md`]: 'status: published',
    [`${after}:members/carol/posts/edit/index.md`]: 'status: published',
    [`${before}:members/carol/posts/edit/index.md`]: 'status: published',
  };
  const out = selectPublishedTransitions({ before, after, runGit: fakeGit({ nameStatus, files }), parseFm });
  assert.deepEqual(out.sort(), [
    'members/bob/posts/fresh/index.md',
    'members/gbtilabs/posts/airllm/index.md',
  ]);
});

test('selectPublishedTransitions: fail-closed on a missing baseline or a git error', () => {
  const runGit = () => { throw new Error('git blew up'); };
  assert.deepEqual(selectPublishedTransitions({ before: 'a'.repeat(40), after: 'b'.repeat(40), runGit, parseFm }), []); // git error
  assert.deepEqual(selectPublishedTransitions({ before: '0'.repeat(40), after: 'b'.repeat(40), runGit: () => 'M\tx', parseFm }), []); // zero baseline
  assert.deepEqual(selectPublishedTransitions({ before: '', after: 'b'.repeat(40), parseFm }), []); // no before
  assert.deepEqual(selectPublishedTransitions({ before: 'a'.repeat(40), after: 'b'.repeat(40) }), []); // no parseFm
});
