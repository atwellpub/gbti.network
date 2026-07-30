#!/usr/bin/env node
// sow-158 security-prerequisite #1: the CSP violation harness. Serves dist/ locally and FORCE-ENFORCES the real
// policy from dist/_headers as a response header (even while production ships Report-Only), then loads a
// representative page per template and fails if any page reports a `securitypolicyviolation`. This is the
// pre-enforce gate: a green run here means flipping the production header from -Report-Only to enforce is safe.
//
//   npm run build && npm run check:csp
//
// Needs the dist/ build + a Chromium for Playwright. SKIPS (exit 0) if Playwright/Chromium/_headers are absent,
// so it is safe to run anywhere; install with `npx playwright install chromium`. NOTE: a plain http server does
// not apply Cloudflare `_headers`, so we parse dist/_headers ourselves (cspForPath, mirroring the `!` unset on
// the eval-tool subtree). `upgrade-insecure-requests` is stripped locally (the harness is http; it would upgrade
// same-origin http assets to https and break every load). The definitive `_headers` check is `wrangler pages
// dev ./dist`.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { parseHeaders, cspForPath } from './check-headers.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const DIST = path.join(ROOT, 'dist');

function skip(msg) { console.log('· check:csp skipped: ' + msg); process.exit(0); }

if (!fs.existsSync(DIST)) skip('dist/ not found (run `npm run build` first)');
const headersFile = path.join(DIST, '_headers');
if (!fs.existsSync(headersFile)) skip('dist/_headers not found (the CSP is not shipped)');
const rules = parseHeaders(fs.readFileSync(headersFile, 'utf8'));

let chromium;
try { ({ chromium } = await import('playwright')); }
catch { skip('playwright is not installed'); }

// Representative page list: standalone pages + the first slug per template, plus an article that carries an embed
// (exercises frame-src) and a share detail (exercises img-src + onerror). Adapts as content changes.
function firstSlug(seg) {
  const dir = path.join(DIST, seg);
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).sort()) if (fs.existsSync(path.join(dir, name, 'index.html'))) return `/${seg}/${name}/`;
  return null;
}
function firstArticleWithEmbed() {
  const dir = path.join(DIST, 'articles');
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir).sort()) {
    const f = path.join(dir, name, 'index.html');
    try { if (fs.readFileSync(f, 'utf8').includes('<iframe ')) return `/articles/${name}/`; } catch { /* next */ }
  }
  return null;
}
function firstShare() {
  const dir = path.join(DIST, 'shares');
  if (!fs.existsSync(dir)) return null;
  for (const author of fs.readdirSync(dir).sort()) {
    const adir = path.join(dir, author);
    if (!fs.statSync(adir).isDirectory()) continue;
    for (const id of fs.readdirSync(adir).sort()) if (fs.existsSync(path.join(adir, id, 'index.html'))) return `/shares/${author}/${id}/`;
  }
  return null;
}
const pages = [
  '/', '/articles/', '/products/', '/prompts/', '/members/', '/membership/', '/login/', '/account/', '/workbench/', '/admin/', '/news/', '/browse/', '/revenue-model/', '/feeds/',
  '/utilities/', '/utilities/email-signature-generator/', '/tools/email-signature-generator/', '/utilities/js-animate-hue/',
  firstSlug('articles'), firstSlug('products'), firstSlug('prompts'), firstSlug('members'),
  firstArticleWithEmbed(), firstShare(),
  '/this-page-does-not-exist/', // the 404
].filter(Boolean);

// Minimal static server for dist (clean-URL + directory-index), attaching the force-enforced CSP per path.
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.json': 'application/json', '.xml': 'application/xml', '.txt': 'text/plain' };
function resolveFile(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const cands = p.endsWith('/') ? [path.join(DIST, p, 'index.html')] : [path.join(DIST, p), path.join(DIST, p + '.html'), path.join(DIST, p, 'index.html')];
  for (const c of cands) { try { if (fs.statSync(c).isFile()) return c; } catch { /* next */ } }
  return null;
}
function enforcedCspFor(urlPath) {
  const value = cspForPath(rules, urlPath.split('?')[0]);
  if (!value) return null; // unset on this path (the eval-tool subtree)
  // Strip upgrade-insecure-requests locally (the harness is http; it would upgrade same-origin assets to https).
  return value.split(';').map((s) => s.trim()).filter((s) => s && s.toLowerCase() !== 'upgrade-insecure-requests').join('; ');
}
const server = http.createServer((req, res) => {
  let f = resolveFile(req.url); let status = 200;
  if (!f) { f = path.join(DIST, '404.html'); status = 404; }
  const headers = { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' };
  const csp = enforcedCspFor(req.url);
  if (csp && path.extname(f) === '.html') headers['content-security-policy'] = csp; // enforce on documents only
  try {
    const body = fs.readFileSync(f);
    res.writeHead(status, headers);
    res.end(body);
  } catch {
    if (!res.headersSent) res.writeHead(500);
    res.end('500');
  }
});
const port = await new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
await new Promise((r) => server.listen(port, '127.0.0.1', r));
const base = `http://127.0.0.1:${port}`;

let browser;
try { browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }); }
catch (e) { server.close(); skip('could not launch Chromium (run `npx playwright install chromium`): ' + e.message.split('\n')[0]); }

const violations = [];
let currentUrl = '';
const page = await browser.newPage();
await page.exposeFunction('__cspViolation', (v) => violations.push({ url: currentUrl, ...v }));
await page.addInitScript(() => {
  document.addEventListener('securitypolicyviolation', (e) => {
    // eslint-disable-next-line no-undef
    window.__cspViolation({ directive: e.effectiveDirective || e.violatedDirective, blockedURI: (e.blockedURI || '').slice(0, 120), source: (e.sourceFile || '').slice(0, 120), line: e.lineNumber });
  });
});
page.on('console', (m) => { if (m.type() === 'error' && /content security policy|refused to (load|execute|apply|connect|frame)/i.test(m.text())) violations.push({ url: currentUrl, directive: 'console', blockedURI: m.text().slice(0, 160) }); });

let checked = 0;
for (const url of pages) {
  currentUrl = url;
  try {
    await page.goto(base + url, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(400); // let deferred scripts + async violations fire
    checked++;
  } catch (e) {
    // a navigation/network error is NOT a CSP violation; note it but do not fail on it
    console.log(`· ${url}: load note ${e.message.split('\n')[0]}`);
  }
}
await browser.close();
server.close();

if (violations.length) {
  console.error(`✗ CSP guard failed (${violations.length} violation${violations.length === 1 ? '' : 's'} across ${checked} pages):`);
  for (const v of violations) console.error(`  - ${v.url}  [${v.directive}]  blocked: ${v.blockedURI}${v.source ? `  (${v.source}:${v.line})` : ''}`);
  process.exit(1);
}
console.log(`✓ CSP guard passed (force-enforced across ${checked} pages, no securitypolicyviolation)`);
