// sow-106 follow-up: ROUTE-SET PARITY between the two API routers, the extension host
// (extension/src/ext-dispatch.mjs, which routes with `case '/api/x'`) and the website/npm host
// (client/src/api.mjs, which routes with `if (pathname === '/api/x')`). This bug class has produced four live
// defects, each because a route existed in one router and not the other and nothing compared them: Unpublish/
// Republish (/api/content/status), comment delete (/api/comment/delete), and image staging (/api/image).
//
// The extraction is the load-bearing part. A naive per-syntax regex (match only `case '...'`, or only
// `pathname === '...'`) reports dozens of false "missing" routes because each file uses ONLY its own syntax,
// which is the trap that produced a 56-false-positive parity run during this SOW. Instead we extract every
// '/api/...' STRING LITERAL from BOTH files: both routers name the route as the same literal, so this catches
// both syntaxes and matches the real route count (68 each at the time of writing).
//
// The allowlist is the point of the guard, not an afterthought: an intentional host asymmetry MUST be written
// down here WITH a reason, or the guard turns the next silent divergence into a red build.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Every distinct '/api/...' path literal referenced in a source file. Both routers name their route as a
 *  string literal, so this catches `case '/api/x'` AND `if (pathname === '/api/x')` alike (single or double
 *  quoted). Re-derived from the files at test time, never hardcoded, so it cannot pass stale. */
function routeSet(relPath) {
  const src = readFileSync(join(ROOT, relPath), 'utf8');
  const set = new Set();
  for (const m of src.matchAll(/['"](\/api\/[a-zA-Z0-9/_-]+)['"]/g)) set.add(m[1]);
  return set;
}

// The ONLY intentional host asymmetries, each with a reason. Adding a route to one host but not the other fails
// this test until the route is mirrored or listed here deliberately.
const API_ONLY = new Map([
  ['/api/settings', 'npm CMS host only: it manages the node autostart (peg-startup), a filesystem feature the extension does not have (sow-036). The ops live in client/src/settings-ops.mjs, absent from ext-dispatch and operations.mjs.'],
]);
const EXT_ONLY = new Map([
  ['/api/discord-link', 'extension welcome flow only (gbti-welcome mints the one-time Discord-link URL). api.mjs does not import the op; the only other consumer, gbti-syndicate-now, calls it optional-chained and degrades to no @mention preview.'],
  ['/api/discord-link/status', 'extension welcome flow only: the linked-yet poll, paired with /api/discord-link.'],
]);

test('route parity: ext-dispatch and api.mjs expose the same /api routes, except the documented allowlist', () => {
  const ext = routeSet('extension/src/ext-dispatch.mjs');
  const api = routeSet('client/src/api.mjs');

  // Sanity: the extraction found real route sets, not zero (a broken regex would pass every assertion below).
  assert.ok(ext.size > 40 && api.size > 40, `route extraction looks broken: ext=${ext.size} api=${api.size}`);

  const unlistedApiOnly = [...api].filter((r) => !ext.has(r) && !API_ONLY.has(r)).sort();
  const unlistedExtOnly = [...ext].filter((r) => !api.has(r) && !EXT_ONLY.has(r)).sort();

  assert.deepEqual(unlistedApiOnly, [], `routes in api.mjs (website/npm) but NOT ext-dispatch (extension), and not allowlisted: [${unlistedApiOnly.join(', ')}]. Add the case to extension/src/ext-dispatch.mjs, or list it in API_ONLY with a reason.`);
  assert.deepEqual(unlistedExtOnly, [], `routes in ext-dispatch (extension) but NOT api.mjs (website/npm), and not allowlisted: [${unlistedExtOnly.join(', ')}]. Add it to client/src/api.mjs, or list it in EXT_ONLY with a reason.`);

  // Keep the allowlist honest: an entry that is no longer actually an asymmetry (both hosts have it now, or
  // neither does) is a dead exception and must be removed, so the list never accretes stale entries.
  for (const r of API_ONLY.keys()) assert.ok(api.has(r) && !ext.has(r), `stale API_ONLY entry ${r}: it is no longer api-only. Remove it from the allowlist.`);
  for (const r of EXT_ONLY.keys()) assert.ok(ext.has(r) && !api.has(r), `stale EXT_ONLY entry ${r}: it is no longer ext-only. Remove it from the allowlist.`);
});
