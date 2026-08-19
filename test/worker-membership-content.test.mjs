// SOW-016: the server-side member-content endpoints. The AES-256-GCM key NEVER leaves the Worker; decrypt
// returns plaintext, encrypt returns ciphertext, both ONLY to an effective-paid caller with ban > staff >
// grandfather > Stripe applied server-side from the KV overrides mirror. Verifies every fail-closed path plus
// the decrypt/encrypt round-trip. Injected fetchUser + Stripe + KV: no network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipDecrypt, membershipEncrypt, authorizePaid, authorizeCreator, authorizeMember, authorizeMemberCheap, authorizeSignedIn, OVERRIDES_KV_KEY, MAX_OVERRIDES_AGE_MS } from '../workers/signup/membership-content.mjs';
import { encryptAsset, generateEpochKey } from '../client/src/crypto-assets.mjs';
import { signSession } from '../workers/signup/session.mjs'; // sow-158 Phase 3b: sign a website session for the cookie-encrypt tests
import { CSRF_COOKIE, CSRF_HEADER } from '../workers/signup/csrf.mjs';

const KEY = generateEpochKey();
const ENC = (body, headers = {}) => new Request('https://signup.gbti.network/membership/decrypt', { method: 'POST', headers, body: body == null ? undefined : JSON.stringify(body) });
const POST = (path, auth, body) => new Request('https://signup.gbti.network/membership/' + path, { method: 'POST', headers: auth ? { Authorization: auth } : {}, body: body == null ? undefined : JSON.stringify(body) });

const freshMirror = (over = {}) => ({ generatedAt: new Date().toISOString(), roles: over.roles ?? {}, bans: over.bans ?? { bans: [] }, grandfathered: over.grandfathered ?? { grandfathered: [] } });
const kvWith = (mirror) => ({ get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : null) });
const ENV = (over = {}, mirror = freshMirror()) => ({ STRIPE_SECRET_KEY: 'rk_test', MEMBER_CONTENT_KEY: KEY, MEMBER_CONTENT_KID: '1', SIGNUP_KV: kvWith(mirror), ...over });
const paid = { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1 }] } };
// 2026-08-11: encrypt is authorizeCreator-gated, and tierForPrice no longer grants creator on an empty price
// map (that default was the sow-185 fail-open). So the encrypt tests need a PRICED customer and an env that
// maps the price, which is what production has: [env.production.vars] carries STRIPE_PRICE_ID plus the four
// tier ids. `paid` and `ENV()` stay unpriced on purpose, so the fail-closed tests keep a genuine empty map.
const LEGACY_PRICE = 'price_legacy150';
const CREATOR_ENV = (over = {}, mirror = freshMirror()) => ENV({ STRIPE_PRICE_ID: LEGACY_PRICE, ...over }, mirror);
const paidCreator = { id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: LEGACY_PRICE } }] } }] } };
const stripeFor = (byId) => () => ({ findCustomerByGithubId: async (id) => byId(id) });
const userIs = (githubId) => async () => ({ githubId, githubLogin: 'u' + githubId });
const deps = (githubId, customerById) => ({ fetchUser: userIs(githubId), makeStripe: stripeFor(customerById) });

test('decrypt: requires a bearer token', async () => {
  assert.equal((await membershipDecrypt(POST('decrypt', null, { ct: 'x' }), ENV())).status, 401);
});

test('decrypt: 403 for a non-paid member (fail closed)', async () => {
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('decrypt: 403 for a banned member even with a paid Stripe sub', async () => {
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV({}, mirror), deps('1', () => paid));
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not permitted/);
});

test('decrypt: 403 (fail closed) when the overrides mirror is missing or stale', async () => {
  const env1 = ENV({}, null);
  assert.equal((await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), env1, deps('1', () => paid))).status, 403);
  const stale = freshMirror(); stale.generatedAt = new Date(Date.now() - MAX_OVERRIDES_AGE_MS - 1000).toISOString();
  assert.equal((await membershipDecrypt(POST('decrypt', 'Bearer g', { v: 1, kid: '1', iv: 'a', aad: 'a', ct: 'x' }), ENV({}, stale), deps('1', () => paid))).status, 403);
});

test('decrypt: 400 on a malformed (non-envelope) body for a paid member', async () => {
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', { not: 'an envelope' }), ENV(), deps('1', () => paid));
  assert.equal(r.status, 400);
});

test('decrypt: a paid member gets the plaintext (round-trip with a real envelope)', async () => {
  const envelope = await encryptAsset({ plaintext: 'members-only instructions', key: KEY, assetId: 'post:x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.text, 'members-only instructions');
});

test('decrypt: a tampered ciphertext is 422 (undecryptable), never a partial read', async () => {
  const envelope = await encryptAsset({ plaintext: 'secret', key: KEY, assetId: 'a', kid: '1' });
  envelope.ct = envelope.ct.slice(0, -4) + 'AAAA'; // corrupt the tail
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 422);
});

test('decrypt: a wrong-epoch envelope (no key for that kid) is a 500 misconfig, not a leak', async () => {
  const envelope = await encryptAsset({ plaintext: 'x', key: KEY, assetId: 'a', kid: '99' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 500);
});

test('encrypt: a paid author gets an envelope that the same epoch decrypts; the key is never returned', async () => {
  const r = await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'new perk', assetId: 'post:y:body' }), CREATOR_ENV(), deps('1', () => paidCreator));
  assert.equal(r.status, 200);
  assert.equal(r.body.envelope.kid, '1');
  assert.equal(r.body.envelope.aad, 'post:y:body');
  assert.equal(r.body.key, undefined, 'the response must NOT contain the key');
  // round-trip the produced envelope back through decrypt
  const back = await membershipDecrypt(POST('decrypt', 'Bearer g', r.body.envelope), ENV(), deps('1', () => paid));
  assert.equal(back.body.text, 'new perk');
});

test('encrypt: a non-paid author cannot encrypt (403)', async () => {
  const r = await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'x', assetId: 'a' }), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('encrypt: 400 when plaintext or assetId is missing', async () => {
  assert.equal((await membershipEncrypt(POST('encrypt', 'Bearer g', { assetId: 'a' }), CREATOR_ENV(), deps('1', () => paidCreator))).status, 400);
  assert.equal((await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'x' }), CREATOR_ENV(), deps('1', () => paidCreator))).status, 400);
});

// sow-158 Phase 3b: encrypt is COOKIE-eligible now (a website member posts a members-only comment; the body is
// encrypted server-side before the git write). Same authorizePaid + double-submit CSRF posture as cookie decrypt.
const SESSION_SECRET = 'test-session-secret';
const COOKIE_ENV = (mirror = freshMirror()) => ENV({ SESSION_SECRET, CORS_ALLOWED_ORIGINS: 'https://gbti.network', STRIPE_PRICE_ID: LEGACY_PRICE }, mirror);
async function encryptCookieReq({ csrfCookie = 'C', csrfHeader = 'C', origin = 'https://gbti.network', githubId = '1', body = { plaintext: 'members reply', assetId: 'comment:20260101-abc:body' } } = {}) {
  const session = await signSession({ githubId, githubLogin: 'u' + githubId }, SESSION_SECRET);
  const cookies = [`gbti_session=${session}`];
  if (csrfCookie != null) cookies.push(`${CSRF_COOKIE}=${csrfCookie}`);
  const headers = { Cookie: cookies.join('; '), 'Content-Type': 'application/json' };
  if (csrfHeader != null) headers[CSRF_HEADER] = csrfHeader;
  if (origin != null) headers['Origin'] = origin;
  return new Request('https://signup.gbti.network/membership/encrypt', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('encrypt (Phase 3b): a website COOKIE paid caller gets an envelope (no bearer, CSRF satisfied)', async () => {
  const r = await membershipEncrypt(await encryptCookieReq(), COOKIE_ENV(), { allowCookie: true, makeStripe: stripeFor(() => paidCreator) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.envelope.aad, 'comment:20260101-abc:body');
  assert.equal(r.body.key, undefined, 'the key must never be returned to the cookie caller either');
});

test('encrypt (Phase 3b): a cookie POST WITHOUT the X-GBTI-CSRF header is 403 (CSRF-gated)', async () => {
  const r = await membershipEncrypt(await encryptCookieReq({ csrfHeader: null }), COOKIE_ENV(), { allowCookie: true, makeStripe: stripeFor(() => paid) });
  assert.equal(r.status, 403);
});

test('encrypt (Phase 3b): allowCookie omitted -> a cookie caller is still 401 (cookie acceptance stays opt-in)', async () => {
  const r = await membershipEncrypt(await encryptCookieReq(), COOKIE_ENV(), { makeStripe: stripeFor(() => paid) });
  assert.equal(r.status, 401);
});

test('encrypt (Phase 3b): a cookie caller who is NOT paid cannot encrypt (403, fail closed)', async () => {
  const r = await membershipEncrypt(await encryptCookieReq({ githubId: '9' }), COOKIE_ENV(), { allowCookie: true, makeStripe: stripeFor(() => null) });
  assert.equal(r.status, 403);
});

// SOW-018: a Share asset (AAD `share:...`) grants LIMITED TRIAL ACCESS — an active trial may READ it, but a
// non-Share members-only asset stays paid-only, and posting (encrypt) stays paid-only.
const trialing = { id: 'c', metadata: { github_id: '1', trial_started_at: new Date().toISOString() }, subscriptions: { data: [] } };

test('decrypt: an active TRIAL member can read a Share asset (aad share:...)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'a quick find');
});

test('decrypt: a TRIAL member CANNOT read a non-Share members-only asset (post stays paid-only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'paid perk', key: KEY, assetId: 'post:x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 403);
});

// SOW-044: a member comment encrypts under AAD `comment:<id>:body`, which is NOT a `share:` asset, so a comment
// stays PAID-ONLY to read. This pins the owner decision that limited-access trial members cannot read member
// comments (they read the Share body but not its members-only replies), and guards the carve-out from drift.
test('decrypt: a TRIAL member CAN read a member COMMENT (SOW-089: comment aads join the share trial carve-out)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a members reply', key: KEY, assetId: 'comment:20260610120000-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'a members reply');
});

test('decrypt: a TRIAL member still CANNOT read member CONTENT (the carve-out is comments + shares only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a paid body', key: KEY, assetId: 'prompt:x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => trialing));
  assert.equal(r.status, 403);
});

test('decrypt: a PAID member CAN read a member COMMENT (any effective-paid caller, not the author only)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a members reply', key: KEY, assetId: 'comment:20260610120000-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
  assert.equal(r.body.text, 'a members reply');
});

test('decrypt: an EXPIRED/none account cannot read a Share (the extension shows its lock splash)', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('9', () => null));
  assert.equal(r.status, 403);
});

test('decrypt: a paid member can still read a Share asset', async () => {
  const envelope = await encryptAsset({ plaintext: 'a quick find', key: KEY, assetId: 'share:20260610-x:body', kid: '1' });
  const r = await membershipDecrypt(POST('decrypt', 'Bearer g', envelope), ENV(), deps('1', () => paid));
  assert.equal(r.status, 200);
});

test('authorizePaid: a grandfathered member with no Stripe sub is authorized (source grandfather)', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3' }] } });
  const r = await authorizePaid(POST('decrypt', 'Bearer g'), ENV({}, mirror), deps('3', () => null));
  assert.equal(r.ok, true);
  assert.equal(r.source, 'grandfather');
});

// SOW-060: authorizeMember is the FREE / member tier (the news/follows/prefs gate). Any signed-in, non-banned
// caller passes; it inherits resolveEffective's fail-closed behavior (401 no-token, 403 stale/incomplete mirror).
test('authorizeMember: a signed-in member with NO subscription (none) is authorized (free tier)', async () => {
  const r = await authorizeMember(POST('news', 'Bearer g'), ENV(), deps('9', () => null));
  assert.equal(r.ok, true);
  assert.equal(r.githubId, '9');
});

test('authorizeMember: an active trial is authorized', async () => {
  const trial = { id: 'c', metadata: { github_id: '7', trial_started_at: String(Math.floor(Date.now() / 1000)) }, subscriptions: { data: [] } };
  const r = await authorizeMember(POST('news', 'Bearer g'), ENV(), deps('7', () => trial));
  assert.equal(r.ok, true);
});

test('authorizeMember: a banned member is denied even with a paid sub (fail closed)', async () => {
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await authorizeMember(POST('news', 'Bearer g'), ENV({}, mirror), deps('1', () => paid));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not permitted/);
});

test('authorizeMember: no bearer token -> 401', async () => {
  const r = await authorizeMember(POST('news', null), ENV(), deps('9', () => null));
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test('authorizeMember: a missing/stale overrides mirror fails closed (403), never opens to a free caller', async () => {
  const r = await authorizeMember(POST('news', 'Bearer g'), ENV({}, null), deps('9', () => null));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
});

// SOW-078: authorizeMemberCheap is the FREE-tier gate WITHOUT a Stripe call (the activity ban check + future
// news/follows/prefs trim). It must keep authorizeMember's fail-closed contract while NEVER invoking Stripe.
const explodeStripe = () => () => ({ findCustomerByGithubId: async () => { throw new Error('Stripe must not be called on the cheap path'); } });

test('authorizeMemberCheap: a signed-in member is authorized WITHOUT any Stripe call', async () => {
  const r = await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV(), { fetchUser: userIs('9'), makeStripe: explodeStripe() });
  assert.equal(r.ok, true);
  assert.equal(r.githubId, '9');
});

test('authorizeMemberCheap: a banned member is denied (fail closed), still with no Stripe call', async () => {
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV({}, mirror), { fetchUser: userIs('1'), makeStripe: explodeStripe() });
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /not permitted/);
});

test('authorizeMemberCheap: no token -> 401; a missing/stale mirror -> 403 (fails closed like authorizeMember)', async () => {
  assert.equal((await authorizeMemberCheap(POST('activity', null), ENV(), { fetchUser: userIs('9') })).status, 401);
  assert.equal((await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV({}, null), { fetchUser: userIs('9') })).status, 403);
  const stale = freshMirror(); stale.generatedAt = new Date(Date.now() - MAX_OVERRIDES_AGE_MS - 1000).toISOString();
  assert.equal((await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV({}, stale), { fetchUser: userIs('9') })).status, 403);
});

test('authorizeMemberCheap: works even with no STRIPE_SECRET_KEY configured (it never needs Stripe)', async () => {
  const r = await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV({ STRIPE_SECRET_KEY: undefined }), { fetchUser: userIs('9') });
  assert.equal(r.ok, true);
});

test('authorizeMemberCheap: a grandfathered member with no Stripe sub still resolves to paid (override wins)', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3' }] } });
  const r = await authorizeMemberCheap(POST('activity', 'Bearer g'), ENV({}, mirror), { fetchUser: userIs('3'), makeStripe: explodeStripe() });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'paid');
});

// SOW-077: authorizeSignedIn is the READ gate for the news feed — like authorizeMember but it ADMITS a banned
// account (a ban is a community ban, not total; news is non-KV). It keeps the token + fail-closed mirror checks and
// the Stripe-derived status (so news analytics stay per-tier, including the 'banned' bucket).
test('authorizeSignedIn: a BANNED member is ADMITTED (read access), with the banned status for analytics', async () => {
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const r = await authorizeSignedIn(POST('news', 'Bearer g'), ENV({}, mirror), deps('1', () => paid));
  assert.equal(r.ok, true);
  assert.equal(r.status, 'banned');
});

test('authorizeSignedIn: a free (none) member is admitted; no token -> 401; a stale mirror still fails closed', async () => {
  assert.equal((await authorizeSignedIn(POST('news', 'Bearer g'), ENV(), deps('9', () => null))).ok, true);
  assert.equal((await authorizeSignedIn(POST('news', null), ENV(), deps('9', () => null))).status, 401);
  assert.equal((await authorizeSignedIn(POST('news', 'Bearer g'), ENV({}, null), deps('9', () => null))).status, 403);
});

// sow-185: authorizeCreator gates the WRITE routes (encrypt / open-pull / hosted-author) to Content Creator.
// The tier resolves override-aware from resolveEffective; INERT until the owner maps the $5 price (with no
// price env every paid sub is creator via the legacy single-price mode).
const PRICE_ENV = { STRIPE_PRICE_MEMBER_MONTHLY: 'price_m', STRIPE_PRICE_CREATOR_MONTHLY: 'price_c' };
const paidAt = (priceId) => ({ id: 'c', metadata: { github_id: '1' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: priceId } }] } }] } });

// Rewritten 2026-08-11. This asserted that with NO price env a paid member resolves to creator and is
// admitted, calling it "no regression". That was the sow-185 fail-open: an unconfigured env granted the
// HIGHEST tier. It has been removed from tierForPrice, so an empty price map now grants nothing.
//
// This is not a production behaviour change: `[env.production.vars]` in wrangler.toml carries all four tier
// price ids plus the legacy STRIPE_PRICE_ID, so the Worker's map has never been empty. The env this test
// described was the TEST's env, not production's.
test('authorizeCreator: with NO price env, a paid member is DENIED rather than granted creator', async () => {
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(), deps('1', () => paid));
  assert.equal(r.ok, false, 'an unconfigured price map must not confer the top tier');
  assert.equal(r.status, 403);
});

test('authorizeCreator: with the legacy price mapped, a legacy paid member is still admitted', async () => {
  // The real no-regression case, and the one that matters for live members: everyone on the original $150
  // price keeps creator, because buildEnvPriceTierMap seeds STRIPE_PRICE_ID as creator.
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV({ STRIPE_PRICE_ID: 'price_legacy' }), deps('1', () => paidAt('price_legacy')));
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'creator');
});

test('authorizeCreator: a $5 Network Member (member price) is DENIED with a Content Creator message', async () => {
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV), deps('1', () => paidAt('price_m')));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /Content Creator/);
});

test('authorizeCreator: a Content Creator (creator price) is admitted', async () => {
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV), deps('1', () => paidAt('price_c')));
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'creator');
});

test('authorizeCreator: a TIERLESS grandfather now resolves to member and is DENIED creator (owner Q15); an explicit tier:creator is admitted', async () => {
  // owner Q15 2026-08-18: a tierless grandfather grant defaults to member, so the 15 co-op comps lose the
  // creator-gated write path. authorizeCreator denies them.
  const tierless = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3' }] } });
  const denied = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV, tierless), deps('3', () => null));
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  assert.match(denied.body.message, /Content Creator/);
  // the escape hatch: an explicit tier:creator grandfather still resolves creator and is admitted (override wins)
  const creator = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3', tier: 'creator' }] } });
  const ok = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV, creator), deps('3', () => null));
  assert.equal(ok.ok, true);
  assert.equal(ok.tier, 'creator');
});

test('authorizeCreator: a grandfathered member pinned to tier:member is DENIED (settable tier honored)', async () => {
  const mirror = freshMirror({ grandfathered: { grandfathered: [{ github_id: '3', tier: 'member' }] } });
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV, mirror), deps('3', () => null));
  assert.equal(r.ok, false);
  assert.equal(r.status, 403);
  assert.match(r.body.message, /Content Creator/);
});

// sow-142: the coupon fast-path must honor the campaign tier, not assume creator. A member-tier campaign
// (LINKEDINCONNECT) redeemer is a Network Member, so the write gate must DENY creator; a legacy tierless
// grant still falls back to creator.
test('authorizeCreator: a MEMBER-tier coupon redeemer is DENIED creator (sow-142; the fast-path honors grant.tier)', async () => {
  const mirror = freshMirror(); // create once, so generatedAt precedes resolveEffective's captured now (avoids the ageMs<0 fail-closed guard)
  const coupon = { until: new Date(Date.now() + 86_400_000).toISOString(), tier: 'member' };
  const kv = { get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : coupon) };
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV({ ...PRICE_ENV, SIGNUP_KV: kv }), deps('7', () => null));
  assert.equal(r.ok, false, 'a member-tier coupon must not confer creator on the write gate');
  assert.equal(r.status, 403);
  assert.match(r.body.message, /Content Creator/, 'denied for TIER (creator-gated), not a fail-closed mirror error');
});
test('authorizeCreator: a legacy TIERLESS coupon redeemer is admitted as creator (fallback preserved)', async () => {
  const mirror = freshMirror(); // create once, so generatedAt precedes resolveEffective's captured now (avoids the ageMs<0 fail-closed guard)
  const coupon = { until: new Date(Date.now() + 86_400_000).toISOString() }; // no tier field
  const kv = { get: async (k) => (k === OVERRIDES_KV_KEY ? mirror : coupon) };
  const r = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV({ ...PRICE_ENV, SIGNUP_KV: kv }), deps('7', () => null));
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'creator');
});

test('authorizeCreator: a non-paid caller gets the paid-required message; a banned caller is not permitted', async () => {
  const none = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV), deps('9', () => null));
  assert.equal(none.status, 403);
  assert.match(none.body.message, /paid membership/);
  const mirror = freshMirror({ bans: { bans: [{ github_id: '1' }] } });
  const banned = await authorizeCreator(POST('encrypt', 'Bearer g'), ENV(PRICE_ENV, mirror), deps('1', () => paidAt('price_c')));
  assert.equal(banned.status, 403);
  assert.match(banned.body.message, /not permitted/);
});

test('encrypt: a $5 Network Member cannot write member content (creator-gated, 403)', async () => {
  const r = await membershipEncrypt(POST('encrypt', 'Bearer g', { plaintext: 'x', assetId: 'post:z:body' }), ENV(PRICE_ENV), deps('1', () => paidAt('price_m')));
  assert.equal(r.status, 403);
  assert.match(r.body.message, /Content Creator/);
});
