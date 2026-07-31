// SOW-088: the dev.to destination — the pure body pipeline (fail-closed guards, marker cut, CDN image
// rewrite, tag normalization) and the adapter (payload shape, skips, error surfacing). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentPathFor, prepareDevtoBody, normalizeDevtoTags, DEVTO_CDN_BASE } from '../clients/syndication/devto-body.mjs';
import { createDevtoAdapter } from '../clients/syndication/devto.mjs';

const ITEM = { source: 'post', targetSlug: 'my-article', author: 'atwellpub', title: 'My Article', url: 'https://gbti.network/articles/my-article/', visibility: 'public', categoryPath: ['ai', 'devops'] };
const FILE = `---
title: My Article
status: published
visibility: public
tags:
  - Claude-Code
  - agent skills
  - ai
  - workflow
  - extra-tag
---

Intro paragraph with a relative image:

![](./images/pic.webp)

And one without the dot: ![x](images/two.png)

<!-- members-only -->

SECRET members part.
`;

// The AUTO rail's targetSlug is the queue PATH KEY (already the full folder path, see pathKey in
// scripts/enqueue-syndication.mjs), while the manual rail passes a bare slug. Wrapping the first shape
// produced a doubled path and a hard 404 on every auto-rail crosspost.
test('contentPathFor accepts a targetSlug that is already a full path', () => {
  assert.equal(
    contentPathFor({ ...ITEM, targetSlug: 'members/atwellpub/posts/my-article' }),
    'members/atwellpub/posts/my-article/index.md',
  );
  assert.equal(
    contentPathFor({ ...ITEM, source: 'prompt', author: 'gbti', targetSlug: 'house/prompts/p1' }),
    'house/prompts/p1/index.md',
  );
});

test('contentPathFor maps the sub folder per type and refuses shares', () => {
  assert.equal(contentPathFor(ITEM), 'members/atwellpub/posts/my-article/index.md');
  assert.equal(contentPathFor({ ...ITEM, source: 'prompt' }), 'members/atwellpub/prompts/my-article/index.md');
  assert.equal(contentPathFor({ ...ITEM, source: 'share' }), null);
});

test('prepareDevtoBody: marker cut, CDN rewrite, byline prepend, tag normalization', () => {
  const r = prepareDevtoBody(FILE, ITEM, { intro: '**By Hudson.**' });
  assert.equal(r.ok, true);
  assert.ok(r.body.startsWith('**By Hudson.**\n\n'), 'the byline leads');
  assert.ok(!r.body.includes('SECRET'), 'the members part is cut');
  assert.ok(!r.body.includes('members-only'), 'the marker itself is cut');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/pic.webp`), 'relative ./ image rewritten');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/two.png`), 'bare images/ path rewritten');
  assert.deepEqual(r.tags, ['claudecode', 'agentskills', 'ai', 'workflow'], 'lowercase alphanumeric, capped at 4');
});

test('prepareDevtoBody: a members item STUBS (the rendered stub template, never any body)', () => {
  const membersFile = FILE.replace('visibility: public', 'visibility: members');
  const r = prepareDevtoBody(membersFile, ITEM, { intro: '**By H.**', footer: 'Join us.', stubBody: 'A great teaser.\n\n[Read it](https://gbti.network/x)' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'stub');
  assert.equal(r.body, '**By H.**\n\nA great teaser.\n\n[Read it](https://gbti.network/x)\n\nJoin us.');
  assert.ok(!r.body.includes('Intro paragraph'), 'no body content in a stub');
  assert.ok(!r.body.includes('SECRET'));
});

test('prepareDevtoBody: SOW-138 the default {body} template equals no template (byte-for-byte)', () => {
  const implicit = prepareDevtoBody(FILE, ITEM, { intro: '**By H.**', footer: 'Join.' });
  const explicit = prepareDevtoBody(FILE, ITEM, { intro: '**By H.**', footer: 'Join.', bodyTemplate: '{body}' });
  assert.equal(implicit.body, explicit.body, 'the built-in default matches an explicit {body}');
});

test('prepareDevtoBody: SOW-138 a custom body template wraps the article ({body} verbatim, tokens render)', () => {
  const r = prepareDevtoBody(FILE, ITEM, { intro: '**By H.**', footer: 'Join.', bodyTemplate: 'Editors note on {title}.\n\n{body}\n\nEnd note.' });
  assert.equal(r.ok, true);
  assert.ok(r.body.includes('Editors note on My Article.'), 'the wrapper token renders');
  assert.ok(r.body.includes('Intro paragraph'), 'the article body is present verbatim');
  assert.ok(r.body.includes('End note.'), 'the wrapper tail is present');
  assert.ok(!r.body.includes('SECRET'), 'the members part is still cut');
});

test('prepareDevtoBody: SOW-138 a members item IGNORES the body template (stub only, no {body} leak)', () => {
  const membersFile = FILE.replace('visibility: public', 'visibility: members');
  const r = prepareDevtoBody(membersFile, ITEM, { intro: '**By H.**', footer: 'Join.', stubBody: 'Teaser.', bodyTemplate: '{body}' });
  assert.equal(r.mode, 'stub');
  assert.ok(!r.body.includes('Intro paragraph'), 'a {body} template can never leak the members body');
  assert.ok(r.body.includes('Teaser.'));
});

test('prepareDevtoBody appends the CTA footer to a full post', () => {
  const r = prepareDevtoBody(FILE, ITEM, { intro: '**By H.**', footer: 'Join us at gbti.network.' });
  assert.equal(r.mode, 'full');
  assert.ok(r.body.endsWith('Join us at gbti.network.'));
});

test('prepareDevtoBody fails closed: drafts, empty public body, no frontmatter', () => {
  assert.equal(prepareDevtoBody(FILE.replace('status: published', 'status: draft'), ITEM).ok, false);
  const onlyMembers = '---\nstatus: published\nvisibility: public\n---\n<!-- members-only -->\nSECRET';
  assert.equal(prepareDevtoBody(onlyMembers, ITEM).ok, false, 'nothing public to post');
  assert.equal(prepareDevtoBody('no frontmatter at all', ITEM).ok, false);
  // A members item with no description and no rendered parts has nothing public either.
  const bareMembers = '---\nstatus: published\nvisibility: members\n---\nSECRET';
  assert.equal(prepareDevtoBody(bareMembers, ITEM, {}).ok, false);
});

test('normalizeDevtoTags falls back to the taxonomy path', () => {
  assert.deepEqual(normalizeDevtoTags(null, ['ai', 'prompts', 'skill']), ['ai', 'prompts', 'skill']);
  assert.deepEqual(normalizeDevtoTags([], undefined), []);
});

test('devto adapter: the full article payload (org, canonical, cover, draft flag)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.startsWith('https://raw.githubusercontent.com/')) return { ok: true, status: 200, text: async () => FILE };
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 777, url: 'https://dev.to/gbti-network/my-article-1abc' }) };
  };
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  const ad = createDevtoAdapter({ env, fetchImpl });
  assert.equal(ad.enabled(), true);
  const r = await ad.post({ ...ITEM, textOverride: 'My Article', image: '/_astro/cover.webp', devtoIntro: '**By Hudson Atwell.**' });
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/gbti-network/gbti.network/main/members/atwellpub/posts/my-article/index.md');
  assert.equal(calls[1].url, 'https://dev.to/api/articles');
  assert.equal(calls[1].opts.headers['api-key'], 'k');
  const a = JSON.parse(calls[1].opts.body).article;
  assert.equal(a.title, 'My Article');
  assert.equal(a.canonical_url, ITEM.url);
  assert.equal(a.published, true);
  assert.equal(a.organization_id, 10466);
  assert.equal(a.main_image, 'https://gbti.network/_astro/cover.webp');
  assert.ok(a.body_markdown.startsWith('**By Hudson Atwell.**'));
  assert.ok(!a.body_markdown.includes('SECRET'));
  assert.deepEqual(a.tags, ['claudecode', 'agentskills', 'ai', 'workflow']);
  assert.equal(r.ok, true);
  assert.equal(r.id, '777');
  assert.match(r.url, /dev\.to/);
});

test('devto adapter: SOW-139 defaults the cover to the branded per-type card when the item has no image', async () => {
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  let lastBody = null;
  const okFetch = async (url, opts) => {
    if (url.startsWith('https://raw.')) return { ok: true, text: async () => FILE };
    lastBody = JSON.parse(opts.body);
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 1, url: 'https://dev.to/x' }) };
  };
  const ad = createDevtoAdapter({ env, fetchImpl: okFetch });
  await ad.post({ ...ITEM }); // source 'post' -> feature-article
  assert.equal(lastBody.article.main_image, 'https://gbti.network/brand/feature/feature-article.png');
  await ad.post({ ...ITEM, source: 'prompt' });
  assert.equal(lastBody.article.main_image, 'https://gbti.network/brand/feature/feature-prompt.png');
  await ad.post({ ...ITEM, source: 'product' });
  assert.equal(lastBody.article.main_image, 'https://gbti.network/brand/feature/feature-product.png');
  await ad.post({ ...ITEM, image: '/_astro/cover.webp' }); // a custom cover still wins
  assert.equal(lastBody.article.main_image, 'https://gbti.network/_astro/cover.webp');
});

test('devto adapter: SOW-138 item.devtoBodyTemplate replaces the public body (custom copy, no {body})', async () => {
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  let lastBody = null;
  const okFetch = async (url, opts) => {
    if (url.startsWith('https://raw.')) return { ok: true, text: async () => FILE };
    lastBody = JSON.parse(opts.body);
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 1, url: 'https://dev.to/x' }) };
  };
  const ad = createDevtoAdapter({ env, fetchImpl: okFetch });
  await ad.post({ ...ITEM, textOverride: 'My Article', devtoIntro: '**By H.**', devtoBodyTemplate: 'A custom summary of {title}. Read it at {url}.' });
  const md = lastBody.article.body_markdown;
  assert.ok(md.includes('A custom summary of My Article. Read it at https://gbti.network/articles/my-article/.'), 'the custom body renders its tokens');
  assert.ok(!md.includes('Intro paragraph'), 'a template with no {body} omits the article body');
  assert.ok(md.startsWith('**By H.**'), 'the byline still leads');
});

test('devto adapter: draft flag, skips (share/members/draft file), and readable errors', async () => {
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  let lastBody = null;
  const okFetch = async (url, opts) => {
    if (url.startsWith('https://raw.')) return { ok: true, text: async () => FILE };
    lastBody = JSON.parse(opts.body);
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 1, url: 'https://dev.to/x' }) };
  };
  const ad = createDevtoAdapter({ env, fetchImpl: okFetch });
  const draft = await ad.post({ ...ITEM, devtoDraft: true });
  assert.equal(lastBody.article.published, false);
  assert.equal(draft.draft, true);
  assert.equal((await ad.post({ ...ITEM, source: 'share' })).skipped, true);
  // A members-only FILE now posts a STUB (description + link + CTA), not a skip; the queue item's own
  // visibility copy is ignored (the canonical file is the authority).
  const membersFile = FILE.replace('visibility: public', 'visibility: members');
  const stubAd = createDevtoAdapter({ env, fetchImpl: async (u, o) => (u.startsWith('https://raw.') ? { ok: true, text: async () => membersFile } : (lastBody = JSON.parse(o.body), { ok: true, status: 201, text: async () => JSON.stringify({ id: 9, url: 'https://dev.to/s' }) })) });
  // No pre-rendered devtoStub: the adapter renders the built-in devto-stub template ({short-description}
  // from the queue item blurb + the read-more line).
  const stub = await stubAd.post({ ...ITEM, visibility: 'members', membersOnly: true, blurb: 'Teaser.', devtoFooter: 'JOIN CTA' });
  assert.equal(stub.ok, true);
  assert.equal(stub.stub, true);
  assert.ok(lastBody.article.body_markdown.includes('Teaser.'));
  assert.ok(lastBody.article.body_markdown.includes('Read the full article on gbti.network'));
  assert.ok(lastBody.article.body_markdown.includes('JOIN CTA'));
  assert.ok(!lastBody.article.body_markdown.includes('Intro paragraph'), 'no body in the stub post');
  const draftFile = createDevtoAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE.replace('status: published', 'status: draft') } : null) });
  assert.equal((await draftFile.post({ ...ITEM })).skipped, true, 'an unpublished canonical file skips');
  const err422 = createDevtoAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE } : { ok: false, status: 422, text: async () => JSON.stringify({ error: 'Title has already been used' }) }) });
  const e = await err422.post({ ...ITEM });
  assert.equal(e.ok, false);
  assert.match(e.error, /devto 422 .*Title/);
});
