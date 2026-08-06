// SOW-184: unit tests for the pure WorkBench editor rail helpers (design handoff 3a). No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtDate, editorStatus, hasValue, mediaSummary } from '../client-ui/src/editor-core.mjs';

test('fmtDate: date-ish values collapse to YYYY-MM-DD', () => {
  assert.equal(fmtDate('2026-08-04'), '2026-08-04');
  assert.equal(fmtDate('2026-08-04T17:30:00Z'), '2026-08-04');
});

test('fmtDate: empty or unparseable -> empty string', () => {
  assert.equal(fmtDate(''), '');
  assert.equal(fmtDate(null), '');
  assert.equal(fmtDate(undefined), '');
  assert.equal(fmtDate('not-a-date'), '');
});

test('editorStatus: a published item is Live with its published date', () => {
  assert.deepEqual(
    editorStatus({ status: 'published', publishedAt: '2026-08-04' }),
    { label: 'Live', tone: 'live', publishedLabel: '2026-08-04' },
  );
  // published but without a date still reads Live, just with no date label
  assert.deepEqual(
    editorStatus({ status: 'published', publishedAt: '' }),
    { label: 'Live', tone: 'live', publishedLabel: '' },
  );
});

test('editorStatus: a draft is Draft with no published date', () => {
  assert.deepEqual(editorStatus({ status: 'draft' }), { label: 'Draft', tone: 'draft', publishedLabel: '' });
  assert.deepEqual(editorStatus({}), { label: 'Draft', tone: 'draft', publishedLabel: '' });
});

test('editorStatus: staged wins over a published status (the fork IS the draft)', () => {
  // a fork-staged draft carries status: published by design; the card must read Staged draft, not Live
  assert.deepEqual(
    editorStatus({ staged: true, status: 'published', publishedAt: '2026-08-04' }),
    { label: 'Staged draft', tone: 'staged', publishedLabel: '' },
  );
});

test('hasValue: strings, arrays, and empties', () => {
  assert.equal(hasValue('./images/cover.webp'), true);
  assert.equal(hasValue(['a']), true);
  assert.equal(hasValue(''), false);
  assert.equal(hasValue('   '), false);
  assert.equal(hasValue([]), false);
  assert.equal(hasValue(null), false);
  assert.equal(hasValue(undefined), false);
});

test('mediaSummary: post counts its one cover', () => {
  assert.equal(mediaSummary('post', { coverImage: './images/cover.webp' }), '1 cover');
  assert.equal(mediaSummary('post', {}), '');
  assert.equal(mediaSummary('post', { coverImage: '' }), '');
});

test('mediaSummary: product counts icon + featuredImage + banner', () => {
  assert.equal(mediaSummary('product', { icon: 'a.png', featuredImage: 'b.png', banner: 'c.png' }), '3 images');
  assert.equal(mediaSummary('product', { icon: 'a.png' }), '1 image');
  assert.equal(mediaSummary('product', {}), '');
});

test('mediaSummary: prompt counts its one image; unknown type -> empty', () => {
  assert.equal(mediaSummary('prompt', { image: 'p.png' }), '1 image');
  assert.equal(mediaSummary('prompt', {}), '');
  assert.equal(mediaSummary('profile', { avatar: 'x.png' }), '');
  assert.equal(mediaSummary('share', {}), '');
});
