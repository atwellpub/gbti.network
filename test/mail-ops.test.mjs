// The shared operational-email layout (membership/mail-ops.mjs). Pure: plain objects in, one html string out, no
// IO and no clock, so every case here is an exact-value test.
//
// Three things these tests exist to hold still, because each one is a defect the crude `<pre>` markup they replace
// actually had: EVERY interpolated value is escaped (an ops notice carries a github login, a coupon code and raw
// command output), the renderer never throws on a thin or malformed spec (an unattended script would deliver
// nothing at all), and the table alignment defaults to label-then-numbers so a caller does not have to spell out
// the obvious shape on every report.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { opsEmail } from '../membership/mail-ops.mjs';

// A value a hostile input would look like: an element that must not survive as markup, plus the ampersand, the
// double quote and the apostrophe that break out of an attribute.
const NASTY = `<script>alert("x" & 'y')</script>`;

function assertEscaped(html) {
  assert.ok(!html.includes('<script>'), 'a raw script tag reached the output');
  assert.ok(!html.includes('alert("x"'), 'a raw double quote reached the output');
  assert.ok(html.includes('&lt;script&gt;'), 'the angle brackets were not escaped');
  assert.ok(html.includes('&amp;'), 'the ampersand was not escaped');
  assert.ok(html.includes('&quot;'), 'the double quote was not escaped');
  assert.ok(html.includes('&#39;'), 'the apostrophe was not escaped');
}

test('opsEmail returns an html document with the title, lead and footer', () => {
  const { html } = opsEmail({
    title: 'KV usage this week',
    lead: 'Numbers below, details in the ops folder.',
    sections: [],
    footer: 'Sent by the scheduled usage job.',
  });
  assert.ok(html.startsWith('<!doctype html>'), 'not a full document');
  assert.ok(html.includes('<title>KV usage this week</title>'));
  assert.ok(html.includes('KV usage this week'));
  assert.ok(html.includes('Numbers below, details in the ops folder.'));
  assert.ok(html.includes('Sent by the scheduled usage job.'));
  // The layout idiom the inboxes need: presentation tables, all styles inline, never a stylesheet.
  assert.ok(html.includes('role="presentation"'));
  assert.ok(!html.includes('<style'), 'a style block would be stripped by Gmail');
  assert.ok(!html.includes('class="'), 'a class would be dropped by several clients');
  // An explicit light ground on the body, so a dark-mode client cannot leave dark ink on a dark page.
  assert.ok(/<body style="[^"]*background-color:#/.test(html));
  // The brand touch, used once.
  assert.ok(html.includes('#1f9e5f'));
  assert.ok(html.includes('max-width:640px'));
});

test('the fields kind renders every label and value', () => {
  const { html } = opsEmail({
    title: 'Coupon redeemed',
    sections: [{ kind: 'fields', rows: [['Member', 'atwellpub'], ['Code', 'FREEYEAR26'], ['Tier', 'Creator']] }],
  });
  for (const v of ['Member', 'atwellpub', 'Code', 'FREEYEAR26', 'Tier', 'Creator']) {
    assert.ok(html.includes(v), `missing ${v}`);
  }
  // The label column is the muted, right-aligned one.
  assert.ok(html.includes('align="right" valign="top" width="34%"'));
});

test('the table kind renders a real table with a header row', () => {
  const { html } = opsEmail({
    title: 'Digest sends',
    sections: [{
      kind: 'table',
      columns: ['Issue', 'Sent', 'Opens'],
      rows: [['weekly-2026-08-17', '412', '188'], ['weekly-2026-08-24', '419', '203']],
    }],
  });
  assert.ok(html.includes('>ISSUE<') || html.includes('>Issue<'), 'the header cell is missing');
  assert.ok(html.includes('weekly-2026-08-17'));
  assert.ok(html.includes('weekly-2026-08-24'));
  assert.ok(html.includes('412') && html.includes('203'));
  // Auto layout sizes each column to its content. Fixed was tried first and measured badly: it split the width
  // by rule, so an eight-column report starved every numeric column to 51px. The wrap rule still rides on the
  // cells, which is what keeps a long value from pushing the table past the card.
  assert.ok(html.includes('table-layout:auto'));
  assert.ok(html.includes('word-break:break-word'), 'long values must still be able to wrap inside their cell');
});

test('the paragraph, note, alert and pre kinds each render their text', () => {
  const { html } = opsEmail({
    title: 'Mixed',
    sections: [
      { kind: 'paragraph', text: 'A plain sentence of body copy.' },
      { kind: 'note', text: 'A caveat that should read quietly.' },
      { kind: 'alert', text: 'Two days exceeded the write ceiling.' },
      { kind: 'pre', text: 'line one\n  line two indented' },
    ],
  });
  assert.ok(html.includes('A plain sentence of body copy.'));
  assert.ok(html.includes('A caveat that should read quietly.'));
  assert.ok(html.includes('Two days exceeded the write ceiling.'));
  assert.ok(html.includes('line one\n  line two indented'), 'the pre block lost its whitespace');
  assert.ok(html.includes('white-space:pre-wrap'), 'the pre block does not preserve whitespace');
  // The alert is a band, not just coloured text, so it survives a client that drops backgrounds.
  assert.ok(html.includes('border-left:4px solid'));
});

test('every interpolated value is escaped: title, lead, footer, fields, cells and text blocks', () => {
  for (const spec of [
    { title: NASTY },
    { title: 'ok', lead: NASTY },
    { title: 'ok', footer: NASTY },
    { title: 'ok', sections: [{ kind: 'fields', rows: [[NASTY, NASTY]] }] },
    { title: 'ok', sections: [{ kind: 'table', columns: [NASTY], rows: [[NASTY]] }] },
    { title: 'ok', sections: [{ kind: 'paragraph', text: NASTY }] },
    { title: 'ok', sections: [{ kind: 'note', text: NASTY }] },
    { title: 'ok', sections: [{ kind: 'alert', text: NASTY }] },
    { title: 'ok', sections: [{ kind: 'pre', text: NASTY }] },
  ]) {
    assertEscaped(opsEmail(spec).html);
  }
});

test('table alignment defaults to left for the first column and right for the rest', () => {
  const { html } = opsEmail({
    title: 'Defaults',
    sections: [{ kind: 'table', columns: ['Issue', 'Sent', 'Opens'], rows: [['a', '1', '2']] }],
  });
  // Two cells per row after the first, header row and body row alike: four right-aligned cells in total.
  assert.equal(html.match(/align="right"/g).length, 4);
  assert.equal(html.match(/align="left"/g).length, 2);
});

test('an explicit align overrides the default, per column', () => {
  const all = opsEmail({
    title: 'Explicit',
    sections: [{
      kind: 'table',
      columns: ['Issue', 'Sent', 'Opens'],
      rows: [['a', '1', '2']],
      align: ['left', 'left', 'left'],
    }],
  }).html;
  assert.ok(!all.includes('align="right"'), 'an explicit left column still rendered right-aligned');
  assert.equal(all.match(/align="left"/g).length, 6);

  const centred = opsEmail({
    title: 'Explicit',
    sections: [{ kind: 'table', columns: ['A', 'B'], rows: [['x', 'y']], align: ['center', 'center'] }],
  }).html;
  // Five, not four: the two header cells and the two body cells, plus the shell's own centering cell, which is
  // what holds the card in the middle of a wide window and is unrelated to column alignment.
  assert.equal(centred.match(/align="center"/g).length, 5);
});

test('a number in a report table is never broken across lines', () => {
  // THE DEFECT THIS PINS, found by measuring the rendered table rather than by reading it. The eight-column
  // stats report is the widest thing this layout carries, and under the previous fixed-width split each numeric
  // column got 51px at the card's own width: `350.0%` broke across two lines and `Suppressed` broke one
  // character per line. A percentage cut into pieces is not a number, and the whole point of a column is that a
  // reader can compare down it.
  const { html } = opsEmail({
    title: 'Digest performance',
    sections: [{
      kind: 'table',
      columns: ['Issue', 'Sent', 'Opens', 'Open %', 'Clicks', 'Click %', 'Failed', 'Suppressed'],
      rows: [['2026-08-24', '2', '0', '0.0%', '7', '350.0%', '0', '0']],
    }],
  });
  // Every short value in a right-aligned column is held on one line.
  for (const v of ['350.0%', '0.0%', 'Suppressed']) {
    const cell = new RegExp(`<td[^>]*white-space:nowrap[^>]*>${v.replace('%', '%')}</td>`);
    assert.match(html, cell, `${v} is allowed to break across lines`);
  }
  // The date in the left-hand column is held on one line too. Alignment is NOT the condition: in a five-column
  // report the numeric columns hold their width, so the label column is the only one that can give, and this
  // date stacked one part per line into a 206px row until length became the only rule.
  assert.match(html, /<td align="left"[^>]*white-space:nowrap[^>]*>2026-08-24<\/td>/);
});

test('a LONG value in a numeric column still wraps, so it cannot push the table past the card', () => {
  // The nowrap rule above is only safe because it is conditional. A long unbreakable token held on one line is
  // exactly the overflow the fixed layout was there to prevent, so the guard must not apply to one.
  const { html } = opsEmail({
    title: 'Weights',
    sections: [{ kind: 'table', columns: ['Credential', 'Detail'], rows: [['a', 'a-single-token-far-too-long-for-one-cell']] }],
  });
  assert.match(html, /<td align="right"[^>]*word-break:break-word[^>]*>a-single-token-far-too-long-for-one-cell<\/td>/,
    'a long value must keep the wrap rule in any column');
  // And in the left column too, which is where the genuinely long values actually turn up.
  const left = opsEmail({ title: 'x', sections: [{ kind: 'table', columns: ['Credential', 'Days'],
    rows: [['CF_ANALYTICS_TOKEN_WITH_A_VERY_LONG_NAME', '12']] }] }).html;
  assert.match(left, /<td align="left"[^>]*word-break:break-word[^>]*>CF_ANALYTICS_TOKEN_WITH_A_VERY_LONG_NAME<\/td>/);
  assert.doesNotMatch(html, /white-space:nowrap[^>]*>a-single-token-far-too-long/);
});

test('a short or malformed align array falls back to the default for the columns it does not name', () => {
  const { html } = opsEmail({
    title: 'Partial',
    sections: [{
      kind: 'table',
      columns: ['Issue', 'Sent', 'Opens'],
      // Only the second column is named, and it is named with a value that is not a keyword, so BOTH the
      // unnamed third column and the malformed second fall back: left, right, right.
      rows: [['a', '1', '2']],
      align: [undefined, 'sideways'],
    }],
  });
  assert.equal(html.match(/align="left"/g).length, 2);
  assert.equal(html.match(/align="right"/g).length, 4);
});

test('a thin or malformed spec renders rather than throwing', () => {
  // An empty sections array, the documented minimum.
  const empty = opsEmail({ title: 'Nothing to report', sections: [] });
  assert.ok(empty.html.includes('Nothing to report'));
  assert.ok(empty.html.startsWith('<!doctype html>'));

  // No argument at all, no sections key, a non-array sections, and null entries inside it.
  for (const spec of [undefined, {}, { title: 'x' }, { title: 'x', sections: null }, { title: 'x', sections: 'nope' },
    { title: 'x', sections: [null, undefined, 42, 'string'] }]) {
    const out = opsEmail(spec);
    assert.equal(typeof out.html, 'string');
    assert.ok(out.html.startsWith('<!doctype html>'));
  }

  // Empty rows, missing rows, and a row that is not an array.
  const odd = opsEmail({
    title: 'Odd',
    sections: [
      { kind: 'fields', rows: [] },
      { kind: 'fields' },
      { kind: 'fields', rows: ['bare'] },
      { kind: 'table', columns: [], rows: [] },
      { kind: 'table', columns: ['One'], rows: ['bare'] },
      { kind: 'paragraph' },
      { kind: 'pre', text: '' },
    ],
  });
  assert.ok(odd.html.includes('bare'));
  assert.ok(odd.html.includes('One'));
});

test('an unknown section kind renders nothing and does not stop the blocks around it', () => {
  const { html } = opsEmail({
    title: 'Unknown',
    sections: [
      { kind: 'paragraph', text: 'before the unknown block' },
      { kind: 'chart', text: 'should not appear' },
      { kind: 'paragraph', text: 'after the unknown block' },
    ],
  });
  assert.ok(html.includes('before the unknown block'));
  assert.ok(html.includes('after the unknown block'));
  assert.ok(!html.includes('should not appear'));
});

test('sections render in the order they were given', () => {
  const { html } = opsEmail({
    title: 'Order',
    sections: [
      { kind: 'paragraph', text: 'FIRSTBLOCK' },
      { kind: 'alert', text: 'SECONDBLOCK' },
      { kind: 'pre', text: 'THIRDBLOCK' },
    ],
  });
  assert.ok(html.indexOf('FIRSTBLOCK') < html.indexOf('SECONDBLOCK'));
  assert.ok(html.indexOf('SECONDBLOCK') < html.indexOf('THIRDBLOCK'));
});
