// sow-161: the server-side admin mutation endpoint (workers/signup/membership-admin-author.mjs), increment 1:
// content moderation. All injectable (fake KV, URL-matching fetch, stubbed authorize/limiter/signJwt): no network,
// no secrets. The security-relevant paths mirror the adversarial review: non-staff denied, unsupported action,
// a GOVERNANCE-file path rejected (a moderator cannot rewrite roles.yml via this endpoint), the server-inserted
// caller github_id in the branch, the server-computed status flip, remove = delete, and the already-in-state no-op.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAdminAuthor, membershipAdminQuotePool, membershipAdminNewsSourcePool } from '../workers/signup/membership-admin-author.mjs';

const env = {
  GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM',
  UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true',
};
const fakeKv = () => { const m = new Map(); return { store: m, async get() { return null; }, async put(k, v) { m.set(k, v); } }; };
const signJwt = async () => 'fake.jwt.sig';
const allow = async () => ({ allowed: true });
const staffMod = async () => ({ ok: true, githubId: '3', role: 'moderator' }); // a moderator
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' }); // an admin
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' }); // a superadmin
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden', message: 'moderator access is required' } });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const ITEM = 'members/alice/posts/my-post/index.md';
const fileWithStatus = (status) => `---\ntitle: My Post\nauthor: alice\nstatus: ${status}\n---\n\nBody text.\n`;

/** URL-matching GitHub fake for the admin-author flow; records writes. `mainFile` is the current file text on main
 *  (or null -> 404). `onBranchSha` is the existing target sha on the work branch (undefined -> 404 there). */
function ghFetch(record, { mainFile = fileWithStatus('published'), govFile = 'bans: []\n', onBranchSha = 'oldsha', branchExists = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/(?:bans|grandfathered|roles|quotes|news-sources)\.yml\?ref=main$/.test(url) && method === 'GET') { // the governance/config file (increments 2-4)
      return govFile == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(govFile) }; } };
    }
    if (/\/contents\/.+\?ref=main$/.test(url) && method === 'GET') {
      return mainFile == null ? { ok: false, status: 404, async json() { return {}; } } : { ok: true, status: 200, async json() { return { content: b64(mainFile) }; } };
    }
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') {
      record.push({ method, url, body: JSON.parse(init.body) });
      return branchExists ? { ok: false, status: 422, async json() { return {}; } } : { ok: true, status: 201, async json() { return {}; } };
    }
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 200, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') { // existing file on the work branch
      return onBranchSha ? { ok: true, status: 200, async json() { return { sha: onBranchSha }; } } : { ok: false, status: 404, async json() { return {}; } };
    }
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://x/pull/42' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, { fetchImpl, authorize = staffMod, ...over } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv: fakeKv(), limiter: allow, signJwt, ...over });

test('sow-161: a non-staff caller is denied (403) and writes NOTHING', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record), authorize: denied });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'no branch, no PR, no write for a denied caller');
});

test('sow-161: an unknown action is 400', async () => {
  const record = [];
  const r = await run({ action: 'frobnicate', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: a GOVERNANCE or non-content path is rejected (a moderator cannot target roles.yml/bans.yml)', async () => {
  for (const path of ['house/roles.yml', 'house/bans.yml', 'members/alice/collections.yml', 'members/alice/posts/x/../../../house/roles.yml', 'CODEOWNERS', '.github/workflows/x.yml']) {
    const record = [];
    const r = await run({ action: 'remove', path }, { fetchImpl: ghFetch(record) });
    assert.equal(r.status, 400, `path ${path} must be rejected`);
    assert.equal(record.length, 0, `path ${path} must write nothing`);
  }
});

test('sow-161: deplatform flips status to draft, server-side, on a hosted-admin branch keyed to the VERIFIED caller id', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/3/deplatform-my-post', 'branch encodes the moderator id (3) from authorize, not the body');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(deB64(put.body.content), /status: draft/, 'the status was flipped to draft SERVER-SIDE');
  assert.doesNotMatch(deB64(put.body.content), /status: published/);
});

test('sow-161: republish flips status to published; remove deletes the file', async () => {
  const rec1 = [];
  const rp = await run({ action: 'republish', path: ITEM }, { fetchImpl: ghFetch(rec1, { mainFile: fileWithStatus('draft') }) });
  assert.equal(rp.status, 200);
  assert.match(deB64(rec1.find((c) => c.method === 'PUT').body.content), /status: published/);

  const rec2 = [];
  const rr = await run({ action: 'remove', path: ITEM }, { fetchImpl: ghFetch(rec2) });
  assert.equal(rr.status, 200);
  assert.ok(rec2.some((c) => c.method === 'DELETE'), 'remove issues a DELETE');
});

test('sow-161: deplatforming an already-draft item is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: fileWithStatus('draft') }) });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'a no-op opens no PR');
});

test('sow-161: a target missing on main is 404 (nothing to moderate)', async () => {
  const record = [];
  const r = await run({ action: 'deplatform', path: ITEM }, { fetchImpl: ghFetch(record, { mainFile: null }) });
  assert.equal(r.status, 404);
  assert.equal(record.length, 0);
});

test('sow-161: the endpoint is inert unless MEMBERSHIP_AUTHOR_ENABLED is true', async () => {
  const r = await membershipAdminAuthor(req({ action: 'deplatform', path: ITEM }), { ...env, MEMBERSHIP_AUTHOR_ENABLED: 'false' }, { fetchImpl: ghFetch([]), authorize: staffMod, kv: fakeKv(), limiter: allow, signJwt });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'author_disabled');
});

// ---- sow-161 increment 2: member status (ban / unban / grandfather / ungrandfather), ADMIN-tier ----

test('sow-161: a MODERATOR cannot ban (403 insufficient role) and writes nothing', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'a moderator is rejected at the endpoint before any read/write');
});

test('sow-161: an admin ban writes house/bans.yml with the target id, on a caller-keyed hosted-admin branch', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999', reason: 'spam' }, { fetchImpl: ghFetch(record, { govFile: 'bans: []\n' }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/2/ban-999', 'branch = the admin id (2) + ban-<targetId>');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(deB64(put.body.content), /github_id: '?999'?/, 'the target id is written into bans.yml');
  assert.match(put.url, /house\/bans\.yml$/);
});

test('sow-161: a non-numeric github_id for a membership action is 400', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: 'not-a-number' }, { fetchImpl: ghFetch(record), authorize: staffAdmin });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: grandfather targets house/grandfathered.yml; ungrandfather removes; unban removes', async () => {
  const g = [];
  const rg = await run({ action: 'grandfather', githubId: '77' }, { fetchImpl: ghFetch(g, { govFile: 'grandfathered: []\n' }), authorize: staffAdmin });
  assert.equal(rg.status, 200);
  assert.match(g.find((c) => c.method === 'PUT').url, /house\/grandfathered\.yml$/);

  const u = [];
  const ru = await run({ action: 'unban', githubId: '999' }, { fetchImpl: ghFetch(u, { govFile: "bans:\n  - github_id: '999'\n    reason: spam\n    at: '2026-01-01T00:00:00.000Z'\n" }), authorize: staffAdmin });
  assert.equal(ru.status, 200);
  assert.match(u.find((c) => c.method === 'PUT').url, /house\/bans\.yml$/);
});

test('sow-161: banning an already-banned member is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record, { govFile: "bans:\n  - github_id: '999'\n    reason: spam\n    at: '2026-01-01T00:00:00.000Z'\n" }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)), 'a no-op opens no PR');
});

test('sow-161: a malformed governance file fails CLOSED (502), never silently resetting the bans', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record, { govFile: 'just a string, not a map' }), authorize: staffAdmin });
  assert.equal(r.status, 502);
  assert.equal(record.length, 0, 'no write when the file cannot be parsed as a map');
});

test('sow-161: a governance file that THROWS on parse fails CLOSED (502), never wiping the list (review regression)', async () => {
  // Genuinely un-parseable YAML makes yaml.load THROW (distinct from a value that parses to a non-map). Both must
  // 502; the earlier bug conflated a throw with an empty file and would have reset the list on write.
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record, { govFile: 'bans:\n  - github_id: "999\n    reason: [unterminated' }), authorize: staffAdmin });
  assert.equal(r.status, 502);
  assert.equal(record.length, 0, 'a parse throw writes nothing');
});

test('sow-161: a missing governance file (404) is a legitimate fresh start (the ban still lands)', async () => {
  const record = [];
  const r = await run({ action: 'ban', githubId: '999' }, { fetchImpl: ghFetch(record, { govFile: null }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.match(deB64(record.find((c) => c.method === 'PUT').body.content), /github_id: '?999'?/);
});

// ---- sow-161 increment 3: role assignment (house/roles.yml = ROOT OF TRUST), SUPERADMIN-tier ----

const ROLES_YML = 'superadmins: []\nadmins: []\nmoderators: []\n';

test('sow-161: an ADMIN cannot assign roles (403) and writes nothing (roles.yml is superadmin-only)', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'moderator' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0, 'an admin is rejected at the endpoint before touching roles.yml');
});

test('sow-161: a superadmin assigns a role -> writes house/roles.yml on a caller-keyed branch', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'moderator' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/1/role-55', 'branch = the superadmin id (1) + role-<targetId>');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/roles\.yml$/);
  assert.match(deB64(put.body.content), /github_id: '?55'?/, 'the target is written into roles.yml');
});

test('sow-161: an invalid role value is 400 (never reaches roles.yml)', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: '55', role: 'root' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: a non-numeric github_id for role assignment is 400', async () => {
  const record = [];
  const r = await run({ action: 'role', githubId: 'x', role: 'admin' }, { fetchImpl: ghFetch(record, { govFile: ROLES_YML }), authorize: staffSuper });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

// ---- sow-161 increment 4: the QUOTES config manager (admin-tier; leading comment preserved) ----

const QUOTES_YML = '# Splash quotes (curated)\n# one per entry\nquotes: []\n';

test('sow-161: a MODERATOR cannot add a quote (403); config is admin-tier', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
});

test('sow-161: an admin quote-add writes house/quotes.yml PRESERVING the leading comment, on a text-slug branch', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const createRef = record.find((c) => /\/git\/refs$/.test(c.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/2/quote-add-hello-world', 'branch = admin id + quote-add-<textSlug>');
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/quotes\.yml$/);
  const content = deB64(put.body.content);
  assert.ok(content.startsWith('# Splash quotes (curated)'), 'the leading comment is preserved across the edit');
  assert.match(content, /Hello world/);
});

test('sow-161: an empty quote text is 400 (never touches quotes.yml)', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: '   ' }, { fetchImpl: ghFetch(record, { govFile: QUOTES_YML }), authorize: staffAdmin });
  assert.equal(r.status, 400);
  assert.equal(record.length, 0);
});

test('sow-161: adding an already-present quote is a clean no-op (200, no PR)', async () => {
  const record = [];
  const r = await run({ action: 'quote-add', text: 'Hello world', author: 'Ada' }, { fetchImpl: ghFetch(record, { govFile: '# c\nquotes:\n  - text: Hello world\n    author: Ada\n    enabled: true\n' }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true);
  assert.ok(!record.some((c) => /\/pulls$/.test(c.url)));
});

test('sow-161: quote-toggle disables an existing quote; quote-remove deletes it', async () => {
  const seed = '# c\nquotes:\n  - text: Hello world\n    author: Ada\n    enabled: true\n';
  const t = [];
  const rt = await run({ action: 'quote-toggle', text: 'Hello world', enabled: false }, { fetchImpl: ghFetch(t, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rt.status, 200);
  assert.match(deB64(t.find((c) => c.method === 'PUT').body.content), /enabled: false/);
  const rm = [];
  const rr = await run({ action: 'quote-remove', text: 'Hello world' }, { fetchImpl: ghFetch(rm, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rr.status, 200);
  assert.match(rm.find((c) => c.method === 'PUT').url, /house\/quotes\.yml$/);
});

test('sow-161: the quote-pool read is admin-gated and returns the FULL pool (incl. disabled)', async () => {
  const seed = '# c\nquotes:\n  - text: A\n    enabled: true\n  - text: B\n    enabled: false\n';
  const okr = await membershipAdminQuotePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffAdmin, signJwt });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.quotes.length, 2, 'the disabled quote is included (the splash JSON omits it)');
  const denied = await membershipAdminQuotePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffMod ? (async () => ({ ok: false, status: 403, body: { error: 'forbidden' } })) : undefined, signJwt });
  assert.equal(denied.status, 403);
});

// ---- sow-161 increment 4 (sub-slice 2): the NEWS-SOURCE config manager (admin-tier; id/url keyed) ----

const NEWS_YML = '# News sources (curated)\nsources: []\n';

test('sow-161: a MODERATOR cannot add a news source (403)', async () => {
  const record = [];
  const r = await run({ action: 'news-source-add', name: 'Hacker News', url: 'https://hnrss.org/frontpage' }, { fetchImpl: ghFetch(record, { govFile: NEWS_YML }), authorize: staffMod });
  assert.equal(r.status, 403);
  assert.equal(record.length, 0);
});

test('sow-161: an admin news-source-add writes house/news-sources.yml preserving the leading comment', async () => {
  const record = [];
  const r = await run({ action: 'news-source-add', name: 'Hacker News', url: 'https://hnrss.org/frontpage' }, { fetchImpl: ghFetch(record, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r.status, 200);
  assert.equal(r.body.number, 42);
  const put = record.find((c) => c.method === 'PUT');
  assert.match(put.url, /house\/news-sources\.yml$/);
  const content = deB64(put.body.content);
  assert.ok(content.startsWith('# News sources (curated)'), 'leading comment preserved');
  assert.match(content, /hnrss\.org/);
});

test('sow-161: a non-http(s) feed URL is rejected (400), and a missing name+id too', async () => {
  const rec1 = [];
  const r1 = await run({ action: 'news-source-add', name: 'Bad', url: 'javascript:alert(1)' }, { fetchImpl: ghFetch(rec1, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r1.status, 400);
  assert.equal(rec1.length, 0, 'a non-http url writes nothing');
  const rec2 = [];
  const r2 = await run({ action: 'news-source-add', url: 'https://ok.example/feed' }, { fetchImpl: ghFetch(rec2, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(r2.status, 400, 'a source with neither name nor id is rejected');
});

test('sow-161: an over-long news-source name / description is REJECTED at the endpoint (no silent truncation)', async () => {
  // The pure core caps name at 80 and description at 120; the endpoint must reject over-long input rather than let
  // the core silently truncate it (the same UX bug the quotes review caught).
  const recN = [];
  const rN = await run({ action: 'news-source-add', name: 'x'.repeat(81), url: 'https://ok.example/feed' }, { fetchImpl: ghFetch(recN, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(rN.status, 400, 'a name over 80 chars is rejected');
  assert.equal(recN.length, 0, 'an over-long name writes nothing');
  const recD = [];
  const rD = await run({ action: 'news-source-add', name: 'OK', url: 'https://ok.example/feed', description: 'y'.repeat(121) }, { fetchImpl: ghFetch(recD, { govFile: NEWS_YML }), authorize: staffAdmin });
  assert.equal(rD.status, 400, 'a description over 120 chars is rejected');
  assert.equal(recD.length, 0, 'an over-long description writes nothing');
});

test('sow-161: news-source-toggle / remove act by id on the sources file', async () => {
  const seed = '# c\nsources:\n  - id: hn\n    name: Hacker News\n    url: https://hnrss.org/frontpage\n    enabled: true\n';
  const t = [];
  const rt = await run({ action: 'news-source-toggle', id: 'hn', enabled: false }, { fetchImpl: ghFetch(t, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rt.status, 200);
  assert.match(deB64(t.find((c) => c.method === 'PUT').body.content), /enabled: false/);
  const rm = [];
  const rr = await run({ action: 'news-source-remove', id: 'hn' }, { fetchImpl: ghFetch(rm, { govFile: seed }), authorize: staffAdmin });
  assert.equal(rr.status, 200);
  assert.match(rm.find((c) => c.method === 'PUT').url, /house\/news-sources\.yml$/);
});

test('sow-161: the news-source pool read is admin-gated and returns the FULL pool (incl disabled)', async () => {
  const seed = '# c\nsources:\n  - id: a\n    enabled: true\n  - id: b\n    enabled: false\n';
  const okr = await membershipAdminNewsSourcePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: staffAdmin, signJwt });
  assert.equal(okr.status, 200);
  assert.equal(okr.body.sources.length, 2);
  const denied = await membershipAdminNewsSourcePool(req({}), env, { fetchImpl: ghFetch([], { govFile: seed }), authorize: async () => ({ ok: false, status: 403, body: {} }), signJwt });
  assert.equal(denied.status, 403);
});

// ---- sow-161 increment 4 review fixes: endpoint validation matches the pure-core limits ----

test('sow-161: a quote over the core cap (280 text / 80 author) is REJECTED, not silently truncated', async () => {
  const rec1 = [];
  const r1 = await run({ action: 'quote-add', text: 'x'.repeat(281) }, { fetchImpl: ghFetch(rec1, { govFile: '# c\nquotes: []\n' }), authorize: staffAdmin });
  assert.equal(r1.status, 400);
  assert.equal(rec1.length, 0);
  const rec2 = [];
  const r2 = await run({ action: 'quote-add', text: 'ok', author: 'a'.repeat(81) }, { fetchImpl: ghFetch(rec2, { govFile: '# c\nquotes: []\n' }), authorize: staffAdmin });
  assert.equal(r2.status, 400);
});

test('sow-161: a non-kebab source id (trailing/consecutive hyphen) is REJECTED at the endpoint', async () => {
  for (const id of ['a-', 'a--b', '-a', 'A_B', 'a'.repeat(65)]) {
    const rec = [];
    const r = await run({ action: 'news-source-remove', id }, { fetchImpl: ghFetch(rec, { govFile: '# c\nsources: []\n' }), authorize: staffAdmin });
    assert.equal(r.status, 400, `id ${id} must be rejected`);
    assert.equal(rec.length, 0);
  }
});
