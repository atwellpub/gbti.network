// sow-259: the pure word-of-the-day edit core (membership/word-edits.mjs). Mirrors quote-edits.test: add/enable/
// remove over a parsed { words: [...] }, returning { next, changed, audit }, idempotent + validating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWord, setWordEnabled, removeWord, WordEditError, MAX_WORD, MAX_PART_OF_SPEECH, MAX_DEFINITION } from '../membership/word-edits.mjs';

const ctx = { actor: { githubId: '7', login: 'gbtilabs' }, now: '2026-08-19T00:00:00.000Z' };
const base = () => ({ words: [{ word: 'laconic', partOfSpeech: 'adjective', definition: 'Using very few words.', enabled: true }] });

test('addWord appends, defaults enabled, and audits', () => {
  const r = addWord(base(), { word: 'salient', partOfSpeech: 'adjective', definition: 'Most noticeable.' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.words.length, 2);
  assert.deepEqual(r.next.words[1], { word: 'salient', partOfSpeech: 'adjective', definition: 'Most noticeable.', enabled: true });
  assert.equal(r.audit.action, 'word.add');
  assert.deepEqual(r.audit.target, { word: 'salient' });
  assert.equal(r.audit.actor.github_id, '7');
  assert.equal(r.audit.at, '2026-08-19T00:00:00.000Z');
});

test('addWord is idempotent on the same word, case-insensitively', () => {
  const r = addWord(base(), { word: '  LACONIC  ', definition: 'Something else.' }, ctx);
  assert.equal(r.changed, false);
  assert.equal(r.next.words.length, 1);
  assert.equal(r.next.words[0].definition, 'Using very few words.', 'the existing entry is untouched');
  assert.equal(r.audit.detail.noop, true);
});

test('addWord accepts an entry with NO part of speech, since a word and a meaning is usable', () => {
  const r = addWord({ words: [] }, { word: 'terse', definition: 'Brief and to the point.' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.words[0].partOfSpeech, '');
});

test('addWord requires a word and a definition', () => {
  assert.throws(() => addWord({ words: [] }, { definition: 'No word.' }, ctx), WordEditError);
  assert.throws(() => addWord({ words: [] }, { word: 'lonely' }, ctx), WordEditError);
  assert.throws(() => addWord({ words: [] }, { word: '   ', definition: 'Blank.' }, ctx), WordEditError);
});

test('addWord truncates at exactly the caps the endpoint validator rejects on', () => {
  const r = addWord({ words: [] }, {
    word: 'w'.repeat(MAX_WORD + 40),
    partOfSpeech: 'p'.repeat(MAX_PART_OF_SPEECH + 40),
    definition: 'd'.repeat(MAX_DEFINITION + 40),
  }, ctx);
  assert.equal(r.next.words[0].word.length, MAX_WORD);
  assert.equal(r.next.words[0].partOfSpeech.length, MAX_PART_OF_SPEECH);
  assert.equal(r.next.words[0].definition.length, MAX_DEFINITION);
});

test('setWordEnabled toggles, is idempotent, and matches case-insensitively', () => {
  const off = setWordEnabled(base(), { word: 'LACONIC', enabled: false }, ctx);
  assert.equal(off.changed, true);
  assert.equal(off.next.words[0].enabled, false);
  const again = setWordEnabled(off.next, { word: 'laconic', enabled: false }, ctx);
  assert.equal(again.changed, false);
  assert.equal(again.audit.detail.noop, true);
});

test('setWordEnabled throws on a word that is not in the pool', () => {
  assert.throws(() => setWordEnabled(base(), { word: 'absent', enabled: false }, ctx), WordEditError);
});

test('removeWord drops the entry and audits the stored spelling', () => {
  const r = removeWord(base(), { word: 'LACONIC' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.words.length, 0);
  assert.deepEqual(r.audit.target, { word: 'laconic' }, 'the audit records what was stored, not what was typed');
});

test('removeWord throws on a word that is not in the pool', () => {
  assert.throws(() => removeWord(base(), { word: 'absent' }, ctx), WordEditError);
});

test('every edit leaves the INPUT document untouched', () => {
  const doc = base();
  addWord(doc, { word: 'new', definition: 'A definition.' }, ctx);
  setWordEnabled(doc, { word: 'laconic', enabled: false }, ctx);
  removeWord(doc, { word: 'laconic' }, ctx);
  assert.deepEqual(doc, base(), 'the core clones rather than mutating its caller');
});

test('a document with no words array is tolerated', () => {
  const r = addWord({}, { word: 'first', definition: 'The first entry.' }, ctx);
  assert.equal(r.next.words.length, 1);
});
