// SOW-133: the Chrome Web Store publish flow (token exchange -> upload -> publish) with an injected fetch, and the
// clean skip when credentials are unset (so CI never hard-fails). Reads the real committed package from disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, compareVersions } from '../scripts/publish-cws.mjs';

// sow-239: the guard compares the PACKAGED manifest version against what the store item already holds, so
// the fixtures read the real manifest rather than hardcoding a number that goes stale at the next release.
const MANIFEST_VERSION = JSON.parse(fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../extension/manifest.json'), 'utf8')).version;
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
    [/chromewebstore\/v1\.1\/items\/[^/?]+\?projection=DRAFT/, json(200, { crxVersion: MANIFEST_VERSION })],
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
