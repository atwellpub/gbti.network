// SOW-026: the COMMITTED source of truth for the extension's bundled auth mode. The MV3 service worker has no
// process.env, so the client auth-mode vars must be inlined at bundle time (extension/build.mjs esbuild
// `define`). If that mode came only from an ephemeral build-time env var, the committed bundle would NOT be
// reproducible -> CI's `npm run build:extension` + `git diff` (extension-check.yml) would rebuild it in classic
// and flag the committed app-mode bundle as drift. So the mode lives in a committed file (build-config.json),
// read here; a build-time env var still overrides it for ad-hoc builds. Absent/classic -> classic.
//
// build-config.json shape (all optional): { authMode: "classic"|"app", appClientId, appSlug, githubClientId, signupBase }
// These are all PUBLIC (the device-flow client id + slug ship in the bundle anyway), so committing them is fine.
//
// Pure + injectable, so resolveExtensionDefine is unit-tested without running esbuild.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONFIG_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'build-config.json');

/** Read the committed build config; missing/invalid file -> {} (classic). */
export function readBuildConfig(file = CONFIG_PATH) {
  try {
    const v = JSON.parse(readFileSync(file, 'utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

/**
 * Resolve the esbuild `define` map for the client auth-mode build vars. Precedence per var: build-time env wins,
 * else the committed config, else unset (so the source default in client/src/signup-base.mjs applies = classic).
 * Returns { define, mode, values }. Throws if app mode is selected without the App client id + slug (an app-mode
 * bundle carrying the placeholder would be broken). Pure.
 */
export function resolveExtensionDefine({ config = {}, env = {} } = {}) {
  const pick = (envKey, cfgKey) => env[envKey] || config[cfgKey] || '';
  const values = {
    GBTI_AUTH_MODE: pick('GBTI_AUTH_MODE', 'authMode'),
    GBTI_GITHUB_APP_CLIENT_ID: pick('GBTI_GITHUB_APP_CLIENT_ID', 'appClientId'),
    GBTI_GITHUB_APP_SLUG: pick('GBTI_GITHUB_APP_SLUG', 'appSlug'),
    GBTI_GITHUB_CLIENT_ID: pick('GBTI_GITHUB_CLIENT_ID', 'githubClientId'),
    GBTI_SIGNUP_BASE: pick('GBTI_SIGNUP_BASE', 'signupBase'),
  };
  // SOW-157: 'hosted' is a recognized baked mode too (sign-in-only onboarding; the Worker does the git
  // work). It uses the same App client id for the device flow, so the app-mode credential guard applies to
  // both. Note the BAKED mode is only the fallback: the per-member store value (decided at sign-in) wins.
  const mode = values.GBTI_AUTH_MODE === 'app' ? 'app' : values.GBTI_AUTH_MODE === 'hosted' ? 'hosted' : 'classic';
  if (mode !== 'classic' && !(values.GBTI_GITHUB_APP_CLIENT_ID && values.GBTI_GITHUB_APP_SLUG)) {
    throw new Error(`${mode} mode requires the App client id + slug (env GBTI_GITHUB_APP_CLIENT_ID/_SLUG, or build-config.json appClientId/appSlug) so the bundle carries the real values, not the placeholder.`);
  }
  const define = {};
  for (const [k, v] of Object.entries(values)) if (v) define[`globalThis.process.env.${k}`] = JSON.stringify(v);
  return { define, mode, values };
}
