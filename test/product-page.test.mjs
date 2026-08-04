// sow-172: the product detail page's layout decisions (Doc Shell, design direction 1b). These are the
// branches the page would otherwise take inline, so they are covered here rather than only by eye in a build.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeGallery,
  hasCaptions,
  resolveGalleryStyle,
  buildToc,
  repoUrl,
  resolvePrimaryCta,
  railLinks,
  linkLabel,
  isLockedLink,
  resolveHero,
  parseGithubRepo,
  detectLinkSource,
  formatRelease,
  canEditItem,
  CAROUSEL_THRESHOLD,
  TOC_MIN_ENTRIES,
} from '../src/lib/product-page.mjs';

// An Astro image() value, which carries a string src AND pixel dimensions.
const img = (src) => ({ src, width: 1280, height: 800, format: 'webp' });

test('normalizeGallery: accepts bare paths, image objects, and captioned wrappers in any mix', () => {
  const shot = img('/_astro/shot-2.webp');
  const entries = normalizeGallery([
    './images/shot-1.webp',
    shot,
    { src: './images/shot-3.webp', caption: 'The settings panel' },
    { src: img('/_astro/shot-4.webp'), caption: 'Live rate limits' },
  ]);

  assert.deepEqual(entries[0], { src: './images/shot-1.webp', caption: '' });
  // An image object is the entry itself, never mistaken for a { src, caption } wrapper.
  assert.equal(entries[1].src, shot);
  assert.equal(entries[1].caption, '');
  assert.deepEqual(entries[2], { src: './images/shot-3.webp', caption: 'The settings panel' });
  assert.equal(entries[3].src.src, '/_astro/shot-4.webp');
  assert.equal(entries[3].caption, 'Live rate limits');
});

test('normalizeGallery: drops empties rather than rendering a hole, and tolerates a missing field', () => {
  assert.deepEqual(normalizeGallery([]), []);
  assert.deepEqual(normalizeGallery(undefined), []);
  assert.deepEqual(normalizeGallery(null), []);
  assert.equal(normalizeGallery(['a.webp', null, '', undefined, { caption: 'no src' }]).length, 1);
  // A non-string caption is ignored rather than stringified into the markup.
  assert.deepEqual(normalizeGallery([{ src: 'a.webp', caption: 42 }]), [{ src: 'a.webp', caption: '' }]);
});

test('hasCaptions: true only when at least one entry actually carries text', () => {
  assert.equal(hasCaptions(normalizeGallery(['a.webp', 'b.webp'])), false);
  assert.equal(hasCaptions(normalizeGallery(['a.webp', { src: 'b.webp', caption: 'Sorted' }])), true);
  assert.equal(hasCaptions([]), false);
  assert.equal(hasCaptions(undefined), false);
});

test('resolveGalleryStyle: an explicit choice always wins over the count', () => {
  assert.equal(resolveGalleryStyle('grid', 12), 'grid');
  assert.equal(resolveGalleryStyle('carousel', 1), 'carousel');
});

test('resolveGalleryStyle: unset falls to the count, at the documented threshold', () => {
  assert.equal(resolveGalleryStyle(undefined, 0), 'grid');
  assert.equal(resolveGalleryStyle(undefined, CAROUSEL_THRESHOLD - 1), 'grid');
  assert.equal(resolveGalleryStyle(undefined, CAROUSEL_THRESHOLD), 'carousel');
  assert.equal(resolveGalleryStyle(undefined, CAROUSEL_THRESHOLD + 3), 'carousel');
  // A junk value is not trusted as a style; it falls back to the count rule.
  assert.equal(resolveGalleryStyle('masonry', 9), 'carousel');
});

const h = (text, slug, depth = 2) => ({ depth, slug, text });

test('buildToc: brackets the body headings with Overview, Screenshots and Discussion', () => {
  const toc = buildToc([h('We built Radle to', 'we-built-radle-to'), h('Features', 'features')], {
    hasGallery: true,
  });
  assert.deepEqual(
    toc.map((e) => e.label),
    ['Overview', 'We built Radle to', 'Features', 'Screenshots', 'Discussion'],
  );
  assert.deepEqual(
    toc.map((e) => e.id),
    ['pd-overview', 'we-built-radle-to', 'features', 'pd-screenshots', 'comments'],
  );
});

test('buildToc: only h2s become entries', () => {
  const toc = buildToc(
    [h('Top', 'top', 1), h('Real', 'real', 2), h('Nested', 'nested', 3), h('Also real', 'also-real', 2)],
    { hasGallery: false },
  );
  assert.deepEqual(toc.map((e) => e.label), ['Overview', 'Real', 'Also real', 'Discussion']);
});

test('buildToc: collapses rather than showing a stub list', () => {
  // A gated item has no public prose and no gallery, so nothing is left worth a rail.
  assert.deepEqual(buildToc([], { hasBody: false, hasGallery: false, hasDiscussion: false }), []);
  // Overview + Discussion alone is under the minimum.
  assert.deepEqual(buildToc([], { hasGallery: false }), []);
  assert.ok(TOC_MIN_ENTRIES === 3);
  // One real heading tips it over.
  assert.equal(buildToc([h('Install', 'install')], { hasGallery: false }).length, 3);
});

test('buildToc: a body heading owning a landmark id wins, so no anchor is ambiguous', () => {
  const toc = buildToc([h('Comments', 'comments'), h('Setup', 'setup')], { hasGallery: false });
  assert.equal(toc.filter((e) => e.id === 'comments').length, 1);
  assert.deepEqual(toc.map((e) => e.label), ['Overview', 'Comments', 'Setup']);
});

test('buildToc: survives a missing or malformed headings list', () => {
  assert.deepEqual(buildToc(undefined, { hasGallery: false }), []);
  assert.deepEqual(buildToc([null, { depth: 2 }, h('  ', 'blank')], { hasGallery: false }), []);
});

test('repoUrl: finds the repository link and nothing else', () => {
  assert.equal(repoUrl([{ type: 'download', url: 'https://d' }, { type: 'repository', url: 'https://gh' }]), 'https://gh');
  assert.equal(repoUrl([{ type: 'download', url: 'https://d' }]), null);
  assert.equal(repoUrl(undefined), null);
});

test('resolvePrimaryCta: an author-marked primary wins, and the repository never does', () => {
  const links = [
    { type: 'repository', url: 'https://gh', primary: true },
    { type: 'documentation', url: 'https://docs' },
    { type: 'download', url: 'https://dl', primary: true },
  ];
  assert.equal(resolvePrimaryCta(links).url, 'https://dl');
});

test('resolvePrimaryCta: falls through download, then homepage, then whatever remains', () => {
  assert.equal(resolvePrimaryCta([{ type: 'support', url: 'https://s' }, { type: 'download', url: 'https://dl' }]).url, 'https://dl');
  assert.equal(resolvePrimaryCta([{ type: 'support', url: 'https://s' }, { type: 'homepage', url: 'https://hp' }]).url, 'https://hp');
  assert.equal(resolvePrimaryCta([{ type: 'support', url: 'https://s' }]).url, 'https://s');
});

test('resolvePrimaryCta: prefers a public link so the install button is never a dead lock', () => {
  const links = [
    { type: 'download', url: 'https://members-dl', visibility: 'members', primary: true },
    { type: 'download', url: 'https://public-dl' },
  ];
  assert.equal(resolvePrimaryCta(links).url, 'https://public-dl');
});

test('resolvePrimaryCta: still returns a members-only link when it is all the product has', () => {
  const only = [{ type: 'download', url: 'https://members-dl', visibility: 'members', encrypted: true }];
  const hit = resolvePrimaryCta(only);
  assert.equal(hit.url, 'https://members-dl');
  assert.equal(isLockedLink(hit), true);
});

test('resolvePrimaryCta: falls back to the pricing URL, then to nothing', () => {
  const hit = resolvePrimaryCta([{ type: 'repository', url: 'https://gh' }], 'https://buy');
  assert.equal(hit.url, 'https://buy');
  assert.equal(hit.visibility, 'public');
  assert.equal(resolvePrimaryCta([], undefined), null);
  assert.equal(resolvePrimaryCta(undefined, undefined), null);
});

test('railLinks: keeps every link the install bar could not carry, minus the repository', () => {
  const links = [
    { type: 'download', url: 'https://dl', primary: true },
    { type: 'repository', url: 'https://gh' },
    { type: 'documentation', url: 'https://docs' },
    { type: 'support', url: 'https://help', visibility: 'members' },
  ];
  const primary = resolvePrimaryCta(links);
  const rest = railLinks(links, primary);
  assert.deepEqual(rest.map((l) => l.url), ['https://docs', 'https://help']);
  assert.equal(isLockedLink(rest[1]), true);
});

test('railLinks: adds the pricing page for a paid product, but never twice', () => {
  const links = [{ type: 'download', url: 'https://dl', primary: true }];
  const primary = resolvePrimaryCta(links, 'https://buy');
  assert.deepEqual(railLinks(links, primary, 'https://buy', 'paid').map((l) => l.url), ['https://buy']);
  // Free products do not advertise a pricing page.
  assert.deepEqual(railLinks(links, primary, 'https://buy', 'free'), []);
  // When pricing became the install button it is not repeated in the rail.
  const pricingPrimary = resolvePrimaryCta([], 'https://buy');
  assert.deepEqual(railLinks([], pricingPrimary, 'https://buy', 'paid'), []);
  // Nor when it is already an explicit link.
  const dup = [{ type: 'homepage', url: 'https://buy' }, { type: 'download', url: 'https://dl', primary: true }];
  assert.deepEqual(railLinks(dup, resolvePrimaryCta(dup), 'https://buy', 'paid').map((l) => l.url), ['https://buy']);
});

test('linkLabel: the author override wins, else the type gets a real word', () => {
  assert.equal(linkLabel({ type: 'download', label: 'Download free on WordPress.org' }), 'Download free on WordPress.org');
  assert.equal(linkLabel({ type: 'documentation' }), 'Documentation');
  assert.equal(linkLabel({ type: 'pricing' }), 'Pricing');
  assert.equal(linkLabel({ type: 'something-new' }), 'something-new');
  assert.equal(linkLabel(null), '');
});

test('isLockedLink: only members visibility locks, and the default is public', () => {
  assert.equal(isLockedLink({ visibility: 'members' }), true);
  assert.equal(isLockedLink({ visibility: 'public' }), false);
  assert.equal(isLockedLink({}), false);
  assert.equal(isLockedLink(null), false);
});

test('resolveHero: an uploaded image always wins, even over an explicit preset', () => {
  const hero = resolveHero('./images/banner.webp', 'green', img('/_astro/featured.webp'));
  assert.deepEqual(hero, { image: './images/banner.webp', preset: null });
});

test('resolveHero: an explicit preset beats the implicit featuredImage fallback', () => {
  const featured = img('/_astro/featured.webp');
  assert.deepEqual(resolveHero(undefined, 'amber', featured), { image: null, preset: 'amber' });
});

test('resolveHero: no image and no preset falls back to featuredImage', () => {
  const featured = img('/_astro/featured.webp');
  assert.deepEqual(resolveHero(undefined, undefined, featured), { image: featured, preset: null });
});

test('resolveHero: nothing at all set resolves to the existing ink default, not a crash', () => {
  assert.deepEqual(resolveHero(undefined, undefined, undefined), { image: null, preset: 'ink' });
  assert.deepEqual(resolveHero(null, null, null), { image: null, preset: 'ink' });
});

test('parseGithubRepo: a real repository URL, with or without a trailing slash or .git', () => {
  assert.deepEqual(parseGithubRepo('https://github.com/gbti-network/radle-lite'), { owner: 'gbti-network', repo: 'radle-lite' });
  assert.deepEqual(parseGithubRepo('https://github.com/gbti-network/radle-lite/'), { owner: 'gbti-network', repo: 'radle-lite' });
  assert.deepEqual(parseGithubRepo('https://github.com/gbti-network/radle-lite.git'), { owner: 'gbti-network', repo: 'radle-lite' });
  assert.deepEqual(parseGithubRepo('https://www.github.com/gbti-network/radle-lite'), { owner: 'gbti-network', repo: 'radle-lite' });
});

test('parseGithubRepo: a non-repo GitHub page, a non-GitHub host, and garbage all resolve to null', () => {
  assert.equal(parseGithubRepo('https://github.com/gbti-network'), null); // an org page, no repo segment
  assert.equal(parseGithubRepo('https://gitlab.com/gbti-network/radle-lite'), null);
  assert.equal(parseGithubRepo('not a url'), null);
  assert.equal(parseGithubRepo(''), null);
  assert.equal(parseGithubRepo(undefined), null);
});

test('detectLinkSource: wordpress.org and github.com, everything else is null', () => {
  assert.equal(detectLinkSource('https://wordpress.org/plugins/radle-lite/'), 'wordpress');
  assert.equal(detectLinkSource('https://www.wordpress.org/plugins/radle-lite/'), 'wordpress');
  assert.equal(detectLinkSource('https://github.com/gbti-network/radle-lite'), 'github');
  assert.equal(detectLinkSource('https://example.com/download'), null);
  assert.equal(detectLinkSource('not a url'), null);
  assert.equal(detectLinkSource(undefined), null);
});

test('formatRelease: a normal release shapes to the rail-ready fields', () => {
  const release = { tag_name: 'v2.4.1', html_url: 'https://github.com/gbti-network/radle-lite/releases/tag/v2.4.1', published_at: '2026-07-20T00:00:00Z', draft: false };
  assert.deepEqual(formatRelease(release), { tag: 'v2.4.1', url: release.html_url, publishedAt: release.published_at });
});

test('formatRelease: a draft, a missing tag_name, and no response all withhold the row rather than render blank', () => {
  assert.equal(formatRelease({ tag_name: 'v1.0.0', draft: true }), null);
  assert.equal(formatRelease({ html_url: 'https://x', published_at: '2026-01-01' }), null); // no tag_name
  assert.equal(formatRelease({ message: 'Not Found' }), null); // a GitHub error body
  assert.equal(formatRelease(null), null);
  assert.equal(formatRelease(undefined), null);
});

test('canEditItem: the owner (case-insensitive) may edit; a stranger may not', () => {
  assert.equal(canEditItem({ login: 'atwellpub', role: 'member' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: 'AtwellPub', role: 'member' }, 'atwellpub'), true); // login case differs
  assert.equal(canEditItem({ login: 'someoneelse', role: 'member' }, 'atwellpub'), false);
});

test('canEditItem: superadmin may edit any item, even one they do not own', () => {
  assert.equal(canEditItem({ login: 'gbtilabs', role: 'superadmin' }, 'atwellpub'), true);
  assert.equal(canEditItem({ login: null, role: 'superadmin' }, 'atwellpub'), true); // role alone is enough
});

test('canEditItem: signed out, or signed in with no matching login/role, sees no edit affordance', () => {
  assert.equal(canEditItem(null, 'atwellpub'), false);
  assert.equal(canEditItem({ login: 'atwellpub', role: 'admin' }, ''), false); // no owner to compare against
  assert.equal(canEditItem({ login: null, role: 'member' }, 'atwellpub'), false);
});
