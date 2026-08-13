// A YAML-dated post could not be saved from the WorkBench: "invalid post: publishedAt: Invalid input".
//
// Root cause: `fieldHtml` in gbti-content-editor.mjs rendered a field value with
//   typeof value === 'object' ? JSON.stringify(value) : String(value)
// and a Date IS an object, so an unquoted `publishedAt: 2025-06-23` (which js-yaml parses to a Date) rendered
// into the input as `"2025-06-23T00:00:00.000Z"` INCLUDING the quote characters. Reading that back through
// new Date() gives Invalid Date, and z.coerce.date() rejects it. publishedAt is a preserved HIDDEN field, so
// the author could neither see the bad value nor edit it, and every save of that item failed.
//
// 46 published posts carry an unquoted YAML date. The two that do not are the ones written by the editor
// itself, which quotes them, which is why this was invisible on anything authored after the migration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { z } from 'zod';
import { schemaFor } from '../client/src/schemas.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// The exact expression under test, mirrored from the component. The DRIFT test below pins them together.
const renderValue = (value) => (
  value == null ? ''
    : Array.isArray(value) ? value.join(', ')
    : value instanceof Date ? (Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10))
    : typeof value === 'object' ? JSON.stringify(value)
    : String(value)
);

test('a YAML Date renders as a plain ISO date, not as a quoted JSON string', () => {
  const v = renderValue(new Date('2025-06-23T00:00:00.000Z'));
  assert.equal(v, '2025-06-23');
  assert.ok(!v.includes('"'), 'quote characters in the value are what made it unparseable');
});

test('the rendered value survives the round trip the save path actually performs', () => {
  const v = renderValue(new Date('2025-06-23T00:00:00.000Z'));
  assert.ok(!Number.isNaN(new Date(v).getTime()), 'new Date() must not return Invalid Date');
  assert.equal(z.coerce.date().safeParse(v).success, true);
});

// The regression, stated as the defect rather than as its fix: this is what used to happen.
test('the old JSON.stringify path produced a value that fails the schema', () => {
  const old = JSON.stringify(new Date('2025-06-23T00:00:00.000Z'));
  assert.equal(old, '"2025-06-23T00:00:00.000Z"');
  assert.equal(Number.isNaN(new Date(old).getTime()), true);
  assert.equal(z.coerce.date().safeParse(old).success, false);
});

test('an invalid Date renders empty rather than "Invalid Date", which would also fail the schema', () => {
  assert.equal(renderValue(new Date('nonsense')), '');
  // An empty value is dropped by coerceValue/gatherInput, so an absent optional field is the safe outcome.
  assert.equal(z.coerce.date().optional().safeParse(undefined).success, true);
});

test('non-Date values are unaffected: strings, arrays, plain objects, null', () => {
  assert.equal(renderValue('2025-06-23'), '2025-06-23');
  assert.equal(renderValue(['a', 'b']), 'a, b');
  assert.equal(renderValue({ a: 1 }), '{"a":1}');
  assert.equal(renderValue(null), '');
  assert.equal(renderValue(undefined), '');
});

// THE FIXTURE IS INLINE, AND THAT IS THE POINT. This test used to read a LIVE content file
// (members/atwellpub/posts/every-tree-is-a-pipe-dream/index.md) and assert its publishedAt was an unquoted
// YAML Date. Then that post was edited through the WorkBench, the repaired save path wrote the date back
// QUOTED as '2025-06-23', js-yaml loaded it as a string, and the assertion failed on main.
//
// So the guard for this fix was broken by the fix working, which is about as self-defeating as a test gets.
// A fixture that other people's ordinary content edits can rewrite is not a fixture. The blob below is that
// post's frontmatter as it stood, minus the churn, and nothing outside this file can change it.
const YAML_DATED_POST = `
title: 'Every Tree is a Pipe Dream: Helping Ideas to Grow'
slug: every-tree-is-a-pipe-dream
status: published
visibility: public
publicStub: false
excerpt: A post whose publishedAt is an UNQUOTED YAML date, which js-yaml loads as a Date object.
categories:
  - entertainment
layout: journal
coverImage: ./images/every-tree-is-a-pipe-dream-1.webp
featured: false
publishedAt: 2025-06-23
updatedAt: 2026-08-13T02:01:21.668Z
redirectFrom:
  - /entertainment/every-tree-is-a-pipe-dream/
type: post
author: atwellpub
`;

// The end-to-end case, driven through the REAL schema the save path uses rather than a stand-in.
test('a post frontmatter with a YAML date validates once rendered through the field', () => {
  const fm = yaml.load(YAML_DATED_POST);
  assert.ok(fm.publishedAt instanceof Date, 'the fixture must actually carry a YAML Date, or this proves nothing');

  const schema = schemaFor('post');
  const asRendered = { ...fm, publishedAt: renderValue(fm.publishedAt), updatedAt: renderValue(fm.updatedAt) };
  assert.equal(schema.safeParse(asRendered).success, true);

  // And the same fixture through the old expression fails, so the fixture is a genuine reproduction.
  const asOld = { ...fm, publishedAt: JSON.stringify(fm.publishedAt) };
  const bad = schema.safeParse(asOld);
  assert.equal(bad.success, false);
  assert.ok(bad.error.issues.some((i) => i.path.join('.') === 'publishedAt'));
});

// The real-world half, kept because the class of content is still very much live (47 posts carried an
// unquoted date when this was written). Rewritten to sweep EVERY such post rather than to name one, so it
// covers far more than the original did and CANNOT defeat itself: as posts are re-saved through the editor
// the set shrinks, and when it finally reaches zero this passes trivially rather than failing. An empty
// sweep means the migration finished, not that a regression appeared.
test('every post still carrying an unquoted YAML date renders through the field into a valid value', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dirs = [];
  for (const base of ['members', 'house']) {
    const abs = path.join(root, base);
    if (!fs.existsSync(abs)) continue;
    for (const owner of fs.readdirSync(abs)) {
      const posts = path.join(abs, owner, 'posts');
      if (!fs.existsSync(posts)) continue;
      for (const slug of fs.readdirSync(posts)) dirs.push(path.join(posts, slug, 'index.md'));
    }
  }

  const schema = schemaFor('post');
  let swept = 0;
  for (const file of dirs) {
    if (!fs.existsSync(file)) continue;
    let fm;
    try { fm = yaml.load(fs.readFileSync(file, 'utf8').split('---')[1]); } catch { continue; }
    if (!(fm?.publishedAt instanceof Date)) continue; // already quoted, or no date: not this test's subject
    swept += 1;
    const asRendered = { ...fm, publishedAt: renderValue(fm.publishedAt), updatedAt: renderValue(fm.updatedAt) };
    assert.equal(schema.safeParse(asRendered).success, true, `${file} does not survive the save path`);
  }
  assert.ok(swept >= 0, `swept ${swept} posts carrying an unquoted YAML date`);
});

// DRIFT: the expression above is a copy. If the component's own changes, this test would keep passing while the
// editor broke again, which is the whole failure mode being fixed.
test('DRIFT: the component still handles Date before the generic object branch', () => {
  const s = src('client-ui/src/elements/gbti-content-editor.mjs');
  const i = s.indexOf('value instanceof Date');
  const j = s.indexOf("typeof value === 'object' ? JSON.stringify(value)");
  assert.ok(i > -1, 'fieldHtml no longer special-cases Date, so a YAML date will JSON.stringify again');
  assert.ok(j > -1 && i < j, 'the Date branch must come BEFORE the object branch or it is unreachable');
  assert.match(s, /value\.toISOString\(\)\.slice\(0, 10\)/);
});
