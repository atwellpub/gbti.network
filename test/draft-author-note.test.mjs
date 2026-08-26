// SOW-014 + the editable preview note: the from-the-author note travels WITH the draft.
//
// Before this, `authorNote` existed only as a publish-time argument. applyDraftPut whitelists the fields it
// keeps, so a note typed in the editor was dropped the moment the draft was saved, and publishDraft published
// with no note at all -- which then fails content validation for a product or prompt.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { normalizeDrafts, applyDraftPut, listDraftRecords } from '../membership/member-drafts.mjs';

const at = () => '2026-01-01T00:00:00Z';
const draft = (over = {}) => ({
  type: 'prompt', slug: 'my-prompt', path: 'members/a/prompts/my-prompt/index.md',
  frontmatter: { title: 'X' }, body: 'hello', ...over,
});

test('applyDraftPut: the draft record round-trips authorNote', () => {
  const s = applyDraftPut(normalizeDrafts(null), draft({ authorNote: 'Why I built it.' }), { now: at });
  assert.equal(listDraftRecords(s)[0].authorNote, 'Why I built it.');
});

test('applyDraftPut: an ABSENT authorNote preserves the stored one, so an unaware caller cannot destroy it', () => {
  let s = applyDraftPut(normalizeDrafts(null), draft({ authorNote: 'Kept.' }), { now: at });
  // A save that says nothing about the note (an older bundle, or any caller that does not know the field).
  s = applyDraftPut(s, draft({ body: 'edited body' }), { now: at });
  const rec = listDraftRecords(s)[0];
  assert.equal(rec.body, 'edited body', 'the body still updates');
  assert.equal(rec.authorNote, 'Kept.', 'the note survives a save that omitted it');
});

test('applyDraftPut: clearing the note is explicit (an empty string), not accidental', () => {
  let s = applyDraftPut(normalizeDrafts(null), draft({ authorNote: 'Temporary.' }), { now: at });
  s = applyDraftPut(s, draft({ authorNote: '' }), { now: at });
  assert.equal(listDraftRecords(s)[0].authorNote, '', 'an empty string clears it');
});

test('applyDraftPut: a draft that never had a note carries none (no phantom empty note)', () => {
  const s = applyDraftPut(normalizeDrafts(null), draft(), { now: at });
  const rec = listDraftRecords(s)[0];
  assert.ok(!('authorNote' in rec) || rec.authorNote == null, 'no note key, or an explicitly empty one');
});
