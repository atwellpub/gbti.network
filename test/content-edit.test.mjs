// sow-183: canEditItem (relocated out of product-page.mjs now that every content-detail page uses it, not
// just products). Tests carried over verbatim from their old home in test/product-page.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { canEditItem } from '../src/lib/content-edit.mjs';

test('canEditItem: the owner (case-insensitive) may edit; a stranger may not', () => {
  assert.equal(canEditItem({ login: 'atwellpub', role: 'member' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: 'AtwellPub', role: 'member' }, 'atwellpub'), true); // login case differs
  assert.equal(canEditItem({ login: 'someoneelse', role: 'member' }, 'atwellpub'), false);
});

test('canEditItem: superadmin may edit any item, even one they do not own', () => {
  assert.equal(canEditItem({ login: 'gbtilabs', role: 'superadmin' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: null, role: 'superadmin' }, 'atwellpub'), true); // role alone is enough
});

test('canEditItem: signed out, or signed in with no matching login/role, sees no edit affordance', () => {
  assert.equal(canEditItem(null, 'atwellpub'), false);
  assert.equal(canEditItem({ login: 'atwellpub', role: 'admin' }, ''), false); // no owner to compare against
  assert.equal(canEditItem({ login: null, role: 'member' }, 'atwellpub'), false);
});
