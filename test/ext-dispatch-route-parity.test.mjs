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
//
// TRANSITIONAL (sow-204, sequenced with sow-200): the "route parity" test below is valid ONLY while the two
// hosts are meant to match. sow-204 deliberately makes authoring website-only and removes ~27 authoring routes
// from the extension, so parity STOPS being the invariant. When that lands, this diff test must be reshaped
// into a host-responsibility MANIFEST (a declared per-host route set with a reason for each, rather than a
// symmetry check with a 27-entry allowlist, which would assert nothing). Do that reshape in sow-204's plan
// mode with the owner; do NOT read the parity assertion here as a permanent contract. The SECOND test in this
// file, the pre-auth positioning invariant, is NOT transitional: it is the removal-safety guardrail that must
// keep holding as routes are deleted, because ext-dispatch encodes authorization by position.

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

// sow-200 (option 1, owner-elected 2026-08-09): the SOW proposed a full shared route manifest so that pre-auth
// status stops being encoded by LINE ORDER. The owner elected the lighter path instead: keep the two dispatchers
// as-is (their difference is a load-bearing auth boundary, not a style inconsistency, see the SOW caution) and
// convert the line-order invariant into a TESTED one here, closing the full-manifest scope. This is the one
// hazard the route-parity guard above does not touch.
//
// In ext-dispatch.mjs, POSITION ENCODES AUTHORIZATION: a route handled ABOVE the `if (!username)` identity gate
// runs pre-auth (public); a `case` in the switch below the gate runs only for a signed-in caller. A public route
// placed below the gate breaks signed-out users, which actually happened (ext-dispatch :87-91: a signed-out
// member got a 409 and the onboarding wizard dead-ended). This test pins which routes are public.
const PRE_AUTH = new Set([
  '/api/status',              // the identity/membership probe that DRIVES the sign-in state
  '/api/onboarding-status',   // SOW-026: drives the first-run sign-in step; must answer before sign-in
  // SOW-079/087: the admin MANAGER reads are public git-native data (house/*.yml), so they load tokenless.
  '/api/taxonomy', '/api/news-source-pool', '/api/quote-pool',
  // sow-259: the word-of-the-day pool joins them. Gating it would protect nothing that is not already public:
  // the same pool ships as a CDN artifact at /words.json on the static site, which is how the homepage rail card
  // reads it. It is curated config in a public repo with no personal data in it.
  '/api/word-pool',
  '/api/content-channel-pool', '/api/moderation-flag-pool', '/api/syndication-template-pool',
  '/api/coupon-pool', '/api/news-engagement', '/api/content-engagement', '/api/syndication-settings',
]);

test('pre-auth positioning: the routes above the ext-dispatch identity gate are EXACTLY the declared pre-auth set', () => {
  const src = readFileSync(join(ROOT, 'extension/src/ext-dispatch.mjs'), 'utf8');
  const lines = src.split('\n');
  const gate = lines.findIndex((l) => /if\s*\(\s*!username\s*\)/.test(l));
  assert.ok(gate > 0, 'could not locate the identity gate (if (!username)) in ext-dispatch.mjs');

  // Pre-auth handlers use `if (pathname === '/api/x')`; gated routes use `case '/api/x'` in the switch below the
  // gate. Match the handler form (not a bare literal), so a comment that merely names a route path above the gate
  // is not counted as a handler.
  const handlers = [];
  lines.forEach((line, i) => {
    const m = line.match(/pathname === ['"](\/api\/[a-zA-Z0-9/_-]+)['"]/);
    if (m) handlers.push({ route: m[1], line: i });
  });
  const above = [...new Set(handlers.filter((h) => h.line < gate).map((h) => h.route))].sort();
  const below = handlers.filter((h) => h.line > gate).map((h) => h.route);

  // A pre-auth-style handler below the gate is the exact :87-91 defect: a route meant to be public that a
  // signed-out caller can no longer reach.
  assert.deepEqual(below, [], `pathname=== handlers found BELOW the identity gate: [${below.join(', ')}]. A public route placed below the gate breaks signed-out users (ext-dispatch :87-91). Move it above the gate.`);

  // The set above the gate must be EXACTLY the declared pre-auth set. Adding a route above without declaring it,
  // or dropping a declared pre-auth route below the gate, fails here, so "public vs gated" is a written, tested
  // decision instead of an implicit line number.
  assert.deepEqual(above, [...PRE_AUTH].sort(), 'the routes above the ext-dispatch identity gate no longer match the declared PRE_AUTH set. If you intend to change what is public, update PRE_AUTH deliberately (with a reason); never move a route across the gate as a side effect of a refactor.');
});
