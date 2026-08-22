import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveNotify, SYSTEM_NOTIFY_DEFAULT, NOTIFY_CHANNELS } from '../membership/notify-resolve.mjs';

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
