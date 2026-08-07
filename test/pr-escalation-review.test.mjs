// Path-traversal escalation regression. A prior review found that raw startsWith matching let a paid
// member craft changed paths beginning with their own folder prefix but escaping it via "../" or
// "./", which classified as own-folder content and merged with a green check. classify-pr.mjs now
// rejects any non-canonical path fail-closed. These tests assert the exploit is BLOCKED.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifyPaths, decide, isCleanPath } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides.mjs';
import { TIER } from '../membership/tiers.mjs';

const OWNED = 'octocat';
// A paid Content Creator (sow-185: today's legacy paid = creator). The tier is irrelevant to these
// escalation cases (a non-canonical / protected path fails before the tier gate), but passing it keeps a
// legitimate own-folder or contribution path from tripping the creator gate for the wrong reason.
const paidMember = (paths) =>
  decide({ paths, role: ROLE.member, effective: { status: 'paid' }, ownedFolder: OWNED, tier: TIER.creator });

const EXPLOITS = [
  'members/octocat/../../house/roles.yml', // self-promote to superadmin
  'members/octocat/../../house/grandfathered.yml', // self-grant paid-equivalent
  'members/octocat/../../CODEOWNERS', // rewrite ownership
  'members/octocat/../../.github/workflows/pr-membership-gate.yml', // neuter the gate
  'members/octocat/../dikafei/posts/takeover/index.md', // write a victim folder
  'members/octocat/./posts/x/index.md', // dot-segment
  '/etc/passwd', // absolute
  'members\\octocat\\posts\\x', // backslash
  'members//octocat/posts/x/index.md', // empty segment (double slash)
];

for (const path of EXPLOITS) {
  test(`traversal blocked: ${path}`, () => {
    const c = classifyPaths([path], OWNED);
    assert.equal(c.unclean.length > 0 || c.ownFolderOnly === false, true);
    const d = paidMember([path]);
    assert.equal(d.check, 'fail');
    assert.equal(d.label, 'rejected-escalation');
    assert.equal(d.autoMerge, false);
  });
}

test('a traversal path mixed with legitimate own content still rejects the whole PR', () => {
  const d = paidMember(['members/octocat/posts/ok/index.md', 'members/octocat/../../house/roles.yml']);
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'rejected-escalation');
});

test('isCleanPath accepts canonical repo paths and rejects traversal', () => {
  assert.equal(isCleanPath('members/octocat/posts/x/index.md'), true);
  assert.equal(isCleanPath('house/roles.yml'), true);
  assert.equal(isCleanPath('members/octocat/../x'), false);
  assert.equal(isCleanPath('./x'), false);
  assert.equal(isCleanPath('/abs'), false);
  assert.equal(isCleanPath('a\\b'), false);
  assert.equal(isCleanPath(''), false);
  assert.equal(isCleanPath('a//b'), false);
});

test('the sibling-prefix case is correctly cross-folder (a contribution to octocat-evil, never own)', () => {
  // members/octocat-evil is NOT inside members/octocat (the trailing slash guards this). It is a
  // different owner, so it is treated as a contribution (held pending that owner's approval), and it
  // can never be auto-merged as octocat's own content.
  const c = classifyPaths(['members/octocat-evil/posts/x/index.md'], OWNED);
  assert.equal(c.ownFolderOnly, false);
  assert.equal(c.otherMemberPaths.length, 1);
  assert.deepEqual(c.otherOwners, ['octocat-evil']);
  const d = paidMember(['members/octocat-evil/posts/x/index.md']);
  assert.equal(d.check, 'fail');
  assert.equal(d.label, 'contribution-pending-owner');
  assert.equal(d.autoMerge, false);
});
