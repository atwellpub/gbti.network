// The one interpolation in clients/stripe.mjs that a crafted value can break OUT of: `githubId` lands inside a
// SINGLE-QUOTED LITERAL in Stripe's search query language. A quote in the value closes the literal early and the
// rest is parsed as query syntax, against the registry that decides who counts as a paid member.
//
// These tests assert the guard AND the direction it fails in. Refusing must DENY (null, which every caller reads
// as not-paid), never widen the search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStripeClient } from '../clients/stripe.mjs';

/** Capture the outgoing URL without performing any network call. */
function spyClient() {
  const seen = [];
  const fetch = async (url) => {
    seen.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'cus_1' }] }) };
  };
  return { client: createStripeClient({ apiKey: 'sk_test', fetch }), seen };
}

test('stripe: a normal numeric github_id still searches, and the id reaches the query', async () => {
  const { client, seen } = spyClient();
  const r = await client.searchCustomerByGithubId('125175036');
  assert.equal(r?.id, 'cus_1', 'a valid id must still resolve');
  assert.equal(seen.length, 1);
  assert.ok(decodeURIComponent(seen[0]).includes("metadata['github_id']:'125175036'"), 'the id must reach the query');
});

test('stripe: a quote-bearing id is REFUSED and never reaches Stripe (query-injection)', async () => {
  const { client, seen } = spyClient();
  // Closes the literal and appends an always-true-ish disjunct: the classic break-out shape.
  const evil = "1' OR metadata['github_id']:'2";
  const r = await client.searchCustomerByGithubId(evil);
  assert.equal(r, null, 'must fail CLOSED: a refused id reads as no-customer, i.e. not paid');
  assert.equal(seen.length, 0, 'no request may be issued at all for an unvalidated id');
});

test('stripe: non-numeric and malformed ids are refused without a request', async () => {
  const { client, seen } = spyClient();
  for (const bad of [null, undefined, '', '   ', 'abc', '12a', '-1', '+1', '1.0', '1e3', "1'", '1 2', 'x'.repeat(40), '9'.repeat(21)]) {
    assert.equal(await client.searchCustomerByGithubId(bad), null, `must refuse: ${JSON.stringify(bad)}`);
  }
  assert.equal(seen.length, 0, 'not one of those may produce a request');
});

test('stripe: a padded id is REFUSED, not silently cleaned (changed 2026-08-22)', async () => {
  const { client, seen } = spyClient();
  // This test previously asserted the OPPOSITE: that '125175036\n' was trimmed and searched. The rule is now
  // reject-do-not-clean, agreed with @UnifiedWorker, so that one concept has one answer across every gate.
  // A padded github_id means something upstream is already wrong, and cleaning it hides that. Refusing reads as
  // "no such customer", i.e. NOT paid, which is the fail-closed direction for a membership check.
  //
  // (The old test's stated rationale was also wrong: JS `$` without `m` does NOT match before a trailing
  // newline, so /^[0-9]+$/ would have rejected "123\n" anyway. That is Perl/PCRE/Python behaviour.)
  for (const padded of ['125175036\n', ' 125175036', '125175036 ', '\t125175036']) {
    assert.equal(await client.searchCustomerByGithubId(padded), null, `must refuse: ${JSON.stringify(padded)}`);
  }
  assert.equal(seen.length, 0, 'no request may be issued for a padded id');
});

test('stripe: findCustomerByGithubId inherits the guard (it is the deriveStatus contract)', async () => {
  const { client, seen } = spyClient();
  assert.equal(await client.findCustomerByGithubId("1' OR x:'1"), null);
  assert.equal(seen.length, 0, 'the deriveStatus entry point must not bypass the guard');
});
