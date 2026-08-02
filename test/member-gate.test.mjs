// The re-login fix: resolveMemberSession must distinguish a DEFINITIVE signed-out (401 / 200-no-login) from a
// TRANSIENT failure (network throw / >= 500), retrying the transient case so a valid session is never bounced to
// /login on a momentary blip. Pure over an injected fetch + a no-op sleep (no real timers in the suite).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMemberSession } from '../src/lib/member-gate-core.mjs';

const noSleep = async () => {};
// A fetch that returns a scripted sequence of responses/throws (one per attempt), recording the call count.
function seqFetch(steps) {
  let i = 0;
  const calls = { n: 0 };
  const impl = async () => {
    calls.n += 1;
    const step = steps[Math.min(i, steps.length - 1)];
    i += 1;
    if (step.throw) throw new Error('network');
    return { status: step.status, ok: step.status >= 200 && step.status < 300, async json() { return step.body ?? {}; } };
  };
  return { impl, calls };
}
const run = (steps, opts = {}) => {
  const { impl, calls } = seqFetch(steps);
  return { p: resolveMemberSession({ base: 'https://s', fetchImpl: impl, sleep: noSleep, ...opts }), calls };
};

test('a 200 with { ok, login } -> in (no retry)', async () => {
  const { p, calls } = run([{ status: 200, body: { ok: true, login: 'ada' } }]);
  assert.deepEqual(await p, { state: 'in', payload: { ok: true, login: 'ada' } });
  assert.equal(calls.n, 1);
});

test('a 401 -> out, and is NEVER retried (definitive signed-out)', async () => {
  const { p, calls } = run([{ status: 401, body: { error: 'unauthorized' } }], { retries: 2 });
  assert.deepEqual(await p, { state: 'out' });
  assert.equal(calls.n, 1, '401 is definitive, not transient');
});

test('a 200 with no login -> out', async () => {
  const { p } = run([{ status: 200, body: { ok: true } }]);
  assert.deepEqual(await p, { state: 'out' });
});

test('a single 500 then a 200 -> in (transient retried, session preserved)', async () => {
  const { p, calls } = run([{ status: 500 }, { status: 200, body: { ok: true, login: 'ada' } }], { retries: 2 });
  assert.equal((await p).state, 'in');
  assert.equal(calls.n, 2, 'retried once after the 500');
});

test('a persistent 500 -> error after the retries (NOT out, so no forced logout)', async () => {
  const { p, calls } = run([{ status: 500 }], { retries: 2 });
  assert.deepEqual(await p, { state: 'error' });
  assert.equal(calls.n, 3, '1 initial + 2 retries');
});

test('a network throw then a success -> in (transient retried)', async () => {
  const { p, calls } = run([{ throw: true }, { status: 200, body: { ok: true, login: 'ada' } }], { retries: 2 });
  assert.equal((await p).state, 'in');
  assert.equal(calls.n, 2);
});

test('a persistent network throw -> error (never a forced logout)', async () => {
  const { p } = run([{ throw: true }], { retries: 1 });
  assert.deepEqual(await p, { state: 'error' });
});

// A 429 (rate limit) / 408 (request timeout) is the server saying "try again", NOT "signed out". It must be
// treated as transient (retried), never fall through to 'out' (which on workbench/admin bounces to /login).
test('a single 429 then a 200 -> in (rate-limit is transient, retried)', async () => {
  const { p, calls } = run([{ status: 429 }, { status: 200, body: { ok: true, login: 'ada' } }], { retries: 2 });
  assert.equal((await p).state, 'in');
  assert.equal(calls.n, 2, 'retried once after the 429');
});

test('a persistent 429 -> error after the retries (NOT out, so no forced logout)', async () => {
  const { p, calls } = run([{ status: 429 }], { retries: 2 });
  assert.deepEqual(await p, { state: 'error' });
  assert.equal(calls.n, 3, '1 initial + 2 retries');
});

test('a single 408 then a 200 -> in (request-timeout is transient, retried)', async () => {
  const { p, calls } = run([{ status: 408 }, { status: 200, body: { ok: true, login: 'ada' } }], { retries: 2 });
  assert.equal((await p).state, 'in');
  assert.equal(calls.n, 2, 'retried once after the 408');
});
