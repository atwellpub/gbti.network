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

// --- sow-279 follow-up (2026-08-26): the running redemption count. ---
//
// house/coupons.yml has required it from the start ("code, github_id, timestamp, and the running redemption
// count"), and it was the one item in that list the notice never carried. redeemCoupon already reads the
// per-code counter to enforce maxRedemptions, so the number is in hand at the moment the grant is returned
// and no extra KV read was needed. These tests pin BOTH directions: present when supplied, and OMITTED rather
// than guessed when not, because a wrong number in an abuse report would be read as fact.

test('the record carries the running count when redeemCoupon supplies it', () => {
  const rec = newRedemptionRecord(
    { code: 'CODEABLEYEAR', until: '2027-08-26T00:00:00.000Z', redemptionCount: 7, already: false },
    { githubId: '12345' },
  );
  assert.equal(rec.redemptionCount, 7);
});

test('the count reaches the email body, aligned with the other fields', () => {
  const rec = newRedemptionRecord(
    { code: 'CODEABLEYEAR', until: '2027-08-26T00:00:00.000Z', redemptionCount: 7, already: false },
    { githubId: '12345' },
  );
  const { text } = couponRedemptionNotice(rec);
  assert.match(text, /^Total: {6}7 redemptions of this code, including this one$/m);
});

test('OMITTED, not guessed, when the count is absent: an older caller must not print a number', () => {
  const rec = newRedemptionRecord(
    { code: 'HUDSINVITE', until: '2027-08-26T00:00:00.000Z', already: false },
    { githubId: '12345' },
  );
  assert.equal(rec.redemptionCount, 0);
  const { text } = couponRedemptionNotice(rec);
  assert.doesNotMatch(text, /Total:/);
  assert.doesNotMatch(text, /redemptions of this code/);
  assert.match(text, /Code: {7}HUDSINVITE/, 'the rest of the notice is unaffected');
});

test('a nonsense count is treated as absent rather than printed', () => {
  for (const bad of [0, -3, NaN, 'lots', null, undefined]) {
    const rec = newRedemptionRecord(
      { code: 'X', until: '2027-01-01T00:00:00.000Z', redemptionCount: bad, already: false },
      { githubId: '1' },
    );
    assert.doesNotMatch(couponRedemptionNotice(rec).text, /Total:/, `count ${String(bad)} must not print`);
  }
});

// --- sow-279: the self-test variant --------------------------------------------------------------------
// The weekly credential-health probe sends a real email through this same helper. If that email read like a
// redemption, the owner would learn to skim the one notice this control exists to make them read, which breaks
// the alarm more thoroughly than never testing it. These pin the difference.

test('couponRedemptionNotice: the self-test says so in the subject and refuses to look like a redemption', () => {
  const record = { code: 'SELF-TEST', login: 'nobody', githubId: '0', tier: 'member', until: '(not a real grant)' };
  const { subject, text } = couponRedemptionNotice(record, { selfTest: true });
  assert.match(subject, /^\[alarm self-test\]/, 'must be filterable on the subject line alone');
  assert.doesNotMatch(subject, /^Coupon redeemed:/);
  assert.match(text, /THIS IS NOT A REDEMPTION/);
  assert.match(text, /No grant was written and no member was touched/);
  assert.doesNotMatch(text, /A free-year coupon was just redeemed/);
});

test('couponRedemptionNotice: the self-test drops the act-on-it instructions a real notice carries', () => {
  const record = { code: 'SELF-TEST', login: 'nobody', githubId: '0' };
  const { text } = couponRedemptionNotice(record, { selfTest: true });
  // Telling the owner to deactivate a code, in an email about nothing, is how a control gets acted on wrongly.
  assert.doesNotMatch(text, /active: false/);
  assert.doesNotMatch(text, /standing record of every coupon redemption/);
  assert.match(text, /ABSENCE is the signal/, 'must say what a missing self-test means');
});

test('couponRedemptionNotice: the default is a REAL notice, unchanged by the flag existing', () => {
  const record = { code: 'CODEABLEYEAR', login: 'octocat', githubId: '583231', tier: 'member', until: '2027-08-26', redemptionCount: 3 };
  const plain = couponRedemptionNotice(record);
  const explicit = couponRedemptionNotice(record, { selfTest: false });
  assert.deepEqual(plain, explicit, 'omitting the options must equal passing selfTest: false');
  assert.equal(plain.subject, 'Coupon redeemed: CODEABLEYEAR by octocat');
  assert.match(plain.text, /A free-year coupon was just redeemed/);
  assert.match(plain.text, /3 redemptions of this code/);
  assert.doesNotMatch(plain.text, /self-test/i);
});

// --- the html body (2026-08-26) ---------------------------------------------------------------------------
//
// The notice used to leave as plain text only, so an operational alarm read like console output pasted into a
// message. It now also returns `html`, rendered through the shared ops layout. The text body is untouched and
// stays the fallback, so these tests pin the html WITHOUT relaxing anything above: the two bodies must carry
// the same facts, and the html must not become the only place a fact appears.
//
// Escaping is the load-bearing part. A coupon code comes from house/coupons.yml and a login comes from GitHub,
// and this email lands in the mailbox of the one person who can deactivate a code, so a broken-out tag would be
// read by exactly the wrong reader. Mutation check: drop an escapeHtml call in mail-ops.mjs and the escaping
// test goes red.

test('html: the real notice renders every field the text carries, in the same shape', () => {
  const record = {
    code: 'CODEABLEYEAR', campaign: 'CODEABLEYEAR', tier: 'creator',
    until: '2027-08-25T00:00:00.000Z', redeemedAt: '2026-08-25T00:00:00.000Z',
    login: 'octocat', githubId: '12345', redemptionCount: 7,
  };
  const { html } = couponRedemptionNotice(record);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /Coupon redeemed/);
  assert.match(html, /A free-year coupon was just redeemed\./);
  for (const label of ['Code', 'Member', 'Tier', 'Free until', 'Redeemed', 'Total redemptions']) {
    assert.ok(html.includes(`>${label}</td>`), `the ${label} row must render`);
  }
  assert.match(html, /CODEABLEYEAR/);
  assert.match(html, /octocat \(github_id 12345\)/);
  assert.match(html, /creator/);
  assert.match(html, /2027-08-25T00:00:00\.000Z/);
  assert.match(html, /7, including this one/);
  // The act-on-it guidance, which is the whole reason the owner reads this notice.
  assert.match(html, /active: false in house\/coupons\.yml/);
});

test('html: a campaign identical to the code is omitted, exactly as the text omits it', () => {
  const same = couponRedemptionNotice({ code: 'HUDSINVITE', campaign: 'HUDSINVITE', login: 'a', githubId: '1' });
  const other = couponRedemptionNotice({ code: 'HUDSINVITE', campaign: 'summer-drive', login: 'a', githubId: '1' });
  assert.ok(!same.html.includes('>Campaign</td>'), 'a campaign that repeats the code says nothing');
  assert.ok(other.html.includes('>Campaign</td>'));
  assert.match(other.html, /summer-drive/);
});

test('html: an absent redemption count is omitted rather than guessed at, as in the text', () => {
  const { html, text } = couponRedemptionNotice({ code: 'X', login: 'a', githubId: '1' });
  assert.ok(!html.includes('Total redemptions'), 'no count row when no count was supplied');
  assert.ok(!html.includes('including this one'));
  assert.doesNotMatch(text, /Total:/, 'and the text still agrees with it');
});

test('html: every interpolated value is escaped, so an injected value cannot break out', () => {
  const nasty = '<script>alert("x" & \'y\')</script>';
  const { html } = couponRedemptionNotice({
    code: nasty, campaign: `campaign ${nasty}`, tier: nasty, until: nasty,
    redeemedAt: nasty, login: nasty, githubId: nasty, redemptionCount: 2,
  });
  assert.ok(!html.includes('<script>'), 'no live tag may survive into the body');
  assert.ok(!html.includes('alert("x"'), 'the raw quote must not survive either');
  assert.ok(html.includes('&lt;script&gt;'), 'it renders as visible, inert text instead');
  assert.ok(html.includes('&amp;'), 'an ampersand is escaped');
  assert.ok(html.includes('&quot;'), 'a double quote is escaped');
});

test('html: the self-test leads with an unmistakable alert band and drops the act-on-it instructions', () => {
  const record = { code: 'SELF-TEST', login: 'nobody', githubId: '0' };
  const { html } = couponRedemptionNotice(record, { selfTest: true });
  assert.match(html, /Coupon redemption alarm self-test/);
  assert.match(html, /THIS IS NOT A REDEMPTION/);
  assert.match(html, /No grant was written and no member was touched/);
  // The warning is an alert band, not a plain lead: the alert kind is the one with a tinted ground and a thick
  // left edge, so a reader who only glances at the top of the message still cannot mistake it for a redemption.
  const band = html.indexOf('border-left:4px solid');
  assert.ok(band > -1, 'the warning must render as an alert band');
  assert.ok(band < html.indexOf('THIS IS NOT A REDEMPTION') + 400, 'and the warning must be the text inside it');
  assert.ok(!html.includes('A free-year coupon was just redeemed'));
  assert.ok(!html.includes('active: false'), 'never tell the owner to deactivate a code in an email about nothing');
  assert.match(html, /ABSENCE is the signal/);
});

test('html: no em or en dashes anywhere in either variant (writing convention)', () => {
  const record = { code: 'C', campaign: 'D', login: 'a', githubId: '1', tier: 'member', until: 'x', redeemedAt: 'y', redemptionCount: 4 };
  for (const selfTest of [false, true]) {
    assert.ok(!/[–—]/.test(couponRedemptionNotice(record, { selfTest }).html), `variant selfTest=${selfTest}`);
  }
});
