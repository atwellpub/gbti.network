// The extension's request dispatcher (SOW-006 v2 P4). The content script's GbtiClient is just
// createHttpClient with a MESSAGING fetch, so it produces the same /api/* requests the npm host serves; this
// dispatcher answers them in the background worker. It mirrors client/src/api.mjs's routes, but is
// async-reader-aware (the extension reads content over the GitHub Contents API, which is async, whereas the
// npm reader is sync fs). Reader-free operations (validate, publish) are reused from the core UNCHANGED; the
// reader-dependent reads (status' role, content, content/item, members) call the async reader directly. Pure
// over the injected ctx, so it is unit-tested in node with a fake ctx.

import { OperationError, listContent, listMembersOnly, getContentItem, validateContent, publish, saveDraft, listDrafts, readDraft, discardDraft, publishDraft, publishShare, listShares, listShareComments, readContent, publishComment, editComment, getComment, decryptMemberAsset, getMemberActivity, getMemberEarnings, mutateMemberActivity, getFollows, setFollow, upvoteContent, ogPreview, getDiscordInvite, getDiscordLinkUrl, getDiscordLinkStatus,
  discordUnlink, getNews, getNewsSources, getPrefs, setPrefs, publishNews, reflectNewsDiscussion, recordNewsOpen, recordContentOpen, setOwnContentStatus, renameContent, deleteComment, stageImage, listDiscordChannels, getOnboardingStatus, listIncomingContributions, getContributionReview, reviewContribution, getOverridesRoster, getOpenPulls, triggerAdminOp, getSyndicationQueue, cancelSyndication, approveSyndication, getSyndicateNowInfo, syndicateNow, getSocialQueue, socialQueueAction, listComments, getCouponUsageOp, refreshCouponUntil } from '../../client/src/operations.mjs';
import { getBilling, getReferral } from '../../client/src/account-ops.mjs'; // SOW-040: account surface (Stripe portal + referral link); node-free so the MV3 bundle stays autostart-free
import { fieldsFor } from '../../client/src/form-fields.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';
import { roleOf, rolesFromText, curatorsFromText, canCurateNews } from '../../client/src/roles.mjs';
import { banMember, unbanMember, grandfatherMember, ungrandfatherMember, setMemberRole, deplatformContent, removeContent, republishContent, applyCategoryBatch, applyTagEdit, getTaxonomy, addContentCategory, renameContentCategoryLabel, getNewsSourcePool, addNewsSource, removeNewsSource, setNewsSourceEnabled, getQuotePool, addQuote, removeQuote, setQuoteEnabled, getContentChannelPool, getModerationFlagPool, getSyndicationTemplatePool, setContentChannel, removeContentChannel, addModerationFlagTerm, removeModerationFlagTerm, setSyndicationTemplate, setSyndicationTemplates, getNewsEngagementSettings, setNewsEngagementSettings, getContentEngagementSettings, setContentEngagementSettings, getSyndicationSettings, setSyndicationSettings, getCouponPool } from '../../client/src/admin-ops.mjs';
import { canSeeNews, canFollow, canSave, canBrowse, canStageDrafts } from '../../client/src/membership.mjs'; // SOW-060: free-tier capability predicates; SOW-082: draft staging

// SOW-036/038: role-gated governance, available from the extension too. admin-ops reads via ctx.reader (now
// host-portable / async-safe) and commits via the repo client; capability is UX-gated here while the SOW-005
// gate + CODEOWNERS stay the real boundary (an extension can no more merge a forbidden PR than the npm host can).
const ADMIN_ACTIONS = { ban: banMember, unban: unbanMember, grandfather: grandfatherMember, ungrandfather: ungrandfatherMember, role: setMemberRole, deplatform: deplatformContent, remove: removeContent, republish: republishContent, 'category-batch': applyCategoryBatch, 'tag-edit': applyTagEdit, 'category-add': addContentCategory, 'category-rename': renameContentCategoryLabel, 'news-source-add': addNewsSource, 'news-source-remove': removeNewsSource, 'news-source-toggle': setNewsSourceEnabled, 'quote-add': addQuote, 'quote-remove': removeQuote, 'quote-toggle': setQuoteEnabled, 'content-channel-set': setContentChannel, 'content-channel-remove': removeContentChannel, 'flag-term-add': addModerationFlagTerm, 'flag-term-remove': removeModerationFlagTerm, 'syndication-template-set': setSyndicationTemplate, 'syndication-templates-set': setSyndicationTemplates, 'news-engagement-set': setNewsEngagementSettings, 'content-engagement-set': setContentEngagementSettings, 'syndication-settings-set': setSyndicationSettings };

const CODE_STATUS = Object.freeze({
  'no-identity': 409,
  'not-authenticated': 401,
  'not-found': 404,
  'bad-request': 400,
  'invalid-content': 400,
  'membership-required': 402, // SOW-011: publishing is paid-only
  forbidden: 403,
});

const ok = (json) => ({ status: 200, json });

export async function computeRole(ctx) {
  const id = ctx.identity?.();
  if (!id?.githubId) return 'member';
  const text = await ctx.reader.readFile('house/roles.yml');
  return roleOf(id.githubId, rolesFromText(text));
}

// SOW-046 C: role + news-curator capability from one roles.yml read (admin/superadmin OR a `curators:` listing).
async function computeRoleAndCurate(ctx) {
  const id = ctx.identity?.();
  if (!id?.githubId) return { role: 'member', canCurate: false };
  const text = await ctx.reader.readFile('house/roles.yml');
  const role = roleOf(id.githubId, rolesFromText(text));
  return { role, canCurate: canCurateNews(role, curatorsFromText(text).has(String(id.githubId))) };
}

function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'sign in first');
  return repo;
}

/** Answer one /api/* request. @returns {Promise<{status:number, json:any}>} */
export async function dispatch(ctx, { method = 'GET', pathname, query = {}, body } = {}) {
  ctx.devlog?.('dispatch', 'request', { method, pathname }); // SOW-124 (no-op unless superadmin + Debug on)
  try {
    const id = ctx.identity?.();
    if (pathname === '/api/status') {
      const membership = (await (ctx.membershipResolved ? ctx.membershipResolved() : ctx.membership?.())) ?? 'unknown'; // SOW-011 (+ SOW-089 self-heal): drives the publish notice + every tier gate
      const { role, canCurate } = await computeRoleAndCurate(ctx); // SOW-046 C: also the first read that proves the token
      // computeRoleAndCurate read house/roles.yml; if the token was dead, the reader already cleared the session.
      // Re-read auth state AFTER that read so an expired token reports unauthenticated + nulls the stale identity,
      // sending shouldGate() -> the sign-in splash (sessionExpired distinguishes expiry from a plain sign-out).
      const live = Boolean(ctx.store?.get('githubToken'));
      return ok({
        version: '0.1.0',
        identity: live ? (id ?? null) : null,
        role,
        authenticated: live,
        membership,
        couponUntil: ctx.couponUntil?.() ?? null, // SOW-119 QA: the coupon-grant end date (the expiry countdown)
        paidTier: ctx.paidTier?.() ?? 'none', // sow-185: the resolved paid TIER, for buildMemberSignal's page signal + any creator-tier UI (presentation only; authorizeCreator is the real gate)
        canPublish: membership === 'paid',
        canStageDrafts: canStageDrafts(membership), // SOW-082: Save-draft is trial+paid (broader than canPublish)
        // SOW-060: free-tier perks (browse / news / save / follow) need only a signed-in identity, not paid.
        canSeeNews: canSeeNews(membership),
        canFollow: canFollow(membership),
        canSave: canSave(membership),
        canBrowse: canBrowse(membership),
        canCurate,
        sessionExpired: ctx.authExpired?.() === true,
      });
    }
    // SOW-026: first-run readiness must work BEFORE sign-in: it is the route that DRIVES the sign-in step (it
    // tells the wizard "you are not signed in yet, here is step 1"). So it is a PRE-AUTH route like /api/status,
    // handled before the requires-identity gate below. (Previously it sat inside the switch after the gate, so a
    // not-signed-in member got a 409, the wizard's onboardingStatus() threw, and it showed a dead-end
    // "could not reach GitHub" with no sign-in prompt instead of step 1.)
    if (pathname === '/api/onboarding-status') return ok(await getOnboardingStatus(ctx));

    // SOW-079: the admin MANAGER reads are public git-native data (house/taxonomy.yml, house/news-sources.yml,
    // house/quotes.yml); they must load WITHOUT a signed-in identity (and tokenless once the repo is public), so they
    // sit BEFORE the identity gate. Every WRITE (/api/admin) + the Worker-backed /api/syndication stay gated below.
    if (pathname === '/api/taxonomy') return ok(await getTaxonomy(ctx));
    if (pathname === '/api/news-source-pool') return ok(await getNewsSourcePool(ctx));
    if (pathname === '/api/quote-pool') return ok(await getQuotePool(ctx));
    // SOW-087: the channel-map / moderation-flag / template pools are public git data (display reads).
    if (pathname === '/api/content-channel-pool') return ok(await getContentChannelPool(ctx));
    if (pathname === '/api/moderation-flag-pool') return ok(await getModerationFlagPool(ctx));
    if (pathname === '/api/syndication-template-pool') return ok(await getSyndicationTemplatePool(ctx));
    if (pathname === '/api/coupon-pool') return ok(await getCouponPool(ctx)); // SOW-119 QA: was npm-host-only, so the extension Coupons card showed "No coupons yet"
    if (pathname === '/api/news-engagement') return ok(await getNewsEngagementSettings(ctx));
    if (pathname === '/api/content-engagement') return ok(await getContentEngagementSettings(ctx)); // SOW-126
    if (pathname === '/api/syndication-settings') return ok(await getSyndicationSettings(ctx)); // SOW-088

    const username = id?.username;
    if (!username) throw new OperationError('no-identity', 'no signed-in identity; sign in first');

    switch (pathname) {
      // SOW-145: route through the shared ops so the house scope + its superadmin re-check live in ONE place
      // (the ops are async-reader-aware). Member scope behaves exactly as the old inline reader call did.
      case '/api/content':
        return ok(await listContent(ctx, { type: query.type, scope: query.scope }));
      case '/api/content/item':
        return ok(await getContentItem(ctx, { path: query.path }));
      case '/api/read': // SOW-031: read ANY published content index.md (allowlist-gated) for the in-extension reader
        return ok(await readContent(ctx, { path: query.path })); // shared op (parity with the npm host /api/read)
      case '/api/members-content':
        // sow-193: was `await ctx.reader.listMembersOnly()` directly, bypassing the shared op because that op
        // forgot to await. The op awaits now, so both hosts go through it and the identity check it performs.
        return ok(await listMembersOnly(ctx));
      case '/api/form-fields':
        return ok({ fields: fieldsFor(query.type) ?? [] });
      case '/api/preview':
        return ok({ html: renderMarkdown(body?.body ?? '') });
      case '/api/validate':
        return ok(validateContent(ctx, body)); // reader-free
      case '/api/publish':
        return ok(await publish(ctx, body)); // reader-free (uses content-ops + the repo client)
      case '/api/content/status': // SOW-106 Phase B: member self-unpublish/republish (a reversible own-folder status flip via the gated PR). The route landed in client/src/api.mjs but was never added here, so the extension WorkBench's Unpublish/Republish row actions fell to default: not_found (404). This brings the extension host to parity with the website + npm hosts.
        return ok(await setOwnContentStatus(ctx, body ?? {}));
      case '/api/content/rename': // SOW-112: the permalink rename op. Latent today (rename is folded into the publish event, and renameContent has no UI call site), routed here for parity so it cannot 404 in the extension host if a caller ever returns. Mirrors client/src/api.mjs.
        return ok(await renameContent(ctx, body ?? {}));
      case '/api/image': // SOW-006 / sow-165: stage an editor image (drop, paste, or the cover picker). The shared editor calls client.stageImage unconditionally, so in the extension this used to hit default: 404. Routed for parity; the extension has no local stager yet, so stageImage returns a clear "not available in this client" bad-request the editor's failHint surfaces, instead of a raw 404. Real extension image staging (in-memory pending flushed at publish, as the website does) is a follow-up.
        return ok(await stageImage(ctx, body ?? {}));
      // SOW-082: universal draft staging (Save to the fork without a PR; review; Publish from the staged branch).
      case '/api/drafts':
        return ok(await listDrafts(ctx, { type: query.type }));
      case '/api/draft':
        return ok(method === 'POST' ? await saveDraft(ctx, body) : await readDraft(ctx, { type: query.type, slug: query.slug, store: query.store, path: query.path }));
      case '/api/draft/discard':
        return ok(await discardDraft(ctx, body));
      case '/api/draft/publish':
        return ok(await publishDraft(ctx, body));
      case '/api/share':
        return ok(await publishShare(ctx, body)); // SOW-018: reader-free; members Share encrypts via the Worker
      case '/api/shares':
        return ok(await listShares(ctx, { limit: Number(query.limit) || undefined })); // SOW-018 feed (Git Trees enumerate)
      case '/api/share-comments':
        return ok(await listShareComments(ctx, { targetSlug: query.targetSlug, limit: Number(query.limit) || undefined })); // SOW-032 discussion (Git Trees enumerate)
      case '/api/comments':
        return ok(await listComments(ctx, { targetType: query.targetType, targetSlug: query.targetSlug, limit: Number(query.limit) || undefined, aliases: query.aliases ? String(query.aliases).split(',').filter(Boolean) : [] })); // SOW-041 discussion (+ SOW-112 rename aliases)
      case '/api/comment': // SOW-027: publish a comment (POST) or read one's own for an edit prefill (GET)
        return ok(method === 'POST' ? await publishComment(ctx, body) : await getComment(ctx, { id: query.id }));
      case '/api/comment/edit':
        return ok(await editComment(ctx, body)); // SOW-027: re-publish with updatedAt set
      case '/api/comment/delete': // SOW-112 QA: a member deletes their OWN comment. LIVE fix: gbti-discussion's delete button (mounted in the extension reader via gbti-reader) calls client.deleteComment, which 404'd because ext-dispatch had no case. Mirrors client/src/api.mjs.
        return ok(await deleteComment(ctx, body ?? {}));
      case '/api/member-decrypt':
        return ok(await decryptMemberAsset(ctx, body)); // SOW-016: reads the .enc via the reader, decrypts via the Worker
      case '/api/activity': // SOW-024: member activity (favorites + collections) in the deletable edge store, via the Worker
        return ok(method === 'POST' ? await mutateMemberActivity(ctx, body) : await getMemberActivity(ctx));
      case '/api/earnings': // SOW-083 P2: the member's own earnings ledger (the SOW-059 revenue dashboard), via the Worker
        return ok(await getMemberEarnings(ctx));
      case '/api/follows': // SOW-023: the follow graph (subscriptions) in the deletable edge store, via the Worker (paid-only)
        return ok(method === 'POST' ? await setFollow(ctx, body) : await getFollows(ctx));
      case '/api/upvote': // SOW-057: upvote a share (effective-paid, via the Worker; two votes enqueue syndication)
        return ok(await upvoteContent(ctx, body ?? {}));
      case '/api/og-preview': // SOW-057: server-side OpenGraph preview for the share composer (SSRF-guarded in the Worker)
        return ok(await ogPreview(ctx, body ?? {}));
      case '/api/discord-invite': // on-demand Discord guild invite, minted + cached by the Worker
        return ok(await getDiscordInvite(ctx));
      case '/api/discord-link': // SOW Part C: a one-time, token-bound Discord-LINK URL (the welcome opens it in a tab)
        return ok(await getDiscordLinkUrl(ctx));
      case '/api/discord-link/status': // SOW: welcome auto-detect poll -> { linked } (fail-closed, always fresh)
        return ok(await getDiscordLinkStatus(ctx));
      case '/api/discord-unlink': // sow-218: disconnect Discord (Worker strips the managed roles, then the link)
        return ok(await discordUnlink(ctx));
      case '/api/news': // SOW-043: members-only news, proxied through the signup Worker (holds NEWS_API_KEY)
        return ok(await getNews(ctx, { category: query.category, since: query.since, limit: Number(query.limit) || undefined }));
      case '/api/news-sources': // SOW-046: the followable news channels (sources)
        return ok(await getNewsSources(ctx));
      case '/api/prefs': // SOW-046: member prefs (categories + followed news channels)
        return ok(method === 'POST' ? await setPrefs(ctx, body) : await getPrefs(ctx));
      case '/api/news-publish': // SOW-046 C: curator-only "Add to Discord" (the Worker holds the bot token + re-checks)
        return ok(await publishNews(ctx, body ?? {}));
      case '/api/news-discussed': // SOW-046 D: reflect a news discussion onto its Discord post (one-time notice)
        return ok(await reflectNewsDiscussion(ctx, body ?? {}));
      case '/api/news-opened': // SOW-111: the news detail-open engagement beacon (was imported but unrouted here)
        return ok(await recordNewsOpen(ctx, body ?? {}));
      case '/api/content-opened': // SOW-126: the member-content detail-open engagement beacon (the `popular` engine tally)
        return ok(await recordContentOpen(ctx, body ?? {}));
      case '/api/billing': // SOW-040: the Stripe customer-portal deep-link (no card/PCI in the client)
        return ok(getBilling(ctx));
      case '/api/referral': // SOW-040/007: the member's referral link (keyed on the immutable github_id)
        return ok(getReferral(ctx));
      case '/api/prs':
        return ok({ prs: await requireRepo(ctx).listMyPulls(id.login) });
      case '/api/contributions': // SOW-028: the owner's incoming-contribution review inbox (open PRs against their folder)
        return ok(await listIncomingContributions(ctx));
      case '/api/contribution': // SOW-028: one contribution's diff + proposed body for the in-client review
        return ok(await getContributionReview(ctx, { number: query.number }));
      case '/api/contribution-review': // SOW-028: the owner's decision (approve | request-changes | decline)
        return ok(await reviewContribution(ctx, body));
      case '/api/overrides': // SOW-038 P2: superadmin dashboard roster (admin-gated; reads the public house/*.yml)
        return ok(await getOverridesRoster(ctx));
      // SOW-079: /api/taxonomy, /api/news-source-pool, /api/quote-pool moved ABOVE the identity gate (public reads).
      case '/api/open-pulls': // SOW-038 P2: the open content-PR queue (admin-gated)
        return ok(await getOpenPulls(ctx));
      case '/api/syndication': // SOW-058: the superadmin syndication tracker (admin-gated, via the Worker)
        return ok(await getSyndicationQueue(ctx));
      case '/api/syndication/approve': // SOW-058: approve a pending syndication item (superadmin only)
        return ok(await approveSyndication(ctx, body ?? {}));
      case '/api/syndication/cancel': // SOW-058: cancel/reject a pending or approved syndication item (superadmin only)
        return ok(await cancelSyndication(ctx, body ?? {}));
      case '/api/syndicate-now': // SOW-088: manual syndicate (GET readiness/templates, POST direct post; superadmin only)
        return ok(method === 'POST' ? await syndicateNow(ctx, body ?? {}) : await getSyndicateNowInfo(ctx));
      case '/api/social-queue': // SOW-121: the superadmin Social Queue (GET tasks, POST done/delete)
        return ok(method === 'POST' ? await socialQueueAction(ctx, body ?? {}) : await getSocialQueue(ctx));
      case '/api/discord-channels': // SOW-100: the guild channel names (admin-gated by the Worker). Was npm-host-only, so the extension pickers showed "No channels loaded".
        return ok(await listDiscordChannels(ctx));
      case '/api/admin-ops': // SOW-038 P3: trigger reconcile / E2E-smoke (admin-gated; the Worker holds the dispatch token)
        return ok(await triggerAdminOp(ctx, body ?? {}));
      case '/api/coupon-usage': // SOW-119 QA: per-coupon redemption counts (admin-gated by the op + the Worker)
        return ok(await getCouponUsageOp(ctx));
      case '/api/coupon-refresh': // SOW-119 QA: live-oracle recheck before the expiry popup nags (clears a stale grant date)
        return ok(await refreshCouponUntil(ctx));
      case '/api/pr-status': {
        // Mirror operations.prStatus's guard: the npm host validates the PR number before hitting GitHub, so
        // the extension must too (else NaN/0/negative numbers reach GET /pulls/<n> under the member's token).
        const n = Number(query.number);
        if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
        return ok(await requireRepo(ctx).gateStatus(n));
      }
      case '/api/admin': {
        // SOW-036/038: governance from the extension. admin-ops expects a SYNC role() and a configured repoPath;
        // the extension computes role async (from the GitHub-read roles.yml) and has no local clone (it commits
        // via the repo client), so wrap ctx with a precomputed role() + a repoPath sentinel for this one call.
        const role = await computeRole(ctx);
        const adminCtx = { ...ctx, role: () => role, store: { get: (k) => (k === 'repoPath' ? 'extension' : ctx.store?.get(k)) } };
        const fn = ADMIN_ACTIONS[body?.action];
        if (!fn) throw new OperationError('bad-request', `unknown admin action: ${body?.action}`);
        return ok(await fn(adminCtx, body ?? {}));
      }
      default:
        return { status: 404, json: { error: 'not_found' } };
    }
  } catch (err) {
    if (err instanceof OperationError) { ctx.devlog?.('dispatch', 'operation error', { pathname, code: err.code, message: err.message }); return { status: CODE_STATUS[err.code] ?? 400, json: { error: err.code, message: err.message } }; }
    ctx.devlog?.('dispatch', 'internal error', { pathname, message: err?.message });
    return { status: 500, json: { error: 'internal', message: err?.message } };
  }
}
