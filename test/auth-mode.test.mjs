// SOW-157: the runtime per-member auth mode. authModeFor precedence (stored beats baked, invalid ignored)
// and the pure sign-in mode decision (no silent flips; hosted is the no-fork default).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authModeFor, isHostedCtx, decideAuthMode, AUTH_MODE } from '../client/src/signup-base.mjs';

const storeOf = (v) => ({ get: (k) => (k === 'authMode' ? v : undefined) });

test('authModeFor: the stored per-member mode wins over the baked constant', () => {
  assert.equal(authModeFor({ store: storeOf('hosted') }), 'hosted');
  assert.equal(authModeFor({ store: storeOf('app') }), 'app');
  assert.equal(authModeFor(storeOf('classic')), 'classic', 'accepts a bare store too');
  assert.equal(isHostedCtx({ store: storeOf('hosted') }), true);
});

test('authModeFor: an invalid or absent stored mode falls back to the baked AUTH_MODE', () => {
  assert.equal(authModeFor({ store: storeOf('wizard') }), AUTH_MODE);
  assert.equal(authModeFor({ store: storeOf(null) }), AUTH_MODE);
  assert.equal(authModeFor({}), AUTH_MODE);
  assert.equal(authModeFor(null), AUTH_MODE);
});

test('decideAuthMode: fork + install stays app; no fork means hosted', () => {
  assert.equal(decideAuthMode({ reachedGithub: true, signedIn: true, forkReady: true, installReady: true }), 'app');
  assert.equal(decideAuthMode({ reachedGithub: true, signedIn: true, forkReady: false, installReady: false }), 'hosted');
});

test('decideAuthMode: never decides on an unreachable probe, a dead token, or fork-without-install', () => {
  assert.equal(decideAuthMode({ reachedGithub: false, signedIn: true, forkReady: false }), null, 'network blip must not flip a member');
  assert.equal(decideAuthMode({ reachedGithub: true, signedIn: false }), null);
  assert.equal(decideAuthMode({ reachedGithub: true, signedIn: true, forkReady: true, installReady: false }), null, 'install prompt, not a silent flip');
  assert.equal(decideAuthMode(null), null);
});
