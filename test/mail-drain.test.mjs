// SOW-166: the weekly-digest send engine. Fake KV, fake resolver/renderer/sender. Proves the guarantees the SOW
// names: exactly-once, a FAIL-CLOSED rate budget, a send-time suppression gate, retry-then-fail, holding, and
// crashed-tick (stale-claim) recovery. No network, no Resend, no Stripe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainMail, drainMailIssue, budgetDateStrings, resolveSendGate } from '../workers/signup/mail-drain.mjs';
import { enqueueIssue, getSend, readPendingIndex, readBudget, MAIL_PENDING_KEY } from '../workers/signup/mail-store.mjs';
import { sendKey, markClaimed, budgetDayKey } from '../membership/mail-queue.mjs';
import { suppressKey, subscriberKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';

const at = (t) => () => t;
const issueOf = (id) => ({ issueId: id, sections: { article: [], product: [], prompt: [], share: [] }, topNews: [], counts: {}, isEmpty: false, generatedAt: 0 });

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
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// Seed an issue with `hashes` recipients (each an anon subscriber whose address is <hash>@example.com).
async function seed(kv, issueId, hashes, { now = at(1_000_000), sendStartAt = null } = {}) {
  await enqueueIssue(kv, issueOf(issueId), hashes, { now, sendStartAt });
  for (const h of hashes) {
    await kv.put(subscriberKey(h), JSON.stringify(buildSubscriber({ hash: h, source: 'anon', emailEnc: `enc:${h}` }, { now })));
  }
}

function makeSender({ failFor = new Set() } = {}) {
  const sent = [];
  const sendEmail = async ({ to }) => {
    if (failFor.has(to)) throw new Error('resend 500');
    sent.push(to);
    return { id: `re_${to}` };
  };
  return { sent, sendEmail };
}

const resolveAddress = async (sub) => `${sub.hash}@example.com`;
const renderIssue = () => ({ subject: 'Weekly digest', html: '<p>hi</p>', text: 'hi' });
const deps = (sender) => ({ resolveAddress, renderIssue, sendEmail: sender.sendEmail, from: 'digest@gbti.network' });

const BIG = { dailyCap: 1000, monthlyCap: 30000 };

// The LAUNCH SEND GATE is fail-closed by default: with no gate configured the drain sends to NOBODY. Every test
// below that exercises real send mechanics must OPEN the gate explicitly, so a test that forgets to configure it
// proves the fail-closed default by sending zero. OPEN = the deliberate full-send flip.
const OPEN = { MAIL_SEND_UNRESTRICTED: 'true' };

test('HAPPY PATH: many recipients drain exactly-once over ticks, records terminalize, budget counts each send', async () => {
  const kv = makeKV();
  const hashes = Array.from({ length: 7 }, (_, i) => `h${i}`);
  await seed(kv, 'i1', hashes, { now: at(1_000_000) });
  const sender = makeSender();

  let t = 1_000_000;
  let guard = 0;
  while ((await readPendingIndex(kv, 'i1')).length && guard++ < 50) {
    await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(t), cap: 2, ...BIG, ...deps(sender) });
    t += 300_000; // a 5-minute tick
  }

  // every recipient exactly once
  assert.deepEqual([...sender.sent].sort(), hashes.map((h) => `${h}@example.com`).sort());
  assert.equal(sender.sent.length, 7);
  assert.equal(new Set(sender.sent).size, 7, 'no address sent twice');
  // every record is the terminal sent marker
  for (const h of hashes) assert.equal((await getSend(kv, 'i1', h)).status, 'sent');
  // the rate budget counted exactly the sends
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.deepEqual(await readBudget(kv, dayStr, monthStr), { daily: 7, monthly: 7 });
  assert.equal((await readPendingIndex(kv, 'i1')).length, 0);
});

test('FAIL-CLOSED BUDGET: a counter read error sends NOTHING this tick (never freely)', async () => {
  const kv = makeKV({ throwOn: (k) => k.startsWith('mail:budget:') });
  await seed(kv, 'i1', ['a', 'b'], { now: at(1_000_000) });
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.reason, 'budget');
  assert.equal(r.sent, 0);
  assert.equal(sender.sent.length, 0, 'no email left while the budget was unreadable');
  assert.equal(r.backlog, 2, 'the backlog is reported, not dropped');
});

test('RATE CAP: the daily cap bounds sends; a later same-day tick at the cap sends nothing', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b', 'c', 'd', 'e'], { now: at(1_000_000) });
  const sender = makeSender();
  const opts = { kv, issueId: 'i1', now: at(1_000_000), cap: 10, dailyCap: 2, monthlyCap: 3000, ...deps(sender) };
  const r1 = await drainMailIssue(OPEN, opts);
  assert.equal(r1.sent, 2, 'only two sends fit under a daily cap of 2');
  const r2 = await drainMailIssue(OPEN, opts); // same day, counter now at 2
  assert.equal(r2.sent, 0);
  assert.equal(r2.reason, 'budget');
  assert.equal(sender.sent.length, 2);
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.equal((await readBudget(kv, dayStr, monthStr)).daily, 2);
});

test('SUPPRESSION GATE: an unsubscribe marker drops the recipient at send time, spends no budget', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['keep', 'gone'], { now: at(1_000_000) });
  await kv.put(suppressKey('gone'), SUPPRESS_VALUE); // unsubscribed after the compile
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.deepEqual(sender.sent, ['keep@example.com'], 'the suppressed address never receives mail');
  assert.equal(r.suppressed, 1);
  assert.equal((await getSend(kv, 'i1', 'gone')).status, 'suppressed');
  assert.ok(!(await readPendingIndex(kv, 'i1')).includes('gone'));
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.equal((await readBudget(kv, dayStr, monthStr)).daily, 1, 'suppression consumed no send budget');
});

test('NO DOUBLE SEND: re-draining a fully sent issue sends nothing more', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b'], { now: at(1_000_000) });
  const sender = makeSender();
  const run = () => drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  await run();
  await run(); // a second tick after everyone is sent
  assert.equal(sender.sent.length, 2, 'exactly one send per recipient, ever');
});

test('RETRY THEN FAIL: a persistently failing send retries to the attempt cap, then terminalizes failed', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['ok', 'bad'], { now: at(1_000_000) });
  const sender = makeSender({ failFor: new Set(['bad@example.com']) });
  const base = { kv, issueId: 'i1', cap: 10, ...BIG, maxAttempts: 2, ...deps(sender) };
  let t = 1_000_000;
  for (let i = 0; i < 4; i++) { await drainMailIssue(OPEN, { ...base, now: at(t) }); t += 300_000; }
  assert.deepEqual(sender.sent, ['ok@example.com'], 'the good recipient sent once');
  assert.equal((await getSend(kv, 'i1', 'bad')).status, 'failed', 'the bad recipient terminalized failed');
  assert.equal((await getSend(kv, 'i1', 'bad')).attempts, 2, 'it burned exactly maxAttempts');
  assert.equal((await readPendingIndex(kv, 'i1')).length, 0, 'both recipients left the backlog');
});

test('HOLDING: records with a future send window are not sent until the window opens', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a'], { now: at(1_000_000), sendStartAt: 2_000_000 });
  const sender = makeSender();
  const before = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_500_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(before.sent, 0, 'nothing sends before the window opens');
  assert.equal(sender.sent.length, 0);
  const after = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(2_100_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(after.sent, 1);
  assert.deepEqual(sender.sent, ['a@example.com']);
});

test('STALE-CLAIM RECOVERY: a claim stranded by a crashed tick is reclaimed and sent', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a'], { now: at(1_000_000) });
  // simulate a tick that claimed then died 20 minutes ago (past CLAIM_STALE_MS)
  const claimed = markClaimed(await getSend(kv, 'i1', 'a'), { now: at(1_000_000) });
  await kv.put(sendKey('i1', 'a'), JSON.stringify(claimed));
  const sender = makeSender();
  const t = 1_000_000 + 20 * 60 * 1000;
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(t), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.sent, 1, 'the stranded recipient is reclaimed and delivered');
  assert.deepEqual(sender.sent, ['a@example.com']);
});

test('A FRESH claim by another tick is NOT stolen (no double-claim within the stale window)', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a'], { now: at(1_000_000) });
  const claimed = markClaimed(await getSend(kv, 'i1', 'a'), { now: at(1_000_000) });
  await kv.put(sendKey('i1', 'a'), JSON.stringify(claimed)); // claimed 1 minute ago
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000 + 60_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.sent, 0, 'a fresh in-flight claim is left alone');
  assert.equal(sender.sent.length, 0);
});

test('NO ACTIVE SUBSCRIBER: a recipient whose record is gone fails terminally, no send', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, issueOf('i1'), ['ghost'], { now: at(1_000_000) }); // send record but NO subscriber record
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(sender.sent.length, 0);
  assert.equal(r.failed, 1);
  assert.equal((await getSend(kv, 'i1', 'ghost')).status, 'failed');
  assert.equal((await readPendingIndex(kv, 'i1')).length, 0);
});

test('A HASH lingering in the index with no send record is pruned (dropped), not sent', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a'], { now: at(1_000_000) });
  await kv.put(MAIL_PENDING_KEY('i1'), JSON.stringify({ hashes: ['a', 'phantom'] })); // phantom has no send record
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.dropped, 1);
  assert.deepEqual(sender.sent, ['a@example.com']);
  assert.ok(!(await readPendingIndex(kv, 'i1')).includes('phantom'));
});

test('drainMail threads ONE per-tick cap across multiple active issues', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b', 'c'], { now: at(1_000_000) });
  await seed(kv, 'i2', ['d', 'e', 'f'], { now: at(1_000_000) });
  const sender = makeSender();
  const r = await drainMail(OPEN, { kv, now: at(1_000_000), perTickCap: 4, ...BIG, ...deps(sender) });
  assert.equal(r.drained, 4, 'the per-tick cap bounds the two issues together, not each');
  assert.equal(sender.sent.length, 4);
});

test('guards: missing deps or from address are a safe no-op, not a crash', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a'], { now: at(1_000_000) });
  assert.equal((await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), from: 'x@y.z' })).reason, 'send deps not wired');
  const sender = makeSender();
  assert.equal((await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), ...deps(sender), from: null })).reason, 'no from address');
  assert.equal((await drainMailIssue(OPEN, { issueId: 'i1', now: at(1_000_000), ...deps(sender) })).reason, 'no kv');
});

// ---- LAUNCH SEND GATE (fail-closed) ----
// QAMaster's hard requirement: with a population-scale enrolment backfill sitting next to a live send path, the
// cap that stops an accidental send-to-everyone lives IN the send path, not in a runbook. Default is send-nothing;
// a bounded allowlist is the launch/test posture; full send is a deliberate, explicit flip.

test('SEND GATE closed by DEFAULT: no gate configured sends NOTHING, reports the whole backlog, claims nothing', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b'], { now: at(1_000_000) });
  const sender = makeSender();
  // env {} = no MAIL_SEND_* configured at all: the fail-closed default.
  const r = await drainMailIssue({}, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.reason, 'send gate closed');
  assert.equal(r.gate, undefined, 'the closed early-out returns before a gate mode is stamped on the result');
  assert.equal(r.sent, 0);
  assert.equal(sender.sent.length, 0, 'an unset/misconfigured gate sends to nobody');
  assert.equal(r.backlog, 2, 'the whole backlog is reported, not dropped');
  // nothing was claimed: both records are still pending with no attempt burned, and the budget is untouched
  for (const h of ['a', 'b']) {
    const rec = await getSend(kv, 'i1', h);
    assert.equal(rec.status, 'pending');
    assert.equal(rec.attempts, 0, 'a closed gate burns no attempt');
  }
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.deepEqual(await readBudget(kv, dayStr, monthStr), { daily: 0, monthly: 0 });
});

test('SEND GATE allowlist: only listed hashes send; recipient #2 is REFUSED, left pending, no attempt burned', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['on', 'off'], { now: at(1_000_000) });
  const sender = makeSender();
  const offBefore = await getSend(kv, 'i1', 'off');

  // 'on' is on the allowlist, 'off' is not.
  const r = await drainMailIssue({ MAIL_SEND_ALLOWLIST: 'on' }, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.gate, 'allowlist');
  assert.equal(r.sent, 1, 'exactly the one allowlisted recipient sends');
  assert.equal(r.refused, 1, 'the un-listed recipient #2 is REFUSED');
  assert.deepEqual(sender.sent, ['on@example.com'], 'the refused address never receives mail');

  // the refused recipient is untouched: still pending, still queued, same attempt count as before the drain
  const offAfter = await getSend(kv, 'i1', 'off');
  assert.equal(offAfter.status, 'pending', 'a refusal leaves the record pending');
  assert.equal(offAfter.attempts, offBefore.attempts, 'a refusal burns no attempt');
  assert.ok((await readPendingIndex(kv, 'i1')).includes('off'), 'the refused recipient waits in the backlog');
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.equal((await readBudget(kv, dayStr, monthStr)).daily, 1, 'only the permitted send counts against the rate budget');

  // widen the allowlist on a later tick: the waiting recipient now delivers, and still exactly once each
  const r2 = await drainMailIssue({ MAIL_SEND_ALLOWLIST: 'on off' }, { kv, issueId: 'i1', now: at(1_300_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r2.sent, 1);
  assert.equal(r2.refused, 0);
  assert.deepEqual([...sender.sent].sort(), ['off@example.com', 'on@example.com']);
  assert.equal((await readPendingIndex(kv, 'i1')).length, 0, 'the backlog is now drained');
});

test('SEND GATE: the tick entrypoint drainMail is fail-closed too (no gate configured drains nothing)', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b', 'c'], { now: at(1_000_000) });
  const sender = makeSender();
  const r = await drainMail({}, { kv, now: at(1_000_000), perTickCap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.drained, 0, 'the tick sends nothing with no gate configured');
  assert.equal(sender.sent.length, 0);
  assert.equal((await readPendingIndex(kv, 'i1')).length, 3, 'the whole backlog waits');
});

test('resolveSendGate: three modes; unrestricted needs the EXACT string; allowlist splits on commas/space', () => {
  assert.equal(resolveSendGate({}).mode, 'closed');
  assert.equal(resolveSendGate({}).allows('x'), false, 'closed permits nobody');
  assert.equal(resolveSendGate().mode, 'closed', 'no env at all is closed, never a crash');

  assert.equal(resolveSendGate({ MAIL_SEND_UNRESTRICTED: 'true' }).mode, 'unrestricted');
  assert.equal(resolveSendGate({ MAIL_SEND_UNRESTRICTED: 'true' }).allows('anyone'), true);
  // only the exact string 'true' opens it: a stray '1' or 'TRUE' must NOT flip a fail-closed control open
  assert.equal(resolveSendGate({ MAIL_SEND_UNRESTRICTED: '1' }).mode, 'closed');
  assert.equal(resolveSendGate({ MAIL_SEND_UNRESTRICTED: 'TRUE' }).mode, 'closed');

  const g = resolveSendGate({ MAIL_SEND_ALLOWLIST: 'a, b  c,,d' });
  assert.equal(g.mode, 'allowlist');
  assert.equal(g.size, 4, 'commas and runs of whitespace both separate; empty splits are discarded');
  assert.ok(g.allows('a') && g.allows('b') && g.allows('c') && g.allows('d'));
  assert.equal(g.allows('e'), false);
  // unrestricted takes precedence even when an allowlist is also present
  assert.equal(resolveSendGate({ MAIL_SEND_UNRESTRICTED: 'true', MAIL_SEND_ALLOWLIST: 'a' }).mode, 'unrestricted');
});
