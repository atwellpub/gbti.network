// sow-190: the tracking-parameter normalizer (client/src/url-normalize.mjs). Pure, node-testable. Verifies the
// denylist strips only UNAMBIGUOUS trackers, PRESERVES functional/ambiguous params (a blanket strip would break
// the 9 committed YouTube ?v= shares), that embedUrl still matches every normalized form (no share loses its
// SOW-092 player), and that running the normalizer over every committed share url changes NOTHING (the denylist
// is safe on the real corpus). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { stripTrackingParams } from '../client/src/url-normalize.mjs';
import { embedUrl } from '../client/src/video-embed.mjs';

test('sow-190: strips the reported YouTube ?si= attribution token', () => {
  assert.equal(stripTrackingParams('https://youtu.be/c5uI80Nevhk?si=DRaS_MVa_-5tu4xA'), 'https://youtu.be/c5uI80Nevhk');
});

test('sow-190: strips utm_* and the common click ids, keeps the rest', () => {
  assert.equal(stripTrackingParams('https://ex.com/a?utm_source=x&utm_medium=y&id=7'), 'https://ex.com/a?id=7');
  assert.equal(stripTrackingParams('https://ex.com/a?fbclid=abc'), 'https://ex.com/a');
  assert.equal(stripTrackingParams('https://ex.com/a?gclid=abc&q=hi'), 'https://ex.com/a?q=hi');
  assert.equal(stripTrackingParams('https://ex.com/a?igshid=z&mc_cid=1&mc_eid=2&ab_channel=Foo'), 'https://ex.com/a');
});

test('sow-190: PRESERVES functional YouTube params (v, t, list, start_radio)', () => {
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=c5uI80Nevhk'), 'https://www.youtube.com/watch?v=c5uI80Nevhk');
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=abcdefghijk&t=42'), 'https://www.youtube.com/watch?v=abcdefghijk&t=42');
  // the one existing playlist share shape survives intact
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=abcdefghijk&list=PL123&start_radio=1'), 'https://www.youtube.com/watch?v=abcdefghijk&list=PL123&start_radio=1');
});

test('sow-190: a mix keeps functional and drops only the tracker', () => {
  assert.equal(stripTrackingParams('https://youtu.be/abcdefghijk?si=TOKEN&t=90'), 'https://youtu.be/abcdefghijk?t=90');
});

test('sow-190: leaves ambiguous short params UNTOUCHED (owner aggressiveness call is deferred)', () => {
  // s (X), ref, feature, pp, is, spm, share_id are NOT in the phase-1 denylist.
  assert.equal(stripTrackingParams('https://x.com/u/status/1?s=20'), 'https://x.com/u/status/1?s=20');
  assert.equal(stripTrackingParams('https://ex.com/a?ref=hn&feature=share'), 'https://ex.com/a?ref=hn&feature=share');
  // The owner's pasted string had `?is=` (a typo for YouTube's `si=`). Only `si` is in the denylist, so the
  // literal `is` param is an UNKNOWN token and is correctly left alone by the conservative rule.
  assert.equal(stripTrackingParams('https://youtu.be/c5uI80Nevhk?is=DRaS_MVa_-5tu4xA'), 'https://youtu.be/c5uI80Nevhk?is=DRaS_MVa_-5tu4xA');
});

test('sow-190: fails OPEN on a non-URL / non-http(s) input (never blocks a share)', () => {
  assert.equal(stripTrackingParams('not a url'), 'not a url');
  assert.equal(stripTrackingParams(''), '');
  assert.equal(stripTrackingParams(null), '');
  assert.equal(stripTrackingParams('mailto:x@y.com?utm_source=z'), 'mailto:x@y.com?utm_source=z'); // not http(s)
});

test('sow-190: a clean url is returned byte-for-byte (no gratuitous re-encoding)', () => {
  const clean = 'https://example.com/path/to/thing?keep=1&also=two';
  assert.equal(stripTrackingParams(clean), clean);
});

test('sow-190: embedUrl still matches every normalized YouTube form (no share loses its player)', () => {
  const cases = [
    'https://youtu.be/c5uI80Nevhk?si=DRaS_MVa_-5tu4xA',
    'https://www.youtube.com/watch?v=c5uI80Nevhk&ab_channel=Foo',
    'https://www.youtube.com/watch?v=c5uI80Nevhk&list=PL1&start_radio=1',
  ];
  for (const raw of cases) {
    const before = embedUrl(raw);
    assert.ok(before, `expected embedUrl to match the raw form: ${raw}`);
    assert.equal(embedUrl(stripTrackingParams(raw)), before, `embedUrl must still match after normalize: ${raw}`);
  }
});

test('sow-190: the normalizer changes NONE of the committed share urls (denylist safe on the real corpus)', () => {
  const membersRoot = new URL('../members/', import.meta.url);
  const users = fs.existsSync(membersRoot) ? fs.readdirSync(membersRoot, { withFileTypes: true }) : [];
  let checked = 0;
  for (const u of users) {
    if (!u.isDirectory()) continue;
    const sharesDir = new URL(`../members/${u.name}/shares/`, import.meta.url);
    if (!fs.existsSync(sharesDir)) continue;
    for (const f of fs.readdirSync(sharesDir)) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(new URL(`../members/${u.name}/shares/${f}`, import.meta.url), 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      let fm;
      try { fm = yaml.load(m[1]); } catch { continue; }
      const url = fm && typeof fm.url === 'string' ? fm.url : null;
      if (!url) continue;
      checked++;
      assert.equal(stripTrackingParams(url), url, `phase-1 denylist must not alter a committed share url: ${url}`);
    }
  }
  assert.ok(checked > 0, 'expected to check at least one committed share url');
});
