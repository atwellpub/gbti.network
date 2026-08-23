// sow-268: the product Gallery field is a `kind: 'json'` field. The editor rendered an array value
// comma-joined, and gather()'s coerceValue('json') then JSON.parse'd that string and threw, so every product
// with screenshots was unsaveable and Preview (whose gather() sat outside a try) was a dead button. The fix
// intercepts gallery with structured rows backed by a hidden json input, exactly as links[] already is.
//
// These tests protect two things: the row parse/serialize contract (galleryRowsFromValue /
// galleryValueFromRows), and the actual defect (the old comma-join shape throws; the interception shape
// round-trips through the REAL gatherInput). Mutation check: revert galleryValueFromRows to always wrap in
// { src, caption } and the byte-identical assertion goes red; revert the interception (feed the comma-join to
// gatherInput) and the round-trip assertion goes red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { galleryRowsFromValue, galleryValueFromRows } from '../client-ui/src/gallery.mjs';
import { gatherInput } from '../client-ui/src/form.mjs';

// Ryker's actual committed gallery (bare path strings), the shape all ten existing products use.
const RYKER = [
  './images/ryker-shot-1.webp',
  './images/ryker-shot-2.webp',
  './images/ryker-shot-3.webp',
  './images/ryker-shot-4.webp',
  './images/ryker-shot-5.webp',
];

test('galleryRowsFromValue: reads an array of bare strings into rows', () => {
  const rows = galleryRowsFromValue(RYKER);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { src: './images/ryker-shot-1.webp', caption: '' });
});

test('galleryRowsFromValue: reads captioned objects and mixed shapes', () => {
  const rows = galleryRowsFromValue(['a.webp', { src: 'b.webp', caption: 'The settings panel' }]);
  assert.deepEqual(rows, [
    { src: 'a.webp', caption: '' },
    { src: 'b.webp', caption: 'The settings panel' },
  ]);
});

test('galleryRowsFromValue: reads a JSON string (the hidden-input shape) and tolerates junk', () => {
  assert.equal(galleryRowsFromValue(JSON.stringify(RYKER)).length, 5);
  assert.deepEqual(galleryRowsFromValue('not json'), []);
  assert.deepEqual(galleryRowsFromValue(undefined), []);
  assert.deepEqual(galleryRowsFromValue(null), []);
});

test('galleryValueFromRows: an uncaptioned gallery round-trips byte-for-byte (no {src,caption} churn)', () => {
  const value = galleryValueFromRows(galleryRowsFromValue(RYKER));
  assert.deepEqual(value, RYKER); // still bare strings, identical order, so existing frontmatter does not churn
});

test('galleryValueFromRows: emits a bare string with no caption and an object with one', () => {
  const value = galleryValueFromRows([
    { src: 'a.webp', caption: '' },
    { src: 'b.webp', caption: 'Panel' },
    { src: '  ', caption: 'no src' }, // dropped: an empty row is not a screenshot
    { src: 'c.webp', caption: '   ' }, // whitespace caption is no caption -> bare string
  ]);
  assert.deepEqual(value, ['a.webp', { src: 'b.webp', caption: 'Panel' }, 'c.webp']);
});

test('the OLD comma-join shape throws in the real gatherInput (the reported bug)', () => {
  const fields = [{ key: 'gallery', kind: 'json' }];
  const commaJoined = RYKER.join(', '); // exactly what the generic json textarea rendered
  assert.throws(() => gatherInput(fields, () => commaJoined), /field "gallery":/);
});

test('the interception shape (hidden json input) round-trips through the real gatherInput', () => {
  const fields = [{ key: 'gallery', kind: 'json' }];
  // _serializeGallery writes JSON.stringify(galleryValueFromRows(rows)) into the hidden input.
  const hiddenValue = JSON.stringify(galleryValueFromRows(galleryRowsFromValue(RYKER)));
  const input = gatherInput(fields, () => hiddenValue);
  assert.deepEqual(input.gallery, RYKER);
});
