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

// The five strings in workers/signup/wrangler.toml under [env.production.triggers], which is now the only
// trigger block (the bare one was emptied on 2026-08-24 after it spawned a second Worker on live data).
// The two Tuesday entries are ONE job under two UTC times, because 7 AM Central is 12:00 UTC in summer and
// 13:00 UTC in winter; the 5-minute tick runs the syndication drain AND the mail drain, composed.
const CONFIGURED = ['0 * * * *', '30 * * * *', '*/5 * * * *', '0 12 * * 2', '0 13 * * 2'];

test('cron dispatch: every configured schedule routes, and to four distinct jobs', () => {
  const labels = CONFIGURED.map((c) => resolveCronJob(c)?.label);
  assert.deepEqual(labels, [
    'news ingest', 'news image backfill', 'syndication + mail drain',
    'weekly digest compile', 'weekly digest compile',
  ]);
  // Five schedules, FOUR jobs. The deliberate collision is the pair of Tuesday triggers; every other schedule
  // still has to be its own job, which is what the removed catch-all did not guarantee.
  assert.equal(new Set(labels).size, 4, 'the only shared job is the weekly digest, under its two UTC times');
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

test('cron dispatch: BOTH weekly-digest schedules wire to the compile, and the retired one does not', () => {
  // SOW-166 wired the weekly digest to a single 0 14 * * 2. The owner moved the send to 7 AM Central on
  // 2026-08-25, which is not expressible as one UTC cron, so it became two. Both must reach the compile.
  for (const cron of ['0 12 * * 2', '0 13 * * 2']) {
    const job = resolveCronJob(cron);
    assert.equal(job?.label, 'weekly digest compile', `${cron} routes to the compile`);
    assert.equal(typeof job?.run, 'function');
  }
  // And the old slot is genuinely gone rather than left wired alongside them, which would send at 9 AM Central
  // as well as at 7 and would look exactly like the digest firing twice.
  assert.equal(resolveCronJob('0 14 * * 2'), null, 'the retired 14:00 UTC slot no longer resolves');
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
