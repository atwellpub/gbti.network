// SOW-014 x the MCP publish flow: publish() seeds the from-the-author intro comment into the SAME PR when
// `authorNote` is passed, so a new prompt/product publishes compliant in ONE pull request
// (operations.buildIntroCommentFile + the multi-file publishFiles path). add_prompt/add_product/publish_content
// forward `authorNote` to publish(), so this covers all three MCP tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { publish, saveDraft, authorContent, buildIntroCommentFile, describeContentPublish, AUTHOR_NOTE_TYPES, OperationError } from '../client/src/operations.mjs';
import { buildContentFile } from '../client/src/content-ops.mjs';
import { AUTHOR_NOTE_TYPES as WEB_AUTHOR_NOTE_TYPES } from '../src/lib/workbench-client-core.mjs';

const repoFile = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

// The set of types that may carry a from-the-author note exists in THREE places: the client core, the website
// core, and a literal in the client-ui editor, which sits behind a bundle boundary and can import neither. A
// disagreement is invisible until someone types a note that is then silently discarded, which is exactly the
// bug this work fixed. Reading the editor's SOURCE is the only way to hold the third copy to the other two.
test('DRIFT: the client core, the website core and the editor agree on which types carry an author note', () => {
  assert.deepEqual([...AUTHOR_NOTE_TYPES].sort(), [...WEB_AUTHOR_NOTE_TYPES].sort(), 'the two cores disagree');
  const src = repoFile('client-ui/src/elements/gbti-content-editor.mjs');
  const m = /const AUTHOR_NOTE_TYPES = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(m, 'the editor no longer declares AUTHOR_NOTE_TYPES as a literal Set; update this test with it');
  const editorTypes = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean).sort();
  assert.deepEqual(editorTypes, [...AUTHOR_NOTE_TYPES].sort(), 'the editor literal drifted from the cores');
  // Both gates in the editor must READ the constant, or widening it silently changes only one of them.
  assert.match(src, /const showAuthorNote = AUTHOR_NOTE_TYPES\.has\(this\.type\)/);
  assert.match(src, /const introSlug = AUTHOR_NOTE_TYPES\.has\(this\.type\)/);
});

// The REQUIREMENT is narrower than the permission, and conflating them would block every article that has no
// note. validate-content enforces an intro for product/prompt only; nothing requires one of a post.
test('an author note is PERMITTED on a post but never REQUIRED of one', () => {
  assert.ok(AUTHOR_NOTE_TYPES.has('post'));
  const validate = repoFile('scripts/validate-content.mjs');
  assert.match(validate, /a published product\/prompt requires a from-the-author introduction comment/);
  assert.doesNotMatch(validate, /requires? a from-the-author (introduction )?comment[^\n]*\bpost\b/);
});

const fakeRepo = (puts = [], opens = []) => ({
  upstream: 'gbti-network/gbti.network',
  async ensureFork() { return { full_name: 'alice/gbti.network', owner: 'alice' }; },
  async getDefaultBranch() { return 'main'; },
  async getBranchSha() { return 'sha'; },
  async ensureBranch() {},
  async getFileSha() { return null; },
  async putFile(_full, path, opts) { puts.push({ path, content: opts?.contentBase64, message: opts?.message }); },
  async findOpenPull() { return null; },
  async openPull(opts) { opens.push(opts); return { number: 7, html_url: 'u' }; },
});

function ctxFor({ membership = 'paid', repo = fakeRepo(), now = '2026-07-02T00:00:00Z' } = {}) {
  return {
    identity: () => ({ login: 'alice', githubId: '1', username: 'alice' }),
    getRepoClient: () => repo,
    membership: () => membership,
    store: { get: (k) => ({ githubToken: 'tok' })[k] },
    now: () => now,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
  };
}

const decode = (puts, re) => Buffer.from(puts.find((p) => re.test(p.path)).content, 'base64').toString('utf8');
const promptBuilt = () => buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'T', slug: 'my-prompt', shortDescription: 'x' }, body: 'B' });

test('buildIntroCommentFile: builds a PUBLIC authorNote intro for a prompt (deterministic intro-<slug> id)', () => {
  const f = buildIntroCommentFile({ username: 'alice', built: promptBuilt(), authorNote: 'Hello from me', now: '2026-07-02T00:00:00Z' });
  assert.equal(f.path, 'members/alice/comments/intro-my-prompt.md');
  assert.match(f.content, /targetType: prompt/);
  assert.match(f.content, /targetSlug: my-prompt/);
  assert.match(f.content, /authorNote: true/);
  assert.match(f.content, /visibility: public/);
  assert.match(f.content, /Hello from me/);
});

// 2026-08-11: this test previously asserted `null` for a post, which is what silently discarded a note typed
// on an article. The published article page has always PINNED an author note (ContentFooter -> Comments.astro,
// which then hides the "Written by" box), and validate-content has always permitted a public authorNote on a
// post; only the write path excluded them. A post's note is OPTIONAL, unlike a product/prompt's.
test('buildIntroCommentFile: a POST with a note seeds one, exactly like a prompt', () => {
  const post = buildContentFile({ type: 'post', username: 'alice', input: { title: 'T', slug: 'my-article' }, body: 'B' });
  const f = buildIntroCommentFile({ username: 'alice', built: post, authorNote: 'Why I wrote this.', now: '2026-08-11T00:00:00Z' });
  assert.equal(f.path, 'members/alice/comments/intro-my-article.md');
  assert.match(f.content, /targetType: post/);
  assert.match(f.content, /authorNote: true/);
  assert.match(f.content, /visibility: public/);
  assert.match(f.content, /Why I wrote this\./);
});

test('buildIntroCommentFile: null for a blank note, a missing note, or a type that cannot carry one', () => {
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt(), authorNote: '   ' }), null); // blank note
  assert.equal(buildIntroCommentFile({ username: 'alice', built: promptBuilt() }), null); // no note
  const share = { type: 'share', slug: 's', frontmatter: {} };
  assert.equal(buildIntroCommentFile({ username: 'alice', built: share, authorNote: 'note' }), null); // never a share
});

test('publish: a prompt WITH authorNote seeds the intro comment into the SAME PR (two files, one branch)', async () => {
  const puts = [];
  const out = await publish(ctxFor({ repo: fakeRepo(puts) }), {
    type: 'prompt', input: { title: 'My Prompt', slug: 'my-prompt', shortDescription: 'x' }, body: 'The prompt body', authorNote: 'Why I made this.',
  });
  assert.equal(out.prNumber, 7);
  assert.deepEqual(
    puts.map((p) => p.path).sort(),
    ['members/alice/comments/intro-my-prompt.md', 'members/alice/prompts/my-prompt/index.md'],
    'the prompt index.md AND its intro comment are committed to the same branch/PR',
  );
  const intro = decode(puts, /comments\/intro-my-prompt\.md$/);
  assert.match(intro, /authorNote: true/);
  assert.match(intro, /targetSlug: my-prompt/);
  assert.match(intro, /Why I made this\./);
});

test('publish: a POST with authorNote seeds the intro comment into the SAME PR', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), {
    type: 'post', input: { title: 'My Article', slug: 'my-article' }, body: 'The article body', authorNote: 'Why I wrote this.',
  });
  assert.deepEqual(
    puts.map((p) => p.path).sort(),
    ['members/alice/comments/intro-my-article.md', 'members/alice/posts/my-article/index.md'],
    'the article index.md AND its intro comment ride one branch, so the note is never silently dropped',
  );
  assert.match(decode(puts, /comments\/intro-my-article\.md$/), /targetType: post/);
});

test('publish: a POST WITHOUT authorNote stays a single-file PR (the note is optional for an article)', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), { type: 'post', input: { title: 'A', slug: 'no-note' }, body: 'Body' });
  assert.deepEqual(puts.map((p) => p.path), ['members/alice/posts/no-note/index.md']);
});

test('publish: a prompt WITHOUT authorNote stays a single-file PR (no regression)', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), { type: 'prompt', input: { title: 'P', slug: 'no-intro', shortDescription: 'x' }, body: 'Body' });
  assert.deepEqual(puts.map((p) => p.path), ['members/alice/prompts/no-intro/index.md']);
});

test('describeContentPublish: a human-readable title + body from the content (not the slug)', () => {
  const built = buildContentFile({ type: 'prompt', username: 'alice', input: { title: 'Author a GBTI SOW', slug: 'author-a-gbti-sow', shortDescription: 'A step-by-step skill.', categories: ['skill'] }, body: 'B' });
  const d = describeContentPublish(built, { hasIntro: true });
  assert.equal(d.title, 'Publish prompt: Author a GBTI SOW');
  assert.equal(d.message, d.title);
  assert.match(d.body, /## Author a GBTI SOW/);
  assert.match(d.body, /A step-by-step skill\./);
  assert.match(d.body, /Category: skill/);
  assert.match(d.body, /intro comment/);
});

test('publish: opens the PR with a DESCRIPTIVE title + non-empty body (not the bare "Update")', async () => {
  const opens = [];
  await publish(ctxFor({ repo: fakeRepo([], opens) }), {
    type: 'prompt', input: { title: 'Author a GBTI SOW', slug: 'author-a-gbti-sow', shortDescription: 'A skill.', categories: ['skill'] }, body: 'Body', authorNote: 'Why I made this.',
  });
  assert.equal(opens.length, 1);
  assert.equal(opens[0].title, 'Publish prompt: Author a GBTI SOW');
  assert.notEqual(opens[0].title, 'Update');
  assert.ok(opens[0].body && opens[0].body.length > 0, 'the PR body is not empty');
  assert.match(opens[0].body, /Author a GBTI SOW/);
});

test('publish: an explicit title/prBody still wins over the descriptive default', async () => {
  const opens = [];
  await publish(ctxFor({ repo: fakeRepo([], opens) }), {
    type: 'prompt', input: { title: 'T', slug: 's', shortDescription: 'x' }, body: 'B', title: 'My exact title', prBody: 'My exact body',
  });
  assert.equal(opens[0].title, 'My exact title');
  assert.equal(opens[0].body, 'My exact body');
});

// SOW-106 Phase 1: publishing merges to the network repo, and merged content is PUBLIC.
const docFor = (puts, re) => Buffer.from(puts.find((p) => re.test(p.path)).content, 'base64').toString('utf8');

test('publish: forces status: published (no silent hidden merged draft)', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), { type: 'prompt', input: { title: 'T', slug: 'p1', shortDescription: 'x' }, body: 'B' });
  assert.match(docFor(puts, /prompts\/p1\/index\.md$/), /^status: published$/m);
});

test('publish: respects an explicit status: draft (member self-unpublish)', async () => {
  const puts = [];
  await publish(ctxFor({ repo: fakeRepo(puts) }), { type: 'prompt', input: { title: 'T', slug: 'p2', shortDescription: 'x', status: 'draft' }, body: 'B' });
  assert.match(docFor(puts, /prompts\/p2\/index\.md$/), /^status: draft$/m);
});

test('saveDraft: a fork-staged draft carries status: published and opens NO pull request', async () => {
  const puts = [];
  const opens = [];
  await saveDraft(ctxFor({ repo: fakeRepo(puts, opens) }), { type: 'prompt', input: { title: 'T', slug: 'p3', shortDescription: 'x' }, body: 'B' });
  assert.match(docFor(puts, /prompts\/p3\/index\.md$/), /^status: published$/m);
  assert.equal(opens.length, 0, 'saveDraft stages on the fork with no PR');
});

// SOW-106 Phase 5: the MCP author entry forces an explicit publish-vs-draft intent.
test('authorContent: status published routes to publish (opens a PR)', async () => {
  const opens = [];
  const out = await authorContent(ctxFor({ repo: fakeRepo([], opens) }), { type: 'prompt', input: { title: 'T', slug: 'a1', shortDescription: 'x' }, body: 'B', status: 'published' });
  assert.equal(out.prNumber, 7);
  assert.equal(opens.length, 1, 'published -> a PR is opened');
});

test('authorContent: status draft routes to saveDraft (fork stage, no PR)', async () => {
  const opens = [];
  const puts = [];
  await authorContent(ctxFor({ repo: fakeRepo(puts, opens) }), { type: 'prompt', input: { title: 'T', slug: 'a2', shortDescription: 'x' }, body: 'B', status: 'draft' });
  assert.equal(opens.length, 0, 'draft -> staged on the fork, no PR');
  assert.ok(puts.some((p) => /prompts\/a2\/index\.md$/.test(p.path)), 'draft is committed to the fork branch');
});

test('authorContent: a missing status throws status-required (forced intent, nothing silently drafts)', async () => {
  await assert.rejects(
    authorContent(ctxFor(), { type: 'prompt', input: { title: 'T', slug: 'a3', shortDescription: 'x' }, body: 'B' }),
    (e) => e instanceof OperationError && e.code === 'status-required',
  );
});
