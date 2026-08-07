// sow-180: member SHARES syndicate about the CONTENT, not the member. This guard proves NO share-family
// template, in EITHER home, credits a member: the bundled defaults (membership/syndication-config-core.mjs) and
// the owner overrides (house/syndication-config.yml, the home that WINS in production). A share is somebody
// else's link, so a "{fullName} shared" or "{memberdiscord}" token would rebroadcast the member's handle for
// content they did not create. This stops an admin-card edit or a newly enabled channel from silently
// regressing the fix. Reads one committed repo file, deterministic and offline (no network, no secrets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { DEFAULT_TEMPLATES, DEFAULT_STUB_TEMPLATES, DEFAULT_CHANNEL_STUB_TEMPLATES } from '../membership/syndication-config.mjs';

// Any token that resolves to the sharing member: {memberdiscord}, {member-*-handle}, {member-url}, {fullName},
// and {author} (exact, so it does not catch {author-note-block}). The renderer's fallback chain
// (syndication-format.mjs) resolves an EMPTY member token back to the full name, so the token must be ABSENT,
// not blanked.
const MEMBER_TOKEN_RE = /\{member[^}]*\}|\{fullName\}|\{author\}/;

test('sow-180: no share-family DEFAULT template credits a member', () => {
  const entries = [
    ['DEFAULT_TEMPLATES.share', DEFAULT_TEMPLATES.share],
    ['DEFAULT_STUB_TEMPLATES.share', DEFAULT_STUB_TEMPLATES.share],
    ...Object.entries(DEFAULT_CHANNEL_STUB_TEMPLATES).map(([ch, set]) => [`DEFAULT_CHANNEL_STUB_TEMPLATES.${ch}.share`, set.share]),
  ];
  for (const [name, tpl] of entries) {
    assert.equal(typeof tpl, 'string', `${name} should be a string`);
    assert.ok(!MEMBER_TOKEN_RE.test(tpl), `${name} must not credit a member -> ${tpl}`);
  }
});

test('sow-180: no share template in house/syndication-config.yml credits a member', () => {
  const cfg = yaml.load(fs.readFileSync(new URL('../house/syndication-config.yml', import.meta.url), 'utf8'));
  const syn = cfg?.syndication ?? {};
  const shares = [];
  if (syn.templates && typeof syn.templates.share === 'string') shares.push(['templates.share', syn.templates.share]);
  for (const [ch, set] of Object.entries(syn.channel_templates ?? {})) {
    if (set && typeof set.share === 'string') shares.push([`channel_templates.${ch}.share`, set.share]);
  }
  assert.ok(shares.length > 0, 'expected at least one share template in the house config (guard would be vacuous otherwise)');
  for (const [name, tpl] of shares) {
    assert.ok(!MEMBER_TOKEN_RE.test(tpl), `house ${name} must not credit a member -> ${tpl}`);
  }
});

test('sow-180: post/product/prompt author credit is PRESERVED (the fix is share-only)', () => {
  // The member's OWN work still credits them (it feeds the SOW-059 attribution story); only SHARE templates
  // drop the name. This asserts the shared DEFAULT_FORMAT/STUB_FORMAT split did not strip the wrong family.
  assert.ok(/\{member-discord-username\}/.test(DEFAULT_TEMPLATES.post), 'post default should still credit the author');
  assert.ok(/\{fullName\}/.test(DEFAULT_STUB_TEMPLATES.post), 'post stub should still credit the author');
});
