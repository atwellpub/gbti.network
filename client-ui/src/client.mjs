// The GbtiClient contract (SOW-006 v2). The web components NEVER import the core or a transport; they are
// handed a `client` object with these async methods and render its results. Two hosts implement it:
//   - the npm server: createHttpClient() below (fetch the local hardened /api/* routes with the bearer token);
//   - the Chrome extension: a messaging adapter (content script -> background worker) built in P4 with the
//     SAME method names + shapes, so the components are identical on both.
// The method set mirrors client/src/api.mjs exactly, so the contract is the existing surface, not new API.
//
// GbtiClient = {
//   status(), listContent({type?}), getContentItem({path}), validateContent({type,input,body}),
//   publish({type,input,body,message?,title?,prBody?}), listPRs(), prStatus({number}),
//   formFields({type}), preview({body}), stageImage({filename,dataBase64}), listMembersOnly(),
//   decrypt({encPath}) -> { text }  // SOW-016: the host reads the .enc + decrypts via the Worker (key stays in the host),
//   getSettings(), updateSettings(patch), getBilling(), getReferral(), admin(action, args),
//   login?(onPrompt)   // optional host capability (device flow); not an HTTP route
// }

class GbtiClientError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'GbtiClientError';
    this.code = code;
  }
}

/**
 * The fetch-based GbtiClient for the npm host (talks to the local hardened server's /api/* routes).
 * @param {object} a
 * @param {string} [a.baseUrl]  origin of the local server, '' = same origin.
 * @param {string} a.token      the per-install bearer token.
 * @param {Function} [a.fetch]  injected for tests (defaults to globalThis.fetch).
 */
export function createHttpClient({ baseUrl = '', token, fetch = globalThis.fetch } = {}) {
  async function request(method, path, body) {
    const headers = { Authorization: `Bearer ${token}` };
    const init = { method, headers };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${baseUrl}${path}`, init);
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    if (!res.ok) {
      throw new GbtiClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
    }
    return json;
  }
  const qs = (params) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : '';
  };

  return {
    status: () => request('GET', '/api/status'),
    listContent: ({ type, scope } = {}) => request('GET', `/api/content${qs({ type, scope })}`), // SOW-145: scope 'house' lists house/ (superadmin)
    getContentItem: ({ path }) => request('GET', `/api/content/item${qs({ path })}`),
    readItem: ({ path }) => request('GET', `/api/read${qs({ path })}`), // SOW-031: read ANY published index.md for the in-extension reader -> { path, frontmatter, body }
    validateContent: (b) => request('POST', '/api/validate', b),
    publish: (b) => request('POST', '/api/publish', b),
    // SOW-082: universal draft staging (Save to the fork without a PR; review; Publish from the staged branch).
    saveDraft: (b) => request('POST', '/api/draft', b), // { type, input, body } -> { branch, state: 'staged' }
    listDrafts: ({ type } = {}) => request('GET', `/api/drafts${qs({ type })}`), // -> { drafts: [{ type, slug, title, branch, pull, store }] } (sow-194: store is 'fork'|'kv'|'repo')
    readDraft: ({ type, slug, store, path } = {}) => request('GET', `/api/draft${qs({ type, slug, store, path })}`), // -> { frontmatter, body } for the editor prefill (sow-194: store+path route a repo draft to its canonical file)
    discardDraft: (b) => request('POST', '/api/draft/discard', b), // { type, slug, store } -> { ok, branch } (sow-194: store:'repo' is refused 'unsupported')
    publishDraft: (b) => request('POST', '/api/draft/publish', b), // { type, slug, store, path } -> { prNumber, prUrl } (paid-only; sow-194: store:'repo' is the status flip)
    postShare: (b) => request('POST', '/api/share', b), // SOW-018: returns { id, path, visibility, encrypted }
    listShares: ({ limit } = {}) => request('GET', `/api/shares${qs({ limit })}`), // SOW-018: returns { items: [share summaries] }
    listShareComments: ({ targetSlug, limit } = {}) => request('GET', `/api/share-comments${qs({ targetSlug, limit })}`), // SOW-032: a Share's discussion -> { items: [comment summaries] }
    listComments: ({ targetType, targetSlug, limit, aliases } = {}) => request('GET', `/api/comments${qs({ targetType, targetSlug, limit, aliases: Array.isArray(aliases) && aliases.length ? aliases.join(',') : undefined })}`), // SOW-041 thread (+ SOW-112 rename aliases)
    discordInvite: () => request('GET', '/api/discord-invite'), // on-demand Discord invite -> { url, source }
    discordLinkUrl: () => request('GET', '/api/discord-link'), // SOW Part C: a one-time token-bound Discord-LINK URL -> { url }
    discordLinkStatus: () => request('GET', '/api/discord-link/status'), // SOW: welcome auto-detect poll -> { linked }
    getNews: ({ category, since, limit } = {}) => request('GET', `/api/news${qs({ category, since, limit })}`), // SOW-043: members-only news -> { items, updatedAt }
    getNewsSources: () => request('GET', '/api/news-sources'), // SOW-046: followable news channels -> { sources }
    getPrefs: () => request('GET', '/api/prefs'), // SOW-046: member prefs -> { categories, followedChannels }
    setPrefs: (patch) => request('POST', '/api/prefs', patch), // SOW-046: { categories } or { followChannel: { id, on } } -> { categories, followedChannels }
    publishNews: (item) => request('POST', '/api/news-publish', { item }), // SOW-046 C: curator-only "Add to Discord" -> { ok, posted }
    newsDiscussed: (guid) => request('POST', '/api/news-discussed', { guid }), // SOW-046 D: reflect discussion onto Discord -> { ok, reflected }
    newsOpened: (guid, source) => request('POST', '/api/news-opened', { guid, ...(source ? { source } : {}) }), // SOW-111: the detail-open engagement beacon -> { ok, counted, posted }
    contentOpened: (type, slug) => request('POST', '/api/content-opened', { type, slug }), // SOW-126: the content detail-open engagement beacon -> { ok, counted, openers }
    setContentStatus: ({ path, status }) => request('POST', '/api/content/status', { path, status }), // SOW-106: member self-unpublish/republish -> { ok, prNumber?, noop? }
    renameContent: ({ path, newSlug }) => request('POST', '/api/content/rename', { path, newSlug }), // SOW-112: permalink rename -> { ok, prNumber?, path, slug }
    deleteComment: ({ id }) => request('POST', '/api/comment/delete', { id }), // SOW-112 QA: delete one's own comment -> { ok, prNumber? }
    discordChannels: () => request('GET', '/api/discord-channels'), // SOW-100: [{id, name, type, parentId}] (admin)
    postComment: (b) => request('POST', '/api/comment', b), // SOW-027: { targetType, targetSlug, body, authorNote?, parentId?, visibility? } -> { id, path }
    editComment: (b) => request('POST', '/api/comment/edit', b), // SOW-027: { id, body, authorNote? } -> { id, edited }
    getComment: ({ id }) => request('GET', `/api/comment${qs({ id })}`), // SOW-027: edit prefill -> { path, frontmatter, body }
    listPRs: () => request('GET', '/api/prs'),
    prStatus: ({ number }) => request('GET', `/api/pr-status${qs({ number })}`),
    listContributions: () => request('GET', '/api/contributions'), // SOW-028: incoming contributions to review -> { contributions: [...] }
    getContribution: ({ number }) => request('GET', `/api/contribution${qs({ number })}`), // SOW-028: one contribution's diff + proposed body
    reviewContribution: (b) => request('POST', '/api/contribution-review', b), // SOW-028: { number, decision: approve|request-changes|decline, message? }
    formFields: ({ type }) => request('GET', `/api/form-fields${qs({ type })}`),
    preview: ({ body }) => request('POST', '/api/preview', { body }),
    stageImage: (b) => request('POST', '/api/image', b),
    listMembersOnly: () => request('GET', '/api/members-content'),
    decrypt: ({ encPath }) => request('POST', '/api/member-decrypt', { encPath }), // SOW-016: returns { text }
    // SOW-024: favorites live in the deletable edge store (KV), NOT git. toggleFavorite SETS the favorite to
    // `on` via the activity store and derives the resulting `favorited` from the returned activity (no global
    // count: the public aggregate count comes from house/favorite-counts.yml on the next build).
    toggleFavorite: async ({ targetType, targetSlug, on }) => {
      const r = await request('POST', '/api/activity', { action: 'favorite', targetType, targetSlug, on });
      const favs = (r && r.activity && r.activity.favorites) || [];
      return { favorited: favs.some((f) => f.type === targetType && f.slug === targetSlug) };
    },
    // SOW-057: upvote a share (effective-paid; two distinct non-author upvotes enqueue it for syndication). The
    // count is the live per-target distinct count returned by the Worker.
    toggleUpvote: async ({ targetType = 'share', targetSlug, on }) => {
      const r = await request('POST', '/api/upvote', { type: targetType, slug: targetSlug, on });
      return { upvoted: !!r?.upvoted, count: r?.upvoteCount };
    },
    // SOW-057: a link's OpenGraph preview ({ image, title, description }), fetched server-side (SSRF-guarded).
    ogPreview: ({ url }) => request('POST', '/api/og-preview', { url }),
    // SOW-024: member activity (favorites + collections) in the deletable edge store.
    getActivity: ({ types } = {}) => request('GET', `/api/activity${qs({ types: Array.isArray(types) && types.length ? types.join(',') : undefined })}`), // returns { favorites, collections }; SOW-050 P2 optional type filter
    getEarnings: () => request('GET', '/api/earnings'), // SOW-083 P2: the member's own earnings ledger { entries, totals }
    createCollection: ({ name }) => request('POST', '/api/activity', { action: 'collection.create', name }), // returns { id, activity }
    addToCollection: ({ id, targetType, targetSlug, on = true }) => request('POST', '/api/activity', { action: 'collection.item', id, targetType, targetSlug, on }),
    // SOW-037: manage collections from the member's "Saved" view (the ops already support these actions).
    renameCollection: ({ id, name }) => request('POST', '/api/activity', { action: 'collection.rename', id, name }), // returns { activity }
    deleteCollection: ({ id }) => request('POST', '/api/activity', { action: 'collection.delete', id }), // returns { activity }
    // SOW-023: the follow graph (subscriptions) in the deletable edge store (paid-only).
    getFollows: () => request('GET', '/api/follows'), // returns { following: [{ username, addedAt }] }
    setFollow: ({ username, on = true }) => request('POST', '/api/follows', { username, on }), // returns { following }
    // SOW-026: first-run onboarding readiness (token/fork/install) from durable GitHub state.
    onboardingStatus: () => request('GET', '/api/onboarding-status'), // returns { appMode, signedIn, forkReady, installReady, activeStep, ready, ... }
    getSettings: () => request('GET', '/api/settings'),
    updateSettings: (patch) => request('POST', '/api/settings', patch),
    getBilling: () => request('GET', '/api/billing'),
    getReferral: () => request('GET', '/api/referral'),
    admin: (action, args = {}) => request('POST', '/api/admin', { action, ...args }),
    overrides: () => request('GET', '/api/overrides'), // SOW-038 P2: admin-gated roster { roster, summary }
    taxonomy: () => request('GET', '/api/taxonomy'), // SOW-055: the canonical category tree { tree } for the manager
    addCategory: ({ parentPath, key, label }) => request('POST', '/api/admin', { action: 'category-add', parentPath, key, label }), // SOW-055
    renameCategory: ({ path, label }) => request('POST', '/api/admin', { action: 'category-rename', path, label }), // SOW-055
    newsSourcePool: () => request('GET', '/api/news-source-pool'), // SOW-056 P2: the news-source pool { sources } for the manager
    addNewsSource: ({ id, name, url, description }) => request('POST', '/api/admin', { action: 'news-source-add', id, name, url, description }), // SOW-056 P2
    removeNewsSource: ({ id }) => request('POST', '/api/admin', { action: 'news-source-remove', id }), // SOW-056 P2
    setNewsSourceEnabled: ({ id, enabled }) => request('POST', '/api/admin', { action: 'news-source-toggle', id, enabled }), // SOW-056 P2
    couponPool: () => request('GET', '/api/coupon-pool'), // SOW-119: the coupon registry { coupons } for the manager
    addCoupon: ({ code, freeDays, note, maxRedemptions, expiresAt }) => request('POST', '/api/admin', { action: 'coupon-add', code, freeDays, note, maxRedemptions, expiresAt }), // SOW-119
    updateCoupon: ({ code, patch }) => request('POST', '/api/admin', { action: 'coupon-update', code, patch }), // SOW-119
    couponUsage: () => request('GET', '/api/coupon-usage'), // SOW-119: per-coupon KV usage + invite links
    quotePool: () => request('GET', '/api/quote-pool'), // SOW-063 P3: the splash quote pool { quotes } for the manager
    contentChannelPool: () => request('GET', '/api/content-channel-pool'), // SOW-087: the category -> Discord-channel map { channels }
    setContentChannel: ({ category, channelId }) => request('POST', '/api/admin', { action: 'content-channel-set', category, channelId }), // SOW-087
    removeContentChannel: ({ category }) => request('POST', '/api/admin', { action: 'content-channel-remove', category }), // SOW-087
    moderationFlagPool: () => request('GET', '/api/moderation-flag-pool'), // SOW-087: the moderation word lists { lists }
    addModerationFlagTerm: ({ list, term }) => request('POST', '/api/admin', { action: 'flag-term-add', list, term }), // SOW-087
    removeModerationFlagTerm: ({ list, term }) => request('POST', '/api/admin', { action: 'flag-term-remove', list, term }), // SOW-087
    syndicationTemplatePool: () => request('GET', '/api/syndication-template-pool'), // SOW-087: { templates, types }
    setSyndicationTemplate: ({ type, template, channel, stub }) => request('POST', '/api/admin', { action: 'syndication-template-set', type, template, channel, stub }), // SOW-087 (+ SOW-088 per-channel + stub)
    setSyndicationTemplates: ({ edits }) => request('POST', '/api/admin', { action: 'syndication-templates-set', edits }), // SOW-088: the batch save (one PR)
    newsEngagementSettings: () => request('GET', '/api/news-engagement'), // SOW-111: { settings, tiers }
    setNewsEngagement: ({ enabled, openThreshold, tier, commentAutopost }) => request('POST', '/api/admin', { action: 'news-engagement-set', enabled, openThreshold, tier, commentAutopost }), // SOW-111
    contentEngagementSettings: () => request('GET', '/api/content-engagement'), // SOW-126: { settings, tiers, signals }
    setContentEngagementSettings: ({ enabled, threshold, tier, signals }) => request('POST', '/api/admin', { action: 'content-engagement-set', enabled, threshold, tier, signals }), // SOW-126
    syndicationSettings: () => request('GET', '/api/syndication-settings'), // SOW-088: { settings, channelNames }
    setSyndicationSettings: (p) => request('POST', '/api/admin', { action: 'syndication-settings-set', ...p }), // SOW-088
    addQuote: ({ text, author }) => request('POST', '/api/admin', { action: 'quote-add', text, author }), // SOW-063 P3
    removeQuote: ({ text }) => request('POST', '/api/admin', { action: 'quote-remove', text }), // SOW-063 P3
    setQuoteEnabled: ({ text, enabled }) => request('POST', '/api/admin', { action: 'quote-toggle', text, enabled }), // SOW-063 P3
    openPulls: () => request('GET', '/api/open-pulls'), // SOW-038 P2: admin-gated open content-PR queue { pulls }
    syndicationQueue: () => request('GET', '/api/syndication'), // SOW-058: superadmin tracker { pending, sent, cancelled, failed }
    cancelSyndication: ({ id }) => request('POST', '/api/syndication/cancel', { id }), // SOW-058: superadmin reject/cancel
    approveSyndication: ({ id }) => request('POST', '/api/syndication/approve', { id }),
    socialQueue: () => request('GET', '/api/social-queue'), // SOW-121: superadmin manual-assist queue { pending, done }
    socialQueueAction: ({ action, id }) => request('POST', '/api/social-queue', { action, id }), // SOW-121: done/delete
    getSyndicateNow: () => request('GET', '/api/syndicate-now'), // SOW-088: destinations + templates + channel map (superadmin)
    syndicateNow: (p) => request('POST', '/api/syndicate-now', p), // SOW-088: { destination, item, template, channelId? } // SOW-058: superadmin approve -> posts next drain tick
    adminOp: (action, params) => request('POST', '/api/admin-ops', params ? { action, params } : { action }), // SOW-038 P3 (reconcile/e2e); SOW-055 category-migrate carries params
  };
}

export { GbtiClientError };
