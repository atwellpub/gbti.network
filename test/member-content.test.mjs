// SOW-016: the client side of member-only content. The key never reaches the client: decrypt/encrypt go
// through the Worker (transport), the marker split is pure, and planMemberFiles emits the public stub + the
// encrypted .enc for a member-only publish (the gated plaintext is NEVER in the committed index.md).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptViaWorker, encryptViaWorker, fetchAndDecrypt, splitMemberMarkdown, encAssetFor, MEMBER_MARKER, MemberContentLockedError,
} from '../client/src/member-content.mjs';
import { planMemberFiles, decryptMemberAsset } from '../client/src/operations.mjs';
import { buildContentFile } from '../client/src/content-ops.mjs';

const BASE = 'https://signup.gbti.network';

test('decryptViaWorker returns plaintext on 200, locked on 403, error otherwise', async () => {
  const ok = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, text: 'members body' }) });
  assert.equal(await decryptViaWorker({ envelope: { ct: 'x' }, token: 't', signupBase: BASE, fetch: ok }), 'members body');
  const forbidden = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(decryptViaWorker({ envelope: { ct: 'x' }, token: 't', signupBase: BASE, fetch: forbidden }), MemberContentLockedError);
  const err = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(decryptViaWorker({ envelope: { ct: 'x' }, token: 't', signupBase: BASE, fetch: err }), /decrypt failed/);
});

test('decryptViaWorker is locked when not signed in (no token)', async () => {
  await assert.rejects(decryptViaWorker({ envelope: { ct: 'x' }, token: '', signupBase: BASE }), MemberContentLockedError);
});

test('encryptViaWorker returns the envelope on 200, locked on 403', async () => {
  let sent;
  const ok = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ ok: true, envelope: { v: 1, aad: sent.assetId } }) }; };
  const env = await encryptViaWorker({ plaintext: 'p', assetId: 'post:x:body', token: 't', signupBase: BASE, fetch: ok });
  assert.equal(env.aad, 'post:x:body');
  assert.deepEqual(sent, { plaintext: 'p', assetId: 'post:x:body' });
  const forbidden = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(encryptViaWorker({ plaintext: 'p', assetId: 'a', token: 't', signupBase: BASE, fetch: forbidden }), MemberContentLockedError);
});

test('fetchAndDecrypt fetches the .enc then decrypts via the Worker', async () => {
  const envelope = { v: 1, kid: '1', iv: 'AA', aad: 'a', ct: 'cc' };
  const fetch = async (url) => url.endsWith('.enc')
    ? { ok: true, status: 200, json: async () => envelope }
    : { ok: true, status: 200, json: async () => ({ ok: true, text: 'unlocked' }) };
  assert.equal(await fetchAndDecrypt({ url: 'https://cdn/x.enc', token: 't', signupBase: BASE, fetch }), 'unlocked');
});

test('splitMemberMarkdown splits at the marker; no marker => memberPart null', () => {
  const r = splitMemberMarkdown(`Public teaser.\n\n${MEMBER_MARKER}\n\nGated body here.`);
  assert.equal(r.publicPart, 'Public teaser.');
  assert.equal(r.memberPart, 'Gated body here.');
  assert.equal(splitMemberMarkdown('just public').memberPart, null);
});

test('encAssetFor derives the .enc path + asset id', () => {
  assert.deepEqual(encAssetFor('post', 'alice', 'my-post'), { assetId: 'post:my-post:body', path: 'members/alice/_enc/post-my-post-body.enc' });
});

const fakeEncrypt = async (plaintext, assetId) => ({ v: 1, kid: '1', iv: 'AA', aad: assetId, ct: Buffer.from(plaintext).toString('base64') });

test('planMemberFiles: a whole-item members post encrypts the WHOLE body; index.md leaks no plaintext', async () => {
  const built = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'my-post', status: 'published', visibility: 'members', publishedAt: '2026-06-07' }, body: 'SECRET_MEMBER_BODY' });
  const plan = await planMemberFiles({ built, body: 'SECRET_MEMBER_BODY', encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2);
  const idx = plan.files.find((f) => f.path === 'members/alice/posts/my-post/index.md');
  const enc = plan.files.find((f) => f.path === 'members/alice/_enc/post-my-post-body.enc');
  assert.ok(idx && enc);
  assert.doesNotMatch(idx.content, /SECRET_MEMBER_BODY/, 'gated plaintext must NOT be in index.md');
  assert.match(idx.content, /encryptedBody: members\/alice\/_enc\/post-my-post-body\.enc/);
  assert.equal(enc.content, JSON.stringify(await fakeEncrypt('SECRET_MEMBER_BODY', 'post:my-post:body')));
});

test('planMemberFiles: a public post with a members-only SECTION keeps the teaser, encrypts the tail', async () => {
  const body = `Public teaser TEASER123.\n\n${MEMBER_MARKER}\n\nGATED_SECTION_TAIL`;
  const built = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'mode-c', status: 'published', visibility: 'public', publishedAt: '2026-06-07' }, body });
  const plan = await planMemberFiles({ built, body, encrypt: fakeEncrypt });
  const idx = plan.files.find((f) => f.path.endsWith('index.md'));
  assert.match(idx.content, /TEASER123/, 'public teaser stays');
  assert.doesNotMatch(idx.content, /GATED_SECTION_TAIL/, 'gated tail must NOT be in index.md');
  assert.match(idx.content, /encryptedBody:/);
});

// A Mode B stub used to be all-or-nothing: `visibility: members` gated the ENTIRE body, so the public page
// could show a title and a one-line description and nothing else. A members item may now carry a teaser
// before the marker, which is what lets a walled prompt say what it is and what you would do with it.
test('planMemberFiles: a MEMBERS item with a marker keeps the teaser public and encrypts only the tail', async () => {
  const body = `Public teaser TEASER_B.\n\n## Install\n1. Do the thing\n\n${MEMBER_MARKER}\n\n## The skill file\nGATED_PAYLOAD_B`;
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'mode-b-teaser', shortDescription: 'x', status: 'published', visibility: 'members', publicStub: true, publishedAt: '2026-06-07' }, body });
  const plan = await planMemberFiles({ built, body, encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2, 'a teaser + an encrypted tail is still two files');
  const idx = plan.files.find((f) => f.path.endsWith('index.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  assert.ok(idx && enc, 'both the index.md and the .enc must be planned');
  assert.match(idx.content, /TEASER_B/, 'the public teaser must survive into index.md');
  assert.match(idx.content, /## Install/, 'everything before the marker is public');
  assert.doesNotMatch(idx.content, /GATED_PAYLOAD_B/, 'the gated payload must NOT be in index.md');
  assert.doesNotMatch(idx.content, /<!-- members-only -->/, 'the marker itself must never reach index.md');
  assert.match(idx.content, /encryptedBody: members\/alice\/_enc\/prompt-mode-b-teaser-body\.enc/);
  assert.equal(enc.content, JSON.stringify(await fakeEncrypt('## The skill file\nGATED_PAYLOAD_B', 'prompt:mode-b-teaser:body')));
});

test('planMemberFiles: a MEMBERS item whose marker has an EMPTY tail gates the whole body and strips the marker', async () => {
  const body = `WOULD_BE_TEASER\n\n${MEMBER_MARKER}\n   `;
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'empty-gate', shortDescription: 'x', status: 'published', visibility: 'members', publicStub: true, publishedAt: '2026-06-07' }, body });
  const plan = await planMemberFiles({ built, body, encrypt: fakeEncrypt });
  const idx = plan.files.find((f) => f.path.endsWith('index.md'));
  assert.equal(plan.files.length, 2, 'the body is gated wholesale rather than published behind an empty lock');
  assert.doesNotMatch(idx.content, /WOULD_BE_TEASER/, 'a lock that decrypts to nothing must not expose the body instead');
  assert.doesNotMatch(idx.content, /<!-- members-only -->/, 'the marker must be stripped');
});

test('planMemberFiles: plain public content returns null (normal single-file publish)', async () => {
  const built = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'plain', status: 'published', visibility: 'public', publishedAt: '2026-06-07' }, body: 'just public, no marker' });
  assert.equal(await planMemberFiles({ built, body: 'just public, no marker', encrypt: fakeEncrypt }), null);
});

test('planMemberFiles: a marker with an EMPTY tail strips the marker and publishes a single clean file (no .enc, no leak)', async () => {
  const body = `Public teaser only.\n\n${MEMBER_MARKER}\n  `; // marker present, gated tail empty
  const built = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'empty-tail', status: 'published', visibility: 'public', publishedAt: '2026-06-07' }, body });
  const plan = await planMemberFiles({ built, body, encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 1, 'no .enc when there is nothing to gate');
  assert.doesNotMatch(plan.files[0].content, /<!-- members-only -->/, 'the marker must be stripped from index.md');
  assert.match(plan.files[0].content, /Public teaser only\./);
});

test('planMemberFiles: a MemberContentLockedError from encrypt propagates (publish maps it to membership-required, opens no PR)', async () => {
  const built = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'locked', status: 'published', visibility: 'members', publishedAt: '2026-06-07' }, body: 'gated' });
  const lockedEncrypt = async () => { throw new MemberContentLockedError(); };
  await assert.rejects(planMemberFiles({ built, body: 'gated', encrypt: lockedEncrypt }), MemberContentLockedError);
});

test('planMemberFiles: a profile (no slug) is never body-gated', async () => {
  const built = buildContentFile({ type: 'profile', username: 'alice', input: { displayName: 'Alice', status: 'published', visibility: 'members' }, body: 'bio' });
  assert.equal(await planMemberFiles({ built, body: 'bio', encrypt: fakeEncrypt }), null);
});

// SOW-016 read path (the host capability the <gbti-locked-content> element calls).
const decryptCtx = ({ status = 200, text = 'unlocked', token = 't', envelope } = {}) => ({
  identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }),
  reader: { readFile: async () => JSON.stringify(envelope ?? { v: 1, kid: '1', iv: 'AA', aad: 'a', ct: 'cc' }) },
  store: { get: (k) => (k === 'githubToken' ? token : undefined) },
  fetch: async () => (status === 200
    ? { ok: true, status: 200, json: async () => ({ ok: true, text }) }
    : { ok: false, status, json: async () => ({}) }),
});

test('decryptMemberAsset returns the plaintext for an entitled member (host reads the .enc, Worker decrypts)', async () => {
  const r = await decryptMemberAsset(decryptCtx({ text: 'members body' }), { encPath: 'members/alice/_enc/post-x-body.enc' });
  assert.equal(r.text, 'members body');
});

test('decryptMemberAsset maps a Worker 403 to membership-required', async () => {
  await assert.rejects(decryptMemberAsset(decryptCtx({ status: 403 }), { encPath: 'members/alice/_enc/x.enc' }), (e) => e.code === 'membership-required');
});

test('decryptMemberAsset requires an encPath', async () => {
  await assert.rejects(decryptMemberAsset(decryptCtx({}), {}), (e) => e.code === 'bad-request');
});
