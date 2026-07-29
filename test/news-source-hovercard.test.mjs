// SOW-067 P2: the pure helpers behind the news-channel hover card + the author-card social icons.
// domainOf derives a www-stripped display domain from a source's feed/site URL; socialIcon inlines a brand
// SVG by platform key. No DOM (the element modules guard customElements for node).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { domainOf } from '../client-ui/src/elements/gbti-news.mjs';
import { socialIcon, SOCIAL_ICON_PATHS } from '../client-ui/src/social-icons.mjs';

test('domainOf: a feed URL -> its host, www-stripped', () => {
  assert.equal(domainOf('https://www.bleepingcomputer.com/feed/'), 'bleepingcomputer.com');
  assert.equal(domainOf('https://thenextweb.com/feed/'), 'thenextweb.com');
  assert.equal(domainOf('http://unit42.paloaltonetworks.com/feed/'), 'unit42.paloaltonetworks.com');
});

test('domainOf: a bare host (no scheme) still resolves, www-stripped', () => {
  assert.equal(domainOf('www.darkreading.com'), 'darkreading.com');
  assert.equal(domainOf('orca.security/feed/'), 'orca.security');
});

test('domainOf: empty / nullish -> empty string', () => {
  assert.equal(domainOf(''), '');
  assert.equal(domainOf(null), '');
  assert.equal(domainOf(undefined), '');
});

test('socialIcon: a known platform -> an inline 24x24 currentColor SVG carrying that path', () => {
  for (const key of Object.keys(SOCIAL_ICON_PATHS)) {
    const svg = socialIcon(key);
    assert.match(svg, /^<svg /, `${key} renders an svg`);
    assert.match(svg, /viewBox="0 0 24 24"/);
    assert.match(svg, /fill="currentColor"/);
    assert.ok(svg.includes(SOCIAL_ICON_PATHS[key]), `${key} embeds its path`);
  }
});

test('socialIcon: case-insensitive key, custom size, and empty for an unknown platform', () => {
  assert.equal(socialIcon('GitHub'), socialIcon('github'));
  assert.match(socialIcon('x', 18), /width="18" height="18"/);
  assert.equal(socialIcon('myspace'), '');
  assert.equal(socialIcon(''), '');
  assert.equal(socialIcon(null), '');
});

test('socialIcon: covers every author-card SOCIALS key (github/website/x/bluesky/youtube/devto/reddit/linkedin) + discord', () => {
  // sow-159: mastodon retired (removed from the social-icon system).
  for (const key of ['github', 'website', 'x', 'bluesky', 'youtube', 'devto', 'reddit', 'linkedin', 'discord']) {
    assert.notEqual(socialIcon(key), '', `${key} has an icon`);
  }
});
