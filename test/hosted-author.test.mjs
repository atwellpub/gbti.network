// SOW-156: the hosted-author pure core. These are the security wall tests: the branch parse cannot be
// shifted by a crafted itemId, paths cannot escape the member's own folder, and the members-index parse
// fails closed (absent entry = denial, never a mis-scope).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMembersIndex,
  hostedBranchFor,
  parseHostedRef,
  validateHostedRequest,
  HOSTED_MAX_FILES,
  HOSTED_MAX_FILE_BYTES,
} from '../membership/hosted-author.mjs';

// ---- members-index parse ----

test('parseMembersIndex: parses the flat quoted map, skips comments and the header', () => {
  const text = [
    '# Authoritative github_id -> username map',
    'members:',
    '  "2002207": atwellpub',
    '  "132623795": aliayashi517',
    '  # a comment',
    '',
  ].join('\n');
  const map = parseMembersIndex(text);
  assert.equal(map.get('2002207'), 'atwellpub');
  assert.equal(map.get('132623795'), 'aliayashi517');
  assert.equal(map.size, 2);
});

test('parseMembersIndex: skips malformed lines and non-strings (fail closed)', () => {
  assert.equal(parseMembersIndex(null).size, 0);
  const map = parseMembersIndex('  "abc": nope\n  "123": Upper_Case\n  "456": ok-name\n');
  assert.equal(map.size, 1);
  assert.equal(map.get('456'), 'ok-name');
});

// ---- branch build + parse (one contract) ----

test('hostedBranchFor + parseHostedRef round-trip', () => {
  const branch = hostedBranchFor('2002207', 'my-first-post');
  assert.equal(branch, 'hosted/2002207/my-first-post');
  assert.equal(parseHostedRef(branch), '2002207');
});

test('hostedBranchFor: rejects a non-numeric id and a bad itemId', () => {
  assert.equal(hostedBranchFor('org-name', 'x'), null);
  assert.equal(hostedBranchFor('123', 'Has Space'), null);
  assert.equal(hostedBranchFor('123', 'a/../b'), null);
  assert.equal(hostedBranchFor('123', ''), null);
});

test('parseHostedRef: a crafted ref cannot shift the id parse (fail closed to null)', () => {
  assert.equal(parseHostedRef('hosted/999/evil/2002207/x'), null); // extra segment
  assert.equal(parseHostedRef('hosted/2002207'), null); // no item segment
  assert.equal(parseHostedRef('hosted//x'), null);
  assert.equal(parseHostedRef('hosted/abc/x'), null);
  assert.equal(parseHostedRef('gbti/ban-999'), null);
  assert.equal(parseHostedRef('main'), null);
  assert.equal(parseHostedRef(null), null);
});

// ---- request validation ----

const okFiles = [{ path: 'members/atwellpub/posts/hello.md', content: '---\ntitle: x\n---\nbody' }];

test('validateHostedRequest: a clean own-folder write passes', () => {
  const r = validateHostedRequest({ files: okFiles, itemId: 'hello', folder: 'atwellpub' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.paths, ['members/atwellpub/posts/hello.md']);
});

test('validateHostedRequest: null content (a delete) passes and skips size accounting', () => {
  const r = validateHostedRequest({
    files: [{ path: 'members/atwellpub/posts/old.md', content: null }],
    itemId: 'old', folder: 'atwellpub',
  });
  assert.equal(r.ok, true);
});

test('validateHostedRequest: rejects paths outside the own folder (other member, house, root, .github)', () => {
  for (const path of [
    'members/other/posts/x.md',
    'house/roles.yml',
    'CODEOWNERS',
    '.github/workflows/x.yml',
    'scripts/pr-gate.mjs',
    'members/atwellpub', // the folder itself, not a file inside it
  ]) {
    const r = validateHostedRequest({ files: [{ path, content: 'x' }], itemId: 'x', folder: 'atwellpub' });
    assert.equal(r.ok, false, `${path} must be rejected`);
  }
});

test('validateHostedRequest: rejects traversal and unclean paths', () => {
  for (const path of [
    'members/atwellpub/../../house/roles.yml',
    '/members/atwellpub/posts/x.md',
    'members/atwellpub/posts/..',
    'members/atwellpub/\\posts/x.md',
  ]) {
    const r = validateHostedRequest({ files: [{ path, content: 'x' }], itemId: 'x', folder: 'atwellpub' });
    assert.equal(r.ok, false, `${path} must be rejected`);
  }
});

test('validateHostedRequest: missing folder is a 409 (folder not provisioned), not a generic 400', () => {
  const r = validateHostedRequest({ files: okFiles, itemId: 'x', folder: null });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
});

test('validateHostedRequest: caps files, per-file bytes, and duplicates', () => {
  const many = Array.from({ length: HOSTED_MAX_FILES + 1 }, (_, i) => ({ path: `members/a/posts/p${i}.md`, content: 'x' }));
  assert.equal(validateHostedRequest({ files: many, itemId: 'x', folder: 'a' }).ok, false);
  const big = [{ path: 'members/a/posts/big.md', content: 'x'.repeat(HOSTED_MAX_FILE_BYTES + 1) }];
  assert.equal(validateHostedRequest({ files: big, itemId: 'x', folder: 'a' }).ok, false);
  const dupe = [
    { path: 'members/a/posts/x.md', content: 'a' },
    { path: 'members/a/posts/x.md', content: 'b' },
  ];
  assert.equal(validateHostedRequest({ files: dupe, itemId: 'x', folder: 'a' }).ok, false);
});

test('validateHostedRequest: rejects a bad itemId and non-string content', () => {
  assert.equal(validateHostedRequest({ files: okFiles, itemId: 'Bad/Id', folder: 'atwellpub' }).ok, false);
  assert.equal(validateHostedRequest({ files: [{ path: 'members/a/posts/x.md', content: 7 }], itemId: 'x', folder: 'a' }).ok, false);
  assert.equal(validateHostedRequest({ files: [], itemId: 'x', folder: 'a' }).ok, false);
});

// SOW-157: the id contract is 80 chars so share itemIds (share-<stamp>-<48-char slug> = 69) fit.
test('id contract: a share-length itemId round-trips; 81+ chars still rejected', () => {
  const shareId = 'share-20260725193000-' + 'a'.repeat(48); // 69 chars
  const branch = hostedBranchFor('2002207', shareId);
  assert.equal(branch, `hosted/2002207/${shareId}`);
  assert.equal(parseHostedRef(branch), '2002207');
  assert.equal(hostedBranchFor('1', 'a'.repeat(81)), null);
});
