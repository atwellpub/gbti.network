// SOW-087 (+ SOW-111): the PURE house/syndication-config.yml edit cores. setTemplate writes
// syndication.templates[type] (an EMPTY template deletes the key so the type falls back to its default or the
// built-in message); setNewsEngagement writes the SOW-111 news auto-share settings. Both return
// { next, changed, audit } (the news-source-edits shape). Node-free.
//
// SECURITY: this only COMPUTES the file edit. CODEOWNERS + the gate are the real boundary.

import { TEMPLATE_TYPES, NEWS_ENGAGEMENT_TIERS, newsEngagement, CONTENT_ENGAGEMENT_SIGNALS, contentEngagement, syndicationConfigFromParsed, AUTO_TYPES, MATRIX_CHANNELS, AUTO_MODES, channelCapability } from './syndication-config-core.mjs';

export class TemplateEditError extends Error {}

const MAX_TEMPLATE = 500;
// SOW-138: the full-body crosspost BODY templates (devto-body / hashnode-body) may hold a custom body, so they
// get more headroom than the short per-type message templates. `{body}` (the article) is a token, not stored text.
const MAX_BODY_TEMPLATE = 4000;
const BODY_TYPES = new Set(['devto-body', 'hashnode-body']);

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new TemplateEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, type, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action: 'syndication-template.set',
    target: { type },
    detail: detail ?? null,
  };
}

/**
 * SOW-111: SET the news engagement auto-share settings (a partial patch: only the supplied fields change).
 * Values are validated hard (a bad tier or threshold is an error, never silently coerced into policy).
 * Idempotent against the CURRENT normalized settings.
 */
export function setNewsEngagement(doc, { enabled, openThreshold, tier, commentAutopost } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const cur = newsEngagement({ news_engagement: d.syndication.news_engagement });
  const next = { ...cur };
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new TemplateEditError('enabled must be true or false');
    next.enabled = enabled;
  }
  if (openThreshold !== undefined) {
    const n = Number(openThreshold);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new TemplateEditError('openThreshold must be an integer from 1 to 1000');
    next.open_threshold = n;
  }
  if (tier !== undefined) {
    const t = String(tier || '').trim().toLowerCase();
    if (!NEWS_ENGAGEMENT_TIERS.includes(t)) throw new TemplateEditError(`tier must be one of: ${NEWS_ENGAGEMENT_TIERS.join(', ')}`);
    next.tier = t;
  }
  if (commentAutopost !== undefined) {
    if (typeof commentAutopost !== 'boolean') throw new TemplateEditError('commentAutopost must be true or false');
    next.comment_autopost = commentAutopost;
  }
  const audit = (detail) => {
    const a = ctx?.actor || null;
    return {
      at: isoOf(ctx?.now),
      actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
      action: 'news-engagement.set',
      target: { file: 'house/syndication-config.yml' },
      detail,
    };
  };
  const same = next.enabled === cur.enabled && next.open_threshold === cur.open_threshold
    && next.tier === cur.tier && next.comment_autopost === cur.comment_autopost;
  if (same) return { next: d, changed: false, audit: audit({ ...next, noop: true }) };
  d.syndication.news_engagement = {
    enabled: next.enabled,
    open_threshold: next.open_threshold,
    tier: next.tier,
    comment_autopost: next.comment_autopost,
  };
  return { next: d, changed: true, audit: audit({ ...next }) };
}

/**
 * SOW-126: SET the content engagement auto-share settings (the `popular` matrix engine's tunables). A partial
 * patch: only the supplied fields change. Values are validated hard (a bad tier, threshold, or signal is an
 * error, never silently coerced into policy). Idempotent against the CURRENT normalized settings.
 */
export function setContentEngagement(doc, { enabled, threshold, tier, signals } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const cur = contentEngagement({ content_engagement: d.syndication.content_engagement });
  const next = { ...cur, signals: { ...cur.signals } };
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new TemplateEditError('enabled must be true or false');
    next.enabled = enabled;
  }
  if (threshold !== undefined) {
    const n = Number(threshold);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new TemplateEditError('threshold must be an integer from 1 to 1000');
    next.threshold = n;
  }
  if (tier !== undefined) {
    const t = String(tier || '').trim().toLowerCase();
    if (!NEWS_ENGAGEMENT_TIERS.includes(t)) throw new TemplateEditError(`tier must be one of: ${NEWS_ENGAGEMENT_TIERS.join(', ')}`);
    next.tier = t;
  }
  if (signals !== undefined) {
    if (!signals || typeof signals !== 'object' || Array.isArray(signals)) throw new TemplateEditError('signals must be an object of { signal: boolean }');
    for (const [name, on] of Object.entries(signals)) {
      if (!CONTENT_ENGAGEMENT_SIGNALS.includes(name)) throw new TemplateEditError(`unknown signal "${name}"`);
      if (typeof on !== 'boolean') throw new TemplateEditError(`signal "${name}" must be true or false`);
      next.signals[name] = on;
    }
  }
  const audit = (detail) => {
    const a = ctx?.actor || null;
    return {
      at: isoOf(ctx?.now),
      actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
      action: 'content-engagement.set',
      target: { file: 'house/syndication-config.yml' },
      detail,
    };
  };
  const sameSignals = CONTENT_ENGAGEMENT_SIGNALS.every((s) => next.signals[s] === cur.signals[s]);
  const same = next.enabled === cur.enabled && next.threshold === cur.threshold && next.tier === cur.tier && sameSignals;
  if (same) return { next: d, changed: false, audit: audit({ ...next, noop: true }) };
  d.syndication.content_engagement = {
    enabled: next.enabled,
    threshold: next.threshold,
    tier: next.tier,
    signals: { ...next.signals },
  };
  return { next: d, changed: true, audit: audit({ ...next }) };
}

/** SET (or clear, with an empty string) the Discord template for one content type. Idempotent. */
export function setTemplate(doc, { type, template, channel, stub } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const t = String(type || '').trim();
  if (!TEMPLATE_TYPES.includes(t)) throw new TemplateEditError(`the type must be one of: ${TEMPLATE_TYPES.join(', ')}`);
  const value = String(template ?? '').trim();
  const cap = BODY_TYPES.has(t) ? MAX_BODY_TEMPLATE : MAX_TEMPLATE;
  if (value.length > cap) throw new TemplateEditError(`a template is capped at ${cap} characters`);
  // SOW-088: with a channel, the edit targets syndication.channel_templates[channel][type] (an empty value
  // deletes the override so the field falls back to the shared map, then the built-in default).
  // SOW-088 Proposal A: stub=true targets the MEMBERS-stub maps with identical semantics.
  const isStub = stub === true;
  const chField = isStub ? 'channel_templates_stub' : 'channel_templates';
  const sharedField = isStub ? 'stub_templates' : 'templates';
  const ch = String(channel || '').trim();
  if (ch) {
    if (!SYNDICATION_CHANNEL_NAMES.includes(ch)) throw new TemplateEditError(`unknown channel "${ch}"`);
    const all = d.syndication[chField] && typeof d.syndication[chField] === 'object' && !Array.isArray(d.syndication[chField])
      ? d.syndication[chField] : {};
    const curCh = all[ch] && typeof all[ch] === 'object' && !Array.isArray(all[ch]) ? all[ch] : {};
    const existing = typeof curCh[t] === 'string' ? curCh[t].trim() : '';
    if (existing === value) return { next: d, changed: false, audit: auditEntry(ctx, t, { channel: ch, stub: isStub || undefined, template: value || null, noop: true }) };
    const nextCh = { ...curCh };
    if (value) nextCh[t] = value;
    else delete nextCh[t];
    const nextAll = { ...all };
    if (Object.keys(nextCh).length) nextAll[ch] = nextCh;
    else delete nextAll[ch]; // no overrides left for this channel
    if (Object.keys(nextAll).length) d.syndication[chField] = nextAll;
    else delete d.syndication[chField];
    return { next: d, changed: true, audit: auditEntry(ctx, t, { channel: ch, stub: isStub || undefined, template: value || null }) };
  }
  const cur = d.syndication[sharedField] && typeof d.syndication[sharedField] === 'object' && !Array.isArray(d.syndication[sharedField])
    ? d.syndication[sharedField] : {};
  const existing = typeof cur[t] === 'string' ? cur[t].trim() : '';
  if (existing === value) return { next: d, changed: false, audit: auditEntry(ctx, t, { stub: isStub || undefined, template: value || null, noop: true }) };
  const nextTemplates = { ...cur };
  if (value) nextTemplates[t] = value;
  else delete nextTemplates[t]; // fall back to the type default / the built-in message
  d.syndication[sharedField] = nextTemplates;
  return { next: d, changed: true, audit: auditEntry(ctx, t, { stub: isStub || undefined, template: value || null }) };
}

// SOW-088: the syndication PIPELINE settings (master switch, approval mode, hold window, per-channel
// switches), so the admin UI can run these without hand-editing the yml. Partial patch; hard validation;
// idempotent against the normalized current values.
// sow-159: Mastodon retired (see syndication-config-core CHANNELS). Dropped here too so its templates
// cannot be edited/created through the admin template surface.
// HAND-MAINTAINED DUPLICATE of CHANNELS (membership/syndication-config-core.mjs). It does not derive from it,
// so a channel added or retired there must be edited here too. sow-159 dropped 'mastodon', sow-217 dropped
// 'hashnode'. If this list and CHANNELS ever disagree, a superadmin can save a template for a channel the
// drain will never honour, which validates cleanly and then silently does nothing.
export const SYNDICATION_CHANNEL_NAMES = Object.freeze(['discord', 'discord-category', 'x', 'linkedin', 'bluesky', 'reddit', 'devto', 'dailydev']);

export function setSyndicationSettings(doc, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const cur = syndicationConfigFromParsed(doc);
  let changed = false;
  const detail = {};
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new TemplateEditError('enabled must be a boolean');
    if (enabled !== cur.enabled) { d.syndication.enabled = enabled; changed = true; detail.enabled = enabled; }
  }
  if (requireApproval !== undefined) {
    if (typeof requireApproval !== 'boolean') throw new TemplateEditError('requireApproval must be a boolean');
    if (requireApproval !== cur.require_approval) { d.syndication.require_approval = requireApproval; changed = true; detail.require_approval = requireApproval; }
  }
  if (holdMinutes !== undefined) {
    const h = Number(holdMinutes);
    if (!Number.isInteger(h) || h < 0 || h > 1440) throw new TemplateEditError('holdMinutes must be an integer between 0 and 1440');
    if (h !== cur.hold_minutes) { d.syndication.hold_minutes = h; changed = true; detail.hold_minutes = h; }
  }
  if (channels !== undefined) {
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new TemplateEditError('channels must be an object of { name: boolean }');
    for (const [name, on] of Object.entries(channels)) {
      if (!SYNDICATION_CHANNEL_NAMES.includes(name)) throw new TemplateEditError(`unknown channel "${name}"`);
      if (typeof on !== 'boolean') throw new TemplateEditError(`channel "${name}" must be a boolean`);
      if (Boolean(cur.channels?.[name]) !== on) {
        if (!d.syndication.channels || typeof d.syndication.channels !== 'object') d.syndication.channels = {};
        d.syndication.channels[name] = on;
        changed = true;
        (detail.channels ??= {})[name] = on;
      }
    }
  }
  // SOW-125: the per-type-per-channel auto-share matrix ({ type: { channel: 'off'|'on'|'popular' } }). Only
  // known auto types x auto channels + known modes survive; a cell that matches the current effective value is
  // NOT written (keeps the file minimal, defaults track the code).
  if (autoMatrix !== undefined) {
    if (!autoMatrix || typeof autoMatrix !== 'object' || Array.isArray(autoMatrix)) throw new TemplateEditError('autoMatrix must be an object of { type: { channel: mode } }');
    for (const [type, row] of Object.entries(autoMatrix)) {
      if (!AUTO_TYPES.includes(type)) throw new TemplateEditError(`unknown auto-share type "${type}"`);
      if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TemplateEditError(`autoMatrix.${type} must be an object of { channel: mode }`);
      for (const [ch, mode] of Object.entries(row)) {
        if (!MATRIX_CHANNELS.includes(ch)) throw new TemplateEditError(`"${ch}" is not an auto-share channel`);
        if (!AUTO_MODES.includes(mode)) throw new TemplateEditError(`auto-share mode for ${type}/${ch} must be one of ${AUTO_MODES.join(', ')}`);
        // A manual-capability channel (x, linkedin) cannot post automatically: the API refuses `on` outright
        // (the UI never offers it) instead of silently coercing, so the stored file always says what happens.
        if (mode === 'on' && channelCapability(ch) === 'manual') {
          throw new TemplateEditError(`${ch} cannot post automatically; use on-manual (the Social Queue)`);
        }
        if ((cur.auto_matrix?.[type]?.[ch] ?? 'off') !== mode) {
          if (!d.syndication.auto_matrix || typeof d.syndication.auto_matrix !== 'object') d.syndication.auto_matrix = {};
          if (!d.syndication.auto_matrix[type] || typeof d.syndication.auto_matrix[type] !== 'object') d.syndication.auto_matrix[type] = {};
          d.syndication.auto_matrix[type][ch] = mode;
          changed = true;
          ((detail.auto_matrix ??= {})[type] ??= {})[ch] = mode;
        }
      }
    }
  }
  // SOW-125: per-channel delay overrides in minutes ({ channel: minutes }). An empty string / null DELETES the
  // override (falls back to the global hold). Only known channels; 0..1440.
  if (channelHoldMinutes !== undefined) {
    if (!channelHoldMinutes || typeof channelHoldMinutes !== 'object' || Array.isArray(channelHoldMinutes)) throw new TemplateEditError('channelHoldMinutes must be an object of { channel: minutes }');
    for (const [name, mins] of Object.entries(channelHoldMinutes)) {
      if (!SYNDICATION_CHANNEL_NAMES.includes(name)) throw new TemplateEditError(`unknown channel "${name}"`);
      const clear = mins === '' || mins === null;
      let h = null;
      if (!clear) {
        h = Number(mins);
        if (!Number.isInteger(h) || h < 0 || h > 1440) throw new TemplateEditError(`channelHoldMinutes.${name} must be an integer between 0 and 1440`);
      }
      const curVal = cur.channel_hold_minutes?.[name];
      if (clear ? curVal !== undefined : curVal !== h) {
        if (!d.syndication.channel_hold_minutes || typeof d.syndication.channel_hold_minutes !== 'object') d.syndication.channel_hold_minutes = {};
        if (clear) delete d.syndication.channel_hold_minutes[name];
        else d.syndication.channel_hold_minutes[name] = h;
        changed = true;
        (detail.channel_hold_minutes ??= {})[name] = clear ? null : h;
      }
    }
  }
  if (!changed) return { next: doc, changed: false, audit: null };
  return { next: d, changed: true, audit: { ...auditEntry(ctx, 'settings', detail), action: 'syndication-settings.set' } };
}
