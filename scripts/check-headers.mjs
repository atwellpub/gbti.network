#!/usr/bin/env node
// Build guard (sow-158 security-prerequisite #1): the SERVED dist/_headers must carry a well-formed
// Content-Security-Policy. public/_headers is a STATIC file copied verbatim to dist/ by `astro build` (no
// composer, unlike _redirects), so if it fails to copy or a directive gets silently weakened, this fails the
// build BEFORE deploy. Accepts either Content-Security-Policy or -Report-Only (passes in both rollout phases).
//   node scripts/check-headers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Parse a Cloudflare Pages `_headers` file into rules. Each rule is { path, set: { <lowercase-name>: { name,
 * value } }, unset: [ <lowercase-name> ] }. Comments (#) and blanks are ignored. Pure + exported so the CSP
 * harness (check-csp.mjs) reuses it.
 */
export function parseHeaders(text) {
  const rules = [];
  let current = null;
  for (const raw of text.split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) {
      current = { path: raw.trim(), set: {}, unset: [] };
      rules.push(current);
      continue;
    }
    if (!current) continue;
    const line = raw.trim();
    if (line.startsWith('!')) {
      current.unset.push(line.slice(1).trim().toLowerCase());
      continue;
    }
    const idx = line.indexOf(':');
    if (idx > 0) {
      const name = line.slice(0, idx).trim();
      current.set[name.toLowerCase()] = { name, value: line.slice(idx + 1).trim() };
    }
  }
  return rules;
}

/** Split a CSP value into a Map of directive -> tokens[]. */
export function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const sp = seg.search(/\s/);
    const name = (sp < 0 ? seg : seg.slice(0, sp)).toLowerCase();
    const tokens = sp < 0 ? [] : seg.slice(sp + 1).trim().split(/\s+/).filter(Boolean);
    directives.set(name, { tokens, duplicate: directives.has(name) });
  }
  return directives;
}

const cspEntryOf = (rule) => (rule?.set['content-security-policy'] || rule?.set['content-security-policy-report-only'] || null);

// Cloudflare _headers path matcher: `/*` matches all; `/foo/*` matches the prefix; else exact.
function matchRule(pattern, urlPath) {
  if (pattern === '/*') return true;
  if (pattern.endsWith('/*')) return urlPath.startsWith(pattern.slice(0, -1));
  return urlPath === pattern;
}

/**
 * For the check-csp harness: the CSP value to ENFORCE locally for a request path, or null if the effective
 * policy is none. Models Cloudflare's `!` removal, INCLUDING the remove-and-reset-in-one-block case the
 * /embed relay depends on: within a single rule the `! ` removal drops whatever earlier rules set, and a
 * `Name: value` line in that SAME rule then wins (the two live in separate collections on the rule, so the
 * result is order-independent; verified against real workerd via `wrangler pages dev`). The earlier model
 * returned null whenever a matching rule unset the header, which made this harness force-enforce NOTHING on
 * /embed and skip the one policy it most needs to exercise.
 */
export function cspForPath(rules, urlPath) {
  let value = null;
  for (const r of rules) {
    if (!matchRule(r.path, urlPath)) continue;
    const entry = cspEntryOf(r);
    if (r.unset.includes('content-security-policy') || r.unset.includes('content-security-policy-report-only')) value = null;
    if (entry) value = entry.value;
  }
  return value;
}

const REQUIRED_DIRECTIVES = ['default-src', 'script-src', 'style-src', 'img-src', 'font-src', 'connect-src', 'frame-src', 'form-action', 'frame-ancestors', 'base-uri', 'object-src'];

/**
 * Assert dist/_headers exists and carries a well-formed CSP with the required directives + key locked tokens.
 * Pure over root/distDir, so it is unit-testable. Returns { errors, notes, checked }.
 */
export function checkHeaders({ root, distDir = path.join(root, 'dist'), headersFile = path.join(distDir, '_headers') } = {}) {
  const errors = [];
  const notes = [];
  let checked = 0;

  if (!fs.existsSync(distDir)) {
    notes.push('dist/ not found, skipped the headers check (run after `npm run build`).');
    return { errors, notes, checked };
  }
  if (!fs.existsSync(headersFile)) {
    errors.push('dist/_headers is missing: public/_headers did not copy into dist. A static public/_headers is required to ship the CSP.');
    return { errors, notes, checked };
  }

  const rules = parseHeaders(fs.readFileSync(headersFile, 'utf8'));
  const global = rules.find((r) => r.path === '/*');
  if (!global) { errors.push('dist/_headers has no `/*` rule (the global policy block).'); return { errors, notes, checked }; }

  const entry = cspEntryOf(global);
  if (!entry) { errors.push('the `/*` rule sets no Content-Security-Policy (or -Report-Only) header.'); return { errors, notes, checked }; }
  checked++;
  const enforce = !!global.set['content-security-policy'];
  notes.push(enforce ? 'CSP is in ENFORCE mode.' : 'CSP is in Report-Only mode (observe, not enforce).');

  const directives = parseCsp(entry.value);
  for (const [name, d] of directives) if (d.duplicate) errors.push(`duplicate CSP directive: ${name}`);
  for (const d of REQUIRED_DIRECTIVES) if (!directives.has(d)) errors.push(`missing required CSP directive: ${d}`);

  const tok = (dir) => (directives.get(dir)?.tokens || []);
  const wants = (dir, needle) => tok(dir).some((t) => t === needle || t.includes(needle));
  // The GLOBAL rule must block CROSS-origin framing OUTRIGHT: EXACTLY 'none' or EXACTLY 'self' (the site frames
  // its own utility tools). Equality, not "contains": the old contains-test let `'self' *.evil.com` and
  // `'self' data:` through. The one permitted loosening lives on the /embed rules below and NOWHERE else,
  // because widening this predicate instead would legalize extension framing of /account and every signed-in page.
  const fa = tok('frame-ancestors');
  if (directives.has('frame-ancestors') && !(fa.length === 1 && (fa[0] === "'none'" || fa[0] === "'self'"))) {
    errors.push(`the \`/*\` frame-ancestors must be exactly 'self' or exactly 'none' (no cross-origin framing); got: ${fa.join(' ') || '(empty)'}`);
  }
  if (directives.has('object-src') && !tok('object-src').includes("'none'")) errors.push("object-src must be 'none'");
  if (directives.has('base-uri') && !tok('base-uri').includes("'self'")) errors.push("base-uri must be 'self'");
  if (directives.has('connect-src') && !wants('connect-src', 'signup.gbti.network')) errors.push('connect-src must include signup.gbti.network (the news feed + login break otherwise)');
  if (directives.has('frame-src') && !wants('frame-src', 'challenges.cloudflare.com')) errors.push('frame-src must include challenges.cloudflare.com (Turnstile)');
  if (directives.has('frame-src') && !wants('frame-src', 'www.youtube.com')) errors.push('frame-src must include www.youtube.com (member embeds)');
  if (directives.has('script-src') && !wants('script-src', 'challenges.cloudflare.com')) errors.push('script-src must include challenges.cloudflare.com (Turnstile)');

  // SOW-092 / sow-158: the /embed video relay is the ONE place a chrome-extension ancestor is allowed. The
  // extension frames it because a chrome-extension:// page sends no HTTP Referer and YouTube rejects that, so
  // losing this exemption silently re-breaks every in-extension video. Assert it in BOTH directions: it must be
  // present on the two literal rules, and it must not appear anywhere else.
  const EMBED_PATHS = ['/embed', '/embed/*']; // two rules: trailingSlash 'ignore' serves /embed as well as /embed/
  const unsetKey = enforce ? 'content-security-policy' : 'content-security-policy-report-only';
  for (const p of EMBED_PATHS) {
    const rule = rules.find((r) => r.path === p);
    if (!rule) { errors.push(`missing the \`${p}\` rule: the video relay must stay framable by the extension (see public/_headers).`); continue; }
    if (!rule.unset.includes(unsetKey)) {
      errors.push(`the \`${p}\` rule must \`! \` remove the global CSP; a plain second rule comma-JOINS into an intersection, so frame-ancestors would collapse back to 'self' and the relay would stay blocked.`);
    }
    if (rule.set['x-frame-options']) {
      errors.push(`the \`${p}\` rule must not set X-Frame-Options: SAMEORIGIN re-blocks a chrome-extension:// ancestor exactly as frame-ancestors 'self' did, and XFO has no extension-permitting form.`);
    }
    const embedEntry = cspEntryOf(rule);
    if (!embedEntry) { errors.push(`the \`${p}\` rule removes the CSP but sets no replacement policy.`); continue; }
    const efa = parseCsp(embedEntry.value).get('frame-ancestors')?.tokens || [];
    if (!efa.includes('chrome-extension:')) {
      errors.push(`the \`${p}\` frame-ancestors must include the \`chrome-extension:\` scheme source (a bare \`*\` does NOT work: it matches only network schemes).`);
    }
    if (efa.some((t) => t === '*' || /^https?:/i.test(t))) {
      errors.push(`the \`${p}\` frame-ancestors must not admit a web origin; the relay is framable by extensions only.`);
    }
    checked++;
  }
  for (const r of rules) {
    if (EMBED_PATHS.includes(r.path)) continue;
    const otherEntry = cspEntryOf(r);
    if (!otherEntry) continue;
    const ofa = parseCsp(otherEntry.value).get('frame-ancestors')?.tokens || [];
    if (ofa.some((t) => t.startsWith('chrome-extension'))) {
      errors.push(`only the /embed rules may admit a chrome-extension ancestor, but \`${r.path}\` does; extension framing of a signed-in page is a real clickjacking surface.`);
    }
  }

  // Recommended: the eval-using tool subtree unsets the CSP so enforce mode does not break its vendored jzip.
  const toolRule = rules.find((r) => r.path.includes('/tools/email-signature-generator/'));
  const unsetName = enforce ? 'content-security-policy' : 'content-security-policy-report-only';
  if (!toolRule || !toolRule.unset.includes(unsetName)) {
    notes.push('note: /tools/email-signature-generator/* does not unset the CSP; its vendored jzip (eval) would break under enforce.');
  }

  return { errors, notes, checked };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, notes, checked } = checkHeaders({ root: ROOT });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ headers guard failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ headers guard passed (${checked} CSP present + well-formed)`);
}
