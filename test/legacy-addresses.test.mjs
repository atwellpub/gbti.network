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
