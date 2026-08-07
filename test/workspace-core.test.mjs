// SOW-033: the pure PR classifier behind the member workspace PR tab. No DOM, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPull, classifyDraft, prLifecycle, submitAck, failHint, shouldPollPr, parseWorkspaceTab, parseWorkspaceNew, parseWorkspaceEdit, parseWorkspaceDraft, planHashRoute, typeForContentPath, publicPathFor, sortItems, filterByStatus, mergeTypeItems, sortModeFor, scopeFor } from '../client-ui/src/workspace-core.mjs';

test('merged PR -> Accepted (regardless of gate status)', () => {
  assert.deepEqual(classifyPull({ merged: true }, null), { label: 'Accepted', tone: 'ok' });
  assert.deepEqual(classifyPull({ state: 'merged' }, { state: 'failure' }), { label: 'Accepted', tone: 'ok' });
});

test('closed-unmerged PR -> Declined', () => {
  assert.deepEqual(classifyPull({ state: 'closed' }, null), { label: 'Declined', tone: 'muted' });
  assert.deepEqual(classifyPull({ state: 'closed', merged: false }, { state: 'success' }), { label: 'Declined', tone: 'muted' });
});

// SOW-082: classifyDraft layers the fork-staged lifecycle on top of classifyPull.
test('classifyDraft: no PR -> Staged (the draft lives on the fork only)', () => {
  assert.deepEqual(classifyDraft({ pull: null }), { state: 'staged', label: 'Staged', tone: '' });
  assert.deepEqual(classifyDraft({}), { state: 'staged', label: 'Staged', tone: '' });
});

test('classifyDraft: a PR maps to Submitted / Needs changes / Published / Declined', () => {
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: { state: 'success' } }), { state: 'review', label: 'Submitted', tone: 'ok' });
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: { state: 'failure' } }), { state: 'review', label: 'Needs changes', tone: 'bad' });
  assert.deepEqual(classifyDraft({ pull: { state: 'open' }, status: null }), { state: 'review', label: 'Submitted', tone: '' });
  assert.deepEqual(classifyDraft({ pull: { merged: true } }), { state: 'published', label: 'Published', tone: 'ok' });
  assert.deepEqual(classifyDraft({ pull: { state: 'closed' } }), { state: 'declined', label: 'Declined', tone: 'muted' });
});

test('open PR maps the gate status to Proposed / Needs changes / Error', () => {
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'success' }), { label: 'Proposed', tone: 'ok' });
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'failure' }), { label: 'Needs changes', tone: 'bad' });
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'error' }), { label: 'Error', tone: 'bad' });
  // pending / unknown / not-yet-loaded -> Proposed (still checking), never a crash
  assert.deepEqual(classifyPull({ state: 'open' }, { state: 'pending' }), { label: 'Proposed', tone: '' });
  assert.deepEqual(classifyPull({ state: 'open' }, null), { label: 'Proposed', tone: '' });
  assert.deepEqual(classifyPull({}, undefined), { label: 'Proposed', tone: '' });
});

test('merged takes precedence over a closed flag', () => {
  assert.deepEqual(classifyPull({ state: 'closed', merged: true }, null), { label: 'Accepted', tone: 'ok' });
});

// SOW-072 P2: prLifecycle layers phase + needsAttention + the gate REASON on classifyPull, so a rejection is never
// silent. The label/tone come from classifyPull; the tone is raised to 'bad' for any state the author must act on.
test('prLifecycle: a merged PR is accepted, no attention, no reason', () => {
  const r = prLifecycle({ merged: true }, null);
  assert.equal(r.phase, 'accepted');
  assert.equal(r.label, 'Accepted');
  assert.equal(r.needsAttention, false);
  assert.equal(r.reason, '');
});

test('prLifecycle: a CLOSED PR is rejected + needs attention + carries the gate reason (or a fallback)', () => {
  const withReason = prLifecycle({ state: 'closed' }, { state: 'failure', description: 'rejected-not-paid: publishing is paid-only' });
  assert.equal(withReason.phase, 'rejected');
  assert.equal(withReason.label, 'Declined');
  assert.equal(withReason.tone, 'bad'); // surfaced, not muted
  assert.equal(withReason.needsAttention, true);
  assert.match(withReason.reason, /paid-only/);
  // closed with no status still gives a plain-language reason, never silence
  const noStatus = prLifecycle({ state: 'closed' }, null);
  assert.equal(noStatus.needsAttention, true);
  assert.match(noStatus.reason, /closed without merging/);
  // review fix: a manually-closed PASSING PR must NOT show the success gate message as the "why declined"
  const closedPassing = prLifecycle({ state: 'closed' }, { state: 'success', description: 'paid member own-folder content' });
  assert.equal(closedPassing.phase, 'rejected');
  assert.match(closedPassing.reason, /closed without merging/);
  assert.doesNotMatch(closedPassing.reason, /own-folder/);
});

test('prLifecycle: an open PR whose gate fails is blocked + needs attention with the reason', () => {
  const failed = prLifecycle({ state: 'open' }, { state: 'failure', description: 'changes requested' });
  assert.equal(failed.phase, 'blocked');
  assert.equal(failed.label, 'Needs changes');
  assert.equal(failed.tone, 'bad');
  assert.equal(failed.needsAttention, true);
  assert.equal(failed.reason, 'changes requested');
  // a fallback reason when the gate gives no description
  assert.match(prLifecycle({ state: 'open' }, { state: 'failure' }).reason, /holding this until it passes/);
  assert.match(prLifecycle({ state: 'open' }, { state: 'error' }).reason, /errored/);
});

test('prLifecycle: an open, passing/checking PR is pending — no attention, no nag', () => {
  for (const status of [{ state: 'success' }, { state: 'pending' }, null]) {
    const r = prLifecycle({ state: 'open' }, status);
    assert.equal(r.phase, 'pending');
    assert.equal(r.needsAttention, false);
    assert.equal(r.reason, '');
  }
});

// SOW-072 P2: submitAck is the one consistent submission confirmation.
test('submitAck: states the real auto-merge flow + the WorkBench, with the PR number when known', () => {
  const auto = submitAck({ prNumber: 42 });
  assert.match(auto, /PR #42/);
  assert.match(auto, /merges automatically/);
  assert.match(auto, /WorkBench/);
  assert.match(submitAck({ prNumber: 7, autoMerge: false }), /awaiting review/);
  // no PR number yet -> no dangling "#"
  assert.doesNotMatch(submitAck({}), /#/);
});

// SOW-072 P3: failHint maps an error to consistent guidance (message + upgrade pointer + retryable).
test('failHint: membership-required upgrades (not retryable); auth fails to sign-in; others retry', () => {
  const paid = failHint({ code: 'membership-required', message: 'Commenting requires a paid membership.' });
  assert.equal(paid.upgrade, true);
  assert.equal(paid.retryable, false);
  assert.match(paid.text, /paid membership/);
  assert.deepEqual(failHint({ code: 'no-identity' }), { text: 'Sign in with the GBTI client first.', upgrade: false, retryable: false });
  assert.equal(failHint({ code: 'invalid-content', message: 'Title is required.' }).retryable, true);
  const net = failHint({ message: 'network down' });
  assert.equal(net.retryable, true);
  assert.equal(net.upgrade, false);
  assert.match(failHint(null).text, /try again/); // no error object -> a safe default
});

// SOW-072 P3: shouldPollPr keeps polling only an open, still-checking PR.
test('shouldPollPr: poll a pending PR, stop on accepted/rejected/blocked', () => {
  assert.equal(shouldPollPr({ phase: 'pending' }), true);
  for (const phase of ['accepted', 'rejected', 'blocked']) assert.equal(shouldPollPr({ phase }), false, `${phase} stops polling`);
  assert.equal(shouldPollPr(null), false);
  // it composes with prLifecycle: an open+checking PR polls; a merged one does not
  assert.equal(shouldPollPr(prLifecycle({ state: 'open' }, { state: 'pending' })), true);
  assert.equal(shouldPollPr(prLifecycle({ merged: true }, null)), false);
  assert.equal(shouldPollPr(prLifecycle({ state: 'closed' }, null)), false);
});

// SOW-036 P4: the workspace deep-link tab hint.
test('parseWorkspaceTab reads a valid tab from the hash (leading # optional, extra params ignored)', () => {
  assert.equal(parseWorkspaceTab('#tab=prompt'), 'prompt');
  assert.equal(parseWorkspaceTab('tab=product'), 'product');
  assert.equal(parseWorkspaceTab('#tab=prs&foo=1'), 'prs');
  assert.equal(parseWorkspaceTab('#x=1&tab=inbox'), 'inbox');
  assert.equal(parseWorkspaceTab('#tab=post'), 'post');
  // SOW-037: the Saved + Subscriptions tabs are deep-linkable too.
  assert.equal(parseWorkspaceTab('#tab=saved'), 'saved');
  assert.equal(parseWorkspaceTab('#tab=subs'), 'subs');
  assert.equal(parseWorkspaceTab('#tab=drafts'), null); // SOW-085: the standalone Drafts tab is retired (drafts merge into the content tabs)
});

test('SOW-064: parseWorkspaceNew reads a valid #new=<type>; null otherwise', () => {
  assert.equal(parseWorkspaceNew('#new=post'), 'post');
  assert.equal(parseWorkspaceNew('new=prompt'), 'prompt');
  assert.equal(parseWorkspaceNew('#new=product&x=1'), 'product');
  assert.equal(parseWorkspaceNew('#new=profile'), null); // profile is not a quick-create content type
  assert.equal(parseWorkspaceNew('#new=bogus'), null);
  assert.equal(parseWorkspaceNew('#tab=post'), null); // a tab hash is not a new-target
  assert.equal(parseWorkspaceNew(''), null);
});

test('parseWorkspaceTab returns null for an absent / unknown / malformed tab (caller defaults to post)', () => {
  for (const h of ['', '#', undefined, null, '#tab=', '#tab=bogus', '#tab=POST', '#read=x', '#tabbed=post']) {
    assert.equal(parseWorkspaceTab(h), null, `${JSON.stringify(h)} -> null`);
  }
});

// SOW-106 QA fix: the editor deep-link vocabulary (refresh restores the open editor).
test('parseWorkspaceEdit: accepts only canonical content paths (encoded); everything else is null', () => {
  const p = 'members/alice/prompts/scope-of-work-claude-code-skill/index.md';
  assert.equal(parseWorkspaceEdit(`#tab=prompt&edit=${encodeURIComponent(p)}`), p);
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('members/alice/profile.md')}`), 'members/alice/profile.md');
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('house/roles.yml')}`), null); // never an arbitrary file
  assert.equal(parseWorkspaceEdit(`#edit=${encodeURIComponent('members/alice/../../secrets')}`), null);
  assert.equal(parseWorkspaceEdit('#edit=%ZZ'), null); // malformed encoding never throws
  assert.equal(parseWorkspaceEdit('#tab=prompt'), null);
});

test('parseWorkspaceDraft: `draft=<type>:<slug>` with a valid type + kebab slug', () => {
  assert.deepEqual(parseWorkspaceDraft('#tab=drafts&draft=prompt:my-skill'), { type: 'prompt', slug: 'my-skill' });
  assert.equal(parseWorkspaceDraft('#draft=share:x'), null); // shares are not draftable
  assert.equal(parseWorkspaceDraft('#draft=prompt:Bad_Slug'), null);
  assert.equal(parseWorkspaceDraft(''), null);
});

test('typeForContentPath derives the content type from the path subtree', () => {
  assert.equal(typeForContentPath('members/alice/posts/x/index.md'), 'post');
  assert.equal(typeForContentPath('members/alice/products/y/index.md'), 'product');
  assert.equal(typeForContentPath('members/alice/profile.md'), null);
});

// SOW-173: publicPathFor maps a published row to its live public route + slug.
test('publicPathFor maps each type to its public route and derives the slug', () => {
  // post -> /articles/ (SOW-136 flattened posts to the articles route), from a member folder
  assert.equal(publicPathFor({ type: 'post', path: 'members/alice/posts/hello-world/index.md' }), '/articles/hello-world/');
  assert.equal(publicPathFor({ type: 'product', path: 'members/bob/products/my-tool/index.md' }), '/products/my-tool/');
  assert.equal(publicPathFor({ type: 'prompt', path: 'members/cara/prompts/deep-focus/index.md' }), '/prompts/deep-focus/');
  // house content shares the same routes (no member/house special case)
  assert.equal(publicPathFor({ type: 'post', path: 'house/posts/launch-notes/index.md' }), '/articles/launch-notes/');
  // a trailing folder path without index.md still resolves
  assert.equal(publicPathFor({ type: 'product', path: 'members/bob/products/my-tool' }), '/products/my-tool/');
});

test('publicPathFor returns null for an unknown type or an underivable slug', () => {
  assert.equal(publicPathFor({ type: 'profile', path: 'members/alice/profile.md' }), null);
  assert.equal(publicPathFor({ type: 'share', path: 'members/alice/shares/x.md' }), null);
  assert.equal(publicPathFor({ type: 'product', path: '' }), null);
  assert.equal(publicPathFor({ type: 'product', path: 'index.md' }), null);
  assert.equal(publicPathFor({}), null);
});

// SOW-104: planHashRoute -- a rail nav exits the WorkBench editor instead of being swallowed.
test('planHashRoute: editing + a plain DIFFERENT tab route exits to that tab', () => {
  assert.deepEqual(planHashRoute('#tab=product', { editing: true, tab: 'post' }), { action: 'exit', tab: 'product' });
});
test('planHashRoute: editing + the SAME section route still exits (Articles while editing a post)', () => {
  assert.deepEqual(planHashRoute('#tab=post', { editing: true, tab: 'post' }), { action: 'exit', tab: 'post' });
});
test('planHashRoute: reviewing + a plain tab route exits the review pane', () => {
  assert.deepEqual(planHashRoute('#tab=prs', { reviewing: true, tab: 'overview' }), { action: 'exit', tab: 'prs' });
});
test('planHashRoute: while editing, a hash that still carries &edit= does NOT exit', () => {
  assert.deepEqual(planHashRoute('#tab=post&edit=members/a/posts/x/index.md', { editing: true, tab: 'post' }), { action: 'none' });
});
test('planHashRoute: not editing, a #new= route opens the editor', () => {
  assert.deepEqual(planHashRoute('#new=prompt', { editing: false, tab: 'overview' }), { action: 'openNew', type: 'prompt' });
});
test('planHashRoute: while editing, a #new= route is ignored (no double-open, no exit)', () => {
  assert.deepEqual(planHashRoute('#new=product', { editing: true, tab: 'post' }), { action: 'none' });
});
test('planHashRoute: not editing, a different plain tab switches', () => {
  assert.deepEqual(planHashRoute('#tab=subs', { editing: false, tab: 'overview' }), { action: 'switchTab', tab: 'subs' });
});
test('planHashRoute: not editing, the same tab is a no-op', () => {
  assert.deepEqual(planHashRoute('#tab=post', { editing: false, tab: 'post' }), { action: 'none' });
});

// SOW-085: the WorkBench content-list controls (sort + filter + merge + sort persistence).
const titles = (arr) => arr.map((x) => x.title);
test('sortItems: newest is publishedAt desc with dateless (drafts) at the top, title as tiebreak', () => {
  const items = [
    { title: 'Old', publishedAt: 1000 },
    { title: 'New', publishedAt: 3000 },
    { title: 'Zed draft', publishedAt: null },
    { title: 'Abe draft' }, // no publishedAt at all
    { title: 'Mid', publishedAt: 2000 },
  ];
  // dateless first (Abe, Zed by title), then New, Mid, Old
  assert.deepEqual(titles(sortItems(items, 'newest')), ['Abe draft', 'Zed draft', 'New', 'Mid', 'Old']);
  // oldest: real dates ascending, dateless drop to the bottom
  assert.deepEqual(titles(sortItems(items, 'oldest')), ['Old', 'Mid', 'New', 'Abe draft', 'Zed draft']);
  assert.deepEqual(titles(sortItems(items, 'title-asc')), ['Abe draft', 'Mid', 'New', 'Old', 'Zed draft']);
  assert.deepEqual(titles(sortItems(items, 'title-desc')), ['Zed draft', 'Old', 'New', 'Mid', 'Abe draft']);
  assert.deepEqual(sortItems(null, 'newest'), []); // defensive
});

// 2026-08-07 owner bug: "Newest" appeared to sort by most-recently-updated. The sort was always correct; the
// EDITOR was overwriting publishedAt with now on every save, so an old post edited today claimed to be new.
// The editor now stamps updatedAt only, and `updated` is a SEPARATE mode for asking after recently-touched.
test('sortItems: `updated` sorts on updatedAt, distinct from `newest` which stays on publishedAt', () => {
  const items = [
    // The real shape of the bug: an OLD post edited today must NOT outrank a genuinely new one under Newest.
    { title: 'Old post edited today', publishedAt: 1000, updatedAt: 9000 },
    { title: 'Published today', publishedAt: 8000, updatedAt: 8000 },
    { title: 'Mid, never edited', publishedAt: 5000 },
  ];
  assert.deepEqual(titles(sortItems(items, 'newest')), ['Published today', 'Mid, never edited', 'Old post edited today']);
  assert.deepEqual(titles(sortItems(items, 'updated')), ['Old post edited today', 'Published today', 'Mid, never edited']);
});

test('sortItems: `updated` falls back to publishedAt, so a never-edited item ranks by when it appeared', () => {
  // Falling back to publishedAt (rather than treating a missing updatedAt as dateless) keeps a never-edited
  // item in its real place instead of floating it to the top of the Recently-updated list.
  const items = [
    { title: 'Edited recently', publishedAt: 1000, updatedAt: 7000 },
    { title: 'Never edited, old', publishedAt: 2000 },
    { title: 'Never edited, newer', publishedAt: 6000 },
  ];
  assert.deepEqual(titles(sortItems(items, 'updated')), ['Edited recently', 'Never edited, newer', 'Never edited, old']);
  // A genuine draft (no dates at all) still sorts to the top under `updated`, matching `newest`.
  assert.deepEqual(titles(sortItems([...items, { title: 'Aaa draft' }], 'updated'))[0], 'Aaa draft');
});

test('sortModeFor accepts the new `updated` mode and still rejects junk', () => {
  assert.equal(sortModeFor('updated'), 'updated');
  assert.equal(sortModeFor('newest'), 'newest');
  assert.equal(sortModeFor('not-a-mode'), 'newest'); // falls back to the default
  assert.equal(sortModeFor(null), 'newest');
});

test('filterByStatus: all / published / draft (anything not published)', () => {
  const items = [{ title: 'P', status: 'published' }, { title: 'D', status: 'draft' }, { title: 'S', status: 'staged' }];
  assert.deepEqual(titles(filterByStatus(items, 'all')), ['P', 'D', 'S']);
  assert.deepEqual(titles(filterByStatus(items, 'published')), ['P']);
  assert.deepEqual(titles(filterByStatus(items, 'draft')), ['D', 'S']);
});

test('mergeTypeItems: canonical + fork drafts, deduped by slug (a staged edit drops, a new draft is kept + flagged)', () => {
  const content = [
    { title: 'Published A', path: 'members/al/posts/aaa/index.md', status: 'published' },
    { title: 'Published B', path: 'members/al/posts/bbb/index.md', status: 'published' },
  ];
  const drafts = [
    { title: 'Edit of A', path: 'members/al/posts/aaa/index.md', status: 'draft', pull: null }, // staged edit of A -> dropped
    { title: 'New draft C', path: 'members/al/posts/ccc/index.md', status: 'draft', pull: null }, // new -> kept
  ];
  const merged = mergeTypeItems(content, drafts);
  assert.deepEqual(titles(merged), ['Published A', 'Published B', 'New draft C']);
  assert.equal(merged[2].isDraft, true);
  assert.ok(!merged.some((x) => x.title === 'Edit of A'), 'the staged edit of A is deduped away (A represents it)');
});

test('sortModeFor: a valid stored value wins, else the default (newest)', () => {
  assert.equal(sortModeFor('oldest'), 'oldest');
  assert.equal(sortModeFor('title-asc'), 'title-asc');
  assert.equal(sortModeFor('garbage'), 'newest');
  assert.equal(sortModeFor(null), 'newest');
});

// SOW-145: the WorkBench content scope (My content / House content).
test('scopeFor: a non-superadmin is always member (the toggle is hidden)', () => {
  assert.equal(scopeFor('house', { role: 'member', personalCount: 0 }), 'member');
  assert.equal(scopeFor('house', { role: 'admin', personalCount: 0 }), 'member');
  assert.equal(scopeFor('house', { role: 'moderator', personalCount: 5 }), 'member');
  assert.equal(scopeFor(null, { role: 'member' }), 'member');
});

test('scopeFor: a superadmin — stored pref wins, else empty-personal defaults to house', () => {
  // A valid stored pref always wins.
  assert.equal(scopeFor('house', { role: 'superadmin', personalCount: 9 }), 'house');
  assert.equal(scopeFor('member', { role: 'superadmin', personalCount: 0 }), 'member');
  // No stored pref: default member when they have their own content, house when their member folder is empty.
  assert.equal(scopeFor(null, { role: 'superadmin', personalCount: 3 }), 'member');
  assert.equal(scopeFor(null, { role: 'superadmin', personalCount: 0 }), 'house');
  assert.equal(scopeFor('garbage', { role: 'superadmin', personalCount: 0 }), 'house');
  // gbtilabs (owns only house content) lands on house on first open.
  assert.equal(scopeFor(undefined, { role: 'superadmin' }), 'house');
});
