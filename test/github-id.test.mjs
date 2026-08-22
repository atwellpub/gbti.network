// The single shared definition of a GitHub user id. It exists because two call sites briefly had two
// implementations that DISAGREED on the same input, which is worse than either rule alone: a value could pass
// one gate and fail another. These pin the canonical answer so a future second copy is caught by disagreement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGithubId } from '../clients/github-id.mjs';

test('github-id: accepts a bare digit string and returns it unchanged', () => {
  assert.equal(normalizeGithubId('125175036'), '125175036');
  assert.equal(normalizeGithubId('1'), '1');
  assert.equal(normalizeGithubId(125175036), '125175036', 'a number coerces to its digit string');
});

test('github-id: REJECTS rather than cleans (the 2026-08-22 rule)', () => {
  for (const padded of ['125175036\n', ' 125175036', '125175036 ', '\t125175036', '125 175']) {
    assert.equal(normalizeGithubId(padded), null, `must refuse: ${JSON.stringify(padded)}`);
  }
});

test('github-id: refuses everything that is not a plain positive integer', () => {
  for (const bad of [null, undefined, '', 'abc', '12a', '-1', '+1', '1.0', '1e3', "1'", '0x10', {}, [], true, NaN]) {
    assert.equal(normalizeGithubId(bad), null, `must refuse: ${JSON.stringify(bad)}`);
  }
});

test('github-id: enforces a LENGTH BOUND, which a bare quantifier would not', () => {
  assert.equal(normalizeGithubId('9'.repeat(20)), '9'.repeat(20), '20 digits is the documented ceiling');
  assert.equal(normalizeGithubId('9'.repeat(21)), null, 'an unbounded digit run must not reach a query or a KV key');
});

test('github-id: the module is a LEAF and must import nothing', async () => {
  const src = await (await import('node:fs/promises')).readFile(new URL('../clients/github-id.mjs', import.meta.url), 'utf8');
  assert.equal(/^\s*import\s/m.test(src), false, 'importing anything here reintroduces the coupling it exists to avoid');
});
