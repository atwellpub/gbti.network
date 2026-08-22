// SOW-166 right-to-erasure for the weekly digest, and the ORDERING CONSTRAINT that makes it work at all.
//
// The mail keyspace is derived from the ADDRESS via mailHash, while erasure is driven by github_id. Nothing in
// it can be located from a github_id alone, and the only readable copy of the address is the Stripe customer.
// The erasure plan DELETES that customer. So a mail step placed after it computes a key from something that no
// longer exists and strands the records permanently, unreachable by any future run. Each step looks correct on
// its own, which is exactly why the order is asserted here rather than left in a comment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kvRestShim, eraseMailRecords, planErasure, runErasure } from '../scripts/lib/erase-member.mjs';
import { mailHash, subscriberKey, suppressKey } from '../membership/mail-suppress.mjs';

const ENV = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok', MAIL_SUPPRESS_KEY: 'suppress-key' };
const ADDRESS = 'someone@example.com';

/** An in-memory stand-in for the Cloudflare KV REST API, shaped like the real endpoints the shim calls. */
function fakeKvRest(initial = {}) {
  const store = new Map(Object.entries(initial));
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    calls.push(`${method} ${url}`);
    const u = new URL(url);
    if (u.pathname.endsWith('/keys')) {
      const prefix = u.searchParams.get('prefix') || '';
      const result = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { ok: true, status: 200, json: async () => ({ result, result_info: { cursor: '' } }) };
    }
    const key = decodeURIComponent(u.pathname.split('/values/')[1] || '');
    if (method === 'GET') {
      if (!store.has(key)) return { ok: false, status: 404, text: async () => null };
      return { ok: true, status: 200, text: async () => store.get(key) };
    }
    if (method === 'PUT') { store.set(key, opts.body); return { ok: true, status: 200, text: async () => '' }; }
    if (method === 'DELETE') { store.delete(key); return { ok: true, status: 200, text: async () => '' }; }
    return { ok: false, status: 405, text: async () => '' };
  };
  return { store, calls, fetchImpl };
}

const stripeWith = (customer) => ({ async findCustomerByGithubId() { return customer; } });

test('sow-166 erasure: the subscriber record and every send record go; the suppression marker STAYS', async () => {
  const hash = await mailHash(ENV.MAIL_SUPPRESS_KEY, ADDRESS);
  const { store, fetchImpl } = fakeKvRest({
    [subscriberKey(hash)]: JSON.stringify({ hash, source: 'member', githubId: '42' }),
    [suppressKey(hash)]: '1',
    'mail:issue:2026-W34': JSON.stringify({ issueId: '2026-W34' }),
    'mail:issue:2026-W35': JSON.stringify({ issueId: '2026-W35' }),
    [`mail:send:2026-W34:${hash}`]: JSON.stringify({ issueId: '2026-W34', recipientHash: hash }),
    [`mail:send:2026-W35:${hash}`]: JSON.stringify({ issueId: '2026-W35', recipientHash: hash }),
    'mail:send:2026-W34:otherperson': JSON.stringify({ recipientHash: 'otherperson' }),
  });

  const r = await eraseMailRecords({ githubId: '42', stripe: stripeWith({ id: 'cus_1', email: ADDRESS }), env: ENV, fetchImpl });

  assert.equal(r.subscriber, 1, 'the subscriber record was found and deleted');
  assert.equal(r.sends, 2, 'both send records were deleted');
  assert.equal(store.has(subscriberKey(hash)), false, 'the record holding githubId + customerId is gone');
  assert.equal(store.has(`mail:send:2026-W34:${hash}`), false);
  assert.equal(store.has(`mail:send:2026-W35:${hash}`), false);

  assert.equal(store.has(suppressKey(hash)), true, 'THE MARKER SURVIVES: deleting it silently re-contacts someone who opted out');
  assert.equal(store.has('mail:send:2026-W34:otherperson'), true, 'and nobody else in the same issue is touched');
});

test('sow-166 erasure: THE ORDERING. The mail step precedes the stripe step in the dry-run plan', () => {
  const steps = planErasure({ githubId: '42', username: 'someone' }).map((s) => s.step);
  const mail = steps.indexOf('mail');
  const stripe = steps.indexOf('stripe');
  assert.ok(mail >= 0, 'the plan must MENTION the mail records at all; omitting them was the original gap');
  assert.ok(stripe >= 0, 'and the stripe delete is still planned');
  assert.ok(mail < stripe, 'mail BEFORE stripe: after the customer is deleted the address, and so the key, is gone forever');
});

test('sow-166 erasure: THE ORDERING, in the orchestrator and not only the plan', async () => {
  // The plan is prose that a human reads. This asserts the code path itself, because the two can drift and
  // only one of them actually deletes anything.
  const hash = await mailHash(ENV.MAIL_SUPPRESS_KEY, ADDRESS);
  const { fetchImpl } = fakeKvRest({ [subscriberKey(hash)]: JSON.stringify({ hash }) });
  const order = [];
  const stripe = {
    async findCustomerByGithubId() { order.push('stripe-read'); return { id: 'cus_1', email: ADDRESS }; },
    async deleteCustomer() { order.push('stripe-delete'); return {}; },
  };

  const res = await runErasure({
    githubId: '42', username: 'someone', apply: true, deleteStripe: true, operator: 'test',
    clients: { stripe, github: null, discord: null }, env: ENV, fetchImpl, files: [],
  });

  const names = res.steps.map((s) => s.step);
  assert.ok(names.indexOf('mail') < names.indexOf('stripe'), `mail must run before stripe, got ${names.join(' -> ')}`);
  assert.ok(order.indexOf('stripe-read') < order.indexOf('stripe-delete'), 'the address is read while the customer still exists');
});

// CONTRACT CHANGED 2026-08-22, and the ORIGINAL INTENT OF THESE TWO TESTS IS PRESERVED RATHER THAN DROPPED.
// They asserted that every refusal says why, so "nothing to delete" never looks like "we could not tell". That
// is still the rule. What changed is that four of the five old refusals ARE NO LONGER REFUSALS: erasure now
// finds a member's records by scanning mail:subscriber:* for their githubId, which needs neither Stripe nor
// MAIL_SUPPRESS_KEY. Those four cases used to mean a whole class of member could not be erased AT ALL while the
// run reported a clean skip, which is the exact failure the original tests were written to prevent, arriving
// one level up. So they now assert that erasure SUCCEEDS in those cases and that the audit still records which
// paths were used.
const MEMBER_REC = (githubId) => JSON.stringify({ hash: 'aaa', source: 'member', status: 'active', githubId, customerId: null, createdAt: 1, updatedAt: 1 });

test('sow-166 erasure: the only remaining refusals are the ones nothing can work around, and they say why', async () => {
  const { fetchImpl } = fakeKvRest();
  const cases = [
    ['no CF creds', { env: { MAIL_SUPPRESS_KEY: 'k' }, stripe: stripeWith({ id: 'c', email: ADDRESS }) }, /CF_ACCOUNT_ID/],
    ['no github_id', { githubId: '', env: ENV, stripe: stripeWith({ id: 'c', email: ADDRESS }) }, /github_id/],
  ];
  for (const [label, opts, expected] of cases) {
    const r = await eraseMailRecords({ githubId: '42', fetchImpl, ...opts });
    assert.equal(r.skipped, true, `${label} must be a reported skip`);
    assert.match(r.reason, expected, `${label} must say why`);
  }
});

test('sow-166 erasure: the four OLD refusals now ERASE, and the audit says which paths ran', async () => {
  // Each of these previously returned skipped:true and deleted nothing.
  const cases = [
    ['no MAIL_SUPPRESS_KEY', { env: { ...ENV, MAIL_SUPPRESS_KEY: '' }, stripe: stripeWith({ id: 'c', email: ADDRESS }) }],
    ['no Stripe client', { env: ENV, stripe: null }],
    ['customer already deleted', { env: ENV, stripe: stripeWith(null) }],
    ['customer has no email', { env: ENV, stripe: stripeWith({ id: 'c' }) }],
  ];
  for (const [label, opts] of cases) {
    const { fetchImpl, store } = fakeKvRest({ 'mail:subscriber:aaa': MEMBER_REC('42'), 'mail:suppress:aaa': '1' });
    const r = await eraseMailRecords({ githubId: '42', fetchImpl, ...opts });
    assert.notEqual(r.skipped, true, `${label}: must no longer refuse`);
    assert.equal(r.matched, 1, `${label}: the record must be found by the scan`);
    assert.equal(store.has('mail:subscriber:aaa'), false, `${label}: and actually deleted`);
    assert.equal(store.has('mail:suppress:aaa'), true, `${label}: the suppression marker must SURVIVE`);
    assert.equal(r.suppressionMarkerKept, true);
  }
});

test('sow-166 erasure: a Stripe failure is SURFACED in the audit and no longer blocks erasure', async () => {
  const { fetchImpl, store } = fakeKvRest({ 'mail:subscriber:aaa': MEMBER_REC('42') });
  const stripe = { async findCustomerByGithubId() { throw new Error('rate limited'); } };
  const r = await eraseMailRecords({ githubId: '42', stripe, env: ENV, fetchImpl });
  assert.match(r.stripe, /rate limited/, 'a lookup failure must still surface in the audit');
  assert.equal(r.matched, 1, 'but the scan does not depend on Stripe, so erasure proceeds');
  assert.equal(store.has('mail:subscriber:aaa'), false);
});

test('sow-166 erasure: a FAILED SCAN is an error and deletes nothing (the new "we could not tell")', async () => {
  // The original concern, relocated to where it now lives. A scan that could not read the keyspace must never
  // report matched:0, because for erasure "found none" and "could not look" are indistinguishable from outside
  // and only one of them means the person's records are gone.
  const { store } = fakeKvRest({ 'mail:subscriber:aaa': MEMBER_REC('42') });
  const failing = async (url, opts = {}) => {
    if (new URL(url).pathname.endsWith('/keys')) throw new Error('kv list unavailable');
    return { ok: false, status: 500, text: async () => '' };
  };
  const r = await eraseMailRecords({ githubId: '42', stripe: null, env: ENV, fetchImpl: failing });
  assert.ok(r.error, 'must surface the failure');
  assert.equal(r.matched, undefined, 'and must not claim a match count');
  assert.equal(store.has('mail:subscriber:aaa'), true, 'nothing may be deleted on a failed scan');
});

test('sow-166 shim: get honours the json type argument, exactly as a Workers KV binding does', async () => {
  // mail-store.mjs uses BOTH kv.get(k, "json") and kv.get(k). A shim that ignored the type would return a raw
  // string where an object was expected, every parse downstream would yield null, and the erasure would report
  // success having deleted nothing.
  const { fetchImpl } = fakeKvRest({ k: JSON.stringify({ a: 1 }), bad: 'not json' });
  const kv = kvRestShim({ env: ENV, fetchImpl });
  assert.deepEqual(await kv.get('k', 'json'), { a: 1 });
  assert.equal(await kv.get('k'), '{"a":1}', 'no type argument returns TEXT, like the real binding');
  assert.equal(await kv.get('bad', 'json'), null, 'unparseable json is null, not a throw');
  assert.equal(await kv.get('missing', 'json'), null);
  assert.equal(await kv.get('missing'), null);
});

test('sow-166 shim: list is keys-only and cannot drop a key whose value is unparseable', async () => {
  // listKvByPrefix, which this deliberately does NOT reuse, fetches every value and discards entries whose
  // value is not a JSON object. Here that would silently skip an issue with a corrupt body, and with it that
  // issue's send record for the person being erased.
  const { store, fetchImpl } = fakeKvRest({
    'mail:issue:good': JSON.stringify({ issueId: 'good' }),
    'mail:issue:corrupt': 'this is not json at all',
    'other:key': 'x',
  });
  const kv = kvRestShim({ env: ENV, fetchImpl });
  const res = await kv.list({ prefix: 'mail:issue:' });
  assert.deepEqual(res.keys.map((k) => k.name).sort(), ['mail:issue:corrupt', 'mail:issue:good']);
  assert.equal(res.list_complete, true);

  // And end to end: the corrupt issue's send record is still erased.
  const hash = await mailHash(ENV.MAIL_SUPPRESS_KEY, ADDRESS);
  store.set(subscriberKey(hash), JSON.stringify({ hash }));
  store.set(`mail:send:corrupt:${hash}`, JSON.stringify({ recipientHash: hash }));
  const r = await eraseMailRecords({ githubId: '42', stripe: stripeWith({ id: 'c', email: ADDRESS }), env: ENV, fetchImpl });
  assert.equal(r.sends, 1, 'the send record under the unparseable issue was still found and deleted');
  assert.equal(store.has(`mail:send:corrupt:${hash}`), false);
});

test('sow-166 shim: no CF credentials yields null rather than a half-working client', async () => {
  assert.equal(kvRestShim({ env: {} }), null);
  assert.equal(kvRestShim({ env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n' } }), null, 'a partial trio is not a client');
});
