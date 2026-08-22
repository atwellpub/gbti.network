// SOW-166: the weekly-digest send engine. Fake KV, fake resolver/renderer/sender. Proves the guarantees the SOW
// names: exactly-once, a FAIL-CLOSED rate budget, a send-time suppression gate, retry-then-fail, holding, and
// crashed-tick (stale-claim) recovery. No network, no Resend, no Stripe.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drainMail, drainMailIssue, budgetDateStrings, resolveSendGate, MAIL_CAP_DEFAULTS, numOrNull } from '../workers/signup/mail-drain.mjs';
import { enqueueIssue, getSend, readPendingIndex, readBudget, bumpBudget, MAIL_PENDING_KEY } from '../workers/signup/mail-store.mjs';
import { sendKey, markClaimed, budgetDayKey } from '../membership/mail-queue.mjs';
import { suppressKey, subscriberKey, SUPPRESS_VALUE } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { renderIssue as realRenderIssue } from '../membership/mail-render.mjs';

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

// The one-click unsubscribe config is ALSO fail-closed and issue-wide: the drain sends nothing without both the
// signing key and the endpoint origin (an email with no working opt-out must never go out). Every send test
// supplies them alongside the open gate. A dedicated test below proves the fail-closed behaviour when they are absent.
const UNSUB = { MAIL_UNSUB_KEY: 'test-unsub-signing-key', PUBLIC_BASE_URL: 'https://signup.gbti.network' };

// The LAUNCH SEND GATE is fail-closed by default: with no gate configured the drain sends to NOBODY. Every test
// below that exercises real send mechanics must OPEN the gate explicitly, so a test that forgets to configure it
// proves the fail-closed default by sending zero. OPEN = the deliberate full-send flip, with unsubscribe wired.
const OPEN = { ...UNSUB, MAIL_SEND_UNRESTRICTED: 'true' };

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

test('SUPPRESSION UNREADABLE: a KV error on the suppress check DEFERS (fail-closed), then sends once it recovers', async () => {
  // The regulatory-critical asymmetry: a KV read ERROR is NOT knowledge that the person is un-suppressed.
  // Sending anyway could mail someone who opted out (invisible after the fact); terminalizing as suppressed
  // would permanently unsubscribe a legitimate subscriber on a transient blip. The correct third outcome is
  // DEFER: no send, no terminal record, retry next tick.
  let breakSuppress = true;
  const kv = makeKV({ throwOn: (k) => breakSuppress && k.startsWith('mail:suppress:') });
  await seed(kv, 'i1', ['a'], { now: at(1_000_000) });
  const sender = makeSender();

  const t1 = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(t1.deferred, 1, 'an unreadable suppression marker defers, it does not send');
  assert.equal(t1.sent, 0);
  assert.equal(sender.sent.length, 0, 'nobody is mailed while their opt-out status is unknown');
  const rec = await getSend(kv, 'i1', 'a');
  assert.equal(rec.status, 'pending', 'the deferred record is left pending, not terminalized');
  assert.equal(rec.attempts, 0, 'a deferral burns no attempt');
  assert.ok((await readPendingIndex(kv, 'i1')).includes('a'), 'the deferred recipient waits in the backlog');
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  assert.deepEqual(await readBudget(kv, dayStr, monthStr), { daily: 0, monthly: 0 }, 'a deferral spends no budget');

  // KV recovers: the marker now reads absent, so the recipient sends, exactly once. The blip only delayed it.
  breakSuppress = false;
  const t2 = await drainMailIssue(OPEN, { kv, issueId: 'i1', now: at(1_300_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(t2.deferred, 0);
  assert.equal(t2.sent, 1, 'a transient blip only delayed the send, it did not drop the recipient');
  assert.deepEqual(sender.sent, ['a@example.com']);
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
  const r = await drainMailIssue({ ...UNSUB, MAIL_SEND_ALLOWLIST: 'on' }, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
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
  const r2 = await drainMailIssue({ ...UNSUB, MAIL_SEND_ALLOWLIST: 'on off' }, { kv, issueId: 'i1', now: at(1_300_000), cap: 10, ...BIG, ...deps(sender) });
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

// SOW-166 (2026-08-22): the RENDERER<->DRAIN seam. Before this, mail-render.test.mjs proved the renderer's
// no-url fallback and mail-drain.test.mjs proved queue mechanics, but NOTHING asserted what the DRAIN's rendered
// output actually contained, so the drain passing no unsubscribeUrl produced a plausible footer ("manage your
// subscription from gbti.network", the word "unsubscribe" absent entirely) and the whole suite stayed green. The
// renderer's fallback is a safe RENDERING choice and an unsafe SENDING one; the drain makes the sending choice,
// so the regression test belongs here, on the drain's output, with the REAL renderer (a stub would re-pass the
// same green suite QAMaster flagged).
test('SEAM: the drain mints a per-recipient one-click unsubscribe URL into the SENT email (html + text)', async () => {
  const kv = makeKV();
  await enqueueIssue(kv, { issueId: 'i1', layout: [], counts: {}, generatedAt: 0, topNews: [], isEmpty: true }, ['abc'], { now: at(1_000_000) });
  await kv.put(subscriberKey('abc'), JSON.stringify(buildSubscriber({ hash: 'abc', source: 'anon', emailEnc: 'enc:abc' }, { now: at(1_000_000) })));

  const captured = [];
  const sendEmail = async (msg) => { captured.push(msg); return { id: 're_seam' }; };
  const r = await drainMailIssue(OPEN, {
    kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG,
    resolveAddress, renderIssue: realRenderIssue, sendEmail, from: 'digest@gbti.network',
  });
  assert.equal(r.sent, 1);
  assert.equal(captured.length, 1, 'exactly one email was rendered and sent');

  const { html, text } = captured[0];
  for (const [part, name] of [[html, 'html'], [text, 'text']]) {
    // `?h=abc` precedes the `&` (raw in text, &amp; in the html href), so this substring holds in both parts.
    assert.ok(part.includes(`${UNSUB.PUBLIC_BASE_URL}/mail/unsubscribe?h=abc`), `${name} carries the routed unsubscribe URL with this recipient's hash`);
    assert.match(part, /unsubscribe/i, `${name} names unsubscribe (the exact word the broken no-url fallback lacked)`);
  }
  const tok = text.match(/[?&]t=([^&\s"<]+)/);
  assert.ok(tok && tok[1].length > 10, 'a real signed unsubscribe token is present, not a bare url');
});

test('SEAM FAIL-CLOSED: with the gate OPEN but unsubscribe unconfigured, the drain sends NOTHING and holds the backlog', async () => {
  const kv = makeKV();
  await seed(kv, 'i1', ['a', 'b'], { now: at(1_000_000) });
  const sender = makeSender();

  // Gate open (unrestricted) but NO MAIL_UNSUB_KEY: an email with no working opt-out must never go out.
  const r = await drainMailIssue({ MAIL_SEND_UNRESTRICTED: 'true' }, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r.reason, 'unsubscribe not configured');
  assert.equal(r.sent, 0);
  assert.equal(sender.sent.length, 0, 'nothing is mailed without a mintable opt-out');
  assert.equal(r.backlog, 2, 'the whole backlog is held, not dropped');
  for (const h of ['a', 'b']) {
    const rec = await getSend(kv, 'i1', h);
    assert.equal(rec.status, 'pending', 'a held backlog stays pending');
    assert.equal(rec.attempts, 0, 'and burns no attempt');
  }

  // Symmetrically: a key but no PUBLIC_BASE_URL is equally fail-closed (the URL cannot be built either way).
  const r2 = await drainMailIssue({ MAIL_SEND_UNRESTRICTED: 'true', MAIL_UNSUB_KEY: 'k' }, { kv, issueId: 'i1', now: at(1_000_000), cap: 10, ...BIG, ...deps(sender) });
  assert.equal(r2.reason, 'unsubscribe not configured');
  assert.equal(sender.sent.length, 0, 'still nothing sent without a base URL');
});

// ---------- the rate caps are FAIL-SAFE, not fail-open (owner ruling 2026-08-22; QAmaster finding) ----------
// The existing budget tests all pass an EXPLICIT cap (BIG, or a small number), so they prove the mechanism honours
// a cap it is GIVEN. Nothing proved a cap is given: an UNSET MAIL_DAILY_CAP/MAIL_MONTHLY_CAP resolved to null and
// null meant UNBOUNDED (a fail-OPEN cap, unlike the fail-closed counter). These two tests go RED if the caps ever
// return to unbounded, by driving the drain with NO cap vars and asserting a bounded default binds. They are the
// missing subject: a check that passes on an absent cap, not a present one.

test('CAP FLOOR: with no cap vars set, the drain is bounded by the DEFAULT daily cap, never unbounded', async () => {
  const kv = makeKV();
  const hashes = Array.from({ length: MAIL_CAP_DEFAULTS.daily + 30 }, (_, i) => `h${i}`); // more recipients than the cap
  await seed(kv, 'i1', hashes);
  const sender = makeSender();
  // OPEN opens the gate + configures unsubscribe but sets NO MAIL_DAILY_CAP/MAIL_MONTHLY_CAP. perTickCap is raised
  // ABOVE the daily default so the DAILY cap is the binding constraint, not the per-tick throttle. If the daily cap
  // regressed to null (unbounded), every recipient would send.
  const r = await drainMail(OPEN, { kv, now: at(1_000_000), perTickCap: hashes.length, ...deps(sender) });
  assert.equal(sender.sent.length, MAIL_CAP_DEFAULTS.daily, 'bounded by the code default daily cap, not unbounded');
  assert.equal(r.drained, MAIL_CAP_DEFAULTS.daily);
});

test('CAP FLOOR: with the daily cap raised and NO monthly var, the DEFAULT monthly cap still binds', async () => {
  const kv = makeKV();
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  // Pre-spend the month to five short of the DEFAULT monthly cap; raise the daily cap so it does not bind, and
  // leave MAIL_MONTHLY_CAP UNSET so it must fall back to the default. Only the monthly default can limit the tick.
  await bumpBudget(kv, dayStr, monthStr, MAIL_CAP_DEFAULTS.monthly - 5);
  const hashes = Array.from({ length: 40 }, (_, i) => `h${i}`);
  await seed(kv, 'i1', hashes);
  const sender = makeSender();
  const env = { ...OPEN, MAIL_DAILY_CAP: '100000' }; // daily does not bind; monthly var absent -> default binds
  await drainMail(env, { kv, now: at(1_000_000), perTickCap: hashes.length, ...deps(sender) });
  assert.equal(sender.sent.length, 5, 'bounded by the default monthly cap remaining (default - pre-spent), not unbounded');
});

// CLASS CLOSED: the two tests above prove the OUTER drainMail resolves a bounded cap. But drainMailIssue is
// EXPORTED and sow-186's per-event notification sender is the next natural caller to invoke it DIRECTLY, for a
// different queue, bypassing drainMail. If the inner signature defaults were null (unbounded), that future caller
// would reproduce the exact fail-open one layer in, and the outer tests would stay green because they never touch
// the inner defaults. These two drive drainMailIssue with NO cap args at all and assert the inner default binds;
// they go RED if drainMailIssue's dailyCap/monthlyCap defaults return to null. This closes the class, not the
// instance, which matters because the second caller does not exist yet and so cannot be reviewed.

test('CAP FLOOR (inner): drainMailIssue with NO cap args is bounded by the DEFAULT daily cap, never unbounded', async () => {
  const hashes = Array.from({ length: MAIL_CAP_DEFAULTS.daily + 30 }, (_, i) => `h${i}`); // more recipients than the cap

  // Default path: call the exported inner directly, the way a second queue's sender would, passing NO
  // dailyCap/monthlyCap. Raise `cap` above the daily default so the DAILY cap is the binding constraint and only the
  // inner default can limit it. If the inner default regressed to null (unbounded), all recipients would send.
  const kvDefault = makeKV();
  await seed(kvDefault, 'i1', hashes);
  const senderDefault = makeSender();
  const rDefault = await drainMailIssue(OPEN, { kv: kvDefault, issueId: 'i1', now: at(1_000_000), cap: hashes.length, ...deps(senderDefault) });
  assert.equal(rDefault.sent, MAIL_CAP_DEFAULTS.daily, 'the inner default daily cap binds a direct caller, not unbounded');
  assert.equal(senderDefault.sent.length, MAIL_CAP_DEFAULTS.daily);

  // Contrast, on a FRESH kv: an EXPLICIT dailyCap: null is what the buggy default used to be, and it sends every
  // recipient. This documents the fail-open the default now avoids, and makes the assertion above self-proving: the
  // default cannot be null, because null demonstrably sends all of them here, not MAIL_CAP_DEFAULTS.daily.
  const kvNull = makeKV();
  await seed(kvNull, 'i1', hashes);
  const senderNull = makeSender();
  const rNull = await drainMailIssue(OPEN, { kv: kvNull, issueId: 'i1', now: at(1_000_000), cap: hashes.length, dailyCap: null, monthlyCap: null, ...deps(senderNull) });
  assert.equal(rNull.sent, hashes.length, 'explicit dailyCap: null is unbounded, which is exactly why null must not be the default');
  assert.ok(rNull.sent > rDefault.sent, 'the bounded default sends strictly fewer than the unbounded explicit-null path');
});

test('CAP FLOOR (inner): drainMailIssue with the daily cap raised and NO monthly arg, the DEFAULT monthly cap binds', async () => {
  const { dayStr, monthStr } = budgetDateStrings(1_000_000);
  const hashes = Array.from({ length: 40 }, (_, i) => `h${i}`);

  // Default monthly path: pass an explicit high dailyCap so daily does not bind, but leave monthlyCap UNSET, so only
  // the inner monthly default can limit the tick. Pre-spend the month to five short of the default.
  const kvDefault = makeKV();
  await bumpBudget(kvDefault, dayStr, monthStr, MAIL_CAP_DEFAULTS.monthly - 5);
  await seed(kvDefault, 'i1', hashes);
  const senderDefault = makeSender();
  const rDefault = await drainMailIssue(OPEN, { kv: kvDefault, issueId: 'i1', now: at(1_000_000), cap: hashes.length, dailyCap: 100000, ...deps(senderDefault) });
  assert.equal(rDefault.sent, 5, 'the inner default monthly cap remaining binds a direct caller, not unbounded');
  assert.equal(senderDefault.sent.length, 5);

  // Contrast, on a FRESH kv pre-spent identically: an EXPLICIT monthlyCap: null ignores the pre-spend and sends every
  // recipient, which is the fail-open the default now avoids.
  const kvNull = makeKV();
  await bumpBudget(kvNull, dayStr, monthStr, MAIL_CAP_DEFAULTS.monthly - 5);
  await seed(kvNull, 'i1', hashes);
  const senderNull = makeSender();
  const rNull = await drainMailIssue(OPEN, { kv: kvNull, issueId: 'i1', now: at(1_000_000), cap: hashes.length, dailyCap: 100000, monthlyCap: null, ...deps(senderNull) });
  assert.equal(rNull.sent, hashes.length, 'explicit monthlyCap: null is unbounded, which is exactly why null must not be the default');
  assert.ok(rNull.sent > rDefault.sent, 'the bounded monthly default sends strictly fewer than the unbounded explicit-null path');
});

// numOrNull is what stands between a wrangler var and the `?? DEFAULT` fallback. The failure it guards is
// INDISTINGUISHABILITY: Number("") is 0, so a declared-but-blank var (or a never-created secret read as "")
// would resolve to a real 0 and stop sending FOREVER, identical to the documented "0" pause, with no alarm.
// One assertion per state, because each interesting input ("", " ", "-5", "1e9") fails differently and a
// single loose assertion would pass on whichever one you happened to write. Cases verified against the parse.
test('numOrNull: empty and whitespace are ABSENT (fall to default), only explicit "0" pauses', () => {
  assert.equal(numOrNull('0'), 0, 'explicit "0" is a deliberate pause and must stay 0');
  assert.equal(numOrNull(''), null, 'empty string is absent, not a real 0 (else a blank var stops sends forever)');
  assert.equal(numOrNull(' '), null, 'whitespace-only is absent, not a real 0');
  assert.equal(numOrNull('  '), null, 'multi-space is absent, not a real 0');
});
test('numOrNull: negatives are rejected (fall to default), not passed through', () => {
  assert.equal(numOrNull('-5'), null, 'a negative cap is nonsense; fall to the bounded default, do not send -5');
  assert.equal(numOrNull(-1), null, 'a numeric negative is rejected too');
});
test('numOrNull: well-formed numbers pass, including trimmed and large-magnitude values', () => {
  assert.equal(numOrNull('90'), 90);
  assert.equal(numOrNull(90), 90);
  assert.equal(numOrNull('90 '), 90, 'a trailing space (dashboard paste) is trimmed, NOT rejected to the default');
  assert.equal(numOrNull('1e9'), 1e9, 'a finite large value passes UNCLAMPED: raising the cap is a legitimate op, caught by the resolved-bounds log, not a parse guard');
});
test('numOrNull: absent and non-numeric are null (the pre-existing, correct behaviour)', () => {
  assert.equal(numOrNull(undefined), null);
  assert.equal(numOrNull(null), null);
  assert.equal(numOrNull('abc'), null, 'non-numeric garble falls to the default');
  assert.equal(numOrNull('NaN'), null);
});
