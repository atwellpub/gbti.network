// sow-166 follow-up: the admin-gated MANUAL mail triggers. Before this route, compileWeeklyIssue and drainMail
// were reachable only from the cron map, so the first end-to-end proof of the mail chain could not happen
// before the next Tuesday 14:00 UTC. Pure over injected authorize/compile/drain/kv; no network, no secrets.
//
// The load-bearing test in this file is the rehearsal-id one. A real compile fired on an off day becomes
// Tuesday's PRIOR issue and consumes the 90-day inaugural back catalogue, so the rehearsal would silently
// spend the send it was rehearsing for. `test-compile` mints an id listPriorIssueIds cannot count, and that
// property is asserted here rather than trusted from a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminMail, testIssueId } from '../workers/signup/membership-admin-mail.mjs';

const req = (body) => ({ headers: { get: () => 'Bearer t' }, json: async () => body });
const okAuth = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const denyAuth = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'admin access is required' } });
const COMPILED = { ok: true, issueId: 'weekly-2026-08-25', composed: true, recipients: 3, enqueued: 3, pending: 3, recipientsTruncated: false, recipientReadErrors: 0 };

test('admin-mail: a non-admin is forbidden BEFORE any compile or drain runs', async () => {
  let ran = false;
  const r = await membershipAdminMail(req({ action: 'compile' }), {}, {
    authorize: denyAuth,
    compile: async () => { ran = true; return COMPILED; },
    drain: async () => { ran = true; return {}; },
  });
  assert.equal(r.status, 403);
  assert.equal(ran, false, 'the gate must run first: a denied caller never reaches the mail functions');
});

test('admin-mail: an unknown action is refused and runs nothing', async () => {
  let ran = false;
  const r = await membershipAdminMail(req({ action: 'send-everything' }), {}, {
    authorize: okAuth, compile: async () => { ran = true; return COMPILED; }, drain: async () => { ran = true; return {}; },
  });
  assert.equal(r.status, 400);
  assert.equal(ran, false);
});

test('admin-mail: compile calls the real weekly compile with NO id override (the cron path, unchanged)', async () => {
  let opts = 'unset';
  const r = await membershipAdminMail(req({ action: 'compile' }), {}, {
    authorize: okAuth, compile: async (_env, o) => { opts = o; return COMPILED; },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.issueId, 'weekly-2026-08-25');
  assert.deepEqual(opts, {}, 'a plain compile must not pass an issueId, so the date-derived id is used');
});

test('admin-mail: compile surfaces recipientsTruncated at the top level (a short base under-sends silently)', async () => {
  const r = await membershipAdminMail(req({ action: 'compile' }), {}, {
    authorize: okAuth,
    compile: async () => ({ ...COMPILED, recipientsTruncated: true, recipientReadErrors: 2 }),
  });
  assert.equal(r.body.recipientsTruncated, true);
  assert.equal(r.body.recipientReadErrors, 2);
});

test('admin-mail: a compile reporting ok:false is reported as ok:false, not laundered into a success', async () => {
  const r = await membershipAdminMail(req({ action: 'compile' }), {}, {
    authorize: okAuth, compile: async () => ({ ok: false, reason: 'no kv' }),
  });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.reason, 'no kv');
});

// THE REHEARSAL-ID PROPERTY. listPriorIssueIds (mail-compile.mjs) counts only canonical `weekly-YYYY-MM-DD`
// ids that sort STRICTLY BEFORE the current one. Both halves are asserted: the shape is not `weekly-`, and a
// real weekly id does not sort before a rehearsal id, so a rehearsal can never become a weekly issue's prior.
test('admin-mail: test-compile mints an id the weekly exclude window cannot count', async () => {
  let opts = null;
  const r = await membershipAdminMail(req({ action: 'test-compile' }), {}, {
    authorize: okAuth,
    now: () => Date.UTC(2026, 7, 23),
    compile: async (_env, o) => { opts = o; return { ...COMPILED, issueId: o.issueId }; },
  });
  assert.equal(r.status, 200);
  assert.equal(opts.issueId, 'test-2026-08-23');
  assert.ok(!opts.issueId.startsWith('weekly-'), 'a rehearsal id must fail the canonical shape filter');
  assert.ok(!('weekly-2026-08-25' < opts.issueId), 'a later weekly id must NOT sort before the rehearsal id');
  assert.ok(!('weekly-2026-08-16' < opts.issueId), 'an earlier weekly id must NOT sort before it either');
});

test('admin-mail: testIssueId is UTC-date derived and rejects a non-finite time', async () => {
  assert.equal(testIssueId(Date.UTC(2026, 0, 5)), 'test-2026-01-05');
  assert.throws(() => testIssueId(NaN), /finite/);
});

test('admin-mail: test-compile refuses an explicit id that is not a rehearsal id', async () => {
  let ran = false;
  const r = await membershipAdminMail(req({ action: 'test-compile', issueId: 'weekly-2026-08-25' }), {}, {
    authorize: okAuth, compile: async () => { ran = true; return COMPILED; },
  });
  assert.equal(r.status, 400);
  assert.equal(ran, false, 'the real weekly issue must be unreachable through the rehearsal action');
});

test('admin-mail: drain runs the injected drain, and issueId narrows it', async () => {
  let seen = 'unset';
  const drain = async (_env, o) => { seen = o; return { drained: 1, sent: 1 }; };
  const all = await membershipAdminMail(req({ action: 'drain' }), {}, { authorize: okAuth, drain });
  assert.equal(all.status, 200);
  assert.deepEqual(seen, {}, 'no issueId means drain every active issue, as the 5-minute tick does');
  const one = await membershipAdminMail(req({ action: 'drain', issueId: 'test-2026-08-23' }), {}, { authorize: okAuth, drain });
  assert.equal(one.body.sent, 1);
  assert.deepEqual(seen, { issueId: 'test-2026-08-23' });
});

test('admin-mail: an unwired drain is a clean misconfiguration, never an improvised second send path', async () => {
  const r = await membershipAdminMail(req({ action: 'drain' }), {}, { authorize: okAuth });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'misconfigured');
});

// DISCARD. The prefix guard is the only thing standing between this route and a real issue, so it is asserted
// against a real weekly id, not merely against a malformed one.
test('admin-mail: discard removes the rehearsal issue, its pending index and its send records', async () => {
  const deleted = [];
  const kv = {
    list: async ({ prefix, cursor }) => (cursor ? { keys: [], list_complete: true }
      : { keys: [{ name: `${prefix}aaa` }, { name: `${prefix}bbb` }], list_complete: true }),
    delete: async (k) => { deleted.push(k); },
  };
  const r = await membershipAdminMail(req({ action: 'discard', issueId: 'test-2026-08-23' }), {}, { authorize: okAuth, kv });
  assert.equal(r.status, 200);
  assert.equal(r.body.deleted, 4);
  assert.equal(r.body.errors, 0);
  assert.deepEqual(deleted, [
    'mail:send:test-2026-08-23:aaa',
    'mail:send:test-2026-08-23:bbb',
    'mail:pending:test-2026-08-23',
    'mail:issue:test-2026-08-23',
  ]);
});

test('admin-mail: discard REFUSES a real weekly issue and deletes nothing', async () => {
  const deleted = [];
  const kv = { list: async () => ({ keys: [], list_complete: true }), delete: async (k) => { deleted.push(k); } };
  const r = await membershipAdminMail(req({ action: 'discard', issueId: 'weekly-2026-08-25' }), {}, { authorize: okAuth, kv });
  assert.equal(r.status, 400);
  assert.deepEqual(deleted, [], 'a real issue must be unreachable from this route');
});

test('admin-mail: discard without an issueId is refused', async () => {
  const r = await membershipAdminMail(req({ action: 'discard' }), {}, { authorize: okAuth, kv: {} });
  assert.equal(r.status, 400);
});

test('admin-mail: a thrown compile is a 500 with the reason, not a silent success', async () => {
  const r = await membershipAdminMail(req({ action: 'compile' }), {}, {
    authorize: okAuth, compile: async () => { throw new Error('kv exploded'); },
  });
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'mail_trigger_failed');
  assert.match(r.body.message, /kv exploded/);
});
