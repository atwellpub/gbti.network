// SOW-129: the pure per-platform URL builder used by the profile social-links repeater. It must produce a value
// that satisfies BOTH the public profile render (which needs a full https:// URL) and syndication (which reads the
// handle). Pure + node-importable (no DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSocialUrl, SOCIAL_KEYS, SOCIAL_LABELS } from '../client-ui/src/social-icons.mjs';

test('buildSocialUrl passes an existing http(s) URL through unchanged', () => {
  assert.equal(buildSocialUrl('x', 'https://x.com/foo'), 'https://x.com/foo');
  assert.equal(buildSocialUrl('github', 'http://github.com/bar'), 'http://github.com/bar');
});

test('buildSocialUrl builds a full URL from a bare handle (leading @ stripped)', () => {
  assert.equal(buildSocialUrl('x', '@jane'), 'https://x.com/jane');
  assert.equal(buildSocialUrl('github', 'jane'), 'https://github.com/jane');
  assert.equal(buildSocialUrl('instagram', '@jane'), 'https://www.instagram.com/jane');
  assert.equal(buildSocialUrl('tiktok', 'jane'), 'https://www.tiktok.com/@jane');
  assert.equal(buildSocialUrl('bluesky', 'jane.bsky.social'), 'https://bsky.app/profile/jane.bsky.social');
});

// sow-159: Mastodon retired; buildSocialUrl no longer resolves a mastodon user@instance (the branch + the
// key were removed). The adapter + syndication plumbing stay on disk; the social-icon entry does not.

test('buildSocialUrl coerces a bare website host to https', () => {
  assert.equal(buildSocialUrl('website', 'example.com'), 'https://example.com');
  assert.equal(buildSocialUrl('website', 'https://example.com'), 'https://example.com');
});

test('buildSocialUrl keeps a Discord handle raw (not reliably linkable)', () => {
  assert.equal(buildSocialUrl('discord', 'jane_doe'), 'jane_doe');
});

test('buildSocialUrl returns empty for empty/blank/nullish input', () => {
  assert.equal(buildSocialUrl('x', ''), '');
  assert.equal(buildSocialUrl('x', '   '), '');
  assert.equal(buildSocialUrl('x', null), '');
  assert.equal(buildSocialUrl('x', undefined), '');
});

test('SOCIAL_KEYS + SOCIAL_LABELS cover the comprehensive set', () => {
  const want = ['github', 'website', 'x', 'bluesky', 'linkedin', 'youtube', 'discord', 'reddit', 'devto', 'instagram', 'threads', 'tiktok', 'twitch', 'facebook', 'dailydev', 'producthunt', 'rumble'];
  for (const k of want) {
    assert.ok(SOCIAL_KEYS.includes(k), `SOCIAL_KEYS missing ${k}`);
    assert.ok(SOCIAL_LABELS[k], `SOCIAL_LABELS missing ${k}`);
  }
});
