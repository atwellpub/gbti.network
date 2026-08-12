// sow-221: pull request rows carry a datetime. The owner asked for the best UX rather than naming a field, so
// the row shows the event that last moved the PR ("merged 2 hours ago") rather than only when it was opened:
// the state pill beside it already says WHERE the PR stands, and a list mixing open and finished work is
// mostly asking when something finished. Absolute stamp goes in a title tooltip, since "3 months ago" is not
// answerable on its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { prEvent, sortPullsByEvent } from '../client-ui/src/workspace-core.mjs';
import { relTime, absTime } from '../client-ui/src/time-core.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const T = (iso) => iso;

test('prEvent: a merged PR reports the merge, not the open', () => {
  const ev = prEvent({ state: 'closed', merged: true, createdAt: T('2026-08-01T00:00:00Z'), mergedAt: T('2026-08-10T00:00:00Z'), closedAt: T('2026-08-10T00:00:00Z'), updatedAt: T('2026-08-10T00:00:00Z') });
  assert.deepEqual(ev, { verb: 'merged', at: '2026-08-10T00:00:00Z' });
});

test('prEvent: a closed-unmerged PR reports the close', () => {
  const ev = prEvent({ state: 'closed', merged: false, createdAt: T('2026-08-01T00:00:00Z'), closedAt: T('2026-08-05T00:00:00Z') });
  assert.deepEqual(ev, { verb: 'closed', at: '2026-08-05T00:00:00Z' });
});

test('prEvent: an untouched open PR reports "opened", not "updated"', () => {
  // GitHub sets updated_at at creation, so a naive "latest wins" would label every new PR "updated".
  const ev = prEvent({ state: 'open', createdAt: T('2026-08-11T10:00:00Z'), updatedAt: T('2026-08-11T10:00:02Z') });
  assert.deepEqual(ev, { verb: 'opened', at: '2026-08-11T10:00:00Z' });
});

test('prEvent: an open PR touched later reports the update', () => {
  const ev = prEvent({ state: 'open', createdAt: T('2026-08-01T10:00:00Z'), updatedAt: T('2026-08-11T10:00:00Z') });
  assert.deepEqual(ev, { verb: 'updated', at: '2026-08-11T10:00:00Z' });
});

// The Worker and the site deploy separately, so the UI WILL see the old payload for a while.
test('prEvent: a payload with no timestamps degrades to no verb and no time, never "Invalid Date"', () => {
  assert.deepEqual(prEvent({ number: 1, title: 't', state: 'open' }), { verb: '', at: null });
  assert.deepEqual(prEvent({ state: 'closed', merged: true }), { verb: '', at: null });
  assert.deepEqual(prEvent({}), { verb: '', at: null });
  assert.equal(relTime(prEvent({}).at), '');
  assert.equal(absTime(prEvent({}).at), '');
});

test('sortPullsByEvent: newest event first, and a timestamp-less PR sorts last rather than to the top', () => {
  const out = sortPullsByEvent([
    { number: 1, state: 'open', createdAt: T('2026-08-01T00:00:00Z') },
    { number: 2, state: 'open' },
    { number: 3, state: 'closed', merged: true, mergedAt: T('2026-08-11T00:00:00Z') },
  ]);
  assert.deepEqual(out.map((p) => p.number), [3, 1, 2]);
});

test('sortPullsByEvent: does not mutate the caller array', () => {
  const input = [{ number: 1, createdAt: T('2026-08-01T00:00:00Z') }, { number: 2, createdAt: T('2026-08-09T00:00:00Z') }];
  sortPullsByEvent(input);
  assert.deepEqual(input.map((p) => p.number), [1, 2]);
});

// DRIFT: the Worker is the only source of these fields, and it deploys separately from the site. If the
// projection stops sending them, every row silently loses its date with no error anywhere.
test('DRIFT: the Worker still projects the four timestamps onto each my-pulls item', () => {
  const s = src('workers/signup/github-app.mjs');
  for (const f of ['createdAt: pr.created_at', 'updatedAt: pr.updated_at', 'mergedAt: pr.merged_at', 'closedAt: pr.closed_at']) {
    assert.ok(s.includes(f), `listMemberPulls no longer sends ${f}, so the PR rows lose their datetime`);
  }
});

// DRIFT: both PR surfaces must read the SAME rule. A second interpretation is how this codebase kept shipping
// two renderings of one thing.
test('DRIFT: both PR row surfaces use the shared prEvent, not their own date logic', () => {
  for (const f of ['client-ui/src/elements/gbti-workspace.mjs', 'client-ui/src/elements/gbti-pr-list.mjs']) {
    const s = src(f);
    assert.match(s, /prEvent\(pr\)/, `${f} stopped using the shared event rule`);
    assert.match(s, /from '\.\.\/time-core\.mjs'/, `${f} stopped using the shared relTime`);
  }
});

// relTime existed in THREE near-identical copies. The pull request work moved the definition to time-core and
// an earlier version of this test pinned the leftover split as known: the discussion and shares-feed copies
// flattened everything under 24 hours to "today", while the shared one says "3 hours ago", which its own
// comment records as an owner request that had reached the card list and never reached those two. The owner
// elected to consolidate, so the split is gone and this asserts it cannot come back.
test('DRIFT: every surface reads elapsed time from the one shared helper, with no private copy left', () => {
  const surfaces = [
    'client-ui/src/elements/gbti-discussion.mjs',
    'client-ui/src/elements/gbti-shares-feed.mjs',
    'client-ui/src/elements/gbti-activity-bell.mjs',
    'client-ui/src/elements/gbti-card-list.mjs',
  ];
  for (const f of surfaces) {
    const s = src(f);
    assert.doesNotMatch(s, /function relTime\s*\(/, `${f} defines its own relTime again; import it from time-core.mjs instead`);
    assert.match(s, /from '\.\.\/time-core\.mjs'/, `${f} stopped reading the shared relTime`);
  }
  // The behavior those copies used to have, now gone everywhere: a same-day item reports elapsed time.
  const NOW = Date.parse('2026-08-11T12:00:00Z');
  assert.equal(relTime(NOW - 3 * 3_600_000, NOW), '3 hours ago');
  assert.equal(relTime(NOW - 5 * 60_000, NOW), '5 minutes ago');
});

// The bell renders a time only when the item carries one. Every group builds `ts` differently (a PR, a
// comment, a contribution), so a missing one has to degrade to the row's previous appearance, not to a
// dangling separator.
test('the bell time degrades cleanly: no time, no separator, no Invalid Date', () => {
  assert.equal(relTime(undefined), '');
  assert.equal(relTime(0), '');
  assert.equal(relTime(NaN), '');
  assert.equal(absTime(undefined), '');
  const s = src('client-ui/src/elements/gbti-activity-bell.mjs');
  // The separator is inside the `when` branch, so an item with no time cannot emit a trailing " · ".
  assert.match(s, /\$\{when \? `\$\{it\.sub \? ' · ' : ''\}\$\{esc\(when\)\}` : ''\}/);
  assert.match(s, /\$\{abs \? ` title="\$\{esc\(abs\)\}"` : ''\}/);
});
