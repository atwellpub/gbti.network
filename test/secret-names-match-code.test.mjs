// A PROVISIONING CHECKLIST THAT NAMES A VARIABLE THE CODE DOES NOT READ IS WORSE THAN NO CHECKLIST.
//
// Found 2026-08-22: scripts/provision-secrets.mjs tracked MAIL_ADDRESS_KEY; the Worker reads MAIL_EMAIL_KEY.
// Nothing reads MAIL_ADDRESS_KEY anywhere. Provisioning it would have reported GREEN while the Worker still saw
// nothing, and mail-subscribe returns its NEUTRAL anti-enumeration response when the key is absent, so every
// signup would look successful, no confirmation mail would ever arrive, and nothing would go red. The good
// security property (a neutral response) is exactly what hides the misconfiguration.
//
// Both directions are failures and both end the same way, silently:
//   - code reads a key the checklist omits  -> nobody provisions it -> the feature is inert
//   - checklist names a key the code ignores -> it gets provisioned  -> the feature is inert
//
// Scoped to *_KEY / *_KEYS names, which are the secrets. Plain tuning vars are not in scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Every `env.X_KEY` / `env?.X_KEY` / `env['X_KEY']` name read anywhere under the given dirs. */
function keyNamesReadByCode(dirs) {
  const found = new Set();
  const re = /env\s*\??\s*(?:\.\s*([A-Z][A-Z0-9_]*_KEYS?)\b|\[\s*['"]([A-Z][A-Z0-9_]*_KEYS?)['"]\s*\])/g;
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!p.endsWith('.mjs')) continue;
      const src = fs.readFileSync(p, 'utf8');
      for (const m of src.matchAll(re)) found.add(m[1] || m[2]);
    }
  };
  dirs.forEach((d) => walk(path.join(root, d)));
  return found;
}

/** The *_KEY names the provisioning checklist tracks. */
function keyNamesTracked() {
  const src = fs.readFileSync(path.join(root, 'scripts/provision-secrets.mjs'), 'utf8');
  const out = new Set();
  for (const m of src.matchAll(/\bname:\s*'([A-Z][A-Z0-9_]*_KEYS?)'/g)) out.add(m[1]);
  return out;
}

// Names read by code that are deliberately NOT provisioning items. Each needs a reason, because this set is the
// bypass and an unexplained entry here is how the guard gets defeated.
const NOT_PROVISIONING_ITEMS = new Map([
  // Optional rotation-fallback lists: absent is the normal state, so they are not checklist items.
  ['MAIL_UNSUB_KEYS', 'optional retired-key list for unsubscribe token rotation; absent is normal'],
  ['MEMBER_CONTENT_KEYS', 'optional retired-key map for the member-content epoch; absent is normal'],
  ['MAIL_ADDRESS_KEYS', 'documented but unimplemented; no code path reads it as a map'],
]);

test('every *_KEY the mail/worker code reads is on the provisioning checklist', () => {
  const read = keyNamesReadByCode(['workers/signup', 'membership']);
  const tracked = keyNamesTracked();
  const missing = [...read].filter((n) => !tracked.has(n) && !NOT_PROVISIONING_ITEMS.has(n)).sort();
  assert.deepEqual(missing, [], `read by code but never provisioned (the feature would be silently inert): ${missing.join(', ')}`);
});

test('the checklist names no *_KEY that the code never reads', () => {
  const read = keyNamesReadByCode(['workers/signup', 'membership', 'scripts', 'clients']);
  const tracked = keyNamesTracked();
  const phantom = [...tracked].filter((n) => !read.has(n)).sort();
  assert.deepEqual(phantom, [], `on the checklist but read by nothing (provisioning it reports green and changes nothing): ${phantom.join(', ')}`);
});

test('MAIL_EMAIL_KEY specifically: the name the code reads is the name tracked (the 2026-08-22 regression)', () => {
  const read = keyNamesReadByCode(['workers/signup', 'membership']);
  const tracked = keyNamesTracked();
  assert.ok(read.has('MAIL_EMAIL_KEY'), 'the Worker reads MAIL_EMAIL_KEY');
  assert.ok(tracked.has('MAIL_EMAIL_KEY'), 'so the checklist must track MAIL_EMAIL_KEY');
  assert.ok(!tracked.has('MAIL_ADDRESS_KEY'), 'and must NOT track MAIL_ADDRESS_KEY, which nothing reads');
});
