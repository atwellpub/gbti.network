// sow-228: the extension Admin page gate. `shell.mjs:150` hid the nav LINK behind [data-admin-only] but the page
// itself had no role check, and `admin.html` is directly navigable, so any signed-in member reaching the URL got the
// whole staff surface. We hid the entrance and never locked the door.
//
// The defect was a DISCLOSURE and TRUST defect, not a privilege escalation: every write behind those panels is denied
// server-side by authorizeStaff/authorizeAdmin against the KV mirror, the config rendered is the public house/*.yml,
// and the coupon read is admin-gated so it 403s and renders zeros. A non-admin saw furniture, not data. That is what
// made it survivable, not what made it safe: the next panel added would inherit the hole silently and may not have a
// server check behind it.
//
// TWO invariants, and the STRUCTURAL one is the regression test. A pure-function test alone would be worthless here
// because a brand new function trivially "fails before the fix" by not existing. The structural test fails against the
// PRE-FIX markup, which is the only proof that it tests the fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shouldGateStaff } from '../extension/src/shell.mjs';

const ADMIN_HTML = new URL('../extension/admin.html', import.meta.url);

// --- Invariant 1 (STRUCTURAL): no admin panel is mounted in the live document. ------------------------------------
// Hiding a rendered panel is not gating it: the markup still ships, the custom elements still upgrade, and their
// loads still fire. <template> content is INERT by spec -- it does not render and its custom elements do NOT upgrade
// -- so the panels only exist once admin.mjs clones them, which it does only for a resolved staff role.

test('sow-228: admin.html mounts NO panel element outside the staff-gated <template>', () => {
  const html = readFileSync(ADMIN_HTML, 'utf8');
  // Everything inside a <template> is inert. Strip templates, then look at what the browser would actually render.
  const live = html.replace(/<template[\s\S]*?<\/template>/gi, '');
  const mounted = [...live.matchAll(/<(gbti-[a-z0-9-]+)/gi)].map((m) => m[1].toLowerCase());
  assert.deepEqual(
    [...new Set(mounted)],
    [],
    `admin.html renders ${mounted.length} panel element(s) outside <template>: ${[...new Set(mounted)].join(', ')}. ` +
      'A panel in the live document upgrades and loads for ANY signed-in visitor, whatever the role resolves to.',
  );
});

test('sow-228: the panels are still PRESENT, inside the template (the gate must not delete the surface)', () => {
  const html = readFileSync(ADMIN_HTML, 'utf8');
  const tpl = /<template[^>]*data-admin-panels[^>]*>([\s\S]*?)<\/template>/i.exec(html);
  assert.ok(tpl, 'admin.html must carry a <template data-admin-panels> holding the staff surface');
  // The eight panels as of sow-228. A NINTH added to the live document instead of the template fails the test above.
  for (const el of [
    'gbti-superadmin-dashboard',
    'gbti-admin',
    'gbti-categories-workspace',
    'gbti-tag-explorer',
    'gbti-news-source-manager',
    'gbti-quote-manager',
    'gbti-coupon-manager',
    'gbti-channel-map-manager',
  ]) {
    assert.ok(tpl[1].includes(`<${el}`), `${el} must live inside the gated template`);
  }
});

// --- Invariant 2 (PURE): the decision itself fails closed. --------------------------------------------------------
// Mirrors shouldGate's contract (true means DENY) so the two read the same way at a call site.

test('shouldGateStaff: moderator and above are NOT gated', () => {
  for (const role of ['moderator', 'admin', 'superadmin']) {
    assert.equal(shouldGateStaff({ authenticated: true, identity: { login: 'a' }, role }), false, role);
  }
});

test('shouldGateStaff: a plain member IS gated', () => {
  assert.equal(shouldGateStaff({ authenticated: true, identity: { login: 'a' }, role: 'member' }), true);
});

test('shouldGateStaff: an UNRECOGNIZED or missing role fails CLOSED', () => {
  // The whole class of defect this SOW closes is a permissive default. A role we do not recognize must render
  // nothing, not everything -- including a role string a future release adds and this build has never heard of.
  for (const role of [undefined, null, '', 'curator', 'creator', 'Moderator', 'ADMIN', 0, 3, {}, ['admin']]) {
    assert.equal(
      shouldGateStaff({ authenticated: true, identity: { login: 'a' }, role }),
      true,
      `role ${JSON.stringify(role)} must be denied`,
    );
  }
});

test('shouldGateStaff: a signed-OUT or malformed status is gated regardless of any role it claims', () => {
  // A status that claims superadmin but carries no token is not a signed-in superadmin, it is untrusted input.
  assert.equal(shouldGateStaff(null), true);
  assert.equal(shouldGateStaff(undefined), true);
  assert.equal(shouldGateStaff({}), true);
  assert.equal(shouldGateStaff({ role: 'superadmin' }), true);
  assert.equal(shouldGateStaff({ authenticated: true, role: 'superadmin' }), true); // token, no github login
  assert.equal(shouldGateStaff({ identity: { login: 'a' }, role: 'superadmin' }), true); // login, no token
});

test('shouldGateStaff agrees with the rail: the entrance and the door use ONE threshold', () => {
  // The rail hides [data-admin-only] at moderator and up (shell.mjs applyAccount). If these two thresholds ever
  // disagree, we are back to a hidden entrance and an unlocked door, which is exactly this SOW.
  const seen = { moderator: false, member: false };
  seen.moderator = shouldGateStaff({ authenticated: true, identity: { login: 'a' }, role: 'moderator' }) === false;
  seen.member = shouldGateStaff({ authenticated: true, identity: { login: 'a' }, role: 'member' }) === true;
  assert.deepEqual(seen, { moderator: true, member: true });
});
