import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotify, SYSTEM_NOTIFY_DEFAULT, NOTIFY_CHANNELS, normalizeNotify, NOTIFY_EVENTS } from '../membership/notify-resolve.mjs';

test('empty input resolves to the system default: api on, email OFF (fail closed)', () => {
  assert.deepEqual(resolveNotify(), { api: true, email: false });
  assert.deepEqual(resolveNotify({}), { api: true, email: false });
  // The load-bearing invariant: with no preference expressed, email must be off, never on.
  assert.equal(SYSTEM_NOTIFY_DEFAULT.email, false);
  assert.equal(SYSTEM_NOTIFY_DEFAULT.api, true);
});

test('a global default turns a channel on without touching the other', () => {
  assert.deepEqual(resolveNotify({ global: { email: true } }), { api: true, email: true });
  assert.deepEqual(resolveNotify({ global: { api: false } }), { api: false, email: false });
});

test('a per-follow override beats the global default, in both directions', () => {
  // Follow suppresses email the global enabled.
  assert.deepEqual(
    resolveNotify({ follow: { email: false }, global: { email: true } }),
    { api: true, email: false },
  );
  // Follow enables email the global left off.
  assert.deepEqual(
    resolveNotify({ follow: { email: true }, global: { email: false } }),
    { api: true, email: true },
  );
});

test('resolution is PER CHANNEL: a partial override never blanks the channel it omits', () => {
  // Follow speaks only to email; api must fall through to the global (false), not to the follow bag.
  assert.deepEqual(
    resolveNotify({ follow: { email: true }, global: { api: false } }),
    { api: false, email: true },
  );
  // Follow speaks only to api; email falls through global (true) then would-be system (false): global wins.
  assert.deepEqual(
    resolveNotify({ follow: { api: false }, global: { email: true } }),
    { api: false, email: true },
  );
});

test('event-keyed preferences resolve per event; a `default` entry backs the unlisted events', () => {
  const global = { 'author-publish': { email: true }, default: { email: false } };
  assert.deepEqual(resolveNotify({ event: 'author-publish', global }), { api: true, email: true });
  assert.deepEqual(resolveNotify({ event: 'mention', global }), { api: true, email: false });
});

test('a flat bag applies to every event (OQ4-safe: author-follow today, more later)', () => {
  const global = { email: true };
  assert.deepEqual(resolveNotify({ event: 'author-publish', global }), { api: true, email: true });
  assert.deepEqual(resolveNotify({ event: 'reply', global }), { api: true, email: true });
});

test('non-boolean / malformed channel values are ignored and fall through, never coerced', () => {
  // Strings, numbers, null, objects are not booleans: they must not be read as truthy email-on.
  for (const junk of ['true', 1, 0, null, {}, [], 'yes']) {
    assert.deepEqual(
      resolveNotify({ follow: { email: junk }, global: { email: junk } }),
      { api: true, email: false },
      `email must stay off for junk value ${JSON.stringify(junk)}`,
    );
  }
});

test('a non-object preference is treated as absent (fail closed to system default)', () => {
  for (const junk of [null, undefined, 42, 'x', true]) {
    assert.deepEqual(resolveNotify({ follow: junk, global: junk }), { api: true, email: false });
  }
});

test('the helper is pure: identical inputs give identical output and no timing/model dependence', () => {
  // There is deliberately no fan-out "mode" parameter; the same call is correct whether invoked at write
  // time or at read time. Repeated calls prove determinism (no hidden state, no clock, no randomness).
  const input = { event: 'author-publish', follow: { email: true }, global: { api: false } };
  const a = resolveNotify(input);
  const b = resolveNotify(input);
  assert.deepEqual(a, b);
  assert.deepEqual(a, { api: false, email: true });
});

test('every resolved result is a strict two-channel boolean bag', () => {
  const r = resolveNotify({ follow: { api: true }, global: { email: true } });
  assert.deepEqual(Object.keys(r).sort(), [...NOTIFY_CHANNELS].sort());
  for (const c of NOTIFY_CHANNELS) assert.equal(typeof r[c], 'boolean');
});

// --- normalizeNotify (SOW-186 phase 1): the canonical stored shape for the per-follow / global matrix ---

test('normalizeNotify keeps a well-formed event-keyed matrix and only boolean channels', () => {
  const out = normalizeNotify({
    article: { api: true, email: false },
    prompt: { email: true },
    product: { api: false, email: true },
  });
  assert.deepEqual(out, {
    article: { api: true, email: false },
    prompt: { email: true },
    product: { api: false, email: true },
  });
});

test('normalizeNotify carries an UNKNOWN type key ("skill") with no migration, per Q25', () => {
  // "skill" is not a content type today; the store is generic over the key so it just works when it ships.
  const out = normalizeNotify({ skill: { email: true }, article: { api: true } });
  assert.deepEqual(out, { skill: { email: true }, article: { api: true } });
});

test('normalizeNotify drops garbage: non-boolean channels, non-object bags, malformed keys, empties', () => {
  assert.equal(normalizeNotify(undefined), undefined);
  assert.equal(normalizeNotify(null), undefined);
  assert.equal(normalizeNotify('x'), undefined);
  assert.equal(normalizeNotify([]), undefined, 'an array is not an event-keyed object');
  assert.equal(normalizeNotify({}), undefined, 'nothing valid -> undefined so it falls through');
  // A key with no valid boolean channel contributes nothing, and the whole thing collapses to undefined.
  assert.equal(normalizeNotify({ article: { api: 'true', email: 1 } }), undefined);
  // A bad key is dropped but a good sibling survives.
  assert.deepEqual(normalizeNotify({ 'BAD KEY!': { email: true }, share: { email: true } }), { share: { email: true } });
  // A non-object bag value is dropped.
  assert.deepEqual(normalizeNotify({ article: true, share: { api: true } }), { share: { api: true } });
});

test('normalizeNotify lowercases and trims the event key', () => {
  assert.deepEqual(normalizeNotify({ '  Article  ': { api: false } }), { article: { api: false } });
});

test('normalizeNotify output feeds resolveNotify end to end: a per-follow email:true for one type only', () => {
  const follow = normalizeNotify({ article: { email: true } }); // email an article, nothing else
  assert.deepEqual(resolveNotify({ event: 'article', follow }), { api: true, email: true });
  // A different type falls through to the system default (email OFF), because the follow spoke only to article.
  assert.deepEqual(resolveNotify({ event: 'product', follow }), { api: true, email: false });
});

test('NOTIFY_EVENTS is the four real content-type kinds the matrix seeds today', () => {
  assert.deepEqual([...NOTIFY_EVENTS], ['article', 'prompt', 'product', 'share']);
  assert.ok(!NOTIFY_EVENTS.includes('skill'), 'skill is carried generically, not seeded as a real type');
});
