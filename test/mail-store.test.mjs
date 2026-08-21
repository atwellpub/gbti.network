// SOW-166: the KV persistence layer for the digest send engine. Fake KV, injected now. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getIssue, putIssue, getSend, putSend, readPendingIndex, removeFromPending,
  enqueueIssue, activeIssueIds, getSubscriber, putSubscriber, eraseSubscriber, eraseSubscriberMail, readBudget, bumpBudget, MAIL_PENDING_KEY,
} from '../workers/signup/mail-store.mjs';
import { sendKey, markSent, budgetDayKey, budgetMonthKey } from '../membership/mail-queue.mjs';
import { subscriberKey, suppressKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';

const at = (t) => () => t;

// A fake KV that records put options (so a terminal record's TTL is assertable) and supports prefix list.
function makeKV({ throwOn = () => false } = {}) {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      if (throwOn(key)) throw new Error('kv get failed');
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
      return e.value;
    },
    async put(key, value, opts) { m.set(key, { value: String(value), opts: opts || null }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '', cursor } = {}) {
      const keys = [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true };
    },
  };
}

const issueOf = (id) => ({ issueId: id, sections: { article: [], product: [], prompt: [], share: [] }, topNews: [], counts: {}, isEmpty: false, generatedAt: 0 });

test('putIssue / getIssue round-trip; a missing issue is null', async () => {
  const kv = makeKV();
  await putIssue(kv, issueOf('i1'));
  assert.equal((await getIssue(kv, 'i1')).issueId, 'i1');
  assert.equal(await getIssue(kv, 'nope'), null);
  // an issue is archived: no TTL
  assert.equal(kv.m.get('mail:issue:i1').opts, null);
});

test('putSend gives a TERMINAL record a TTL and a pending record none; getSend normalizes', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, issueOf('i1'), ['a'], { now: at(0) });
  const rec = await getSend(kv, 'i1', 'a');
  assert.equal(rec.status, 'pending');
  assert.equal(kv.m.get(sendKey('i1', 'a')).opts, null, 'a pending record has no TTL');
  await putSend(kv, markSent(rec, { now: at(9) }));
  assert.ok(kv.m.get(sendKey('i1', 'a')).opts.expirationTtl > 0, 'a sent record self-prunes');
  assert.equal((await getSend(kv, 'i1', 'a')).status, 'sent');
});

test('enqueueIssue creates one pending record per recipient + a fairness-ordered index', async () => {
  const kv = makeKV();
  const res = await enqueueIssue(kv, issueOf('i1'), ['a', 'b', 'c'], { now: at(100) });
  assert.equal(res.enqueued, 3);
  assert.equal(res.pending, 3);
  const idx = await readPendingIndex(kv, 'i1');
  assert.deepEqual([...idx].sort(), ['a', 'b', 'c']);
  // every record is pending with a stamped order and availableAt defaulting to now
  for (const h of ['a', 'b', 'c']) {
    const r = await getSend(kv, 'i1', h);
    assert.equal(r.status, 'pending');
    assert.equal(r.availableAt, 100);
    assert.equal(typeof r.order, 'number');
  }
});

test('enqueueIssue is IDEMPOTENT: a re-run does not duplicate or resurrect a terminal record', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, issueOf('i1'), ['a', 'b'], { now: at(0) });
  await putSend(kv, markSent(await getSend(kv, 'i1', 'a'), { now: at(1) })); // a already delivered
  const res = await enqueueIssue(kv, issueOf('i1'), ['a', 'b'], { now: at(2) }); // compile re-runs
  assert.equal(res.enqueued, 0, 'no new records on a re-run');
  assert.equal((await getSend(kv, 'i1', 'a')).status, 'sent', 'a delivered recipient is not reset to pending');
  const idx = await readPendingIndex(kv, 'i1');
  assert.deepEqual(idx, ['b'], 'only the still-pending recipient stays in the index');
});

test('enqueueIssue with a future sendStartAt makes records HOLD (availableAt in the future)', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, issueOf('i1'), ['a'], { now: at(1000), sendStartAt: 5000 });
  assert.equal((await getSend(kv, 'i1', 'a')).availableAt, 5000);
});

test('removeFromPending drops one recipient; activeIssueIds lists only non-empty indices', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, issueOf('i1'), ['a', 'b'], { now: at(0) });
  await enqueueIssue(kv, issueOf('i2'), ['c'], { now: at(0) });
  await removeFromPending(kv, 'i2', 'c'); // i2 now empty
  assert.deepEqual((await activeIssueIds(kv)).sort(), ['i1']);
  await removeFromPending(kv, 'i1', 'a');
  assert.deepEqual(await readPendingIndex(kv, 'i1'), ['b']);
});

test('getSubscriber reads + normalizes a stored subscriber record', async () => {
  const kv = makeKV();
  const rec = buildSubscriber({ hash: 'h1', source: 'anon', emailEnc: 'ENC' }, { now: at(0) });
  await kv.put(subscriberKey('h1'), JSON.stringify(rec));
  const got = await getSubscriber(kv, 'h1');
  assert.equal(got.hash, 'h1');
  assert.equal(got.source, 'anon');
  assert.equal(got.emailEnc, 'ENC');
  assert.equal(await getSubscriber(kv, 'missing'), null);
});

test('putSubscriber normalizes and round-trips; a record with no address/identity is REFUSED (null, nothing written)', async () => {
  const kv = makeKV();
  const stored = await putSubscriber(kv, buildSubscriber({ hash: 'h9', source: 'anon', emailEnc: 'ENC9' }, { now: at(0) }));
  assert.equal(stored.hash, 'h9');
  assert.equal((await getSubscriber(kv, 'h9')).emailEnc, 'ENC9');
  // a malformed record (anon, no emailEnc) does not normalize -> refused, and nothing is persisted
  assert.equal(await putSubscriber(kv, { hash: 'h10', source: 'anon' }), null);
  assert.equal(await getSubscriber(kv, 'h10'), null);
  assert.equal(kv.m.get(subscriberKey('h10')), undefined, 'a refused record leaves no dead row');
});

test('eraseSubscriber deletes the record but LEAVES the suppression marker (erasure that cannot un-suppress)', async () => {
  const kv = makeKV();
  await putSubscriber(kv, buildSubscriber({ hash: 'h1', source: 'anon', emailEnc: 'ENC' }, { now: at(0) }));
  await kv.put(suppressKey('h1'), SUPPRESS_VALUE); // the one-click opt-out marker
  assert.equal(await eraseSubscriber(kv, 'h1'), true);
  assert.equal(await getSubscriber(kv, 'h1'), null, 'the subscriber record is erased');
  assert.ok(kv.m.get(suppressKey('h1')), 'the suppression marker OUTLIVES the record, so a re-add cannot un-suppress');
  assert.equal(await eraseSubscriber(kv, 'h1'), true, 'erasing an absent record is idempotently a success');
  assert.equal(await eraseSubscriber(kv, ''), false, 'a blank hash is refused, never handed to a key builder');
});

test('eraseSubscriberMail wipes the record + all send state across EVERY issue, keeps suppression, spares others', async () => {
  const kv = makeKV();
  const h = 'herase';
  await putSubscriber(kv, buildSubscriber({ hash: h, source: 'anon', emailEnc: 'ENC' }, { now: at(0) }));
  await kv.put(suppressKey(h), SUPPRESS_VALUE);
  await enqueueIssue(kv, issueOf('i1'), [h, 'other'], { now: at(0) });
  await enqueueIssue(kv, issueOf('i2'), [h], { now: at(0) });
  assert.ok(await getSend(kv, 'i1', h));
  assert.ok(await getSend(kv, 'i2', h));

  const res = await eraseSubscriberMail(kv, h);
  assert.equal(res.subscriber, 1);
  assert.equal(res.sends, 2, 'both per-issue send records deleted');
  assert.equal(await getSubscriber(kv, h), null, 'subscriber record erased');
  assert.equal(await getSend(kv, 'i1', h), null, 'send record in i1 erased');
  assert.equal(await getSend(kv, 'i2', h), null, 'send record in i2 erased');
  assert.deepEqual(await readPendingIndex(kv, 'i1'), ['other'], 'hash removed from i1 pending; the other recipient stays');
  assert.deepEqual(await readPendingIndex(kv, 'i2'), [], 'hash removed from i2 pending');
  assert.ok(kv.m.get(suppressKey(h)), 'the suppression marker survives erasure (cannot un-suppress)');
  assert.ok(await getSend(kv, 'i1', 'other'), 'a different subscriber in the same issue is untouched');
});

test('readBudget treats an ABSENT counter as 0, an ERROR as null (fail-closed), a corrupt value as null', async () => {
  const kv = makeKV();
  // absent -> 0 (a legitimate first-of-day zero; NOT the frozen fail-closed null)
  assert.deepEqual(await readBudget(kv, '2026-08-18', '2026-08'), { daily: 0, monthly: 0 });
  // a corrupt counter -> null (fail-closed)
  await kv.put(budgetDayKey('2026-08-18'), 'not-a-number');
  assert.equal((await readBudget(kv, '2026-08-18', '2026-08')).daily, null);
  // an ERROR on read -> null (fail-closed)
  const kvErr = makeKV({ throwOn: (k) => k.startsWith('mail:budget:') });
  assert.deepEqual(await readBudget(kvErr, '2026-08-18', '2026-08'), { daily: null, monthly: null });
});

test('bumpBudget increments both counters and TTLs them', async () => {
  const kv = makeKV();
  await bumpBudget(kv, '2026-08-18', '2026-08', 3);
  await bumpBudget(kv, '2026-08-18', '2026-08', 2);
  assert.deepEqual(await readBudget(kv, '2026-08-18', '2026-08'), { daily: 5, monthly: 5 });
  assert.ok(kv.m.get(budgetDayKey('2026-08-18')).opts.expirationTtl > 0);
  assert.ok(kv.m.get(budgetMonthKey('2026-08')).opts.expirationTtl > 0);
  await bumpBudget(kv, '2026-08-18', '2026-08', 0); // a no-op never writes a spurious counter
  assert.deepEqual(await readBudget(kv, '2026-08-18', '2026-08'), { daily: 5, monthly: 5 });
});

test('MAIL_PENDING_KEY is the documented shape', () => {
  assert.equal(MAIL_PENDING_KEY('2026-08-18'), 'mail:pending:2026-08-18');
});
