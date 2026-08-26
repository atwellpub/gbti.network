#!/usr/bin/env node
// Defense-in-depth secret guard. Scans the files that WOULD be committed (it mirrors .gitignore by
// skipping the same paths) for credential patterns, so a real key can never reach git even if a key is
// pasted into a tracked file or .gitignore is weakened. The real secret files (.env, **/.dev.vars) are
// gitignored and skipped here, as are *.example placeholders. Node builtins only (no deps), so it runs
// anywhere: `npm run check:secrets`, the .githooks/pre-commit hook, and .github/workflows/secret-scan.yml.
//
// IMAGES ARE SCANNED TOO (2026-08-18). They were skipped entirely, because the walk only read a fixed list
// of text extensions. That was a real blind spot rather than a theoretical one: `.product/` exists to hold
// images, it is tracked, and its Chrome Web Store assets are UI SCREENSHOTS that ship to a global listing.
// A credential in an image reached git completely unexamined.
//
// HOW, AND WHY IT IS NOT PER-FORMAT PARSING. Every container has somewhere to put text (PNG tEXt/iTXt/zTXt,
// JPEG EXIF and COM, WebP and GIF comments) and anything appended after the terminating chunk is in the file
// too. Rather than parse five formats, extract printable ASCII runs from the bytes and apply the SAME
// patterns. Format-agnostic, no new dependency, and it covers containers nobody thought about.
//
// WHAT THIS DOES NOT DO, STATED PLAINLY SO NOBODY OVER-TRUSTS IT: it does not read PIXELS. A token VISIBLE in
// a screenshot passes this guard silently. There is no cheap fix for that (OCR is a dependency and a
// different order of cost), so the control for it remains a human looking at any screenshot before it ships.
// A guard that covers metadata is not a guard that covers screenshots, and the difference is the whole risk.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SELF = fileURLToPath(import.meta.url);

// `.playwright-mcp` holds browser page snapshots and is gitignored, so it is skipped for the same reason
// `.env` is: this guard covers what WOULD be committed, and a gitignored scratch directory is not that.
// Stated plainly because the omission was not free: running the scan across the working clone found live
// GitHub tokens sitting in two of those snapshots, which is a real local-hygiene problem this guard is now
// deliberately blind to. It is the wrong instrument for it, not a gap to paper over here.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.data', '.snapshots', '.wrangler', '.playwright-mcp']);

/**
 * Directories that .gitignore SKIPS BY NAME but then explicitly UN-IGNORES, which must therefore be scanned.
 *
 * THE BUG THIS FIXES, because it is the kind that reads as safe. This file's header says it "mirrors
 * .gitignore by skipping the same paths". It did not. `.gitignore` ignores `dist/` and then negates
 * `!client-ui/dist/` and `!extension/dist/*.js`, so those build artifacts ARE committed, while SKIP_DIRS
 * refused to descend into anything named `dist`. Ten tracked files, including the whole extension bundle
 * that ships to the Chrome Web Store, were committed to git and never once examined. The scanner was
 * STRICTER than .gitignore in the one direction where strictness means blindness.
 *
 * Parsed from the file rather than hardcoded, so the claim in the header stays true when .gitignore changes.
 */
function unignoredPrefixes(root) {
  let raw;
  try { raw = fs.readFileSync(path.join(root, '.gitignore'), 'utf8'); } catch { return []; }
  return raw.split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('!'))
    .map((l) => l.slice(1).replace(/^\/+/, '').replace(/\/+$/, ''))
    // Drop a trailing glob segment (`extension/dist/*.js` -> `extension/dist`) so the DIRECTORY is reachable.
    .map((l) => (path.basename(l).includes('*') ? path.dirname(l) : l))
    .filter((l) => l && l !== '.');
}
const isSkippedFile = (rel) =>
  rel.endsWith('.example') ||
  /(^|\/)\.env(\..*)?$/.test(rel) ||
  /(^|\/)\.dev\.vars$/.test(rel) ||
  path.join(ROOT, rel) === SELF;

// `.svg` is TEXT and was in neither list, so 103 tracked SVGs were never opened. An SVG can hold a whole
// script element, let alone a comment.
const TEXT_EXT = new Set(['.mjs', '.js', '.ts', '.astro', '.json', '.yml', '.yaml', '.md', '.toml', '.txt', '.csv', '.css', '.html', '.sh', '.svg', '.xml', '']);
const ARCHIVE_EXT = new Set(['.zip']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif', '.bmp', '.tiff']);
// Bounds the cost of one pathological file. The whole repo is ~60 MB of images and scans in ~150 ms, so this
// is a backstop, not a tuning knob. A file OVER the cap is REPORTED, never silently skipped: a guard that
// quietly declines to look is the failure mode this scanner exists to avoid.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
// Bounds ZIP inflation so a zip bomb cannot exhaust memory. Exceeding it is REPORTED, not skipped.
const MAX_ZIP_INFLATED_BYTES = 128 * 1024 * 1024;
// Printable ASCII runs. 8 is short enough to catch a key sitting alone in a comment field and long enough
// that compressed image data does not produce enough candidate text to matter (measured: zero findings
// across all 665 images in the repo).
const PRINTABLE_RUN = /[\x20-\x7e]{8,}/g;

/**
 * Credential patterns found in an image's embedded text. Exported and pure so the scan can be TESTED: a
 * guard whose only evidence is "it reported nothing" is indistinguishable from a guard that cannot see.
 * `test/check-no-secrets.test.mjs` plants real credentials in real containers and asserts each is caught.
 */
export function findingsInImageBuffer(buf) {
  const out = [];
  const runs = buf.toString('latin1').match(PRINTABLE_RUN);
  if (!runs) return out;
  const seen = new Set();
  for (const run of runs) {
    for (const p of PATTERNS) {
      if (p.re.test(run) && !seen.has(p.name)) {
        seen.add(p.name);
        out.push({ name: p.name });
      }
    }
  }
  return out;
}

// Credential shapes, each long enough that short placeholders (rk_test_xxx) do not match.
export const PATTERNS = [
  { name: 'Stripe secret/restricted key', re: /\b[rs]k_(live|test)_[A-Za-z0-9]{24,}\b/ },
  { name: 'Stripe webhook secret', re: /\bwhsec_[A-Za-z0-9]{24,}\b/ },
  { name: 'GitHub PAT (classic)', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{60,}\b/ },
  { name: 'GitHub OAuth/server token', re: /\bgh[ousr]_[A-Za-z0-9]{36}\b/ },
  { name: 'Discord bot token', re: /\b[MNO][A-Za-z0-9_-]{23}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}\b/ },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{20,}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  // ADDED 2026-08-26, every one of them a shape found LIVE in .data/legacy/db (the archived WordPress dump),
  // which held working credentials for seven providers for fourteen months. None of these had a pattern here,
  // on a stack that is wholly Cloudflare-native and whose own operators use Google and OpenAI daily. The
  // scanner was blind to the providers we actually use, which is the least useful place to be blind.
  { name: 'Cloudflare Global API Key', re: /\b[0-9a-f]{37}\b/ },
  { name: 'Cloudflare API token (prefixed form)', re: /\bcfat_[A-Za-z0-9_-]{20,}\b/ },
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA|AROA|AIDA|AIPA|ANPA|ANVA|ABIA|ACCA|AGPA)[0-9A-Z]{16}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'OpenAI API key', re: /\bsk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{24,}\b/ },
  { name: 'Google OAuth client secret', re: /\bGOCSPX-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'Google OAuth refresh token', re: /\b1\/\/[A-Za-z0-9_-]{30,}\b/ },
];

/**
 * THE PREFIX-FREE CLASS, which every pattern above is structurally unable to catch.
 *
 * All the shapes in PATTERNS work because the vendor was kind enough to stamp a prefix on the key. Plenty are
 * not: a Cloudflare scoped API token is 40 characters of `[A-Za-z0-9_-]` and nothing else, which is also the
 * shape of a git SHA, a base64 id and half the hashes in any lockfile. Matching on shape alone would either
 * miss it or drown the repo in noise.
 *
 * So this matches on CONTEXT instead: a key-shaped NAME, assigned a long, high-entropy, mixed-class value
 * that is not a placeholder. That is the combination a real credential in a config file has and a variable
 * reference, an env var name or a documentation example does not.
 *
 * DELIBERATELY NOT APPLIED TO IMAGE OR BINARY RUNS. Compressed bytes produce high-entropy printable runs by
 * definition, so this rule belongs to text only. Feeding it binary would generate confident nonsense, and a
 * guard that cries wolf gets switched off, which is worse than the gap it was closing.
 */
const SECRET_NAME = '(?:api[_-]?key|secret[_-]?key|client[_-]?secret|access[_-]?key|private[_-]?key|auth[_-]?token|api[_-]?token|secret|token|password|passwd|credential)';
const ASSIGNMENT = new RegExp(`${SECRET_NAME}["'\\]]?\\s*[:=]\\s*["'\`]([A-Za-z0-9+/=_-]{24,})["'\`]`, 'gi');

/** Shannon entropy in bits per character. Random base62 sits near 5.5; English prose near 4. */
function shannon(str) {
  const freq = new Map();
  for (const c of str) freq.set(c, (freq.get(c) || 0) + 1);
  let h = 0;
  for (const n of freq.values()) { const px = n / str.length; h -= px * Math.log2(px); }
  return h;
}

/**
 * Values that LOOK like credentials and are not. Every entry here is a real shape found in this repo or in
 * ordinary config, and the list is the reason this rule can be switched on at all.
 */
function isPlaceholder(v) {
  if (/^[A-Z][A-Z0-9_]+$/.test(v)) return true;                       // an env var NAME, not its value
  if (/^(?:[A-Za-z0-9_-]+\.)+[A-Za-z0-9_-]+$/.test(v) && !/\d{6}/.test(v)) return true; // dotted.identifier.path
  if (/(x{4,}|y{4,}|0{6,}|1{6,}|\.{3})/i.test(v)) return true;         // xxxx / 000000 / ellipsis
  if (/(your|example|sample|placeholder|changeme|change[_-]?me|redacted|dummy|fake|insert|replace|todo|none|null|undefined|abcdef|123456)/i.test(v)) return true;
  if (/^[A-Za-z0-9_-]*(?:test|demo|local|dev)[A-Za-z0-9_-]*$/i.test(v) && shannon(v) < 4) return true;
  if (new Set(v).size <= 4) return true;                               // too few distinct characters
  return false;
}

/** True when a value mixes enough character classes to look generated rather than written. */
function mixedClass(v) {
  let k = 0;
  if (/[a-z]/.test(v)) k++;
  if (/[A-Z]/.test(v)) k++;
  if (/[0-9]/.test(v)) k++;
  if (/[+/=_-]/.test(v)) k++;
  return k >= 3;
}

/**
 * THE ONLY SUPPRESSION, and it is a hardcoded list here rather than an inline `// secret-scan: allow` marker
 * on purpose. An inline marker lets any file silence any finding, so the first person under deadline pressure
 * turns the guard off one line at a time and nobody reviewing a diff notices. Editing THIS file is visible.
 *
 * SCOPED TO THE CONTEXTUAL RULE ONLY. PATTERNS is not consulted here, so a real Stripe, GitHub or Slack key
 * pasted into an allowlisted file still fails the scan. The suppression covers the heuristic, not the file.
 *
 * Every entry states WHY the value cannot simply be replaced with an obvious fake, because "it is only a
 * test" is not a reason: a test can use `sk_test_notarealkey` and most should.
 */
const CONTEXTUAL_ALLOW = new Map([
  ['test/oauth1.test.mjs',
    'X publishes these exact consumer and token values as the reference vector in its "Creating a signature" documentation. The test asserts the DOCUMENTED signature base string and HMAC output, so substituting fakes would delete the only check that the signer is correct.'],
]);

/**
 * Findings for one chunk of TEXT. Exported and pure so the rule is testable on its own, and so a caller
 * cannot accidentally apply it to bytes.
 */
export function contextualFindings(text) {
  const out = [];
  const seen = new Set();
  for (const m of text.matchAll(ASSIGNMENT)) {
    const v = m[1];
    if (isPlaceholder(v) || !mixedClass(v)) continue;
    // THE FLOOR SCALES WITH LENGTH, and the fixed number it replaced was wrong in the dangerous direction.
    // Shannon entropy falls with length for a trivial reason: a 24-character string cannot contain more than
    // 24 distinct characters. Measured over 20,000 random 24-character keys the MEDIAN entropy is 4.25, so
    // the fixed 4.2 floor first written here would have silently missed about half of the shortest keys,
    // which are exactly the ones no vendor prefix can catch. 80% of log2(len) sits below the 0.1st
    // percentile at every length from 24 upward, so it keeps essentially every real key while still
    // rejecting a repetitive value that merely looks long.
    if (shannon(v) < 0.8 * Math.log2(Math.min(v.length, 64))) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push({ name: 'high-entropy value assigned to a credential-shaped name' });
  }
  return out;
}

/**
 * Every entry of a ZIP, DECOMPRESSED, scanned with the same patterns.
 *
 * WHY IT INFLATES INSTEAD OF SCANNING THE BYTES. The image path above extracts printable runs from raw bytes,
 * which works because image containers store their text uncompressed. A ZIP does not: its entries are
 * DEFLATE'd, so a printable-run scan of the raw bytes finds essentially nothing and reports clean over any
 * content whatsoever. That is not a weak guard, it is a guard that passes on nothing while looking like
 * coverage, which is the exact failure this file's header warns about one paragraph up. So it parses the
 * central directory and inflates. `zlib` is a node builtin, so the no-dependency rule still holds.
 *
 * The repo ships `public/extension/gbti-network-extension.zip` to the Chrome Web Store. It is built from
 * `extension/dist`, which is now scanned as source too, so this is the second of two locks on the same door.
 */
export function findingsInZipBuffer(buf) {
  const out = [];
  const seen = new Set();
  const push = (name, entry) => {
    const k = `${name}\u0000${entry ?? ''}`;
    if (!seen.has(k)) { seen.add(k); out.push({ name, entry }); }
  };

  // End of central directory: scan back from the tail (the trailing comment is at most 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) { push('ZIP central directory unreadable; inspect it by hand'); return out; }

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  let budget = MAX_ZIP_INFLATED_BYTES;

  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    // The entry NAME, so a finding says which of 21 bundled files to open rather than "somewhere in the zip".
    const entry = buf.toString('latin1', p + 46, p + 46 + nameLen);
    const extraLen = buf.readUInt16LE(p + 30);
    const cmtLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + cmtLen;

    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) continue;
    // The LOCAL header carries its own name/extra lengths, which may differ from the central copy.
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (dataStart + compSize > buf.length) continue;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let text;
    try {
      if (method === 0) text = raw.toString('latin1');
      else if (method === 8) text = zlib.inflateRawSync(raw, { maxOutputLength: budget }).toString('latin1');
      else { push(`ZIP entry uses unsupported compression method ${method}; inspect it by hand`, entry); continue; }
    } catch {
      // A refusal to decompress is REPORTED, never swallowed. A silent catch here would turn a zip bomb or a
      // corrupt entry into a clean pass.
      push('ZIP entry could not be decompressed; inspect it by hand', entry);
      continue;
    }
    budget -= text.length;
    for (const pat of PATTERNS) if (pat.re.test(text)) push(pat.name, entry);
    for (const f of contextualFindings(text)) push(f.name, entry);
    if (budget <= 0) { push('ZIP inflated past the size cap; inspect the remainder by hand', entry); break; }
  }
  return out;
}

/**
 * Scan a tree and return every finding. Exported with an injectable root so the WIRING can be tested, not
 * just the pattern matching: a test builds a temp tree with a planted image and asserts this reports it.
 * Testing the helper alone would prove the matcher works while the walk quietly skipped images, which is the
 * exact shape of the blind spot being closed here.
 */
export function scanTree(root) {
  const findings = [];
  walkInto(root, root, findings, unignoredPrefixes(root));
  return findings;
}

function walkInto(dir, ROOT, findings, unignored) {
  const walk = (d) => walkInto(d, ROOT, findings, unignored);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const dabs = path.join(dir, e.name);
      const drel = path.relative(ROOT, dabs).split(path.sep).join('/');
      // A skipped NAME is still descended into when .gitignore un-ignores it or something inside it, which is
      // how `client-ui/dist` and `extension/dist` get scanned while every other `dist` stays skipped.
      const reopened = unignored.some((u) => u === drel || u.startsWith(`${drel}/`));
      if (!SKIP_DIRS.has(e.name) || reopened) walk(dabs);
      continue;
    }
    const rel = path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/');
    if (isSkippedFile(rel)) continue;
    const ext = path.extname(rel).toLowerCase();
    const allowContextual = CONTEXTUAL_ALLOW.has(rel);
    if (ARCHIVE_EXT.has(ext)) {
      // `public/extension/gbti-network-extension.zip` is a COMMITTED build artifact that is downloaded and
      // installed. Its bytes are DEFLATE'd, so the printable-run scan used for images finds nothing in it and
      // reports clean, which is a guard passing on nothing. Entries are inflated and scanned as real text.
      const abs = path.join(dir, e.name);
      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      for (const f of findingsInZipBuffer(buf)) findings.push({ rel, line: 0, name: `${f.name}, inside ${f.entry ?? 'the archive'}` });
      continue;
    }
    if (IMAGE_EXT.has(ext)) {
      const abs = path.join(dir, e.name);
      let stat;
      try {
        stat = fs.statSync(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_IMAGE_BYTES) {
        // Reported, not skipped. See MAX_IMAGE_BYTES.
        findings.push({ rel, line: 0, name: `image too large to scan (${Math.round(stat.size / 1048576)} MB); inspect it by hand` });
        continue;
      }
      let buf;
      try {
        buf = fs.readFileSync(abs);
      } catch {
        continue;
      }
      for (const f of findingsInImageBuffer(buf)) findings.push({ rel, line: 0, name: `${f.name}, in image metadata` });
      continue;
    }
    if (!TEXT_EXT.has(ext)) continue;
    let txt;
    try {
      txt = fs.readFileSync(path.join(dir, e.name), 'utf8');
    } catch {
      continue;
    }
    txt.split('\n').forEach((line, i) => {
      for (const p of PATTERNS) if (p.re.test(line)) findings.push({ rel, line: i + 1, name: p.name });
      if (!allowContextual) for (const f of contextualFindings(line)) findings.push({ rel, line: i + 1, name: f.name });
    });
  }
}
// Walk only when run as a script. `test/check-no-secrets.test.mjs` imports this module for the pure helpers
// above, and importing a guard must not trigger a repo-wide scan as a side effect.
if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  const findings = scanTree(ROOT);
  if (findings.length) {
    console.error(`✗ secret scan FAILED: ${findings.length} possible credential(s) in committable files:`);
    for (const f of findings) console.error(`  - ${f.rel}:${f.line}  (${f.name})`);
    console.error('Move the value into a gitignored .env / .dev.vars or a platform secret store, never into git.');
    process.exit(1);
  }
  console.log('✓ secret scan passed (no credential patterns in committable files)');
}
