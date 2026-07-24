// SOW-058: the pure message formatter. Sanitization, truncation, URL preservation, no body leak.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChannelText, sanitizeMentions, hostOf, renderTemplate, renderBodyTemplate, defaultSyndicationCover, recordDestinations, xHandleFrom, toHashtag, blueskyHandleFrom, mastodonHandleFrom, redditHandleFrom, devtoHandleFrom } from '../membership/syndication-format.mjs';

// SOW-138: the full-body crosspost body renderer. {body} is spliced VERBATIM (never sanitized/truncated); the
// wrapper renders like a normal template.
test('renderBodyTemplate: {body} is verbatim; the wrapper renders; a raw body is not mangled', () => {
  const item = { title: 'T', author: 'atwellpub', source: 'prompt', url: 'https://gbti.network/x' };
  const body = 'A line with @astrojs/mdx and    doubled spaces.\n\n```js\nconst a = 1;\n```\n\nEmail foo@bar.com';
  // default {body} and an empty template both return the raw body untouched
  assert.equal(renderBodyTemplate('{body}', item, body), body);
  assert.equal(renderBodyTemplate('', item, body), body);
  // the raw body keeps its code fence, npm scope, doubled spaces, and email (no sanitize/collapse)
  assert.ok(renderBodyTemplate('{body}', item, body).includes('const a = 1;'));
  assert.ok(renderBodyTemplate('{body}', item, body).includes('@astrojs/mdx'));
  assert.ok(renderBodyTemplate('{body}', item, body).includes('foo@bar.com'));
  // a wrapper renders its tokens and keeps the body verbatim with its separators
  const w = renderBodyTemplate('Note on {title}.\n\n{body}\n\nEnd.', item, body);
  assert.ok(w.startsWith('Note on T.'));
  assert.ok(w.includes(body));
  assert.ok(w.endsWith('End.'));
  // a template with no {body} is a fully custom body (the article is omitted)
  const c = renderBodyTemplate('Summary of {title}. Read: {url}', item, body);
  assert.equal(c, 'Summary of T. Read: https://gbti.network/x');
});

// SOW-139: the per-type default crosspost cover (mirrors src/lib/feature-image.ts TYPE_TO_FEATURE).
test('defaultSyndicationCover maps each content type to its branded feature card', () => {
  assert.equal(defaultSyndicationCover('post'), 'https://gbti.network/brand/feature/feature-article.png');
  assert.equal(defaultSyndicationCover('product'), 'https://gbti.network/brand/feature/feature-product.png');
  assert.equal(defaultSyndicationCover('prompt'), 'https://gbti.network/brand/feature/feature-prompt.png');
  assert.equal(defaultSyndicationCover('share'), 'https://gbti.network/brand/feature/feature-share.png');
  assert.equal(defaultSyndicationCover('unknown'), 'https://gbti.network/brand/feature/feature-article.png', 'unknown falls back to the article banner');
});

// Manual-syndicate history fix: a drain record stores channels under `perChannel`; reading only `channels`
// collapsed every drained item to a bogus 'discord' attribution.
test('recordDestinations reads perChannel (drain) AND channels (popup), skips off/failed, discord only for legacy', () => {
  const set = (rec) => [...recordDestinations(rec)].sort();
  // DRAIN record: channels live under perChannel; a skipped/off/failed channel is NOT a destination.
  assert.deepEqual(set({ perChannel: {
    'discord:123': { status: 'sent' },
    devto: { status: 'sent' },
    linkedin: { status: 'queued-manual' },
    x: { status: 'skipped', reason: 'auto-off' },
    bluesky: { status: 'failed' },
  } }), ['devto', 'discord', 'linkedin']);
  // MANUAL-popup record: channels under `channels`; a discord-forward normalizes to discord.
  assert.deepEqual(set({ channels: { linkedin: { status: 'sent' } } }), ['linkedin']);
  assert.deepEqual(set({ channels: { 'discord:1': { status: 'sent' }, 'discord-forward:2': { status: 'sent' } } }), ['discord']);
  // An item that only SKIPPED everything reached nothing (no false discord).
  assert.deepEqual(set({ perChannel: { x: { status: 'skipped' }, linkedin: { status: 'skipped' } } }), []);
  // A truly-legacy record with no channel map at all keeps the Discord fallback; `destination` wins first.
  assert.deepEqual(set({}), ['discord']);
  assert.deepEqual(set({ destination: 'reddit' }), ['reddit']);
});

// LinkedIn/Mastodon multi-line templates authored in YAML folded scalars store literal `\n` (2 chars); the
// renderer must turn those into real newlines so the post breaks into paragraphs instead of showing "\n\n".
test('renderTemplate converts literal \\n to newlines, collapses 3+, and leaves single-line templates alone', () => {
  assert.equal(renderTemplate('a\\n\\nb', {}), 'a\n\nb'); // literal backslash-n -> real newline
  assert.equal(renderTemplate('a\n\nb', {}), 'a\n\nb'); // real newlines are preserved
  // an empty token (a note-less item) does not leave a big gap: 3+ newlines collapse to a blank line
  assert.equal(renderTemplate('a\\n\\n{author-note}\\n\\nb', {}), 'a\n\nb');
  // a single-line template (Discord/X) is untouched
  assert.equal(renderTemplate('New {content-type}: "{title}" {url}', { source: 'post', title: 'T', url: 'u' }), 'New article: "T" u');
  // the LinkedIn shape renders the {author-note-block} with real breaks
  const TMPL = 'New {content-type} by {fullName}: "{title}"\\n\\n{short-description}\\n\\n{url}{author-note-block}\\n\\n{hashtags}';
  const li = renderTemplate(TMPL, { source: 'prompt', authorName: 'Hudson Atwell', title: 'Resp Audit', blurb: 'Drive Claude Code.', url: 'https://gbti.network/x/', authorNote: 'I wrote this.', category: 'DevOps', tags: ['prompts'] });
  assert.ok(li.includes('\n\nFrom the author:\n\n"I wrote this."'), 'the author note posts as its own block');
  assert.ok(!/\\n/.test(li), 'no literal backslash-n survives');
  assert.match(li, /#DevOps #prompts$/);
  // a NOTE-LESS item shows NO dangling "From the author:" label
  const noNote = renderTemplate(TMPL, { source: 'post', authorName: 'A', title: 'T', blurb: 'B', url: 'https://gbti.network/y/', category: 'AI', tags: [] });
  assert.ok(!noNote.includes('From the author'), 'no dangling label when the item has no note');
  assert.ok(noNote.includes('https://gbti.network/y/\n\n#AI'), 'the url flows straight into the hashtags');
});

test('sanitizeMentions neutralizes @mentions and Discord mass-ping tokens', () => {
  assert.ok(!/@everyone/.test(sanitizeMentions('hey @everyone')));
  assert.ok(!/@here/.test(sanitizeMentions('@here look')));
  assert.ok(!/<@\d+>/.test(sanitizeMentions('ping <@123456>')));
  // a normal @handle gets a zero-width space inserted so it does not resolve to a real mention
  const s = sanitizeMentions('thanks @alice');
  assert.ok(s.includes('@​'));
});

test('buildChannelText composes a lead + headline + blurb + url and carries NO body', () => {
  const item = { source: 'share', author: 'alice', title: 'Great read', blurb: 'why', url: 'https://ex.com/a' };
  const text = buildChannelText(item, { limit: 280 });
  assert.match(text, /shared by @​?alice/);
  assert.match(text, /Great read/);
  assert.match(text, /why/);
  assert.match(text, /https:\/\/ex\.com\/a/);
  assert.ok(!text.toLowerCase().includes('body'));
});

test('buildChannelText keeps the URL intact when truncating to a tight limit', () => {
  const item = { source: 'post', author: 'bob', title: 'A'.repeat(400), blurb: 'B'.repeat(400), url: 'https://ex.com/keep' };
  const text = buildChannelText(item, { limit: 100 });
  assert.ok(text.length <= 100, `expected <=100, got ${text.length}`);
  assert.ok(text.endsWith('https://ex.com/keep'), 'the URL survives truncation');
});

test('hostOf strips www and tolerates garbage', () => {
  assert.equal(hostOf('https://www.example.com/x'), 'example.com');
  assert.equal(hostOf('not a url'), '');
});

// ---- SOW-087: the configurable Discord template ----

const T = 'Shared by {memberdiscord} {shareurl}';

test('renderTemplate: a resolved mention pings; no mention falls back to the no-ping full name', () => {
  const withMention = renderTemplate(T, { mention: '<@123>', authorName: 'Alice Q', url: 'https://ex.com/a' });
  assert.equal(withMention, 'Shared by <@123> https://ex.com/a');
  const noMention = renderTemplate(T, { mention: '@alice', authorName: 'Alice Q', url: 'https://ex.com/a' });
  assert.ok(noMention.startsWith('Shared by Alice Q'));
  assert.ok(!noMention.includes('<@')); // no ping token
  const noName = renderTemplate(T, { author: 'alice', url: 'https://ex.com/a' });
  assert.ok(noName.includes('alice')); // @login text fallback (zero-width-space neutralized)
});

// SOW-143 follow-up: a PREVIEW-only placeholder for the Discord <@id> mention (which resolves server-side, so a
// browser preview cannot show it and would otherwise fall back to the name and read like a bug).
test('renderTemplate: previewMention placeholder stands in for the mention tokens when there is no real mention', () => {
  const P = '[you will be @mentioned on Discord]';
  // No real mention -> the placeholder fills both {memberdiscord} and {member-discord-username}.
  assert.equal(renderTemplate(T, { authorName: 'Alice Q', url: 'https://ex.com/a' }, { previewMention: P }),
    `Shared by ${P} https://ex.com/a`);
  assert.match(renderTemplate('by {member-discord-username}', { author: 'alice', authorDiscord: 'ahandle' }, { previewMention: P }),
    /by \[you will be @mentioned on Discord\]/);
  // A REAL resolved mention still wins over the placeholder (never overridden).
  assert.equal(renderTemplate(T, { mention: '<@123>', url: 'https://ex.com/a' }, { previewMention: P }),
    'Shared by <@123> https://ex.com/a');
  // No previewMention passed (the server render path) -> unchanged name fallback, no placeholder leak.
  const noPreview = renderTemplate(T, { authorName: 'Alice Q', url: 'https://ex.com/a' });
  assert.ok(noPreview.startsWith('Shared by Alice Q'));
  assert.ok(!noPreview.includes('@mentioned'));
});

test('renderTemplate sanitizes every author-controlled variable (never a mass mention)', () => {
  const out = renderTemplate('{title} {fullName} {category}', {
    title: '@everyone free stuff <@&999>',
    authorName: '@here Bob',
    category: 'devops',
  });
  assert.ok(!out.includes('@everyone'));
  assert.ok(!out.includes('@here'));
  assert.ok(!out.includes('<@&999>'));
  assert.ok(out.includes('devops'));
  // a forged mention token in authorName is stripped, not passed through as {memberdiscord}
  const forged = renderTemplate(T, { authorName: '<@666>', url: 'https://x.y' });
  assert.ok(!forged.includes('<@666>'));
});

test('renderTemplate: unknown tokens render empty, case-insensitive names, truncation applies', () => {
  assert.equal(renderTemplate('A {nope} B', {}), 'A B');
  // Intended change (SOW-088, owner-directed): an ALL-CAPS token now UPPERCASES its value; mixed case
  // still resolves case-insensitively without shifting.
  assert.equal(renderTemplate('{TITLE}!', { title: 'Hi' }), 'HI!');
  assert.equal(renderTemplate('{Title}!', { title: 'Hi' }), 'Hi!');
  const long = renderTemplate('{title}', { title: 'x'.repeat(50) }, { limit: 10 });
  assert.equal(long.length, 10);
});

// SOW-088: the new default-format tokens. {content-type} renders the type label; {member-discord-username}
// prefers the resolved mention, then the public profile Discord handle, then the GitHub username.
test('renderTemplate: hyphenated tokens, {content-type}, and the {member-discord-username} fallback chain', () => {
  const T2 = 'New {content-type} published by {member-discord-username}: "{title}" {url}';
  const base = { source: 'prompt', title: 'CI Skill', url: 'https://x.dev/p' };
  // Mention wins.
  assert.equal(renderTemplate(T2, { ...base, mention: '<@42>', authorDiscord: 'huds', author: 'atwellpub' }),
    'New prompt published by <@42>: "CI Skill" https://x.dev/p');
  // Profile Discord handle next (sanitized: the @ gets the zero-width guard on social channels).
  const withHandle = renderTemplate(T2, { ...base, authorDiscord: 'hudsdiscord', author: 'atwellpub' });
  assert.match(withHandle, /published by @.?hudsdiscord:/);
  // GitHub username last, @-prefixed like the handle path (the sanitizer's zero-width guard may follow the @).
  const ghOnly = renderTemplate(T2, { ...base, author: 'atwellpub' });
  assert.match(ghOnly, /published by @.?atwellpub:/);
  // A profile discord INVITE URL is not a username: it falls through to the GitHub fallback (hit live).
  const urlHandle = renderTemplate(T2, { ...base, authorDiscord: 'https://discord.gg/EwmcKcJZC6', author: 'atwellpub' });
  assert.match(urlHandle, /published by @.?atwellpub:/);
  assert.ok(!urlHandle.includes('discord.gg'), 'an invite URL never renders as the username');
  // {content-type} labels per source.
  assert.match(renderTemplate('{content-type}', { source: 'post' }), /^article$/);
  assert.match(renderTemplate('{content-type}', { source: 'share' }), /^link$/);
});

// SOW-088 {author-note}: the from-the-author intro comment as a template token — sanitized like every
// var, and structurally absent on a members-only item (buildQueueItem nulls it, so a possibly-encrypted
// intro can never ride into a channel).
test('{author-note} renders the sanitized intro and is stripped for members-only items', async () => {
  const { buildQueueItem } = await import('../membership/syndication-queue.mjs');
  const pub = buildQueueItem({ source: 'prompt', targetSlug: 's', visibility: 'public', authorNote: 'My intro @here folks' }, { now: () => 1 });
  assert.match(renderTemplate('{title} — {author-note}', { ...pub, title: 'T' }, { limit: 500 }), /T — My intro @.here folks/);
  const mem = buildQueueItem({ source: 'prompt', targetSlug: 's', visibility: 'members', authorNote: 'secret intro' }, { now: () => 1 });
  assert.equal(mem.authorNote, null);
  assert.equal(renderTemplate('{author-note}', mem, { limit: 500 }), '');
});

// SOW-088 {member-url}: the member's public profile URL, derived from the queue item's author login.
test('{member-url} renders the public profile URL and is empty without an author', () => {
  assert.equal(renderTemplate('{member-url}', { source: 'prompt', author: 'atwellpub' }, { limit: 200 }), 'https://gbti.network/members/atwellpub/');
  assert.equal(renderTemplate('x {member-url}', { source: 'prompt' }, { limit: 200 }), 'x');
});

// SOW-088 {short-description}: the item's shortDescription (the queue item blurb, filled by the CI
// enqueue and the manual popup alike), sanitized like every var.
test('{short-description} renders the blurb and sanitizes mentions', () => {
  assert.equal(renderTemplate('{short-description}', { source: 'prompt', blurb: 'A drop-in /sow skill.' }, { limit: 300 }), 'A drop-in /sow skill.');
  assert.equal(renderTemplate('x {short-description}', { source: 'prompt' }, { limit: 300 }), 'x');
  assert.match(renderTemplate('{short-description}', { source: 'prompt', blurb: 'hey @everyone' }, { limit: 300 }), /@.everyone/);
});

// SOW-088: a token written in ALL CAPS uppercases its value; a resolved <@id> mention never case-shifts
// (Discord mention syntax is case-sensitive), and lowercase/hyphenated forms stay as-is.
test('ALL-CAPS tokens uppercase their value, mentions excluded', () => {
  const item = { source: 'prompt', title: 'My Skill', author: 'atwellpub', mention: '<@123>' };
  assert.equal(renderTemplate('{TITLE} [{CONTENT-TYPE}]', item, { limit: 300 }), 'MY SKILL [PROMPT]');
  assert.equal(renderTemplate('{title} [{content-type}]', item, { limit: 300 }), 'My Skill [prompt]');
  assert.equal(renderTemplate('{MEMBER-DISCORD-USERNAME}', item, { limit: 300 }), '<@123>', 'a mention is never uppercased');
});

// SOW-088: {author-note-italic} wraps each non-empty LINE in markdown italics (italics never span
// line breaks on Reddit), sanitized like {author-note}; empty when the item has no note.
test('{author-note-italic} italicizes per line', () => {
  const item = { source: 'prompt', authorNote: 'First paragraph.\n\nSecond one here.' };
  assert.equal(renderTemplate('{author-note-italic}', item, { limit: 500 }), '*First paragraph.*\n\n*Second one here.*');
  assert.equal(renderTemplate('x {author-note-italic}', { source: 'prompt' }, { limit: 500 }), 'x');
});

// SOW-120 follow-up: the X handle token + hashtag tokens.
test('xHandleFrom parses a URL, a bare @handle, and rejects junk', () => {
  assert.equal(xHandleFrom('https://x.com/atwellpub'), 'atwellpub');
  assert.equal(xHandleFrom('https://twitter.com/Some_User?ref=1'), 'Some_User');
  assert.equal(xHandleFrom('@atwellpub'), 'atwellpub');
  assert.equal(xHandleFrom('atwellpub'), 'atwellpub');
  assert.equal(xHandleFrom('https://x.com/'), ''); // no handle
  assert.equal(xHandleFrom('not a handle with spaces'), '');
  assert.equal(xHandleFrom(''), '');
  assert.equal(xHandleFrom('waytoolonghandlethatexceedsfifteen'), ''); // > 15 chars
});

// SOW-140: the dev.to byline mentions the member's dev.to profile, falling back to their name.
test('devtoHandleFrom parses a dev.to URL, a bare @handle, and rejects junk', () => {
  assert.equal(devtoHandleFrom('https://dev.to/atwellpub'), 'atwellpub');
  assert.equal(devtoHandleFrom('https://www.dev.to/Some_User?ref=1'), 'Some_User');
  assert.equal(devtoHandleFrom('@atwellpub'), 'atwellpub');
  assert.equal(devtoHandleFrom('atwellpub'), 'atwellpub');
  assert.equal(devtoHandleFrom('https://dev.to/'), ''); // no handle
  assert.equal(devtoHandleFrom('has spaces'), '');
  assert.equal(devtoHandleFrom('bad-hyphen'), ''); // dev.to usernames are letters/digits/underscore
  assert.equal(devtoHandleFrom(''), '');
});

test('{member-devto-handle} renders the dev.to @mention when the profile lists one, else the full name', () => {
  const withHandle = renderTemplate('By {member-devto-handle}.', { authorDevto: 'https://dev.to/atwellpub', author: 'atwellpub', authorName: 'Hudson Atwell' });
  assert.equal(withHandle, 'By @atwellpub.');
  const noHandle = renderTemplate('By {member-devto-handle}.', { author: 'atwellpub', authorName: 'Hudson Atwell' });
  assert.equal(noHandle, 'By Hudson Atwell.');
  // A crafted handle cannot fire a mass mention (sanitized like the other handle tokens); dev.to @user tags one user.
  const bare = renderTemplate('By {member-devto-handle}.', { authorDevto: 'atwellpub', author: 'atwellpub' });
  assert.equal(bare, 'By @atwellpub.');
});

test('toHashtag PascalCases multi-word, preserves a single word and acronyms, drops junk', () => {
  assert.equal(toHashtag('agent skills'), '#AgentSkills');
  assert.equal(toHashtag('Claude-Code'), '#ClaudeCode');
  assert.equal(toHashtag('AI'), '#AI');
  assert.equal(toHashtag('Prompts'), '#Prompts');
  assert.equal(toHashtag('ai/ml'), '#AiMl');
  assert.equal(toHashtag('  '), '');
  assert.equal(toHashtag('!!!'), '');
});

test('{member-x-handle}: the X @handle when present, else the full name', () => {
  const withX = renderTemplate('{member-x-handle}', { author: 'atwellpub', authorName: 'Hudson Atwell', authorX: 'https://x.com/atwellpub' }, { limit: 200 });
  assert.equal(withX, '@atwellpub'); // a REAL mention (no zero-width space), from the validated own handle
  const noX = renderTemplate('{member-x-handle}', { author: 'atwellpub', authorName: 'Hudson Atwell' }, { limit: 200 });
  assert.equal(noX, 'Hudson Atwell');
  const noXnoName = renderTemplate('{member-x-handle}', { author: 'bob' }, { limit: 200 });
  assert.ok(noXnoName.includes('bob')); // falls to @login via fullName
});

test('{category-hashtag}, {tags-hashtags}, {hashtags} render and de-duplicate', () => {
  const item = { source: 'prompt', category: 'AI', tags: ['Prompts', 'Skill', 'agent skills'] };
  assert.equal(renderTemplate('{category-hashtag}', item, { limit: 200 }), '#AI');
  assert.equal(renderTemplate('{tags-hashtags}', item, { limit: 200 }), '#Prompts #Skill #AgentSkills');
  // {hashtags} = category + tags, de-duplicated (AI appears once even if also a tag)
  assert.equal(renderTemplate('{hashtags}', { source: 'prompt', category: 'AI', tags: ['AI', 'Prompts'] }, { limit: 200 }), '#AI #Prompts');
  // missing tags/category render empty and collapse whitespace
  assert.equal(renderTemplate('done {tags-hashtags}{category-hashtag}', { source: 'prompt' }, { limit: 200 }), 'done');
});

// SOW-122: the Bluesky handle token.
test('blueskyHandleFrom parses a bsky.app URL, a bare @handle, and rejects junk', () => {
  assert.equal(blueskyHandleFrom('https://bsky.app/profile/atwellpub.bsky.social'), 'atwellpub.bsky.social');
  assert.equal(blueskyHandleFrom('@propertunity.bsky.social'), 'propertunity.bsky.social');
  assert.equal(blueskyHandleFrom('someone.custom.com'), 'someone.custom.com'); // custom-domain handle
  assert.equal(blueskyHandleFrom('nodot'), ''); // a handle needs at least one dot
  assert.equal(blueskyHandleFrom('has spaces .social'), '');
  assert.equal(blueskyHandleFrom(''), '');
});

test('{member-bluesky-handle}: the Bluesky @handle when present, else the full name', () => {
  const withBsky = renderTemplate('{member-bluesky-handle}', { author: 'atwellpub', authorName: 'Hudson Atwell', authorBluesky: 'https://bsky.app/profile/atwellpub.bsky.social' }, { limit: 200 });
  assert.equal(withBsky, '@atwellpub.bsky.social');
  const noBsky = renderTemplate('{member-bluesky-handle}', { author: 'atwellpub', authorName: 'Hudson Atwell' }, { limit: 200 });
  assert.equal(noBsky, 'Hudson Atwell');
});

// SOW-123: the Mastodon handle token.
test('mastodonHandleFrom parses an instance URL, @user@instance, user@instance, rejects junk', () => {
  assert.equal(mastodonHandleFrom('https://mastodon.social/@propertunity'), 'propertunity@mastodon.social');
  assert.equal(mastodonHandleFrom('@propertunity@mastodon.social'), 'propertunity@mastodon.social');
  assert.equal(mastodonHandleFrom('propertunity@mastodon.social'), 'propertunity@mastodon.social');
  assert.equal(mastodonHandleFrom('https://mastodon.social/@a/statuses/1'), ''); // not a bare profile url
  assert.equal(mastodonHandleFrom('nodomain'), '');
  assert.equal(mastodonHandleFrom(''), '');
});

test('{member-mastodon-handle}: the fediverse @user@instance when present, else the full name', () => {
  const withM = renderTemplate('{member-mastodon-handle}', { author: 'x', authorName: 'Shane Taylor', authorMastodon: 'https://mastodon.social/@propertunity' }, { limit: 200 });
  assert.equal(withM, '@propertunity@mastodon.social');
  const noM = renderTemplate('{member-mastodon-handle}', { author: 'x', authorName: 'Shane Taylor' }, { limit: 200 });
  assert.equal(noM, 'Shane Taylor');
});

test('redditHandleFrom parses URLs, u/ forms, bare names, and rejects junk', () => {
  assert.equal(redditHandleFrom('https://www.reddit.com/user/atwellpub'), 'atwellpub');
  assert.equal(redditHandleFrom('https://reddit.com/u/Some_User?ref=1'), 'Some_User');
  assert.equal(redditHandleFrom('https://old.reddit.com/user/dash-name/'), 'dash-name');
  assert.equal(redditHandleFrom('u/atwellpub'), 'atwellpub');
  assert.equal(redditHandleFrom('/u/atwellpub'), 'atwellpub');
  assert.equal(redditHandleFrom('@atwellpub'), 'atwellpub');
  assert.equal(redditHandleFrom('atwellpub'), 'atwellpub');
  assert.equal(redditHandleFrom('ab'), ''); // too short
  assert.equal(redditHandleFrom('has spaces'), '');
  assert.equal(redditHandleFrom('https://reddit.com/r/GBTI_network'), ''); // a subreddit is not a user
  assert.equal(redditHandleFrom(''), '');
});

test('{member-reddit-handle}: u/name when the profile lists one, else the full name', () => {
  const item = { source: 'post', author: 'alice', authorName: 'Alice Q', authorReddit: 'https://reddit.com/user/alice_q' };
  assert.equal(renderTemplate('By {member-reddit-handle}.', item), 'By u/alice_q.');
  assert.equal(renderTemplate('By {member-reddit-handle}.', { ...item, authorReddit: null }), 'By Alice Q.');
  assert.equal(renderTemplate('By {member-reddit-handle}.', { ...item, authorReddit: 'not a handle!!' }), 'By Alice Q.');
});
