// SOW-029: the pure helpers behind the post-setup welcome view (<gbti-welcome>). No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseLabel, shuffle, excludeSelf, paginate, resumeStep } from '../client-ui/src/welcome-core.mjs';

test('phaseLabel maps paid/trialing and never throws (unknown + lapsed -> neutral)', () => {
  assert.equal(phaseLabel('paid').phase, 'paid');
  assert.equal(phaseLabel('paid').upgrade, false);
  assert.equal(phaseLabel('trialing').phase, 'trial');
  assert.equal(phaseLabel('trialing').upgrade, true);
  for (const s of ['unknown', 'expired', 'cancelled', 'none', 'banned', undefined, null, 'weird']) {
    const r = phaseLabel(s);
    assert.equal(r.phase, 'neutral', `${s} -> neutral`);
    assert.equal(r.upgrade, false);
    assert.ok(r.title && r.body, 'always has copy');
  }
});

// SOW-119 QA (2026-07-21): a coupon member is oracle-paid but did NOT pay. A live couponUntil reframes the
// banner as the free membership period with its end date; expired/malformed grants fall through to plain paid.
test('phaseLabel: a live coupon grant reframes paid as the free membership period', () => {
  const now = new Date('2026-07-21T12:00:00Z').valueOf();
  const r = phaseLabel('paid', { couponUntil: '2027-07-21T12:00:00Z', now });
  assert.equal(r.phase, 'coupon');
  assert.equal(r.upgrade, false);
  assert.match(r.title, /free membership period/i);
  assert.match(r.body, /July 21, 2027/, 'names the end date');
  assert.match(r.body, /nothing bills automatically/i);
  // expired or malformed grants fall through to the plain paid banner
  assert.equal(phaseLabel('paid', { couponUntil: '2026-01-01T00:00:00Z', now }).phase, 'paid');
  assert.equal(phaseLabel('paid', { couponUntil: 'not-a-date', now }).phase, 'paid');
  assert.equal(phaseLabel('paid', { couponUntil: null, now }).phase, 'paid');
  // couponUntil never upgrades a non-paid status
  assert.equal(phaseLabel('trialing', { couponUntil: '2027-07-21T12:00:00Z', now }).phase, 'trial');
});

test('shuffle is a permutation (no drops/dupes), deterministic for a fixed rng, and pure', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const seq = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05];
  const mk = () => { let k = 0; return () => seq[(k++) % seq.length]; };
  const out = shuffle(list, mk());
  assert.deepEqual([...out].sort((a, b) => a - b), list, 'same multiset, nothing dropped or duplicated');
  assert.deepEqual(list, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'input is not mutated');
  assert.deepEqual(shuffle(list, mk()), shuffle(list, mk()), 'deterministic for the same rng');
});

test('excludeSelf drops the own username case-insensitively', () => {
  const m = [{ username: 'Alice' }, { username: 'bob' }, { username: 'CAROL' }];
  assert.deepEqual(excludeSelf(m, 'alice').map((x) => x.username), ['bob', 'CAROL']);
  assert.equal(excludeSelf(m, '').length, 3, 'no own username -> keep all');
});

test('paginate slices PAGE_SIZE per page and clamps out-of-range pages', () => {
  const list = Array.from({ length: 23 }, (_, i) => i);
  const p1 = paginate(list, 1, 10);
  assert.equal(p1.items.length, 10);
  assert.equal(p1.pages, 3);
  assert.equal(p1.page, 1);
  assert.equal(paginate(list, 3, 10).items.length, 3);
  assert.equal(paginate(list, 99, 10).page, 3, 'clamps high');
  assert.equal(paginate(list, 0, 10).page, 1, 'clamps low');
});

// --- sow-207 QA: resuming the welcome wizard -------------------------------------------------------------

test('resumeStep returns the FIRST incomplete step', () => {
  assert.equal(resumeStep([false, false, false, false, false], 5), 0);
  assert.equal(resumeStep([true, false, false, false, false], 5), 1);
  assert.equal(resumeStep([true, true, true, false, false], 5), 3);
  assert.equal(resumeStep([true, true, true, true, false], 5), 4);
});

test('a GAP counts: an earlier unfinished step wins over later finished ones', () => {
  // Skipping socials but following members and picking topics must land on socials, not past it. A saved
  // step cursor could not express this; deriving from real state can.
  assert.equal(resumeStep([true, true, false, true, true], 5), 2);
});

test('everything done lands on the LAST step, never a done-state', () => {
  // Deliberate: the done card is reached by pressing "I am all set". Auto-jumping a returning member to it
  // would hide the wizard they came back to use.
  assert.equal(resumeStep([true, true, true, true, true], 5), 4);
});

test('resumeStep never returns an out-of-range step, whatever it is handed', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const i = resumeStep(bad, 5);
    assert.ok(Number.isInteger(i) && i >= 0 && i < 5, `resumeStep(${JSON.stringify(bad)}) -> ${i}`);
  }
  // A flag list SHORTER than the step count still resolves inside the wizard: the missing tail is unknown,
  // and unknown must read as not-done rather than silently completing a step.
  assert.equal(resumeStep([true, true], 5), 2);
  // A degenerate count cannot produce a negative index.
  assert.equal(resumeStep([], 0), 0);
  assert.equal(resumeStep([]), 0);
});

test('truthiness is not trusted: only real completion advances past a step', () => {
  // The element builds these flags with Boolean(...) / size > 0, so a falsy-but-present value (0 follows, an
  // empty socials draft) must behave exactly like false.
  assert.equal(resumeStep([true, 0, true, true, true], 5), 1);
  assert.equal(resumeStep([true, '', true, true, true], 5), 1);
  assert.equal(resumeStep([true, null, true, true, true], 5), 1);
});
