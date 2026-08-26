// Operations, the MEMBER's own surface (SOW-006): activity, earnings, follows, upvotes, link previews,
// syndication and social queues, the news module, Discord linking, and onboarding status. Read/write against
// the Worker rather than the repo, so nothing here opens a PR.
//
// Split out of operations.mjs, which re-exports the public surface unchanged.

import { getActivity as workerGetActivity, setFavorite as workerSetFavorite, createCollection as workerCreateCollection, renameCollection as workerRenameCollection, deleteCollection as workerDeleteCollection, setCollectionItem as workerSetCollectionItem, ActivityClientError } from './member-activity-client.mjs';
import { getEarnings as workerGetEarnings } from './member-earnings-client.mjs';
import { getFollows as workerGetFollows, setFollow as workerSetFollow, FollowsClientError } from './member-follows-client.mjs';
import { upvote as workerUpvote, UpvoteClientError } from './member-upvote-client.mjs';
import { ogPreview as workerOgPreview, OgClientError } from './member-og-client.mjs';
import { getDiscordInvite as workerGetDiscordInvite, InviteClientError } from './member-invite-client.mjs';
import { workerGetNews, workerGetNewsSources, workerGetPrefs, workerSetPrefs, workerPublishNews, workerNewsDiscussed, workerNewsOpened, workerContentOpened, NewsClientError } from './news-client.mjs';
import { probeReadiness } from './github-app-probe.mjs';
import { nextStep as onboardingNextStep, STEPS as ONBOARDING_STEPS, forkFullName, deviceVerificationUrl, forkUrl, appInstallUrl, manageInstallsUrl } from './onboarding.mjs';
import { SIGNUP_BASE, GITHUB_APP_SLUG, UPSTREAM_REPO, authModeFor } from './signup-base.mjs';
import { filterActivity } from '../../membership/member-activity.mjs';
import { getSyndicationQueue as workerGetSyndicationQueue, cancelSyndication as workerCancelSyndication, approveSyndication as workerApproveSyndication, getSyndicateNow as workerGetSyndicateNow, syndicateNow as workerSyndicateNow, getSocialQueue as workerGetSocialQueue, socialQueueAction as workerSocialQueueAction } from './member-admin-client.mjs';
import { OperationError, requireIdentity } from './operations-core.mjs';

// SOW-024: member activity (favorites + collections) in the deletable edge store, via the signup Worker.
// Collections let a member organize prompts (and posts/products) into named lists, in addition to favoriting.
// The host holds the member's GitHub token; signupBase is the Worker. Errors map to OperationError codes.
export function mapActivityError(err) {
  if (err instanceof ActivityClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to manage favorites and collections.');
  }
  return new OperationError('activity-failed', err?.message || 'the activity request failed');
}


// SOW-050 P2: an optional `types` filter (a list of content types) narrows the returned favorites + collection
// items server-side. Omitted/empty -> the full activity, unchanged (additive; no storage migration).
export async function getMemberActivity(ctx, { types } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetActivity({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    const activity = r?.activity ?? { favorites: [], collections: [] };
    return Array.isArray(types) && types.length ? filterActivity(activity, types) : activity;
  } catch (err) {
    throw mapActivityError(err);
  }
}


/** SOW-083 P2: the signed-in member's own earnings ledger (the SOW-059 revenue dashboard data), via the Worker. */
export async function getMemberEarnings(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerGetEarnings({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new Error(err?.message || 'could not load earnings');
  }
}


export async function mutateMemberActivity(ctx, payload = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  const opts = { token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch };
  try {
    switch (payload.action) {
      case 'favorite': return await workerSetFavorite({ ...payload, ...opts });
      case 'collection.create': return await workerCreateCollection({ ...payload, ...opts });
      case 'collection.rename': return await workerRenameCollection({ ...payload, ...opts });
      case 'collection.delete': return await workerDeleteCollection({ ...payload, ...opts });
      case 'collection.item': return await workerSetCollectionItem({ ...payload, ...opts });
      default: throw new OperationError('bad-request', 'unknown activity action');
    }
  } catch (err) {
    if (err instanceof OperationError) throw err;
    throw mapActivityError(err);
  }
}


// SOW-023: the follow graph (subscriptions). Effective-paid only (the Worker is the authority, fail-closed);
// a follow writes the private, erasable edge store, never a PR.
export function mapFollowsError(err) {
  if (err instanceof FollowsClientError && /not signed in/i.test(err.message)) {
    return new OperationError('not-authenticated', 'Sign in to follow members.');
  }
  return new OperationError('follows-failed', err?.message || 'the follows request failed');
}


/** The signed-in member's follow list ({ following: [{ username, addedAt }] }). */
export async function getFollows(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetFollows({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}


/** Follow (on:true) or unfollow (on:false) a member by username. Returns the updated following list. */
export async function setFollow(ctx, { username, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerSetFollow({ username, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return r?.following ?? [];
  } catch (err) {
    throw mapFollowsError(err);
  }
}


/** SOW-057: toggle the caller's upvote on a share (effective-paid; the Worker enqueues syndication at the
 *  threshold). Returns { upvoted, upvoteCount, enqueued }. */
export async function upvoteContent(ctx, { type = 'share', slug, on = true } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerUpvote({ type, slug, on, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { upvoted: !!r?.upvoted, upvoteCount: r?.upvoteCount, enqueued: !!r?.enqueued };
  } catch (err) {
    if (err instanceof UpvoteClientError) throw new OperationError('upvote-failed', err.message);
    throw err;
  }
}


/** SOW-057: fetch a link's OpenGraph preview ({ image, title, description }) via the Worker (SSRF-guarded). */
export async function ogPreview(ctx, { url } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerOgPreview({ url, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    if (err instanceof OgClientError) throw new OperationError('og-preview-failed', err.message);
    throw err;
  }
}


/** SOW-058: the superadmin syndication queue (admin-gated; the Worker enforces). Returns { pending, sent, cancelled, failed }. */
export async function getSyndicationQueue(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSyndicationQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-058: cancel/reject a pending or approved syndication item (SUPERADMIN only; the Worker enforces). */
export async function cancelSyndication(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerCancelSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-058: approve a pending syndication item (SUPERADMIN only; the Worker enforces) so the drain posts it. */
export async function approveSyndication(ctx, { id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerApproveSyndication({ id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-121: the superadmin Social Queue read (manual-assist tasks: pending + done). */
export async function getSocialQueue(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSocialQueue({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-121: mark a manual-assist task done or delete it (SUPERADMIN only; the Worker enforces). */
export async function socialQueueAction(ctx, { action, id } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerSocialQueueAction({ action, id, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-088: the Manually Syndicate readiness read (SUPERADMIN only; the Worker enforces). */
export async function getSyndicateNowInfo(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerGetSyndicateNow({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/** SOW-088: post one item to one destination NOW (SUPERADMIN only; the Worker renders + sanitizes). */
export async function syndicateNow(ctx, { destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  return workerSyndicateNow({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft, token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
}


/**
 * The on-demand Discord invite for the welcome view. The bot mints/caches the invite in the Worker (token never
 * leaves it); this returns { url, source }. requireIdentity only; the Worker re-verifies the token. Failures map
 * to an OperationError so the welcome view can fall back to the static DISCORD_INVITE_URL.
 */
// SOW-043: the members-only news feed (proxied through the signup Worker, which holds NEWS_API_KEY). Effective-paid
// gated server-side; a non-paid/locked caller -> membership-required. Returns { items, updatedAt }.
export async function getNews(ctx, { category, since, limit } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    return await workerGetNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, category, since, limit });
  } catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in to read the news.');
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', 'News is a members-only perk. Upgrade at https://gbti.network.');
    throw new OperationError('news-failed', err?.message || 'the news request failed');
  }
}


// SOW-046 E: the followable news channels (sources) + the member's prefs (categories + followed channels). All
// paid-gated server-side; map the client errors to the standard codes.
export function mapNewsErr(err, what) {
  if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', `Sign in to ${what}.`);
  if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', `${what} is a members-only perk. Upgrade at https://gbti.network.`);
  throw new OperationError('news-failed', err?.message || `the ${what} request failed`);
}

export async function getNewsSources(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerGetNewsSources({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch }); }
  catch (err) { mapNewsErr(err, 'browse news channels'); }
}

export async function getPrefs(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerGetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch }); }
  catch (err) { mapNewsErr(err, 'read your preferences'); }
}

export async function setPrefs(ctx, { categories, followChannel, publicFavorites } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  // SOW-114: publicFavorites = the member's opt-in to the public "Favorited by" list. JSON.stringify drops
  // undefined keys, so an absent field never touches the stored value.
  try { return await workerSetPrefs({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, patch: { categories, followChannel, publicFavorites } }); }
  catch (err) { mapNewsErr(err, 'save your preferences'); }
}


// SOW-046 C: curator-only "Add to Discord". The Worker holds the bot token + re-checks the curator capability, so
// a non-curator member gets a clean membership-required-style error rather than a generic failure.
export async function publishNews(ctx, { item } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerPublishNews({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, item }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in to publish to Discord.');
    if (err instanceof NewsClientError && /curator/i.test(err.message)) throw new OperationError('forbidden', 'Publishing news to Discord requires a curator role.');
    throw new OperationError('news-failed', err?.message || 'could not publish to Discord');
  }
}


// SOW-046 D: best-effort reflect of a news discussion onto Discord (the Worker appends a one-time notice to the
// curator-posted message). Fire-and-forget from the UI after a comment posts; an error here never blocks the
// comment, so map failures to a soft news-failed and let the caller ignore it.
export async function reflectNewsDiscussion(ctx, { guid } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerNewsDiscussed({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    if (err instanceof NewsClientError && /paid membership/i.test(err.message)) throw new OperationError('membership-required', 'News discussion is a members-only perk.');
    throw new OperationError('news-failed', err?.message || 'could not reflect the discussion');
  }
}


// SOW-111: best-effort record of a news detail-open (the engagement beacon). Fire-and-forget from the reader;
// the Worker answers { counted:false } for out-of-tier or disabled config, so only auth/transport errors reach
// here and the reader swallows them (an open must never surface an error).
export async function recordNewsOpen(ctx, { guid, source } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerNewsOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, guid, source }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    throw new OperationError('news-failed', err?.message || 'could not record the open');
  }
}


// SOW-126: best-effort record of a member-content detail-open (the engagement beacon). Fire-and-forget from the
// reader; the Worker answers { counted:false } for out-of-tier or a disabled config, so only auth/transport
// errors reach here and the reader swallows them (an open must never surface an error).
export async function recordContentOpen(ctx, { type, slug } = {}) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try { return await workerContentOpened({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch, type, slug }); }
  catch (err) {
    if (err instanceof NewsClientError && /not signed in/i.test(err.message)) throw new OperationError('not-authenticated', 'Sign in first.');
    throw new OperationError('news-failed', err?.message || 'could not record the open');
  }
}


export async function getDiscordInvite(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  try {
    const r = await workerGetDiscordInvite({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
    return { url: r?.url ?? null, source: r?.source ?? null };
  } catch (err) {
    if (err instanceof InviteClientError && /not signed in/i.test(err.message)) {
      throw new OperationError('not-authenticated', 'Sign in to get a Discord invite.');
    }
    throw new OperationError('invite-failed', err?.message || 'the Discord invite request failed');
  }
}


// SOW Part C: ask the Worker (with the member's GitHub App token) for a one-time SIGNED Discord-link URL the host
// opens in a tab. Token-bound (not website-session-bound), so it works for any signed-in extension member.
export async function getDiscordLinkUrl(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'Sign in to connect Discord.');
  const fetch = ctx.fetch ?? globalThis.fetch;
  let res;
  try { res = await fetch(`${SIGNUP_BASE}/discord/link/init`, { headers: { Authorization: `Bearer ${token}` } }); }
  catch (err) { throw new OperationError('discord-link-failed', err?.message || 'the Discord link request failed'); }
  if (!res.ok) throw new OperationError('discord-link-failed', `the Discord link request failed (${res.status})`);
  const data = await res.json().catch(() => null);
  if (!data || !data.url) throw new OperationError('discord-link-failed', 'no link URL returned');
  return { url: data.url };
}


// sow-218: disconnect the member's Discord account. Unlike the status poll above this WRITES, so it reports
// failure honestly rather than fail-closing to a default: the member is about to be told their account is
// disconnected, and a swallowed error would leave them believing it when it is not. The Worker strips the
// managed roles BEFORE clearing the link, so a partial failure never strands guild access reconcile cannot see.
export async function discordUnlink(ctx) {
  requireIdentity(ctx);
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'Sign in to disconnect Discord.');
  const fetch = ctx.fetch ?? globalThis.fetch;
  let res;
  try { res = await fetch(`${SIGNUP_BASE}/discord/unlink`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }); }
  catch (err) { throw new OperationError('discord-unlink-failed', err?.message || 'the Discord disconnect request failed'); }
  if (!res.ok) throw new OperationError('discord-unlink-failed', `the Discord disconnect failed (${res.status})`);
  const data = await res.json().catch(() => null);
  return { ok: Boolean(data && data.ok), unlinked: Boolean(data && data.unlinked) };
}


// SOW: the welcome polls this after opening the Discord OAuth tab, to auto-detect the link and advance. Read-only
// and fail-closed: any error / no token -> { linked: false } (never throws, so a poll loop never crashes).
export async function getDiscordLinkStatus(ctx) {
  const token = ctx.store?.get?.('githubToken');
  if (!token) return { linked: false };
  const fetch = ctx.fetch ?? globalThis.fetch;
  try {
    const res = await fetch(`${SIGNUP_BASE}/discord/link/status`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return { linked: false };
    const data = await res.json().catch(() => null);
    return { linked: Boolean(data && data.linked) };
  } catch { return { linked: false }; }
}


// SOW-026: first-run onboarding readiness. Reads durable GitHub state (token, fork, App install) and returns the
// first not-yet-done step, so the wizard never loops on a cleared store. Only meaningful in app-mode (classic
// has no fork/install onboarding); in classic mode the wizard is dormant (ready once signed in).
export async function getOnboardingStatus(ctx) {
  const token = ctx.store?.get?.('githubToken');
  const mode = authModeFor(ctx); // SOW-157: the per-member runtime mode, falling back to the baked constant
  if (mode !== 'app') {
    // Classic + hosted: there is no fork/install step. Signed-in = ready (hosted is the 1-click default:
    // the Worker does the git work, so sign-in is the whole onboarding).
    return { appMode: false, mode, signedIn: !!token, forkReady: true, installReady: true, activeStep: token ? 'ready' : 'signin', ready: !!token, reachedGithub: true };
  }
  const r = await probeReadiness({ token, appSlug: GITHUB_APP_SLUG, upstream: UPSTREAM_REPO, fetch: ctx.fetch ?? globalThis.fetch });
  // Self-heal a DEAD token: if GitHub reached us and rejected the token (reachedGithub && !signedIn) while a token
  // was stored, the App user token is expired/revoked and the public client cannot refresh it. Clear the stale
  // token + identity so the UI shows ONE clean "sign in" prompt instead of "Signed in as @x" alongside "0 of 3".
  // probeReadiness sets reachedGithub on a definitive 401 only, never a transient error, so this never signs a
  // member out on a GitHub blip. (The ROOT fix is the App's "Expire user authorization tokens" = OFF.)
  if (token && r.reachedGithub && !r.signedIn) {
    try { ctx.store?.set?.({ githubToken: null, identity: null }); } catch { /* best-effort */ }
  }
  const activeStep = onboardingNextStep(r);
  // Enrich with the step copy + the resolved deep-links so the UI component is purely data-driven (no
  // cross-package import). The install link preselects the member account via their numeric id.
  return {
    appMode: true, mode, ...r, activeStep, ready: activeStep === 'ready',
    forkName: r.login ? forkFullName(r.login) : null,
    steps: ONBOARDING_STEPS,
    links: { device: deviceVerificationUrl(), fork: forkUrl(), install: appInstallUrl({ targetId: r.githubId }), manage: manageInstallsUrl() },
  };
}

// SOW-024: favorites are RETIRED from git. A favorite used to be written to members/<me>/favorites.yml via an
// auto-merged PR (SOW-013), but that put behavioral personal data (who-favorited-what) into the immutable public
// repo, which cannot honor a right-to-erasure. Favorites now flow through mutateMemberActivity (action
// 'favorite') into the deletable edge store (KV), keyed by github_id; the public site only ever sees the
// member-identity-free aggregate counts in house/favorite-counts.yml (synced KV -> git by reconcile). There is
// no longer a git favorites write path here, no favorites gate carve-out, and no favorites.yml validation.

