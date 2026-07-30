// SOW-028: the app-mode read proxies for the in-client contribution review inbox (workers/signup/github-app.mjs).
// They read the PUBLIC canonical repo with GBTI's installation token (a fork-scoped member token cannot), gated
// by a valid member token. Unlike my-pulls/pr-status they are NOT head-owner scoped (the inbox is about OTHER
// members' PRs), which is safe because the data is public; the client filters to the caller's folder. All
// injectable: fake KV, fake fetch, fake JWT, stubbed user. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listOpenPullsForReview, reviewPrDetail, reviewPrFiles, reviewFileContent } from '../workers/signup/github-app.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network' };
const fakeKv = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { store: m, async get(k, t) { const v = m.get(k); return t === 'json' && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
};
const signJwt = async () => 'fake.jwt.sig';
const userAlice = async () => ({ githubLogin: 'Alice', githubId: '1' });
const getReq = (url = 'https://w/membership/open-pulls') => ({ url, headers: { get: () => 'Bearer tok' } });
const instOk = (url) => /access_tokens$/.test(url) && { ok: true, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
const base = { kv: fakeKv(), signJwt, fetchUser: userAlice };

test('listOpenPullsForReview maps every open PR (number, title, author, headSha, timestamps)', async () => {
  const pulls = [
    { number: 11, title: 'Improve X', html_url: 'u11', user: { login: 'bob', id: 2 }, head: { sha: 's11' }, created_at: 'C11', updated_at: 'U11' },
    { number: 12, title: 'Fix Y', html_url: 'u12', user: { login: 'carol', id: 3 }, head: { sha: 's12' }, created_at: 'C12', updated_at: 'U12' },
  ];
  let askedUrl = '';
  const fetchImpl = async (url) => { if (!/access_tokens$/.test(url)) askedUrl = url; return instOk(url) || { ok: true, async json() { return pulls; } }; };
  const r = await listOpenPullsForReview(getReq(), env, { ...base, fetchImpl });
  assert.equal(r.status, 200);
  assert.ok(askedUrl.includes('state=open'));
  assert.deepEqual(r.body.items[0], { number: 11, title: 'Improve X', html_url: 'u11', author: { login: 'bob', id: '2' }, headSha: 's11', createdAt: 'C11', updatedAt: 'U11' });
  assert.equal(r.body.items.length, 2);
});

test('the read proxies are unauthorized without a resolvable member token', async () => {
  const badUser = async () => { throw new Error('bad token'); };
  const fetchImpl = async (u) => instOk(u) || { ok: true, async json() { return []; } };
  const r = await listOpenPullsForReview(getReq(), env, { ...base, fetchUser: badUser, fetchImpl });
  assert.equal(r.status, 401);
});

test('reviewPrDetail returns the PR with headSha + author; 404 for a missing PR', async () => {
  const ok = async (url) => instOk(url) || (/\/pulls\/7$/.test(url)
    ? { ok: true, status: 200, async json() { return { number: 7, title: 'T', body: 'B', html_url: 'u7', state: 'open', head: { sha: 'abc' }, user: { login: 'bob', id: 2 } }; } }
    : { ok: false, status: 404, async json() { return {}; } });
  const r = await reviewPrDetail(getReq('https://w/membership/pr?number=7'), env, { ...base, fetchImpl: ok });
  assert.equal(r.status, 200);
  assert.equal(r.body.headSha, 'abc');
  assert.deepEqual(r.body.author, { login: 'bob', id: '2' });

  const miss = await reviewPrDetail(getReq('https://w/membership/pr?number=9'), env, { ...base, fetchImpl: async (u) => instOk(u) || { ok: false, status: 404, async json() { return {}; } } });
  assert.equal(miss.status, 404);
});

test('reviewPrFiles includes patch only when patch=1', async () => {
  const files = [{ filename: 'members/alice/posts/x/index.md', status: 'modified', additions: 2, deletions: 1, patch: '@@ -1 +1 @@\n-a\n+b' }];
  const fetchImpl = async (u) => instOk(u) || { ok: true, async json() { return files; } };
  const withP = await reviewPrFiles(getReq('https://w/membership/pr-files?number=7&patch=1'), env, { ...base, fetchImpl });
  assert.equal(withP.body.files[0].patch, '@@ -1 +1 @@\n-a\n+b');
  const noP = await reviewPrFiles(getReq('https://w/membership/pr-files?number=7'), env, { ...base, fetchImpl });
  assert.equal('patch' in noP.body.files[0], false, 'no patch unless asked');
  assert.equal(noP.body.files[0].additions, 2);
});

test('reviewFileContent decodes base64, rejects non-members paths, and reports a missing file as null', async () => {
  const content = Buffer.from('---\ntitle: X\n---\nHello body.', 'utf8').toString('base64');
  const fetchImpl = async (u) => instOk(u) || { ok: true, async json() { return { content }; } };
  const r = await reviewFileContent(getReq('https://w/membership/file?path=members/alice/posts/x/index.md&ref=abc'), env, { ...base, fetchImpl });
  assert.equal(r.status, 200);
  assert.match(r.body.text, /Hello body\./);

  // sow-158 in-app reader: house CONTENT (posts/products/prompts) is readable so the browse reader can open
  // GBTI's own items inline; the governance files under house/ stay a 400 (not a general file oracle).
  const house = await reviewFileContent(getReq('https://w/membership/file?path=house/posts/y/index.md&ref=abc'), env, { ...base, fetchImpl });
  assert.equal(house.status, 200, 'house content is readable for the in-app reader');
  assert.match(house.body.text, /Hello body\./);

  const bad = await reviewFileContent(getReq('https://w/membership/file?path=house/roles.yml&ref=abc'), env, { ...base, fetchImpl });
  assert.equal(bad.status, 400, 'only members/ + house content paths are allowed (no general file oracle)');

  const bans = await reviewFileContent(getReq('https://w/membership/file?path=house/bans.yml&ref=abc'), env, { ...base, fetchImpl });
  assert.equal(bans.status, 400, 'house governance files are not served');

  const traversal = await reviewFileContent(getReq('https://w/membership/file?path=members/alice/../../house/roles.yml&ref=abc'), env, { ...base, fetchImpl });
  assert.equal(traversal.status, 400, 'path traversal is rejected');

  const missing = await reviewFileContent(getReq('https://w/membership/file?path=members/alice/posts/x/index.md&ref=zzz'), env, { ...base, fetchImpl: async (u) => instOk(u) || { ok: false, status: 404, async json() { return {}; } } });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.text, null);
});
