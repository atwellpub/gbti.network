// SOW-123: the Mastodon adapter (clients/syndication/mastodon.mjs). Covers secret gating, template + stub
// parity, the @user@instance mention + url + hashtags riding in the status text (Mastodon renders them
// natively), textOverride, 500 truncation, the returned url passthrough, and error mapping. Injected fetch,
// no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMastodonAdapter } from '../clients/syndication/mastodon.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

const ENV = { MASTODON_BASE_URL: 'https://mastodon.social', MASTODON_ACCESS_TOKEN: 'tok' };
const CFG = syndicationConfigFromParsed({ syndication: { channel_templates: { mastodon: {
  post: 'New {content-type} by {member-mastodon-handle}: "{title}" {url} {category-hashtag} {tags-hashtags}',
} } } });
const ITEM = { source: 'post', title: 'Hello World', url: 'https://gbti.network/articles/hello/', authorName: 'Hudson Atwell', category: 'AI', tags: ['Prompts'], enqueuedAt: 1000 };

function fakeFetch({ ok = true, id = '11223', url = 'https://mastodon.social/@gbti/11223', error = 'unprocessable' } = {}) {
  const calls = [];
  const fetchImpl = async (u, opts) => { calls.push({ u, opts }); return ok ? { ok: true, json: async () => ({ id, url }) } : { ok: false, status: 422, json: async () => ({ error }) }; };
  return { calls, fetchImpl };
}
const statusOf = (calls) => JSON.parse(calls[0].opts.body).status;

test('enabled() requires the base URL + access token', () => {
  assert.equal(createMastodonAdapter({ env: ENV }).enabled(), true);
  assert.equal(createMastodonAdapter({ env: { MASTODON_BASE_URL: 'x' } }).enabled(), false);
  assert.equal(createMastodonAdapter({ env: {} }).enabled(), false);
});

// sow-159: Mastodon is RETIRED. The adapter stays on disk, but its TEMPLATE render path is dormant because
// the config parser (normalizeChannelTemplates over TEMPLATE_CHANNELS = CHANNELS) strips a retired channel's
// template. Re-adding 'mastodon' to CHANNELS (syndication-config-core) reactivates rendering; un-skip these
// two render/stub tests then. The adapter's secret-gating, POST mechanics, and textOverride tests below stay
// live, proving the adapter code itself is intact. Runbook: .data/ops/channel-ops/mastadon.md.
test('a public post renders the mastodon template with the mention, url, and hashtags inline', { skip: 'sow-159: Mastodon retired; render path dormant until re-added to CHANNELS' }, async () => {
  const { calls, fetchImpl } = fakeFetch();
  const r = await createMastodonAdapter({ env: ENV, fetchImpl, cfg: CFG })
    .post({ ...ITEM, authorMastodon: 'https://mastodon.social/@propertunity' });
  assert.equal(r.ok, true);
  assert.equal(r.id, '11223');
  assert.equal(r.url, 'https://mastodon.social/@gbti/11223'); // the returned status URL passes through
  assert.equal(calls[0].u, 'https://mastodon.social/api/v1/statuses');
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer tok');
  const s = statusOf(calls);
  assert.ok(s.includes('@propertunity@mastodon.social'), 'the fediverse mention rides in the text');
  assert.ok(s.includes('https://gbti.network/articles/hello/'), 'the url is inline (Mastodon auto-links it)');
  assert.ok(s.includes('#AI') && s.includes('#Prompts'), 'hashtags inline');
});

test('no mastodon handle -> the full name; a members-only item renders the stub', { skip: 'sow-159: Mastodon retired; render path dormant until re-added to CHANNELS' }, async () => {
  const noHandle = fakeFetch();
  await createMastodonAdapter({ env: ENV, fetchImpl: noHandle.fetchImpl, cfg: CFG }).post({ ...ITEM, authorName: 'Hudson Atwell' });
  assert.ok(statusOf(noHandle.calls).includes('Hudson Atwell'));
  const mem = fakeFetch();
  await createMastodonAdapter({ env: ENV, fetchImpl: mem.fetchImpl, cfg: syndicationConfigFromParsed({}) }).post({ ...ITEM, visibility: 'members' });
  assert.ok(/Members-only on the GBTI Network/i.test(statusOf(mem.calls)));
});

test('textOverride wins and the status truncates to 500', async () => {
  const a = fakeFetch();
  await createMastodonAdapter({ env: ENV, fetchImpl: a.fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'hand written' });
  assert.equal(statusOf(a.calls), 'hand written');
  const b = fakeFetch();
  await createMastodonAdapter({ env: ENV, fetchImpl: b.fetchImpl, cfg: CFG }).post({ ...ITEM, textOverride: 'z'.repeat(700) });
  assert.ok(statusOf(b.calls).length <= 500);
});

test('a non-ok response surfaces the Mastodon error, fail-closed', async () => {
  const { fetchImpl } = fakeFetch({ ok: false, error: 'Text character limit exceeded' });
  const r = await createMastodonAdapter({ env: ENV, fetchImpl, cfg: CFG }).post(ITEM);
  assert.equal(r.ok, false);
  assert.ok(/character limit/.test(r.error), r.error);
});
