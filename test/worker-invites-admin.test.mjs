// sow-231 Phase 1: the admin-gated invite issuance endpoints. No network; KV and authorization are fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  membershipInviteCreate,
  membershipInviteList,
  membershipInviteUpdate,
} from '../workers/signup/membership-invites-admin.mjs';
import { inviteKey, INVITE_STATE } from '../membership/invites.mjs';

const NOW = new Date('2026-08-12T12:00:00.000Z');

// The coupons:config mirror the Worker reads. CODEABLEYEAR is live; RETIRED is not; PASTIT has expired.
const MIRROR = JSON.stringify({
  generatedAt: NOW.toISOString(),
  coupons: [
    { code: 'CODEABLEYEAR', freeDays: 365, active: true, tier: 'creator', maxRedemptions: null, expiresAt: null },
    { code: 'RETIRED', freeDays: 30, active: false, tier: 'creator', maxRedemptions: null, expiresAt: null },
    { code: 'PASTIT', freeDays: 30, active: true, tier: 'creator', maxRedemptions: null, expiresAt: '2020-01-01T00:00:00.000Z' },
  ],
});

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix, cursor }) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor };
    },
  };
}

// The overrides mirror stores roles.yml as its SECTIONS (moderators / admins / superadmins), which is what
// roleLoginsFromParsed reads. A flat array here would silently resolve no login at all.
const MIRROR_ROLES = { roles: { superadmins: [{ github_id: '2002207', login: 'atwellpub' }] } };
const okAuth = async () => ({ ok: true, githubId: '2002207', role: 'superadmin', mirror: MIRROR_ROLES });
const noAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const env = (kv) => ({ SIGNUP_KV: kv });
const req = (body, method = 'POST') => new Request('https://x/y', {
  method,
  headers: { 'Content-Type': 'application/json' },
  ...(method === 'GET' || method === 'HEAD' ? {} : { body: JSON.stringify(body) }),
});
const getReq = () => req(null, 'GET');

// A fixed byte supply so the minted code is deterministic in tests. 0 maps to the first alphabet letter.
const fixedBytes = (v) => (n) => Uint8Array.from({ length: n }, () => v);

test('every invite endpoint DENIES before it reads anything', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  for (const [fn, r] of [
    [membershipInviteCreate, req({ campaign: 'CODEABLEYEAR' })],
    [membershipInviteList, getReq()],
    [membershipInviteUpdate, req({ code: 'X', action: 'revoke' }, 'PATCH')],
  ]) {
    const res = await fn(r, env(kv), { authorize: noAuth, now: NOW });
    assert.equal(res.status, 403, `${fn.name} denies`);
  }
  assert.equal([...kv.store.keys()].some((k) => k.startsWith('invite:')), false, 'nothing was written');
});

test('membershipInviteCreate mints a unique code, stores it, and returns the summary', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const res = await membershipInviteCreate(
    req({ campaign: 'codeableyear', note: '  sent to the lead at Codeable  ' }),
    env(kv),
    { authorize: okAuth, now: NOW, randomBytes: fixedBytes(0) },
  );
  assert.equal(res.status, 200);
  const inv = res.body.invite;
  assert.equal(inv.campaign, 'CODEABLEYEAR');
  assert.ok(inv.code.startsWith('CDEABEYEAR'), 'the campaign-derived prefix survives into the code');
  assert.equal(inv.state, INVITE_STATE.issued);
  assert.equal(inv.note, 'sent to the lead at Codeable', 'the note is sanitized on the way in');
  assert.equal(inv.issuedByLogin, 'atwellpub', 'resolved from the overrides mirror, not from authorizeAdmin');

  const stored = JSON.parse(kv.store.get(inviteKey(inv.code)));
  assert.equal(stored.issuedBy, '2002207');
  assert.equal(stored.redeemedAt, null);
});

test('membershipInviteCreate refuses a campaign that is not REDEEMABLE right now', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const call = (campaign) => membershipInviteCreate(req({ campaign }), env(kv), { authorize: okAuth, now: NOW, randomBytes: fixedBytes(0) });

  // Issuing against a switched-off or expired campaign would hand someone a URL that fails at redemption
  // with no explanation, so it fails HERE where an admin can see it.
  assert.equal((await call('RETIRED')).status, 400, 'inactive');
  assert.equal((await call('PASTIT')).status, 400, 'past its own expiry');
  assert.equal((await call('NOSUCHTHING')).status, 400, 'unknown');
  assert.equal((await call('')).status, 400, 'absent');
  assert.equal([...kv.store.keys()].some((k) => k.startsWith('invite:')), false, 'no invite was written for any of them');
});

test('membershipInviteCreate refuses an unreadable expiry instead of silently dropping it', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  const res = await membershipInviteCreate(req({ campaign: 'CODEABLEYEAR', expiresAt: 'garbage' }), env(kv), { authorize: okAuth, now: NOW, randomBytes: fixedBytes(0) });
  assert.equal(res.status, 400, 'an admin who asked for an expiry must not get a link that never expires');

  const ok = await membershipInviteCreate(req({ campaign: 'CODEABLEYEAR', expiresAt: '2026-09-01' }), env(kv), { authorize: okAuth, now: NOW, randomBytes: fixedBytes(0) });
  assert.equal(ok.body.invite.expiresAt, '2026-09-01T00:00:00.000Z');
});

test('membershipInviteCreate retries past a code that is already issued', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  // The first attempt always mints the same code from a constant byte supply, so seeding that code forces
  // the collision branch. Varying the supply on the second call stands in for fresh randomness.
  const first = await membershipInviteCreate(req({ campaign: 'CODEABLEYEAR' }), env(kv), { authorize: okAuth, now: NOW, randomBytes: fixedBytes(0) });
  assert.equal(first.status, 200);

  let call = 0;
  const varying = (n) => Uint8Array.from({ length: n }, () => (call === 0 ? 0 : 1));
  const second = await membershipInviteCreate(req({ campaign: 'CODEABLEYEAR' }), env(kv), {
    authorize: okAuth,
    now: NOW,
    randomBytes: (n) => { const b = varying(n); call += 1; return b; },
  });
  assert.equal(second.status, 200);
  assert.notEqual(second.body.invite.code, first.body.invite.code, 'a collision never issues a duplicate');
});

test('membershipInviteList sweeps the invite prefix newest first, and SURFACES a corrupt record', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'invite:AAA111': JSON.stringify({ code: 'AAA111', campaign: 'CODEABLEYEAR', issuedAt: '2026-08-01T00:00:00.000Z' }),
    'invite:BBB222': JSON.stringify({ code: 'BBB222', campaign: 'CODEABLEYEAR', issuedAt: '2026-08-10T00:00:00.000Z' }),
    'invite:JUNK33': JSON.stringify({ code: 'no', campaign: 'CODEABLEYEAR' }), // parses, but fails the coupon rule
  });
  const res = await membershipInviteList(getReq(), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.invites.map((i) => i.code), ['BBB222', 'AAA111', 'NO'], 'newest first; issuedAt-less rows sort last');

  // The corrupt row is KEPT rather than dropped. Hiding it would make a bad record invisible to the only
  // surface that could notice it, and it is flagged so no admin mistakes it for a usable invite.
  const junk = res.body.invites.find((i) => i.corrupt);
  assert.ok(junk, 'a structurally bad record is surfaced, not silently swallowed');
  assert.equal(junk.state, 'unknown');
  assert.equal(junk.key, 'JUNK33', 'the KV key is carried so it can be found even though the record disagrees');
});

test('membershipInviteUpdate revokes an unredeemed invite and is idempotent', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'invite:AAA111': JSON.stringify({ code: 'AAA111', campaign: 'CODEABLEYEAR', issuedAt: '2026-08-01T00:00:00.000Z', redeemedAt: null, revokedAt: null }),
  });
  const res = await membershipInviteUpdate(req({ code: 'aaa111', action: 'revoke' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.invite.state, INVITE_STATE.revoked);
  assert.equal(JSON.parse(kv.store.get('invite:AAA111')).revokedBy, '2002207');

  const again = await membershipInviteUpdate(req({ code: 'AAA111', action: 'revoke' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(again.status, 409, 'a second revoke reports rather than silently no-opping');
});

test('membershipInviteUpdate REFUSES to revoke a redeemed invite', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'invite:AAA111': JSON.stringify({ code: 'AAA111', campaign: 'CODEABLEYEAR', issuedAt: '2026-08-01T00:00:00.000Z', redeemedAt: '2026-08-02T00:00:00.000Z', redeemedBy: '42' }),
  });
  const res = await membershipInviteUpdate(req({ code: 'AAA111', action: 'revoke' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(res.status, 409, 'the live grant is taken back through the grandfather machinery, not here');
  assert.equal(JSON.parse(kv.store.get('invite:AAA111')).revokedAt, undefined, 'the record is untouched');
});

test('membershipInviteUpdate sets a note, sanitizes it, and reports an unchanged one honestly', async () => {
  const kv = fakeKv({
    'coupons:config': MIRROR,
    'invite:AAA111': JSON.stringify({ code: 'AAA111', campaign: 'CODEABLEYEAR', issuedAt: '2026-08-01T00:00:00.000Z', note: '' }),
  });
  const res = await membershipInviteUpdate(req({ code: 'AAA111', action: 'note', note: ' met at\nthe meetup ' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(res.body.invite.note, 'met at the meetup');

  const same = await membershipInviteUpdate(req({ code: 'AAA111', action: 'note', note: 'met at the meetup' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW });
  assert.equal(same.status, 200);
  assert.equal(same.body.changed, false);
});

test('membershipInviteUpdate rejects an unknown invite and an unknown action', async () => {
  const kv = fakeKv({ 'coupons:config': MIRROR });
  assert.equal((await membershipInviteUpdate(req({ code: 'NOPE99', action: 'revoke' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW })).status, 404);
  await kv.put('invite:AAA111', JSON.stringify({ code: 'AAA111', campaign: 'CODEABLEYEAR', issuedAt: NOW.toISOString() }));
  assert.equal((await membershipInviteUpdate(req({ code: 'AAA111', action: 'delete' }, 'PATCH'), env(kv), { authorize: okAuth, now: NOW })).status, 400);
});

test('every endpoint reports a missing edge store rather than throwing', async () => {
  for (const [fn, r] of [
    [membershipInviteCreate, req({ campaign: 'CODEABLEYEAR' })],
    [membershipInviteList, getReq()],
    [membershipInviteUpdate, req({ code: 'AAA111', action: 'revoke' }, 'PATCH')],
  ]) {
    const res = await fn(r, {}, { authorize: okAuth, now: NOW });
    assert.equal(res.status, 503, `${fn.name} degrades cleanly`);
  }
});
