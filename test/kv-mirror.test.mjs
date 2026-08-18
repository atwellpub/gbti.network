// SOW-015: the overrides-to-KV mirror written by the reconcile (so GET /membership/key can apply ban/staff/
// grandfather server-side). Verifies the blob shape, the no-credentials no-op, a successful PUT, and that an
// API error throws (so the reconcile fails the run). Injected fetch: no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOverridesMirror, mirrorOverridesToKv, OVERRIDES_KV_KEY, mirrorSyndicationConfigToKv,
  buildContentChannelsMirror, mirrorContentChannelsToKv, mirrorTopicsToKv, CONTENT_CHANNELS_KV_KEY, TOPICS_KV_KEY,
} from '../scripts/lib/kv-mirror.mjs';

const raw = { roles: { admins: [{ github_id: '4' }] }, bans: { bans: [{ github_id: '7' }] }, grandfathered: { grandfathered: [] } };
const NOW = new Date('2026-06-06T00:00:00Z');

test('buildOverridesMirror carries roles/bans/grandfathered + a generatedAt stamp', () => {
  const blob = buildOverridesMirror(raw, NOW);
  assert.equal(blob.generatedAt, '2026-06-06T00:00:00.000Z');
  assert.deepEqual(blob.roles, raw.roles);
  assert.deepEqual(blob.bans, raw.bans);
  assert.deepEqual(blob.grandfathered, raw.grandfathered);
});

test('buildOverridesMirror defaults missing files to empty objects', () => {
  const blob = buildOverridesMirror({}, NOW);
  assert.deepEqual(blob.roles, {});
  assert.deepEqual(blob.bans, {});
  assert.deepEqual(blob.grandfathered, {});
});

test('no-op (not written) when Cloudflare credentials are absent', async () => {
  const r = await mirrorOverridesToKv({ raw, env: {}, now: NOW, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

// sow-213 Phase 2: the writer now READS the current blob before it writes, so the merge has something to
// preserve. The fakes below model that read; the assertions about the PUT are unchanged.
const ENV = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
/** A fetch fake that answers the GET with `current` and records the PUT. */
function kvFake(current, { putStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (opts.method === 'PUT') return { ok: putStatus < 400, status: putStatus, text: async () => 'err' };
    if (current === undefined) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => current };
  };
  return { fetchImpl, calls, put: () => calls.find((c) => c.opts.method === 'PUT') };
}

test('PUTs the blob to the KV REST API with bearer auth when configured', async () => {
  const f = kvFake(undefined); // 404: the legitimate first write
  const r = await mirrorOverridesToKv({ raw, env: ENV, now: NOW, fetchImpl: f.fetchImpl });
  assert.equal(r.written, true);
  const put = f.put();
  assert.match(put.url, /accounts\/acc\/storage\/kv\/namespaces\/ns\/values\/overrides%3Amirror$/);
  assert.equal(put.opts.method, 'PUT');
  assert.equal(put.opts.headers.Authorization, 'Bearer tok');
  const sent = JSON.parse(put.opts.body);
  assert.equal(sent.generatedAt, '2026-06-06T00:00:00.000Z');
  assert.deepEqual(sent.bans, raw.bans);
});

test('sow-213: a KV-NATIVE ban SURVIVES the git-sourced sync', async () => {
  // The whole point of Phase 2. Before this, the 6-hourly cron rebuilt the blob from git and erased any ban
  // written straight to KV: the ban worked, then quietly stopped within six hours, in the permissive
  // direction, with nothing reporting it.
  const current = { generatedAt: 'x', roles: {}, bans: { bans: [{ github_id: '99', source: 'kv' }] }, grandfathered: { grandfathered: [] } };
  const f = kvFake(current);
  await mirrorOverridesToKv({ raw, env: ENV, now: NOW, fetchImpl: f.fetchImpl });
  const sent = JSON.parse(f.put().opts.body);
  const ids = sent.bans.bans.map((e) => String(e.github_id));
  assert.ok(ids.includes('99'), 'the KV-native ban must survive');
  assert.ok(ids.includes('7'), 'the git-sourced ban is still there');
});

test('sow-213: an UNBAN in git still takes effect (the fix must not trade one silent failure for another)', async () => {
  // A stale copy of a git entry, NOT marked source:'kv', must be dropped. Otherwise unbanning someone in git
  // would silently fail to unban them, which is the same class of bug pointing the other way.
  const current = { generatedAt: 'x', roles: {}, bans: { bans: [{ github_id: '12345' }] }, grandfathered: { grandfathered: [] } };
  const f = kvFake(current);
  await mirrorOverridesToKv({ raw, env: ENV, now: NOW, fetchImpl: f.fetchImpl });
  const ids = JSON.parse(f.put().opts.body).bans.bans.map((e) => String(e.github_id));
  assert.ok(!ids.includes('12345'), 'an unmarked stale entry is dropped, so a git unban is effective');
});

test('sow-213: a READ failure ABORTS the write rather than overwriting an unknown ban list', async () => {
  // Proceeding blind here is precisely the erase this change exists to prevent. A skipped sync is absorbed by
  // the Worker's 48h window and then fails closed; a blind overwrite looks like success.
  const fetchImpl = async (_u, opts = {}) => (opts.method === 'PUT' ? { ok: true, status: 200 } : { ok: false, status: 500 });
  await assert.rejects(
    mirrorOverridesToKv({ raw, env: ENV, now: NOW, fetchImpl }),
    /refusing to overwrite an unknown ban list/,
  );
});

test('throws on an API error so the reconcile fails the run', async () => {
  // The GET succeeds (404, first write); the PUT is what fails, which is what this test is about.
  const f = kvFake(undefined, { putStatus: 403 });
  await assert.rejects(mirrorOverridesToKv({ raw, env: ENV, now: NOW, fetchImpl: f.fetchImpl }), /KV mirror write failed: 403/);
});

// SOW-058: the syndication-config mirror (so the drain reads house/syndication-config.yml live).
test('mirrorSyndicationConfigToKv is a no-op without CF creds', async () => {
  const r = await mirrorSyndicationConfigToKv({ raw: { syndication: { enabled: true } }, env: {}, fetchImpl: async () => { throw new Error('should not be called'); } });
  assert.equal(r.written, false);
  assert.match(r.reason, /CF_ACCOUNT_ID/);
});

test('mirrorSyndicationConfigToKv PUTs the normalized config (incl require_approval) to synd:config', async () => {
  let captured;
  const fetchImpl = async (url, opts) => { captured = { url, opts }; return { ok: true, status: 200 }; };
  const env = { CF_ACCOUNT_ID: 'acc', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };
  const r = await mirrorSyndicationConfigToKv({ raw: { syndication: { enabled: true, channels: { discord: true } } }, env, fetchImpl });
  assert.equal(r.written, true);
  assert.match(captured.url, /values\/synd%3Aconfig$/);
  const sent = JSON.parse(captured.opts.body);
  assert.equal(sent.require_approval, true); // the gate is carried into the mirror, defaulting safe
  assert.equal(sent.enabled, true);
  assert.equal(sent.channels.discord, true);
});

test('OVERRIDES_KV_KEY matches the Worker endpoint key', () => {
  assert.equal(OVERRIDES_KV_KEY, 'overrides:mirror');
});

// ---- SOW-087: the content-channels + topics mirrors ----

test('buildContentChannelsMirror wraps the channels list with a generatedAt stamp', () => {
  const m = buildContentChannelsMirror({ channels: [{ category: 'devops', channelId: '7' }] }, new Date('2026-07-04T00:00:00Z'));
  assert.deepEqual(m, { generatedAt: '2026-07-04T00:00:00.000Z', channels: [{ category: 'devops', channelId: '7' }] });
  assert.deepEqual(buildContentChannelsMirror(null).channels, []);
});

test('mirrorContentChannelsToKv PUTs to synd:channels; mirrorTopicsToKv PUTs the clean vocabulary to topics:vocab', async () => {
  const puts = [];
  const fetchImpl = async (url, opts) => { puts.push({ url, body: opts.body }); return { ok: true }; };
  const env = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };
  const r1 = await mirrorContentChannelsToKv({ raw: { channels: [{ category: 'ai', channelId: '5' }] }, env, fetchImpl });
  assert.equal(r1.written, true);
  assert.equal(r1.key, CONTENT_CHANNELS_KV_KEY);
  assert.ok(puts[0].url.includes(encodeURIComponent('synd:channels')));
  assert.deepEqual(JSON.parse(puts[0].body).channels, [{ category: 'ai', channelId: '5' }]);
  const r2 = await mirrorTopicsToKv({ raw: { topics: { ai: { label: 'AI' } } }, env, fetchImpl });
  assert.equal(r2.written, true);
  assert.equal(r2.key, TOPICS_KV_KEY);
  assert.deepEqual(JSON.parse(puts[1].body).topics, { ai: { label: 'AI' } });
});

test('the SOW-087 mirrors are creds-gated no-ops without CF credentials', async () => {
  const r1 = await mirrorContentChannelsToKv({ raw: { channels: [] }, env: {}, fetchImpl: async () => { throw new Error('never'); } });
  assert.equal(r1.written, false);
  const r2 = await mirrorTopicsToKv({ raw: {}, env: {}, fetchImpl: async () => { throw new Error('never'); } });
  assert.equal(r2.written, false);
});
