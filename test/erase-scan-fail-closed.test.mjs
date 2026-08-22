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
    if (unparsed.has(key)) return { ok: true, json: async () => 'a bare string, not an object' };
    return { ok: true, json: async () => values[key] ?? {} };
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
