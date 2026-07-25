// Local persisted store for the client (SOW-006): settings (port, autostart, MCP on/off, repo path), the
// per-install endpoint bearer token, the GitHub token from device-flow auth, and the cached identity +
// membership status. A small JSON file under the per-OS user config dir, written 0600 (owner-only) because
// it holds tokens. Billing itself is NEVER handled here: the client deep-links to Stripe's hosted portal.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

/** Per-OS, user-scoped config directory (never system-wide, never requires admin). */
export function defaultStoreDir() {
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'gbti-network');
  }
  if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'gbti-network');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'gbti-network');
}

export const STORE_DEFAULTS = Object.freeze({
  version: 1,
  preferredPort: 4500,
  mcpEnabled: true,
  autostart: false,
  repoPath: null,        // local clone/fork of the public content repo
  endpointToken: null,   // per-install bearer token for the local HTTP/MCP endpoint (generated on first run)
  githubToken: null,     // GitHub token from device-flow auth (used for git push + PR API)
  identity: null,        // { githubId, githubLogin } cached after auth
  status: null,          // cached derived membership status (refreshed periodically)
  authMode: null,        // SOW-157: per-member auth mode ('app' | 'hosted' | 'classic'); null = baked default
});

/** A small file-backed store. Pass a dir for tests; defaults to the per-OS config dir. */
export function createStore({ dir = defaultStoreDir(), fileName = 'config.json' } = {}) {
  const file = path.join(dir, fileName);

  function load() {
    try {
      return { ...STORE_DEFAULTS, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
    } catch {
      return { ...STORE_DEFAULTS };
    }
  }

  function save(data) {
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, file); // atomic replace
    try {
      fs.chmodSync(file, 0o600);
    } catch {
      // best-effort on platforms without POSIX perms (Windows)
    }
    return data;
  }

  return {
    file,
    dir,
    load,
    save,
    get(key) {
      return load()[key];
    },
    set(patch) {
      return save({ ...load(), ...patch });
    },
    /** Ensure a per-install endpoint token exists, generating one on first access. gen is injectable. */
    ensureEndpointToken(gen) {
      const cur = load();
      if (cur.endpointToken) return cur.endpointToken;
      const token = gen();
      save({ ...cur, endpointToken: token });
      return token;
    },
  };
}
