// sow-273 follow-up: the digest click counter, both halves.
//
// The tests that matter most here are the ROUND TRIP ones. The renderer hashes a destination into a link and
// the Worker route re-hashes candidates to find it again, and the two computations live in different files
// called from different processes. A unit test of either half alone passes happily while the pair is broken,
// which is exactly the failure that was caught by hand during the build (the renderer was hashing the TAGGED
// url while the route rebuilt PLAIN ones, so every internal link would have bounced to the homepage while
// every external link kept working). So the load-bearing test renders through the REAL renderIssue, scrapes
// the hrefs out of the produced html, and drives each one through the REAL route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SECTION_FEED, FIXED_TARGETS, SITE_URL_DEFAULT,
  clickSlot, absolute, candidateTargets, resolveClick, taggedTarget,
  clickPath, parseClickPath, clickKey, emptyClicks, applyClick,
  resolveSiteUrl, resolveClickBase,
} from '../membership/mail-click.mjs';
import { handleMailClick } from '../workers/signup/mail-click-route.mjs';
import { renderIssue } from '../membership/mail-render.mjs';
import { mailDrainDeps } from '../workers/signup/index.mjs';

const SITE = 'https://gbti.network';
const BASE = 'https://signup.gbti.network';

// A frozen issue in the shape composeIssue actually stores: sections + topNews (the composition inputs) AND
// layout (what the renderer reads). Deliberately carries an EXTERNAL news url, because counting news clicks
// is the owner's 2026-08-24 decision and is the reason the route redirects off-site at all.
function frozenIssue() {
  return {
    issueId: 'weekly-2026-08-24',
    sections: {
      article: [{ kind: 'article', title: 'Ours', url: '/articles/ours/', author: 'hudson', date: 3 }],
      product: [], prompt: [], share: [],
    },
    topNews: [{ title: 'Theirs', url: 'https://www.theregister.com/a/?sponsored=1', source: 'The Register', date: 2 }],
    layout: [
      { key: 'article', label: 'Articles', empty: false, items: [
        { kind: 'article', title: 'Ours', url: '/articles/ours/', author: 'hudson', date: 3 }] },
      { key: 'news', label: 'News', empty: false, items: [
        { title: 'Theirs', url: 'https://www.theregister.com/a/?sponsored=1', source: 'The Register', date: 2 }] },
      { key: 'product', label: 'Products', empty: true, note: 'None.', items: [] },
    ],
  };
}

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(k, type) {
      const v = store.get(k);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(k, v) { store.set(k, String(v)); },
  };
}

const envFor = (kv) => ({ SIGNUP_KV: kv, SITE_URL: SITE, PUBLIC_BASE_URL: BASE });
const hit = (path) => new Request(`${BASE}${path}`);
const hrefs = (html) => [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);

// ---- the base resolvers, which are the thing both sides agree through ----

test('resolveSiteUrl: env wins, trailing slashes are stripped, and an unset env falls back to the live site', () => {
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://staging.example' }), 'https://staging.example');
  assert.equal(resolveSiteUrl({}), SITE_URL_DEFAULT);
  assert.equal(resolveSiteUrl(null), SITE_URL_DEFAULT);
  assert.equal(resolveSiteUrl({ SITE_URL: '  ' }), SITE_URL_DEFAULT);
  // THE TRAILING SLASH IS THE WHOLE POINT: mail-render's absUrl concatenates rather than URL-joining, so a
  // base ending in a slash produces https://x//feeds/ on the render side. Both sides read this function, so
  // stripping here is what keeps the two computations byte-identical.
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://gbti.network/' }), SITE);
  assert.equal(resolveSiteUrl({ SITE_URL: 'https://gbti.network///' }), SITE);
});

test('resolveClickBase: PUBLIC_BASE_URL, slash-stripped, and EMPTY when unset (never a guess)', () => {
  assert.equal(resolveClickBase({ PUBLIC_BASE_URL: `${BASE}/` }), BASE);
  assert.equal(resolveClickBase({}), '');
  // An empty base is not a degraded mode. The drain refuses to send at all without PUBLIC_BASE_URL, so this
  // can only be reached by something that is not sending mail.
  assert.equal(resolveClickBase(null), '');
});

// ---- the slot ----

test('clickSlot: 8 lowercase hex, stable across calls, and different for different urls', () => {
  const a = clickSlot(`${SITE}/articles/ours/`);
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, clickSlot(`${SITE}/articles/ours/`));
  assert.notEqual(a, clickSlot(`${SITE}/articles/theirs/`));
  assert.equal(clickSlot(''), '');
});

test('absolute mirrors mail-render absUrl exactly, INCLUDING its concatenation of the base', () => {
  assert.equal(absolute('/feeds/', SITE), `${SITE}/feeds/`);
  assert.equal(absolute('https://x.example/a', SITE), 'https://x.example/a');
  assert.equal(absolute('not-a-path', SITE), '');
  assert.equal(absolute('', SITE), '');
  // A URL join would normalize this to https://gbti.network/feeds/ and DISAGREE with the renderer, which is
  // the mismatch this function exists to avoid. It must reproduce the string, not improve on it.
  assert.equal(absolute('/feeds/', 'https://gbti.network/'), 'https://gbti.network//feeds/');
});

// ---- the candidate set and resolution ----

test('candidateTargets covers the fixed targets, every section feed, the items and the news', () => {
  const set = candidateTargets(frozenIssue(), SITE);
  for (const p of Object.values(FIXED_TARGETS)) assert.ok(set.has(`${SITE}${p}`), `fixed ${p}`);
  for (const p of Object.values(SECTION_FEED)) assert.ok(set.has(`${SITE}${p}`), `feed ${p}`);
  assert.ok(set.has(`${SITE}/articles/ours/`), 'the member item');
  assert.ok(set.has('https://www.theregister.com/a/?sponsored=1'), 'the news item, external and counted');
});

test('candidateTargets reads LAYOUT too, so an issue carrying only a layout still resolves', () => {
  const layoutOnly = { issueId: 'x', layout: [{ key: 'article', items: [{ url: '/only-in-layout/' }] }] };
  assert.ok(candidateTargets(layoutOnly, SITE).has(`${SITE}/only-in-layout/`));
});

test('resolveClick returns the destination for a legitimate slot, internal and external alike', () => {
  const issue = frozenIssue();
  const internal = `${SITE}/articles/ours/`;
  const external = 'https://www.theregister.com/a/?sponsored=1';
  assert.equal(resolveClick(issue, SITE, clickSlot(internal)), internal);
  assert.equal(resolveClick(issue, SITE, clickSlot(external)), external);
  assert.equal(resolveClick(issue, SITE, clickSlot(`${SITE}/feeds/articles/`)), `${SITE}/feeds/articles/`);
});

test('OPEN REDIRECT: a slot naming a url the issue does not contain resolves to NOTHING', () => {
  const issue = frozenIssue();
  // The attacker knows the hash function (it is in a public repo) and can compute the slot for any target
  // they like. That gains them nothing, because the route never hashes THEIR url, it hashes the issue's.
  assert.equal(resolveClick(issue, SITE, clickSlot('https://evil.example/phish')), null);
  assert.equal(resolveClick(issue, SITE, clickSlot('https://gbti.network.evil.example/')), null);
});

test('resolveClick rejects a malformed slot without scanning, and a tampered one after scanning', () => {
  const issue = frozenIssue();
  for (const bad of ['', 'zzzzzzzz', 'abc', 'a'.repeat(9), '../../etc', null, undefined]) {
    assert.equal(resolveClick(issue, SITE, bad), null, String(bad));
  }
  assert.equal(resolveClick(issue, SITE, 'deadbeef'), null, 'well-formed but not ours');
  // Case folding, so a mail client that upper-cases the path still works.
  const slot = clickSlot(`${SITE}/articles/ours/`);
  assert.equal(resolveClick(issue, SITE, slot.toUpperCase()), `${SITE}/articles/ours/`);
});

test('resolveClick on a MISSING issue is null, which callers must read as "site root"', () => {
  assert.equal(resolveClick(null, SITE, clickSlot(`${SITE}/articles/ours/`)), null);
  assert.equal(resolveClick({}, SITE, 'deadbeef'), null);
});

// ---- tagging ----

test('taggedTarget tags our own urls and leaves a publisher url untouched', () => {
  const u = new URL(taggedTarget(`${SITE}/articles/ours/`, { siteUrl: SITE, campaign: 'weekly-2026-08-24', placement: 'item' }));
  assert.equal(u.searchParams.get('utm_source'), 'digest');
  assert.equal(u.searchParams.get('utm_medium'), 'email');
  assert.equal(u.searchParams.get('utm_campaign'), 'weekly-2026-08-24');
  assert.equal(u.searchParams.get('utm_content'), 'item');
  const ext = 'https://www.theregister.com/a/?sponsored=1';
  assert.equal(taggedTarget(ext, { siteUrl: SITE, campaign: 'c', placement: 'item' }), ext,
    'stamping our campaign into a publisher analytics account tells us nothing and pollutes theirs');
});

// ---- the path ----

test('clickPath and parseClickPath round trip, and a non-click path parses to null', () => {
  const p = clickPath('weekly-2026-08-24', 'item', 'deadbeef');
  assert.equal(p, '/c/weekly-2026-08-24/item/deadbeef');
  assert.deepEqual(parseClickPath(p), { issueId: 'weekly-2026-08-24', placement: 'item', slot: 'deadbeef' });
  assert.deepEqual(parseClickPath(`${p}/`), { issueId: 'weekly-2026-08-24', placement: 'item', slot: 'deadbeef' });
  for (const bad of ['/c/', '/c/a/b', '/checkout', '/c/a/b/c/d', '', null]) {
    assert.equal(parseClickPath(bad), null, String(bad));
  }
  assert.equal(clickPath('', 'item', 'deadbeef'), '', 'no issue id, no link');
  assert.equal(clickPath('id', 'item', ''), '', 'no slot, no link');
});

// ---- the aggregate ----

test('applyClick folds counts by placement and slot and never records anything about the reader', () => {
  let r = applyClick(emptyClicks('i'), { placement: 'item', slot: 'aaaa1111', now: 100 });
  r = applyClick(r, { placement: 'item', slot: 'aaaa1111', now: 200 });
  r = applyClick(r, { placement: 'footer-home', slot: 'bbbb2222', now: 300 });
  assert.equal(r.total, 3);
  assert.equal(r.unresolved, 0);
  assert.deepEqual(r.byPlacement, { item: 2, 'footer-home': 1 });
  assert.deepEqual(r.bySlot, { aaaa1111: 2, bbbb2222: 1 });
  assert.equal(r.firstAt, 100);
  assert.equal(r.lastAt, 300);
  // The shape is the control: there is no field a recipient identity could be written into.
  assert.deepEqual(Object.keys(r).sort(),
    ['bySlot', 'byPlacement', 'firstAt', 'issueId', 'lastAt', 'total', 'unresolved'].sort());
});

test('applyClick counts an UNRESOLVED click rather than dropping it', () => {
  const r = applyClick(emptyClicks('i'), { placement: 'item', slot: 'deadbeef', resolved: false, now: 1 });
  assert.equal(r.total, 1);
  assert.equal(r.unresolved, 1, 'a run of these means a pruned issue or somebody probing, and both are worth seeing');
});

// ---- the route ----

test('ROUTE: a legitimate internal click 302s to the TAGGED destination and is counted', async () => {
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const slot = clickSlot(`${SITE}/articles/ours/`);
  const res = await handleMailClick(hit(`/c/${issue.issueId}/item/${slot}`), envFor(kv), { now: () => 555 });

  assert.equal(res.status, 302);
  const loc = new URL(res.headers.get('Location'));
  assert.equal(loc.origin + loc.pathname, `${SITE}/articles/ours/`);
  assert.equal(loc.searchParams.get('utm_campaign'), issue.issueId);
  assert.equal(loc.searchParams.get('utm_content'), 'item');

  const rec = JSON.parse(kv.store.get(clickKey(issue.issueId)));
  assert.equal(rec.total, 1);
  assert.equal(rec.unresolved, 0);
  assert.deepEqual(rec.byPlacement, { item: 1 });
  assert.equal(rec.issueId, issue.issueId);
});

test('ROUTE: a news click 302s to the publisher UNTAGGED and is counted the same way', async () => {
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const ext = 'https://www.theregister.com/a/?sponsored=1';
  const res = await handleMailClick(hit(`/c/${issue.issueId}/item/${clickSlot(ext)}`), envFor(kv), { now: () => 1 });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), ext);
  assert.equal(JSON.parse(kv.store.get(clickKey(issue.issueId))).total, 1);
});

test('ROUTE: THE OPEN REDIRECT ATTEMPT lands on the site root, and is counted as unresolved', async () => {
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const evil = clickSlot('https://evil.example/phish');
  const res = await handleMailClick(hit(`/c/${issue.issueId}/item/${evil}`), envFor(kv), { now: () => 1 });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), SITE, 'never the attacker url, and never anything derived from the request');
  const rec = JSON.parse(kv.store.get(clickKey(issue.issueId)));
  assert.equal(rec.unresolved, 1);
});

test('ROUTE: a missing issue, an unreadable store and a junk path all still redirect', async () => {
  const empty = fakeKv();
  const gone = await handleMailClick(hit('/c/weekly-1999-01-01/item/deadbeef'), envFor(empty), { now: () => 1 });
  assert.equal(gone.status, 302);
  assert.equal(gone.headers.get('Location'), SITE);
  assert.equal(JSON.parse(empty.store.get(clickKey('weekly-1999-01-01'))).unresolved, 1);

  const broken = { SIGNUP_KV: { get() { throw new Error('kv down'); }, put() { throw new Error('kv down'); } }, SITE_URL: SITE };
  const res = await handleMailClick(hit('/c/x/item/deadbeef'), broken, { now: () => 1 });
  assert.equal(res.status, 302, 'a reader clicked a link in an email; the counter being down is not their problem');
  assert.equal(res.headers.get('Location'), SITE);

  const junk = await handleMailClick(hit('/c/only-two/parts'), envFor(fakeKv()), { now: () => 1 });
  assert.equal(junk.status, 302);
  assert.equal(junk.headers.get('Location'), SITE);
});

test('ROUTE: the redirect is never cached and leaks no referrer', async () => {
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const res = await handleMailClick(hit(`/c/${issue.issueId}/item/${clickSlot(`${SITE}/articles/ours/`)}`), envFor(kv));
  // A cached redirect is counted once and followed many times, which destroys the number the route exists for.
  assert.match(res.headers.get('Cache-Control'), /no-store/);
  assert.equal(res.headers.get('Referrer-Policy'), 'no-referrer');
});

test('ROUTE: no KV binding at all still redirects, counting nothing', async () => {
  const res = await handleMailClick(hit('/c/i/item/deadbeef'), { SITE_URL: SITE });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), SITE);
});

// ---- the round trip, which is the test that actually protects this feature ----

test('ROUND TRIP: EVERY /c/ link the real renderer emits resolves through the real route', async () => {
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const { html } = renderIssue(issue, {
    siteUrl: SITE, clickBase: BASE, unsubscribeUrl: `${BASE}/mail/unsubscribe?h=a&t=b`,
  });

  const counted = hrefs(html).filter((h) => h.startsWith(`${BASE}/c/`));
  assert.ok(counted.length >= 6, `expected the digest to route its links through the counter, got ${counted.length}`);

  const seen = new Set();
  for (const href of counted) {
    const path = new URL(href).pathname;
    const parsed = parseClickPath(path);
    assert.ok(parsed, `unparseable counter link ${href}`);
    assert.equal(parsed.issueId, issue.issueId);
    const res = await handleMailClick(hit(path), envFor(kv), { now: () => 1 });
    assert.equal(res.status, 302, href);
    seen.add(parsed.placement);
    // THE ASSERTION THIS WHOLE FILE EXISTS FOR: not merely that it redirected, but that it redirected to a
    // REAL destination rather than falling back to the site root. A hashing mismatch between the two halves
    // presents as a 302 to the root, which is indistinguishable from success unless it is asserted against.
    assert.notEqual(res.headers.get('Location'), SITE,
      `${href} bounced to the site root, so the renderer and the route disagree about what they hashed`);
  }
  const rec = JSON.parse(kv.store.get(clickKey(issue.issueId)));
  assert.equal(rec.unresolved, 0, 'every rendered link resolved');
  assert.equal(rec.total, counted.length);
  assert.ok(seen.size >= 3, `expected several distinct placements, got ${[...seen].join(',')}`);
});

test('ROUND TRIP holds when SITE_URL carries a trailing slash on BOTH sides', async () => {
  const issue = frozenIssue();
  const env = { SIGNUP_KV: fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) }), SITE_URL: `${SITE}/`, PUBLIC_BASE_URL: BASE };
  // The composition root feeds the renderer the SAME resolveSiteUrl output the route will use, which is what
  // makes the slash harmless. Reproduce that wiring here rather than asserting the resolver in isolation.
  const { html } = renderIssue(issue, { siteUrl: resolveSiteUrl(env), clickBase: resolveClickBase(env) });
  const path = new URL(hrefs(html).find((h) => h.includes('/c/'))).pathname;
  const res = await handleMailClick(hit(path), env, { now: () => 1 });
  assert.equal(res.status, 302);
  assert.notEqual(res.headers.get('Location'), SITE);
});

test('WITHOUT a click base the renderer emits plain tagged links, so nothing depends on the counter', () => {
  const { html } = renderIssue(frozenIssue(), { siteUrl: SITE });
  const all = hrefs(html);
  assert.equal(all.filter((h) => h.includes('/c/')).length, 0);
  const ours = all.filter((h) => h.startsWith(`${SITE}/`));
  assert.ok(ours.length >= 5);
  for (const h of ours) assert.equal(new URL(h).searchParams.get('utm_source'), 'digest', h);
});

// ---- the production wiring, exercised as itself ----

test('WIRING: the Worker composition root is what routes a real digest link through the counter', async () => {
  // Deliberately NOT a hand-built ctx. Every other test in this file constructs { siteUrl, clickBase } itself,
  // and every one of them stays green when the production line stops passing clickBase, which was verified by
  // mutation. This test is the only thing standing between that deletion and a silently uncounted newsletter.
  const issue = frozenIssue();
  const kv = fakeKv({ [`mail:issue:${issue.issueId}`]: JSON.stringify(issue) });
  const env = { SIGNUP_KV: kv, SITE_URL: `${SITE}/`, PUBLIC_BASE_URL: `${BASE}/`, MAIL_FROM: 'digest@gbti.network' };

  const { renderIssue: wired } = mailDrainDeps(env);
  const { html } = wired(issue, { unsubscribeUrl: `${BASE}/mail/unsubscribe?h=a&t=b` });

  const counted = hrefs(html).filter((h) => h.startsWith(`${BASE}/c/`));
  assert.ok(counted.length >= 6, `the composition root did not route links through the counter (got ${counted.length})`);

  for (const href of counted) {
    const res = await handleMailClick(hit(new URL(href).pathname), env, { now: () => 1 });
    assert.equal(res.status, 302, href);
    assert.notEqual(res.headers.get('Location'), SITE, `${href} bounced to the root, so the wired base disagrees with the route`);
  }
  assert.equal(JSON.parse(kv.store.get(clickKey(issue.issueId))).unresolved, 0);
});

test('WIRING: a caller-supplied ctx still wins, so a future per-recipient override is not silently ignored', () => {
  const deps = mailDrainDeps({ SITE_URL: SITE, PUBLIC_BASE_URL: BASE });
  const { html } = deps.renderIssue(frozenIssue(), { clickBase: '' });
  assert.equal(hrefs(html).filter((h) => h.includes('/c/')).length, 0);
});
