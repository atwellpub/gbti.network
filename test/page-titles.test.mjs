// BaseLayout builds `fullTitle` as `${title} | ${siteName}` and uses it for BOTH <title> and og:title. A
// page that passes a title already carrying the brand therefore double-brands itself, and the visible
// symptom shows up where it does the most damage: og:title is what every share preview renders.
//
// Three pages shipped that way (/codeable-invite/, /brand/, /handbook/) and it was caught by the owner in a
// Slack unfurl of a real Codeable invite on 2026-08-13, reading
//   "Codeable experts: your first year on us · GBTI Network | GBTI Network"
//
// This is a source-level guard rather than a rendered-output one on purpose: it fails at the line that
// causes the problem, which is what someone adding a page will actually read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_NAME = 'GBTI Network';

/** Every .astro page under src/pages, recursively. */
function pageFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pageFiles(p, out);
    else if (e.name.endsWith('.astro')) out.push(p);
  }
  return out;
}

test('no page passes BaseLayout a title that already carries the site name', () => {
  const offenders = [];
  for (const file of pageFiles(path.join(ROOT, 'src', 'pages'))) {
    const src = fs.readFileSync(file, 'utf8');
    // Only the literal `title="..."` prop form; an expression title is the page's own business.
    for (const m of src.matchAll(/\btitle="([^"]*)"/g)) {
      if (m[1].includes(SITE_NAME)) offenders.push(`${path.relative(ROOT, file)}: title="${m[1]}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `BaseLayout appends " | ${SITE_NAME}" itself, so these titles render twice-branded in <title> AND og:title:\n${offenders.join('\n')}`,
  );
});

// The guard above is only correct while BaseLayout still appends the brand. If that changes, the rule
// inverts and every bare title silently loses its branding, so pin the behaviour it depends on.
test('DRIFT: BaseLayout still composes fullTitle by appending the site name', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf8');
  assert.match(src, /const fullTitle = title === siteName \? title : `\$\{title\} \| \$\{siteName\}`/);
  assert.match(src, /<title>\{fullTitle\}<\/title>/);
  assert.match(src, /property="og:title" content=\{fullTitle\}/);
});
