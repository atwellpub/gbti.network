// SOW-166: the pure mail send-pacing core. No network, no secrets, injected `now`. Modeled on
// test/syndication-queue.test.mjs so the digest send-state proves the same idempotency + cap guarantees.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMailSend, normalizeMailSend, sendKey, isDue, planDrain, canRetry, markClaimed, releaseClaim,
  markSent, markFailed, withinBudget, budgetRemaining, budgetDayKey, budgetMonthKey, hashString,
  rotateOrder, backlogCount, oldestPendingAgeMs, MailQueueError, DEFAULT_MAX_ATTEMPTS,
} from '../membership/mail-queue.mjs';

const at = (t) => () => t;

test('buildMailSend stamps a pending record and defaults availableAt to enqueuedAt', () => {
  const r = buildMailSend({ issueId: '2026-08-18', recipientHash: 'abc123', customerId: 'cus_1', order: 4 }, { now: at(1000) });
  assert.equal(r.status, 'pending');
  assert.equal(r.enqueuedAt, 1000);
  assert.equal(r.availableAt, 1000);
  assert.equal(r.order, 4);
  assert.equal(r.attempts, 0);
  assert.equal(r.claimedAt, null);
  // an explicit send window (the Tuesday-morning start) overrides the default
  const later = buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(1000), availableAt: 5000 });
  assert.equal(later.availableAt, 5000);
});

test('buildMailSend + sendKey reject missing identifiers', () => {
  assert.throws(() => buildMailSend({ recipientHash: 'h', customerId: 'c' }), MailQueueError);
  assert.throws(() => buildMailSend({ issueId: 'i', customerId: 'c' }), MailQueueError);
  assert.throws(() => buildMailSend({ issueId: 'i', recipientHash: 'h' }), MailQueueError);
  assert.throws(() => sendKey('', 'h'), MailQueueError);
  assert.throws(() => sendKey('i', '  '), MailQueueError);
  assert.equal(sendKey('2026-08-18', 'abc'), 'mail:send:2026-08-18:abc');
});

test('LEAK GUARD: a send record carries an HMAC + customerId but provably no raw email', () => {
  // A caller that wrongly passes an email must not leak it: buildMailSend has no email field to copy it into.
  const r = buildMailSend(
    { issueId: 'i', recipientHash: 'deadbeef', customerId: 'cus_9', email: 'someone@example.com' },
    { now: at(1) },
  );
  assert.ok(!('email' in r));
  const serialized = JSON.stringify(r);
  assert.ok(!serialized.includes('@'), 'no email address may appear in a stored send record');
  assert.ok(!serialized.includes('example.com'));
  // normalize is equally incapable of resurrecting a stray email field
  const n = normalizeMailSend({ ...r, email: 'x@y.z' });
  assert.ok(!('email' in n));
  assert.ok(!JSON.stringify(n).includes('@'));
});

test('normalizeMailSend coerces a stored value and drops an unusable one', () => {
  assert.equal(normalizeMailSend(null), null);
  assert.equal(normalizeMailSend({ issueId: 'i', recipientHash: 'h' }), null); // no customerId
  assert.equal(normalizeMailSend({ recipientHash: 'h', customerId: 'c' }), null); // no issueId
  const n = normalizeMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c', status: 'weird', enqueuedAt: '5', availableAt: '65', attempts: '2' });
  assert.equal(n.status, 'pending'); // bad status -> pending
  assert.equal(n.enqueuedAt, 5);
  assert.equal(n.availableAt, 65);
  assert.equal(n.attempts, 2);
  // availableAt falls back to enqueuedAt when absent
  assert.equal(normalizeMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c', enqueuedAt: 9 }).availableAt, 9);
});

test('isDue + planDrain enforce the send window and sort by fairness order', () => {
  const a = buildMailSend({ issueId: 'i', recipientHash: 'a', customerId: 'c', order: 2 }, { now: at(0), availableAt: 100 });
  const b = buildMailSend({ issueId: 'i', recipientHash: 'b', customerId: 'c', order: 0 }, { now: at(0), availableAt: 100 });
  assert.equal(isDue(a, 99), false);
  assert.equal(isDue(a, 100), true);
  const sent = markSent(b, { now: at(0) });
  const { due, holding } = planDrain([a, sent], 150);
  assert.deepEqual(due.map((r) => r.recipientHash), ['a']); // only a is pending+due; the sent record is excluded
  assert.deepEqual(holding, []);
  // order sort: lower order first, recipientHash as the stable tiebreak
  const p = buildMailSend({ issueId: 'i', recipientHash: 'z', customerId: 'c', order: 0 }, { now: at(0) });
  const q = buildMailSend({ issueId: 'i', recipientHash: 'm', customerId: 'c', order: 0 }, { now: at(0) });
  const rr = buildMailSend({ issueId: 'i', recipientHash: 'k', customerId: 'c', order: 5 }, { now: at(0) });
  assert.deepEqual(planDrain([p, q, rr], 10).due.map((x) => x.recipientHash), ['m', 'z', 'k']);
});

test('a holding tick never burns an attempt; a due claim burns exactly one', () => {
  const held = buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(0), availableAt: 500 });
  // before the window: holding, not due, so a drain never claims it
  const { due, holding } = planDrain([held], 100);
  assert.deepEqual(due, []);
  assert.equal(holding.length, 1);
  assert.equal(holding[0].attempts, 0, 'a holding record keeps 0 attempts');
  // after the window: due -> claim burns exactly one attempt and moves to claimed
  const claimed = markClaimed(held, { now: at(600) });
  assert.equal(claimed.status, 'claimed');
  assert.equal(claimed.attempts, 1);
  assert.equal(claimed.claimedAt, 600);
});

test('markSent is the per-recipient sent marker: a sent record is never due or drained again', () => {
  const r = buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(0) });
  const sent = markSent(r, { now: at(7) });
  assert.equal(sent.status, 'sent');
  assert.equal(sent.sentAt, 7);
  assert.equal(isDue(sent, 1000), false);
  assert.deepEqual(planDrain([sent], 1000).due, []);
  assert.equal(canRetry(sent), false);
});

test('canRetry respects the attempt budget; markFailed terminalizes', () => {
  let r = buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(0) });
  assert.equal(canRetry(r, 3), true);
  r = { ...r, attempts: 3 };
  assert.equal(canRetry(r, 3), false); // budget exhausted
  const failed = markFailed(r, { now: at(8) });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failedAt, 8);
  assert.equal(canRetry(failed, 99), false); // terminal, never retried
  // default budget
  assert.equal(canRetry(buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(0) })), true);
  assert.equal(DEFAULT_MAX_ATTEMPTS, 5);
});

test('releaseClaim returns a claimed record to pending without touching attempts', () => {
  const r = buildMailSend({ issueId: 'i', recipientHash: 'h', customerId: 'c' }, { now: at(0) });
  const claimed = markClaimed(r, { now: at(1) });
  const released = releaseClaim(claimed);
  assert.equal(released.status, 'pending');
  assert.equal(released.claimedAt, null);
  assert.equal(released.attempts, 1, 'a released retry keeps its spent attempt');
});

test('withinBudget is a FAIL-CLOSED hard ceiling', () => {
  // fail-closed: an unreadable/missing counter sends nothing
  assert.equal(withinBudget({ daily: null, monthly: 0 }, { dailyCap: 100, monthlyCap: 3000 }), false);
  assert.equal(withinBudget({ daily: 0, monthly: undefined }, { dailyCap: 100, monthlyCap: 3000 }), false);
  assert.equal(withinBudget({ daily: NaN, monthly: 0 }, { dailyCap: 100 }), false);
  assert.equal(withinBudget({ daily: -1, monthly: 0 }, { dailyCap: 100 }), false);
  assert.equal(withinBudget({}, { dailyCap: 100, monthlyCap: 3000 }), false); // both missing
  // at the cap: closed
  assert.equal(withinBudget({ daily: 100, monthly: 500 }, { dailyCap: 100, monthlyCap: 3000 }), false);
  assert.equal(withinBudget({ daily: 50, monthly: 3000 }, { dailyCap: 100, monthlyCap: 3000 }), false);
  // under both caps: open
  assert.equal(withinBudget({ daily: 99, monthly: 2999 }, { dailyCap: 100, monthlyCap: 3000 }), true);
  // a null cap is unlimited on that axis, but a real counter is still required
  assert.equal(withinBudget({ daily: 1e9, monthly: 0 }, { dailyCap: null, monthlyCap: 3000 }), true);
});

test('budgetRemaining returns the tighter headroom and 0 when a counter is unreadable', () => {
  assert.equal(budgetRemaining({ daily: 90, monthly: 100 }, { dailyCap: 100, monthlyCap: 3000 }), 10);
  assert.equal(budgetRemaining({ daily: 10, monthly: 2995 }, { dailyCap: 100, monthlyCap: 3000 }), 5);
  assert.equal(budgetRemaining({ daily: null, monthly: 100 }, { dailyCap: 100, monthlyCap: 3000 }), 0); // fail-closed
  assert.equal(budgetRemaining({ daily: 100, monthly: 100 }, { dailyCap: 100, monthlyCap: 3000 }), 0); // at cap
});

test('budget key builders + hashString are pure and stable', () => {
  assert.equal(budgetDayKey('2026-08-18'), 'mail:budget:day:2026-08-18');
  assert.equal(budgetMonthKey('2026-08'), 'mail:budget:month:2026-08');
  assert.equal(hashString('a'), hashString('a')); // deterministic
  assert.notEqual(hashString('a'), hashString('b'));
  assert.ok(Number.isInteger(hashString('anything')) && hashString('anything') >= 0);
});

test('rotateOrder is deterministic, a permutation, and leads with a different cohort per issue', () => {
  const hashes = ['e', 'a', 'd', 'b', 'c'];
  const w1 = rotateOrder(hashes, '2026-08-18');
  // deterministic
  assert.deepEqual(rotateOrder(hashes, '2026-08-18'), w1);
  // a permutation of the canonical sorted set (no drop, no dup)
  assert.deepEqual([...w1].sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.equal(new Set(w1).size, 5);
  // rotation varies the lead across issues. Two SPECIFIC ids can share an offset mod n (a 1-in-n
  // coincidence), so the robust property is over a spread of ids: more than one distinct subscriber leads.
  const leads = new Set(Array.from({ length: 12 }, (_, i) => rotateOrder(hashes, `iss-${i}`)[0]));
  assert.ok(leads.size > 1, 'the rotation must not always lead with the same subscriber');
  // empty + junk input is safe
  assert.deepEqual(rotateOrder([], 'i'), []);
  assert.deepEqual(rotateOrder(['x', '', null, 'x2'], 'i').sort(), ['x', 'x2']);
});

test('backlogCount + oldestPendingAgeMs report the backlog, never hide it', () => {
  const p1 = buildMailSend({ issueId: 'i', recipientHash: 'a', customerId: 'c' }, { now: at(0), availableAt: 100 });
  const p2 = buildMailSend({ issueId: 'i', recipientHash: 'b', customerId: 'c' }, { now: at(0), availableAt: 400 });
  const done = markSent(buildMailSend({ issueId: 'i', recipientHash: 'z', customerId: 'c' }, { now: at(0) }), { now: at(1) });
  assert.equal(backlogCount([p1, p2, done]), 2); // only pending counts
  assert.equal(oldestPendingAgeMs([p1, p2, done], 1000), 900); // max(1000-100, 1000-400) = 900
  assert.equal(oldestPendingAgeMs([done], 1000), 0); // drained
});

// The load-bearing guarantee: a 1,000-recipient issue on FREE settings (100/day, 3,000/month, 10/tick over
// 288 ticks/day) delivers every recipient exactly once and NEVER exceeds a cap on any day or the month. This
// simulates the mail drain's release math over the pure primitives.
test('SIMULATION: 1,000 recipients on free settings send once each, never over 100/day or 3,000/month', () => {
  const DAILY_CAP = 100;
  const MONTHLY_CAP = 3000;
  const PER_TICK = 10;
  const TICKS_PER_DAY = 288;
  const issueId = 'load-test-issue';

  const rotated = rotateOrder(Array.from({ length: 1000 }, (_, i) => `r${String(i).padStart(4, '0')}`), issueId);
  const records = new Map();
  rotated.forEach((rh, idx) => {
    records.set(rh, buildMailSend({ issueId, recipientHash: rh, customerId: `cus_${idx}`, order: idx }, { now: at(0), availableAt: 0 }));
  });

  let monthly = 0;
  const sentTimes = new Map(); // recipientHash -> count, to prove exactly-once
  let maxDailyObserved = 0;
  let day = 0;
  const MAX_DAYS = 30;

  while (backlogCount([...records.values()]) > 0 && day < MAX_DAYS) {
    let daily = 0;
    for (let tick = 0; tick < TICKS_PER_DAY; tick++) {
      const nowMs = (day * TICKS_PER_DAY + tick) * 300_000; // a 5-minute tick
      const { due } = planDrain([...records.values()], nowMs);
      // the drain's per-tick allowance: min(per-tick cap, remaining budget). FAIL-CLOSED budget is a real number here.
      const allowance = Math.min(PER_TICK, budgetRemaining({ daily, monthly }, { dailyCap: DAILY_CAP, monthlyCap: MONTHLY_CAP }));
      for (let i = 0; i < allowance && i < due.length; i++) {
        const rec = due[i];
        // claim -> send (the real drain re-reads before send; here the record is authoritative)
        const claimed = markClaimed(rec, { now: at(nowMs) });
        const sent = markSent(claimed, { now: at(nowMs) });
        records.set(rec.recipientHash, sent);
        sentTimes.set(rec.recipientHash, (sentTimes.get(rec.recipientHash) || 0) + 1);
        daily++;
        monthly++;
      }
      // INVARIANT: a single day never crosses the daily cap
      assert.ok(daily <= DAILY_CAP, `day ${day} daily ${daily} exceeded cap`);
      // INVARIANT: the month never crosses the monthly cap
      assert.ok(monthly <= MONTHLY_CAP, `monthly ${monthly} exceeded cap`);
    }
    maxDailyObserved = Math.max(maxDailyObserved, daily);
    day++;
  }

  // Every recipient delivered
  assert.equal(sentTimes.size, 1000, 'all 1,000 recipients delivered');
  // Exactly once each: no double-send
  for (const [rh, count] of sentTimes) assert.equal(count, 1, `recipient ${rh} sent ${count} times`);
  // Caps honored across the whole run
  assert.ok(maxDailyObserved <= DAILY_CAP);
  assert.ok(monthly <= MONTHLY_CAP);
  assert.equal(monthly, 1000); // total sends == recipients
  // At 100/day it takes 10 days; assert it converged well inside the month
  assert.ok(day <= 11, `converged in ${day} days`);
  assert.equal(backlogCount([...records.values()]), 0, 'backlog fully drained');
});
