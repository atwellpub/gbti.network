// SOW-058 (+ SOW-057/087/111): the NODE-FREE syndication configuration core, shared by the signup Worker
// drain, the extension background (via admin-ops), the adapters, and the reconcile mirror. Pure functions
// operate on already-parsed objects (fixture-testable); the node-side file loader lives in
// membership/syndication-config.mjs (the SOW-015 overrides-core split pattern: this module must never import
// node builtins, or the MV3 extension bundle breaks).
//
// Everything fails closed to the SAFE default:
//   enabled            master switch. A missing/unparseable file or key leaves this false, so nothing is ever
//                      auto-syndicated by accident.
//   hold_minutes       the deliberate delay before a queued item goes out (default 60). The superadmin can
//                      cancel during this window. Coerced to a non-negative integer.
//   upvote_threshold   SOW-057: distinct non-author members required to enqueue a share (default 2). Coerced
//                      to an integer >= 1; a smaller/invalid value falls back to the default (never below 1).
//   channels           DEPRECATED (SOW-131): the legacy per-channel master switches. No longer a delivery gate:
//                      channel enablement is now MATRIX-DERIVED (a channel is on iff the auto-share matrix routes
//                      any content type to it). Kept in the schema/mirror for backward compatibility, but unread
//                      for delivery. A channel still requires its secret at drain time (else recorded "skipped").
//
// The config carries NO secrets; channel API tokens live only in the Worker secret store. Reconcile mirrors the
// normalized config (minus nothing sensitive) to the KV key `synd:config` so the Worker reads the live values
// without a redeploy (the overrides:mirror precedent).

export const SYNDICATION_CONFIG_PATH = 'house/syndication-config.yml';
export const SYNDICATION_MIRROR_KEY = 'synd:config';

// The canonical channel set. Adding a channel here makes it a recognized, normalizable flag.
// SOW-087: `discord-category` is the SECOND Discord post — the same item posted again to the channel mapped to
// its category in house/content-channels.yml (the featured per-type `discord` post is unchanged). A first-class
// channel so it gets its own on/off switch and its own per-channel idempotency in the queue.
// sow-159: Mastodon is RETIRED (the fediverse turn-away, 2026-07-28). Removing it from CHANNELS is the
// master disconnect: MATRIX_CHANNELS, AUTO_CHANNELS, enabledChannelNames, and every auto/deliver/popular
// routing helper derive from this list, so the drain can never route a Mastodon post again. All the
// Mastodon infra (the adapter, CHANNEL_CAPABILITY.mastodon below, the stubs, secret keys, and the
// {member-mastodon-handle} format plumbing) is LEFT on disk inert; re-enabling is re-adding 'mastodon' here.
// Re-implementation runbook: .data/ops/channel-ops/mastadon.md.
export const CHANNELS = Object.freeze(['discord', 'discord-category', 'x', 'linkedin', 'bluesky', 'reddit', 'devto', 'hashnode', 'dailydev']);
// SOW-088: the channels a per-channel TEMPLATE override may target (the admin Channels tab tiles). Same set
// as the pipeline switches; blank/missing overrides fall back to the shared `templates` map, then built-ins.
export const TEMPLATE_CHANNELS = CHANNELS;

// SOW-125: the SINGLE source of truth for a channel's delivery capability. `auto` = a built adapter the drain
// posts to; `manual` = a built rendering but a human posts it by hand (X after its free tier, Social Queue);
// `building` = no adapter yet. The admin tiles + pipeline chips + the auto-share matrix all derive from THIS,
// so adding a future channel (or promoting one from building to auto) is a ONE-LINE change here. A channel not
// listed defaults to `building`. Substack is intentionally absent from CHANNELS (no config flag); the UI adds
// it as a static manual tile.
export const CHANNEL_CAPABILITY = Object.freeze({
  discord: 'auto',
  'discord-category': 'auto',
  reddit: 'auto',
  devto: 'auto',
  // SOW-134 built the full-body auto adapter, but Hashnode retired its free GraphQL API (2026-05-13): API
  // publishing now needs a paid Pro plan on the publication. Owner-decided: keep Hashnode as a MANUAL-assist
  // channel (a Social Queue task a superadmin posts by hand) instead of paying for Pro. The adapter is kept but
  // never called (manual channels are hard-excluded from the adapter run); flip back to 'auto' if Pro is added.
  hashnode: 'manual', // SOW-134 + manual pivot: no Pro, so hand-post to gbti.hashnode.dev via the Social Queue
  mastodon: 'auto', // SOW-123
  bluesky: 'auto', // SOW-122
  x: 'manual', // SOW-120: the adapter renders, but posting is manual-assist (the free API tier was deprecated)
  dailydev: 'manual', // SOW-135: manual-assist to the GBTI daily.dev squad (no public squad-post API)
  linkedin: 'manual', // SOW-127: manual-assist until Community Management API access is granted (business
  // verification failed; the appeal is pending). The text is rendered + queued to the Social Queue; a
  // superadmin posts it by hand through the free LinkedIn composer. No LinkedIn API token is used.
});
/** A channel's delivery capability (`auto` | `manual` | `building`); an unknown channel is `building`. */
export function channelCapability(name) { return CHANNEL_CAPABILITY[name] ?? 'building'; }

// SOW-125: the content types that can auto-share (distinct from TEMPLATE_TYPES, which also holds reddit-body
// etc.). The auto-share MATRIX covers every DELIVERABLE channel (auto + manual), because the owner controls
// on/off/popular per (type, channel) for every channel they see in the UI, including X (manual-assist). The
// `auto` subset drives the drain's adapter posts + the per-channel delay; a `manual` channel that is `on`
// enqueues a Social Queue task instead. `building` channels (no adapter, e.g. LinkedIn) are excluded.
export const AUTO_TYPES = Object.freeze(['share', 'post', 'product', 'prompt']);
export const AUTO_CHANNELS = Object.freeze(CHANNELS.filter((c) => CHANNEL_CAPABILITY[c] === 'auto'));
export const MATRIX_CHANNELS = Object.freeze(CHANNELS.filter((c) => channelCapability(c) !== 'building'));
// The per-cell auto-share mode. `off` = never; `on` = On-Automatic (auto-enqueue at publish; the adapter
// posts after the hold); `on-manual` = On-Manual (enqueue at publish, but deliver as a superadmin Social
// Queue task for review instead of an adapter post; the ONLY deliverable mode for a `manual`-capability
// channel, and available on ANY channel the owner wants moderated); `popular` = enqueue only when the
// member-activity tracker deems it popular (the engine promotes with trigger:'popular').
export const AUTO_MODES = Object.freeze(['off', 'on', 'on-manual', 'popular']);
/** The fail-closed default cell for a type: shares OFF (the owner ask), every other type ON (today's behavior). */
export function defaultAutoMode(type) { return type === 'share' ? 'off' : 'on'; }

// SOW-087: how a share's topic category is suggested at compose time. `ai` = Workers AI with a keyword
// fallback; `keyword` = the free keyword match only; `off` = no suggestion (the member picks by hand).
export const CLASSIFY_MODES = Object.freeze(['ai', 'keyword', 'off']);

// SOW-111: which membership tiers count toward the news engagement auto-share. Banned is ALWAYS excluded
// (the Worker gates by effective status, and a banned account is denied before any KV write).
export const NEWS_ENGAGEMENT_TIERS = Object.freeze(['paid', 'paid-trial', 'signed-in']);

export const DEFAULT_NEWS_ENGAGEMENT = Object.freeze({
  enabled: false, // fail-closed: nothing auto-posts until the owner flips it in house/syndication-config.yml
  open_threshold: 2, // distinct members opening the detail view before the item auto-posts
  tier: 'paid', // whose engagement counts (owner-toggleable in the admin Channels tab)
  comment_autopost: true, // one comment posts immediately (deliberate engagement)
});

// SOW-126: the ENGINE behind the SOW-125 `popular` matrix state. When enough DISTINCT members engage with a
// member content item, the reconcile promotes it to auto-share on its `popular` channels. Which signals count
// (opening the expanded reader view, favoriting, upvoting, commenting) + the threshold + the counting tier are
// all admin-editable (the owner may retune what qualifies). Fail-closed: disabled until the owner turns it on.
// Tiers reuse NEWS_ENGAGEMENT_TIERS (banned always excluded; the author never counts toward their own item).
export const CONTENT_ENGAGEMENT_SIGNALS = Object.freeze(['opens', 'favorites', 'upvotes', 'comments']);
export const DEFAULT_CONTENT_ENGAGEMENT = Object.freeze({
  enabled: false,
  threshold: 3, // distinct engaged members before a `popular` item promotes (tunable; the network is small)
  tier: 'signed-in', // whose engagement counts (any non-banned signed-in member by default)
  signals: Object.freeze({ opens: true, favorites: false, upvotes: false, comments: false }), // opens = the owner's chosen counter
});

// SOW-087: per-type Discord post templates. Variables: {memberdiscord} (the resolved <@id> mention, falling
// back to the no-ping full name when none resolves), {member-discord-username} (the mention, else the public
// profile Discord handle, else the GitHub username; SOW-088), {content-type} (article/product/prompt/link),
// {fullName}, {author}, {shareurl}/{url}, {title}, {category}. A type with no template gets its default.
export const TEMPLATE_TYPES = Object.freeze(['share', 'post', 'product', 'prompt', 'reddit-body', 'reddit-comment', 'devto-intro', 'devto-body', 'devto-footer', 'devto-stub', 'hashnode-intro', 'hashnode-body', 'hashnode-footer', 'hashnode-stub']);
// SOW-088 (owner-directed): ONE default Discord format for every type.
const DEFAULT_FORMAT = 'New {content-type} published by {member-discord-username}: "{title}" {url}';
// sow-180: a SHARE is somebody else's link, so its default is CONTENT-first with NO member credit (unlike the
// post/product/prompt DEFAULT_FORMAT, which correctly credits the author of their own work).
const DEFAULT_SHARE_FORMAT = 'Shared on the GBTI Network: "{title}" {url}';
// SOW-088: the Reddit BODY template = the DESCRIPTION under the title on the link post (the embed card
// comes from the item URL automatically); the COMMENT template = the separately-controlled first comment
// (owner-directed 2026-07-10: keep both, templated independently). Editable in the admin templates card.
const DEFAULT_REDDIT_BODY = '{short-description}';
// SOW-088: the dev.to byline prepended to the full-body crosspost (the owner's example post shape).
// SOW-140: the byline first MENTIONS the member's own dev.to profile ({member-devto-handle} -> @handle, which
// links + notifies on dev.to) and falls back to their name; the gbti.network profile link moves onto "GBTI
// Network Member" so it survives both cases.
const DEFAULT_DEVTO_INTRO = '**By {member-devto-handle}, [GBTI Network Member]({member-url}).** Originally published on [gbti.network]({url}).';
// SOW-140: Hashnode keeps the NAME-based byline (a member's dev.to handle is not their Hashnode handle, so the
// dev.to mention must not leak onto a Hashnode post). A parallel {member-hashnode-handle} can be added later.
const DEFAULT_HASHNODE_INTRO = '**By [{fullName}]({member-url}), GBTI Network Member.** Originally published on [gbti.network]({url}).';
// SOW-138: the PUBLIC crosspost BODY template for dev.to + Hashnode. `{body}` expands to the full published
// article VERBATIM (byline + this + CTA footer wrap it). The default `{body}` reproduces today's post exactly;
// admins may wrap the article or replace it with custom copy. The MEMBERS body stays the stub (devto-stub).
const DEFAULT_DEVTO_BODY = '{body}';
// The CTA appended to EVERY dev.to post, full and stub alike (owner-authored, mirroring the Reddit
// first-comment closing).
const DEFAULT_DEVTO_FOOTER = '---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}\'s work more closely, consider joining our network and subscribing to them directly: {member-url}';
// SOW-088 + side-quest 2026-07-16: the Reddit first comment credits the poster. It uses {short-description}
// (which BOTH content items and SHARES carry) rather than {author-note-italic} (a posts/products/prompts-only
// intro), so it also fires for a share; the popup's _redditStored guard blanks a comment that references the
// author note when none exists, which is why a share got no crediting comment before.
// The first comment credits the member's Reddit username when their profile lists one ({member-reddit-handle}
// renders u/name, which Reddit links natively), falling back to the full name, matching X/Bluesky/Mastodon.
const DEFAULT_REDDIT_COMMENT = 'Shared to the community by GBTI Network member {member-reddit-handle}. {short-description}\n\n---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}\'s work more closely, consider joining our network and subscribing to them directly: {member-url}';
export const DEFAULT_TEMPLATES = Object.freeze({
  share: DEFAULT_SHARE_FORMAT, // sow-180: content-first, no member credit
  post: DEFAULT_FORMAT,
  product: DEFAULT_FORMAT,
  prompt: DEFAULT_FORMAT,
  'reddit-body': DEFAULT_REDDIT_BODY,
  'reddit-comment': DEFAULT_REDDIT_COMMENT,
  'devto-intro': DEFAULT_DEVTO_INTRO,
  'devto-body': DEFAULT_DEVTO_BODY, // SOW-138
  'devto-footer': DEFAULT_DEVTO_FOOTER,
  // SOW-134: Hashnode reuses the same CTA footer as dev.to (both are full-body crossposts with a canonical link
  // home); admins can diverge them per channel. SOW-140: the byline default is NAME-based here (not the dev.to
  // handle), since a member's dev.to profile is the wrong platform to mention on Hashnode.
  'hashnode-intro': DEFAULT_HASHNODE_INTRO,
  'hashnode-body': DEFAULT_DEVTO_BODY, // SOW-138
  'hashnode-footer': DEFAULT_DEVTO_FOOTER,
});

// SOW-088 Proposal A (owner-approved 2026-07-11): every channel gets a distinct template SET for
// MEMBERS-ONLY (stub) items. Built-in defaults carry tasteful per-channel differentiation (the owner
// rider): each channel's default stub reads native to that channel with no configuration. Keys with no
// stub built-in (reddit-comment, devto-intro, devto-footer) inherit the public chain.
const STUB_FORMAT = 'Members-only on the GBTI Network: "{title}" by {fullName}. {short-description} {url}';
// sow-180: the members-only SHARE stub keeps the join CTA but drops the member name (a share is not the
// member's own work). Members-only shares do not syndicate today (only PUBLIC shares do), so this is
// defense-in-depth, kept consistent with the public share family and guarded by a test.
const SHARE_STUB_FORMAT = 'A members-only link on the GBTI Network: "{title}". {short-description} Join to open it: {url}';
export const DEFAULT_STUB_TEMPLATES = Object.freeze({
  share: SHARE_STUB_FORMAT, // sow-180: content-first, no member credit
  post: STUB_FORMAT,
  product: STUB_FORMAT,
  prompt: STUB_FORMAT,
  'reddit-body': '{short-description}\n\nThis {content-type} is part of the GBTI Network members library. Membership unlocks the full piece: {url}',
  'devto-stub': '{short-description}\n\n**[Read the full {content-type} on gbti.network]({url}).** Membership unlocks it, and members earn from the work they publish.',
  'hashnode-stub': '{short-description}\n\n**[Read the full {content-type} on gbti.network]({url}).** Membership unlocks it, and members earn from the work they publish.', // SOW-134
});
const DISCORD_STUB = '{member-discord-username} published a members-only {content-type}: "{title}". Members can read it on gbti.network. {url}';
// A members SHARE is just an external link, so it posts the destination directly (no "read it on
// gbti.network", which points off-site): owner-directed 2026-07-13.
const DISCORD_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}" {url}'; // sow-180: no member credit
const DISCORD_CAT_STUB = 'A members-only {content-type} landed in {category}: "{title}" by {member-discord-username}. {url}';
const DISCORD_CAT_SHARE_STUB = 'A members-only link in {category}: "{title}" {url}'; // sow-180: no member credit
const REDDIT_TITLE_STUB = '{title} (a members-only {content-type} from the GBTI Network)';
// SOW-120: X is 280 chars, so the stub is a tight hook plus the link (X auto-cards the URL). A members
// share posts the destination directly; a members post/product/prompt invites the reader to unlock it.
const X_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
const X_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}'; // sow-180: no member credit
// SOW-127: LinkedIn is long-form (a 3000-char cap), so its stub reads as a full sentence.
const LINKEDIN_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Join the co-op to unlock it. {url}';
const LINKEDIN_SHARE_STUB = 'A members-only find on the GBTI Network: "{title}". Join the co-op to open it. {url}'; // sow-180: no member credit
// SOW-122: Bluesky stubs omit {url} because the adapter attaches an external embed card for the link.
const BLUESKY_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it.';
const BLUESKY_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it.'; // sow-180: no member credit
// SOW-123: Mastodon includes {url} (Mastodon auto-links + builds a preview card from it).
const MASTODON_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
const MASTODON_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}'; // sow-180: no member credit
// SOW-135: daily.dev is a link-share squad, so the members stub is a tight hook plus the link (mirrors X).
const DAILYDEV_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
const DAILYDEV_SHARE_STUB = 'A members-only link on the GBTI Network: "{title}". Join to open it. {url}'; // sow-180: no member credit
export const DEFAULT_CHANNEL_STUB_TEMPLATES = Object.freeze({
  discord: Object.freeze({ share: DISCORD_SHARE_STUB, post: DISCORD_STUB, product: DISCORD_STUB, prompt: DISCORD_STUB }),
  'discord-category': Object.freeze({ share: DISCORD_CAT_SHARE_STUB, post: DISCORD_CAT_STUB, product: DISCORD_CAT_STUB, prompt: DISCORD_CAT_STUB }),
  reddit: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  // dev.to titles are article titles: a clean suffix, never the sentence-shaped shared stub.
  devto: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  // SOW-134: Hashnode titles are article titles too, so it mirrors dev.to's clean title suffix.
  // Hashnode is now a MANUAL-assist channel (the task text is a full message, not an article-title suffix), so
  // its members stub is sentence-shaped like the other manual channels.
  hashnode: Object.freeze({ share: DAILYDEV_SHARE_STUB, post: DAILYDEV_STUB, product: DAILYDEV_STUB, prompt: DAILYDEV_STUB }),
  x: Object.freeze({ share: X_SHARE_STUB, post: X_STUB, product: X_STUB, prompt: X_STUB }),
  linkedin: Object.freeze({ share: LINKEDIN_SHARE_STUB, post: LINKEDIN_STUB, product: LINKEDIN_STUB, prompt: LINKEDIN_STUB }), // SOW-127
  dailydev: Object.freeze({ share: DAILYDEV_SHARE_STUB, post: DAILYDEV_STUB, product: DAILYDEV_STUB, prompt: DAILYDEV_STUB }), // SOW-135
  bluesky: Object.freeze({ share: BLUESKY_SHARE_STUB, post: BLUESKY_STUB, product: BLUESKY_STUB, prompt: BLUESKY_STUB }),
  mastodon: Object.freeze({ share: MASTODON_SHARE_STUB, post: MASTODON_STUB, product: MASTODON_STUB, prompt: MASTODON_STUB }),
});

export const DEFAULT_SYNDICATION_CONFIG = Object.freeze({
  enabled: false,
  require_approval: true, // SOW-058: opt-IN by default — NOTHING posts until a superadmin approves it
  hold_minutes: 60,
  upvote_threshold: 2,
  classify: 'ai', // SOW-087: the share category suggestion mode
  templates: DEFAULT_TEMPLATES, // SOW-087: per-type Discord templates (missing/empty type = its default)
  channel_templates: Object.freeze({}), // SOW-088: per-channel template OVERRIDES (channel -> type -> template)
  stub_templates: Object.freeze({}), // SOW-088 Proposal A: the shared MEMBERS-stub set (configured only)
  channel_templates_stub: Object.freeze({}), // SOW-088 Proposal A: per-channel stub overrides
  news_engagement: DEFAULT_NEWS_ENGAGEMENT, // SOW-111: engagement-triggered news auto-share
  content_engagement: DEFAULT_CONTENT_ENGAGEMENT, // SOW-126: engagement-triggered content auto-share (the `popular` engine)
  channels: Object.freeze({ discord: false, 'discord-category': false, x: false, linkedin: false, mastodon: false, bluesky: false, reddit: false, devto: false, hashnode: false, dailydev: false }),
  // SOW-121: channels the system NEVER auto-posts to (their adapter is never called). Instead a
  // superadmin manual-assist task is enqueued (Social Queue) and a human posts it by hand. Used for
  // pay-to-post channels like X after the free API tier was deprecated. A channel here should be OFF in
  // `channels` (the two are mutually exclusive: auto-post vs manual-assist).
  manual_assist_channels: Object.freeze([]),
  // SOW-125: per-type-per-channel auto-share modes (off | on | popular). Layers on `channels` (a channel must
  // also be enabled + have its secret). The default (an absent matrix) is shares OFF, every other type ON.
  auto_matrix: buildDefaultAutoMatrix(),
  // SOW-125: per-channel delay override in minutes (absent -> the global hold_minutes). Lets one channel post
  // sooner/later than another for the same item.
  channel_hold_minutes: Object.freeze({}),
});

// SOW-125: the fail-closed default matrix (shares off everywhere, every other type on for every deliverable
// channel — auto + manual). Backward compatible: a post/product/prompt keeps auto-posting to its enabled auto
// channels and keeps enqueuing an X manual task, while a share does neither.
function buildDefaultAutoMatrix() {
  const m = {};
  for (const t of AUTO_TYPES) { m[t] = {}; for (const ch of MATRIX_CHANNELS) m[t][ch] = defaultAutoMode(t); Object.freeze(m[t]); }
  return Object.freeze(m);
}

function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1; // YAML may parse a bare 1/0 as a number
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  }
  return fallback;
}

function asHoldMinutes(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function asThreshold(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 1 ? i : fallback; // never below 1 (a threshold of 0 would syndicate on any single vote)
}

function asClassifyMode(v, fallback) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return CLASSIFY_MODES.includes(s) ? s : fallback;
}

// SOW-111: normalize the news engagement block; every field falls back to its fail-closed default.
function normalizeNewsEngagement(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_NEWS_ENGAGEMENT;
  const tier = typeof src.tier === 'string' && NEWS_ENGAGEMENT_TIERS.includes(src.tier.trim().toLowerCase())
    ? src.tier.trim().toLowerCase() : d.tier;
  return Object.freeze({
    enabled: asBool(src.enabled, d.enabled),
    open_threshold: asThreshold(src.open_threshold, d.open_threshold),
    tier,
    comment_autopost: asBool(src.comment_autopost, d.comment_autopost),
  });
}

// SOW-126: normalize the content engagement block; every field fail-closed. `signals` is the set of interactions
// that count (each a bool). `threshold` is the distinct-engaged-member count (>= 1). `tier` reuses the news tiers.
function normalizeContentEngagement(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_CONTENT_ENGAGEMENT;
  const tier = typeof src.tier === 'string' && NEWS_ENGAGEMENT_TIERS.includes(src.tier.trim().toLowerCase())
    ? src.tier.trim().toLowerCase() : d.tier;
  const rawSignals = src.signals && typeof src.signals === 'object' && !Array.isArray(src.signals) ? src.signals : {};
  const signals = {};
  for (const s of CONTENT_ENGAGEMENT_SIGNALS) signals[s] = asBool(rawSignals[s], d.signals[s]);
  return Object.freeze({
    enabled: asBool(src.enabled, d.enabled),
    threshold: asThreshold(src.threshold, d.threshold),
    tier,
    signals: Object.freeze(signals),
  });
}

// SOW-087: a missing/blank per-type template falls back to its default (an absent default = built-in message).
function normalizeTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === 'string' ? src[t].trim() : '';
    const d = DEFAULT_TEMPLATES[t];
    if (v) out[t] = v;
    else if (d) out[t] = d;
  }
  return Object.freeze(out);
}

// SOW-088: per-channel template overrides. Only known channels and types survive; blanks are dropped (they
// mean "fall back"), and a channel with no surviving overrides is omitted entirely.
function normalizeChannelTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const ch of TEMPLATE_CHANNELS) {
    const block = src[ch];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const kept = {};
    for (const t of TEMPLATE_TYPES) {
      const v = typeof block[t] === 'string' ? block[t].trim() : '';
      if (v) kept[t] = v;
    }
    if (Object.keys(kept).length) out[ch] = Object.freeze(kept);
  }
  return Object.freeze(out);
}

// The stub maps are CONFIGURED-ONLY (never fold defaults in; the 2026-07-10 mirror lesson): resolution
// consults the defaults at read time so code-default changes track deploys.
function normalizeConfiguredTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === 'string' ? src[t].trim() : '';
    if (v) out[t] = v;
  }
  return Object.freeze(out);
}

function normalizeChannels(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const name of CHANNELS) out[name] = asBool(src[name], DEFAULT_SYNDICATION_CONFIG.channels[name]);
  return Object.freeze(out);
}

// SOW-121: the manual-assist channel list (only known channel names, de-duplicated).
function normalizeManualAssist(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const v of list) { const s = String(v ?? '').trim(); if (CHANNELS.includes(s) && !out.includes(s)) out.push(s); }
  return Object.freeze(out);
}

// SOW-125: coerce a cell to a known auto-share mode; anything else falls back to the type default.
function asAutoMode(v, fallback) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return AUTO_MODES.includes(s) ? s : fallback;
}

// SOW-125: normalize the per-type-per-channel matrix over the KNOWN types x auto channels only. An absent cell
// (or absent matrix) falls back to defaultAutoMode(type) — shares off, the rest on — so an old config with no
// matrix behaves as before EXCEPT shares stop auto-posting.
function normalizeAutoMatrix(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of AUTO_TYPES) {
    const row = src[t] && typeof src[t] === 'object' && !Array.isArray(src[t]) ? src[t] : {};
    out[t] = {};
    for (const ch of MATRIX_CHANNELS) {
      let m = asAutoMode(row[ch], defaultAutoMode(t));
      // A `manual`-capability channel (x, linkedin) cannot auto-post: `on` coerces to `on-manual`, so an
      // old config/mirror keeps exactly its prior behavior (X/LinkedIn `on` already delivered as tasks).
      if (m === 'on' && channelCapability(ch) === 'manual') m = 'on-manual';
      out[t][ch] = m;
    }
    Object.freeze(out[t]);
  }
  return Object.freeze(out);
}

// SOW-125: normalize the per-channel delay override. Only KNOWN channels with a finite value survive (as a
// non-negative integer of minutes); an absent channel means "use the global hold_minutes".
function normalizeChannelHoldMinutes(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const ch of CHANNELS) {
    if (src[ch] === undefined || src[ch] === null || src[ch] === '') continue;
    const n = Number(src[ch]);
    if (Number.isFinite(n)) out[ch] = Math.max(0, Math.floor(n));
  }
  return Object.freeze(out);
}

/**
 * Normalize a parsed syndication-config.yml ({ syndication: {...} } or a bare {...}) into a validated config.
 * Unknown/missing keys fall back to DEFAULT_SYNDICATION_CONFIG. Never throws.
 */
export function syndicationConfigFromParsed(parsed) {
  const raw = parsed?.syndication ?? parsed ?? {};
  const d = DEFAULT_SYNDICATION_CONFIG;
  return Object.freeze({
    enabled: asBool(raw.enabled, d.enabled),
    require_approval: asBool(raw.require_approval, d.require_approval),
    hold_minutes: asHoldMinutes(raw.hold_minutes, d.hold_minutes),
    upvote_threshold: asThreshold(raw.upvote_threshold, d.upvote_threshold),
    classify: asClassifyMode(raw.classify, d.classify),
    templates: normalizeTemplates(raw.templates),
    channel_templates: normalizeChannelTemplates(raw.channel_templates),
    stub_templates: normalizeConfiguredTemplates(raw.stub_templates),
    channel_templates_stub: normalizeChannelTemplates(raw.channel_templates_stub),
    news_engagement: normalizeNewsEngagement(raw.news_engagement),
    content_engagement: normalizeContentEngagement(raw.content_engagement), // SOW-126
    channels: normalizeChannels(raw.channels),
    manual_assist_channels: normalizeManualAssist(raw.manual_assist_channels), // SOW-121
    auto_matrix: normalizeAutoMatrix(raw.auto_matrix), // SOW-125
    channel_hold_minutes: normalizeChannelHoldMinutes(raw.channel_hold_minutes), // SOW-125
  });
}

/** Master switch: may anything be enqueued/syndicated at all? */
export function isSyndicationEnabled(cfg) {
  return cfg?.enabled === true;
}

/** SOW-058: when true (the default), the drain posts ONLY superadmin-approved items; a pending item never posts on
 *  its own. Fail-safe: anything other than an explicit false means approval IS required. */
export function requiresApproval(cfg) {
  return cfg?.require_approval !== false;
}

/** The hold window in milliseconds (hold_minutes * 60000). */
export function holdMs(cfg) {
  return asHoldMinutes(cfg?.hold_minutes, DEFAULT_SYNDICATION_CONFIG.hold_minutes) * 60_000;
}

/** The SOW-057 distinct-non-author-voter threshold. */
export function upvoteThreshold(cfg) {
  return asThreshold(cfg?.upvote_threshold, DEFAULT_SYNDICATION_CONFIG.upvote_threshold);
}

/** SOW-087: the share category suggestion mode (`ai` | `keyword` | `off`). Invalid/missing = `ai`. */
export function classifyMode(cfg) {
  return asClassifyMode(cfg?.classify, DEFAULT_SYNDICATION_CONFIG.classify);
}

/** SOW-111: the normalized news engagement settings ({ enabled, open_threshold, tier, comment_autopost }). */
export function newsEngagement(cfg) {
  return normalizeNewsEngagement(cfg?.news_engagement);
}

/** SOW-126: the normalized content engagement settings ({ enabled, threshold, tier, signals{...} }). */
export function contentEngagement(cfg) {
  return normalizeContentEngagement(cfg?.content_engagement);
}

/** SOW-087 (+ SOW-088): the configured template for a source type, or null (= the built-in message).
 *  With a channel, the chain is channel override -> the shared map -> the built-in default. With
 *  { stub: true } (a members-only item) the STUB chain runs first: channel stub override -> shared stub
 *  -> the per-channel built-in stub -> the shared built-in stub -> then the full public chain. */
export function templateFor(cfg, source, channel, { stub = false, channelOnly = false } = {}) {
  if (stub) {
    const cs = channel ? cfg?.channel_templates_stub?.[channel]?.[source] : null;
    if (typeof cs === 'string' && cs.trim()) return cs.trim();
    if (!channelOnly) {
      const ss = cfg?.stub_templates?.[source];
      if (typeof ss === 'string' && ss.trim()) return ss.trim();
    }
    const dc = channel ? DEFAULT_CHANNEL_STUB_TEMPLATES[channel]?.[source] : null;
    if (dc) return dc;
    if (!channelOnly && DEFAULT_STUB_TEMPLATES[source]) return DEFAULT_STUB_TEMPLATES[source];
    // no stub-specific template anywhere: fall through to the public chain
  }
  const o = channel ? cfg?.channel_templates?.[channel]?.[source] : null;
  if (typeof o === 'string' && o.trim()) return o.trim();
  // channelOnly (SOW-088: reddit/devto TITLES): the shared per-type map is Discord-voiced message copy
  // and must never become a post title; the caller supplies its own fallback (usually {title}).
  if (channelOnly) return null;
  const t = cfg?.templates?.[source];
  return typeof t === 'string' && t.trim() ? t.trim() : (DEFAULT_TEMPLATES[source] ?? null);
}

/** SOW-131: MATRIX-DERIVED channel enablement. A channel is "enabled" iff the auto-share matrix routes ANY content
 *  type to it (any cell not `off`, i.e. `on` or `popular`). The legacy per-channel `channels` master switch is no
 *  longer a gate (the matrix is the single source of truth); its secret presence is still checked at drain time. */
export function isChannelEnabled(cfg, name) {
  return MATRIX_CHANNELS.includes(name) && AUTO_TYPES.some((t) => autoModeFor(cfg, t, name) !== 'off');
}

/** SOW-131: the channel names the matrix routes to (any cell not `off`); still subject to secret presence at drain
 *  time. Drives resolveAdapterRun. Only MATRIX (non-building) channels can be enabled. */
export function enabledChannelNames(cfg) {
  return MATRIX_CHANNELS.filter((name) => isChannelEnabled(cfg, name));
}

/** SOW-121, DEPRECATED for routing: `manual_assist_channels` no longer decides where a post goes (the
 *  matrix cell `on-manual` does, and `CHANNEL_CAPABILITY` says which channels can never auto-post). Kept
 *  parsed + exported only so old configs/mirrors and any straggler reader do not break. */
export function isManualAssist(cfg, name) {
  return Array.isArray(cfg?.manual_assist_channels) && cfg.manual_assist_channels.includes(name);
}

/** SOW-121, DEPRECATED for routing (see isManualAssist). */
export function manualAssistChannels(cfg) {
  return Array.isArray(cfg?.manual_assist_channels) ? [...cfg.manual_assist_channels] : [];
}

/** Is this (type, channel) routed to the Social Queue (`on-manual`)? A superadmin reviews the rendered
 *  post there and sends it (one click for an auto-capability channel, by hand for x/linkedin). */
export function isManualMode(cfg, type, channel) {
  return autoModeFor(cfg, type, channel) === 'on-manual';
}

/** Every channel whose cell is `on-manual` for this type (any capability). Drives the drain's task loop. */
export function manualQueueChannelsForType(cfg, type) {
  return MATRIX_CHANNELS.filter((ch) => isManualMode(cfg, type, ch));
}

/** SOW-125: the auto-share mode (`off` | `on` | `on-manual` | `popular`) for a (type, channel). Falls back
 *  to the type default (shares off, the rest on) for a known type + MATRIX channel; `off` for anything
 *  unknown. The capability coercion applies HERE too (not only in normalize), so a raw un-normalized config
 *  can never report `on` for a `manual`-capability channel. */
export function autoModeFor(cfg, type, channel) {
  const v = cfg?.auto_matrix?.[type]?.[channel];
  const m = AUTO_MODES.includes(v)
    ? v
    : (AUTO_TYPES.includes(type) && MATRIX_CHANNELS.includes(channel) ? defaultAutoMode(type) : 'off');
  return m === 'on' && channelCapability(channel) === 'manual' ? 'on-manual' : m;
}

/** SOW-125: is this (type, channel) set to deliver at publish time (`on`)? `popular` and `off` are not. For an
 *  auto channel this drives an adapter post; for a manual channel it drives a Social Queue task. */
export function isAutoOn(cfg, type, channel) {
  return autoModeFor(cfg, type, channel) === 'on';
}

/** SOW-125: the AUTO (adapter-posted) channels a type publishes to — matrix cell `on` (still subject to secret
 *  presence at drain time). SOW-131: matrix-only, no separate `channels` gate. Drives the earliest-hold seed. */
export function autoChannelsForType(cfg, type) {
  return AUTO_CHANNELS.filter((ch) => isAutoOn(cfg, type, ch));
}

/** SOW-125: EVERY channel that will DELIVER this type at publish — cell `on` (an auto-capability adapter
 *  post) OR cell `on-manual` (a Social Queue task, any capability). Routing is matrix-only: neither the
 *  legacy `channels` switches nor `manual_assist_channels` gate this. Empty = the publish-time enqueue
 *  skips the type. */
export function deliverChannelsForType(cfg, type) {
  return MATRIX_CHANNELS.filter((ch) => {
    const m = autoModeFor(cfg, type, ch);
    return (m === 'on' && channelCapability(ch) === 'auto') || m === 'on-manual';
  });
}

/** SOW-126: the channels a type would deliver to WHEN PROMOTED as popular — matrix cell `popular` (any
 *  capability; the drain routes by capability: adapter post vs Social Queue task). The engagement engine
 *  enqueues a promoted item with `trigger:'popular'` to exactly this set; a plain publish never hits it. */
export function popularChannelsForType(cfg, type) {
  return MATRIX_CHANNELS.filter((ch) => autoModeFor(cfg, type, ch) === 'popular');
}

/** SOW-125: the hold window in ms for a specific channel — the per-channel override if set, else the global. */
export function channelHoldMs(cfg, channel) {
  const v = cfg?.channel_hold_minutes?.[channel];
  if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Math.max(0, Math.floor(Number(v))) * 60_000;
  return holdMs(cfg);
}

/** SOW-125: ONLY the EXPLICIT per-channel override in ms, or 0 when none — NO global fallback. Used in the
 *  APPROVAL model: a superadmin approval is "post now", so a no-override channel gets a 0 delay from approval
 *  (posts on the next tick), while an explicit override still staggers that channel from the approval time. The
 *  global hold_minutes is the pre-approval cancel window there, NOT an additional post-approval delay. */
export function explicitChannelHoldMs(cfg, channel) {
  const v = cfg?.channel_hold_minutes?.[channel];
  if (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v))) return Math.max(0, Math.floor(Number(v))) * 60_000;
  return 0;
}

/** SOW-125: the item-level hold for a TYPE = the MIN per-channel hold across its auto-`on` channels, so the item
 *  becomes drain-eligible (availableAt) as soon as its EARLIEST channel is due. Falls back to the global hold
 *  when the type has no on-channel (defensive; the enqueue script already skips such items). This makes a
 *  per-channel override BELOW the global hold actually post early, so it is a true override, not just a floor. */
export function earliestChannelHoldMs(cfg, type) {
  const chans = autoChannelsForType(cfg, type);
  if (!chans.length) return holdMs(cfg);
  return Math.min(...chans.map((ch) => channelHoldMs(cfg, ch)));
}

/** The small, secret-free object reconcile writes to the KV mirror (synd:config) and the Worker reads back. */
export function toSyndicationMirror(cfg) {
  const c = syndicationConfigFromParsed(cfg);
  // Templates carry ONLY the CONFIGURED values (never the folded-in defaults): every mirror reader
  // re-normalizes via syndicationConfigFromParsed, so code-default changes apply on deploy instead of
  // being frozen into KV as if an admin had configured them (hit live 2026-07-10: the old reddit-body
  // default kept pre-filling after the default changed).
  const raw = (cfg?.syndication ?? cfg ?? {});
  const rawTemplates = raw.templates && typeof raw.templates === 'object' && !Array.isArray(raw.templates) ? raw.templates : {};
  const configured = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof rawTemplates[t] === 'string' ? rawTemplates[t].trim() : '';
    if (v) configured[t] = v;
  }
  // SOW-125: like templates, carry the auto_matrix CONFIGURED-ONLY (never the folded-in defaults), so a future
  // change to defaultAutoMode applies on deploy instead of being frozen into KV as if an admin had set it. Only
  // cells the admin actually wrote (known type x MATRIX channel, a valid mode) survive; readers re-normalize.
  const rawMatrix = raw.auto_matrix && typeof raw.auto_matrix === 'object' && !Array.isArray(raw.auto_matrix) ? raw.auto_matrix : {};
  const configuredMatrix = {};
  for (const t of AUTO_TYPES) {
    const row = rawMatrix[t] && typeof rawMatrix[t] === 'object' && !Array.isArray(rawMatrix[t]) ? rawMatrix[t] : {};
    const outRow = {};
    for (const ch of MATRIX_CHANNELS) { const m = typeof row[ch] === 'string' ? row[ch].trim().toLowerCase() : ''; if (AUTO_MODES.includes(m)) outRow[ch] = m; }
    if (Object.keys(outRow).length) configuredMatrix[t] = outRow;
  }
  return { enabled: c.enabled, require_approval: c.require_approval, hold_minutes: c.hold_minutes, upvote_threshold: c.upvote_threshold, classify: c.classify, templates: configured, channel_templates: JSON.parse(JSON.stringify(c.channel_templates)), stub_templates: { ...c.stub_templates }, channel_templates_stub: JSON.parse(JSON.stringify(c.channel_templates_stub)), news_engagement: { ...c.news_engagement }, content_engagement: { ...c.content_engagement, signals: { ...c.content_engagement.signals } }, channels: { ...c.channels }, manual_assist_channels: [...c.manual_assist_channels], auto_matrix: configuredMatrix, channel_hold_minutes: { ...c.channel_hold_minutes } };
}
