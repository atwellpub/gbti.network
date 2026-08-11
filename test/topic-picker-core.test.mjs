// SOW-054 Phase 3/5: the pure followed-topics picker helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicsFromJson, toggleTopic, selectedTopics, filterTopics, groupTopics, selectAllTopics, seedDefaultTopics, DEFAULT_TOPICS } from '../client-ui/src/topic-picker-core.mjs';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { topicVocabKeys } from '../membership/topics-vocab.mjs';

test('topicsFromJson: clean list; drops malformed; label falls back to key', () => {
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }] }),
    [{ key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }]);
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'x' }, { label: 'no key' }, null, 7] }), [{ key: 'x', label: 'x' }]);
  assert.deepEqual(topicsFromJson(null), []);
  // SOW-080: an optional group is carried through
  assert.deepEqual(topicsFromJson({ topics: [{ key: 'ai', label: 'AI', group: 'Tech' }] }), [{ key: 'ai', label: 'AI', group: 'Tech' }]);
  assert.deepEqual(topicsFromJson({}), []);
});

test('toggleTopic: adds if absent, removes if present, returns a NEW array, de-dupes, order-stable', () => {
  assert.deepEqual(toggleTopic([], 'ai'), ['ai']);
  assert.deepEqual(toggleTopic(['ai'], 'devops'), ['ai', 'devops']);
  assert.deepEqual(toggleTopic(['ai', 'devops'], 'ai'), ['devops']); // remove
  assert.deepEqual(toggleTopic(['ai', 'ai'], 'devops'), ['ai', 'devops']); // de-dupe existing
  assert.deepEqual(toggleTopic(['ai'], ''), ['ai']); // falsy key -> no-op (deduped passthrough)
  // does not mutate the input
  const src = ['ai'];
  toggleTopic(src, 'devops');
  assert.deepEqual(src, ['ai']);
});

test('selectedTopics: normalizes a stored prefs.categories into a clean key set', () => {
  assert.deepEqual(selectedTopics(['ai', 'devops', 'ai', 7, '']), ['ai', 'devops']);
  assert.deepEqual(selectedTopics(null), []);
  assert.deepEqual(selectedTopics('ai'), []); // non-array -> []
});

// SOW-080: the larger-vocabulary picker affordances.
const LIST = [{ key: 'ai', label: 'AI' }, { key: 'home-network', label: 'Home Network' }, { key: 'cooking', label: 'Cooking' }];

test('filterTopics: case-insensitive label/key substring; blank query returns all', () => {
  assert.deepEqual(filterTopics(LIST, ''), LIST);
  assert.deepEqual(filterTopics(LIST, '  '), LIST);
  assert.deepEqual(filterTopics(LIST, 'net').map((t) => t.key), ['home-network']); // matches the label "Home Network"
  assert.deepEqual(filterTopics(LIST, 'COOK').map((t) => t.key), ['cooking']);
  assert.deepEqual(filterTopics(LIST, 'home-net').map((t) => t.key), ['home-network']); // matches the key
  assert.deepEqual(filterTopics(LIST, 'zzz'), []);
  assert.deepEqual(filterTopics(null, 'x'), []);
});

test('groupTopics: first-seen group order, ungrouped bucket last; a flat list -> one ungrouped bucket', () => {
  const grouped = groupTopics([
    { key: 'ai', label: 'AI', group: 'Tech' },
    { key: 'cooking', label: 'Cooking' }, // ungrouped
    { key: 'devops', label: 'DevOps', group: 'Tech' },
    { key: 'finance', label: 'Finance', group: 'Business' },
  ]);
  assert.deepEqual(grouped.map((g) => g.group), ['Tech', 'Business', '']); // ungrouped trails
  assert.deepEqual(grouped[0].topics.map((t) => t.key), ['ai', 'devops']);
  // a fully flat list -> a single ungrouped bucket (backward-compatible)
  assert.deepEqual(groupTopics(LIST), [{ group: '', topics: LIST }]);
});

test('selectAllTopics: merges the pool after the current selection, de-duped, capped', () => {
  const pool = [{ key: 'ai' }, { key: 'devops' }, { key: 'gaming' }];
  assert.deepEqual(selectAllTopics([], pool), ['ai', 'devops', 'gaming']);
  // the current selection keeps priority under the cap
  assert.deepEqual(selectAllTopics(['gaming'], pool, 2), ['gaming', 'ai']);
  // de-dupes against the current selection; junk pool entries drop
  assert.deepEqual(selectAllTopics(['ai'], [{ key: 'ai' }, { key: '' }, null, { key: 'css' }]), ['ai', 'css']);
  // composes with a filtered pool (the picker passes filterTopics output)
  const filtered = filterTopics([{ key: 'ai', label: 'AI' }, { key: 'aws', label: 'AWS' }, { key: 'css', label: 'CSS' }], 'a');
  assert.deepEqual(selectAllTopics([], filtered), ['ai', 'aws']);
});

// --- sow-207 QA: the onboarding default topic group ------------------------------------------------------

const VOCAB = [
  { key: 'ai', label: 'AI' }, { key: 'devops', label: 'DevOps' }, { key: 'entertainment', label: 'Entertainment' },
  { key: 'gaming', label: 'Gaming' }, { key: 'music', label: 'Music' }, { key: 'rust', label: 'Rust' },
];

test('seedDefaultTopics fills an EMPTY selection with the owner default group', () => {
  assert.deepEqual(seedDefaultTopics([], VOCAB).sort(), ['ai', 'devops', 'entertainment', 'gaming', 'music']);
  assert.deepEqual(seedDefaultTopics(null, VOCAB).sort(), ['ai', 'devops', 'entertainment', 'gaming', 'music']);
});

test('seedDefaultTopics NEVER overwrites an existing selection', () => {
  // The whole safety of seeding is that it can only fill a void. A member who picked one topic keeps exactly
  // that one; the defaults are not merged in on top of a deliberate choice.
  assert.deepEqual(seedDefaultTopics(['rust'], VOCAB), ['rust']);
  assert.deepEqual(seedDefaultTopics(['gaming'], VOCAB), ['gaming']);
});

test('a default key absent from the vocabulary is DROPPED, never persisted', () => {
  // house/topics.yml and DEFAULT_TOPICS are separate files. A rename or removal there must not write a dead
  // key into a member's prefs, where it would match no chip and bias nothing.
  assert.deepEqual(seedDefaultTopics([], [{ key: 'ai' }, { key: 'rust' }]), ['ai']);
  assert.deepEqual(seedDefaultTopics([], []), [], 'no vocabulary loaded -> seed nothing');
  assert.deepEqual(seedDefaultTopics([], null), []);
});

test('every DEFAULT_TOPICS key really exists in house/topics.yml', () => {
  // The guard that makes the drop-behaviour above a safety net rather than the normal path. `entertainment`
  // is the reason this test exists: it was a content-taxonomy primary and gaming's PARENT, yet the flat follow
  // vocabulary never carried it, so the owner's default group could not be expressed until it was added.
  const keys = new Set(topicVocabKeys(yaml.load(fs.readFileSync('house/topics.yml', 'utf8'))));
  for (const k of DEFAULT_TOPICS) {
    assert.ok(keys.has(k), `DEFAULT_TOPICS key "${k}" is not in house/topics.yml`);
  }
});
