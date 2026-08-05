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

// SOW-092 / sow-158: the /embed video relay removes the global CSP and resets a tighter one whose ONLY loosened
// directive admits the chrome-extension: scheme, so the Chrome extension can frame it (it cannot send YouTube an
// https referrer on its own). Two literal rules because trailingSlash 'ignore' serves /embed and /embed/ alike.
const EMBED_CSP = "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; frame-src https://www.youtube.com; frame-ancestors 'self' chrome-extension:; base-uri 'none'; object-src 'none'; form-action 'none'";
const embedRules = (headerName, csp = EMBED_CSP, extra = '') =>
  ['/embed', '/embed/*'].map((p) => `\n${p}\n  ! ${headerName}\n  ${headerName}: ${csp}\n${extra}`).join('');
const block = (headerName, csp = CSP, embed = EMBED_CSP, extra = '') =>
  `# comment ignored\n/*\n  ${headerName}: ${csp}\n\n/tools/email-signature-generator/*\n  ! ${headerName}\n  X-Frame-Options: SAMEORIGIN\n${embedRules(headerName, embed, extra)}`;

test('passes for a well-formed enforce CSP', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy'));
  const { errors, checked, notes } = checkHeaders({ root });
  assert.deepEqual(errors, []);
  assert.equal(checked, 3); // the /* policy + the two /embed relay policies
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
  assert.ok(errors.some((e) => /must be exactly 'self' or exactly 'none'/.test(e)));
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

// ---------------------------------------------------------------------------------------------------
// SOW-092 / sow-158: the /embed relay exemption. Asserted in BOTH directions, because dropping it silently
// re-breaks every in-extension video and widening it silently exposes signed-in pages to extension framing.
// ---------------------------------------------------------------------------------------------------

test('the REAL public/_headers passes the guard', () => {
  // Every other case here runs on a synthetic fixture, so nothing asserted the file we actually ship.
  const root = path.resolve(import.meta.dirname, '..');
  const { errors } = checkHeaders({ root, headersFile: path.join(root, 'public/_headers') });
  assert.deepEqual(errors, []);
});

test('the REAL public/_headers keeps the /embed relay framable by the extension', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const rules = parseHeaders(fs.readFileSync(path.join(root, 'public/_headers'), 'utf8'));
  for (const p of ['/embed', '/embed/']) {
    const csp = cspForPath(rules, p);
    assert.ok(csp, `${p} must resolve to a policy (the remove-and-reset must not collapse to none)`);
    assert.ok(parseCsp(csp).get('frame-ancestors').tokens.includes('chrome-extension:'), `${p} must admit chrome-extension:`);
  }
  // ...and every other page must NOT be framable cross-origin.
  assert.deepEqual(parseCsp(cspForPath(rules, '/account/')).get('frame-ancestors').tokens, ["'self'"]);
});

test('errors when the /embed rule is missing entirely', () => {
  const root = tmpRoot();
  writeHeaders(root, `# c\n/*\n  Content-Security-Policy: ${CSP}\n`);
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /missing the `\/embed` rule/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors when the /embed policy drops the chrome-extension source', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP, EMBED_CSP.replace(" chrome-extension:", '')));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /must include the `chrome-extension:` scheme source/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors when the /embed rule sets X-Frame-Options (SAMEORIGIN re-blocks the extension)', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP, EMBED_CSP, '  X-Frame-Options: SAMEORIGIN\n'));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /must not set X-Frame-Options/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors when the /embed policy admits a web origin instead of extensions only', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP, EMBED_CSP.replace("'self' chrome-extension:", "'self' chrome-extension: https://evil.com")));
  const { errors } = checkHeaders({ root });
  assert.ok(errors.some((e) => /must not admit a web origin/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

test('errors when a chrome-extension ancestor leaks onto the GLOBAL rule', () => {
  const root = tmpRoot();
  writeHeaders(root, block('Content-Security-Policy', CSP.replace("frame-ancestors 'self'", "frame-ancestors 'self' chrome-extension:")));
  const { errors } = checkHeaders({ root });
  // Caught twice on purpose: the global equality check and the only-/embed sweep.
  assert.ok(errors.some((e) => /must be exactly 'self' or exactly 'none'/.test(e)));
  assert.ok(errors.some((e) => /only the \/embed rules may admit a chrome-extension ancestor/.test(e)));
  fs.rmSync(root, { recursive: true, force: true });
});

// The old guard tested "contains 'self'", so both of these silently PASSED before.
for (const sneaky of ["frame-ancestors 'self' *.evil.com", "frame-ancestors 'self' data:"]) {
  test(`errors on a global ${sneaky}`, () => {
    const root = tmpRoot();
    writeHeaders(root, block('Content-Security-Policy', CSP.replace("frame-ancestors 'self'", sneaky)));
    const { errors } = checkHeaders({ root });
    assert.ok(errors.some((e) => /must be exactly 'self' or exactly 'none'/.test(e)));
    fs.rmSync(root, { recursive: true, force: true });
  });
}

test('cspForPath resolves a remove-and-reset in one block to the NEW value, not null', () => {
  // The earlier model returned null whenever a matching rule unset the header, which made check-csp
  // force-enforce nothing on /embed and skip the one policy it most needs to exercise.
  const rules = parseHeaders(block('Content-Security-Policy'));
  const csp = cspForPath(rules, '/embed/?u=x'.split('?')[0]);
  assert.ok(csp && csp.includes('chrome-extension:'));
  // An unset with NO replacement still resolves to none.
  assert.equal(cspForPath(rules, '/tools/email-signature-generator/index.html'), null);
});
