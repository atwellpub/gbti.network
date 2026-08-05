// SOW-058 P4 (+ SOW-087): the content-publish enqueue runner. Injected readFile + mention resolver + a fake KV
// REST fetch (Map-backed). Asserts: a published post/product/prompt/SHARE is enqueued (drafts excluded), as a
// PENDING item (awaiting superadmin approval), metadata only, carrying its routing category + moderation flags
// + the author displayName; a dry-run writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { main, toQueueInput } from '../scripts/enqueue-syndication.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

// SOW-125: inject an explicit config so a test never depends on the live house/syndication-config.yml. Enable a
// couple of auto channels; the default matrix (posts on, shares off) then drives the enqueue gate.
const CFG_POSTS_ON = syndicationConfigFromParsed({ enabled: true, channels: { discord: true, 'discord-category': true } });
// A config that ALSO auto-shares shares (share cell flipped on for discord).
const CFG_SHARES_ON = syndicationConfigFromParsed({ enabled: true, channels: { discord: true, 'discord-category': true }, auto_matrix: { share: { discord: 'on' } } });

function fakeKvFetch(store) {
  return async (url, opts = {}) => {
    const m = /namespaces\/[^/]+\/values\/(.+)$/.exec(url);
    const key = m ? decodeURIComponent(m[1]) : '';
    if ((opts.method || 'GET') === 'PUT') { store.set(key, String(opts.body)); return { ok: true, status: 200 }; }
    if (!store.has(key)) return { ok: false, status: 404, text: async () => '' };
    return { ok: true, status: 200, text: async () => store.get(key) };
  };
}

const ENV = { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' };

const POST = `---\ntitle: My Post\nstatus: published\nvisibility: public\nauthor: alice\nshortDescription: A short blurb.\ncoverImage: https://img/x.jpg\n---\nBody.`;
const DRAFT = `---\ntitle: Draft\nstatus: draft\nauthor: alice\n---\nx`;
const SHARE = `---\ntitle: A share\nstatus: published\nauthor: alice\nurl: https://ext.com/x\ncategory: devops\nshortDescription: A devops find.\n---\nWorth your time, the pipeline section alone.`;
// sow-147: a MEMBERS share, whose body must never resolve as the author note (it is encrypted content).
const SHARE_MEMBERS = `---\ntitle: A members share\nstatus: published\nvisibility: members\nauthor: alice\nurl: https://ext.com/m\ncategory: devops\n---\nMy private note.`;
const PROFILE = `---\ntype: profile\nusername: alice\ndisplayName: "Alice Q"\n---\nHi.`;

const FILES = {
  'members/alice/posts/x/index.md': POST,
  'members/alice/posts/d/index.md': DRAFT,
  'members/alice/shares/s1.md': SHARE,
  'members/alice/shares/s2.md': SHARE_MEMBERS,
  'members/alice/profile.md': PROFILE,
};
const deps = (store, config = CFG_POSTS_ON) => ({
  readFile: (rel) => FILES[rel] ?? null,
  resolveMention: async (author) => `@${author}`,
  enqueueFetch: fakeKvFetch(store),
  config, // SOW-125: the auto-share matrix that gates the enqueue
});

test('toQueueInput maps a published post to a metadata-only queue input (no body)', () => {
  const inp = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'My Post', visibility: 'public', hasPublicPage: true },
    fm: { shortDescription: 'A short blurb.', coverImage: 'https://img/x.jpg' },
    rel: 'members/alice/posts/x/index.md', mention: '@alice', siteOrigin: 'https://gbti.network',
  });
  assert.equal(inp.source, 'post');
  assert.equal(inp.targetSlug, 'members/alice/posts/x');
  assert.equal(inp.url, 'https://gbti.network/articles/x/');
  assert.equal(inp.blurb, 'A short blurb.');
  assert.equal(inp.image, 'https://img/x.jpg');
  assert.equal(inp.trigger, 'publish');
  assert.ok(!('body' in inp), 'a queue input never carries the body');
});

// SOW-087: a share maps to a queue input carrying its external url, its flat topic category, and no body.
test('toQueueInput maps a published share (external url + category); content takes categories[0]', () => {
  const share = toQueueInput({
    item: { type: 'share', slug: 's1', author: 'alice', title: 'A share', visibility: 'members', hasPublicPage: false, shareUrl: 'https://ext.com/x' },
    fm: { shortDescription: 'A devops find.', category: 'devops' },
    rel: 'members/alice/shares/s1.md', mention: '@alice', siteOrigin: 'https://gbti.network', authorName: 'Alice Q',
  });
  assert.equal(share.source, 'share');
  assert.equal(share.url, 'https://ext.com/x');
  assert.equal(share.category, 'devops');
  assert.equal(share.authorName, 'Alice Q');
  assert.deepEqual(share.flags, []);
  const post = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'T', visibility: 'public', hasPublicPage: true },
    fm: { categories: ['ai', 'imagegen'] },
    rel: 'members/alice/posts/x/index.md', mention: null, siteOrigin: 'https://gbti.network',
  });
  assert.equal(post.category, 'ai'); // the top-level taxonomy key
});

// SOW-087: the moderation word lists stamp flags from the POSTED surface (title + blurb) only.
test('toQueueInput stamps moderation flags from title + blurb', () => {
  const moderation = { lists: { profanity: ['shit'], political: ['election'] } };
  const flagged = toQueueInput({
    item: { type: 'post', slug: 'x', author: 'alice', title: 'This election take', visibility: 'public', hasPublicPage: true },
    fm: { shortDescription: 'Total shit, honestly.' },
    rel: 'members/alice/posts/x/index.md', mention: null, siteOrigin: 'https://gbti.network', moderation,
  });
  assert.deepEqual(flagged.flags, ['political', 'profanity']);
  const clean = toQueueInput({
    item: { type: 'post', slug: 'y', author: 'alice', title: 'A calm title', visibility: 'public', hasPublicPage: true },
    fm: {}, rel: 'members/alice/posts/y/index.md', mention: null, siteOrigin: 'https://gbti.network', moderation,
  });
  assert.deepEqual(clean.flags, []);
});

// SOW-125: with the DEFAULT matrix (shares off), a published share is SKIPPED at enqueue; the post still
// enqueues. This is the fix for shares auto-posting to Bluesky. The draft is excluded as before.
test('apply enqueues the post but SKIPS the share by default (shares off), as PENDING items', async () => {
  const store = new Map();
  const added = ['members/alice/posts/x/index.md', 'members/alice/posts/d/index.md', 'members/alice/shares/s1.md'];
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: added.join(',') }, deps: deps(store) });
  assert.equal(r.enqueued, 1);
  assert.deepEqual(r.inputs.map((i) => i.targetSlug), ['members/alice/posts/x']);
  const itemKeys = [...store.keys()].filter((k) => k.startsWith('synd:item:'));
  assert.equal(itemKeys.length, 1);
  const item = JSON.parse(store.get(itemKeys[0]));
  assert.equal(item.status, 'pending'); // waits for superadmin approval, never auto-posts
  assert.equal(item.source, 'post');
});

// SOW-125: when the share cell is flipped ON, the share enqueues (proving the gate is the only thing stopping it).
test('apply enqueues the share when its matrix cell is on', async () => {
  const store = new Map();
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/shares/s1.md' }, deps: deps(store, CFG_SHARES_ON) });
  assert.equal(r.enqueued, 1);
  const share = JSON.parse(store.get([...store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(share.source, 'share');
  assert.equal(share.url, 'https://ext.com/x'); // the off-network link
  assert.equal(share.category, 'devops');
  assert.equal(share.authorName, 'Alice Q'); // from members/alice/profile.md
  assert.deepEqual(share.flags, []);
});

test('dry-run plans but writes nothing to KV', async () => {
  const store = new Map();
  const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/posts/x/index.md' }, deps: deps(store) });
  assert.equal(r.enqueued, 0);
  assert.equal(r.inputs.length, 1);
  assert.equal(store.size, 0);
});

// SOW-125: fail-closed. The default config (a missing/unreadable file normalizes to this) has NO channel enabled,
// so deliverChannelsForType is empty for every type and NOTHING is enqueued -- nothing can auto-post by accident.
test('a missing/unreadable syndication config enqueues nothing (fail-closed)', async () => {
  const store = new Map();
  const added = ['members/alice/posts/x/index.md', 'members/alice/shares/s1.md'];
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: added.join(',') }, deps: deps(store, syndicationConfigFromParsed({})) });
  assert.equal(r.enqueued, 0);
  assert.equal([...store.keys()].filter((k) => k.startsWith('synd:item:')).length, 0);
});

// SOW-112: a permalink rename adds the new path, but it must never re-announce.
test('a renamed item (canonical-shaped redirectFrom) is skipped; a legacy-migrated item still announces', async () => {
  const renamed = `---\ntitle: Renamed\nstatus: published\nvisibility: public\nauthor: alice\nredirectFrom: ["/articles/old-slug/"]\n---\nx`;
  const legacy = `---\ntitle: Legacy\nstatus: published\nvisibility: public\nauthor: alice\nredirectFrom: ["/devops/frameworks/old-wp-path/"]\n---\nx`;
  const files = {
    'members/alice/posts/renamed/index.md': renamed,
    'members/alice/posts/legacy/index.md': legacy,
  };
  const store = new Map();
  const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: Object.keys(files).join(',') }, deps: {
    readFile: (rel) => files[rel] ?? null,
    resolveMention: async () => null,
    enqueueFetch: fakeKvFetch(store),
    config: CFG_POSTS_ON, // SOW-125: inject the config so the test never reads the live house/syndication-config.yml
  } });
  assert.deepEqual(r.inputs.map((i) => i.targetSlug), ['members/alice/posts/legacy']);
});

test('apply enqueues the share when its only deliverable cell is on-manual (the queue route)', async () => {
  const cfg = syndicationConfigFromParsed({ enabled: true, auto_matrix: { share: { discord: 'on-manual' } } });
  const store = new Map();
  const r = await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/shares/s1.md' }, deps: deps(store, cfg) });
  assert.equal(r.enqueued, 1, 'an on-manual cell delivers (as a Social Queue task at drain time)');
});

// SOW-014 + the Reddit first comment: the AUTO rail must carry the from-the-author intro so
// {author-note}, {author-note-italic} and {author-note-block} render. It never did, so the stored
// reddit-comment template (which quotes the note) rendered a bare "".
test('the intro comment body is carried onto the queue item as authorNote', async () => {
  const files = {
    'members/alice/prompts/p1/index.md': `---\ntitle: A Prompt\nstatus: published\nvisibility: public\nauthor: alice\nshortDescription: Blurb.\n---\nBody.`,
    'members/alice/comments/intro-p1.md': `---\ntype: comment\nid: intro-p1\nauthor: alice\ntargetType: prompt\ntargetSlug: p1\nauthorNote: true\nvisibility: public\nstatus: published\ncreatedAt: 2026-07-30\n---\nWhy I built it.`,
    'members/alice/profile.md': PROFILE,
  };
  const store = new Map();
  const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/prompts/p1/index.md' }, deps: {
    readFile: (rel) => files[rel] ?? null,
    resolveMention: async (a) => `@${a}`,
    enqueueFetch: fakeKvFetch(store),
    config: syndicationConfigFromParsed({ enabled: true, channels: { discord: true } }),
  } });
  assert.equal(r.inputs.length, 1);
  assert.equal(r.inputs[0].authorNote, 'Why I built it.');
});

// A members-visibility or unflagged comment is NOT the intro and must never reach an off-network channel.
test('a non-authorNote or members intro is not carried as authorNote', async () => {
  const base = `---\ntitle: A Prompt\nstatus: published\nvisibility: public\nauthor: alice\nshortDescription: Blurb.\n---\nBody.`;
  const run = async (intro) => {
    const files = { 'members/alice/prompts/p1/index.md': base, 'members/alice/profile.md': PROFILE, ...(intro ? { 'members/alice/comments/intro-p1.md': intro } : {}) };
    const r = await main({ argv: [], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/prompts/p1/index.md' }, deps: {
      readFile: (rel) => files[rel] ?? null,
      resolveMention: async (a) => `@${a}`,
      enqueueFetch: fakeKvFetch(new Map()),
      config: syndicationConfigFromParsed({ enabled: true, channels: { discord: true } }),
    } });
    return r.inputs[0].authorNote;
  };
  assert.equal(await run(null), null, 'no intro file');
  assert.equal(await run(`---\ntype: comment\nid: intro-p1\nauthor: alice\ntargetType: prompt\ntargetSlug: p1\nauthorNote: true\nvisibility: members\nstatus: published\ncreatedAt: 2026-07-30\n---\nSecret.`), null, 'members visibility');
  assert.equal(await run(`---\ntype: comment\nid: intro-p1\nauthor: alice\ntargetType: prompt\ntargetSlug: p1\nvisibility: public\nstatus: published\ncreatedAt: 2026-07-30\n---\nJust a reply.`), null, 'not flagged authorNote');
});

// sow-147 (owner, 2026-08-05: "make the share comment the same as the author note"): a share carries no
// intro-comment file, so its author note IS its markdown body — the text the composer collects and the
// add_share MCP tool writes. Without this, every {author-note} token rendered empty for every share.
test('a PUBLIC share resolves {author-note} from its own body', async () => {
  const store = new Map();
  await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/shares/s1.md' }, deps: deps(store, CFG_SHARES_ON) });
  const item = JSON.parse(store.get([...store.keys()].find((k) => k.startsWith('synd:item:'))));
  assert.equal(item.source, 'share');
  assert.equal(item.authorNote, 'Worth your time, the pipeline section alone.');
});

// The visibility guard: a members share body is encrypted member content and must never leave as plaintext.
test('a MEMBERS share resolves no author note', async () => {
  const store = new Map();
  await main({ argv: ['--apply'], env: { ...ENV, SYNDICATE_ADDED: 'members/alice/shares/s2.md' }, deps: deps(store, CFG_SHARES_ON) });
  const key = [...store.keys()].find((k) => k.startsWith('synd:item:'));
  if (key) assert.equal(JSON.parse(store.get(key)).authorNote, null);
});
