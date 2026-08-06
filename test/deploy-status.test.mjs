// sow-185: pure shaping for the public deploy-status response. Node-free, no KV binding involved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shapeDeployStatus } from '../membership/deploy-status.mjs';

const NOW = new Date('2026-08-06T02:00:45Z');

test('a fresh marker shapes to pending:true with the elapsed seconds since startedAt', () => {
  const r = shapeDeployStatus({ startedAt: '2026-08-06T02:00:00Z' }, { now: NOW });
  assert.deepEqual(r, { pending: true, startedAt: '2026-08-06T02:00:00Z', elapsedSeconds: 45 });
});

test('no record (never marked, or already cleared) shapes to pending:false', () => {
  assert.deepEqual(shapeDeployStatus(null, { now: NOW }), { pending: false });
  assert.deepEqual(shapeDeployStatus(undefined, { now: NOW }), { pending: false });
});

test('a malformed record fails open to pending:false rather than throwing', () => {
  assert.deepEqual(shapeDeployStatus({}, { now: NOW }), { pending: false });
  assert.deepEqual(shapeDeployStatus({ startedAt: 123 }, { now: NOW }), { pending: false });
  assert.deepEqual(shapeDeployStatus({ startedAt: 'not-a-date' }, { now: NOW }), { pending: false });
  assert.deepEqual(shapeDeployStatus('a string, not an object', { now: NOW }), { pending: false });
});

test('elapsedSeconds never goes negative even if startedAt is (briefly) in the future', () => {
  const r = shapeDeployStatus({ startedAt: '2026-08-06T02:01:00Z' }, { now: NOW });
  assert.equal(r.elapsedSeconds, 0);
});
