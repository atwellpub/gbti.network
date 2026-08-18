// The secret guard's first tests. It has run in .githooks/pre-commit, `npm run check:secrets` and
// .github/workflows/secret-scan.yml since it was written, with no test at all, so the only evidence it
// worked was that it reported nothing. That is indistinguishable from a guard that cannot see.
//
// WHAT THESE PROVE, and it is deliberately the wiring and not only the matcher: images were skipped
// ENTIRELY by the walk (it read a fixed list of text extensions), so a matcher test alone would have passed
// happily while every image went unexamined. scanTree() takes an injectable root for exactly that reason.
//
// THE FIXTURES ARE BUILT AT RUNTIME AND NEVER COMMITTED. A fixture image carrying a credential-shaped string
// would be scanned by this very guard and would red the build, so a committed fixture is not an option here.
// They are planted into a temp tree instead, which also keeps the test out of the shared checkout.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { findingsInImageBuffer, scanTree, PATTERNS } from '../scripts/check-no-secrets.mjs';

// Fake, and shaped to match the patterns under test. BOTH are assembled at runtime rather than written as
// literals, because this file is itself scanned by the guard: the first version spelled the PEM header out
// in full and the guard promptly failed the build on its own test fixture. That is the guard working, and it
// is the reason a fixture carrying a real-looking credential can never simply be committed here.
const FAKE_KEY = 'sk_live_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4';
const FAKE_PEM_HEADER = '-----BEGIN RSA ' + 'PRIVATE KEY' + '-----';

/** A minimal but VALID 1x1 PNG. Valid matters: a canary that corrupts the container proves nothing. */
function tinyPng() {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body) >>> 0);
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const idat = zlib.deflateSync(Buffer.from([0, 0, 0, 0, 0]));
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** Insert a tEXt chunk before IDAT: how an editor or screenshot tool embeds a comment. */
function withTextChunk(png, keyword, text) {
  const at = png.indexOf(Buffer.from('IDAT', 'ascii')) - 4;
  const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(text, 'latin1')]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from('tEXt', 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([png.subarray(0, at), len, body, crc, png.subarray(at)]);
}

const CLEAN = tinyPng();

test('the guard reads credentials out of PNG text chunks, JPEG comments, and bytes appended after the image', () => {
  const cases = [
    ['PNG tEXt chunk', withTextChunk(CLEAN, 'Comment', `deploy key ${FAKE_KEY}`), 'Stripe secret/restricted key'],
    ['PNG tEXt with a private key header', withTextChunk(CLEAN, 'Software', FAKE_PEM_HEADER), 'Private key block'],
    // Appended after IEND: what a careless concatenation or a tool writing a sidecar into the same file does.
    ['bytes appended after IEND', Buffer.concat([CLEAN, Buffer.from(`\n${FAKE_KEY}\n`, 'latin1')]), 'Stripe secret/restricted key'],
    // A JPEG COM segment. Only the marker and the text matter to a byte scan, which is the point of not
    // parsing each container: the same code covers formats nobody enumerated.
    ['JPEG COM segment', Buffer.from(`\xff\xd8\xff\xfe\x00\x28Screenshot: ${FAKE_KEY}`, 'latin1'), 'Stripe secret/restricted key'],
  ];
  for (const [label, buf, expected] of cases) {
    const found = findingsInImageBuffer(buf);
    assert.ok(found.length > 0, `${label}: must be caught`);
    assert.ok(found.some((f) => f.name === expected), `${label}: must be identified as ${expected}`);
  }
});

test('a clean image reports nothing, so the scan is not simply flagging every binary', () => {
  assert.deepEqual(findingsInImageBuffer(CLEAN), []);
  // Compressed image data must not trip a pattern by chance. A guard that cried wolf on real assets would be
  // switched off, so the negative case is as load-bearing as the positive ones.
  const noisy = Buffer.concat([CLEAN, zlib.deflateSync(Buffer.from('x'.repeat(20000)))]);
  assert.deepEqual(findingsInImageBuffer(noisy), []);
});

// THE WIRING, not the matcher. Images were skipped by the walk entirely, so this is the assertion that would
// have failed before the change while every matcher test above passed.
test('scanTree finds a credential planted in an image, which the walk used to skip outright', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'screenshot.png'), withTextChunk(CLEAN, 'Comment', FAKE_KEY));
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'), CLEAN);

  const findings = scanTree(dir);
  assert.equal(findings.length, 1, 'exactly the planted image, and not the clean one beside it');
  assert.equal(findings[0].rel, 'assets/screenshot.png');
  assert.match(findings[0].name, /in image metadata/);
});

test('scanTree still catches a credential in a text file, and still skips .example and the secret files', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  fs.writeFileSync(path.join(dir, 'config.mjs'), `export const key = '${FAKE_KEY}';\n`);
  fs.writeFileSync(path.join(dir, '.env'), `STRIPE_SECRET_KEY=${FAKE_KEY}\n`);
  fs.writeFileSync(path.join(dir, 'sample.env.example'), `STRIPE_SECRET_KEY=${FAKE_KEY}\n`);

  const flagged = scanTree(dir).map((f) => f.rel);
  assert.deepEqual(flagged, ['config.mjs'], 'the real secret files and .example placeholders stay skipped');
});

test('every pattern is anchored enough that a short placeholder does not match', () => {
  // rk_test_xxx and friends appear all over the docs and fixtures. If one of these started matching, the
  // guard would red constantly and get disabled, which is a slower way of having no guard at all.
  const placeholders = ['rk_test_xxx', 'sk_live_short', 'ghp_abc', 're_x', 'whsec_x', 'github_pat_x'];
  for (const s of placeholders) {
    for (const p of PATTERNS) assert.equal(p.re.test(s), false, `${s} must not match ${p.name}`);
  }
});
