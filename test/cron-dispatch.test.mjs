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

// The four strings in workers/signup/wrangler.toml, under BOTH [triggers] and [env.production.triggers]. The
// fourth is the SOW-166 weekly digest compile; the 5-minute tick now runs the syndication drain AND the mail
// drain, composed, so its label changed.
const CONFIGURED = ['0 * * * *', '30 * * * *', '*/5 * * * *', '0 14 * * 2'];

test('cron dispatch: each configured schedule routes to its own distinct job', () => {
  const labels = CONFIGURED.map((c) => resolveCronJob(c)?.label);
  assert.deepEqual(labels, ['news ingest', 'news image backfill', 'syndication + mail drain', 'weekly digest compile']);
  assert.equal(new Set(labels).size, 4, 'four schedules, four DIFFERENT jobs, which the catch-all did not guarantee');
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

test('cron dispatch: the weekly-digest schedule IS now wired, and routes to the compile (SOW-166)', () => {
  // SOW-166 wired the weekly digest to 0 14 * * 2 (Tuesday 14:00 UTC), added to CRON_JOBS and to both
  // wrangler trigger blocks. It must resolve to the compile, not to the syndication drain the old catch-all
  // would have run.
  const job = resolveCronJob('0 14 * * 2');
  assert.equal(job?.label, 'weekly digest compile', 'the weekly cron routes to the compile');
  assert.equal(typeof job?.run, 'function');
});

test('cron dispatch: a digest-SHAPED but unconfigured cron still runs NOTHING, never a silent syndicate', async () => {
  // The protection the catch-all removal buys is unchanged: a plausible-looking weekly cron that was NOT added
  // to CRON_JOBS (here Thursday 14:00, not the configured Tuesday) resolves to null and schedules no work,
  // rather than silently running the syndication drain in its place.
  assert.equal(resolveCronJob('0 14 * * 4'), null, 'an unconfigured digest-shaped cron does not resolve');
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
