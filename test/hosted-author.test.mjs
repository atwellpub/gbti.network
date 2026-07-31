// SOW-156: the hosted-author pure core. These are the security wall tests: the branch parse cannot be
// shifted by a crafted itemId, paths cannot escape the member's own folder, and the members-index parse
// fails closed (absent entry = denial, never a mis-scope).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseMembersIndex,
  hostedBranchFor,
  parseHostedRef,
  adminHostedBranchFor,
  parseAdminHostedRef,
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

// ---- sow-161 admin-hosted branch contract ----

test('adminHostedBranchFor + parseAdminHostedRef round-trip', () => {
  const branch = adminHostedBranchFor('2002207', 'deplatform-my-post');
  assert.equal(branch, 'hosted-admin/2002207/deplatform-my-post');
  assert.equal(parseAdminHostedRef(branch), '2002207');
});

test('adminHostedBranchFor: rejects a non-numeric id and a bad action slug', () => {
  assert.equal(adminHostedBranchFor('org-name', 'x'), null);
  assert.equal(adminHostedBranchFor('123', 'Has Space'), null);
  assert.equal(adminHostedBranchFor('123', 'a/../b'), null);
  assert.equal(adminHostedBranchFor('123', ''), null);
});

test('parseAdminHostedRef: fails closed, and the two hosted namespaces do NOT cross-parse', () => {
  assert.equal(parseAdminHostedRef('hosted-admin/999/evil/2002207/x'), null); // extra segment
  assert.equal(parseAdminHostedRef('hosted-admin/2002207'), null); // no action segment
  assert.equal(parseAdminHostedRef('hosted-admin//x'), null);
  assert.equal(parseAdminHostedRef('hosted-admin/abc/x'), null);
  assert.equal(parseAdminHostedRef(null), null);
  // a member content branch is NOT an admin branch, and vice-versa (distinct namespaces)
  assert.equal(parseAdminHostedRef('hosted/2002207/my-post'), null);
  assert.equal(parseHostedRef('hosted-admin/2002207/ban-1'), null);
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

// sow-158 image upload: a binary { path, contentBase64 } entry is the ONLY way to commit a raster image, and the
// gate is the security wall — it must stay own-folder + images/ + a web-image extension + <=1 MB, and reject
// everything else. These are the adversarial cases.
test('validateHostedRequest: a valid own-folder image (png base64) passes alongside a text file', () => {
  const b64 = Buffer.from('a fake png payload').toString('base64'); // small, valid base64
  const r = validateHostedRequest({
    files: [
      { path: 'members/atwellpub/posts/hello/index.md', content: '---\ntitle: Hi\n---\nbody' },
      { path: 'members/atwellpub/images/cover.png', contentBase64: b64 },
    ],
    itemId: 'post-hello', folder: 'atwellpub',
  });
  assert.equal(r.ok, true);
});

test('validateHostedRequest: a binary image is gated to own-folder images/ + a raster extension (no svg, no escape)', () => {
  const b64 = Buffer.from('x').toString('base64');
  const reject = (path, folder = 'atwellpub') => validateHostedRequest({ files: [{ path, contentBase64: b64 }], itemId: 'x', folder });
  assert.equal(reject('members/atwellpub/posts/hello/index.md').ok, false, 'binary not allowed on a non-image path');
  assert.equal(reject('members/atwellpub/images/evil.svg').ok, false, 'svg is refused on web upload');
  assert.equal(reject('members/atwellpub/images/evil.html').ok, false, 'a non-image extension is refused');
  assert.equal(reject('members/other/images/x.png').ok, false, 'cannot write another member\'s images');
  assert.equal(reject('members/atwellpub/images/../../house/x.png').ok, false, 'no traversal out of the folder');
});

test('validateHostedRequest: an image rejects bad base64, empty, and >1 MB; text + binary cannot co-carry', () => {
  const img = (contentBase64) => validateHostedRequest({ files: [{ path: 'members/a/images/x.png', contentBase64 }], itemId: 'x', folder: 'a' });
  assert.equal(img('not*base64!').ok, false, 'invalid base64 rejected');
  assert.equal(img('').ok, false, 'empty rejected');
  const overMb = 'A'.repeat(Math.ceil((1_048_577 * 4) / 3 / 4) * 4); // > 1 MB decoded, padded to a multiple of 4
  assert.equal(img(overMb).ok, false, 'over 1 MB rejected');
  // an entry cannot be both text and binary
  assert.equal(validateHostedRequest({ files: [{ path: 'members/a/images/x.png', content: 'hi', contentBase64: Buffer.from('x').toString('base64') }], itemId: 'x', folder: 'a' }).ok, false);
});

test('base64DecodedBytes: exact decoded length, -1 on malformed', async () => {
  const { base64DecodedBytes } = await import('../membership/hosted-author.mjs');
  assert.equal(base64DecodedBytes(Buffer.from('hello').toString('base64')), 5);
  assert.equal(base64DecodedBytes(Buffer.from('ab').toString('base64')), 2); // 'YWI=' -> 2
  assert.equal(base64DecodedBytes('###'), -1);
  assert.equal(base64DecodedBytes('abc'), -1); // not a multiple of 4
});

// SOW-157: the id contract is 80 chars so share itemIds (share-<stamp>-<48-char slug> = 69) fit.
test('id contract: a share-length itemId round-trips; 81+ chars still rejected', () => {
  const shareId = 'share-20260725193000-' + 'a'.repeat(48); // 69 chars
  const branch = hostedBranchFor('2002207', shareId);
  assert.equal(branch, `hosted/2002207/${shareId}`);
  assert.equal(parseHostedRef(branch), '2002207');
  assert.equal(hostedBranchFor('1', 'a'.repeat(81)), null);
});
