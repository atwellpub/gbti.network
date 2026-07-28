// sow-158 Phase 2: the pure identity core — the /membership/status -> MemberSignal mapper and the cookie-wins
// precedence selector. No DOM, no network (the .ts wrapper holds the browser glue; this covers the logic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memberSignalFromStatus, selectIdentity } from '../src/lib/member-signal-core.mjs';

test('memberSignalFromStatus maps a paid member (canPublish true, source cookie)', () => {
  const s = memberSignalFromStatus({ ok: true, github_id: 42, login: 'octocat', status: 'paid', canCurate: false, couponUntil: null });
  assert.equal(s.authenticated, true);
  assert.equal(s.login, 'octocat');
  assert.equal(s.githubId, '42'); // stringified
  assert.equal(s.username, 'octocat');
  assert.equal(s.membership, 'paid');
  assert.equal(s.canPublish, true);
  assert.equal(s.role, 'member');
  assert.equal(s.source, 'cookie');
});

test('memberSignalFromStatus reflects trialing/expired without paid perks', () => {
  const t = memberSignalFromStatus({ ok: true, login: 'a', status: 'trialing' });
  assert.equal(t.membership, 'trialing');
  assert.equal(t.canPublish, false);
  const e = memberSignalFromStatus({ ok: true, login: 'a', status: 'expired' });
  assert.equal(e.membership, 'expired');
  assert.equal(e.canPublish, false);
});

test('memberSignalFromStatus returns null for a non-member payload', () => {
  assert.equal(memberSignalFromStatus(null), null);
  assert.equal(memberSignalFromStatus({ ok: false }), null);
  assert.equal(memberSignalFromStatus({ ok: true }), null); // no login
  assert.equal(memberSignalFromStatus({ ok: true, login: '' }), null);
});

test('selectIdentity: the cookie session wins over the extension signal', () => {
  const cookie = { login: 'c', source: 'cookie' };
  const ext = { login: 'e', source: 'extension' };
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: cookie, extSignal: ext }), cookie);
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: null, extSignal: ext }), ext); // signed-out cookie defers
  assert.equal(selectIdentity({ cookieResolved: false, cookieSignal: null, extSignal: ext }), ext); // interim extension display
  assert.equal(selectIdentity({ cookieResolved: true, cookieSignal: null, extSignal: null }), null);
  assert.equal(selectIdentity({ cookieResolved: false, cookieSignal: null, extSignal: null }), null);
});
