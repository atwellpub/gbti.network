// sow-230: the invite-link builder. What is under test is the PAIRING of a coupon to the lander that
// describes what it grants, because getting that wrong is not a formatting bug: it is the defect that
// retired /linkedin-invite/, where a member-tier code sat under prose selling the creator tier.
//
// The registry itself is deliberately NOT a fixture here. These tests pass coupon objects directly, so they
// cannot start passing or failing because somebody edited house/coupons.yml, which is the failure that made
// two other guards in this repo untrustworthy this week.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLander, blockedReason, inviteRow } from '../scripts/invite-links.mjs';
// sow-231 Phase 3: the mapping moved into membership/invites.mjs so the browser coupon manager and this CLI
// resolve a lander identically. Importing it from its real home rather than re-exporting keeps one source.
import { LANDER_BY_TIER, LANDER_BY_CAMPAIGN } from '../membership/invites.mjs';

const NOW = new Date('2026-08-15T12:00:00.000Z');
const coupon = (over = {}) => ({ code: 'TESTCODE', tier: 'member', freeDays: 365, active: true, maxRedemptions: null, expiresAt: null, note: '', ...over });

test('a coupon resolves to the lander for ITS tier, not to a default', () => {
  assert.equal(resolveLander(coupon({ tier: 'member' })), '/member-invite/');
  assert.equal(resolveLander(coupon({ tier: 'creator' })), '/curator-invite/');
});

test('a per-code lander beats the tier map, because the page belongs to the campaign', () => {
  // CODEABLEYEAR is creator tier, so the tier map alone would send it to the generic curator lander. It has
  // its own page addressing that audience, and which page a campaign uses is a property of the campaign.
  assert.equal(resolveLander(coupon({ code: 'CODEABLEYEAR', tier: 'creator' })), '/codeable-invite/');
  assert.equal(LANDER_BY_CAMPAIGN.CODEABLEYEAR, '/codeable-invite/');
});

test('an unknown tier resolves to NO lander rather than to a plausible one', () => {
  // The important direction. Falling back to any page would describe a tier the coupon does not grant, which
  // is exactly the live defect this script exists to prevent. No page is the honest answer.
  assert.equal(resolveLander(coupon({ tier: 'wizard' })), null);
  assert.equal(resolveLander(coupon({ tier: undefined })), null);
  assert.equal(resolveLander(null), null);
});

test('a coupon with no resolvable lander is NOT sendable, and says why', () => {
  const row = inviteRow(coupon({ tier: 'wizard' }), NOW);
  assert.equal(row.sendable, false);
  assert.equal(row.url, null, 'no URL is offered rather than a wrong one');
  assert.match(row.warnings.join(' '), /no lander/);
});

test('a tierless coupon warns about the tier rather than about the lander', () => {
  // Two different problems that both end in "no lander", and the message has to name the real one: a missing
  // tier is a registry defect (validateCoupons rejects it while active), a missing map entry is a code gap.
  const row = inviteRow(coupon({ tier: null }), NOW);
  assert.equal(row.sendable, false);
  assert.match(row.warnings.join(' '), /no tier/);
});

test('inactive and expired coupons are blocked, with the reason, and expiry fails CLOSED', () => {
  assert.equal(blockedReason(coupon({ active: false }), NOW), 'inactive');
  assert.match(blockedReason(coupon({ expiresAt: '2026-01-01T00:00:00.000Z' }), NOW), /^expired/);
  assert.equal(blockedReason(coupon({ expiresAt: '2027-01-01T00:00:00.000Z' }), NOW), null, 'a future expiry does not block');
  // An unreadable date is treated as PASSED, matching couponIsRedeemable. A date we cannot parse must never
  // become a coupon that never expires.
  assert.match(blockedReason(coupon({ expiresAt: 'not-a-date' }), NOW), /unreadable/);
});

test('the built URL carries the code and points at the tier-matched lander', () => {
  const row = inviteRow(coupon({ code: 'HUDSINVITE', tier: 'member' }), NOW);
  assert.equal(row.sendable, true);
  assert.equal(row.url, 'https://gbti.network/member-invite/?coupon=HUDSINVITE');
});

test('every tier in the map has a distinct lander, so two tiers cannot share one page', () => {
  // A copy-paste in LANDER_BY_TIER would point two tiers at one page and reintroduce the original defect
  // silently, since every individual lookup would still succeed.
  const landers = Object.values(LANDER_BY_TIER);
  assert.equal(new Set(landers).size, landers.length, `duplicate lander in LANDER_BY_TIER: ${landers.join(', ')}`);
});

test('the tier map covers every PAID tier the system defines', () => {
  // The guard that keeps this file honest as tiers change: a new paid tier with no lander means a coupon for
  // it silently has nowhere to send people. Derived from the tier axis rather than hardcoded, so adding a
  // tier reds this test instead of quietly producing an unsendable coupon later.
  const paid = ['member', 'creator'];
  for (const t of paid) {
    assert.ok(LANDER_BY_TIER[t], `paid tier "${t}" has no lander; a coupon granting it could not be sent`);
  }
});
