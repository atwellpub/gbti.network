// The Worker's cron dispatch. Three schedules are configured; the routing used to be a ternary chain whose
// final branch was a CATCH-ALL, so it was two recognised crons plus "everything else runs the syndication
// drain". This pins that an unrecognised schedule runs NOTHING.
//
// WHY IT MATTERS MORE THAN A TIDINESS FIX. The next cron string anyone adds is the SOW-166 weekly digest, and
// a catch-all is at its worst exactly there: the digest would appear to do nothing while an unscheduled
// syndication drain posted to live channels in its place. That presents as "the digest is broken" rather than
// as a misroute, so the real fault is the last thing anyone would look for.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { resolveCronJob } from '../workers/signup/index.mjs';

// The three strings in workers/signup/wrangler.toml, under BOTH [triggers] and [env.production.triggers].
const CONFIGURED = ['0 * * * *', '30 * * * *', '*/5 * * * *'];

test('cron dispatch: each configured schedule routes to its own distinct job', () => {
  const labels = CONFIGURED.map((c) => resolveCronJob(c)?.label);
  assert.deepEqual(labels, ['news ingest', 'news image backfill', 'syndication drain']);
  assert.equal(new Set(labels).size, 3, 'three schedules, three DIFFERENT jobs, which the catch-all did not guarantee');
  for (const c of CONFIGURED) assert.equal(typeof resolveCronJob(c).run, 'function');
});

test('cron dispatch: an unrecognised schedule resolves to null, never to a default job', () => {
  // A fourth cron is the case this exists for. The rest are the shapes a bad controller can present.
  for (const cron of ['0 9 * * 1', '', null, undefined, '*/5 * * *', 'constructor', '__proto__', 'toString']) {
    assert.equal(resolveCronJob(cron), null, `${JSON.stringify(cron)} must not resolve to a job`);
  }
});

test('cron dispatch: an unrecognised schedule runs NOTHING and reports it', async () => {
  // Driving the real handler, not the resolver, because the resolver returning null is only half the claim:
  // the other half is that scheduled() acts on it instead of falling through.
  const scheduledWork = [];
  const errors = [];
  const realError = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await worker.scheduled({ cron: '0 9 * * 1' }, {}, { waitUntil: (p) => scheduledWork.push(p) });
  } finally {
    console.error = realError;
  }

  assert.equal(scheduledWork.length, 0, 'THE POINT: no job is scheduled for an unknown cron');
  assert.match(errors.join(' '), /UNRECOGNISED schedule/, 'and it is loud, not silent');
  assert.match(errors.join(' '), /0 9 \* \* 1/, 'naming the cron that was not understood');
});

test('cron dispatch: the weekly-digest case specifically, since that is the one this prevents', async () => {
  // SOW-166 is not wired to a cron. If someone adds one WITHOUT extending CRON_JOBS, the old code ran the
  // syndication drain. Now it runs nothing, which is the difference between a quiet misroute and a fixable one.
  const scheduledWork = [];
  const realError = console.error;
  console.error = () => {};
  try {
    await worker.scheduled({ cron: '0 14 * * 4' }, {}, { waitUntil: (p) => scheduledWork.push(p) });
  } finally {
    console.error = realError;
  }
  assert.equal(scheduledWork.length, 0, 'a digest cron added without a route must not silently syndicate');
});
