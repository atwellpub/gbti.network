// sow-259: the pure word-of-the-day rotation core (client-ui/src/word-of-the-day.mjs). The load-bearing assertion
// is the ROTATION one: a test that only proves "a word comes back" would pass against a function that always
// returns the first entry, which is the whole feature failing silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enabledWords, pickWord, BUNDLED_WORDS } from '../client-ui/src/word-of-the-day.mjs';

const DAY = 24 * 60 * 60 * 1000;
const pool = [
  { word: 'alpha', partOfSpeech: 'noun', definition: 'The first.', enabled: true },
  { word: 'beta', partOfSpeech: 'noun', definition: 'The second.', enabled: true },
  { word: 'gamma', partOfSpeech: 'noun', definition: 'The third.', enabled: true },
];

test('enabledWords keeps well-formed enabled entries and trims them', () => {
  const out = enabledWords([
    { word: '  spaced  ', partOfSpeech: ' noun ', definition: '  A definition.  ', enabled: true },
    { word: 'retired', definition: 'Gone.', enabled: false },
    { word: '', definition: 'No word.' },
    { word: 'nodef', definition: '   ' },
    null,
  ]);
  assert.deepEqual(out, [{ word: 'spaced', partOfSpeech: 'noun', definition: 'A definition.' }]);
});

test('enabledWords treats a missing enabled flag as enabled, and a missing partOfSpeech as empty', () => {
  const out = enabledWords([{ word: 'terse', definition: 'Brief.' }]);
  assert.deepEqual(out, [{ word: 'terse', partOfSpeech: '', definition: 'Brief.' }]);
});

test('enabledWords is total over junk input', () => {
  assert.deepEqual(enabledWords(null), []);
  assert.deepEqual(enabledWords('nope'), []);
  assert.deepEqual(enabledWords([]), []);
});

test('pickWord ROTATES: the same word all day, a different one the next day', () => {
  const t = 1755600000000; // an arbitrary fixed instant, so the test never depends on the clock
  const today = pickWord(pool, t);
  assert.equal(pickWord(pool, t + 1000).word, today.word, 'a second later is the same day');
  assert.equal(pickWord(pool, t + 6 * 60 * 60 * 1000).word, today.word, 'six hours later is the same day');
  assert.notEqual(pickWord(pool, t + DAY).word, today.word, 'the next day advances');
  assert.notEqual(pickWord(pool, t + 2 * DAY).word, pickWord(pool, t + DAY).word, 'and again the day after');
});

test('pickWord walks the whole pool and wraps at its length', () => {
  const t = 1755600000000;
  const seen = [0, 1, 2].map((i) => pickWord(pool, t + i * DAY).word);
  assert.equal(new Set(seen).size, 3, 'every entry is reachable');
  assert.equal(pickWord(pool, t + 3 * DAY).word, seen[0], 'and it wraps');
});

test('pickWord is deterministic across callers: the build and the browser cannot disagree', () => {
  const t = 1755600000000;
  assert.equal(pickWord(pool, t).word, pickWord([...pool], t).word);
});

test('pickWord ignores disabled entries entirely', () => {
  const half = [pool[0], { ...pool[1], enabled: false }, pool[2]];
  const words = [0, 1, 2, 3].map((i) => pickWord(half, 1755600000000 + i * DAY).word);
  assert.ok(!words.includes('beta'), 'a disabled word never appears');
});

test('pickWord returns null on an empty or fully disabled pool, so the card renders nothing', () => {
  assert.equal(pickWord([], Date.now()), null);
  assert.equal(pickWord(pool.map((w) => ({ ...w, enabled: false })), Date.now()), null);
  assert.equal(pickWord(null, Date.now()), null);
});

test('pickWord handles a negative bucket without throwing or indexing out of range', () => {
  const picked = pickWord(pool, -5 * DAY);
  assert.ok(picked && pool.some((w) => w.word === picked.word));
});

test('the bundled fallback set is usable on its own', () => {
  assert.ok(BUNDLED_WORDS.length > 0);
  assert.equal(enabledWords(BUNDLED_WORDS).length, BUNDLED_WORDS.length, 'every bundled entry is well formed');
  assert.ok(pickWord(BUNDLED_WORDS, Date.now()));
});
