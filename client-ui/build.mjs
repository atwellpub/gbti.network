// Bundle @gbti/client-ui into a single IIFE (global `GbtiUI`) for the hosts to inline. Build-time only:
// esbuild is a dev tool (resolved transitively today); the OUTPUT (dist/gbti-ui.js) is what ships, so the
// published package needs no bundler at runtime. The npm host inlines it into its gated shell page; the
// Chrome extension loads it as a content-script resource. Re-run after changing any element.
//   node client-ui/build.mjs

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(dir, 'src/index.mjs')],
  bundle: true,
  format: 'iife',
  globalName: 'GbtiUI',
  outfile: path.join(dir, 'dist/gbti-ui.js'),
  target: 'es2022',
  charset: 'utf8',
  legalComments: 'none',
  // sow-237: see extension/build.mjs for why this is load-bearing. Keeps emitted module
  // comments repo-relative so a worktree build matches a CI build byte for byte.
  preserveSymlinks: true,
});

console.log('built client-ui/dist/gbti-ui.js');
