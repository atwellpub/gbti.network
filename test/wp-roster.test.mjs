// SOW-166: reading the legacy WordPress dump for the addresses the live system does not have. No network,
// and NO REAL ADDRESS: every fixture here is a synthetic example.test one, because a test fixture is a
// committed file and this module exists precisely to keep real addresses out of committed files.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  valuesBlobs, parseTuples, normalizeGithubLogin, githubEmailIndex, addressAvailability,
} from '../scripts/lib/wp-roster.mjs';

// A miniature dump in the real shape: the wp_users columns the parser indexes by position, and usermeta
// rows carrying social_github among other keys it must ignore.
const DUMP = [
  "INSERT INTO `wp_users` VALUES (1,'alice','hash','alice','alice@example.test','','2020-01-01','',0,'Alice'),",
  "(2,'bob','hash','bob','bob@example.test','','2020-01-01','',0,'Bob'),",
  "(3,'carol','hash','carol','','','2020-01-01','',0,'Carol');",
  "INSERT INTO `wp_usermeta` VALUES (10,1,'social_github','https://github.com/AliceDev'),",
  "(11,1,'description','I write things; sometimes with semicolons.'),",
  "(12,2,'social_github','bob-codes'),",
  "(13,3,'social_github','https://github.com/carol'),",
  "(14,2,'social_x','https://x.com/bob');",
].join('\n');

test('a quoted semicolon inside a bio does not truncate the statement', () => {
  // The bio at meta id 11 contains a ';'. Splitting on it would drop meta rows 12 to 14, silently losing
  // every member after the first, and the run would report a smaller roster rather than an error.
  const blobs = valuesBlobs(DUMP, 'wp_usermeta');
  assert.equal(blobs.length, 1);
  const rows = parseTuples(blobs[0]);
  assert.equal(rows.length, 5, 'all five meta rows survive the semicolon in row 11');
  assert.equal(rows[4][2], 'social_x');
});

test('a github login is read from a profile URL or a bare value, and always lowercased', () => {
  assert.equal(normalizeGithubLogin('https://github.com/AliceDev'), 'alicedev');
  assert.equal(normalizeGithubLogin('http://www.github.com/Bob/'), 'bob');
  assert.equal(normalizeGithubLogin('bob-codes'), 'bob-codes');
  assert.equal(normalizeGithubLogin('@Bob'), 'bob');
  assert.equal(normalizeGithubLogin(''), null);
  assert.equal(normalizeGithubLogin(null), null);
  assert.equal(normalizeGithubLogin('not a login'), null);
});

test('CASE IS NOT ALLOWED TO COST SOMEBODY THEIR PLACE IN THE JOIN', () => {
  // The real dump holds `Eyesandnose` and `MattBissett` against ids recorded lowercase. Github logins are
  // case-insensitive, so a case-sensitive match would drop those members into the unreachable list for a
  // reason that is not real, and the report would name them as people somebody has to go and ask.
  const index = githubEmailIndex(DUMP);
  assert.equal(index.get('alicedev'), 'alice@example.test');
  assert.equal(index.has('AliceDev'), false, 'the index is keyed lowercase, so callers must lowercase too');
});

test('a user with no address recorded is absent from the index rather than present with an empty one', () => {
  const index = githubEmailIndex(DUMP);
  assert.equal(index.has('carol'), false);
  assert.deepEqual([...index.keys()].sort(), ['alicedev', 'bob-codes']);
});

test('availability reports WHICH members have an address and never what it is', () => {
  const index = githubEmailIndex(DUMP);
  const members = [
    { githubId: '1', githubLogin: 'AliceDev' },
    { githubId: '2', username: 'bob-codes' },
    { githubId: '3', githubLogin: 'carol' },
    { githubId: '4', githubLogin: 'stranger' },
  ];
  const have = addressAvailability(index, members);
  assert.deepEqual([...have].sort(), ['1', '2'], 'the login is matched case-insensitively, and username falls back for it');

  // The structural claim: this is a Set of ids. There is no shape it could return an address in, so every
  // planning, counting and reporting path downstream is incapable of holding one even by mistake.
  assert.ok(have instanceof Set);
  const serialized = JSON.stringify([...have]);
  assert.ok(!serialized.includes('@'), 'nothing address-shaped survives into the availability result');
});

test('two WordPress accounts sharing one github profile resolve to the FIRST, not the last', () => {
  // A real hazard rather than a hypothetical: somebody who registered twice over the years leaves two rows
  // pointing at one github profile. Whichever wins decides which address the digest is sent to, so it has
  // to be decided rather than left to iteration order. First wins, because the earlier registration is the
  // account the membership is attached to.
  const dup = [
    "INSERT INTO `wp_users` VALUES (1,'first','h','first','first@example.test','','2020-01-01','',0,'First'),",
    "(2,'second','h','second','second@example.test','','2024-01-01','',0,'Second');",
    "INSERT INTO `wp_usermeta` VALUES (10,1,'social_github','https://github.com/dave'),",
    "(11,2,'social_github','https://github.com/Dave');",
  ].join('\n');
  assert.equal(githubEmailIndex(dup).get('dave'), 'first@example.test');
});
