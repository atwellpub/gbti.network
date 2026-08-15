// SOW-133: the Chrome Web Store publish flow (token exchange -> upload -> publish) with an injected fetch, and the
// clean skip when credentials are unset (so CI never hard-fails). Reads the real committed package from disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, compareVersions, zipManifestVersion, decidePublish } from '../scripts/publish-cws.mjs';

// sow-239/240: the guard compares the version INSIDE THE ZIP against what the store item holds, so the
// fixtures read the real artifact rather than hardcoding a number that goes stale at the next release.
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP_VERSION = zipManifestVersion(fs.readFileSync(path.join(ROOT, 'public/extension/gbti-network-extension.zip')));
const MANIFEST_VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version;
const ITEM_OLDER = [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, { ok: true, status: 200, json: async () => ({ crxVersion: '0.0.1' }) }];

const CREDS = { CWS_CLIENT_ID: 'id', CWS_CLIENT_SECRET: 'sec', CWS_REFRESH_TOKEN: 'ref' };
const json = (status, body) => ({ ok: status < 400, status, json: async () => body });

function fakeFetch(handlers) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, method: opts?.method });
    for (const [re, resp] of handlers) if (re.test(url)) return resp;
    throw new Error(`unexpected url ${url}`);
  };
  return { fetchImpl, calls };
}

test('publish-cws skips cleanly (no network) when credentials are unset', async () => {
  const { fetchImpl, calls } = fakeFetch([]);
  const r = await main({ env: {}, fetchImpl });
  assert.equal(r.skipped, true);
  assert.equal(calls.length, 0);
});

test('publish-cws --check exchanges the token and stops (no upload or publish)', async () => {
  const { fetchImpl, calls } = fakeFetch([[/oauth2\.googleapis/, json(200, { access_token: 'tok' })]]);
  const r = await main({ env: CREDS, fetchImpl, checkOnly: true });
  assert.equal(r.checked, true);
  assert.equal(calls.length, 1);
});

test('publish-cws uploads then publishes with a valid token', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
    [/items\/[^/]+\/publish/, json(200, { status: ['OK'] })],
  ]);
  const r = await main({ env: CREDS, fetchImpl });
  assert.equal(r.published, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT', 'POST']); // token, item version, upload, publish
});

test('publish-cws --upload-only uploads but does not publish', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
  ]);
  const r = await main({ env: CREDS, fetchImpl, uploadOnly: true });
  assert.equal(r.uploaded, true);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT']);
});

test('publish-cws throws a clear error on an upload failure', async () => {
  const { fetchImpl } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    ITEM_OLDER,
    [/upload\/chromewebstore/, json(200, { uploadState: 'FAILURE', itemError: [{ error_detail: 'bad zip' }] })],
  ]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /upload failed: bad zip/);
});

test('publish-cws throws when the OAuth token exchange fails', async () => {
  const { fetchImpl } = fakeFetch([[/oauth2\.googleapis/, json(400, { error: 'invalid_grant', error_description: 'expired' })]]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /token exchange failed/);
});

// sow-239. The expensive lesson: v0.2.0 sat on the store item while 83 commits landed under that unchanged
// number, so the next publish would have been rejected by Google with a message about versions rather than
// about the real problem. These assert our own tooling refuses FIRST, with a message that names the fix.
test('publish-cws REFUSES to upload a version the item already holds (sow-239)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(200, { crxVersion: ZIP_VERSION })],
  ]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /already holds .* strictly greater version/s);
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET'], 'it must refuse BEFORE spending the upload');
});

test('publish-cws refuses a LOWER version too, not just an equal one (sow-239)', async () => {
  const { fetchImpl } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(200, { crxVersion: '99.0.0' })],
  ]);
  await assert.rejects(() => main({ env: CREDS, fetchImpl }), /already holds 99\.0\.0/);
});

// FAILS OPEN on an unreadable item version: a read failure must never block a legitimate release.
test('publish-cws proceeds when the item version cannot be read (sow-239, fails open)', async () => {
  const { fetchImpl, calls } = fakeFetch([
    [/oauth2\.googleapis/, json(200, { access_token: 'tok' })],
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(500, { error: { message: 'boom' } })],
    [/upload\/chromewebstore/, json(200, { uploadState: 'SUCCESS' })],
    [/items\/[^/]+\/publish/, json(200, { status: ['OK'] })],
  ]);
  const r = await main({ env: CREDS, fetchImpl });
  assert.equal(r.published, true, 'an unreadable item version must not block the release');
  assert.deepEqual(calls.map((c) => c.method), ['POST', 'GET', 'PUT', 'POST']);
});

test('compareVersions orders X.Y.Z correctly', () => {
  assert.equal(compareVersions('0.3.0', '0.2.0'), 1);
  assert.equal(compareVersions('0.2.0', '0.3.0'), -1);
  assert.equal(compareVersions('0.3.0', '0.3.0'), 0);
  assert.equal(compareVersions('0.10.0', '0.9.0'), 1, 'numeric, not lexicographic');
  assert.equal(compareVersions('1.0.0', '0.99.99'), 1);
});

// sow-240. The guard used to read extension/manifest.json while uploadPackage sent the ZIP, so the two could
// diverge and a STALE package would ship under a fresh number. Reachable path, verified: release.mjs checks
// `--no-build` and `--publish` independently, so `npm run release -- minor --no-build --publish` bumps the
// manifest, skips the rebuild AND check-extension, then publishes.
test('the shipped version is read from the ZIP, which is what actually gets uploaded (sow-240)', () => {
  const zipBuf = fs.readFileSync(path.join(ROOT, 'public/extension/gbti-network-extension.zip'));
  assert.match(zipManifestVersion(zipBuf) || '', /^\d+\.\d+\.\d+$/, 'the committed zip must carry a real version');
  assert.equal(zipManifestVersion(zipBuf), MANIFEST_VERSION,
    'the committed zip and the manifest must agree; if this fails, the artifacts are stale, which is the defect');
  assert.equal(zipManifestVersion(Buffer.from('not a zip')), null, 'an unreadable zip yields null rather than throwing');
});

// sow-240, the PURE gate. Every branch, no zip and no network, so each of these can genuinely fail.
test('decidePublish REFUSES a zip that disagrees with the manifest (the skipped-build case)', () => {
  const d = decidePublish({ zip: '0.2.0', manifest: '0.4.0', item: '0.1.0' });
  assert.equal(d.ok, false);
  assert.match(d.error, /package is 0\.2\.0 but extension\/manifest\.json is 0\.4\.0/);
  assert.match(d.error, /build was skipped/);
});

test('decidePublish REFUSES a version the item already holds, and a lower one', () => {
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '0.2.0' }).ok, false);
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '9.0.0' }).ok, false);
  assert.match(decidePublish({ zip: '0.2.0', manifest: '0.2.0', item: '0.2.0' }).error, /strictly greater/);
});

test('decidePublish PERMITS a strictly greater version', () => {
  const d = decidePublish({ zip: '0.3.0', manifest: '0.3.0', item: '0.2.0' });
  assert.equal(d.ok, true);
  assert.match(d.note, /item holds 0\.2\.0, shipping 0\.3\.0/);
});

test('decidePublish FAILS OPEN when the item version is unreadable, but NOT past the manifest check', () => {
  assert.equal(decidePublish({ zip: '0.3.0', manifest: '0.3.0', item: null }).ok, true, 'unreadable item must not block');
  assert.equal(decidePublish({ zip: null, manifest: '0.3.0', item: '0.2.0' }).ok, true, 'unreadable zip must not block');
  // ...but a KNOWN divergence still refuses even when the item is unreadable: the stale-build case is local.
  assert.equal(decidePublish({ zip: '0.2.0', manifest: '0.4.0', item: null }).ok, false,
    'a stale package is a local fact and does not need the store to confirm it');
});

test('the committed zip and the manifest agree today (if this fails, the artifacts are stale)', () => {
  const zipBuf = fs.readFileSync(path.join(ROOT, 'public/extension/gbti-network-extension.zip'));
  assert.equal(zipManifestVersion(zipBuf), MANIFEST_VERSION);
  assert.equal(zipManifestVersion(Buffer.from('not a zip')), null, 'an unreadable zip yields null rather than throwing');
});
