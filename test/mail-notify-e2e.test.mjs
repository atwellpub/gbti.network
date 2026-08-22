// SOW-186 phase 4 (DELIVERY): the end-to-end fixture. Drives the publish-time fan-out runner (scripts/enqueue-
// notifications.mjs main()) against a FAKE KV seeded with a published article, its author's followers, their
// subscriber records and their notify prefs; then drains the resulting NOTIFICATION issue through the UNCHANGED
// mail drain (workers/signup/mail-drain.mjs) with the SAME kind-dispatching renderIssue the Worker injects. Proves
// the notification rides the digest's engine end to end: only the email-opted-in, mailable follower is enqueued,
// the drain renders the follow template (not the digest), the send gate + budget + unsubscribe are honoured, and
// the article BODY never reaches the inbox. No network, no Resend, no Stripe. SYNTHETIC hashes only.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { main as enqueueNotifications } from '../scripts/enqueue-notifications.mjs';
import { drainMailIssue } from '../workers/signup/mail-drain.mjs';
import { readPendingIndex, getSend } from '../workers/signup/mail-store.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { subscriberKey } from '../membership/mail-suppress.mjs';
import { renderNotificationEmail } from '../membership/mail-notify-render.mjs';

const at = (t) => () => t;

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e.value); } catch { return null; } }
      return e.value;
    },
    async put(key, value, opts) { m.set(key, { value: String(value), opts: opts || null }); },
    async delete(key) { m.delete(key); },
    async list({ prefix = '' } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// A member subscriber record carries githubId (mail-subscriber.mjs schema rule) -- the fan-out's github_id -> hash bridge.
async function seedMember(kv, { hash, githubId }) {
  await kv.put(subscriberKey(hash), JSON.stringify(buildSubscriber({ hash, source: 'member', githubId }, { now: at(1) })));
}

// The publish-time inputs the runner reads from disk, served from memory instead.
const ARTICLE = `---\ntitle: Hello World\nauthor: alice\ntype: post\nstatus: published\nvisibility: public\n---\nSECRET-MEMBERS-BODY should never reach an inbox.\n`;
const PROFILE = `---\ndisplayName: Alice Example\n---\nbio\n`;
const MEMBERS_INDEX = `9001: alice\n`;
function readFileFor(rel) {
  if (rel === 'members/alice/posts/x/index.md') return ARTICLE;
  if (rel === 'members/alice/profile.md') return PROFILE;
  if (rel === 'house/members-index.yml') return MEMBERS_INDEX;
  return null;
}

// The kind-dispatching renderer the Worker injects (workers/signup/index.mjs mailDrainDeps): a notification issue
// renders through the real follow template; any other kind through a stub digest renderer. Mirroring it here proves
// the seam, since the closure itself is not exported.
const renderByKind = (issue, ctx) => (issue && issue.kind === 'notification'
  ? renderNotificationEmail(issue, ctx)
  : { subject: 'WEEKLY DIGEST', html: '<p>digest</p>', text: 'digest' });

const resolveAddress = async (sub) => (sub && sub.hash ? `${sub.hash}@example.com` : null);
const OPEN = { MAIL_UNSUB_KEY: 'test-unsub-signing-key', PUBLIC_BASE_URL: 'https://signup.gbti.network', MAIL_SEND_UNRESTRICTED: 'true' };

function makeSender() {
  const sent = [];
  return { sent, sendEmail: async (msg) => { sent.push(msg); return { id: `re_${msg.to}` }; } };
}

test('E2E: fan-out enqueues only the email-opted-in mailable follower, and the drain sends the follow email', async () => {
  const kv = makeKV();
  // alice (github_id 9001) is followed by 11 and 22, both mailable members. 11 turned the article email on; 22 did not.
  await kv.put('followers:9001', JSON.stringify({ followers: [{ githubId: '11', addedAt: 1 }, { githubId: '22', addedAt: 1 }], updatedAt: 1 }));
  await seedMember(kv, { hash: 'hA', githubId: '11' });
  await seedMember(kv, { hash: 'hB', githubId: '22' });
  await kv.put('prefs:11', JSON.stringify({ notify: { article: { email: true } } }));
  await kv.put('prefs:22', JSON.stringify({ notify: { article: { email: false } } }));

  // FAN-OUT at publish (the Action step), --apply against the fake KV.
  const res = await enqueueNotifications({
    argv: ['--apply', '--added', 'members/alice/posts/x/index.md'],
    env: { SITE_ORIGIN: 'https://gbti.network' },
    deps: { kv, readFile: readFileFor },
    now: at(1_000_000),
  });
  assert.equal(res.notified, 1, 'exactly one follower has the email channel on and is mailable');
  assert.equal(res.enqueued, 1, 'one send record enqueued');
  const issueId = 'notify:post:alice:x';
  assert.deepEqual(await readPendingIndex(kv, issueId), ['hA'], 'only follower 11 (hA) is pending; 22 opted out');

  // DRAIN through the UNCHANGED engine with the kind-dispatching renderer.
  const sender = makeSender();
  const r = await drainMailIssue(OPEN, {
    kv, issueId, now: at(1_000_000), cap: 10, dailyCap: 1000, monthlyCap: 30000,
    resolveAddress, renderIssue: renderByKind, sendEmail: sender.sendEmail, from: 'notify@gbti.network',
  });

  assert.equal(r.sent, 1);
  assert.equal(sender.sent.length, 1);
  const msg = sender.sent[0];
  assert.equal(msg.to, 'hA@example.com', 'the opted-in follower receives it');
  assert.match(msg.subject, /Alice Example published a new article: Hello World/, 'the FOLLOW template rendered, not the digest');
  assert.ok(!msg.html.includes('SECRET-MEMBERS-BODY'), 'the article body never reaches the inbox');
  assert.ok(!msg.text.includes('SECRET-MEMBERS-BODY'));
  assert.ok(msg.html.toLowerCase().includes('unsubscribe'), 'one-click unsubscribe present');
  assert.equal((await getSend(kv, issueId, 'hA')).status, 'sent');
  assert.equal((await readPendingIndex(kv, issueId)).length, 0);
});

test('E2E: a members-only (Mode A) article is leak-gated out of the fan-out entirely', async () => {
  const kv = makeKV();
  await kv.put('followers:9001', JSON.stringify({ followers: [{ githubId: '11', addedAt: 1 }], updatedAt: 1 }));
  await seedMember(kv, { hash: 'hA', githubId: '11' });
  await kv.put('prefs:11', JSON.stringify({ notify: { article: { email: true } } }));

  const modeA = `---\ntitle: Secret\nauthor: alice\ntype: post\nstatus: published\nvisibility: members\n---\ngated body\n`;
  const res = await enqueueNotifications({
    argv: ['--apply', '--added', 'members/alice/posts/secret/index.md'],
    env: { SITE_ORIGIN: 'https://gbti.network' },
    deps: {
      kv,
      readFile: (rel) => (rel === 'members/alice/posts/secret/index.md' ? modeA : readFileFor(rel)),
    },
    now: at(1_000_000),
  });
  assert.equal(res.notified, 0, 'a members-only item never notifies (no public url)');
  assert.equal(res.enqueued, 0);
  assert.deepEqual(await readPendingIndex(kv, 'notify:post:alice:secret'), [], 'no issue enqueued for gated content');
});

test('E2E: the send gate stays fail-closed -- an enqueued notification sends NOTHING until the gate opens', async () => {
  const kv = makeKV();
  await kv.put('followers:9001', JSON.stringify({ followers: [{ githubId: '11', addedAt: 1 }], updatedAt: 1 }));
  await seedMember(kv, { hash: 'hA', githubId: '11' });
  await kv.put('prefs:11', JSON.stringify({ notify: { article: { email: true } } }));

  await enqueueNotifications({
    argv: ['--apply', '--added', 'members/alice/posts/x/index.md'],
    env: { SITE_ORIGIN: 'https://gbti.network' },
    deps: { kv, readFile: readFileFor },
    now: at(1_000_000),
  });

  const sender = makeSender();
  // CLOSED gate: MAIL_UNSUB config present, but no MAIL_SEND_UNRESTRICTED / allowlist.
  const r = await drainMailIssue({ MAIL_UNSUB_KEY: 'k', PUBLIC_BASE_URL: 'https://signup.gbti.network' }, {
    kv, issueId: 'notify:post:alice:x', now: at(1_000_000), cap: 10, dailyCap: 1000, monthlyCap: 30000,
    resolveAddress, renderIssue: renderByKind, sendEmail: sender.sendEmail, from: 'notify@gbti.network',
  });
  assert.equal(r.sent, 0, 'the notification path inherits the digest send gate, fail-closed');
  assert.equal(sender.sent.length, 0);
});
