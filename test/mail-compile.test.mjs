// SOW-166: the weekly compile orchestrator. Fake fetch/news/KV; proves the pipe end to end: gather -> compose
// ONCE (members item excluded, news ranked by opens) -> freeze -> enqueue per subscriber, idempotent by the
// weekly issue id, and ALWAYS-SEND (a fully-empty week still composes and enqueues). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileWeeklyIssue, gatherContentEntries, gatherNewsEntries, listRecipientHashes, resolveWindow } from '../workers/signup/mail-compile.mjs';
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
  // No prior issue seeded -> the FIRST-issue regime: a bootstrap window, no exclude set, launch wording.
  assert.equal(issue.window.since, Date.UTC(2026, 7, 25, 13, 0, 0) - 7 * 24 * 3600 * 1000, 'first issue bootstraps the window to now - 7 days (never null)');
  assert.equal(issue.window.excluded, null, 'first issue carries no exclude set');
  assert.equal(r.firstIssue, true, 'the compile surfaces the launch regime');
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

// ---------- resolveWindow: the two composeIssue regimes (SowMaster ruling; `since` OR `exclude`, never both) ----------

const WEEK = 7 * 24 * 3600 * 1000;
const gen = (mo, day) => Date.UTC(2026, mo, day, 13, 0, 0);

test('resolveWindow (FIRST issue): no prior -> since = now - 7d, exclude null, firstIssue true', async () => {
  const kv = makeKV();
  const nowMs = gen(7, 25);
  assert.deepEqual(
    await resolveWindow(kv, { nowMs, currentIssueId: 'weekly-2026-08-25' }),
    { firstIssue: true, since: nowMs - WEEK, exclude: null },
  );
});

const EPOCH = Date.UTC(2026, 6, 28); // a newsletter that launched ~2026-07-28, recorded as issue one's window.since

test('resolveWindow (THEREAFTER): a prior exists -> since = the newsletter EPOCH (a floor), exclude = the mailed member urls', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH, excluded: null, appliesTo: 'members' }, sections: {
    article: [{ url: '/articles/a1/' }], product: [{ url: '/products/p1/' }], prompt: [], share: [{ url: '/shares/ann/s1/' }],
  }, topNews: [{ url: 'https://n/news-should-not-be-excluded' }] });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.firstIssue, false);
  assert.equal(w.since, EPOCH, 'the floor is the newsletter epoch, not null; null would drain the pre-newsletter back catalogue');
  assert.deepEqual([...w.exclude].sort(), ['/articles/a1/', '/products/p1/', '/shares/ann/s1/'], 'all member sections, unioned');
  assert.ok(!w.exclude.has('https://n/news-should-not-be-excluded'), 'news is NOT excluded (it re-ranks by opens)');
});

test('resolveWindow: a foreign (non weekly-) issue id is not counted as a prior, so we stay in the first-issue regime', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'manual-backfill', generatedAt: gen(7, 20), sections: { article: [{ url: '/x/' }] } });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.firstIssue, true, 'the foreign id does not flip us into the exclude regime');
  assert.equal(w.exclude, null);
});

test('resolveWindow: exclude is bounded to the last historyDepth issues; the epoch is still read from the oldest', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH }, sections: { article: [{ url: '/articles/old/' }] } });
  await putIssue(kv, { issueId: 'weekly-2026-08-11', generatedAt: gen(7, 11), sections: { article: [{ url: '/articles/mid/' }] } });
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: gen(7, 18), sections: { article: [{ url: '/articles/recent/' }] } });
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25', historyDepth: 2 });
  assert.deepEqual([...w.exclude].sort(), ['/articles/mid/', '/articles/recent/'], 'the two newest priors only');
  assert.ok(!w.exclude.has('/articles/old/'), 'the issue beyond the history depth is not read for exclusion');
  assert.equal(w.since, EPOCH, 'but the epoch IS read from the oldest issue, even though it is beyond historyDepth');
});

test('resolveWindow: a first issue with no recorded window.since falls back to its own date as the epoch', async () => {
  const kv = makeKV();
  await putIssue(kv, { issueId: 'weekly-2026-08-18', generatedAt: gen(7, 18), sections: { article: [{ url: '/a/' }] } }); // legacy: no window
  const w = await resolveWindow(kv, { nowMs: gen(7, 25), currentIssueId: 'weekly-2026-08-25' });
  assert.equal(w.since, Date.UTC(2026, 7, 18, 0, 0, 0), 'parsed from the oldest issue id at midnight UTC, still a real floor');
});

test('compileWeeklyIssue FIRST issue: launch window drops an out-of-window item, keeps an in-window one', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  const activity = { entries: [
    { type: 'post', slug: 'in', title: 'In launch window', url: '/articles/in/', author: 'ann', publishedAt: Date.UTC(2026, 7, 22), visibility: 'public' },
    { type: 'post', slug: 'out', title: 'Before launch window', url: '/articles/out/', author: 'ann', publishedAt: Date.UTC(2026, 7, 10), visibility: 'public' },
  ] };
  const d = { ...deps(kv), fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }), queryItems: async () => ({ items: [] }) };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
  assert.equal(r.firstIssue, true);
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['In launch window'], 'the pre-window item is dropped by the launch bound');
  assert.equal(issue.window.since, gen(7, 25) - WEEK);
  assert.equal(issue.window.excluded, null);
  assert.ok(issue.launchNote, 'a first issue carries the launch note');
});

test('compileWeeklyIssue THEREAFTER: epoch floor + exclude keeps a held item, drops the pre-newsletter back catalogue, excludes already-mailed', async () => {
  const kv = makeKV();
  seedSubscribers(kv, ['r1']);
  // Issue one (the oldest prior) records the newsletter epoch as its window.since and already mailed one article.
  await putIssue(kv, { issueId: 'weekly-2026-08-04', generatedAt: gen(7, 4), window: { since: EPOCH, excluded: null, appliesTo: 'members' }, sections: {
    article: [{ url: '/articles/mailed/', title: 'Already mailed' }], product: [], prompt: [], share: [],
  } });
  const activity = { entries: [
    { type: 'post', slug: 'mailed',  title: 'Already mailed',      url: '/articles/mailed/',  author: 'ann', publishedAt: Date.UTC(2026, 6, 30), visibility: 'public' }, // after epoch, already mailed
    { type: 'post', slug: 'fresh',   title: 'Fresh this week',     url: '/articles/fresh/',   author: 'ann', publishedAt: Date.UTC(2026, 7, 24), visibility: 'public' }, // new, not mailed
    { type: 'post', slug: 'held',    title: 'Held contribution',   url: '/articles/held/',    author: 'bob', publishedAt: Date.UTC(2026, 7, 1),  visibility: 'public' }, // after epoch, never mailed (held for review)
    { type: 'post', slug: 'prenews', title: 'Predates newsletter', url: '/articles/prenews/', author: 'ann', publishedAt: Date.UTC(2026, 3, 1),  visibility: 'public' }, // BEFORE epoch: floored, never the back catalogue
  ] };
  const d = { ...deps(kv), fetchImpl: fakeFetch({ '/activity-index.json': activity, '/shares-index.json': { entries: [] } }), queryItems: async () => ({ items: [] }) };
  const r = await compileWeeklyIssue({ SIGNUP_KV: kv, NEWS_KV: {} }, d);
  assert.equal(r.firstIssue, false);
  assert.equal(r.since, EPOCH, 'the floor is the newsletter epoch, not null');
  assert.equal(r.excluded, 1, 'exactly the one already-mailed url is excluded');
  const issue = await getIssue(kv, 'weekly-2026-08-25');
  // Four cases in ONE compile, so no single mutant passes: fresh KEPT, held (after epoch, never mailed) KEPT,
  // already-mailed EXCLUDED, pre-newsletter (before epoch) FLOORED. byDateDesc: fresh (08-24) then held (08-01).
  // since=null would surface 'Predates newsletter'; a removed exclude would surface 'Already mailed'; a tight
  // per-issue window would drop 'Held contribution'.
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Fresh this week', 'Held contribution'],
    'held item kept (Trap Two), already-mailed excluded, pre-newsletter floored out');
  assert.equal(issue.window.since, EPOCH);
  assert.equal(issue.window.excluded, 1);
});
