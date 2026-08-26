// The digest open counter: the pure rules, the /o/ route (fake KV, no network), and the render pixel. Mirrors
// the shape of mail-click.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenPath, isIssueIdShape, openKey, emptyOpens, applyOpen, OPEN_PREFIX } from '../membership/mail-open.mjs';
import { handleMailOpen } from '../workers/signup/mail-open-route.mjs';
import { renderIssue } from '../membership/mail-render.mjs';

function makeKV() {
  const m = new Map();
  return {
    m,
    async get(key, type) {
      const e = m.get(key);
      if (e == null) return null;
      if (type === 'json') { try { return JSON.parse(e); } catch { return null; } }
      return e;
    },
    async put(key, value) { m.set(key, String(value)); },
  };
}
const openReq = (id) => new Request(`https://signup.gbti.network/o/${id}`, { method: 'GET' });

// ---------- pure ----------

test('parseOpenPath reads a single-segment issue id and rejects other shapes', () => {
  assert.deepEqual(parseOpenPath('/o/weekly-2026-08-25'), { issueId: 'weekly-2026-08-25' });
  assert.deepEqual(parseOpenPath('/o/weekly-2026-08-25/'), { issueId: 'weekly-2026-08-25' });
  assert.equal(parseOpenPath('/o/'), null);
  assert.equal(parseOpenPath('/o/a/b'), null);
  assert.equal(parseOpenPath('/c/x/y/z'), null);
});

test('isIssueIdShape accepts the three issue-id kinds and rejects junk', () => {
  for (const ok of ['weekly-2026-08-25', 'welcome-2026-01-04', 'test-2026-12-31']) assert.equal(isIssueIdShape(ok), true, ok);
  for (const bad of ['', 'garbage', 'weekly', 'weekly-2026-8-5', '../../secret', 'mail:opens:x', 'weekly-2026-08-25-extra']) {
    assert.equal(isIssueIdShape(bad), false, bad);
  }
});

test('applyOpen increments total, stamps firstAt once, moves lastAt', () => {
  let r = applyOpen(emptyOpens('weekly-2026-08-25'), { now: () => 100 });
  assert.equal(r.total, 1);
  assert.equal(r.firstAt, 100);
  assert.equal(r.lastAt, 100);
  r = applyOpen(r, { now: () => 250 });
  assert.equal(r.total, 2);
  assert.equal(r.firstAt, 100, 'firstAt is stamped once');
  assert.equal(r.lastAt, 250);
});

// ---------- the /o/ route ----------

test('open route: a valid issue id counts one open and returns a gif', async () => {
  const kv = makeKV();
  const res = await handleMailOpen(openReq('weekly-2026-08-25'), { SIGNUP_KV: kv }, { now: () => 5 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/gif');
  assert.equal(res.headers.get('cache-control'), 'no-store, no-cache, must-revalidate');
  const body = new Uint8Array(await res.arrayBuffer());
  assert.ok(body.length > 0, 'the pixel has bytes');
  const rec = JSON.parse(kv.m.get(openKey('weekly-2026-08-25')));
  assert.equal(rec.total, 1);
  assert.equal(rec.issueId, 'weekly-2026-08-25');
});

test('open route: a second hit increments to 2', async () => {
  const kv = makeKV();
  await handleMailOpen(openReq('weekly-2026-08-25'), { SIGNUP_KV: kv });
  await handleMailOpen(openReq('weekly-2026-08-25'), { SIGNUP_KV: kv });
  assert.equal(JSON.parse(kv.m.get(openKey('weekly-2026-08-25'))).total, 2);
});

test('open route: a malformed issue id returns the pixel but writes no key', async () => {
  const kv = makeKV();
  const res = await handleMailOpen(openReq('garbage'), { SIGNUP_KV: kv });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/gif');
  assert.equal([...kv.m.keys()].filter((k) => k.startsWith(OPEN_PREFIX)).length, 0, 'no junk key from a bad id');
});

test('open route: no KV still returns the pixel (never throws)', async () => {
  const res = await handleMailOpen(openReq('weekly-2026-08-25'), {});
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/gif');
});

// ---------- the render pixel ----------

function issueFixture() {
  return {
    issueId: 'weekly-2026-08-25',
    layout: [{ key: 'article', label: 'Articles', empty: false, items: [{ title: 'X', url: '/blog/x/' }] }],
  };
}

test('renderIssue embeds the open pixel in HTML when clickBase + issueId are present', () => {
  const { html, text } = renderIssue(issueFixture(), { clickBase: 'https://signup.gbti.network' });
  assert.ok(html.includes('src="https://signup.gbti.network/o/weekly-2026-08-25"'), 'the pixel points at /o/<issueId>');
  assert.ok(/<img[^>]+\/o\/weekly-2026-08-25/.test(html), 'the pixel is an img tag');
  assert.ok(!text.includes('/o/'), 'the text alternative carries no pixel');
});

test('renderIssue embeds NO open pixel for a bare fixture (no clickBase): the archive stays bare', () => {
  const { html } = renderIssue(issueFixture(), {});
  assert.ok(!html.includes('/o/'), 'no pixel without a click/open base');
});
