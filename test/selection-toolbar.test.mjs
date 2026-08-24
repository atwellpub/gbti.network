// sow-235: the link manager behind the selection toolbar. The panel offers anchor text, destination, new tab and
// nofollow; planLinkEdit is what those four inputs MEAN, decided without a DOM so it can be tested here. The DOM
// applier in createSelectionToolbar is a thin translation of the plan, and positioning is left to the browser pass.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkRel, planLinkEdit, SELECTION_TOOLBAR_CSS } from '../client-ui/src/selection-toolbar.mjs';

test('target=_blank always carries noopener, or the new tab can reach back through window.opener', () => {
  assert.equal(linkRel({ blank: true }), 'noopener');
  assert.equal(linkRel({ blank: true, nofollow: true }), 'nofollow noopener');
  assert.equal(linkRel({ nofollow: true }), 'nofollow');
  assert.equal(linkRel({}), '');
});

test('a new link is created with the composed rel and target', () => {
  assert.deepEqual(planLinkEdit({ url: 'https://x.com', text: 'x', existingText: 'x' }), {
    action: 'create', href: 'https://x.com', rel: null, target: null, text: null,
  });
  assert.deepEqual(planLinkEdit({ url: 'https://x.com', nofollow: true, blank: true, text: 'x', existingText: 'x' }), {
    action: 'create', href: 'https://x.com', rel: 'nofollow noopener', target: '_blank', text: null,
  });
});

test('an existing link updates, and unchecking a box clears the attribute rather than leaving it', () => {
  const p = planLinkEdit({ url: 'https://y.io', hasExisting: true, existingText: 't', text: 't' });
  assert.equal(p.action, 'update');
  assert.equal(p.rel, null, 'rel must be cleared, not left at its old value');
  assert.equal(p.target, null, 'target must be cleared when New tab is unchecked');
});

test('changed anchor text is reported; unchanged text is left alone', () => {
  assert.equal(planLinkEdit({ url: 'https://x.com', hasExisting: true, existingText: 'old', text: 'new' }).text, 'new');
  assert.equal(planLinkEdit({ url: 'https://x.com', hasExisting: true, existingText: 'same', text: 'same' }).text, null);
  assert.equal(planLinkEdit({ url: 'https://x.com', hasExisting: true, existingText: 'keep', text: '  ' }).text, null,
    'a blank text box must not wipe the anchor text');
  assert.equal(planLinkEdit({ url: 'https://x.com', hasExisting: true, existingText: 'old', text: '  new  ' }).text, 'new');
});

test('a dangerous URL scheme is refused before anything reaches the live DOM', () => {
  for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>']) {
    assert.equal(planLinkEdit({ url }).action, 'reject', `${url} must be refused`);
  }
  assert.equal(planLinkEdit({ url: 'https://ok.com' }).action, 'create');
  assert.equal(planLinkEdit({ url: '/relative/path' }).action, 'create', 'a same-site relative link is fine');
});

test('remove unwraps an existing link, and an empty URL is a no-op rather than a silent removal', () => {
  assert.deepEqual(planLinkEdit({ remove: true, hasExisting: true, url: 'https://x.com' }), { action: 'remove' });
  assert.deepEqual(planLinkEdit({ url: '', hasExisting: true }), { action: 'remove' }, 'clearing the URL removes the link');
  assert.deepEqual(planLinkEdit({ url: '', hasExisting: false }), { action: 'none' }, 'no link and no URL: do nothing');
  assert.deepEqual(planLinkEdit({ url: '   ', hasExisting: false }), { action: 'none' });
  assert.deepEqual(planLinkEdit(), { action: 'none' });
});

test('the popover CSS names its own tokens with fallbacks, so it renders in both host surfaces', () => {
  // The block editor supplies --s-*; the site supplies the V3 names. A rule pinned to only one would be invisible
  // or unreadable in the other, which is exactly the drift this shared module exists to prevent.
  assert.match(SELECTION_TOOLBAR_CSS, /--s-surface, var\(--paper/);
  assert.match(SELECTION_TOOLBAR_CSS, /--s-line, var\(--line/);
  assert.match(SELECTION_TOOLBAR_CSS, /--s-green, var\(--green-700/);
});
