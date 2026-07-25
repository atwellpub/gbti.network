// SOW-026: the gate's bot-aware author resolution. When GBTI's App bot opens the publish PR on a member's
// behalf, the trust anchor is the PR HEAD (the fork owner), not the opener.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent } from '../scripts/pr-gate.mjs';

const BOT = 555;
const ev = ({ openerId, headOwnerId, headSha = 'abc' } = {}) => ({
  number: 10,
  pull_request: {
    number: 10,
    user: { id: openerId },
    head: { sha: headSha, user: { id: headOwnerId }, repo: { owner: { id: headOwnerId } } },
  },
});

test('a member opening their own PR directly: author = the opener (unchanged behavior)', () => {
  const r = parseEvent(ev({ openerId: 1, headOwnerId: 1 }), BOT);
  assert.equal(r.author, 1);
  assert.equal(r.botOpened, false);
});

test('the App bot opens the PR: author resolves to the PR head owner (the fork owner)', () => {
  const r = parseEvent(ev({ openerId: BOT, headOwnerId: 42 }), BOT);
  assert.equal(r.author, 42, 'the member (fork owner), not the bot');
  assert.equal(r.botOpened, true);
});

test('without a botId configured, behavior is the legacy opener-as-author', () => {
  const r = parseEvent(ev({ openerId: 7, headOwnerId: 9 }), null);
  assert.equal(r.author, 7);
  assert.equal(r.botOpened, false);
});

test('a bot-opened PR with no resolvable head owner fails closed (author null)', () => {
  const event = { number: 1, pull_request: { number: 1, user: { id: BOT }, head: { sha: 's', user: null, repo: null } } };
  const r = parseEvent(event, BOT);
  assert.equal(r.author, null, 'no head owner -> null -> the gate throws (fail closed)');
  assert.equal(r.botOpened, true);
});

test('an event with no pull_request throws', () => {
  assert.throws(() => parseEvent({}, BOT), /no pull_request/);
});

// ---- SOW-156: hosted canonical-head PRs (the Worker commits to hosted/<github_id>/<itemId> on canonical) ----

const CANON = 900100; // the canonical repo id
const hostedEv = ({ openerId = BOT, ref, headRepoId = CANON, headOwnerId = 777 } = {}) => ({
  number: 20,
  pull_request: {
    number: 20,
    user: { id: openerId },
    head: { sha: 'hsha', ref, user: { id: headOwnerId }, repo: { id: headRepoId, owner: { id: headOwnerId } } },
    base: { repo: { id: CANON, owner: { id: 777 } } },
  },
});

test('SOW-156: a bot-opened canonical-head PR resolves the author from the hosted branch name', () => {
  const r = parseEvent(hostedEv({ ref: 'hosted/2002207/my-first-post' }), BOT);
  assert.equal(r.author, '2002207');
  assert.equal(r.botOpened, true);
});

test('SOW-156: a malformed hosted ref on a canonical-head bot PR fails closed to null, NEVER the org owner id', () => {
  for (const ref of ['gbti/quote-add', 'hosted/2002207', 'hosted/abc/x', 'hosted/999/evil/2002207/x', undefined]) {
    const r = parseEvent(hostedEv({ ref }), BOT);
    assert.equal(r.author, null, `ref ${ref} must fail closed`);
  }
});

test('SOW-156: a bot-opened FORK-head PR still resolves the fork owner (unchanged), even with a hosted-looking ref', () => {
  const r = parseEvent(hostedEv({ ref: 'hosted/999/spoof', headRepoId: 12345, headOwnerId: 42 }), BOT);
  assert.equal(r.author, 42, 'a fork head trusts the fork owner; the ref cannot spoof an id');
});

test('SOW-156: a NON-bot canonical-head PR (a superadmin pushing a branch) resolves the opener as always', () => {
  const r = parseEvent(hostedEv({ openerId: 7, ref: 'hosted/999/spoof' }), BOT);
  assert.equal(r.author, 7, 'a human opener is the author; the hosted rule only fires for the bot');
});
