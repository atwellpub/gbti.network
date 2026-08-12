// SOW-058: the shared syndication config. Pure normalization, fail-closed defaults, and the secret-free KV
// mirror shape. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SYNDICATION_CONFIG, CHANNELS, syndicationConfigFromParsed, isSyndicationEnabled, holdMs,
  upvoteThreshold, isChannelEnabled, enabledChannelNames, toSyndicationMirror, classifyMode, templateFor, newsEngagement,
  AUTO_TYPES, AUTO_CHANNELS, AUTO_MODES, channelCapability, autoModeFor, isAutoOn, autoChannelsForType, channelHoldMs, explicitChannelHoldMs, defaultAutoMode,
  contentEngagement, popularChannelsForType, CONTENT_ENGAGEMENT_SIGNALS, deliverChannelsForType,
} from '../membership/syndication-config.mjs';

test('a missing/empty config fails closed to the safe defaults', () => {
  const c = syndicationConfigFromParsed({});
  assert.equal(c.enabled, false);
  assert.equal(c.hold_minutes, 60);
  assert.equal(c.upvote_threshold, 2);
  for (const name of CHANNELS) assert.equal(c.channels[name], false);
  assert.equal(isSyndicationEnabled(c), false);
});

test('reads the syndication: namespace and a bare object identically', () => {
  const a = syndicationConfigFromParsed({ syndication: { enabled: true, hold_minutes: 30 } });
  const b = syndicationConfigFromParsed({ enabled: true, hold_minutes: 30 });
  assert.deepEqual(a, b);
  assert.equal(a.enabled, true);
  assert.equal(holdMs(a), 30 * 60_000);
});

test('hold_minutes coerces to a non-negative integer; threshold never drops below 1', () => {
  assert.equal(syndicationConfigFromParsed({ hold_minutes: -5 }).hold_minutes, 0);
  assert.equal(syndicationConfigFromParsed({ hold_minutes: 90.9 }).hold_minutes, 90);
  assert.equal(syndicationConfigFromParsed({ hold_minutes: 'nope' }).hold_minutes, 60); // fallback
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: 0 })), 2); // 0 is invalid -> default
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: 5 })), 5);
  assert.equal(upvoteThreshold(syndicationConfigFromParsed({ upvote_threshold: '3' })), 3);
});

test('SOW-131: isChannelEnabled + enabledChannelNames are MATRIX-DERIVED (any cell not off), not the channels flag', () => {
  // mastodon: every cell explicitly off -> disabled. Everything else uses the default matrix (post/product/prompt
  // on), so it is enabled. bluesky: a `popular` share cell also counts as enabled.
  const c = syndicationConfigFromParsed({ auto_matrix: {
    post: { mastodon: 'off' }, product: { mastodon: 'off' }, prompt: { mastodon: 'off' }, share: { mastodon: 'off', bluesky: 'popular' },
  } });
  assert.equal(isChannelEnabled(c, 'discord'), true);   // default post/product/prompt on
  assert.equal(isChannelEnabled(c, 'mastodon'), false);  // every cell off
  assert.equal(isChannelEnabled(c, 'bluesky'), true);    // popular counts as enabled
  // Only mastodon is off; every other MATRIX channel is default-enabled.
  assert.deepEqual(enabledChannelNames(c).sort(), ['bluesky', 'dailydev', 'devto', 'discord', 'discord-category', 'linkedin', 'reddit', 'x']); // sow-217: hashnode retired (out of CHANNELS)
  // The legacy `channels` flag no longer gates enablement: channels:false but matrix on -> enabled.
  const flagged = syndicationConfigFromParsed({ channels: { reddit: false }, auto_matrix: { post: { reddit: 'on' } } });
  assert.equal(isChannelEnabled(flagged, 'reddit'), true);
});

test('toSyndicationMirror returns the secret-free shape for KV', () => {
  const m = toSyndicationMirror({ enabled: true, hold_minutes: 60, upvote_threshold: 2, channels: { discord: true } });
  assert.deepEqual(m, {
    enabled: true, require_approval: true, hold_minutes: 60, upvote_threshold: 2, classify: 'ai',
    // SOW-088: the mirror carries ONLY configured templates (readers re-normalize, so code defaults track deploys).
    templates: {},
    news_engagement: { enabled: false, open_threshold: 2, tier: 'paid', comment_autopost: true },
    // SOW-126: the content-engagement (`popular` engine) settings, mirrored like news_engagement.
    content_engagement: { enabled: false, threshold: 3, tier: 'signed-in', signals: { opens: true, favorites: false, upvotes: false, comments: false } },
    // SOW-088: reddit joined CHANNELS (default false) so the admin pipeline switch survives normalization.
    channels: { discord: true, 'discord-category': false, x: false, linkedin: false, bluesky: false, reddit: false, devto: false, dailydev: false }, // sow-159: mastodon retired; sow-217: hashnode retired (both out of CHANNELS)
    channel_templates: {},
    stub_templates: {},
    channel_templates_stub: {},
    manual_assist_channels: [], // SOW-121
    // SOW-125: the mirror carries the matrix CONFIGURED-ONLY (like templates), so an unconfigured config yields
    // an empty matrix and code-default changes to defaultAutoMode track deploys instead of freezing into KV.
    auto_matrix: {},
    channel_hold_minutes: {}, // SOW-125: no per-channel overrides -> the global hold applies
  });
  // No surprise keys (no token/secret fields).
  assert.deepEqual(Object.keys(m).sort(), ['auto_matrix', 'channel_hold_minutes', 'channel_templates', 'channel_templates_stub', 'channels', 'classify', 'content_engagement', 'enabled', 'hold_minutes', 'manual_assist_channels', 'news_engagement', 'require_approval', 'stub_templates', 'templates', 'upvote_threshold']);
});

test('DEFAULT_SYNDICATION_CONFIG is frozen and disabled', () => {
  assert.ok(Object.isFrozen(DEFAULT_SYNDICATION_CONFIG));
  assert.equal(DEFAULT_SYNDICATION_CONFIG.enabled, false);
});

// SOW-126: the content-engagement (`popular` engine) config + the popular-channel resolver.

test('SOW-126: contentEngagement normalizes fail-closed (disabled, opens-on, tier + signals)', () => {
  const d = contentEngagement(syndicationConfigFromParsed({}));
  assert.equal(d.enabled, false);
  assert.equal(d.threshold, 3);
  assert.equal(d.tier, 'signed-in');
  assert.deepEqual(d.signals, { opens: true, favorites: false, upvotes: false, comments: false });
  // an admin config is honored + unknown signals dropped, bad tier -> default, threshold >= 1.
  const c = contentEngagement(syndicationConfigFromParsed({ content_engagement: { enabled: true, threshold: 5, tier: 'paid', signals: { favorites: true, bogus: true }, } }));
  assert.equal(c.enabled, true);
  assert.equal(c.threshold, 5);
  assert.equal(c.tier, 'paid');
  assert.deepEqual(Object.keys(c.signals).sort(), CONTENT_ENGAGEMENT_SIGNALS.slice().sort());
  assert.equal(c.signals.favorites, true);
  assert.equal(c.signals.opens, true); // absent -> default on
  assert.equal(c.signals.bogus, undefined); // unknown dropped
  assert.equal(contentEngagement(syndicationConfigFromParsed({ content_engagement: { tier: 'martian', threshold: 0 } })).tier, 'signed-in');
});

test('SOW-126/131: popularChannelsForType returns channels whose cell is popular (matrix-only; manual needs manual_assist)', () => {
  const c = syndicationConfigFromParsed({
    manual_assist_channels: ['x'],
    auto_matrix: { share: { discord: 'popular', bluesky: 'on', x: 'popular' } },
  });
  // discord: popular auto -> in. bluesky: on (not popular) -> out. x: popular + manual-assist -> in (a promoted
  // popular manual task). (sow-159: the mastodon cell is retired; a stray cell for it would be ignored.)
  assert.deepEqual(popularChannelsForType(c, 'share').sort(), ['discord', 'x']);
  assert.deepEqual(popularChannelsForType(c, 'post'), []); // post defaults on everywhere, no popular cells
});

// SOW-125: the per-type-per-channel auto-share matrix + per-channel delay.

test('SOW-125: channelCapability derives auto/manual/building from the one map', () => {
  assert.equal(channelCapability('discord'), 'auto');
  assert.equal(channelCapability('bluesky'), 'auto');
  assert.equal(channelCapability('mastodon'), 'auto');
  assert.equal(channelCapability('x'), 'manual');
  assert.equal(channelCapability('linkedin'), 'manual'); // SOW-127: LinkedIn is now manual-assist
  assert.equal(channelCapability('dailydev'), 'manual'); // SOW-135
  assert.equal(channelCapability('hashnode'), 'manual'); // manual pivot: no Hashnode Pro, so hand-post via the Social Queue
  assert.equal(channelCapability('devto'), 'auto'); // dev.to stays the API-driven full-body channel
  assert.equal(channelCapability('nope'), 'building'); // an unknown channel defaults to building
  assert.ok(AUTO_CHANNELS.includes('bluesky') && !AUTO_CHANNELS.includes('x') && !AUTO_CHANNELS.includes('hashnode'));
});

test('SOW-125: the default matrix is shares off, every other type on, backward-compatible', () => {
  const c = syndicationConfigFromParsed({}); // no matrix in the file
  for (const ch of AUTO_CHANNELS) {
    assert.equal(autoModeFor(c, 'share', ch), 'off');
    for (const t of ['post', 'product', 'prompt']) assert.equal(autoModeFor(c, t, ch), 'on');
  }
  assert.equal(defaultAutoMode('share'), 'off');
  assert.equal(defaultAutoMode('post'), 'on');
});

test('SOW-125: autoModeFor coerces an unknown cell to the type default; unknown type/channel is off', () => {
  const c = syndicationConfigFromParsed({ auto_matrix: { post: { bluesky: 'bogus', discord: 'popular' } } });
  assert.equal(autoModeFor(c, 'post', 'bluesky'), 'on'); // bogus -> default (post on)
  assert.equal(autoModeFor(c, 'post', 'discord'), 'popular');
  assert.equal(autoModeFor(c, 'share', 'bluesky'), 'off'); // default share off
  assert.equal(autoModeFor(c, 'unknown', 'discord'), 'off');
  assert.equal(autoModeFor(c, 'post', 'x'), 'on-manual'); // a MANUAL channel's default `on` coerces to on-manual
  assert.equal(autoModeFor(c, 'post', 'linkedin'), 'on-manual'); // SOW-127: same coercion for LinkedIn
  assert.equal(autoModeFor(c, 'post', 'nope'), 'off'); // an unknown (building) channel is not a matrix channel -> off
  assert.ok(AUTO_MODES.includes('popular'));
});

test('SOW-125/131: isAutoOn + autoChannelsForType are MATRIX-ONLY (no channels gate)', () => {
  const c = syndicationConfigFromParsed({
    auto_matrix: {
      post: { discord: 'on', 'discord-category': 'off', bluesky: 'popular', reddit: 'off', devto: 'off', hashnode: 'off' },
      share: { discord: 'on' },
    },
  });
  assert.equal(isAutoOn(c, 'post', 'discord'), true);
  assert.equal(isAutoOn(c, 'post', 'bluesky'), false); // popular is not "on" at publish
  // post: discord on, bluesky popular, the rest explicitly off -> only the on cells deliver (no channels gate).
  assert.deepEqual(autoChannelsForType(c, 'post').sort(), ['discord']);
  assert.deepEqual(autoChannelsForType(c, 'share'), ['discord']); // share on for discord only (overrides default off)
  // prompt: the default matrix is on for every AUTO channel, so all deliver. (sow-159: mastodon retired.)
  assert.deepEqual(autoChannelsForType(c, 'prompt').sort(), ['bluesky', 'devto', 'discord', 'discord-category', 'reddit']); // hashnode is MANUAL now (not an auto channel)
});

test('SOW-125: channelHoldMs uses the per-channel override, else the global hold', () => {
  const c = syndicationConfigFromParsed({ hold_minutes: 60, channel_hold_minutes: { bluesky: 120, discord: 0 } });
  assert.equal(channelHoldMs(c, 'bluesky'), 120 * 60_000);
  assert.equal(channelHoldMs(c, 'discord'), 0);
  assert.equal(channelHoldMs(c, 'reddit'), 60 * 60_000); // no override -> global
  assert.deepEqual(c.channel_hold_minutes, { bluesky: 120, discord: 0 }); // unknown/absent dropped
});

test('SOW-125: explicitChannelHoldMs is the override-or-0 (NO global fallback), for the approval model', () => {
  const c = syndicationConfigFromParsed({ hold_minutes: 60, channel_hold_minutes: { bluesky: 120, discord: 0 } });
  assert.equal(explicitChannelHoldMs(c, 'bluesky'), 120 * 60_000); // explicit override
  assert.equal(explicitChannelHoldMs(c, 'discord'), 0); // explicit 0
  assert.equal(explicitChannelHoldMs(c, 'reddit'), 0); // NO override -> 0 (an approved item posts now), NOT the global hold
  assert.equal(channelHoldMs(c, 'reddit'), 60 * 60_000); // contrast: channelHoldMs DOES fall back to the global
});

test('SOW-125: normalizeChannelHoldMinutes drops unknown, non-finite, and blank entries', () => {
  const c = syndicationConfigFromParsed({ channel_hold_minutes: { bluesky: 120, discord: 0, myspace: 5, reddit: 'abc', linkedin: '' } });
  assert.deepEqual(c.channel_hold_minutes, { bluesky: 120, discord: 0 }); // myspace (unknown), reddit (non-finite), linkedin (blank) dropped
});

test('SOW-125: the mirror round-trips a CONFIGURED matrix + channel_hold_minutes, defaults not frozen', () => {
  // toSyndicationMirror takes the RAW parsed doc (as reconcile passes it), so it carries only the cells the admin
  // actually wrote; syndicationConfigFromParsed then re-derives the defaults for every other cell.
  const m = toSyndicationMirror({ syndication: { auto_matrix: { share: { discord: 'on' }, post: { bluesky: 'off' } }, channel_hold_minutes: { bluesky: 120 } } });
  assert.deepEqual(m.auto_matrix, { share: { discord: 'on' }, post: { bluesky: 'off' } }); // configured-only
  assert.deepEqual(m.channel_hold_minutes, { bluesky: 120 });
  const back = syndicationConfigFromParsed(m);
  assert.equal(autoModeFor(back, 'share', 'discord'), 'on'); // configured cell survives
  assert.equal(autoModeFor(back, 'post', 'bluesky'), 'off'); // configured cell survives
  assert.equal(autoModeFor(back, 'share', 'bluesky'), 'off'); // default share off (re-derived, not frozen)
  assert.equal(autoModeFor(back, 'post', 'discord'), 'on'); // default post on (re-derived)
  assert.equal(channelHoldMs(back, 'bluesky'), 120 * 60_000);
});

// SOW-087: the share category suggestion knob.
test('classifyMode normalizes ai|keyword|off and falls back to ai', () => {
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: 'keyword' } })), 'keyword');
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: ' OFF ' } })), 'off');
  assert.equal(classifyMode(syndicationConfigFromParsed({ syndication: { classify: 'llm' } })), 'ai'); // unknown -> default
  assert.equal(classifyMode(syndicationConfigFromParsed({})), 'ai');
  assert.equal(classifyMode(undefined), 'ai');
});

// SOW-087: the per-type Discord templates.
test('templateFor: configured template wins, blank/missing falls back to the type default or null', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { templates: { share: '{title} by {author}', post: '  ' } } });
  assert.equal(templateFor(cfg, 'share'), '{title} by {author}');
  // SOW-088: every type now has the one owner-directed default, so a blank config falls back to it.
  assert.equal(templateFor(cfg, 'post'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
  // sow-180: the SHARE default is content-first with no member credit (post/product below keep DEFAULT_FORMAT).
  assert.equal(templateFor(syndicationConfigFromParsed({}), 'share'), 'Shared on the GBTI Network: "{title}" {url}');
  assert.equal(templateFor(undefined, 'share'), 'Shared on the GBTI Network: "{title}" {url}');
  assert.equal(templateFor(undefined, 'product'), 'New {content-type} published by {member-discord-username}: "{title}" {url}');
});

// SOW-111: the news engagement auto-share block.
test('newsEngagement: fail-closed defaults, normalization, and a bad tier falls back to paid', () => {
  const d = newsEngagement(syndicationConfigFromParsed({}));
  assert.deepEqual(d, { enabled: false, open_threshold: 2, tier: 'paid', comment_autopost: true });
  const c = newsEngagement(syndicationConfigFromParsed({ syndication: { news_engagement: {
    enabled: 'yes', open_threshold: '3', tier: ' Signed-In ', comment_autopost: 'off',
  } } }));
  assert.deepEqual(c, { enabled: true, open_threshold: 3, tier: 'signed-in', comment_autopost: false });
  const bad = newsEngagement(syndicationConfigFromParsed({ syndication: { news_engagement: { tier: 'everyone', open_threshold: 0 } } }));
  assert.equal(bad.tier, 'paid');
  assert.equal(bad.open_threshold, 2); // below-1 falls back
  assert.deepEqual(newsEngagement(undefined), d);
});

// SOW-088: the admin pipeline-settings edit (master / approval / hold / per-channel switches).
test('setSyndicationSettings patches only the supplied fields, validates hard, and is idempotent', async () => {
  const { setSyndicationSettings } = await import('../membership/syndication-template-edits.mjs');
  const doc = { syndication: { enabled: true, require_approval: true, hold_minutes: 60, channels: { discord: true, x: true } } };
  const ctx = { now: '2026-07-09T00:00:00.000Z', actor: { githubId: '1', login: 'atwellpub' } };
  const r = setSyndicationSettings(doc, { requireApproval: false, channels: { x: false, bluesky: false } }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.syndication.require_approval, false);
  assert.equal(r.next.syndication.channels.x, false);
  assert.equal(r.next.syndication.enabled, true); // untouched field survives
  assert.equal(r.audit.action, 'syndication-settings.set');
  // Idempotent against the new state.
  assert.equal(setSyndicationSettings(r.next, { requireApproval: false, channels: { x: false } }, ctx).changed, false);
  // Hard validation.
  const { TemplateEditError } = await import('../membership/syndication-template-edits.mjs');
  assert.throws(() => setSyndicationSettings(doc, { holdMinutes: 9999 }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { channels: { myspace: true } }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { enabled: 'yes' }, ctx), TemplateEditError);
});

// SOW-125: the setSyndicationSettings edit writes the auto-share matrix + per-channel delay, validates hard,
// only writes cells that differ from the effective value, and deletes a per-channel override on '' / null.
test('setSyndicationSettings writes the auto-share matrix + per-channel delay, validated + idempotent', async () => {
  const { setSyndicationSettings, TemplateEditError } = await import('../membership/syndication-template-edits.mjs');
  const doc = { syndication: { enabled: true } };
  const ctx = { now: '2026-07-16T00:00:00.000Z', actor: { githubId: '1', login: 'atwellpub' } };
  // Turn a share on for bluesky (default off) and delay bluesky 120 min.
  const r = setSyndicationSettings(doc, { autoMatrix: { share: { bluesky: 'on' } }, channelHoldMinutes: { bluesky: 120 } }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.syndication.auto_matrix.share.bluesky, 'on');
  assert.equal(r.next.syndication.channel_hold_minutes.bluesky, 120);
  // A cell matching the effective default is NOT written (post is on by default -> no-op).
  assert.equal(setSyndicationSettings(r.next, { autoMatrix: { post: { bluesky: 'on' } } }, ctx).changed, false);
  // '' / null deletes a per-channel override.
  const cleared = setSyndicationSettings(r.next, { channelHoldMinutes: { bluesky: '' } }, ctx);
  assert.equal(cleared.changed, true);
  assert.equal(cleared.next.syndication.channel_hold_minutes.bluesky, undefined);
  // SOW-125: x (a MANUAL channel) IS a valid matrix cell -> the per-type manual-task control (F12).
  const xOn = setSyndicationSettings(doc, { autoMatrix: { post: { x: 'off' } } }, ctx); // post/x defaults on -> setting off is a change
  assert.equal(xOn.changed, true);
  assert.equal(xOn.next.syndication.auto_matrix.post.x, 'off');
  // Hard validation: unknown type, a non-matrix (building/unknown) channel, bad mode, out-of-range delay.
  assert.throws(() => setSyndicationSettings(doc, { autoMatrix: { widget: { bluesky: 'on' } } }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { autoMatrix: { post: { myspace: 'on' } } }, ctx), TemplateEditError); // myspace is not a matrix channel
  assert.throws(() => setSyndicationSettings(doc, { autoMatrix: { post: { bluesky: 'sometimes' } } }, ctx), TemplateEditError);
  assert.throws(() => setSyndicationSettings(doc, { channelHoldMinutes: { bluesky: 99999 } }, ctx), TemplateEditError);
});

// SOW-088: reddit-body is a first-class template type (the Reddit post body / link-post first comment),
// so it flows through the same defaults, admin edit validation, and the syndicate-now GET as the others.
test('reddit-body: default template, config override, and the admin edit path', async () => {
  const { TEMPLATE_TYPES, DEFAULT_TEMPLATES, templateFor, syndicationConfigFromParsed } = await import('../membership/syndication-config-core.mjs');
  assert.ok(TEMPLATE_TYPES.includes('reddit-body'));
  assert.equal(DEFAULT_TEMPLATES['reddit-body'], '{short-description}'); // the description under the title
  // side-quest 2026-07-16: the first comment credits the member via {short-description} (which shares carry),
  // NOT {author-note-italic} (a posts-only intro that blanked the comment for shares).
  // The first comment now credits the member's Reddit username first ({member-reddit-handle} renders
  // u/name, falling back to the full name), matching X/Bluesky/Mastodon.
  assert.match(DEFAULT_TEMPLATES['reddit-comment'], /\{member-reddit-handle\}[\s\S]*\{short-description\}[\s\S]*\{member-url\}/);
  assert.ok(!/\{author-note/.test(DEFAULT_TEMPLATES['reddit-comment']), 'no author-note dependency, so it fires for a share');
  assert.equal(templateFor(syndicationConfigFromParsed({}), 'reddit-body'), DEFAULT_TEMPLATES['reddit-body']);
  // SOW-140: the dev.to byline MENTIONS the member's dev.to profile ({member-devto-handle}); Hashnode keeps the
  // NAME-based byline ({fullName}), since a dev.to handle is the wrong platform to mention on Hashnode.
  assert.match(DEFAULT_TEMPLATES['devto-intro'], /\{member-devto-handle\}/);
  assert.ok(!/\{member-devto-handle\}/.test(DEFAULT_TEMPLATES['hashnode-intro']), 'Hashnode byline does not mention the dev.to handle');
  assert.match(DEFAULT_TEMPLATES['hashnode-intro'], /\{fullName\}/);
  const cfg = syndicationConfigFromParsed({ syndication: { templates: { 'reddit-body': 'Custom {author-note}' } } });
  assert.equal(templateFor(cfg, 'reddit-body'), 'Custom {author-note}');
  const { setTemplate } = await import('../membership/syndication-template-edits.mjs');
  const { next, changed } = setTemplate({}, { type: 'reddit-body', template: 'Edited body {url}' }, { now: 0, actor: { githubId: '1' } });
  assert.equal(changed, true);
  assert.equal(next.syndication.templates['reddit-body'], 'Edited body {url}');
});

// SOW-088: per-channel template overrides — the fallback chain is channel override -> the shared map ->
// the built-in default; unknown channels/types and blanks are dropped by normalization; the mirror
// carries the overrides so the Worker reads admin edits from KV.
test('channel_templates: normalization, the templateFor fallback chain, and the mirror', async () => {
  const { DEFAULT_TEMPLATES } = await import('../membership/syndication-config-core.mjs');
  const cfg = syndicationConfigFromParsed({ syndication: {
    templates: { prompt: 'Shared prompt {title}' },
    channel_templates: {
      reddit: { prompt: 'Reddit prompt "{title}"', 'reddit-body': 'Body {author-note}', nope: 'x', share: '  ' },
      bogus: { prompt: 'never' },
    },
  } });
  assert.deepEqual(Object.keys(cfg.channel_templates), ['reddit']);
  assert.equal(cfg.channel_templates.reddit.nope, undefined);
  assert.equal(cfg.channel_templates.reddit.share, undefined, 'a blank override is dropped (= fall back)');
  assert.equal(templateFor(cfg, 'prompt', 'reddit'), 'Reddit prompt "{title}"');
  assert.equal(templateFor(cfg, 'prompt', 'discord'), 'Shared prompt {title}', 'no override -> the shared map');
  assert.equal(templateFor(cfg, 'prompt'), 'Shared prompt {title}', 'channel-less callers are unchanged');
  assert.equal(templateFor(cfg, 'share', 'reddit'), DEFAULT_TEMPLATES.share, 'no override + no shared -> built-in');
  const m = toSyndicationMirror({ syndication: { channel_templates: { reddit: { prompt: 'R {title}' } } } });
  assert.deepEqual(m.channel_templates, { reddit: { prompt: 'R {title}' } });
});

// SOW-088: the channel-targeted edit writes/deletes syndication.channel_templates[channel][type].
test('setTemplate with a channel targets the override and empties clean up', async () => {
  const { setTemplate } = await import('../membership/syndication-template-edits.mjs');
  const ctx = { now: 0, actor: { githubId: '1' } };
  const a = setTemplate({}, { type: 'prompt', template: 'R {title}', channel: 'reddit' }, ctx);
  assert.equal(a.changed, true);
  assert.deepEqual(a.next.syndication.channel_templates, { reddit: { prompt: 'R {title}' } });
  assert.equal(a.audit.detail.channel, 'reddit');
  const b = setTemplate(a.next, { type: 'prompt', template: 'R {title}', channel: 'reddit' }, ctx);
  assert.equal(b.changed, false, 'idempotent');
  const c = setTemplate(a.next, { type: 'prompt', template: '', channel: 'reddit' }, ctx);
  assert.equal(c.next.syndication.channel_templates, undefined, 'the last override removes the whole block');
  const { TemplateEditError } = await import('../membership/syndication-template-edits.mjs');
  assert.throws(() => setTemplate({}, { type: 'prompt', template: 'x', channel: 'myspace' }, ctx), TemplateEditError);
});

// SOW-088: a CONFIGURED template still rides the mirror; only the folded-in defaults are excluded.
test('toSyndicationMirror keeps configured templates and drops folded defaults', () => {
  const m = toSyndicationMirror({ syndication: { templates: { share: 'Custom {shareurl}', post: '   ' } } });
  assert.deepEqual(m.templates, { share: 'Custom {shareurl}' });
});

// SOW-088 Proposal A: the MEMBERS-stub template dimension. The stub chain runs channel stub override ->
// shared stub -> the per-channel built-in -> the shared built-in -> the public chain; the mirror carries
// the stub maps configured-only.
test('stub templates: the resolution chain and the mirror', async () => {
  const { DEFAULT_CHANNEL_STUB_TEMPLATES, DEFAULT_STUB_TEMPLATES, DEFAULT_TEMPLATES } = await import('../membership/syndication-config-core.mjs');
  const empty = syndicationConfigFromParsed({});
  assert.equal(templateFor(empty, 'post', 'discord', { stub: true }), DEFAULT_CHANNEL_STUB_TEMPLATES.discord.post, 'per-channel built-in');
  assert.equal(templateFor(empty, 'post', 'x', { stub: true }), DEFAULT_CHANNEL_STUB_TEMPLATES.x.post, 'SOW-120: X has its own per-channel built-in stub');
  assert.equal(templateFor(empty, 'post', 'linkedin', { stub: true }), DEFAULT_CHANNEL_STUB_TEMPLATES.linkedin.post, 'SOW-127: LinkedIn now has its own per-channel built-in stub');
  assert.equal(templateFor(empty, 'post', 'someunknown', { stub: true }), DEFAULT_STUB_TEMPLATES.post, 'shared built-in for a channel without its own');
  assert.equal(templateFor(empty, 'devto-intro', 'devto', { stub: true }), templateFor(empty, 'devto-intro', 'devto'), 'no stub built-in -> the public chain');
  const cfg = syndicationConfigFromParsed({ syndication: {
    stub_templates: { post: 'Shared stub {title}' },
    channel_templates_stub: { discord: { post: 'Discord stub {title}' } },
  } });
  assert.equal(templateFor(cfg, 'post', 'discord', { stub: true }), 'Discord stub {title}');
  assert.equal(templateFor(cfg, 'post', 'reddit', { stub: true }), 'Shared stub {title}', 'a shared stub beats the per-channel built-in');
  assert.equal(templateFor(cfg, 'post', 'discord'), DEFAULT_TEMPLATES.post, 'the public chain is untouched');
  const m = toSyndicationMirror({ syndication: { stub_templates: { post: 'S {title}' } } });
  assert.deepEqual(m.stub_templates, { post: 'S {title}' });
  assert.deepEqual(m.channel_templates_stub, {});
});

test('setTemplate stub=true targets the stub maps with the same semantics', async () => {
  const { setTemplate } = await import('../membership/syndication-template-edits.mjs');
  const ctx = { now: 0, actor: { githubId: '1' } };
  const a = setTemplate({}, { type: 'post', template: 'Stub {title}', channel: 'discord', stub: true }, ctx);
  assert.deepEqual(a.next.syndication.channel_templates_stub, { discord: { post: 'Stub {title}' } });
  assert.equal(a.next.syndication.channel_templates, undefined, 'the public map is untouched');
  assert.equal(a.audit.detail.stub, true);
  const b = setTemplate(a.next, { type: 'post', template: '', channel: 'discord', stub: true }, ctx);
  assert.equal(b.next.syndication.channel_templates_stub, undefined, 'empty deletes the override');
  const c = setTemplate({}, { type: 'post', template: 'Shared stub', stub: true }, ctx);
  assert.deepEqual(c.next.syndication.stub_templates, { post: 'Shared stub' });
});

// SOW-127: LinkedIn is a MANUAL-assist matrix channel. It delivers (as a Social Queue task) when its cell is on
// AND it is in manual_assist_channels, and it is EXCLUDED from the auto adapter run (no LinkedIn API used).
test('SOW-127: LinkedIn is manual-assist -> delivers a post as a Social Queue task, excluded from auto', () => {
  const c = syndicationConfigFromParsed({ enabled: true, channels: { discord: true }, manual_assist_channels: ['linkedin'] });
  assert.equal(channelCapability('linkedin'), 'manual');
  // default matrix: post on for every matrix channel incl linkedin; a post delivers to linkedin (manual) + discord (auto on).
  assert.ok(deliverChannelsForType(c, 'post').includes('linkedin'));
  // a share is off by default -> no linkedin task.
  assert.deepEqual(autoChannelsForType(c, 'post').includes('linkedin'), false); // autoChannels is auto-only; linkedin is manual
});

test('On-Manual: the vocabulary, coercion, delivery, and the queue set', async () => {
  const { manualQueueChannelsForType, isManualMode, toSyndicationMirror } = await import('../membership/syndication-config-core.mjs');
  assert.ok(AUTO_MODES.includes('on-manual'));
  // An auto-capability channel accepts on-manual and routes to the queue set, not the adapter set.
  const c = syndicationConfigFromParsed({ auto_matrix: {
    post: { bluesky: 'on-manual', discord: 'on', mastodon: 'off', x: 'off', linkedin: 'off', 'discord-category': 'off', reddit: 'off', devto: 'off', hashnode: 'off', dailydev: 'off' },
  } });
  assert.equal(autoModeFor(c, 'post', 'bluesky'), 'on-manual');
  assert.ok(isManualMode(c, 'post', 'bluesky'));
  assert.deepEqual(manualQueueChannelsForType(c, 'post'), ['bluesky']);
  assert.deepEqual(deliverChannelsForType(c, 'post').sort(), ['bluesky', 'discord']); // on + on-manual both deliver
  // The legacy `on` on a manual channel coerces and still delivers (as a queue task).
  const legacy = syndicationConfigFromParsed({ auto_matrix: { post: { x: 'on', linkedin: 'off', discord: 'off', 'discord-category': 'off', reddit: 'off', devto: 'off', mastodon: 'off', bluesky: 'off', hashnode: 'off', dailydev: 'off' } } });
  assert.equal(autoModeFor(legacy, 'post', 'x'), 'on-manual');
  assert.deepEqual(deliverChannelsForType(legacy, 'post'), ['x']);
  assert.deepEqual(manualQueueChannelsForType(legacy, 'post'), ['x']);
  // The mirror carries a configured on-manual cell verbatim (readers re-normalize).
  const mirror = toSyndicationMirror({ syndication: { auto_matrix: { post: { bluesky: 'on-manual' } } } });
  assert.equal(mirror.auto_matrix.post.bluesky, 'on-manual');
});

test('setSyndicationSettings: on-manual accepted anywhere; `on` rejected for a manual-capability channel', async () => {
  const { setSyndicationSettings, TemplateEditError: TErr } = await import('../membership/syndication-template-edits.mjs');
  const ctx = { login: 'root', githubId: '1' };
  const r = setSyndicationSettings({}, { autoMatrix: { post: { bluesky: 'on-manual', x: 'on-manual' } } }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.syndication.auto_matrix.post.bluesky, 'on-manual');
  // x's EFFECTIVE default is already on-manual (the coerced `on`), so the idempotent writer skips the cell.
  assert.equal(r.next.syndication.auto_matrix.post.x, undefined);
  assert.throws(() => setSyndicationSettings({}, { autoMatrix: { post: { x: 'on' } } }, ctx), TErr);
  assert.throws(() => setSyndicationSettings({}, { autoMatrix: { post: { linkedin: 'on' } } }, ctx), TErr);
});
