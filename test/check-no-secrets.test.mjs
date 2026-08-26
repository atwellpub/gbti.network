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
import { findingsInImageBuffer, findingsInZipBuffer, contextualFindings, scanTree, PATTERNS } from '../scripts/check-no-secrets.mjs';

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

// ---------------------------------------------------------------------------------------------------------
// THE THREE SURFACES THE WALK USED TO MISS, and one heuristic for the keys that carry no vendor prefix.
//
// Each of the first three is a WIRING test against scanTree, deliberately, because that is the assertion
// that can fail against the old code for a real reason. A test of a newly exported helper can only fail
// there by not existing, and an import-shaped red is not evidence of anything.
// ---------------------------------------------------------------------------------------------------------

const FAKE_SLACK = 'xox' + 'b-000000000000-000000000000-' + 'A'.repeat(24);

// Assembled at runtime for the same reason the PEM header above is: this file is scanned by the guard under
// test, and a credential-shaped name assigned a long high-entropy literal reds the build on its own fixture.
// Splitting the value keeps the source line from matching while the VALUE under test is unchanged.
const ENTROPIC = ['aB3xK9pQ7zR2', 'mN5vC8wY1tL4', 'hJ6dF0gS'].join('');
const ENTROPIC_2 = ['Xk7mP2qR9tW4', 'yZ6bN8vC3jL5', 'hF1dG0sA2eU4iO'].join('');
const ENTROPIC_3 = ['9wE4rT7yU2iO', '5pA8sD1fG3hJ', '6kL0zX'].join('');
// Mixed-class, not a placeholder, long enough, and yet REPETITIVE: ten distinct characters over thirty.
// Nothing but the entropy floor rejects it, which is what makes it the fixture that holds that floor honest.
const REPETITIVE = 'Abcde12345'.repeat(3);

/** Minimal DEFLATE zip writer, so a test can build a real archive with no external tool and no dependency. */
function makeZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'latin1');
    const data = Buffer.from(content);
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(deflated.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, deflated);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(deflated.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += lh.length + nameBuf.length + deflated.length;
  }
  const localBuf = Buffer.concat(locals);
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, cdBuf, eocd]);
}

test('scanTree descends into a dist directory that .gitignore un-ignores, and still skips the others', () => {
  // The header claimed the scanner "mirrors .gitignore". It did not: SKIP_DIRS refused every directory named
  // dist, while .gitignore un-ignores client-ui/dist and extension/dist/*.js, so ten COMMITTED files
  // including the whole published extension bundle were never once examined.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  fs.writeFileSync(path.join(dir, '.gitignore'), 'dist/\n!client-ui/dist/\n!extension/dist/*.js\n');
  for (const d of ['client-ui/dist', 'extension/dist', 'src/dist']) {
    fs.mkdirSync(path.join(dir, d), { recursive: true });
    fs.writeFileSync(path.join(dir, d, 'bundle.js'), `const t = '${FAKE_SLACK}';\n`);
  }

  const flagged = scanTree(dir).map((f) => f.rel).sort();
  assert.deepEqual(flagged, ['client-ui/dist/bundle.js', 'extension/dist/bundle.js'],
    'the un-ignored dist dirs are scanned; a plain gitignored dist stays skipped');
});

test('scanTree reads .svg, which is text and was in neither the text nor the image list', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  fs.writeFileSync(path.join(dir, 'icon.svg'), `<svg><!-- ${FAKE_SLACK} --></svg>\n`);
  const findings = scanTree(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rel, 'icon.svg');
});

test('scanTree inflates a committed .zip, which the printable-run scan reports clean by construction', () => {
  // A DEFLATE stream yields no long printable runs, so scanning the raw bytes finds nothing and passes. That
  // is a guard passing on nothing, which is worse than no guard because it reads as coverage.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  const zip = makeZip([['manifest.json', '{"name":"gbti"}'], ['dist/background.js', `const t='${FAKE_SLACK}';`]]);
  fs.writeFileSync(path.join(dir, 'bundle.zip'), zip);

  const findings = scanTree(dir);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rel, 'bundle.zip');
  assert.match(findings[0].name, /inside dist\/background\.js/,
    'the entry name is reported, so a finding names which of the bundled files to open');

  // And the raw-bytes approach really does miss it, which is why this branch exists at all.
  assert.deepEqual(findingsInImageBuffer(zip), [], 'the printable-run scan finds nothing in the same archive');
});

test('a clean zip reports nothing, and an unreadable one is REPORTED rather than swallowed', () => {
  assert.deepEqual(findingsInZipBuffer(makeZip([['a.js', 'const x = 1;']])), []);
  const junk = Buffer.from('not a zip at all, just some bytes');
  const findings = findingsInZipBuffer(junk);
  assert.equal(findings.length, 1, 'a zip the scanner cannot parse must never pass silently');
  assert.match(findings[0].name, /unreadable/);
});

test('the contextual rule catches a prefix-free key, which no pattern can match on shape alone', () => {
  // A Cloudflare scoped token is 40 characters of [A-Za-z0-9_-] and nothing else, which is also the shape of
  // a git sha. Matching on shape would either miss it or drown the repo; this matches on CONTEXT instead.
  const hits = [
    `const api_key = "${ENTROPIC}";`,
    `CLOUDFLARE_TOKEN: '${ENTROPIC_2}'`,
    `"client_secret": "${ENTROPIC_3}",`,
  ];
  for (const line of hits) assert.equal(contextualFindings(line).length, 1, line);
});

test('the contextual rule stays quiet on the shapes that are not credentials', () => {
  // Every one of these is a real shape from this repo or from ordinary config. The rule is only shippable
  // because it stays silent on them: a guard that cries wolf gets switched off, which is a slower way of
  // having no guard at all.
  const quiet = [
    'const key = process.env.STRIPE_SECRET_KEY;',
    'secret: "${{ secrets.CF_API_TOKEN }}"',
    'api_key: "your-api-key-goes-here-replace-me"',
    'token: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"',
    'password: "aaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
    'secret_key: "membership.tiers.display.helper.name"',
    'const token = "short"',
    'apiKey: "CLOUDFLARE_ACCOUNT_IDENTIFIER_VALUE"',
    `token: "${REPETITIVE}"`,
  ];
  for (const line of quiet) assert.deepEqual(contextualFindings(line), [], line);
});

test('the contextual allowlist suppresses the heuristic ONLY, never a real vendor key', () => {
  // test/oauth1.test.mjs carries X's published OAuth 1.0a reference vector, which cannot be replaced with
  // fakes without deleting the only check that the signer is correct. If that suppression ever widened into
  // "this file is exempt", a pasted Stripe key would ride in behind it.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-secrets-'));
  fs.mkdirSync(path.join(dir, 'test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'test', 'oauth1.test.mjs'),
    `const consumerSecret = "${ENTROPIC}";\nconst k = '${FAKE_KEY}';\n`);

  const findings = scanTree(dir);
  assert.equal(findings.length, 1, 'the heuristic is suppressed, the vendor pattern is not');
  assert.equal(findings[0].name, 'Stripe secret/restricted key');
  assert.equal(findings[0].line, 2);
});

test('the one allowlisted file still exists, so the suppression cannot outlive what it excuses', () => {
  // A dead allowlist entry is invisible: it suppresses nothing, explains a file nobody can find, and quietly
  // becomes precedent for adding more.
  const here = path.dirname(new URL(import.meta.url).pathname);
  assert.ok(fs.existsSync(path.join(here, 'oauth1.test.mjs')),
    'test/oauth1.test.mjs is allowlisted in scripts/check-no-secrets.mjs; remove the entry if the file goes');
});

test('the entropy floor tracks length, so a genuine SHORT key is not silently let through', () => {
  // This is the assertion the first version of the rule failed. A fixed 4.2-bit floor looks strict and is
  // strict against long keys, but the median entropy of a random 24-character key is 4.25, so it quietly
  // missed about half of them. Short keys are precisely the ones with no vendor prefix to match on, so the
  // rule was weakest exactly where it was the only control.
  //
  // Deterministic by construction: a seeded generator, so this either always passes or always fails.
  let seed = 20260825;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (const len of [24, 32, 40]) {
    let caught = 0;
    const N = 300;
    for (let i = 0; i < N; i++) {
      let v = '';
      while (v.length < len) v += A[Math.floor(rnd() * A.length)];
      if (contextualFindings(`api_key: "${v}"`).length === 1) caught++;
    }
    assert.ok(caught / N > 0.95, `only ${caught}/${N} random ${len}-character keys were caught`);
  }
});
