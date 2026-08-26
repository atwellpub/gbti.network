// Image-gen model registry + the "a prompt result image is image-gen only" gate (schema + form descriptor).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promptImageFraming } from '../src/lib/prompt-page.mjs';

import { isImageGenModel, isImageGenTarget, IMAGE_GEN_MODELS } from '../client/src/image-models.mjs';
import { schemaFor } from '../client/src/schemas.mjs';
import { FIELDS, fieldsFor } from '../client/src/form-fields.mjs';

test('isImageGenModel matches known generators regardless of spacing/punctuation/version', () => {
  for (const m of ['Nano Banana', 'nano-banana', 'MidJourney', 'Midjourney v6', 'DALL-E 3', 'DALL·E', 'dalle', 'Stable Diffusion XL', 'Flux.1', 'Imagen 3', 'Ideogram']) {
    assert.equal(isImageGenModel(m), true, `${m} should be an image generator`);
  }
});

test('isImageGenModel rejects text models and junk', () => {
  for (const m of ['Claude', 'Claude Code', 'GPT-4o', 'Gemini', 'ChatGPT', '', null, undefined, 'banana bread']) {
    assert.equal(isImageGenModel(m), false, `${m} should not be an image generator`);
  }
});

test('isImageGenTarget is true when ANY target is a generator', () => {
  assert.equal(isImageGenTarget(['Claude', 'Nano Banana']), true);
  assert.equal(isImageGenTarget(['Claude', 'GPT-4o']), false);
  assert.equal(isImageGenTarget([]), false);
  assert.equal(isImageGenTarget(undefined), false);
});

test('every canonical display name is recognized by the matcher (self-consistency)', () => {
  for (const m of IMAGE_GEN_MODELS) assert.equal(isImageGenModel(m), true, `${m} listed but not matched`);
});

// The image was once reserved for image-gen targets, in the schema, the content validator and the form.
// A prompt written for Claude Code could therefore not carry a screenshot at all, and because gather()
// skips hidden fields the editor never even submitted one. The gate is gone; these assert it stays gone.
test('promptSchema accepts a lead image whatever the targets are', () => {
  const schema = schemaFor('prompt');
  const base = { title: 'T', slug: 'a-slug', shortDescription: 'sd', author: 'naresh', image: 'members/naresh/images/x.webp' };
  assert.equal(schema.safeParse({ ...base, targets: ['Claude Code'] }).success, true);
  assert.equal(schema.safeParse({ ...base, targets: [] }).success, true);
  assert.equal(schema.safeParse({ ...base, targets: ['Nano Banana'] }).success, true);
  // No image => still valid, as it always was.
  assert.equal(schema.safeParse({ title: 'T', slug: 'a-slug', shortDescription: 'sd', author: 'naresh', targets: ['Claude'] }).success, true);
});

test('the prompt form offers the image field unconditionally', () => {
  const img = FIELDS.prompt.find((f) => f.key === 'image');
  assert.ok(img, 'prompt form should offer an image field');
  assert.equal(img.kind, 'image');
  // No showIf: a hidden field is not submitted by gather(), so gating it here silently discarded the image
  // rather than reporting it. Assert the absence, since that is the whole behaviour change.
  assert.equal(img.showIf, undefined);
  // form-fields mirrors the schema (drift guard already enforces keys; assert the parity copy too).
  assert.ok(fieldsFor('prompt').some((f) => f.key === 'image'));
});

test('isImageGenTarget survives as a presentation signal, not a gate', () => {
  // It now decides only how prompt-page.mjs frames a lead image, and both hosts read that one answer.
  assert.deepEqual(promptImageFraming({ title: 'Grok', targets: ['Claude Code'] }),
    { isResult: false, alt: 'Grok', caption: '' });
  assert.deepEqual(promptImageFraming({ title: 'Art', targets: ['Nano Banana'] }),
    { isResult: true, alt: 'Art: example result generated with Nano Banana', caption: 'Example result \u00b7 Nano Banana' });
  // A prompt with no targets at all still gets a usable alt and no caption.
  assert.deepEqual(promptImageFraming({ title: 'Bare' }), { isResult: false, alt: 'Bare', caption: '' });
});
