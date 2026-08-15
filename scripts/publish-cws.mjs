// SOW-133: publish the extension to the Chrome Web Store via the Publish API, so a new BUILD ships without the
// dashboard. This uploads the packaged zip (public/extension/gbti-network-extension.zip) to the existing item and
// publishes it. It is INERT until the owner provisions the OAuth credentials (see .data/ops/extension-ops/
// chrome-web-store.md): a missing credential is a clean skip, never a hard failure in CI.
//
// The API does NOT manage the store LISTING (screenshots, marquee, description, privacy) — those stay dashboard
// only. This script only pushes the code package + flips it to published.
//
// Credentials (env, never committed): CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN. CWS_APP_ID defaults to
// the live item id. Optional: CWS_PUBLISH_TARGET (default 'default' = everyone; 'trustedTesters' for a draft).
//
// Usage:
//   node scripts/publish-cws.mjs            # upload + publish (skips cleanly if creds are unset)
//   node scripts/publish-cws.mjs --check    # only verify creds + the zip; do not upload or publish
//   node scripts/publish-cws.mjs --upload-only   # upload the new package but do NOT publish (review it first)
//
// No SDK: plain fetch against the documented endpoints, matching the repo's injectable-fetch client style.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'public/extension/gbti-network-extension.zip');
const DEFAULT_APP_ID = 'iffjdmifgnjgkdjoodapjciddibmifka'; // the live GBTI Network Extension item

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const UPLOAD_ONLY = args.has('--upload-only');

function env(name) { const v = process.env[name]; return typeof v === 'string' && v.trim() ? v.trim() : ''; }

async function accessTokenFrom({ clientId, clientSecret, refreshToken, fetchImpl }) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`OAuth token exchange failed (${res.status}): ${body.error_description || body.error || 'no access_token'}`);
  return body.access_token;
}


/** Semver compare for X.Y.Z: 1 when a > b, -1 when a < b, 0 when equal. Non-numeric segments sort as 0. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The version currently sitting on the store item (the DRAFT projection, so it reflects an upload that has
 *  not cleared review yet). Returns null when the API does not report one; a missing value must NOT block. */
async function itemVersion({ appId, token, fetchImpl }) {
  const res = await fetchImpl(`https://www.googleapis.com/chromewebstore/v1.1/items/${appId}?projection=DRAFT`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return null; // read failure is not a publish failure: fall through and let the upload answer
  return typeof body.crxVersion === 'string' && body.crxVersion ? body.crxVersion : null;
}

/** The version we are about to ship, read from the manifest that was packaged. */
function localVersion() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'extension/manifest.json'), 'utf8')).version || null; }
  catch { return null; }
}

async function uploadPackage({ appId, token, zipBuf, fetchImpl }) {
  const res = await fetchImpl(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${appId}?uploadType=media`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    body: zipBuf,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.uploadState === 'FAILURE') {
    const detail = (body.itemError || []).map((e) => e.error_detail).join('; ') || body.error?.message || `status ${res.status}`;
    throw new Error(`Chrome Web Store upload failed: ${detail}`);
  }
  return body; // { uploadState: 'SUCCESS' | 'IN_PROGRESS', ... }
}

async function publishItem({ appId, token, target, fetchImpl }) {
  const res = await fetchImpl(`https://www.googleapis.com/chromewebstore/v1.1/items/${appId}/publish?publishTarget=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Length': '0' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Chrome Web Store publish failed (${res.status}): ${(body.error?.message) || JSON.stringify(body).slice(0, 200)}`);
  return body; // { status: ['OK'] | ['ITEM_PENDING_REVIEW'], statusDetail: [...] }
}

export async function main({ env: e = process.env, fetchImpl = globalThis.fetch, checkOnly = CHECK_ONLY, uploadOnly = UPLOAD_ONLY } = {}) {
  const clientId = (e.CWS_CLIENT_ID || '').trim();
  const clientSecret = (e.CWS_CLIENT_SECRET || '').trim();
  const refreshToken = (e.CWS_REFRESH_TOKEN || '').trim();
  const appId = (e.CWS_APP_ID || '').trim() || DEFAULT_APP_ID;
  const target = (e.CWS_PUBLISH_TARGET || '').trim() || 'default';

  if (!fs.existsSync(ZIP)) { console.error(`publish-cws: missing package ${path.relative(ROOT, ZIP)} (run \`npm run build:extension\` first).`); process.exit(1); }

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('publish-cws: Chrome Web Store credentials are not set (CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN); skipping. Publish manually from the dashboard, or provision the creds (see .data/ops/extension-ops/chrome-web-store.md).');
    return { skipped: true };
  }

  const zipBuf = fs.readFileSync(ZIP);
  console.log(`publish-cws: item ${appId}, package ${(zipBuf.length / 1024).toFixed(0)} KB, target ${target}${uploadOnly ? ' (upload only)' : ''}${checkOnly ? ' (check only)' : ''}.`);

  const token = await accessTokenFrom({ clientId, clientSecret, refreshToken, fetchImpl });
  if (checkOnly) { console.log('publish-cws: credentials valid and package present. No upload/publish performed (--check).'); return { ok: true, checked: true }; }

  // sow-239: REFUSE a version the item already holds, before spending an upload on a Google-side rejection.
  // The store requires each upload to carry a STRICTLY GREATER version. We learned this the expensive way:
  // v0.2.0 sat on the item while 83 commits landed under that unchanged number, so the next publish would
  // have been rejected with a message about versions rather than about the real problem, which is that a
  // release stopped re-asserting its label. This check is deliberately HERE and not in CI: "source changed
  // without a version bump" is the NORMAL state during development, so a CI guard would either red main
  // constantly or need an arbitrary threshold. The publish call is the one moment the version is genuinely
  // required to be correct. Fails OPEN on an unreadable item version: a read failure must not block a release.
  const local = localVersion();
  const onItem = await itemVersion({ appId, token, fetchImpl });
  if (local && onItem) {
    if (compareVersions(local, onItem) <= 0) {
      throw new Error(
        `refusing to upload: the store item already holds ${onItem} and this package is ${local}. ` +
        'The store requires a strictly greater version per upload. Run `npm run release -- minor` ' +
        '(from a worktree at origin), commit, then dispatch again.',
      );
    }
    console.log(`publish-cws: item holds ${onItem}, shipping ${local}.`);
  } else if (!onItem) {
    console.log('publish-cws: could not read the version on the item; proceeding and letting the upload decide.');
  }

  const up = await uploadPackage({ appId, token, zipBuf, fetchImpl });
  console.log(`publish-cws: uploaded (uploadState=${up.uploadState || 'unknown'}).`);
  if (uploadOnly) { console.log('publish-cws: --upload-only, not publishing. Review the draft in the dashboard, then publish.'); return { ok: true, uploaded: true }; }

  const pub = await publishItem({ appId, token, target, fetchImpl });
  const status = Array.isArray(pub.status) ? pub.status.join(', ') : String(pub.status ?? 'unknown');
  console.log(`publish-cws: publish requested (status=${status}). A code change may re-enter review; the listing updates once it clears.`);
  return { ok: true, published: true, status };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((r) => { if (r?.skipped) process.exit(0); }).catch((err) => { console.error(`publish-cws: ${err.message}`); process.exit(1); });
}
