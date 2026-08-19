// The gating planner `planMemberFiles` is implemented TWICE, deliberately:
//   canonical  client/src/operations.mjs           (the extension + npm CMS host)
//   mirror     src/lib/workbench-client-core.mjs   (the website WorkBench)
// The split is intentional and documented at workbench-client-core.mjs: importing operations.mjs would drag
// fork-mode and fifteen REST clients into the page bundle. This file does NOT reverse that decision; it
// protects it. This is the function that decides which plaintext reaches a PUBLIC repository, so the two
// diverging silently is the failure worth a dedicated guard: publishing the same item from the website would
// commit a different file set than publishing it from the extension.
//
// The four helpers both implementations lean on (splitMemberMarkdown, MEMBER_MARKER, encAssetFor,
// serializeContentFile) are SHARED imports from client/src, so the only divergence surface is the planner body
// itself, and that is exactly what this file drives.
import test from 'node:test';
import assert from 'node:assert/strict';
import { planMemberFiles as canonical } from '../client/src/operations.mjs';
import { planMemberFiles as mirror } from '../src/lib/workbench-client-core.mjs';
import { buildContentFile, buildCommentFile, buildShareFile, commentId, shareId } from '../client/src/content-ops.mjs';

// Deterministic, so two runs of the same input are byte-identical and any difference is a real one.
const fakeEncrypt = async (plaintext, assetId) => ({ v: 1, kid: '1', iv: 'IV', aad: assetId, ct: `CT(${plaintext})` });

const MARKER = '<!-- members-only -->';

// One fixture table, driven through BOTH implementations. `branch` names the code path each case exists to
// reach, and the coverage test at the bottom asserts every branch is actually reached, so this file cannot
// quietly degrade into a guard that passes because it tested nothing.
const post = (input, body) => buildContentFile({ type: 'post', username: 'gwen', input: { title: 'T', status: 'published', ...input }, body });
const prompt = (input, body) => buildContentFile({ type: 'prompt', username: 'gwen', input: { title: 'T', shortDescription: 'x', status: 'published', ...input }, body });

const FIXTURES = [
  {
    name: 'slugless item (a profile) is never body-gated',
    branch: 'null:no-slug',
    built: { slug: null, path: 'members/gwen/profile.md', frontmatter: { visibility: 'members' } },
    body: 'anything at all',
  },
  {
    name: 'Mode A/B: members item, no marker, whole body gated',
    branch: 'gated:whole-body',
    built: post({ slug: 'whole-item', visibility: 'members' }, 'SECRET_WHOLE'),
    body: 'SECRET_WHOLE',
  },
  {
    name: 'Mode B: members item WITH a teaser before the marker',
    branch: 'gated:teaser',
    built: prompt({ slug: 'mode-b-teaser', visibility: 'members', publicStub: true }, `TEASER_TEXT\n\n${MARKER}\n\nGATED_TAIL`),
    body: `TEASER_TEXT\n\n${MARKER}\n\nGATED_TAIL`,
  },
  {
    name: 'members item whose marker has an EMPTY tail falls back to whole-body gating',
    branch: 'gated:whole-body',
    built: post({ slug: 'empty-tail-members', visibility: 'members' }, `BODY_BEFORE\n\n${MARKER}\n\n   `),
    body: `BODY_BEFORE\n\n${MARKER}\n\n   `,
  },
  {
    name: 'members item with an EMPTY body has nothing to encrypt',
    branch: 'null:empty-members-body',
    built: post({ slug: 'empty-members', visibility: 'members' }, '   '),
    body: '   ',
  },
  {
    name: 'plain public item with no marker needs no encryption',
    branch: 'null:plain-public',
    built: post({ slug: 'plain-public', visibility: 'public' }, 'ORDINARY_PUBLIC_BODY'),
    body: 'ORDINARY_PUBLIC_BODY',
  },
  {
    name: 'Mode C: public item with a gated section',
    branch: 'gated:mode-c',
    built: post({ slug: 'mode-c', visibility: 'public' }, `PUBLIC_INTRO\n\n${MARKER}\n\nGATED_SECTION`),
    body: `PUBLIC_INTRO\n\n${MARKER}\n\nGATED_SECTION`,
  },
  {
    name: 'public item whose marker has an EMPTY tail publishes as a single plain file',
    branch: 'single-file:marker-stripped',
    built: post({ slug: 'public-empty-tail', visibility: 'public' }, `PUBLIC_ONLY\n\n${MARKER}\n\n  `),
    body: `PUBLIC_ONLY\n\n${MARKER}\n\n  `,
  },
  {
    name: 'house scope places the ciphertext in house/_enc/, not members/<user>/_enc/',
    branch: 'gated:house-scope',
    built: buildContentFile({ type: 'post', username: 'gwen', scope: 'house', input: { slug: 'house-gated', title: 'T', visibility: 'members', status: 'published' }, body: 'HOUSE_SECRET' }),
    body: 'HOUSE_SECRET',
  },
  {
    name: 'members comment',
    branch: 'gated:whole-body',
    built: buildCommentFile({ username: 'gwen', input: { id: commentId('2026-01-02T03:04:05Z', 'abc123'), targetType: 'post', targetSlug: 'hello', createdAt: '2026-01-02T03:04:05Z', status: 'published', visibility: 'members' }, body: 'MEMBER_REPLY' }),
    body: 'MEMBER_REPLY',
  },
  {
    name: 'members share',
    branch: 'gated:whole-body',
    built: buildShareFile({ username: 'gwen', input: { id: shareId('2026-03-01T00:00:00Z', 'astro'), createdAt: '2026-03-01T00:00:00Z', title: 'Astro', visibility: 'members' }, body: 'MEMBER_TAKE' }),
    body: 'MEMBER_TAKE',
  },
  {
    name: 'public share',
    branch: 'null:plain-public',
    built: buildShareFile({ username: 'gwen', input: { id: shareId('2026-03-01T00:00:00Z', 'public note'), createdAt: '2026-03-01T00:00:00Z', title: 'Public note', visibility: 'public' }, body: 'A_PUBLIC_LINK' }),
    body: 'A_PUBLIC_LINK',
  },
];

// The SHARED contract: what both hosts must agree on is the committed file set and the ciphertext path. The
// canonical additionally returns `assetId`; the mirror does not, because the page has no use for it. That is a
// known, intentional asymmetry, asserted explicitly below rather than normalized away, so that if it ever
// changes this file reports it instead of hiding it.
const shared = (plan) => (plan == null ? null : { files: plan.files, encPath: plan.encPath ?? undefined });

for (const fx of FIXTURES) {
  test(`planMemberFiles drift: ${fx.name}`, async () => {
    const a = await canonical({ built: fx.built, body: fx.body, encrypt: fakeEncrypt });
    const b = await mirror({ built: fx.built, body: fx.body, encrypt: fakeEncrypt });
    assert.deepEqual(
      shared(b),
      shared(a),
      'the website WorkBench planner disagrees with the canonical planner: publishing this item from the '
        + 'website would commit a different file set than publishing it from the extension',
    );
  });
}

test('planMemberFiles drift: the known asymmetry is assetId ONLY, on the canonical side', async () => {
  const fx = FIXTURES.find((f) => f.branch === 'gated:whole-body');
  const a = await canonical({ built: fx.built, body: fx.body, encrypt: fakeEncrypt });
  const b = await mirror({ built: fx.built, body: fx.body, encrypt: fakeEncrypt });
  assert.equal(typeof a.assetId, 'string', 'the canonical planner returns assetId');
  assert.equal(b.assetId, undefined, 'the mirror deliberately does not; the page has no use for it');
  assert.deepEqual(
    Object.keys(a).filter((k) => k !== 'assetId').sort(),
    Object.keys(b).sort(),
    'assetId is the ONLY key the two are allowed to differ on',
  );
});

// Without this, every assertion above could pass while the table silently stopped reaching the interesting
// paths. A guard that fires on zero reads exactly like a guard that fires on everything.
test('planMemberFiles drift: the fixture table actually reaches every branch', async () => {
  const reached = new Map();
  for (const fx of FIXTURES) {
    const plan = await canonical({ built: fx.built, body: fx.body, encrypt: fakeEncrypt });
    const actual = plan == null ? 'null' : plan.files.length === 1 ? 'single-file' : 'gated';
    const expected = fx.branch.split(':')[0];
    assert.equal(actual, expected, `fixture "${fx.name}" is declared ${fx.branch} but produced ${actual}`);
    reached.set(fx.branch, (reached.get(fx.branch) ?? 0) + 1);
  }
  for (const branch of ['null:no-slug', 'null:empty-members-body', 'null:plain-public', 'gated:whole-body', 'gated:teaser', 'gated:mode-c', 'gated:house-scope', 'single-file:marker-stripped']) {
    assert.ok(reached.get(branch) > 0, `no fixture reaches ${branch}`);
  }
  // The teaser and Mode C cases are the ones that carry public text alongside gated text, which is where a
  // divergence would leak or wipe. Prove they really did split rather than gating everything.
  const teaser = FIXTURES.find((f) => f.branch === 'gated:teaser');
  const plan = await canonical({ built: teaser.built, body: teaser.body, encrypt: fakeEncrypt });
  const md = plan.files.find((f) => f.path.endsWith('.md'));
  assert.match(md.content, /TEASER_TEXT/, 'the teaser fixture must actually retain public text');
  assert.doesNotMatch(md.content, /GATED_TAIL/, 'the teaser fixture must actually gate the tail');
});
