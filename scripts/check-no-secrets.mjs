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
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const SELF = fileURLToPath(import.meta.url);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.astro', '.data', '.snapshots', '.wrangler']);
const isSkippedFile = (rel) =>
  rel.endsWith('.example') ||
  /(^|\/)\.env(\..*)?$/.test(rel) ||
  /(^|\/)\.dev\.vars$/.test(rel) ||
  path.join(ROOT, rel) === SELF;

const TEXT_EXT = new Set(['.mjs', '.js', '.ts', '.astro', '.json', '.yml', '.yaml', '.md', '.toml', '.txt', '.csv', '.css', '.html', '.sh', '']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.avif', '.bmp', '.tiff']);
// Bounds the cost of one pathological file. The whole repo is ~60 MB of images and scans in ~150 ms, so this
// is a backstop, not a tuning knob. A file OVER the cap is REPORTED, never silently skipped: a guard that
// quietly declines to look is the failure mode this scanner exists to avoid.
const MAX_IMAGE_BYTES = 64 * 1024 * 1024;
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
];

/**
 * Scan a tree and return every finding. Exported with an injectable root so the WIRING can be tested, not
 * just the pattern matching: a test builds a temp tree with a planted image and asserts this reports it.
 * Testing the helper alone would prove the matcher works while the walk quietly skipped images, which is the
 * exact shape of the blind spot being closed here.
 */
export function scanTree(root) {
  const findings = [];
  walkInto(root, root, findings);
  return findings;
}

function walkInto(dir, ROOT, findings) {
  const walk = (d) => walkInto(d, ROOT, findings);
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name));
      continue;
    }
    const rel = path.relative(ROOT, path.join(dir, e.name)).split(path.sep).join('/');
    if (isSkippedFile(rel)) continue;
    const ext = path.extname(rel).toLowerCase();
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
