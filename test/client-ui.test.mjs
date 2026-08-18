// SOW-006 v2: pure logic of the shared web-components UI (the GbtiClient http adapter + form coercion +
// inline-edit merge). The custom elements themselves need a browser DOM and are verified there; this covers
// everything testable in node so the contract + the money-adjacent publish payload are pinned.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHttpClient } from '../client-ui/src/client.mjs';
import { coerceValue, gatherInput } from '../client-ui/src/form.mjs';
import { readHooks, canEditInPlace, toPublishPayload } from '../client-ui/src/inline.mjs';
import { codeBlockPlan } from '../client-ui/src/elements/gbti-locked-content.mjs';

// ---- GbtiClient http adapter ----

function fakeFetch(record) {
  return async (url, init) => {
    record.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: true, json: async () => ({ ok: true, url }) };
  };
}

test('http client: maps methods to the existing /api routes with the bearer token', async () => {
  const calls = [];
  const c = createHttpClient({ baseUrl: 'http://localhost:4500', token: 'tok', fetch: fakeFetch(calls) });
  await c.status();
  await c.listContent({ type: 'post' });
  await c.getContentItem({ path: 'members/alice/posts/x/index.md' });
  await c.publish({ type: 'post', input: { title: 'T' }, body: 'b' });
  await c.prStatus({ number: 7 });
  await c.admin('ban', { githubId: '9' });

  assert.equal(calls[0].url, 'http://localhost:4500/api/status');
  assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  assert.equal(calls[1].url, 'http://localhost:4500/api/content?type=post');
  assert.equal(calls[2].url, 'http://localhost:4500/api/content/item?path=members%2Falice%2Fposts%2Fx%2Findex.md');
  assert.equal(calls[3].method, 'POST');
  assert.deepEqual(calls[3].body, { type: 'post', input: { title: 'T' }, body: 'b' });
  assert.equal(calls[4].url, 'http://localhost:4500/api/pr-status?number=7');
  assert.deepEqual(calls[5].body, { action: 'ban', githubId: '9' });
});

test('http client: throws a coded error on a non-ok response', async () => {
  const c = createHttpClient({
    token: 'tok',
    fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: 'forbidden', message: 'nope' }) }),
  });
  await assert.rejects(c.status(), (e) => e.code === 'forbidden' && /nope/.test(e.message));
});

// ---- form coercion ----

test('coerceValue: per-kind typing, empty omitted via undefined', () => {
  assert.equal(coerceValue('text', '  hi '), 'hi');
  assert.equal(coerceValue('text', '   '), undefined);
  assert.equal(coerceValue('number', '42'), 42);
  assert.equal(coerceValue('number', 'x'), undefined);
  assert.equal(coerceValue('boolean', true), true);
  assert.deepEqual(coerceValue('array', 'a, b ,c,'), ['a', 'b', 'c']);
  assert.deepEqual(coerceValue('json', '{"contributions":0.05}'), { contributions: 0.05 });
  assert.equal(coerceValue('json', '  '), undefined);
  assert.throws(() => coerceValue('json', '{bad'), /JSON|token|Unexpected/i);
});

test('gatherInput: builds input, omits empties, keeps booleans, surfaces a bad-json field', () => {
  const fields = [
    { key: 'title', kind: 'text' },
    { key: 'tags', kind: 'array' },
    { key: 'featured', kind: 'boolean' },
    { key: 'empty', kind: 'text' },
    { key: 'links', kind: 'json' },
  ];
  const raw = { title: 'Hello', tags: 'a,b', featured: false, empty: '', links: '{"type":"homepage"}' };
  const input = gatherInput(fields, (k) => raw[k]);
  assert.deepEqual(input, { title: 'Hello', tags: ['a', 'b'], featured: false, links: { type: 'homepage' } });

  assert.throws(() => gatherInput([{ key: 'd', kind: 'json' }], () => '{bad'), /field "d"/);
});

// ---- inline editing ----

test('readHooks: parses valid hooks, rejects a non-editable page', () => {
  assert.deepEqual(
    readHooks({ gbtiPath: 'members/alice/posts/x/index.md', gbtiType: 'post', gbtiSlug: 'x', gbtiOwner: 'alice' }),
    { path: 'members/alice/posts/x/index.md', type: 'post', slug: 'x', owner: 'alice' },
  );
  assert.equal(readHooks({ gbtiType: 'post' }), null); // no path
  assert.equal(readHooks({ gbtiPath: 'x', gbtiType: 'page' }), null); // bad type
  assert.equal(readHooks({}), null);
});

test('canEditInPlace: only the folder owner may edit in place', () => {
  const hooks = readHooks({ gbtiPath: 'members/alice/posts/x/index.md', gbtiType: 'post' });
  assert.equal(canEditInPlace(hooks, { username: 'alice' }), true);
  assert.equal(canEditInPlace(hooks, { username: 'Alice' }), true); // case-insensitive
  assert.equal(canEditInPlace(hooks, { username: 'bob' }), false);
  assert.equal(canEditInPlace(hooks, null), false);
});

test('toPublishPayload: merges edits into the FULL frontmatter (other metadata preserved)', () => {
  const item = {
    type: 'post',
    frontmatter: { type: 'post', title: 'Old', slug: 'x', tags: ['a'], visibility: 'public', author: 'alice' },
    body: 'old body',
  };
  const out = toPublishPayload(item, { title: 'New Title', body: 'new body' });
  assert.equal(out.type, 'post');
  assert.equal(out.input.title, 'New Title');
  assert.deepEqual(out.input.tags, ['a']); // untouched metadata carried through
  assert.equal(out.input.author, 'alice');
  assert.equal(out.body, 'new body');

  // body-only edit keeps the old title
  const out2 = toPublishPayload(item, { body: 'just body' });
  assert.equal(out2.input.title, 'Old');
  assert.equal(out2.body, 'just body');

  assert.throws(() => toPublishPayload(null, {}), /no item/);
});

// ---- <gbti-locked-content> code-block presentation (sow-016 + the walled-prompt copy gap) ----
// The DOM wiring needs a browser and is verified there; this pins the DECISION, and specifically that a
// Copy button is offered on EVERY decrypted block. Without it a member who paid for a gated prompt could
// read the file and had no way to take it, because the page's own Copy button is suppressed on a stub.

test('codeBlockPlan: every decrypted code block offers Copy, short ones included', () => {
  assert.equal(codeBlockPlan(1).copy, true);
  assert.equal(codeBlockPlan(8).copy, true);
  assert.equal(codeBlockPlan(400).copy, true);
});

test('codeBlockPlan: only a block longer than the clip threshold is clipped, and it names its line count', () => {
  assert.equal(codeBlockPlan(9).clip, false, 'exactly threshold+1 stays inline');
  assert.equal(codeBlockPlan(9).moreLabel, null);
  assert.equal(codeBlockPlan(10).clip, true, 'threshold+2 clips');
  assert.equal(codeBlockPlan(10).moreLabel, 'Show more (10 lines)');
  assert.equal(codeBlockPlan(10).lessLabel, 'Show less');
});

test('codeBlockPlan: a missing or junk line count degrades to an unclipped, still-copyable block', () => {
  for (const bad of [undefined, null, NaN, 'lots']) {
    assert.equal(codeBlockPlan(bad).clip, false, `${String(bad)} must not clip`);
    assert.equal(codeBlockPlan(bad).copy, true, `${String(bad)} must still be copyable`);
  }
});
