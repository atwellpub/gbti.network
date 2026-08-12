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

// relTime existed in three near-identical copies before this change. gbti-card-list's is now the shared one;
// the discussion and shares-feed copies were left in place, because rewiring them changes what the comment
// thread and the shares feed SAY, which is a UI change this feature does not authorize.
//
// Writing this test surfaced a real pre-existing inconsistency rather than confirming agreement. The two
// private copies flatten everything under 24 hours to "today". The shared one reports "5 minutes ago" and
// "3 hours ago", which the comment on it records as an explicit owner request. So that request reached the
// card list and never reached the other two, and the same elapsed time reads differently depending on which
// surface a member is looking at. Pinned here as KNOWN rather than asserted away, with agreement still
// enforced from one day out so a future edit to either copy cannot drift further unnoticed.
test('DRIFT: the private relTime copies agree with the shared one from a day out (sub-day divergence is known)', () => {
  const NOW = Date.parse('2026-08-11T12:00:00Z');
  const dayPlus = [NOW - 2 * 86_400_000, NOW - 45 * 86_400_000, NOW - 400 * 86_400_000];
  for (const f of ['client-ui/src/elements/gbti-discussion.mjs', 'client-ui/src/elements/gbti-shares-feed.mjs']) {
    const s = src(f);
    const m = /function relTime\(iso\)\s*\{[\s\S]*?\n\}/.exec(s);
    assert.ok(m, `${f} no longer defines a private relTime; if it now imports the shared one, delete this case`);
    // eslint-disable-next-line no-new-func
    const theirs = new Function(`${m[0]}; return relTime;`)();
    for (const t of dayPlus) {
      assert.equal(theirs(new Date(t).toISOString()), relTime(t, NOW), `${f} drifted from the shared relTime at ${new Date(t).toISOString()}`);
    }
    // The known gap, asserted so that FIXING it fails this test and forces the note above to be updated.
    assert.equal(theirs(new Date(NOW - 3 * 3_600_000).toISOString()), 'today', `${f} sub-day behavior changed; update the known-divergence note`);
    assert.equal(relTime(NOW - 3 * 3_600_000, NOW), '3 hours ago');
  }
});
