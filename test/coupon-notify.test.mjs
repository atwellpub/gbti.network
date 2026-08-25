// sow-279: the coupon-redemption notice helpers. Pure, no DOM, no network.
//
// Two properties under test, each mutation-checked:
//   1. newRedemptionRecord fires ONCE per member. The signup chain runs redeemCoupon twice (GitHub, then the
//      deferred Discord leg), and the second returns `already: true`. If newRedemptionRecord returned a record
//      for an `already` re-run, the owner would get a duplicate notice on every coupon signup. Revert the
//      `already === true` guard and the "already re-run" test goes red.
//   2. couponRedemptionNotice projects the real grant facts. Revert the `until`/`tier` interpolation and the
//      field assertions go red.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRedemptionRecord, couponRedemptionNotice } from '../membership/coupon-notify.mjs';

const NEW_GRANT = {
  code: 'CODEABLEYEAR',
  campaign: 'CODEABLEYEAR',
  tier: 'member',
  until: '2027-08-25T00:00:00.000Z',
  redeemedAt: '2026-08-25T00:00:00.000Z',
  login: 'octocat',
  already: false,
};

test('newRedemptionRecord: a NEW grant yields a record carrying the grant facts', () => {
  const r = newRedemptionRecord(NEW_GRANT, { githubId: 12345, login: 'ignored-because-grant-has-one' });
  assert.equal(r.code, 'CODEABLEYEAR');
  assert.equal(r.tier, 'member');
  assert.equal(r.until, '2027-08-25T00:00:00.000Z');
  assert.equal(r.login, 'octocat');       // the grant's own login wins
  assert.equal(r.githubId, '12345');      // stringified from the identity
});

test('newRedemptionRecord: an ALREADY re-run (the Discord leg) yields null, so the notice fires once', () => {
  assert.equal(newRedemptionRecord({ ...NEW_GRANT, already: true }, { githubId: 12345 }), null);
});

test('newRedemptionRecord: null grant, or a grant with no `until`, yields null (fail safe)', () => {
  assert.equal(newRedemptionRecord(null, { githubId: 1 }), null);
  assert.equal(newRedemptionRecord(undefined, { githubId: 1 }), null);
  assert.equal(newRedemptionRecord({ code: 'X', already: false }, { githubId: 1 }), null); // no until
});

test('newRedemptionRecord: falls back campaign->code, login->identity, tier->member', () => {
  const r = newRedemptionRecord(
    { code: 'HUDSINVITE', until: '2027-01-01T00:00:00.000Z', already: false },
    { githubId: 7, login: 'hudson' },
  );
  assert.equal(r.campaign, 'HUDSINVITE'); // campaign absent -> the code
  assert.equal(r.login, 'hudson');        // grant login absent -> the identity login
  assert.equal(r.tier, 'member');         // tier absent -> member
});

test('couponRedemptionNotice: subject + text carry code, member, tier, until', () => {
  const r = newRedemptionRecord(NEW_GRANT, { githubId: 12345 });
  const { subject, text } = couponRedemptionNotice(r);
  assert.match(subject, /CODEABLEYEAR/);
  assert.match(subject, /octocat/);
  assert.match(text, /CODEABLEYEAR/);
  assert.match(text, /octocat \(github_id 12345\)/);
  assert.match(text, /member/);
  assert.match(text, /2027-08-25T00:00:00\.000Z/);
});

test('couponRedemptionNotice: MUTATION - a different tier shows in the text', () => {
  const memberText = couponRedemptionNotice(newRedemptionRecord(NEW_GRANT, { githubId: 1 })).text;
  const creatorText = couponRedemptionNotice(newRedemptionRecord({ ...NEW_GRANT, tier: 'creator' }, { githubId: 1 })).text;
  assert.notEqual(memberText, creatorText);
  assert.match(creatorText, /creator/);
});

test('couponRedemptionNotice: no em/en dashes in the owner-facing copy (writing convention)', () => {
  const { subject, text } = couponRedemptionNotice(newRedemptionRecord(NEW_GRANT, { githubId: 1 }));
  assert.ok(!/[–—]/.test(subject + text), 'subject/text must not contain en or em dashes');
});
