// SOW-029 / SOW-050: the build-time members directory builder behind /members-index.json. Verifies data
// minimization (follow-card fields + the public social links subset for the reader author drawer; still NO
// github_id/email/location) + the github-avatar fallback.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMembersDirectory, bioExcerpt } from '../src/lib/members-directory.mjs';

const P = (data, body) => ({ data, body });

test('emits the minimized fields + the public links subset (no leaked github_id/email/location)', () => {
  const profiles = [
    P({ username: 'alice', displayName: 'Alice', avatar: 'https://gravatar/x', headline: 'Dev', tier: 'paid', location: 'NYC', links: { github: 'https://github.com/aliceGH', discord: 'alice#1', secret: 'nope' } }),
  ];
  const out = buildMembersDirectory(profiles, (login) => `gh://${login}`);
  assert.deepEqual(Object.keys(out[0]).sort(), ['avatar', 'displayName', 'headline', 'links', 'tier', 'username']);
  assert.equal(out[0].avatar, 'https://gravatar/x', 'a gravatar wins over the github fallback');
  assert.ok(!('location' in out[0]), 'location does not leak');
  assert.deepEqual(out[0].links, { github: 'https://github.com/aliceGH', discord: 'alice#1' }, 'only the known link keys (incl. discord) survive; unknown keys dropped');
});

test('omits links entirely when the profile has none (or only blanks/unknown keys)', () => {
  const out = buildMembersDirectory([
    P({ username: 'noL', tier: 'paid' }),
    P({ username: 'blankL', tier: 'paid', links: { discord: '  ', mystery: 'x' } }),
  ]);
  assert.ok(!('links' in out[0]), 'no links object when the profile has no links');
  assert.ok(!('links' in out[1]), 'no links object when only blanks/unknown keys are present');
});

test('falls back to the github avatar (by login) when a profile has no gravatar', () => {
  const out = buildMembersDirectory([
    P({ username: 'bob', tier: 'trial', links: { github: 'bobgh' } }),     // bare handle
    P({ username: 'carol' }),                                              // no link -> login = username
  ], (login) => `gh://${login}`);
  assert.equal(out[0].avatar, 'gh://bobgh');
  assert.equal(out[0].displayName, 'bob', 'displayName falls back to username');
  assert.equal(out[1].avatar, 'gh://carol');
});

test('avatar is null when neither a gravatar nor a fallback resolves', () => {
  const out = buildMembersDirectory([P({ username: 'dave' })]); // default fallback returns undefined
  assert.equal(out[0].avatar, null);
});

// SOW-143: the plain-text bio excerpt + join date for the member detail view.
test('carries a plain-text bio excerpt from the body, omits it when the body is empty', () => {
  const out = buildMembersDirectory([
    P({ username: 'eve', tier: 'paid', joinedAt: new Date('2025-03-01T00:00:00Z') }, '# Hi\n\nI build **things** with [Astro](https://astro.build).'),
    P({ username: 'frank', tier: 'paid' }), // no body
  ]);
  assert.equal(out[0].bio, 'Hi I build things with Astro.', 'markdown markers stripped, link unwrapped to its label');
  assert.equal(out[0].joinedAt, '2025-03-01T00:00:00.000Z');
  assert.ok(!('bio' in out[1]), 'bio omitted (not null) when the profile has no body');
  assert.ok(!('joinedAt' in out[1]), 'joinedAt omitted when unset');
});

test('bioExcerpt strips ALL HTML (no XSS carried into the extension)', () => {
  const out = bioExcerpt('Hello <img src=x onerror=alert(1)> <script>alert(2)</script> world');
  assert.equal(out.includes('<'), false, 'no angle brackets survive');
  assert.equal(out.includes('onerror'), false, 'the tag (with its onerror handler) is removed whole');
  assert.match(out, /Hello .*world/);
  // an UNCLOSED / malformed tag must not leave a stray angle bracket in the public JSON either
  for (const payload of ['<img src=x onerror=1', 'a < b > c', '<<script>x</script>']) {
    const o = bioExcerpt(payload) || '';
    assert.equal(o.includes('<'), false, `no '<' from ${JSON.stringify(payload)}`);
    assert.equal(o.includes('>'), false, `no '>' from ${JSON.stringify(payload)}`);
  }
});

test('bioExcerpt truncates on a word boundary with an ellipsis, returns undefined for empty', () => {
  const long = 'word '.repeat(100).trim();
  const out = bioExcerpt(long, 40);
  assert.ok(out.length <= 41, 'within max + ellipsis');
  assert.ok(out.endsWith('…'));
  assert.equal(out.includes('  '), false, 'no collapsed double spaces');
  assert.equal(bioExcerpt('   \n  '), undefined);
  assert.equal(bioExcerpt(''), undefined);
  assert.equal(bioExcerpt(null), undefined);
});
