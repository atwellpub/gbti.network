// sow-158 Phase 1b: credentialed reflected-origin CORS for the cookie-eligible member routes. Verifies the cookie
// routes reflect an allow-listed Origin with credentials, block a non-allow-listed one, never pair '*' with
// credentials, and always set Vary: Origin. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, parseAllowedOrigins } from '../workers/signup/cors.mjs';

const ENV = { CORS_ALLOWED_ORIGINS: 'https://gbti.network,http://localhost:4321' };
const req = (origin) => new Request('https://signup.gbti.network/membership/activity', origin ? { headers: { Origin: origin } } : {});

test('parseAllowedOrigins parses the comma list and fails closed to the apex (never open)', () => {
  assert.deepEqual([...parseAllowedOrigins(ENV)].sort(), ['http://localhost:4321', 'https://gbti.network']);
  assert.deepEqual([...parseAllowedOrigins({})], ['https://gbti.network']);
  assert.deepEqual([...parseAllowedOrigins({ CORS_ALLOWED_ORIGINS: '' })], ['https://gbti.network']);
});

test('credentialed + allow-listed origin reflects it with credentials + X-GBTI-CSRF + Vary: Origin', () => {
  const h = corsHeaders(req('https://gbti.network'), ENV, { credentials: true });
  assert.equal(h['Access-Control-Allow-Origin'], 'https://gbti.network');
  assert.equal(h['Access-Control-Allow-Credentials'], 'true');
  assert.match(h['Access-Control-Allow-Headers'], /X-GBTI-CSRF/);
  assert.match(h['Vary'], /Origin/);
});

test('credentialed + non-allow-listed origin gets NO Access-Control-Allow-Origin but still Vary: Origin', () => {
  const h = corsHeaders(req('https://evil.example'), ENV, { credentials: true });
  assert.equal(h['Access-Control-Allow-Origin'], undefined);
  assert.equal(h['Access-Control-Allow-Credentials'], undefined);
  assert.match(h['Vary'], /Origin/);
});

test('a wildcard origin and credentials NEVER co-occur (the classic footgun)', () => {
  for (const origin of ['https://gbti.network', 'https://evil.example', null]) {
    const h = corsHeaders(req(origin), ENV, { credentials: true });
    assert.ok(!(h['Access-Control-Allow-Origin'] === '*' && h['Access-Control-Allow-Credentials']));
  }
});

test('credentials:false keeps the legacy wildcard shape with no credentials header (bearer routes)', () => {
  const h = corsHeaders(req('https://anything.example'), ENV, { credentials: false });
  assert.equal(h['Access-Control-Allow-Origin'], '*');
  assert.equal(h['Access-Control-Allow-Credentials'], undefined);
});

test('the methods param is honored on the credentialed branch', () => {
  const h = corsHeaders(req('https://gbti.network'), ENV, { credentials: true, methods: 'POST, OPTIONS' });
  assert.equal(h['Access-Control-Allow-Methods'], 'POST, OPTIONS');
});
