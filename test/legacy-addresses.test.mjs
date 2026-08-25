// sow-166 follow-up: the legacy-address resolver. The dump it reads is gitignored and local-only, so every
// rule is tested against a tiny synthetic dump here rather than against the real 87MB file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, parseLegacyUsers, matchLegacyAddresses } from '../scripts/lib/legacy-addresses.mjs';

// A miniature wp_users INSERT with the real column positions: ID, login, pass, nicename, email, url,
// registered, activation_key, status, display_name.
const SQL = [
  "INSERT INTO `wp_users` VALUES ",
  "(1,'andrija-naglic','x','andrija-naglic','andrija@example.com','','2020-01-01','',0,'Andrija Naglic'),",
  "(2,'bomsn','x','bomsn','ali@example.fr','','2020-01-01','',0,'Ali Khallad'),",
  "(3,'notcomped','x','notcomped','stranger@example.com','','2020-01-01','',0,'Some Stranger'),",
  "(4,'noaddress','x','noaddress','','','2020-01-01','',0,'No Address'),",
  "(5,'dispname','x','dispname','disp@example.com','','2020-01-01','',0,'Giulio Daprela');",
].join('');

test('parseLegacyUsers reads the wp_users columns by position and drops a non-address', () => {
  const users = parseLegacyUsers(SQL);
  assert.equal(users.length, 5);
  const byLogin = Object.fromEntries(users.map((u) => [u.login, u]));
  assert.equal(byLogin['andrija-naglic'].email, 'andrija@example.com');
  assert.equal(byLogin['andrija-naglic'].display, 'Andrija Naglic');
  assert.equal(byLogin.noaddress.email, null, 'an empty user_email is null, not an empty string');
});

test('normalizeName folds case and punctuation so a login bridges to a display name', () => {
  assert.equal(normalizeName('andrija-naglic'), normalizeName('Andrija Naglic'));
  assert.equal(normalizeName('  Bom_SN '), 'bomsn');
  assert.equal(normalizeName(null), '');
});

test('matchLegacyAddresses resolves only members inside the allow-set', () => {
  const users = parseLegacyUsers(SQL);
  const { matched, unmatched } = matchLegacyAddresses(users, [
    { githubId: '3306507', login: 'andrija-naglic' },
    { githubId: '6953730', login: 'bomsn' },
  ]);
  assert.equal(matched.length, 2);
  assert.deepEqual(matched.map((m) => m.email).sort(), ['ali@example.fr', 'andrija@example.com']);
  assert.deepEqual(unmatched, []);
});

// THE LOAD-BEARING TEST. The dump holds ~50 people who were never comped, and the owner's decision was the
// 15 comped members only. If this ever passes, the resolver has become a general address book.
test('a legacy account OUTSIDE the allow-set is unreachable, whatever it is asked', () => {
  const users = parseLegacyUsers(SQL);
  const { matched } = matchLegacyAddresses(users, [{ githubId: '1', login: 'andrija-naglic' }]);
  const emails = matched.map((m) => m.email);
  assert.ok(!emails.includes('stranger@example.com'), 'a non-comped account leaked into the result');
  assert.equal(matched.length, 1, 'exactly the one allowed member, never the rest of the table');
  // And an empty allow-set resolves nobody, rather than defaulting to everybody.
  assert.deepEqual(matchLegacyAddresses(users, []).matched, [], 'an empty allow-set must mean nobody');
});

test('a member with no legacy account is reported unmatched, never guessed at', () => {
  const { matched, unmatched } = matchLegacyAddresses(parseLegacyUsers(SQL), [
    { githubId: '9', login: 'elsonponte' },
  ]);
  assert.deepEqual(matched, []);
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0].reason, /no legacy account/);
});

test('an account with no address is not a match, even when the name matches exactly', () => {
  const { matched, unmatched } = matchLegacyAddresses(parseLegacyUsers(SQL), [
    { githubId: '9', login: 'noaddress' },
  ]);
  assert.deepEqual(matched, [], 'a nameless-address row must not resolve');
  assert.equal(unmatched.length, 1);
});

test('a display-name match works, and reports WHICH field matched', () => {
  const { matched } = matchLegacyAddresses(parseLegacyUsers(SQL), [{ githubId: '6268698', login: 'daprela' }]);
  // 'daprela' does not fold to 'giuliodaprela', so this is correctly a MISS rather than a loose hit.
  assert.deepEqual(matched, [], 'partial containment is not a match; folding is exact');
  const exact = matchLegacyAddresses(parseLegacyUsers(SQL), [{ githubId: '1', login: 'Giulio Daprela' }]);
  assert.equal(exact.matched.length, 1);
  assert.equal(exact.matched[0].matchedOn, 'display');
  assert.equal(exact.matched[0].email, 'disp@example.com');
});

test('one legacy account cannot be claimed by two members', () => {
  const { matched, unmatched } = matchLegacyAddresses(parseLegacyUsers(SQL), [
    { githubId: '1', login: 'bomsn' },
    { githubId: '2', login: 'Ali Khallad' }, // folds to the same legacy row
  ]);
  assert.equal(matched.length, 1, 'the second claimant must not receive the first one address');
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0].reason, /already claimed/);
});

test('an incomplete allow-set entry resolves nothing rather than matching loosely', () => {
  const users = parseLegacyUsers(SQL);
  assert.deepEqual(matchLegacyAddresses(users, [{ githubId: '1' }]).matched, []);
  assert.deepEqual(matchLegacyAddresses(users, [{ login: 'bomsn' }]).matched, []);
});

// ---------------------------------------------------------------------------------------------------------
// MAIL_ENROLL_EXTRA: owner-supplied addresses for grandfathered members the dump cannot reach.
//
// The rules under test are containment rules, not conveniences. Five of the twenty grandfathered members have
// no legacy account, so the seam exists; what it must never become is a way to mail somebody outside the
// allow-set the owner approved, or a way to quietly replace a corroborated address with a typed one.
import { applySuppliedAddresses } from '../scripts/lib/legacy-addresses.mjs';

const ALLOWED = [
  { githubId: '1', login: 'andrija-naglic' },
  { githubId: '2', login: 'elsonponte' },
  { githubId: '3', login: 'rafael-minuesa' },
];
const MATCHED = [{ githubId: '1', login: 'andrija-naglic', email: 'andrija@example.com', matchedOn: 'login' }];
const UNMATCHED = [
  { githubId: '2', login: 'elsonponte', reason: 'no legacy account with this name' },
  { githubId: '3', login: 'rafael-minuesa', reason: 'no legacy account with this name' },
];

test('applySuppliedAddresses resolves an unreachable member from a supplied pair', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonponte=e@example.com');
  assert.equal(r.matched.length, 2);
  assert.equal(r.unmatched.length, 1);
  assert.equal(r.supplied.length, 1);
  const added = r.matched.find((m) => m.login === 'elsonponte');
  assert.equal(added.email, 'e@example.com');
  assert.equal(added.githubId, '2', 'the github id comes from the allow-set, never from the input');
  assert.equal(added.matchedOn, 'owner-supplied');
});

test('applySuppliedAddresses takes several pairs, comma or whitespace separated', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonponte=e@example.com, rafael-minuesa=r@example.com');
  assert.equal(r.supplied.length, 2);
  assert.equal(r.unmatched.length, 0);
  const ws = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonponte=e@example.com  rafael-minuesa=r@example.com');
  assert.equal(ws.supplied.length, 2);
});

// THE CONTAINMENT TEST. This is the one that matters: the env var must not widen the scope the owner set.
test('applySuppliedAddresses REJECTS a login outside the grandfathered allow-set', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'stranger=s@example.com');
  assert.equal(r.supplied.length, 0);
  assert.equal(r.matched.length, 1, 'nobody outside the allow-set is added');
  assert.equal(r.rejected.length, 1);
  assert.match(r.rejected[0].reason, /allow-set/);
});

test('a rejected pair is REPORTED, not silently dropped', () => {
  // A typo that vanished quietly would look identical to a successful enrolment of the person meant.
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonpont=e@example.com');
  assert.equal(r.supplied.length, 0);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.rejected[0].pair, 'elsonpont');
});

test('applySuppliedAddresses never OVERRIDES an address resolved from the dump', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'andrija-naglic=typo@example.com');
  assert.equal(r.supplied.length, 0);
  assert.equal(r.matched.find((m) => m.login === 'andrija-naglic').email, 'andrija@example.com');
  assert.match(r.rejected[0].reason, /not overridden/);
});

test('applySuppliedAddresses rejects a malformed pair and a pair with no address', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonponte,rafael-minuesa=notanaddress');
  assert.equal(r.supplied.length, 0);
  assert.equal(r.rejected.length, 2);
});

test('applySuppliedAddresses is inert when the variable is unset or empty', () => {
  for (const raw of [undefined, '', '   ']) {
    const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, raw);
    assert.equal(r.matched.length, 1);
    assert.equal(r.unmatched.length, 2);
    assert.equal(r.supplied.length, 0);
    assert.equal(r.rejected.length, 0);
  }
});

test('applySuppliedAddresses ignores a login named twice rather than enrolling it twice', () => {
  const r = applySuppliedAddresses(MATCHED, UNMATCHED, ALLOWED, 'elsonponte=a@example.com,elsonponte=b@example.com');
  assert.equal(r.supplied.length, 1);
  assert.equal(r.supplied[0].email, 'a@example.com');
  assert.equal(r.rejected.length, 1);
});
