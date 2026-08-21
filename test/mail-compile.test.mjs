// SOW-166: the weekly compile orchestrator. Fake fetch/news/KV; proves the pipe end to end: gather -> compose
// ONCE (members item excluded, news ranked by opens) -> freeze -> enqueue per subscriber, idempotent by the
// weekly issue id, and ALWAYS-SEND (a fully-empty week still composes and enqueues). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWeeklyIssue, gatherContentEntries, gatherNewsEntries, listRecipientHashes, resolveSince } from '../workers/signup/mail-compile.mjs';
import { getIssue, putIssue, readPendingIndex, getSend } from '../workers/signup/mail-store.mjs';
import { subscriberKey, MAIL_SUBSCRIBER_PREFIX } from '../membership/mail-suppress.mjs';
import { buildSubscriber } from '../membership/mail-subscriber.mjs';
import { applyOpen, normalizeNewsOpens } from '../membership/news-opens.mjs';
import { NEWS_OPENS_KEY } from '../workers/signup/membership-news-opened.mjs';

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
    async list({ prefix = '', cursor } = {}) {
      return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
    },
  };
}

// A fetch that maps a URL suffix to a JSON body; anything else is a 404.
function fakeFetch(map) {
  return async (url) => {
    for (const [suffix, body] of Object.entries(map)) {
      if (String(url).endsWith(suffix)) return { ok: true, json: async () => body };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

// Dates sit INSIDE the first-issue bootstrap window (now = 2026-08-25 13:00, so since = 2026-08-18 13:00); if
// they did not, the content window would drop them and these tests would be measuring the window, not the
// compile. The members stub is in-window too, so it is dropped by VISIBILITY (the property under test), not by
// its date.
const ACTIVITY = { entries: [
  { type: 'post', slug: 'p', title: 'Public post', url: '/articles/p/', author: 'ann', publishedAt: Date.UTC(2026, 7, 22), visibility: 'public' },
  { type: 'post', slug: 'm', title: 'Members stub', url: '/articles/m/', author: 'ann', publishedAt: Date.UTC(2026, 7, 23), visibility: 'members' },
] };
const SHARES = { entries: [
  { type: 'share', slug: 'ann/s1', title: 'A public share', author: 'ann', url: '/shares/ann/s1/', publishedAt: Date.UTC(2026, 7, 21), visibility: 'public' },
] };
const NEWS_ITEMS = [
  { guid: 'g1', title: 'Hot news', link: 'https://n/1', source: 'Src', publishedAt: 1000 },
  { guid: 'g2', title: 'Cool news', link: 'https://n/2', source: 'Src2', publishedAt: 900 },
];

function opensRecord(openerIds) {
  let r = normalizeNewsOpens(null);
  for (const id of openerIds) r = applyOpen(r, { openerId: id }, { now: at(0) });
  return r;
}

function seedSubscribers(kv, hashes) {
  for (const h of hashes) kv.m.set(subscriberKey(h), { value: JSON.stringify(buildSubscriber({ hash: h, source: 'anon', emailEnc: `enc:${h}` }, { now: at(0) })), opts: null });
}

function deps(kv) {
  return {
    kv,
    now: at(Date.UTC(2026, 7, 25, 13, 0, 0)), // 2026-08-25
    fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': SHARES }),
    queryItems: async () => ({ items: NEWS_ITEMS }),
    siteUrl: 'https://gbti.network',
  };
}

test('gatherContentEntries combines both artifacts; a failed fetch is fail-soft ([] for that artifact)', async () => {
  const both = await gatherContentEntries({}, { fetchImpl: fakeFetch({ '/activity-index.json': ACTIVITY, '/shares-index.json': SHARES }), siteUrl: 'https://x' });
  assert.equal(both.length, 3);
  const onlyShares = await gatherContentEntries({}, { fetchImpl: fakeFetch({ '/shares-index.json': SHARES }), siteUrl: 'https://x' });
  assert.equal(onlyShares.length, 1, 'a 404 on activity-index yields [] for it, not a crash');
  const none = await gatherContentEntries({}, { fetchImpl: async () => { throw new Error('network'); }, siteUrl: 'https://x' });
  assert.deepEqual(none, [], 'a thrown fetch is fail-soft');
});

test('gatherNewsEntries maps link->url + publishedAt->date and attaches the distinct-opener count', async () => {
  const kv = makeKV();
  kv.m.set(NEWS_OPENS_KEY('g1'), { value: JSON.stringify(opensRecord(['u1', 'u2', 'u3', 'u4', 'u5'])), opts: null });
  kv.m.set(NEWS_OPENS_KEY('g2'), { value: JSON.stringify(opensRecord(['u1', 'u2'])), opts: null });
  const out = await gatherNewsEntries({ SIGNUP_KV: kv, NEWS_KV: {} }, { kv, queryItems: async () => ({ items: NEWS_ITEMS }) });
  assert.deepEqual(out[0], { title: 'Hot news', url: 'https://n/1', source: 'Src', date: 1000, opens: 5 });
  assert.deepEqual(out[1], { title: 'Cool news', url: 'https://n/2', source: 'Src2', date: 900, opens: 2 });
  // no NEWS_KV binding -> no news (the store is not ready), never a crash
  assert.deepEqual(await gatherNewsEntries({ SIGNUP_KV: kv }, { kv, queryItems: async () => ({ items: NEWS_ITEMS }) }), []);
});

test('listRecipientHashes returns receivable subscribers and drops an unreceivable record', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  kv.m.set(subscriberKey('bad'), { value: JSON.stringify({ hash: 'bad', source: 'anon' }), opts: null }); // no emailEnc -> not receivable
  const { hashes, truncated } = await listRecipientHashes(kv);
  assert.deepEqual([...hashes].sort(), ['r1', 'r2', 'r3']);
  assert.equal(truncated, false);
  assert.ok(!hashes.includes('bad'), 'a record with no usable address is excluded');
});

test('compileWeeklyIssue: composes ONCE, excludes the members item, ranks news by opens, enqueues everyone', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2', 'r3']);
  kv.m.set(NEWS_OPENS_KEY('g1'), { value: JSON.stringify(opensRecord(['u1', 'u2', 'u3', 'u4', 'u5'])), opts: null });
  kv.m.set(NEWS_OPENS_KEY('g2'), { value: JSON.stringify(opensRecord(['u1', 'u2'])), opts: null });

  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(r.ok, true);
  assert.equal(r.issueId, 'weekly-2026-08-25');
  assert.equal(r.composed, true);
  assert.equal(r.recipients, 3);
  assert.equal(r.enqueued, 3);
  assert.equal(r.recipientsTruncated, false);

  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.ok(issue, 'the issue is frozen in KV');
  assert.equal(issue.window.since, Date.UTC(2026, 7, 25, 13, 0, 0) - 7 * 24 * 3600 * 1000, 'first issue bootstraps the window to now - 7 days (never null)');
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Public post'], 'the members stub was excluded by composeIssue');
  assert.deepEqual(issue.sections.share.map((s) => s.title), ['A public share']);
  assert.equal(issue.topNews[0].title, 'Hot news', 'news ranked by opens (5 > 2)');
  // every subscriber got a pending send record
  assert.deepEqual([...(await readPendingIndex(kv, 'weekly-2026-08-25'))].sort(), ['r1', 'r2', 'r3']);
  for (const h of ['r1', 'r2', 'r3']) assert.equal((await getSend(kv, 'weekly-2026-08-25', h)).status, 'pending');
});

test('compileWeeklyIssue is IDEMPOTENT: a re-run does not recompose or re-enqueue', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1', 'r2']);
  const first = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(first.composed, true);
  assert.equal(first.enqueued, 2);
  const second = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, deps(kv));
  assert.equal(second.composed, false, 'the frozen issue is reused, not recomposed');
  assert.equal(second.enqueued, 0, 'nobody is re-enqueued');
  assert.equal(second.recipients, 2);
});

test('ALWAYS-SEND: a fully-empty week (no content, no news) still composes and enqueues', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const emptyDeps = {
    ...deps(kv),
    fetchImpl: fakeFetch({}), // both artifacts 404 -> no member items
    queryItems: async () => ({ items: [] }), // no news
  };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, emptyDeps);
  assert.equal(r.composed, true, 'the owner ruling is literal always-send, even fully empty');
  assert.equal(r.enqueued, 1);
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.ok(issue, 'an empty issue is still frozen and sent');
  assert.equal(issue.isEmpty, true, 'and it is honestly marked empty');
});

test('compileWeeklyIssue with no kv is a safe no-op', async () => {
  assert.deepEqual(await compileWeeklyIssue({}, { kv: null }), { ok: false, reason: 'no kv' });
});

// ---------- resolveSince: the content-window lower bound ----------

const WEEK = 7 * 24 * 3600 * 1000;
const gen = (mo, day) => Date.UTC(2026, mo, day, 13, 0, 0);

test('resolveSince: no prior issue bootstraps to now - 7 days (never null)', async () => {
  const kv = makeKV();
  const nowMs = gen(7, 25);
  assert.equal(await resolveSince(kv, { nowMs, currentIssueId: 'weekly-2026-08-25' }), nowMs - WEEK);
});

test('resolveSince: returns the most recent PRIOR issue generatedAt, ignoring self and any future issue', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-11', generatedAt: gen(7, 11) });
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: gen(7, 18) });
  await putIssue(kv, { issueId: 'weekly-2026-08-25', generatedAt: gen(7, 25) }); // self
  await putIssue(kv, { issueId: 'weekly-2026-09-01', generatedAt: gen(8, 1) });  // future
  const since = await resolveSince(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(since, gen(7, 18), 'greatest id strictly before current: not self, not future, not the older 08-11');
});

test('resolveSince: a MISSED week widens the window to the last ACTUAL issue, not to bootstrap', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-11', generatedAt: gen(7, 11) });
  // The 08-18 compile never ran (an outage). Computing last-week's id (weekly-2026-08-18) and reading it would
  // miss and drop to bootstrap; taking the greatest PRIOR id widens correctly to 08-11.
  const since = await resolveSince(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(since, gen(7, 11), 'widen from the real prior issue rather than collapsing to a 7-day fallback');
});

test('resolveSince: a foreign (non weekly-) issue id is filtered, never mistaken for the prior', async () => {
  const kv = makeKV();
  // Sorts BELOW every weekly- id and is the only prior record. Without the `weekly-` shape filter, resolveSince
  // would pick it and window from its generatedAt; with the filter there is no valid prior, so we bootstrap.
  await putIssue(kv, { issueId: 'manual-backfill', generatedAt: gen(7, 20) });
  const nowMs = gen(7, 25);
  const since = await resolveSince(kv, { nowMs, currentIssueId: 'weekly-2026-08-25' });
  assert.equal(since, nowMs - WEEK, 'the foreign id is ignored; with no real weekly prior we bootstrap');
});

test('resolveSince: a prior issue missing generatedAt falls back to that issue`s date, not bootstrap', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-18' }); // no generatedAt (defensive path)
  const since = await resolveSince(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(since, Date.UTC(2026, 7, 18, 0, 0, 0), 'parsed from the prior issue id at midnight UTC');
});

test('compileWeeklyIssue WINDOWS content: in-window KEPT and out-of-window DROPPED in one compile; since = prior compile time', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const priorGen = gen(7, 18); // last Tuesday 13:00 UTC
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: priorGen });
  const activity = { entries: [
    { type: 'post', slug: 'in', title: 'In window', url: '/articles/in/', author: 'ann', publishedAt: Date.UTC(2026, 7, 20), visibility: 'public' }, // after prior compile
    { type: 'post', slug: 'out', title: 'Out of window', url: '/articles/out/', author: 'ann', publishedAt: Date.UTC(2026, 7, 15), visibility: 'public' }, // before prior compile
  ] };
  const d = {
    ...deps(kv),
    fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }),
    queryItems: async () => ({ items: [] }),
  };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
  assert.equal(r.issueId, 'weekly-2026-08-25');
  assert.equal(r.since, priorGen, 'the compile surfaces the resolved window for the cron log');
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  // The discriminating pair: a drop-everything or a no-window mutant fails one half of THIS one assertion.
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['In window'], 'older article dropped by the window, newer one kept');
  assert.equal(issue.window.since, priorGen, 'since is the prior compile time: not null (a resolveSince returning null would look like a working compile forever) and not bootstrap');
});
