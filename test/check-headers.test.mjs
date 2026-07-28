// sow-158 security-prerequisite #1: the CSP headers guard. Exercises the _headers parser + the well-formedness /
// required-directive / locked-token checks against a temp dist, in both Report-Only and enforce phases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkHeaders, parseHeaders, parseCsp, cspForPath } from '../scripts/check-headers.mjs';

const CSP = "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; font-src 'self' data:; connect-src 'self' https://signup.gbti.network; frame-src 'self' https://challenges.cloudflare.com https://www.youtube.com; form-action 'self' https://signup.gbti.network; upgrade-insecure-requests";

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-headers-'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  return root;
}
const writeHeaders = (root, body) => fs.writeFileSync(path.join(root, 'dist/_headers'), body);
const block = (headerName, csp = CSP) =>
  `# comment ignored\n/*\n  ${headerName}: ${csp}\n\n/tools/email-signature-generator/*\n  ! ${headerName}\n  X-Frame-Options: SAMEORIGIN\n`;

test('passes for a well-formed enforce CSP', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy'));
  const { errors, checked, notes } = checkHeaders({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
  assert.ok(notes.some((n) => /ENFORCE/.test(n)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('passes for a well-formed Report-Only CSP (both header names accepted)', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy-Report-Only'));
  const { errors, notes } = checkHeaders({ root });
  assert.deepEqual(errors, []);
  assert.ok(notes.some((n) => /Report-Only/.test(n)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors when dist/_headers is missing but dist exists (public/_headers did not copy)', () => {
  const root = tmpRoot();
  const { errors } = checkHeaders({ root });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /did not copy|missing/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('notes (no error) when dist/ is absent (pre-build)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-headers-'));
  const { errors, notes } = checkHeaders({ root });
  assert.deepEqual(errors, []);
  assert.ok(notes.some((n) => /dist\/ not found/.test(n)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors on a missing required directive', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP.replace("frame-ancestors 'self'; ", '')));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /missing required CSP directive: frame-ancestors/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test("frame-ancestors 'self' passes; a permissive value errors", () => {
  const okRoot = tmpRoot();
  writeHeaders(okRoot, block('Content-Security-Policy')); // CSP uses frame-ancestors 'self'
  assert.deepEqual(checkHeaders({ root: okRoot }).errors, []);
  fs.rmSync(okRoot, { recursive: true, force: true });

  const badRoot = tmpRoot();
  writeHeaders(badRoot, block('Content-Security-Policy', CSP.replace("frame-ancestors 'self'", 'frame-ancestors *')));
  const { errors } = checkHeaders({ root: badRoot });
  assert.ok(errors.some((e) => /frame-ancestors must be 'self' or 'none'/.test(e)));
  fs.rmSync(badRoot, { recursive: true, force: true });
});

test('errors when connect-src omits the signup Worker', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP.replace(' https://signup.gbti.network', '')));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /connect-src must include signup\.gbti\.network/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors on a duplicate directive', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP + "; script-src 'self'"));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /duplicate CSP directive: script-src/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('cspForPath applies the /* policy to a page and unsets it on the eval-tool subtree', () => {
  const rules = parseHeaders(block('Content-Security-Policy'));
  assert.ok(cspForPath(rules, '/articles/foo/').includes("frame-ancestors 'self'"));
  assert.equal(cspForPath(rules, '/tools/email-signature-generator/index.html'), null);
});

test('parseCsp splits directives and flags duplicates', () => {
  const d = parseCsp("default-src 'self'; img-src 'self' https:; default-src 'none'");
  assert.deepEqual(d.get('img-src').tokens, ["'self'", 'https:']);
  assert.equal(d.get('default-src').duplicate, true);
});
