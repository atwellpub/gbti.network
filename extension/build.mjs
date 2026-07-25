// Build the MV3 extension bundles (SOW-006 v2 P4). esbuild bundles the core + @gbti/client-ui + deps into the
// contexts: the background worker (ESM, MV3 type:module), the content script (IIFE, classic script), and the
// extension pages (IIFE: onboarding, newtab, shares). chrome.* stay as globals (provided by the extension
// runtime). Build-time only; the dist/ output is what loads. Re-run after changing any src or the shared
// core / client-ui.
//   node extension/build.mjs

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBuildConfig, resolveExtensionDefine } from './build-config.mjs';

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = (f) => path.join(dir, 'src', f);
const out = (f) => path.join(dir, 'dist', f);

// SOW-026: the MV3 service worker has no `process.env`, so the client's auth-mode build vars (read in
// client/src/signup-base.mjs as `globalThis.process?.env?.GBTI_*`) must be INLINED at bundle time via esbuild
// `define` (it substitutes through the optional chain). The mode comes from the COMMITTED extension/build-config.json
// (so the bundle is reproducible in CI without env), with a build-time env override for ad-hoc builds. Classic
// stays the default when the config + env are absent. Flip with `bash .data/sow/provision-sow026-app.sh flip`
// (writes the config), or ad-hoc: `GBTI_AUTH_MODE=app GBTI_GITHUB_APP_CLIENT_ID=.. GBTI_GITHUB_APP_SLUG=.. node extension/build.mjs`.
const { define, mode, values } = resolveExtensionDefine({ config: readBuildConfig(), env: process.env });

const common = { bundle: true, target: 'es2022', platform: 'browser', charset: 'utf8', legalComments: 'none', define };

// The no-flash theme setter, loaded in every page <head> via <script src> (MV3 CSP forbids inline scripts).
await build({ ...common, entryPoints: [src('theme-init.mjs')], format: 'iife', outfile: out('theme-init.js') });
await build({ ...common, entryPoints: [src('background.mjs')], format: 'esm', outfile: out('background.js') });
await build({ ...common, entryPoints: [src('content.mjs')], format: 'iife', outfile: out('content.js') });
await build({ ...common, entryPoints: [src('onboarding.mjs')], format: 'iife', outfile: out('onboarding.js') }); // SOW-026 first-run tab (replaces the popup)
await build({ ...common, entryPoints: [src('newtab.mjs')], format: 'iife', outfile: out('newtab.js') }); // SOW-017
await build({ ...common, entryPoints: [src('shares.mjs')], format: 'iife', outfile: out('shares.js') }); // SOW-018 Shares page
await build({ ...common, entryPoints: [src('workspace.mjs')], format: 'iife', outfile: out('workspace.js') }); // SOW-033 Workspace page
await build({ ...common, entryPoints: [src('admin.mjs')], format: 'iife', outfile: out('admin.js') }); // SOW-036/038 Admin page
await build({ ...common, entryPoints: [src('account.mjs')], format: 'iife', outfile: out('account.js') }); // SOW-040 Account page
await build({ ...common, entryPoints: [src('profile.mjs')], format: 'iife', outfile: out('profile.js') }); // SOW-129 Profile page

// SOW-025: the GBTI MCP server ships INSIDE the extension folder as a self-contained, zero-install NODE bundle.
// Chrome NEVER loads it (it is not in manifest.json / web_accessible_resources) — the files just ride along in
// the folder. Claude Code runs it from disk: `node extension/mcp/gbti-network-mcp.mjs` (a stdio MCP server).
// platform:'node' + format:'esm' inlines every dep (js-yaml, zod, the client core) so there is no `npm install`.
const mcp = (f) => path.join(dir, 'mcp', f);
const clientSrc = (f) => path.join(dir, '..', 'client', 'src', f);
// Do NOT add a `banner: { js: '#!/usr/bin/env node' }`: the entry file (mcp-stdio.mjs) already starts with a
// shebang, and esbuild preserves that ENTRY shebang at line 1 of the bundle (so the file is directly
// executable, and the install prompt's `node <file>` invocation also works). A banner shebang would be a SECOND
// shebang placed AFTER esbuild's prelude (past line 1), which node rejects as a syntax error.
const nodeBundle = { bundle: true, target: 'node18', platform: 'node', format: 'esm', charset: 'utf8', legalComments: 'none' };
await build({ ...nodeBundle, entryPoints: [clientSrc('mcp-stdio.mjs')], outfile: mcp('gbti-network-mcp.mjs') });

console.log('built extension/dist/{theme-init,background,content,onboarding,newtab,shares,workspace,admin,account,profile}.js + extension/mcp/gbti-network-mcp.mjs');
if (mode !== 'classic') {
  console.log(`  (${mode.toUpperCase()} mode inlined: client id ${values.GBTI_GITHUB_APP_CLIENT_ID}, slug ${values.GBTI_GITHUB_APP_SLUG})`);
}
