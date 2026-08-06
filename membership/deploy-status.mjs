// sow-185: pure shaping for the public "still deploying" status check. deploy.yml writes a raw
// { startedAt } record to SIGNUP_KV (key pendingdeploy:<type>:<slug>) when a push changes that item and clears
// it once the deploy succeeds; this shapes the raw record (or its absence) into the public response body.
// Node-free, so it unit-tests without a KV binding.

/** Shape a raw KV record ({ startedAt } or null/malformed) into the public deploy-status response. */
export function shapeDeployStatus(raw, { now = new Date() } = {}) {
  if (!raw || typeof raw !== 'object' || typeof raw.startedAt !== 'string') return { pending: false };
  const started = new Date(raw.startedAt);
  if (Number.isNaN(started.valueOf())) return { pending: false };
  const elapsedSeconds = Math.max(0, Math.round((now.getTime() - started.getTime()) / 1000));
  return { pending: true, startedAt: raw.startedAt, elapsedSeconds };
}
