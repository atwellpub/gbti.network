// Signup Worker entrypoint (SOW-002, the only always-on surface). A Cloudflare Worker ESM fetch
// handler that wires the frozen Stripe + Discord clients to the pure modules in this folder and
// routes the signup, checkout, and optional webhook paths.
//
// Routes:
//   GET  /healthz                  liveness probe (no secrets touched)
//   GET  /signup/start             abuse checks, then redirect to GitHub OAuth (state carries ?ref)
//   GET  /signup/github/callback   exchange GitHub code -> github_id; redirect to Discord OAuth
//   GET  /signup/discord/callback  exchange Discord code -> discord id + email; run the signup chain;
//                                  set the signed session cookie; redirect to /account
//   POST /checkout                 session -> resolve customer -> Stripe Checkout Session -> redirect
//   POST /webhook                  OPTIONAL verified Stripe webhook (real-time Discord role sync)
//
// Local dev: this is a Worker, so there is no bind port to free. Run it with
//   `npx wrangler dev workers/signup/index.mjs --local`
// which picks its own local port and respects .dev.vars. The CLAUDE.md port-fallback rule applies to
// long-running node servers (Astro dev, the SOW-006 client); it does not apply to a Worker because
// wrangler manages the local port and production runs on Cloudflare's edge with no fixed port.
//
// State across the OAuth hops is carried in the signed `state` parameter (an HMAC-protected blob via
// session.mjs sign/verify) so we need no server-side session store between the two callbacks. The
// state round-trips the referral code and (after the GitHub hop) the resolved github_id + login so
// the Discord callback can run the signup chain without a database.
//
// CSRF control (FIX 4): the HMAC signature over the state blob IS the CSRF defense. A callback only
// proceeds when unpackState verifies the signature with SESSION_SECRET, so an attacker cannot mint or
// tamper with a state value, and a forged callback (one not issued by us) is rejected. An additional
// browser-bound nonce cookie would have to survive a full-page redirect out to GitHub and Discord and
// back across origins, which a SameSite cookie does not reliably do over the two external hops; the
// signed, server-held SESSION_SECRET already gives an unforgeable binding, so we do not carry a
// separate nonce. The short TTL on the state token (600 seconds) further bounds replay.

import { createStripeClient } from '../../clients/stripe.mjs';
import { createDiscordClient } from '../../clients/discord.mjs';
import { wlog } from './wlog.mjs'; // SOW-124: Worker diagnostic logger (redacted, retained via [observability])

import { signSession, verifySession, sessionCookieHeader, readSessionCookie } from './session.mjs';
import {
  githubAuthorizeUrl,
  githubExchangeCode,
  githubRefreshToken,
  githubFetchUser,
  githubFetchPrimaryEmail,
  discordAuthorizeUrl,
  discordExchangeCode,
  discordFetchUser,
} from './oauth.mjs';
import { verifyTurnstile, rateLimit } from './abuse.mjs';
import { runSignup } from './signup.mjs';
import { resolveCustomerId, createCheckout } from './checkout.mjs';
import { buildCheckoutPriceMap, resolveCheckoutPrice } from '../../membership/checkout-prices.mjs'; // sow-185 3b: multi-price allowlist
import { validateCouponParam } from './coupons.mjs'; // SOW-119
import { unlinkDiscord } from './discord-unlink.mjs'; // sow-218: disconnect Discord (roles first, then the link)
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs'; // sow-185: price -> tier map for the Creator badge
import { startOnboarding } from './connect.mjs';
import { verifyStripeSignature, isDuplicateEvent, markEventSeen, handleStripeEvent } from './webhook.mjs';
import { membershipStatus } from './membership-status.mjs';
import { membershipDecrypt, membershipEncrypt } from './membership-content.mjs';
import { membershipAdminStatuses } from './membership-admin.mjs';
import { membershipAdminOps } from './membership-admin-ops.mjs';
import { membershipCouponUsage } from './membership-coupons-admin.mjs'; // SOW-119
import { membershipInviteCreate, membershipInviteList, membershipInviteUpdate } from './membership-invites-admin.mjs'; // sow-231
import { membershipDiscordChannels } from './membership-discord-channels.mjs'; // SOW-100: channel names for the categories workspace
import { handleActivity } from './membership-activity.mjs';
import { handleTouch, SESSION_RE } from './membership-touches.mjs'; // SOW-059 P1b/P1c: touch capture + session binding
import { freezeAndPersist } from './conversion-snapshot-store.mjs'; // SOW-059 P1c-B: freeze the attribution at conversion
import { handleUpvote } from './membership-upvote.mjs';
import { handleOgPreview } from './membership-og.mjs';
import { handleSyndicationTracker, handleSyndicationCancel, handleSyndicationApprove } from './syndication-admin.mjs';
import { handleSocialQueueGet, handleSocialQueueAction } from './social-queue-admin.mjs'; // SOW-121
import { handleSyndicateNowInfo, handleSyndicateNow } from './membership-syndicate-now.mjs'; // SOW-088: manual syndicate
import { drainSyndication } from './syndication-drain.mjs';
import { ingest } from './news/src/ingest.mjs'; // UnifiedWorker: the hourly news RSS fetch + AI classify (was the gbti-news worker)
import { backfillImages } from './news/src/backfill.mjs'; // UnifiedWorker: the :30 og:image backfill
import { handleFollows } from './membership-follows.mjs';
import { handleDrafts } from './membership-drafts.mjs'; // SOW-157: the hosted draft store
import { handleEarnings } from './membership-earnings.mjs'; // SOW-083 P2: the member's own earnings ledger
import { handleCommentEcho } from './membership-comment-echo.mjs'; // SOW-076 P1: optimistic comment echoes (instant-feel)
import { membershipNews, membershipNewsCategories, membershipNewsSources, publicNews } from './membership-news.mjs'; // SOW-043/046 proxy; sow-139 public list
import { handlePrefs } from './membership-prefs.mjs'; // SOW-046: member prefs (categories + followed news channels)
import { membershipNewsPublish } from './membership-news-publish.mjs'; // SOW-046 C: curator-gated news -> Discord publish
import { membershipNewsDiscussed } from './membership-news-discussed.mjs'; // SOW-046 D: reflect news discussion onto Discord
import { membershipNewsOpened } from './membership-news-opened.mjs'; // SOW-111: the detail-open engagement beacon
import { membershipContentOpened } from './membership-content-opened.mjs'; // SOW-126: the content-open engagement beacon
import { membershipDeployStatus } from './membership-deploy-status.mjs'; // sow-185: public "still deploying" status check
import { handleDiscordInvite } from './discord-invite.mjs';
import { openPullForMember, listMemberPulls, memberPrStatus, listOpenPullsForReview, reviewPrDetail, reviewPrFiles, reviewFileContent } from './github-app.mjs';
import { listRepoDrafts } from './membership-repo-drafts.mjs'; // sow-194: owner-scoped repo-draft listing
import { listSharesFeed } from './membership-shares.mjs'; // sow-158 Part 3: tier-gated community Shares feed
import { membershipSyncFork } from './membership-sync-fork.mjs'; // SOW-106 Phase A: server-side fork main sync
import { membershipAuthor, membershipAuthorTargets } from './membership-author.mjs'; // SOW-156 spike: hosted authoring (flagged); sow-183: superadmin reassignment targets
import { membershipAdminAuthor, membershipAdminQuotePool, membershipAdminNewsSourcePool, membershipAdminCouponPool } from './membership-admin-author.mjs'; // sow-161: server-side admin mutations + config pool reads
import { corsHeaders } from './cors.mjs'; // sow-158 Phase 1b: credentialed reflected-origin CORS for cookie routes
import { generateCsrfToken, csrfCookieHeader, requireCsrf, requireOrigin } from './csrf.mjs'; // sow-158 Phase 1b: double-submit CSRF (+ Origin-only for form-POST routes)

const JSON_HEADERS = { 'Content-Type': 'application/json' };
// CORS for the membership endpoints (token-authenticated, no cookies). Covers BOTH the GET reads (status oracle,
// my-pulls, pr-status) and the POST mutations (open-pr, activity, follows), so the preflight must allow POST +
// Content-Type. Safe cross-origin: wildcard origin + bearer-token auth + NO cookies, so broadening the methods
// cannot enable CSRF (there is no ambient credential to ride).
const MEMBERSHIP_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// SOW-016: the member-content crypto endpoints are POST with a JSON body, so they need POST + Content-Type in
// the preflight. Still wildcard-origin + no cookies (bearer-token auth), safe cross-origin.
const MEMBER_CONTENT_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// sow-158 Phase 1b: `cookies` is an optional array of Set-Cookie strings. A plain headers object cannot hold two
// Set-Cookie keys (the OAuth callbacks now set BOTH the session and the CSRF cookie, and logout expires both), so
// build a Headers object and append each. extraHeaders may still carry a single Set-Cookie (the OAuth nonce flows).
function json(body, status = 200, extraHeaders = {}, cookies = []) {
  const headers = new Headers({ ...JSON_HEADERS, ...extraHeaders });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location, extraHeaders = {}, cookies = []) {
  const headers = new Headers({ Location: location, ...extraHeaders });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

/** Build the two collaborator clients from env (least-privilege keys, see .dev.vars.example). */
function clientsFromEnv(env) {
  return {
    stripe: createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }),
    discord: createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN }),
  };
}

function discordConfig(env) {
  return {
    guildId: env.DISCORD_GUILD_ID,
    trialRoleId: env.DISCORD_TRIAL_ROLE_ID,
    memberRoleId: env.DISCORD_MEMBER_ROLE_ID,
    // sow-218: all three ids are now needed, because signup RESOLVES which one to assign (resolveSignupRole)
    // rather than hardcoding one, and SWAPS to it (stripping the other two). `locked` is the fail-closed
    // fallback, not the default.
    lockedRoleId: env.DISCORD_LOCKED_ROLE_ID,
    // sow-185: the stackable Content Creator badge, a separate axis from the exclusive access role. Unset ->
    // signup touches it at all, matching how reconcile gates the same axis.
    creatorRoleId: env.DISCORD_CREATOR_ROLE_ID,
    // sow-185: so signup can resolve a paying subscriber's TIER for the badge above. Without it every price is
    // unknown and resolves to `none` (fail closed), which withholds the badge until reconcile adds it.
    priceTierMap: buildEnvPriceTierMap(env),
    signupSource: 'signup-worker',
  };
}

// state is a signed blob carrying { ref, via, sid, nonce, githubId?, githubLogin? } between the OAuth hops. The HMAC
// signature over the blob prevents forgery/tampering; the embedded `nonce` (also set as a cookie at /signup/start)
// binds the state to the INITIATING browser, so a legitimately-signed state cannot be replayed into a victim's
// browser. The callback rejects unless the request's nonce cookie matches the state nonce (login-CSRF /
// session-fixation defense). A SameSite=Lax cookie survives the single GitHub hop now that Discord is deferred.
//
// We reuse signSession/verifySession as the signing primitive. signSession requires a non-empty
// github_id, so we pin it to a fixed marker ('state') and carry the real payload as JSON in the
// github_login slot. A short 600-second TTL bounds replay of an issued state token.
const STATE_SUBJECT = 'state';

export async function packState(payload, env, ttlSeconds = 600) {
  return signSession({ githubId: STATE_SUBJECT, githubLogin: JSON.stringify(payload) }, env.SESSION_SECRET, {
    ttlSeconds,
  });
}
export async function unpackState(token, env) {
  const verified = await verifySession(token, env.SESSION_SECRET);
  if (!verified || verified.github_id !== STATE_SUBJECT) return null;
  try {
    return JSON.parse(verified.github_login);
  } catch {
    return null;
  }
}

// sow-236: the OAuth state's one-time consume. The 600s TTL was the only bound on replaying an issued state, and a
// TTL bounds the WINDOW, never the COUNT. Same construction as the Discord link token's jti (see /discord/link/start),
// with one deliberate difference: that consume is best-effort on the write, which is defensible for a token that only
// binds an account the caller already holds. This one guards signup itself, so it FAILS CLOSED on every uncertainty.
//
// The record's TTL deliberately EXCEEDS the 600s state TTL, so the evidence of a consume always outlives the token it
// guards. A shorter record would let a still-valid state become fresh again.
//
// HONEST RESIDUAL, stated rather than implied: Cloudflare KV is eventually consistent and caches reads per colo, so
// two callbacks racing from DIFFERENT colos can both observe a miss. Same-colo reads are read-your-writes, so the
// common case is caught immediately. This takes the attack from "unlimited redemptions for the state's whole TTL"
// down to "bounded by the cross-colo consistency window", which is a large reduction and not a closed door. The
// callback rate limit added alongside is what bounds that remainder. A strictly serialized consume needs a Durable
// Object; that is the escalation path if the residual ever justifies the infrastructure.
export async function consumeStateJti(kv, jti) {
  if (!kv || typeof jti !== 'string' || !jti) return false; // no store or no jti -> cannot prove single use -> deny
  const key = `statejti:${jti}`;
  try {
    if (await kv.get(key)) return false; // already redeemed
    await kv.put(key, '1', { expirationTtl: 900 }); // > the 600s state TTL
    return true;
  } catch {
    return false; // KV unreachable -> deny rather than fall through to "not used, therefore allowed"
  }
}

// SOW security fix: a per-flow nonce, set as a cookie at /signup/start AND embedded in the signed state, binds the
// state to the initiating browser. The callback requires both to match before minting a session, closing the
// login-CSRF / session-fixation hole (a signed-but-fungible state replayed into a victim's browser). A SameSite=Lax
// cookie survives the single external GitHub hop (Discord is deferred), so the old "nonce cannot survive" rationale
// no longer applies.
const OAUTH_NONCE_COOKIE = 'gbti_oauth_nonce';
export function readOauthNonce(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === OAUTH_NONCE_COOKIE) return part.slice(eq + 1).trim() || null;
  }
  return null;
}

// sow-158 Phase 2: validate a website-login return path. Only a same-site, root-relative path is allowed, so a
// value concatenated onto the fixed SITE_BASE_URL origin can never escape it. Rejects protocol-relative (//evil),
// backslash tricks (/\evil), any scheme/host, and control chars. '' means "no return_to" (use the signup default).
export function safeReturnTo(v) {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return '';
  if (v[0] !== '/') return '';                 // must be root-relative (rejects https://evil, scheme:/…)
  if (v[1] === '/' || v[1] === '\\') return ''; // rejects //evil and /\evil (protocol-relative / backslash)
  if (/[\\\x00-\x1f\x7f]/.test(v)) return '';   // no backslash or control chars anywhere
  return v;
}

async function handleStart(request, env) {
  const url = new URL(request.url);
  const ip = request.headers.get('CF-Connecting-IP') || '';

  // Abuse checks FIRST, before any OAuth or registry work.
  const turnstileToken = url.searchParams.get('cf-turnstile-response') || '';
  const ok = await verifyTurnstile({ token: turnstileToken, secret: env.TURNSTILE_SECRET_KEY, remoteIp: ip });
  if (!ok) return json({ error: 'turnstile_failed' }, 403);

  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip });
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  const ref = url.searchParams.get('ref') || '';
  // The content the reader first landed on (SOW-007/008). Carried alongside ?ref so the payout job can
  // split the owner's commission with that content's contributors + commenters. Validated at signup.mjs.
  const via = url.searchParams.get('via') || '';
  // SOW-059 P1c: the visitor's rotating touch-session id (gbti_sid), forwarded as ?sid because the cookie lives on
  // gbti.network, not this Worker's origin. Validated to the session shape; anything else is dropped (fail safe ->
  // no attribution binding). Carried in the signed state so the conversion handler can later locate touch:<sid>.
  const sidParam = url.searchParams.get('sid') || '';
  const sid = SESSION_RE.test(sidParam) ? sidParam : '';
  // SOW-119: an optional coupon code (the /codeable-invite path or a hand-entered code). Validated against
  // the coupons:config mirror NOW so only a redeemable, normalized code ever enters the signed state; an
  // unknown/inactive code (or a stale mirror) drops silently and the signup proceeds as a normal trial.
  const coupon = await validateCouponParam(env.SIGNUP_KV, url.searchParams.get('coupon') || '');
  // SOW security fix: bind the state to THIS browser with a per-flow nonce (cookie + embedded in the signed state).
  const nonce = crypto.randomUUID();
  // sow-158 Phase 2: a website "Sign in" carries return_to (the path to land on after login). Validated to a
  // same-site path here, then carried in the HMAC-signed state (tamper-proof between the OAuth hops).
  const returnTo = safeReturnTo(url.searchParams.get('return_to') || '');
  // sow-236: a ONE-TIME jti, KV-consumed at the callback. The nonce above binds the state to THIS BROWSER, which
  // defends a state transplanted into someone else's; it does NOTHING against an attacker replaying their OWN state,
  // because the cookie is theirs. Turnstile and the IP rate limit are the entire economic control on coupon abuse and
  // both live HERE, at /signup/start, so without a consume one solve bought unlimited signups for the state's whole
  // TTL. The controls were not bypassed, they were amortized to zero. Same construction the Discord link token uses.
  const jti = crypto.randomUUID();
  const state = await packState({ ref, via, sid, nonce, jti, ...(coupon ? { coupon } : {}), ...(returnTo ? { returnTo } : {}) }, env);
  const location = githubAuthorizeUrl({
    clientId: env.GITHUB_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    state,
  });
  return redirect(location, { 'Set-Cookie': `${OAUTH_NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'Referrer-Policy': 'no-referrer' });
}

async function handleGithubCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  if (!code || !state) return json({ error: 'bad_oauth_state' }, 400);
  // SOW security fix: require the per-browser nonce (the cookie set at /signup/start) to match the state's nonce. A
  // state transplanted into a DIFFERENT browser lacks the matching cookie, so it is rejected (login-CSRF /
  // session-fixation). NOTE: the nonce is CLIENT-HELD state, so it can never defend against the client replaying its
  // own state. That is the jti's job, below. Having this check is what made the missing consume easy to overlook.
  const cookieNonce = readOauthNonce(request.headers.get('Cookie'));
  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) return json({ error: 'bad_oauth_state' }, 400);

  // sow-236: rate-limit the CALLBACK by IP, not just /signup/start. This bounds the residual the KV consume below
  // cannot close on its own (see consumeStateJti), and it is independent of KV read consistency. The limit is
  // deliberately loose: legitimate signups share IPs behind carrier and office NAT, and this is a backstop, not the
  // primary control. A blocked caller retries; nothing is consumed before this point.
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 20, windowSeconds: 600, prefix: 'rl:oauth-callback:' });
  if (!rl.allowed) return json({ error: 'rate_limited' }, 429);

  // sow-236: CONSUME THE ONE-TIME STATE. Before the code exchange, so a replay costs no GitHub or Stripe work.
  // Fails closed: an absent jti (including a state minted by the previous deploy, within its 600s TTL), an
  // unreachable KV, or an already-consumed jti all reject. A member caught by the deploy rollover restarts signup.
  if (!(await consumeStateJti(env.SIGNUP_KV, state.jti))) return json({ error: 'bad_oauth_state' }, 400);

  const accessToken = await githubExchangeCode(
    {
      clientId: env.GITHUB_OAUTH_CLIENT_ID,
      clientSecret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_BASE_URL}/signup/github/callback`,
    },
    globalThis.fetch,
  );
  const { githubId, githubLogin } = await githubFetchUser(accessToken, globalThis.fetch);
  const email = await githubFetchPrimaryEmail(accessToken, globalThis.fetch); // best-effort; Discord is deferred

  // SOW: Discord is DEFERRED. Complete the signup on GitHub ALONE -- create the trial Customer (no discord_user_id,
  // no guild join) and sign the session. The member links Discord later from the extension welcome (which re-runs
  // the same Discord OAuth + idempotently attaches discord_user_id + the role to this Customer).
  const { stripe, discord } = clientsFromEnv(env);
  const signup = await runSignup({
    identity: { githubId, githubLogin, discordUserId: null, email, discordAccessToken: null },
    stripe,
    discord,
    kv: env.SIGNUP_KV,
    config: discordConfig(env),
    couponLockSecret: env.COUPON_LOCK_KEY ?? null, // sow-212: enforce the post-erasure minimized coupon lock
    refCode: state.ref,
    via: state.via,
    touchSession: state.sid, // SOW-059: bind the touch session to this new Customer (new-customer-only)
    coupon: state.coupon, // SOW-119: a pre-validated code from the signed state (absent for a plain signup)
  });

  const session = await signSession({ githubId, githubLogin }, env.SESSION_SECRET);
  // sow-207: a fresh signup (a trial OR a SOW-119 coupon invitee) lands on the WEBSITE welcome flow (/welcome/).
  // It hydrates the signed-in state from the session cookie just set below and walks the member through connecting
  // Discord, following members and channels, adding socials, and picking topics. The extension is now a reader,
  // not the forced post-signup destination (sow-204). The coupon needs no query param: the /welcome/ phase banner
  // reads the effective status (couponUntil) from the oracle and shows the free period on its own.
  // sow-158 Phase 2: a website login carries a validated same-site return_to in the signed state; land the member
  // back there (the header hydrates the signed-in state from the cookie). Re-validate defense-in-depth.
  const returnTo = safeReturnTo(state.returnTo);
  const dest = returnTo
    ? `${env.SITE_BASE_URL}${returnTo}`
    : `${env.SITE_BASE_URL}/welcome/`;
  // sow-158 Phase 1b: mint the CSRF token cookie alongside the session so the website client can make
  // credentialed writes (double-submit). Both are set here as two Set-Cookie headers via the cookies array.
  return redirect(dest, {}, [sessionCookieHeader(session), csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN })]);
}

// SOW Part C: the DEFERRED Discord-link callback. Signup no longer hops through Discord (it is deferred), so this
// callback is reached only from the extension-welcome link flow (/discord/link/start), which authenticates the member
// via their post-signup session cookie and carries the verified github_id + a per-browser nonce in the signed state.
// runSignup is idempotent: it reuses the existing Customer, attaches discord_user_id, and assigns the role.
async function handleDiscordCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = await unpackState(url.searchParams.get('state'), env);
  if (!code || !state || !state.githubId) return json({ error: 'bad_oauth_state' }, 400);
  const cookieNonce = readOauthNonce(request.headers.get('Cookie'));
  if (!state.nonce || !cookieNonce || state.nonce !== cookieNonce) return json({ error: 'bad_oauth_state' }, 400);

  const { accessToken } = await discordExchangeCode(
    {
      clientId: env.DISCORD_OAUTH_CLIENT_ID,
      clientSecret: env.DISCORD_OAUTH_CLIENT_SECRET,
      code,
      redirectUri: `${env.PUBLIC_BASE_URL}/signup/discord/callback`,
    },
    globalThis.fetch,
  );
  const { discordUserId, email } = await discordFetchUser(accessToken, globalThis.fetch);

  const { stripe, discord } = clientsFromEnv(env);
  await runSignup({
    identity: {
      githubId: state.githubId,
      githubLogin: state.githubLogin,
      discordUserId,
      email,
      discordAccessToken: accessToken,
    },
    stripe,
    discord,
    kv: env.SIGNUP_KV,
    config: discordConfig(env),
    couponLockSecret: env.COUPON_LOCK_KEY ?? null, // sow-212: enforce the post-erasure minimized coupon lock
    refCode: state.ref,
    via: state.via,
    touchSession: state.sid, // SOW-059 P1c: bind the touch session to this new Customer (new-customer-only)
    coupon: state.coupon, // SOW-119: idempotent (the grant record is the lock), so the re-run is safe
  });

  const session = await signSession({ githubId: state.githubId, githubLogin: state.githubLogin }, env.SESSION_SECRET);
  // SOW: land the member in Discord (the community they just joined), NOT back on the marketing site. The flow
  // started from the extension welcome, which polls /discord/link/status and advances itself once the link lands.
  const dest = env.DISCORD_INVITE_URL || `${env.SITE_BASE_URL}/extension/?linked=discord`;
  // sow-158 Phase 1b: re-issue the CSRF cookie with the refreshed session (two Set-Cookie headers).
  return redirect(dest, {}, [sessionCookieHeader(session), csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN })]);
}

// SOW Part C: deferred Discord link, step 1. The extension welcome opens this in a tab. It authenticates the member
// via their post-signup session cookie (set on this Worker's origin at GitHub-only signup), then starts Discord OAuth
// carrying the verified github_id + a per-browser nonce. The /signup/discord/callback (above) completes the link.
// SOW Part C: deferred Discord link, INIT (the robust extension path). The extension (which holds the member's
// GitHub App token) calls this; we verify the token -> github_id and return a one-time SIGNED link URL the extension
// opens in a tab. This binds the link to the EXTENSION identity, so it works with NO website session.
async function handleDiscordLinkInit(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return json({ error: 'no_token' }, 401, MEMBERSHIP_CORS);
  let id = null;
  try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
  if (!id || !id.githubId) return json({ error: 'bad_token' }, 401, MEMBERSHIP_CORS);
  // The lt is a ONE-TIME, short-lived token (jti -> KV-consumed in /discord/link/start) so a replayed/leaked lt
  // cannot bind a different Discord account to this github_id (account-hijack defense).
  const lt = await packState({ githubId: id.githubId, githubLogin: id.githubLogin, linkInit: true, jti: crypto.randomUUID() }, env, 120);
  return json({ url: `${env.SITE_BASE_URL}/discord/link/start?lt=${encodeURIComponent(lt)}` }, 200, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
}

// SOW: link-status poll for the extension welcome. The welcome opens the Discord OAuth tab (which redirects the
// member into Discord, never back to the site), then polls THIS endpoint until it reports linked and auto-advances.
// Read-only + fail-closed: it verifies the member's GitHub token -> github_id, looks up the Customer, and reports
// whether discord_user_id is attached. Any error / no token -> { linked: false } (never blocks, never opens).
// sow-207: the WEBSITE welcome flow polls this too, but it carries no bearer token. When the bearer is absent,
// resolve the member from the httpOnly session cookie and answer with credentialed CORS (a reflected, allow-listed
// Origin). The extension bearer path stays byte-for-byte unchanged (wildcard CORS). Read-only + fail-closed to
// { linked: false } on every branch, so a poll never blocks the wizard and a cross-site read learns nothing.
async function handleDiscordLinkStatus(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (token) {
    const cors = { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' };
    let id = null;
    try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
    if (!id || !id.githubId) return json({ linked: false }, 200, cors);
    return json({ linked: await discordLinkedFor(env, id.githubId) }, 200, cors);
  }
  // Website path: identity from the signed session cookie; credentialed CORS so the browser may read the response.
  const cors = { ...corsHeaders(request, env, { credentials: true }), 'Cache-Control': 'no-store' };
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  const githubId = session && session.github_id ? String(session.github_id) : null;
  if (!githubId) return json({ linked: false }, 200, cors);
  return json({ linked: await discordLinkedFor(env, githubId) }, 200, cors);
}

// sow-207: shared read behind the link-status poll — is a discord_user_id attached to this github_id's Stripe
// Customer? Fail-closed to false on any error (no customer, Stripe hiccup) so the poll never falsely reports linked.
async function discordLinkedFor(env, githubId) {
  try {
    const { stripe } = clientsFromEnv(env);
    const customer = await stripe.findCustomerByGithubId(String(githubId));
    return Boolean(customer?.metadata?.discord_user_id);
  } catch { return false; }
}

// sow-218: POST /discord/unlink -- disconnect this member's Discord account.
//
// Same dual identity as the link-status poll (extension bearer, or the website session cookie), but this one
// WRITES, so the cookie path additionally requires CSRF. The bearer path does not: a bearer token is not sent
// ambiently by a browser, so there is no cross-site request to forge.
//
// The work itself, including why the two writes are ordered as they are, lives in discord-unlink.mjs.
async function handleDiscordUnlink(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  let githubId = null;
  let cors = { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' };

  if (token) {
    let id = null;
    try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
    if (!id || !id.githubId) return json({ error: 'bad_token' }, 401, cors);
    githubId = String(id.githubId);
  } else {
    cors = { ...corsHeaders(request, env, { credentials: true }), 'Cache-Control': 'no-store' };
    const csrf = requireCsrf(request, env);
    if (!csrf.ok) return json({ error: 'bad_csrf' }, 403, cors);
    const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
    githubId = session && session.github_id ? String(session.github_id) : null;
    if (!githubId) return json({ error: 'no_session' }, 401, cors);
  }

  const { stripe, discord } = clientsFromEnv(env);
  const r = await unlinkDiscord({ githubId, stripe, discord, config: discordConfig(env) });
  // A failed unlink is a 502, not a 200 with ok:false. The member is about to be told whether their account is
  // disconnected, and a silent failure here leaves them believing it is when it is not.
  return json(r, r.ok ? 200 : 502, cors);
}

async function handleDiscordLinkStart(request, env) {
  const url = new URL(request.url);
  // Authenticate the linker by EITHER a one-time link token (the extension's GitHub-App identity, the robust path)
  // OR the post-signup session cookie (the website path). Either yields the SERVER-verified github_id.
  let githubId = null;
  let githubLogin = '';
  const lt = url.searchParams.get('lt');
  if (lt) {
    const tok = await unpackState(lt, env);
    if (tok && tok.linkInit && tok.githubId && tok.jti) {
      // SOW security: consume the ONE-TIME jti in KV. A replayed/stolen lt finds the jti already used and sets NO
      // identity -> it falls through to the session check (which fails for an attacker lacking the victim's session),
      // so a leaked lt cannot bind a different Discord account to this github_id.
      const jtiKey = `linkjti:${tok.jti}`;
      const used = env.SIGNUP_KV ? await env.SIGNUP_KV.get(jtiKey) : null;
      if (!used) {
        if (env.SIGNUP_KV) { try { await env.SIGNUP_KV.put(jtiKey, '1', { expirationTtl: 600 }); } catch { /* best-effort consume */ } }
        githubId = String(tok.githubId);
        githubLogin = tok.githubLogin || '';
      }
    }
  }
  if (!githubId) {
    const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
    if (session && session.github_id) { githubId = String(session.github_id); githubLogin = session.github_login || ''; }
  }
  if (!githubId) {
    // sow-207: no identity (no/expired link token AND no session) -> land on the website welcome flow, where they
    // can sign in and retry the Discord step.
    return redirect(`${env.SITE_BASE_URL}/welcome/`);
  }
  const nonce = crypto.randomUUID();
  const state = await packState({ githubId, githubLogin, nonce, link: true }, env);
  const location = discordAuthorizeUrl({
    clientId: env.DISCORD_OAUTH_CLIENT_ID,
    redirectUri: `${env.PUBLIC_BASE_URL}/signup/discord/callback`,
    state,
  });
  return redirect(location, { 'Set-Cookie': `${OAUTH_NONCE_COOKIE}=${nonce}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`, 'Referrer-Policy': 'no-referrer' });
}

async function handleCheckout(request, env) {
  // Cookie-authenticated + state-changing, but it CANNOT use requireCsrf: the site drives this as a top-level
  // form POST so the Lax cookie rides and we can 302 to Stripe, and a form cannot set X-GBTI-CSRF. Enforce the
  // half that IS possible rather than neither (SecurityMaster, 2026-08-11).
  const origin = requireOrigin(request, env);
  if (!origin.ok) return json(origin.body, origin.status);
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed

  // sow-185 phase 3b: a requested `?tier=&period=` selects a CONFIGURED price from the allowlist, FAIL CLOSED (an
  // unknown or un-provisioned plan is a 400, never a silent charge at the wrong price). With NEITHER param sent,
  // the default stays the legacy Content Creator annual (env.STRIPE_PRICE_ID), so today's single-price checkout
  // is unchanged until the client CTAs begin sending a tier + period.
  const params = new URL(request.url).searchParams;
  const reqTier = params.get('tier');
  const reqPeriod = params.get('period');
  let priceId = env.STRIPE_PRICE_ID;
  if (reqTier || reqPeriod) {
    priceId = resolveCheckoutPrice({ tier: reqTier, period: reqPeriod }, buildCheckoutPriceMap(env));
    if (!priceId) return json({ error: 'invalid_plan', message: 'that membership plan is not available' }, 400);
  }

  const checkout = await createCheckout({
    stripe,
    customerId,
    priceId,
    githubId: session.github_id,
    baseUrl: env.PUBLIC_BASE_URL,
  });
  return redirect(checkout.url);
}

// FIX 1: the post-payment landing. Stripe's success_url (built in checkout.mjs) points here with a
// `gh` param. We validate that gh against the signed session cookie (the github_id MUST match the
// session) before kicking the targeted re-gate that releases the member's held content PRs and
// upgrades their Discord role right away. Fail closed: if the session is missing or gh does not match
// the session, we still redirect to /account (so the browser lands somewhere sane) but we do NOT kick
// the re-gate; the daily scheduled reconcile heals that member on its next run.
async function handleCheckoutSuccess(request, env) {
  const url = new URL(request.url);
  const gh = url.searchParams.get('gh') || '';
  const accountUrl = `${env.SITE_BASE_URL}/account`;

  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  // The gh param must match the authenticated session's github_id. A missing session, a missing gh,
  // or a mismatch means we cannot trust the caller to nudge a re-gate, so we skip it (fail closed).
  if (!session || !gh || String(session.github_id) !== String(gh)) {
    return redirect(accountUrl);
  }

  const { kickRegate } = await import('./checkout.mjs');
  await kickRegate(
    { githubId: session.github_id, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
    globalThis.fetch,
  );
  return redirect(accountUrl);
}

// SOW-007: Stripe Connect Express onboarding for referral payouts. Gated behind REFERRAL_ENABLED (an
// env flag the owner sets to mirror house/referral-config.yml `enabled` when the feature goes live), so
// the onboarding entry point stays dark until referrals are advertised. Both /start (a POST from the
// account page) and /refresh (Stripe's redirect when an Account Link expires) mint a fresh onboarding
// link for the session's own customer. Fail closed: no session or no customer means no onboarding.
async function handleConnectOnboard(request, env) {
  if (env.REFERRAL_ENABLED !== 'true') return json({ error: 'referral_disabled' }, 403);
  // Same shape as /checkout: cookie-authenticated, state-changing, reached without the CSRF choke point.
  const origin = requireOrigin(request, env);
  if (!origin.ok) return json(origin.body, origin.status);
  const session = await verifySession(readSessionCookie(request.headers.get('Cookie')), env.SESSION_SECRET);
  if (!session) return json({ error: 'no_session' }, 401);

  const { stripe } = clientsFromEnv(env);
  const customerId = await resolveCustomerId({ githubId: session.github_id, kv: env.SIGNUP_KV, stripe });
  if (!customerId) return json({ error: 'no_customer' }, 409); // fail closed
  const customer = await stripe.getCustomer(customerId);

  const { url } = await startOnboarding({ stripe, customer, email: customer.email, baseUrl: env.PUBLIC_BASE_URL });
  return redirect(url);
}

// The return_url after onboarding finishes (or the referrer backs out). Onboarding completeness is
// verified server-side by the payout job (it reads the Connect account's payouts_enabled), so here we
// only need to land the browser somewhere sane.
async function handleConnectReturn(request, env) {
  return redirect(`${env.SITE_BASE_URL}/account?connect=done`);
}

async function handleWebhook(request, env) {
  const payload = await request.text();
  const event = await verifyStripeSignature({
    payload,
    signature: request.headers.get('Stripe-Signature'),
    secret: env.STRIPE_WEBHOOK_SECRET,
  });
  if (!event) return json({ error: 'invalid_signature' }, 400); // fail closed

  // FIX 2: check-seen BEFORE processing (return early on a true duplicate), but persist the seen-mark
  // ONLY AFTER the handler succeeds. If the handler throws (for example a transient Discord failure),
  // we do NOT mark the event seen and we return a non-2xx so Stripe retries; the retry then re-runs
  // the idempotent handler. Marking seen up front would make a transient failure look like a duplicate
  // on retry and silently drop the role change.
  if (await isDuplicateEvent({ kv: env.SIGNUP_KV, eventId: event.id })) {
    return json({ ok: true, duplicate: true });
  }

  const { stripe, discord } = clientsFromEnv(env);
  let summary;
  try {
    summary = await handleStripeEvent({
      event,
      stripe,
      discord,
      config: discordConfig(env),
      signalDisable: async (githubId) => {
        // Reuse the checkout re-gate dispatch mechanism to signal SOW-005 to disable content.
        const { kickRegate } = await import('./checkout.mjs');
        await kickRegate(
          { githubId, dispatchToken: env.REGATE_DISPATCH_TOKEN, contentRepo: env.GITHUB_CONTENT_REPO },
          globalThis.fetch,
        );
      },
      // SOW-059 P1c-B: at the paid conversion, freeze + persist the attribution snapshot (flag-gated + idempotent;
      // handleStripeEvent already wraps this fail-soft so it never blocks the role swap).
      onConversion: async ({ customer, conversionAt }) => {
        await freezeAndPersist({ env, customer, conversionAt });
      },
    });
  } catch (err) {
    // Do NOT mark the event seen. Return non-2xx so Stripe retries the delivery; the idempotent
    // handler re-runs on the next attempt. Fail closed: no seen-mark is persisted on a failed handler.
    console.error('webhook handler failed', event.id, err?.message);
    return json({ error: 'handler_failed' }, 500);
  }

  // Handler succeeded: now it is safe to record the event id so future retries short-circuit.
  await markEventSeen({ kv: env.SIGNUP_KV, eventId: event.id });
  return json({ ok: true, summary });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method.toUpperCase();

    try {
      if (method === 'GET' && pathname === '/healthz') return json({ ok: true });

      // SOW: refresh a GitHub App user token. The extension is secretless, so it POSTs only its (rotating)
      // refresh_token here; the Worker adds the App client_id + secret and returns the fresh tokens. The
      // refresh_token IS the credential, so no bearer is needed; we never log it. A dead refresh token -> 401, and
      // the extension clears the session + re-signs-in. Called by the MV3 background (host-permission fetch), but
      // CORS is added so a future page-context caller works too.
      if (pathname === '/auth/refresh') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBER_CONTENT_CORS });
        if (method !== 'POST') return json({ error: 'method_not_allowed' }, 405, MEMBER_CONTENT_CORS);
        const clientId = env.GITHUB_PUBLISHER_CLIENT_ID;
        const clientSecret = env.GITHUB_PUBLISHER_CLIENT_SECRET;
        if (!clientId || !clientSecret) return json({ error: 'refresh_not_configured' }, 501, MEMBER_CONTENT_CORS);
        let reqBody;
        try { reqBody = await request.json(); } catch { return json({ error: 'bad_request' }, 400, MEMBER_CONTENT_CORS); }
        const refreshToken = reqBody?.refresh_token;
        if (!refreshToken || typeof refreshToken !== 'string') return json({ error: 'refresh_token_required' }, 400, MEMBER_CONTENT_CORS);
        try {
          const r = await githubRefreshToken({ clientId, clientSecret, refreshToken });
          return json({ access_token: r.accessToken, refresh_token: r.refreshToken, expires_in: r.expiresIn, refresh_token_expires_in: r.refreshTokenExpiresIn }, 200, MEMBER_CONTENT_CORS);
        } catch {
          return json({ error: 'refresh_failed' }, 401, MEMBER_CONTENT_CORS); // expired/revoked -> caller re-auths
        }
      }

      // sow-158 Phase 1b: end a website session. This is a cookie-authenticated write, so it is CSRF-gated
      // (Origin allow-list + double-submit token). It clears BOTH the session and the CSRF cookie (matching
      // attributes, Max-Age=0 so the browser deletes them). There is no bearer path: the extension + npm hosts
      // sign out by discarding their own token, never by calling this.
      if (pathname === '/auth/logout') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const csrf = requireCsrf(request, env);
          if (!csrf.ok) return json(csrf.body, csrf.status, { ...cors, 'Cache-Control': 'no-store' });
          // Expire BOTH the Domain=gbti.network gbti_csrf AND a host-only one: a user who first signed in before
          // the web-login fix carries a stale host-only signup.gbti.network gbti_csrf alongside the Domain cookie.
          // Deleting only the Domain variant would leave the stale one to keep colliding on future writes.
          const clearCsrf = [csrfCookieHeader('', { ttlSeconds: 0 })];
          if (env.COOKIE_DOMAIN) clearCsrf.push(csrfCookieHeader('', { ttlSeconds: 0, domain: env.COOKIE_DOMAIN }));
          return json({ ok: true }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader('', { ttlSeconds: 0 }),
            ...clearCsrf,
          ]);
        }
      }

      // sow-158: mint the website cookie session from the extension's ALREADY-verified GitHub token, so ONE sign-in
      // (in the extension) also signs the member into gbti.network — no separate web sign-in. Bearer-authenticated:
      // the token already authorizes every member endpoint AS that member, so minting THEIR OWN session grants no
      // new capability (exactly what the OAuth callback does after verifying a token, minus the redirect). No
      // cookie/CSRF gate (a cross-site page cannot forge a bearer token); the extension calls this via a host
      // permission fetch. Rate-limited; never returns the token.
      if (pathname === '/auth/session-from-token') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const authHeader = request.headers.get('Authorization') || '';
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (!token) return json({ error: 'unauthorized' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 30, windowSeconds: 600, prefix: 'rl:session-mint:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, { ...cors, 'Cache-Control': 'no-store' });
          if (!env.SESSION_SECRET) return json({ error: 'misconfigured', message: 'sessions are not configured' }, 500, { ...cors, 'Cache-Control': 'no-store' });
          let id = null;
          try { id = await githubFetchUser(token, globalThis.fetch); } catch { id = null; }
          if (!id || !id.githubId) return json({ error: 'unauthorized', message: 'could not verify the member identity' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const session = await signSession({ githubId: id.githubId, githubLogin: id.githubLogin }, env.SESSION_SECRET);
          return json({ ok: true, github_id: String(id.githubId), login: id.githubLogin || null }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader(session),
            csrfCookieHeader(generateCsrfToken(), { domain: env.COOKIE_DOMAIN }),
          ]);
        }
      }

      // sow-158: the sign-out counterpart of session-from-token. When a member signs OUT of the extension, this
      // clears the bridged website cookie session so ONE sign-out ends both surfaces (otherwise the httpOnly
      // cookie would linger until the web Sign out or the 30-day TTL). Bearer-gated only to block a gratuitous
      // cross-site forced-logout: clearing cookies is capability-free (it deletes the CALLER'S OWN cookies and
      // grants nothing), so we require a present bearer but do NOT verify it against GitHub. The extension may be
      // signing out a token that is already being revoked, and the clear must still succeed. Mirrors /auth/logout's
      // dual-clear (host-only + Domain csrf, host-only session), minus the CSRF gate (there is no cookie read here).
      if (pathname === '/auth/session-clear') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const authHeader = request.headers.get('Authorization') || '';
          const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
          if (!token) return json({ error: 'unauthorized' }, 401, { ...cors, 'Cache-Control': 'no-store' });
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 30, windowSeconds: 600, prefix: 'rl:session-clear:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, { ...cors, 'Cache-Control': 'no-store' });
          const clearCsrf = [csrfCookieHeader('', { ttlSeconds: 0 })];
          if (env.COOKIE_DOMAIN) clearCsrf.push(csrfCookieHeader('', { ttlSeconds: 0, domain: env.COOKIE_DOMAIN }));
          return json({ ok: true }, 200, { ...cors, 'Cache-Control': 'no-store' }, [
            sessionCookieHeader('', { ttlSeconds: 0 }),
            ...clearCsrf,
          ]);
        }
      }

      if (method === 'GET' && pathname === '/signup/start') return await handleStart(request, env);
      if (method === 'GET' && pathname === '/signup/github/callback') return await handleGithubCallback(request, env);
      if (method === 'GET' && pathname === '/signup/discord/callback') return await handleDiscordCallback(request, env);
      if (method === 'GET' && pathname === '/discord/link/init') return await handleDiscordLinkInit(request, env);   // SOW Part C: mint a token-bound link URL (extension)
      if (method === 'GET' && pathname === '/discord/link/start') return await handleDiscordLinkStart(request, env); // SOW Part C: deferred Discord link
      if (method === 'GET' && pathname === '/discord/link/status') return await handleDiscordLinkStatus(request, env); // SOW: welcome auto-detect poll
      if (pathname === '/discord/unlink') { // sow-218: disconnect Discord (strips the managed roles, then the link)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env, { credentials: true }) });
        if (method === 'POST') return await handleDiscordUnlink(request, env);
      }

      if (method === 'POST' && pathname === '/checkout') return await handleCheckout(request, env);
      if (method === 'GET' && pathname === '/checkout/success') return await handleCheckoutSuccess(request, env);

      if (method === 'POST' && pathname === '/referral/connect/start') return await handleConnectOnboard(request, env);
      if (method === 'GET' && pathname === '/referral/connect/refresh') return await handleConnectOnboard(request, env);
      if (method === 'GET' && pathname === '/referral/connect/return') return await handleConnectReturn(request, env);

      if (method === 'POST' && pathname === '/webhook') return await handleWebhook(request, env);

      // SOW-011: the membership-status oracle for the local client (GitHub-bearer-token authenticated).
      // Cross-origin (the extension + the npm host call it), and it carries no cookies, so a wildcard CORS
      // origin with an Authorization allow-header is safe (no ambient credentials are exposed).
      if (pathname === '/membership/status') {
        // sow-158 Phase 1b: cookie-eligible, so credentialed reflected-origin CORS (corsHeaders sets
        // Vary: Origin, Authorization). A GET carries no CSRF gate. Bearer callers (the extension background +
        // the npm host) are not browser-CORS-bound, so reflecting only allow-listed origins does not affect them.
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipStatus(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-016: server-side member-content crypto. The AES-256-GCM epoch key NEVER leaves the Worker
      // (this supersedes the SOW-015 /membership/key handout). Both are POST, effective-paid gated, and
      // fail-closed; the decrypt response carries plaintext, so it is never cached.
      // sow-158 Phase 3a/3b: BOTH decrypt and encrypt are cookie-eligible now. decrypt lets the website
      // reader/editor read a member's own members-only body; encrypt (Phase 3b) lets a website member POST a
      // members-only comment (the body is encrypted server-side before the git write). Same posture for both:
      // credentialed reflected-origin CORS + automatic CSRF on the POST + effective-PAID gate, and the key never
      // leaves the Worker. encrypt grants a paid cookie member no new capability (the git write still rides the
      // own-folder-gated /membership/author), it just reaches the same oracle the bearer hosts already do.
      if (pathname === '/membership/decrypt') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipDecrypt(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }
      if (pathname === '/membership/encrypt') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipEncrypt(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-024: member activity (favorites + collections) in the deletable edge store. Token-authenticated,
      // per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/activity') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET' || method === 'POST') {
          const r = await handleActivity(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-057: a paid member upvotes a share. Effective-paid gated (ban-aware, fail-closed); two distinct
      // non-author upvotes enqueue the share for SOW-058 syndication. Per-token body, never cached.
      if (pathname === '/membership/upvote') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await handleUpvote(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-057: server-side OpenGraph preview for the share composer. Authenticated (any signed-in member),
      // SSRF-guarded, bounded, never cached. Cookie-enabled (credentialed reflected-origin CORS + allowCookie)
      // so the WEBSITE share composer (homepage + /account/) can fetch previews over the gbti_session cookie; a
      // cookie POST clears the CSRF gate inside resolveIdentity. The extension/npm bearer path is unchanged.
      if (pathname === '/membership/og-preview') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await handleOgPreview(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-038 P2: admin-only per-member Stripe status for the superadmin dashboard. Sensitive billing status,
      // so admin-gated (fail-closed via the overrides mirror) + never cached, varied on the bearer.
      // sow-161: cookie-enabled (credentialed reflected-origin CORS + allowCookie) so the website admin dashboard
      // reads it over the session; a GET carries no CSRF (safe method). The extension bearer path is unchanged.
      if (pathname === '/membership/admin/statuses') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipAdminStatuses(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-100: the guild's channel names (admin-gated, KV-cached) for the categories workspace picker.
      if (pathname === '/membership/discord-channels') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await membershipDiscordChannels(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-038 P3: admin-gated OPERATIONS triggers (reconcile / E2E-smoke) via an allow-listed repository_dispatch.
      // The dispatch token stays in the Worker; the caller can only name an allow-listed action. Never cached.
      if (pathname === '/membership/admin/ops') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await membershipAdminOps(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-119: admin-gated coupon usage (the git file holds the config; KV holds the runtime redemption counts).
      // sow-161: credentialed CORS + allowCookie so the WEBSITE coupon manager reads counts over the cookie session
      // (same treatment as /membership/admin/statuses; the extension's bearer call is unaffected). Never cached.
      if (pathname === '/membership/admin/coupon-usage') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipCouponUsage(request, env, { allowCookie: true });
          // corsHeaders(credentials) already sets Vary: 'Origin, Authorization'; don't override it to drop Origin.
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // sow-231: admin-gated ISSUED INVITES. A campaign (house/coupons.yml) says what an invite is worth; an
      // invite (KV) says who we handed one to. Same credentialed-CORS + allowCookie treatment as coupon-usage
      // so the WEBSITE coupon manager can issue over the cookie session (the extension's bearer call still
      // works). Person-keyed and note-bearing, so it is admin-gated and NEVER cached.
      if (pathname === '/membership/admin/invites') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipInviteList(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
        if (method === 'POST') {
          const r = await membershipInviteCreate(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
        if (method === 'PATCH') {
          const r = await membershipInviteUpdate(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }
      // SOW-023: the member follow graph (subscriptions) in the deletable edge store. Signed-in, non-banned
      // (the FREE tier, SOW-060; authorizeMember denies banned), per-member, private, ERASABLE. Per-token body, so
      // never cached and varied on the bearer.
      if (pathname === '/membership/follows') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET' || method === 'POST') {
          const r = await handleFollows(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-157: the hosted draft store (a hosted member has no fork to stage on). Signed-in, non-banned
      // (trial may stage; SOW-011 keeps trial drafts OFF the canonical repo, and this store never touches
      // git). Per-member, private, ERASABLE (SOW-024). Per-token body: never cached, varied on the bearer.
      if (pathname === '/membership/drafts') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET' || method === 'POST') {
          const r = await handleDrafts(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-083 P2: a member's OWN earnings ledger (the SOW-059 revenue dashboard data), written by the offline
      // payout job. Signed-in + non-banned (Stripe-free); a free / non-earning member gets an empty ledger. Per-token
      // body, so never cached and varied on the bearer.
      if (pathname === '/membership/earnings') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await handleEarnings(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-076 P1: optimistic comment echoes (instant-feel). A member's own pending comment appears in <1s from KV
      // while its SOW-072 PR auto-merges + deploys behind it. Signed-in + non-banned; read-your-writes (a member sees
      // only their own echoes). Per-token body, so never cached, varied on the bearer.
      if (pathname === '/membership/comment-echo') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET' || method === 'POST') {
          const r = await handleCommentEcho(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // sow-139: the PUBLIC news list (owner-directed policy change; see membership-news.mjs). Anonymous,
      // metadata-only, capped, and browser-cacheable; the NEWS_API_KEY still never leaves this Worker.
      if (pathname === '/news/feed') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await publicNews(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'public, max-age=300' });
        }
      }

      // sow-185: PUBLIC "still deploying" status check for a content item. Anonymous, cheap, briefly
      // edge-cacheable (short max-age so a visitor's own poll loop still sees a fresh read within a few
      // seconds of the real state changing, while many simultaneous visitors on the same slug share one edge
      // read instead of each hitting KV directly).
      if (pathname === '/membership/deploy-status') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await membershipDeployStatus(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'public, max-age=15' });
        }
      }

      // SOW-043: the members-only news proxy. Effective-paid gated; the news worker's NEWS_API_KEY is held by this
      // Worker and never reaches the client. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/news' || pathname === '/membership/news-categories' || pathname === '/membership/news-sources') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-readable (the website /news mount)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = pathname === '/membership/news' ? await membershipNews(request, env, { allowCookie: true })
            : pathname === '/membership/news-sources' ? await membershipNewsSources(request, env, { allowCookie: true })
            : await membershipNewsCategories(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-046: member prefs (category interests + followed news channels) in the deletable edge store.
      // Effective-paid, per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
      if (pathname === '/membership/prefs') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET' || method === 'POST') {
          const r = await handlePrefs(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-046 C: publish a members-only news item to its mapped Discord channel. CURATOR-gated (admin/superadmin
      // OR an explicit roles.yml curators: listing, checked server-side from the KV mirror). The Discord bot token
      // never leaves this Worker; posts once, deduped on the news guid. Per-token, so never cached, varied on bearer.
      if (pathname === '/membership/news-publish') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await membershipNewsPublish(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-046 D: reflect a news DISCUSSION onto its Discord post. Effective-paid (any member who can comment);
      // appends a one-time "members are discussing this" notice to the curator-posted message. No-op if the item
      // was never posted to Discord. Per-token, so never cached, varied on bearer.
      if (pathname === '/membership/news-discussed') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-writable (POST -> CSRF gate)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipNewsDiscussed(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-111: the news detail-open engagement beacon. Tier-gated by the mirrored news_engagement config; at
      // the open threshold the item auto-posts ONCE to its mapped category channel (the shared post-once core).
      if (pathname === '/membership/news-opened') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-writable (POST -> CSRF gate)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipNewsOpened(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-126: the member-content detail-open engagement beacon (tallies distinct openers per item; the
      // reconcile promotes a `popular` item past the threshold). Mirrors the news beacon, minus the auto-post.
      if (pathname === '/membership/content-opened') {
        // sow-158: cookie-enabled so the website /browse reader fires the open beacon over the session cookie
        // (credentialed reflected-origin CORS + allowCookie). The extension keeps its bearer path (also allowed).
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipContentOpened(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-026: open the publish PR for a paid member. The member's fork-scoped App token cannot open a PR into
      // the canonical repo, so the Worker opens it with GBTI's own canonical-repo App installation token. The
      // App private key never leaves the Worker; the member token only authorizes + identifies them (head must
      // be their own fork). Fail-closed paid-only.
      if (pathname === '/membership/open-pr') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await openPullForMember(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-156 (spike, flag MEMBERSHIP_AUTHOR_ENABLED): hosted authoring. A paid member with no fork and no
      // App install POSTs own-folder files; the Worker validates fail-closed, commits them to a
      // hosted/<github_id>/<itemId> branch on the CANONICAL repo, and opens the PR. The gate stays the only
      // merger. The App token never leaves the Worker.
      if (pathname === '/membership/author') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: website (cookie) publish (POST -> CSRF)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipAuthor(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // sow-183: superadmin-only, the Author-reassignment picker source (GET, no CSRF). Same member index the
      // gate + /membership/author already trust; house is not an entry here, the editor adds it as a fixed option.
      if (pathname === '/membership/author/targets') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipAuthorTargets(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // sow-161: server-side admin mutations (increment 1: content moderation). Staff (moderator+) names an action
      // + a target path; the Worker computes the change server-side and opens a hosted-admin PR with the
      // installation token; the SOW-005 gate re-checks the caller's role vs the path and merges. Cookie-enabled
      // (credentialed CORS + allowCookie; the POST enforces CSRF in resolveIdentity); the extension bearer path also works.
      if (pathname === '/membership/admin/author') {
        const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'POST') {
          const r = await membershipAdminAuthor(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // sow-161 increment 4: the config-manager pool reads (admin-gated, cookie-enabled). A GET carries no CSRF.
      if (pathname === '/membership/admin/quote-pool') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipAdminQuotePool(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/admin/news-source-pool') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipAdminNewsSourcePool(request, env, { allowCookie: true });
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/admin/coupon-pool') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await membershipAdminCouponPool(request, env, { allowCookie: true });
          // corsHeaders(credentials) already sets Vary: 'Origin, Authorization'; don't override it to drop Origin.
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-106 Phase A: sync the member fork's main with upstream (fork-installation token; the member token
      // only authorizes + identifies). Best-effort by contract: every miss is a 200 { synced:false, reason }.
      if (pathname === '/membership/sync-fork') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await membershipSyncFork(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-026: read-side proxy so the client can show PR status in app mode. A fork-scoped member token cannot
      // read the canonical repo, so the Worker reads with GBTI's installation token, SCOPED to the caller's own
      // fork (the App opens the PRs, so they are matched by head owner, not author). Public data; member-scoped.
      if (pathname === '/membership/my-pulls') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable (authMemberLogin)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await listMemberPulls(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }
      if (pathname === '/membership/pr-status') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await memberPrStatus(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }
      // sow-158 Part 3: the community Shares feed for the /account hub. Tier-gated (paid/trial see the members
      // stream; free/banned see PUBLIC shares only), members bodies pointer-only. Cookie-or-bearer, per-caller.
      if (pathname === '/membership/shares') {
        const cors = corsHeaders(request, env, { credentials: true });
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await listSharesFeed(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-028: read proxies for the in-client contribution review INBOX in app mode. A fork-scoped member token
      // cannot read the upstream, so the Worker reads it with GBTI's installation token. Unlike my-pulls/pr-status
      // these are NOT head-owner-scoped (the inbox is about OTHER members' PRs against the caller's folder), which
      // is safe because the canonical repo is public; the client filters to the caller's folder. Reads only;
      // approving still happens on github.com in app mode (the gate needs the owner's own github_id as author).
      if (pathname === '/membership/open-pulls') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await listOpenPullsForReview(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/pr') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await reviewPrDetail(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/pr-files') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await reviewPrFiles(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/file') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable (the WorkBench reader)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await reviewFileContent(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }
      if (pathname === '/membership/repo-drafts') {
        const cors = corsHeaders(request, env, { credentials: true }); // sow-194: owner-scoped repo-draft listing (cookie or bearer)
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (method === 'GET') {
          const r = await listRepoDrafts(request, env);
          return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
        }
      }

      // SOW-058: the superadmin syndication tracker (admin read) + cancel (superadmin only). Fail-closed via the
      // overrides mirror; never cached, varied on the bearer.
      if (pathname === '/membership/syndication') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await handleSyndicationTracker(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/syndication/approve') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await handleSyndicationApprove(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      if (pathname === '/membership/syndication/cancel') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'POST') {
          const r = await handleSyndicationCancel(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      // SOW-121: the superadmin Social Queue (manual-assist worklist). GET the pending + done tasks; POST an
      // action (done/delete). Fail-closed via the overrides mirror + superadmin role; never cached.
      if (pathname === '/membership/social-queue') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await handleSocialQueueGet(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
        if (method === 'POST') {
          const r = await handleSocialQueueAction(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }
      // SOW-088: the superadmin "Manually Syndicate" rail (GET readiness/templates, POST direct post now).
      if (pathname === '/membership/syndicate-now') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          const r = await handleSyndicateNowInfo(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
        if (method === 'POST') {
          const r = await handleSyndicateNow(request, env);
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // On-demand Discord guild invite for the welcome view. The bot mints a real invite (token never leaves the
      // Worker), cached in KV so we do not spam Discord; fail-closed to the static DISCORD_INVITE_URL. Auth = a
      // verified GitHub token; channel access is still governed by the reconcile role sync.
      if (pathname === '/membership/discord-invite') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
        if (method === 'GET') {
          // Build the bot client defensively: if DISCORD_BOT_TOKEN is unset, the handler falls back to the
          // static DISCORD_INVITE_URL rather than 500-ing.
          let discord = null;
          try { discord = clientsFromEnv(env).discord; } catch { discord = null; }
          const r = await handleDiscordInvite(request, env, { discord });
          return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
        }
      }

      // SOW-059 P1b: the pre-signup TOUCH-CAPTURE endpoint. ANONYMOUS (a rotating, client-minted session id keys the
      // record; no GitHub token, no cookies), so a wildcard CORS origin is safe (there is no ambient credential to
      // ride). Gated by TOUCH_CAPTURE_ENABLED (off until the SOW-059 model is activated) so the live endpoint stays
      // inert; a coarse per-IP rate limit blunts floods (the capture is high-frequency + unauthenticated); the
      // handler consent-gates content touches and validates the session. Never cached.
      if (pathname === '/touch') {
        if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBER_CONTENT_CORS });
        if (method === 'POST') {
          if (env.TOUCH_CAPTURE_ENABLED !== 'true') return json({ ok: true, recorded: false, reason: 'disabled' }, 200, MEMBER_CONTENT_CORS);
          const ip = request.headers.get('CF-Connecting-IP') || '';
          const rl = await rateLimit({ kv: env.SIGNUP_KV, ip, limit: 120, windowSeconds: 600, prefix: 'rl:touch:' });
          if (!rl.allowed) return json({ error: 'rate_limited' }, 429, MEMBER_CONTENT_CORS);
          const r = await handleTouch(request, env);
          return json(r.body, r.status, { ...MEMBER_CONTENT_CORS, 'Cache-Control': 'no-store' });
        }
      }

      return json({ error: 'not_found' }, 404);
    } catch (err) {
      // Never leak internals; log server-side. Fail closed (no partial success surfaced to the client).
      wlog('worker', 'unhandled request error', { method, pathname, message: err?.message }); // SOW-124 (redacted, retained)
      return json({ error: 'internal_error' }, 500);
    }
  },

  // UnifiedWorker cron dispatch (this Worker now owns three schedules; wrangler crons must match these strings):
  //   `0 * * * *`  -> ingest: fetch news sources, parse, dedupe, AI-classify, prune, save to NEWS_KV.
  //   `30 * * * *` -> backfillImages: scrape og:images for stored items lacking one (SOW-050).
  //   `*/5 * * * *`-> drainSyndication (SOW-058): post items past the one-hour hold to every ready channel.
  // Each is fail-closed + best-effort (a failure never breaks the cron) and runs via ctx.waitUntil so the handler
  // returns immediately. ingest (dedupe by guid) + backfillImages (imgTried flag) are idempotent, so an overlap
  // with the still-deployed gbti-news worker during cutover is safe.
  async scheduled(controller, env, ctx) {
    const cron = controller?.cron;
    const [job, label] = cron === '0 * * * *' ? [ingest(env), 'news ingest']
      : cron === '30 * * * *' ? [backfillImages(env), 'news image backfill']
        : [drainSyndication(env), 'syndication drain'];
    ctx.waitUntil(job.then(
      (r) => console.log(label, JSON.stringify(r)),
      (e) => console.error(`${label} failed`, e?.message ?? e),
    ));
  },
};
