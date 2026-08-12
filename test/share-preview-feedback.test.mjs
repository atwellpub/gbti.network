// sow-211 Phase 1: a failed link preview has to SAY it failed.
//
// The defect this pins: the composer's `_fetchPreview` used to `catch { box.hidden = true; box.innerHTML = ''; }`,
// so a 401, a network failure or a 500 hid the entire preview area and reported nothing. That is what the
// owner saw as "nothing was extracted and there was no visual feedback". The reached-but-empty case was
// already legible ("No preview available for this link."), so the two outcomes were never the
// indistinguishable pair the SOW originally described: one was invisible, the other was fine.
//
// The mapper is pure and exported because the element modules guard customElements for node, so the house
// pattern is to test the helper rather than the element (domainOf in gbti-news.mjs, prEvent in workspace-core.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ogPreviewState } from '../client-ui/src/elements/gbti-share-composer.mjs';

const src = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// Both hosts throw their own error class, and only ONE of them is exercised on the website, so the mapper is
// tested against both shapes rather than against whichever one happened to be in front of me.
class WorkbenchClientError extends Error {
  constructor(code, message) { super(message || code); this.name = 'WorkbenchClientError'; this.code = code; }
}
class GbtiClientError extends Error {
  constructor(code, message) { super(message || code); this.name = 'GbtiClientError'; this.code = code; }
}

test('a preview with data renders the card, which is the untouched happy path', () => {
  assert.deepEqual(ogPreviewState({ og: { title: 'T' } }), { kind: 'card', message: '', retry: false });
  assert.deepEqual(ogPreviewState({ og: { image: 'https://x/y.jpg' } }), { kind: 'card', message: '', retry: false });
  assert.deepEqual(ogPreviewState({ og: { description: 'D' } }), { kind: 'card', message: '', retry: false });
});

test('a THROW is an error state with a message, never a hidden box', () => {
  for (const E of [WorkbenchClientError, GbtiClientError]) {
    const s = ogPreviewState({ error: new E('http-500', 'boom') });
    assert.equal(s.kind, 'error', `${E.name} must produce a visible error`);
    assert.match(s.message, /could not fetch a preview/i);
    assert.equal(s.retry, true, 'a server failure is worth retrying');
  }
});

test('the error CODE survives into the message, because a generic apology is undiagnosable', () => {
  assert.match(ogPreviewState({ error: new GbtiClientError('http-502') }).message, /\(http-502\)/);
  // A code-less throw still gets a message, with no empty parentheses left behind.
  const bare = ogPreviewState({ error: new Error('kaboom') });
  assert.equal(bare.kind, 'error');
  assert.ok(!bare.message.includes('()'), 'no dangling parentheses when there is no code');
});

test('an unauthenticated failure gets its own sentence and no retry button', () => {
  for (const code of ['not_authenticated', 'not-authenticated', 'http-401']) {
    const s = ogPreviewState({ error: new WorkbenchClientError(code) });
    assert.equal(s.kind, 'error');
    assert.match(s.message, /^Sign in to fetch a link preview\.$/);
    assert.equal(s.retry, false, 'the action is to sign in, not to retry');
  }
});

// A validation refusal already has a specific, member-readable reason. It is shown instead of the generic
// line, with no retry, because the same URL will be refused identically the second time.
test('a validation refusal shows the server reason and offers no retry', () => {
  const s = ogPreviewState({ error: new WorkbenchClientError('invalid_url', 'only http(s) URLs are allowed') });
  assert.equal(s.kind, 'error');
  assert.equal(s.message, 'We cannot preview that link: only http(s) URLs are allowed');
  assert.equal(s.retry, false);
});

test('a validation refusal with no usable detail still reads as a sentence, not as a bare code', () => {
  for (const e of [new WorkbenchClientError('invalid_url'), new WorkbenchClientError('bad_request', 'bad_request')]) {
    const s = ogPreviewState({ error: e });
    assert.equal(s.message, 'We cannot preview that link.', 'the code must not be shown as the message');
  }
});

// The SSRF guardrail this SOW names: making failure visible must not reveal whether an internal host exists.
// Every blocked host is refused with the SAME sentence, so no pair of responses can be compared to learn one.
test('every blocked host is refused identically, so nothing leaks about internal hosts', () => {
  const refuse = (host) => ogPreviewState({ error: new WorkbenchClientError('invalid_url', 'that host is not allowed') }).message;
  assert.equal(refuse('127.0.0.1'), refuse('10.0.0.5'));
  assert.equal(refuse('169.254.169.254'), refuse('a-host-that-does-not-exist.internal'));
});

// The Worker's four collapsed outcomes, now told apart. Reasons mirror membership-og.mjs.
test('each Worker reason becomes its own sentence', () => {
  const m = (reason) => ogPreviewState({ og: { ok: true, title: null, image: null, description: null, reason } });
  assert.match(m('unreachable').message, /could not reach that page/i);
  assert.match(m('not-a-page').message, /not a web page/i);
  assert.match(m('timeout').message, /took too long/i);
  for (const r of ['unreachable', 'not-a-page', 'timeout']) assert.equal(m(r).kind, 'empty', `${r} is not an error state`);
});

test('a genuinely blank page keeps the original wording, because it was already correct', () => {
  const s = ogPreviewState({ og: { ok: true, title: null, image: null, description: null, reason: null } });
  assert.deepEqual(s, { kind: 'empty', message: 'No preview available for this link.', retry: false });
});

test('an unrecognised reason falls back to the generic message rather than leaking a raw code', () => {
  const s = ogPreviewState({ og: { ok: true, reason: 'something-new-from-a-newer-worker' } });
  assert.equal(s.message, 'No preview available for this link.');
});

test('the Worker and the site deploy separately, so an OLD payload with no reason still works', () => {
  assert.equal(ogPreviewState({ og: { ok: true, image: null, title: null } }).kind, 'empty');
  assert.equal(ogPreviewState({ og: null }).kind, 'empty');
  assert.equal(ogPreviewState({}).kind, 'empty');
  assert.equal(ogPreviewState().kind, 'empty');
});

test('only a page that cannot be re-reached offers a retry', () => {
  const retryOf = (reason) => ogPreviewState({ og: { ok: true, reason } }).retry;
  assert.equal(retryOf('unreachable'), true);
  assert.equal(retryOf('timeout'), true);
  assert.equal(retryOf('not-a-page'), false, 'a PDF will still be a PDF on the second try');
});

// DRIFT: the whole point is that ONE place decides. If _fetchPreview grows its own branching again, the
// hidden-box regression comes back and no unit test would see it, because the mapper would still be correct.
test('DRIFT: _fetchPreview renders from the mapper and never hides the box on failure', () => {
  const s = src('client-ui/src/elements/gbti-share-composer.mjs');
  assert.match(s, /const state = ogPreviewState\(\{ og, error \}\)/, 'the composer stopped using the shared mapper');
  assert.match(s, /catch \(e\) \{\s*error = e;/, 'the bare catch that discarded the error code is back');
  // The catch must not hide the box. This is the exact regression, matched on the old shape.
  assert.doesNotMatch(s, /catch \{[^}]*box\.hidden = true/,
    'a failed preview hides the box again, which is the sow-211 defect verbatim');
});

test('DRIFT: the Worker still sends a reason for each distinct failure', () => {
  const s = src('workers/signup/membership-og.mjs');
  // Matched as bare quoted literals, not as `reason: 'x'`: 'timeout' is produced by a ternary on the abort
  // signal, so a prefix match would silently miss it and pass for the wrong reason.
  for (const r of ['unreachable', 'not-a-page', 'timeout']) {
    assert.ok(s.includes(`'${r}'`), `membership-og.mjs no longer sends '${r}', so the composer loses that sentence`);
  }
  // The timeout/network split is the one that needs the abort signal to exist; without it both collapse again.
  assert.match(s, /controller\.signal\.aborted \? 'timeout' : 'unreachable'/,
    'a timeout is no longer distinguished from a refused connection');
  // Every reason the Worker can emit must have a sentence, or an author silently gets the generic fallback.
  const emitted = new Set([...s.matchAll(/'(unreachable|not-a-page|timeout)'/g)].map((m) => m[1]));
  for (const r of emitted) {
    assert.notEqual(ogPreviewState({ og: { ok: true, reason: r } }).message, 'No preview available for this link.',
      `the Worker sends reason '${r}' but the composer has no sentence for it`);
  }
});
