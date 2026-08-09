// SOW-030: the page-safe identity signal builder. The CRITICAL assertion is the security contract: no token or
// secret from /api/status ever reaches the output, even if the status object carries extra fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMemberSignal } from '../extension/src/identity-signal.mjs';

// SOW-060: the signal also carries the free-tier capability flags so the page can render them without re-deriving.
const ALLOWED = ['authenticated', 'login', 'githubId', 'username', 'role', 'membership', 'paidTier', 'canPublish', 'canSeeNews', 'canFollow', 'canSave', 'canBrowse'];

test('signed-out / missing status -> null (no signal)', () => {
  assert.equal(buildMemberSignal(null), null);
  assert.equal(buildMemberSignal({}), null);
  assert.equal(buildMemberSignal({ authenticated: false, identity: { login: 'a' } }), null);
  assert.equal(buildMemberSignal({ authenticated: true, identity: null }), null);
});

test('signed-in -> exactly the allowlisted fields pass through', () => {
  const s = buildMemberSignal({ authenticated: true, role: 'admin', membership: 'paid', canPublish: true, identity: { login: 'Alice', githubId: 123, username: 'alice' } });
  assert.deepEqual(Object.keys(s).sort(), [...ALLOWED].sort());
  assert.equal(s.login, 'Alice');
  assert.equal(s.githubId, '123'); // coerced to string
  assert.equal(s.role, 'admin');
  assert.equal(s.membership, 'paid');
  assert.equal(s.canPublish, true);
});

test('SECURITY: a token / secret / Stripe id on the status NEVER appears in the signal', () => {
  const s = buildMemberSignal({
    authenticated: true,
    membership: 'paid',
    identity: { login: 'alice', githubId: 1, username: 'alice', githubToken: 'gho_SECRET', email: 'a@b.com' },
    githubToken: 'gho_SECRETTOPLEVEL',
    stripeCustomerId: 'cus_SECRET',
    accessToken: 'devicecode',
  });
  const json = JSON.stringify(s);
  for (const leak of ['gho_SECRET', 'gho_SECRETTOPLEVEL', 'cus_SECRET', 'devicecode', 'a@b.com']) {
    assert.ok(!json.includes(leak), `signal must not leak ${leak}`);
  }
  // And no unexpected keys (allowlist by construction, not blocklist).
  for (const k of Object.keys(s)) assert.ok(ALLOWED.includes(k), `unexpected key ${k}`);
});

test('defends against odd field types (no throw; sane defaults)', () => {
  const s = buildMemberSignal({ authenticated: true, role: 42, membership: null, canPublish: 'yes', identity: { login: null, githubId: 0, username: 7 } });
  assert.equal(s.role, 'member');       // non-string role -> default
  assert.equal(s.membership, 'unknown'); // non-string membership -> default
  assert.equal(s.paidTier, 'none');      // absent paidTier -> fail-closed default
  assert.equal(s.canPublish, false);     // non-true -> false
  assert.equal(s.login, null);
  assert.equal(s.username, null);
  assert.equal(s.githubId, '0');         // 0 is not null -> coerced
});

test('sow-185: the resolved paidTier passes through the page signal, fail-closed to none', () => {
  const id = { login: 'a', githubId: 1, username: 'a' };
  assert.equal(buildMemberSignal({ authenticated: true, membership: 'paid', paidTier: 'creator', identity: id }).paidTier, 'creator');
  assert.equal(buildMemberSignal({ authenticated: true, membership: 'paid', paidTier: 'member', identity: id }).paidTier, 'member');
  assert.equal(buildMemberSignal({ authenticated: true, membership: 'none', identity: id }).paidTier, 'none'); // absent -> none
  assert.equal(buildMemberSignal({ authenticated: true, membership: 'paid', paidTier: 5, identity: id }).paidTier, 'none'); // non-string -> none
});
