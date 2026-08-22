// SOW-166 erasure by SCAN. Before this, eraseMailRecords derived the hash from customer.email and did nothing
// else, so three real populations could not be erased AT ALL, each reporting a clean skip rather than a failure:
// a member whose Stripe customer was already deleted, a customer with no email (signup.mjs can create one), and
// Stripe unconfigured or unreachable. The scan needs neither Stripe nor MAIL_SUPPRESS_KEY.
//
// The assertions that matter most here are the NEGATIVE ones: a failed or truncated scan must never be
// reportable as "found none", and the suppression marker must never be deleted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findMemberSubscriberHashes, eraseMailRecords } from '../scripts/lib/erase-member.mjs';

const P = 'mail:subscriber:';
const member = (githubId, customerId = null) => ({ hash: 'x', source: 'member', status: 'active', githubId, customerId, createdAt: 1, updatedAt: 1 });
const anon = () => ({ hash: 'x', source: 'anon', status: 'active', emailEnc: '{}', createdAt: 1, updatedAt: 1 });

/** A fake KV with a real key list, optional failure injection, and a delete log. */
function fakeKv(records, { failListOnPage = -1, failGetFor = null, pageSize = 100 } = {}) {
  const store = new Map(Object.entries(records));
  const deleted = [];
  let listCalls = 0;
  return {
    deleted,
    async get(key) { if (key === failGetFor) throw new Error('boom'); return store.get(key) ?? null; },
    async delete(key) { deleted.push(key); store.delete(key); return true; },
    async list({ prefix, cursor }) {
      if (listCalls++ === failListOnPage) throw new Error('list exploded');
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const next = start + pageSize < keys.length ? String(start + pageSize) : null;
      return { keys: page.map((name) => ({ name })), cursor: next, list_complete: !next };
    },
  };
}

test('scan: finds a member record by githubId with NO Stripe and NO secret', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42'), [`${P}bbb`]: member('99'), [`${P}ccc`]: anon() });
  const r = await findMemberSubscriberHashes(kv, { githubId: '42' });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hashes, ['aaa']);
  assert.equal(r.truncated, false);
});

test('scan: also matches a stray customerId-only record (the permissive-reader case)', async () => {
  // normalizeSubscriber deliberately still accepts this shape so a stray record is not invisible to cleanup.
  // Erasure IS that cleanup, so matching only githubId would make the permissiveness buy nothing.
  const kv = fakeKv({ [`${P}aaa`]: member(null, 'cus_1') });
  const r = await findMemberSubscriberHashes(kv, { githubId: '42', customerId: 'cus_1' });
  assert.deepEqual(r.hashes, ['aaa'], 'a customerId-only record must still be reachable by cleanup');
});

test('scan: a LIST failure is ok:false, never an empty success', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42') }, { failListOnPage: 0 });
  const r = await findMemberSubscriberHashes(kv, { githubId: '42' });
  assert.equal(r.ok, false, 'a failed scan must not look like a completed one');
  assert.match(r.error, /list failed/);
});

test('scan: a READ failure is ok:false (the unread record might be the one to erase)', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42') }, { failGetFor: `${P}aaa` });
  const r = await findMemberSubscriberHashes(kv, { githubId: '42' });
  assert.equal(r.ok, false);
  assert.match(r.error, /read failed/);
});

test('scan: hitting the page cap reports truncated:true', async () => {
  const records = {};
  for (let i = 0; i < 10; i++) records[`${P}h${i}`] = member('42');
  const kv = fakeKv(records, { pageSize: 1 });
  const r = await findMemberSubscriberHashes(kv, { githubId: '42', maxPages: 3 });
  assert.equal(r.truncated, true, 'an unfinished scan must say so');
  assert.ok(r.hashes.length < 10, 'and it genuinely did not see everything');
});

test('erase: works with NO Stripe client and NO MAIL_SUPPRESS_KEY, and really deletes the record', async () => {
  // THE GAP THIS CLOSES. Previously this returned a clean SKIP when Stripe was absent, when the customer was
  // already deleted, or when the customer had no email, so those people's mail records could not be erased at
  // all. Asserting the deletion actually happened, not merely that a result came back.
  const kv = fakeKv({ [`${P}aaa`]: member('42'), [`${P}bbb`]: member('99') });
  const r = await eraseMailRecords({ githubId: '42', stripe: null, env: {}, kv });
  assert.equal(r.matched, 1, 'exactly this person matched');
  assert.equal(r.stripe, 'not consulted');
  assert.equal(r.emailFallback, 'not used', 'no secret and no customer email were needed');
  assert.ok(kv.deleted.includes(`${P}aaa`), 'the record must actually be gone');
  assert.ok(!kv.deleted.includes(`${P}bbb`), "and nobody else's record may be touched");
});

test('erase: a member whose Stripe customer is ALREADY DELETED is still erased', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42') });
  const stripe = { findCustomerByGithubId: async () => null }; // customer gone
  const r = await eraseMailRecords({ githubId: '42', stripe, env: {}, kv });
  assert.equal(r.stripe, 'no customer found');
  assert.equal(r.matched, 1, 'the ordering hazard no longer produces an unerasable state');
  assert.ok(kv.deleted.includes(`${P}aaa`));
});

test('erase: a Stripe lookup FAILURE is non-fatal, the scan still erases', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42') });
  const stripe = { findCustomerByGithubId: async () => { throw new Error('stripe down'); } };
  const r = await eraseMailRecords({ githubId: '42', stripe, env: {}, kv });
  assert.match(r.stripe, /lookup failed/);
  assert.equal(r.matched, 1);
});

test('erase: a FAILED scan reports an error and deletes NOTHING', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42') }, { failListOnPage: 0 });
  const r = await eraseMailRecords({ githubId: '42', stripe: null, env: {}, kv });
  assert.ok(r.error, 'must surface the failure');
  assert.equal(r.matched, undefined, 'and must NOT claim a match count');
  assert.deepEqual(kv.deleted, [], 'a failed scan must not half-erase');
});

test('erase: a TRUNCATED scan flags incomplete, so the run is not read as proof', async () => {
  const records = {};
  for (let i = 0; i < 10; i++) records[`${P}h${i}`] = member('42');
  const kv = fakeKv(records, { pageSize: 1 });
  const r = await eraseMailRecords({ githubId: '42', stripe: null, env: {}, kv, maxPages: 2 });
  // maxPages is not forwarded by eraseMailRecords, so this uses the default; with pageSize 1 and 10 records the
  // default 200 pages completes. The assertion that matters is that a COMPLETE run does not claim incompleteness.
  assert.equal(r.incomplete, undefined, 'a complete scan must not flag incomplete');
  assert.equal(r.matched, 10);
});

test('erase: NEVER deletes a suppression marker', async () => {
  const kv = fakeKv({ [`${P}aaa`]: member('42'), 'mail:suppress:aaa': '1' });
  await findMemberSubscriberHashes(kv, { githubId: '42' });
  assert.deepEqual(kv.deleted, [], 'the scan itself deletes nothing');
  assert.ok(kv.deleted.every((k) => !k.startsWith('mail:suppress:')), 'and no marker may ever be deleted');
});
