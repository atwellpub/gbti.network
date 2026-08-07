// SOW-120: the X (Twitter) adapter (clients/syndication/x.mjs). Covers secret gating, the template + stub
// rendering parity with Reddit, the manual textOverride winning, 280 truncation, and error surfacing. The
// OAuth 1.0a signer itself is covered by test/oauth1.test.mjs. Injected fetch + fixed nonce/timestamp, no
// network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXAdapter } from '../clients/syndication/x.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

const ENV = { X_API_KEY: 'ck', X_API_SECRET: 'cs', X_ACCESS_TOKEN: 'tok', X_ACCESS_SECRET: 'ts' };
const CFG = syndicationConfigFromParsed({});
const ITEM = { source: 'post', title: 'My Article', url: 'https://gbti.network/articles/my-article/', author: 'atwellpub', authorName: 'Hudson Atwell', visibility: 'public' };
const SIGN = { nonce: 'fixed-nonce', timestamp: 1318622958 };
const OK = { ok: true, status: 201, json: async () => ({ data: { id: '1799', text: 'ok' } }) };

function capture(response) {
  const calls = [];
  return { calls, fetchImpl: async (url, opts) => { calls.push({ url, opts }); return response; } };
}
const bodyOf = (calls) => JSON.parse(calls[0].opts.body);

test('enabled() requires all four OAuth 1.0a secrets', () => {
  assert.equal(createXAdapter({ env: ENV }).enabled(), true);
  assert.equal(createXAdapter({ env: { ...ENV, X_ACCESS_SECRET: '' } }).enabled(), false);
  assert.equal(createXAdapter({ env: {} }).enabled(), false);
});

test('a public post renders the {title} {url} default and signs with an OAuth header', async () => {
  const { calls, fetchImpl } = capture(OK);
  const r = await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post(ITEM, SIGN);
  assert.equal(r.ok, true);
  assert.equal(r.id, '1799');
  assert.equal(r.url, 'https://x.com/i/web/status/1799');
  assert.equal(calls[0].url, 'https://api.twitter.com/2/tweets');
  assert.ok(calls[0].opts.headers.Authorization.startsWith('OAuth '));
  assert.ok(calls[0].opts.headers.Authorization.includes('oauth_signature='));
  const text = bodyOf(calls).text;
  assert.ok(text.includes('My Article'), 'title present');
  assert.ok(text.includes(ITEM.url), 'url present (X auto-cards it)');
});

test('a members-only post renders the X-native stub (never a body)', async () => {
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post({ ...ITEM, visibility: 'members' }, SIGN);
  const text = bodyOf(calls).text;
  assert.ok(text.includes('Members-only on the GBTI Network'), 'the X stub leads');
  assert.ok(text.includes('My Article'));
  assert.ok(text.includes('Hudson Atwell'), 'fullName resolved');
  assert.ok(text.includes(ITEM.url));
});

test('a members-only SHARE renders the share-specific stub', async () => {
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post({ ...ITEM, source: 'share', membersOnly: true }, SIGN);
  const text = bodyOf(calls).text;
  assert.ok(text.includes('A members-only link on the GBTI Network'), 'the share stub, not the post stub'); // sow-180: content-first
  assert.ok(!text.includes('Hudson Atwell'), 'sow-180: a share credits no member');
});

test('the manual textOverride wins over the template', async () => {
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'A hand-written tweet' }, SIGN);
  assert.equal(bodyOf(calls).text, 'A hand-written tweet');
});

test('text is truncated to the 280 cap', async () => {
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'z'.repeat(400) }, SIGN);
  assert.ok(bodyOf(calls).text.length <= 280);
});

test('a non-ok response surfaces the X error detail, fail-closed', async () => {
  const { fetchImpl } = capture({ ok: false, status: 403, json: async () => ({ detail: 'You are not permitted to perform this action.', title: 'Forbidden' }) });
  const r = await createXAdapter({ env: ENV, fetchImpl, cfg: CFG }).post(ITEM, SIGN);
  assert.equal(r.ok, false);
  assert.ok(/not permitted/.test(r.error), r.error);
});

test('the auto rail renders a configured x channel template with {member-x-handle} + hashtags', async () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: { x: {
    prompt: 'New {content-type} by {member-x-handle}: "{title}" {url} {category-hashtag} {tags-hashtags}',
  } } } });
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg }).post(
    { ...ITEM, source: 'prompt', authorX: 'https://x.com/atwellpub', category: 'AI', tags: ['Prompts', 'Skill'] },
    SIGN,
  );
  const text = bodyOf(calls).text;
  assert.ok(text.includes('@atwellpub'), 'the X handle mention resolves');
  assert.ok(text.includes('#AI'), 'category hashtag');
  assert.ok(text.includes('#Prompts') && text.includes('#Skill'), 'tag hashtags');
  assert.ok(text.includes(ITEM.url), 'the url survives');
});

test('member without an X handle falls back to the full name', async () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: { post: {} }, } });
  const cfg2 = syndicationConfigFromParsed({ syndication: { channel_templates: { x: { post: 'by {member-x-handle}: {url}' } } } });
  const { calls, fetchImpl } = capture(OK);
  await createXAdapter({ env: ENV, fetchImpl, cfg: cfg2 }).post({ ...ITEM, authorName: 'Hudson Atwell' }, SIGN);
  assert.ok(bodyOf(calls).text.startsWith('by Hudson Atwell:'));
});

test('works without cfg (falls back to buildChannelText)', async () => {
  const { calls, fetchImpl } = capture(OK);
  const r = await createXAdapter({ env: ENV, fetchImpl }).post(ITEM, SIGN);
  assert.equal(r.ok, true);
  assert.ok(bodyOf(calls).text.length > 0);
});
