// SOW-024: the KV prefix scan that every scan-and-scrub erasure step is built on, and the two reporting layers
// above it. The key list was already fail-closed (a failed page throws) but the per-key VALUE read silently
// dropped the key, so a record that could not be read was indistinguishable from a record that did not name the
// member. The step then reported its scrub count as success, summarizeStep flattened that to `ok`, and
// deriveAuditStatus totalled it to `complete`: three layers each of which turned "we could not look" into
// "there was nothing there". These tests pin all three.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  listKvByPrefix, eraseShareVotes, eraseNewsOpens, eraseContentOpens,
  scrubConversionSnapshots, minimizeRedeemedInvites, eraseReverseFollows, runErasure,
  readKvValueStrict, kvRestShim, findMemberSubscriberHashes, eraseCouponRedemptions, minimizeCouponGrant,
} from '../scripts/lib/erase-member.mjs';
import { deriveAuditStatus } from '../scripts/lib/erase-audit.mjs';

const CF = { CF_ACCOUNT_ID: 'acct', CF_KV_NAMESPACE_ID: 'ns', CF_API_TOKEN: 'tok' };

/** A KV REST fake. `values` maps key -> parsed value; a key in `unreadable` returns a 500 on its value read. */
function mkFetch({ keys = [], values = {}, unreadable = new Set(), unparsed = new Set() } = {}) {
  const writes = [];
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'PUT') { writes.push(url); return { ok: true }; }
    if (init.method === 'DELETE') return { ok: true };
    if (url.includes('/keys?')) {
      return { ok: true, json: async () => ({ result: keys.map((name) => ({ name })), result_info: { cursor: '' } }) };
    }
    const key = decodeURIComponent(url.split('/values/')[1]);
    if (unreadable.has(key)) return { ok: false, status: 500 };
    if (unparsed.has(key)) return { ok: true, status: 200, json: async () => 'a bare string, not an object', text: async () => '"a bare string, not an object"' };
    const v = values[key];
    // A genuinely MISSING key is a 404, which is what Cloudflare returns. Modelling it as a bare { ok: false }
    // would make it indistinguishable from a transient failure, which is the very thing under test here.
    if (v === undefined) return { ok: false, status: 404 };
    return { ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) };
  };
  return { fetchImpl, writes };
}

test('listKvByPrefix returns every listed key, and keys.length === entries.length + dropped', async () => {
  const keys = ['p:a', 'p:b', 'p:c'];
  const { fetchImpl } = mkFetch({ keys, values: { 'p:a': { x: 1 }, 'p:c': { x: 3 } }, unreadable: new Set(['p:b']) });
  const r = await listKvByPrefix({ prefix: 'p:', env: CF, fetchImpl });

  assert.deepEqual(r.keys, keys, 'every listed key is reported, including the one whose value could not be read');
  assert.equal(r.entries.length, 2);
  assert.equal(r.dropped, 1);
  assert.equal(r.keys.length, r.entries.length + r.dropped, 'the invariant an existence-checking caller relies on');
});

test('listKvByPrefix splits dropped by cause: unreadable is a blind spot, unparsed is schema drift', async () => {
  const { fetchImpl } = mkFetch({
    keys: ['p:a', 'p:b', 'p:c', 'p:d'],
    values: { 'p:a': { x: 1 } },
    unreadable: new Set(['p:b', 'p:c']),
    unparsed: new Set(['p:d']),
  });
  const r = await listKvByPrefix({ prefix: 'p:', env: CF, fetchImpl });
  assert.equal(r.unreadable, 2);
  assert.equal(r.unparsed, 1);
  assert.equal(r.dropped, 3, 'dropped stays the total so an existing caller reading it is unaffected');
});

test('listKvByPrefix still THROWS on a failed key-list page (a short list must never look like a short keyspace)', async () => {
  const fetchImpl = async (url) => (url.includes('/keys?') ? { ok: false, status: 500 } : { ok: true, json: async () => ({}) });
  await assert.rejects(() => listKvByPrefix({ prefix: 'p:', env: CF, fetchImpl }), /KV key list failed/);
});

test('missing CF creds report the no-op with the full shape, so a caller destructuring keys/dropped does not crash', async () => {
  const r = await listKvByPrefix({ prefix: 'p:', env: {} });
  assert.equal(r.available, false);
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.keys, []);
  assert.equal(r.dropped, 0);
  assert.equal(r.unreadable, 0);
});

// --- the six erasure callers: a record they could not read must not be reported as a clean run ---

const CALLERS = [
  ['eraseShareVotes', eraseShareVotes, 'upvotes:share:'],
  ['eraseNewsOpens', eraseNewsOpens, 'news-opens:'],
  ['eraseContentOpens', eraseContentOpens, 'content-opens:'],
  ['scrubConversionSnapshots', scrubConversionSnapshots, 'conv:'],
  ['minimizeRedeemedInvites', minimizeRedeemedInvites, 'invite:'],
  ['eraseReverseFollows', eraseReverseFollows, 'followers:'],
];

for (const [name, fn, prefix] of CALLERS) {
  test(`${name} reports incomplete when a record's value could not be read`, async () => {
    const keys = [`${prefix}a`, `${prefix}b`];
    const { fetchImpl } = mkFetch({ keys, values: { [`${prefix}a`]: {} }, unreadable: new Set([`${prefix}b`]) });
    const r = await fn({ githubId: '9', env: CF, fetchImpl });
    assert.equal(r.incomplete, true, `${name} must not report a clean run over a keyspace it could not fully read`);
    assert.equal(r.unreadable, 1);
    assert.match(r.reason, /could not be read and were NOT scrubbed/);
  });

  test(`${name} does NOT cry wolf when every value read succeeded`, async () => {
    const keys = [`${prefix}a`, `${prefix}b`];
    const { fetchImpl } = mkFetch({ keys, values: { [`${prefix}a`]: {}, [`${prefix}b`]: {} } });
    const r = await fn({ githubId: '9', env: CF, fetchImpl });
    assert.ok(!r.incomplete, `${name} flagged a complete scan as incomplete; a guard that cries wolf gets disabled`);
  });
}

test('an unparsed value alone does not flag incomplete: it was read, it is simply not this step\'s shape', async () => {
  const { fetchImpl } = mkFetch({
    keys: ['upvotes:share:a', 'upvotes:share:b'],
    values: { 'upvotes:share:a': {} },
    unparsed: new Set(['upvotes:share:b']),
  });
  const r = await eraseShareVotes({ githubId: '9', env: CF, fetchImpl });
  assert.ok(!r.incomplete, 'schema drift is not a blind spot; failing closed on it would make the guard noise');
});

// --- the two reporting layers above the steps ---

test('deriveAuditStatus refuses to total an incomplete step up to `complete`', () => {
  assert.equal(deriveAuditStatus([{ outcome: 'deleted' }, { outcome: 'incomplete' }]), 'partial');
  assert.equal(deriveAuditStatus([{ outcome: 'incomplete' }]), 'partial');
  // unchanged for everything else
  assert.equal(deriveAuditStatus([{ outcome: 'deleted' }]), 'complete');
  assert.equal(deriveAuditStatus([{ outcome: 'error' }]), 'failed');
});

test('END TO END: an unreadable record surfaces as an incomplete step and a partial audit, not ok/complete', async () => {
  // followers:b cannot be read. The run must still do its other work, and must still record an audit, but the
  // artifact must say partial. This is the assertion that would have caught all three layers at once.
  const keys = ['followers:a', 'followers:b'];
  const { fetchImpl } = mkFetch({ keys, values: { 'followers:a': { followers: [] } }, unreadable: new Set(['followers:b']) });
  const r = await runErasure({ githubId: '9', username: 'alice', apply: true, env: CF, fetchImpl, clients: {}, files: [] });

  const step = r.steps.find((s) => s.step === 'reverse-follows');
  assert.ok(step, 'the reverse-follows step ran');
  assert.equal(step.outcome, 'incomplete', 'a keyspace we could not fully read is not an `ok` step');
  assert.match(step.detail, /could not be read/);
  assert.equal(r.record.status, 'partial', 'the compliance artifact must not claim a complete erasure');
});

// ---------------------------------------------------------------------------------------------------------
// The SECOND fail-open, found by QAmaster: readKvValue collapses "absent" and "read failed" into one null.
// Three erasure sites depended on that null, and one of them WROTE from it. These tests drive the REAL adapter
// rather than a test double, because the previous double threw where the adapter returned null, so the whole
// existing suite passed identically with the bug present and with it fixed.
// ---------------------------------------------------------------------------------------------------------

test('readKvValueStrict keeps a 404 (absent) apart from a 500 (we cannot tell)', async () => {
  const at = async (status) => readKvValueStrict({ key: 'k', env: CF, fetchImpl: async () => ({ ok: status === 200, status, text: async () => 'v' }) });
  const absent = await at(404);
  assert.equal(absent.ok, true, 'a 404 is a definite answer: the key is not there');
  assert.equal(absent.value, null);
  const failed = await at(500);
  assert.equal(failed.ok, false, 'a 500 tells us nothing about what the key holds');
  const found = await at(200);
  assert.deepEqual([found.ok, found.value], [true, 'v']);
});

test('kvRestShim.get THROWS on an unreadable key and returns null only for a genuine miss', async () => {
  const shim = (status) => kvRestShim({ env: CF, fetchImpl: async () => ({ ok: status === 200, status, text: async () => '{"a":1}' }) });
  assert.equal(await shim(404).get('k', 'json'), null, 'a miss is still a null, matching real Workers KV');
  await assert.rejects(() => shim(500).get('k', 'json'), /KV read failed/);
  assert.deepEqual(await shim(200).get('k', 'json'), { a: 1 });
});

test('findMemberSubscriberHashes is fail-closed THROUGH THE REAL SHIM, not just through a throwing double', async () => {
  // The bug this pins: the shim returned null on a failed read, so the fail-closed catch inside the scan was
  // unreachable on the script path and an unreadable subscriber record was reported as a clean, complete scan.
  const mk = (valueOk) => kvRestShim({
    env: CF,
    fetchImpl: async (url) => {
      if (url.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: [{ name: 'mail:subscriber:aaa' }], list_complete: true }) };
      if (!valueOk) return { ok: false, status: 500 };
      return { ok: true, status: 200, text: async () => JSON.stringify({ source: 'member', githubId: '9', hash: 'aaa' }) };
    },
  });

  const broken = await findMemberSubscriberHashes(mk(false), { githubId: '9' });
  assert.equal(broken.ok, false, 'an unreadable subscriber record must not yield a clean scan');
  assert.match(broken.error, /subscriber read failed/);

  // CONTROL: an empty hashes list proves nothing on its own. With the read succeeding, the same probe finds the
  // record, so the refusal above is caused by the failed read and not by the harness never matching anything.
  const ok = await findMemberSubscriberHashes(mk(true), { githubId: '9' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.hashes, ['aaa'], 'the control finds the record the broken case could not read');
});

test('eraseCouponRedemptions never writes a SHARED counter it could not read', async () => {
  // The destructive one. A failed read made Number(null) || 0 === 0, and the decrement wrote "0" over a counter
  // holding every other member's redemptions, handing back the whole capacity of a capped coupon.
  const puts = [];
  const mk = (counterOk) => async (url, init = {}) => {
    if (init.method === 'PUT') { puts.push({ key: decodeURIComponent(url.split('/values/')[1]), body: init.body }); return { ok: true }; }
    if (init.method === 'DELETE') return { ok: true };
    if (url.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: [{ name: 'redemption:CAPPED:9' }], result_info: {} }) };
    const key = decodeURIComponent(url.split('/values/')[1]);
    if (key === 'redemptions:CAPPED') {
      return counterOk ? { ok: true, status: 200, text: async () => '47' } : { ok: false, status: 500 };
    }
    const v = { code: 'CAPPED', githubId: '9', until: '2027-01-01T00:00:00.000Z' };
    return { ok: true, status: 200, json: async () => v, text: async () => JSON.stringify(v) };
  };

  const broken = await eraseCouponRedemptions({ githubId: '9', env: CF, fetchImpl: mk(false) });
  assert.equal(broken.incomplete, true, 'an undecremented counter must be reported, not silently passed over');
  assert.match(broken.reason, /NOT decremented/);
  assert.equal(puts.filter((p) => p.key.startsWith('redemptions:')).length, 0,
    'a counter we could not read must NEVER be written: writing 0 uncaps the coupon for everyone else');

  // CONTROL: with the counter readable the decrement still happens, so the refusal above is the failed read.
  puts.length = 0;
  const ok = await eraseCouponRedemptions({ githubId: '9', env: CF, fetchImpl: mk(true) });
  assert.ok(!ok.incomplete);
  assert.equal(puts.find((p) => p.key === 'redemptions:CAPPED').body, '46', '47 -> 46');
});

test('eraseReverseFollows reports the member\'s OWN follower list when it could not be read', async () => {
  const fetchImpl = async (url, init = {}) => {
    if (init.method === 'DELETE' || init.method === 'PUT') return { ok: true };
    if (url.includes('/keys?')) return { ok: true, status: 200, json: async () => ({ result: [], result_info: {} }) };
    return { ok: false, status: 500 }; // the inbound followers:9 read fails
  };
  const r = await eraseReverseFollows({ githubId: '9', env: CF, fetchImpl });
  assert.equal(r.incomplete, true);
  assert.match(r.reason, /followers:9 could not be read and was NOT deleted/);
  assert.equal(r.inboundDeleted, false);
});

test('minimizeCouponGrant does not report "no grant to minimize" when it could not read the grant', async () => {
  const env = { ...CF, COUPON_LOCK_KEY: 'a'.repeat(64) };
  const r = await minimizeCouponGrant({ githubId: '9', env, fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(r.incomplete, true, '"we could not look" is not "there was nothing there"');
  assert.ok(!r.skipped);
  // CONTROL: a genuine 404 IS a definite absence and stays a clean skip.
  const absent = await minimizeCouponGrant({ githubId: '9', env, fetchImpl: async () => ({ ok: false, status: 404 }) });
  assert.equal(absent.skipped, true);
  assert.match(absent.reason, /no coupon grant/);
});
