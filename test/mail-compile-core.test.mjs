// SOW-166: the pure compile core (normalizers + weekly issue id). The load-bearing assertion is that
// VISIBILITY SURVIVES the type->kind mapping, proven end to end through composeIssue's fail-closed guard, not
// just by reading the field back. No hearts (they do not exist as data); news normalizes the wired opens only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeContent, normalizeContentEntry, normalizeNews, normalizeNewsEntry, weeklyIssueId, isCentralDigestHour } from '../membership/mail-compile-core.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';

const at = (t) => () => t;

test('type -> kind: post->article, product->product, prompt->prompt, share->share; unknown -> null', () => {
  const k = (type) => normalizeContentEntry({ type, title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'public' })?.kind;
  assert.equal(k('post'), 'article');
  assert.equal(k('product'), 'product');
  assert.equal(k('prompt'), 'prompt');
  assert.equal(k('share'), 'share');
  assert.equal(normalizeContentEntry({ type: 'news', title: 't', url: '/u/', visibility: 'public' }), null, 'an unmapped type is dropped');
  assert.equal(normalizeContentEntry(null), null);
});

test('visibility is copied VERBATIM (public stays public, members stays members)', () => {
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'public' }).visibility, 'public');
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1, visibility: 'members' }).visibility, 'members');
  // a missing visibility stays undefined (NOT defaulted to public) so composeIssue's fail-closed guard drops it
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 1 }).visibility, undefined);
});

test('date maps from publishedAt; a missing/NaN date becomes 0', () => {
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: 42, visibility: 'public' }).date, 42);
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', publishedAt: null, visibility: 'public' }).date, 0);
  assert.equal(normalizeContentEntry({ type: 'post', title: 't', url: '/u/', author: 'a', visibility: 'public' }).date, 0);
});

test('authorName resolves via the injected displayName; absent it is null', () => {
  const names = { ann: 'Ann Author', atwellpub: 'Hudson Atwell' };
  const e = { type: 'post', title: 't', url: '/u/', author: 'atwellpub', publishedAt: 1, visibility: 'public' };
  assert.equal(normalizeContentEntry(e, { displayName: (h) => names[h] }).authorName, 'Hudson Atwell');
  assert.equal(normalizeContentEntry(e).authorName, null, 'no resolver -> null, renderer falls back to the handle');
  assert.equal(normalizeContentEntry({ ...e, author: 'unknown' }, { displayName: (h) => names[h] }).authorName, null);
});

test('normalizeContent maps a mixed list and drops unknown types', () => {
  const out = normalizeContent([
    { type: 'post', title: 'P', url: '/a/', author: 'a', publishedAt: 3, visibility: 'public' },
    { type: 'share', title: 'S', url: '/shares/a/1/', author: 'a', publishedAt: 2, visibility: 'public' },
    { type: 'mystery', title: 'X', url: '/x/', visibility: 'public' },
    null,
  ]);
  assert.deepEqual(out.map((o) => o.kind), ['article', 'share']);
  assert.equal(normalizeContent(null).length, 0);
});

// The property that matters: the normalizer does NOT filter public-vs-member (one guard, in composeIssue).
// It must preserve visibility so composeIssue's fail-closed guard can drop the member item. If visibility were
// dropped or defaulted, either a member item would leak or the whole section would silently empty.
test('VISIBILITY SURVIVES end to end: composeIssue drops the members item the normalizer passed through', () => {
  const items = normalizeContent([
    { type: 'post', slug: 'x', title: 'Public one', url: '/articles/x/', author: 'ann', publishedAt: 5, visibility: 'public' },
    { type: 'post', slug: 'y', title: 'Members stub', url: '/articles/y/', author: 'ann', publishedAt: 6, visibility: 'members' },
  ]);
  assert.equal(items.find((i) => i.title === 'Members stub').visibility, 'members', 'normalizer preserved it (did not filter)');
  const issue = composeIssue({ issueId: 'i', items, news: [], now: at(1000) });
  assert.deepEqual(issue.sections.article.map((a) => a.title), ['Public one'], 'composeIssue dropped the members item, kept the public one');
});

test('normalizeNewsEntry: opens/date default 0, blank source is null, missing title or url drops the item', () => {
  assert.deepEqual(
    normalizeNewsEntry({ title: 'N', url: 'https://n/x', source: 'Src', opens: 9, date: 7 }),
    // + sourceName/blurb/thumb (sow-166, 2026-08-23). All three default to null, so an entry carrying none of
    // them normalizes to exactly what it did before, with three absent fields rather than three fabricated ones.
    { title: 'N', url: 'https://n/x', source: 'Src', sourceName: null, blurb: null, thumb: null, opens: 9, date: 7 },
  );
  assert.deepEqual(
    normalizeNewsEntry({ title: 'N', url: 'https://n/x' }),
    { title: 'N', url: 'https://n/x', source: null, sourceName: null, blurb: null, thumb: null, opens: 0, date: 0 },
  );
  assert.equal(normalizeNewsEntry({ url: 'https://n/x' }), null, 'no title -> dropped');
  assert.equal(normalizeNewsEntry({ title: 'N' }), null, 'no url -> dropped');
  assert.equal(normalizeNews(null).length, 0);
  // NO fabricated `comments`: the discussion-count field arrives only when a real gather populates it.
  assert.equal('comments' in normalizeNewsEntry({ title: 'N', url: 'https://n/x' }), false);
});

test('weeklyIssueId is a stable weekly-YYYY-MM-DD in UTC, idempotent same-day, and throws on a bad time', () => {
  const t = Date.UTC(2026, 7, 25, 13, 0, 0); // 2026-08-25 13:00 UTC (a Tuesday)
  assert.equal(weeklyIssueId(t), 'weekly-2026-08-25');
  assert.equal(weeklyIssueId(t + 6 * 3600 * 1000), 'weekly-2026-08-25', 'same UTC day -> same id (idempotent re-run)');
  assert.throws(() => weeklyIssueId(NaN), /finite timestamp/);
  assert.throws(() => weeklyIssueId('nope'), /finite timestamp/);
});

// ---------- sow-166 digest v2 (2026-08-23): descriptions, images, source display names ----------

test('newsBlurb strips tags, unescapes entities and collapses whitespace', async () => {
  const { newsBlurb } = await import('../membership/mail-compile-core.mjs');
  assert.equal(newsBlurb('<p>Hello &amp; welcome</p>'), 'Hello & welcome');
  assert.equal(newsBlurb('a\n\n  b\tc'), 'a b c');
  assert.equal(newsBlurb('<div><span>nested</span> tags</div>'), 'nested tags');
});

test('newsBlurb truncates at a WORD boundary and never mid-word', async () => {
  const { newsBlurb } = await import('../membership/mail-compile-core.mjs');
  const long = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec';
  const out = newsBlurb(long, { max: 40 });
  assert.ok(out.endsWith('...'), 'a truncated blurb is marked as truncated');
  assert.ok(out.length <= 43, `too long: ${out.length}`);
  const body = out.slice(0, -3);
  assert.ok(long.startsWith(body), 'the kept text is a real prefix of the source');
  assert.ok(!/\S$/.test(body) || long[body.length] === ' ', 'the cut landed on a word boundary');
});

test('newsBlurb returns NULL for anything that reduces to nothing, so no empty box renders', async () => {
  const { newsBlurb } = await import('../membership/mail-compile-core.mjs');
  for (const v of ['', '   ', '<p></p>', '<br/>&nbsp;', null, undefined]) {
    assert.equal(newsBlurb(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test('news normalization PREFERS the AI digest over the raw feed summary', () => {
  const n = normalizeNewsEntry({
    title: 'T', url: 'https://x/1', source: 'src',
    digest: 'The written-to-be-read summary.', summary: '<p>The publishers truncated first paragraph</p>',
  });
  assert.equal(n.blurb, 'The written-to-be-read summary.');
});

test('news normalization falls back to the feed summary, and to NO blurb when both are empty', () => {
  const fallback = normalizeNewsEntry({ title: 'T', url: 'https://x/1', summary: '<p>Feed text</p>' });
  assert.equal(fallback.blurb, 'Feed text');
  const none = normalizeNewsEntry({ title: 'T', url: 'https://x/1', digest: '  ', summary: '<p> </p>' });
  assert.equal(none.blurb, null, 'an unusable summary renders no blurb rather than an empty one');
});

test('news normalization carries the image and the resolved source name', () => {
  const n = normalizeNewsEntry({
    title: 'T', url: 'https://x/1', source: 'object-object', sourceName: 'The Verge',
    image: 'https://cdn.theverge.com/x.jpg',
  });
  assert.equal(n.thumb, 'https://cdn.theverge.com/x.jpg');
  assert.equal(n.sourceName, 'The Verge');
  assert.equal(n.source, 'object-object', 'the stored id is preserved as the key');
  assert.equal(normalizeNewsEntry({ title: 'T', url: 'https://x/1', source: 'x' }).sourceName, null, 'no name -> null, renderer falls back to the id');
});

test('content normalization carries the artifact description as the blurb, and the thumb', () => {
  const e = normalizeContentEntry({
    type: 'post', title: 't', url: '/articles/t/', author: 'a', publishedAt: 5, visibility: 'public',
    description: 'The frontmatter excerpt.', thumb: '/media/t.png',
  });
  assert.equal(e.blurb, 'The frontmatter excerpt.');
  assert.equal(e.thumb, '/media/t.png');
});

// The compile-core half of the security control. The projection enforces the allowlist; this proves the
// normalizer never MANUFACTURES a blurb from an entry that has a body and no description.
test('SECURITY CONTROL: an artifact entry with a body and no description yields NO blurb', () => {
  const e = normalizeContentEntry({
    type: 'post', title: 't', url: '/articles/t/', author: 'a', publishedAt: 5, visibility: 'public',
    body: 'THE BODY', content: 'THE CONTENT', excerpt: 'NOT READ FROM HERE',
  });
  assert.equal(e.blurb, null, 'absent means absent: there is no second source for a blurb');
  assert.ok(!JSON.stringify(e).includes('THE BODY'));
  assert.ok(!JSON.stringify(e).includes('THE CONTENT'));
});

// THE SECOND HALF OF THE SOURCE-LABEL FIX. Replacing the id with the config name closed `object-object`, and
// opened a different one: the config name is the feed's own <title>, which is a strap line. Measured against
// the real bundled sources, "Engadget - Technology News & Expert Reviews" and "CoinDesk: Bitcoin, Ethereum,
// Crypto News and Price Data" both rendered under headlines, the second wrapping onto two lines.
test('sourceDisplayName reduces an RSS strap line to the brand', async () => {
  const { sourceDisplayName } = await import('../membership/mail-compile-core.mjs');
  assert.equal(sourceDisplayName('Engadget - Technology News & Expert Reviews'), 'Engadget');
  assert.equal(sourceDisplayName('CoinDesk: Bitcoin, Ethereum, Crypto News and Price Data'), 'CoinDesk');
  assert.equal(sourceDisplayName('Ars Technica - All content'), 'Ars Technica');
});

test('sourceDisplayName leaves a plain brand name untouched', async () => {
  const { sourceDisplayName } = await import('../membership/mail-compile-core.mjs');
  for (const n of ['The Verge', 'ServeTheHome', 'WIRED', 'Hacker News']) {
    assert.equal(sourceDisplayName(n), n, `${n} must survive intact`);
  }
});

// Both guards fail toward showing MORE of the real name, never toward showing nothing. A heuristic run over
// other people's text has to be safe in the degenerate cases, not just the tidy ones.
test('sourceDisplayName guards: a too-short head is not taken, and a long name is capped on a word boundary', async () => {
  const { sourceDisplayName } = await import('../membership/mail-compile-core.mjs');
  assert.equal(sourceDisplayName('- leading sep'), '- leading sep', 'a head under 3 chars is rejected, the full name is kept');
  assert.equal(sourceDisplayName('AB: something'), 'AB: something', 'two characters is not a brand');
  const long = sourceDisplayName('A very long publication name with no separator anywhere in it at all');
  assert.ok(long.length <= 40, `capped, got ${long.length}`);
  assert.ok(!long.endsWith(' '), 'and cut cleanly');
  assert.equal(sourceDisplayName(''), null);
  assert.equal(sourceDisplayName(null), null);
});

test('the news normalizer applies the brand trim, so a frozen issue stores what is displayed', () => {
  const n = normalizeNewsEntry({
    title: 'T', url: 'https://x/1', source: 'engadget-technology-news-expert-reviews',
    sourceName: 'Engadget - Technology News & Expert Reviews',
  });
  assert.equal(n.sourceName, 'Engadget');
  assert.equal(n.source, 'engadget-technology-news-expert-reviews', 'the id is still the key');
});

// Observed in a real delivered row, not hypothesised: "...for mroe efficient compute The post Samsung
// Evolving...". WordPress appends this tail to every feed excerpt, and it is part of the SOURCE text, so it
// has to be removed before truncation or truncation just cuts it mid-phrase.
test('newsBlurb removes the WordPress "The post ... appeared first on ..." feed footer', async () => {
  const { newsBlurb } = await import('../membership/mail-compile-core.mjs');
  const raw = 'At Hot Chips 2026, Samsung discussed how it plans to evolve the HBM base die. The post Samsung Evolving HBM Base Die at Hot Chips 2026 appeared first on ServeTheHome.';
  const out = newsBlurb(raw, { max: 400 });
  assert.equal(out, 'At Hot Chips 2026, Samsung discussed how it plans to evolve the HBM base die.');
  assert.ok(!out.includes('The post'));
  assert.ok(!out.includes('appeared first on'));
});

test('newsBlurb leaves a sentence that merely BEGINS "The post" alone (both halves are required)', async () => {
  const { newsBlurb } = await import('../membership/mail-compile-core.mjs');
  const s = 'The post office is closing early today, the council said.';
  assert.equal(newsBlurb(s), s, 'the anchor needs "appeared first on" too, or ordinary prose gets eaten');
});

// The owner moved the digest to 7 AM Central on 2026-08-25, every Tuesday, permanently. That hour is not
// expressible as one UTC cron, so two are declared and this decides which is real. The dates below are the
// two sides of a real US daylight-saving boundary, chosen so a naive fixed-offset implementation fails.
test('7 AM Central: 12:00 UTC is the real run in summer, 13:00 UTC is the impostor', () => {
  const summerTuesday = (utcHour) => Date.UTC(2026, 7, 25, utcHour, 0, 0); // Tue 25 Aug 2026, CDT (UTC-5)
  assert.equal(isCentralDigestHour(summerTuesday(12)), true, '12:00 UTC is 07:00 Chicago in August');
  assert.equal(isCentralDigestHour(summerTuesday(13)), false, '13:00 UTC is 08:00 Chicago in August, so it no-ops');
});

test('7 AM Central: the pair SWAPS across the daylight boundary, which a fixed offset cannot do', () => {
  const winterTuesday = (utcHour) => Date.UTC(2027, 0, 5, utcHour, 0, 0); // Tue 5 Jan 2027, CST (UTC-6)
  assert.equal(isCentralDigestHour(winterTuesday(13)), true, '13:00 UTC is 07:00 Chicago in January');
  assert.equal(isCentralDigestHour(winterTuesday(12)), false, '12:00 UTC is 06:00 Chicago in January');
  // Stated as the property rather than as two more numbers: on any given Tuesday exactly ONE of the two
  // declared triggers is the 07:00 hour. If both were ever true the digest would compile an hour early; if
  // neither were, the week would be skipped silently.
  for (const [y, m, d] of [[2026, 7, 25], [2026, 10, 3], [2027, 0, 5], [2027, 2, 16]]) {
    const hits = [12, 13].filter((h) => isCentralDigestHour(Date.UTC(y, m, d, h, 0, 0)));
    assert.equal(hits.length, 1, `exactly one trigger fires on ${y}-${m + 1}-${d}, got ${JSON.stringify(hits)}`);
  }
});

test('7 AM Central: it FAILS OPEN, because a spurious run is idempotent and a missed run is a lost week', () => {
  // compileWeeklyIssue freezes one issue per UTC day and both triggers share a UTC day, so a wrong `true`
  // costs nothing while a wrong `false` skips the digest. Every unusable input must therefore return true.
  // null, '' and [] all coerce to a FINITE 0, which is how the first version of this let them through.
  for (const bad of [NaN, Infinity, null, undefined, 'noon', {}, '', [], false, 0n]) {
    assert.equal(isCentralDigestHour(bad), true, `${String(bad)} must fail open, not silently skip a week`);
  }
  // And an unresolvable zone must not throw out of the dispatcher either.
  assert.equal(isCentralDigestHour(Date.UTC(2026, 7, 25, 3, 0, 0), { timeZone: 'Mars/Olympus_Mons' }), true);
});

test('7 AM Central: the hour is a parameter, so the helper is not secretly hard-coded to one number', () => {
  const t = Date.UTC(2026, 7, 25, 12, 0, 0); // 07:00 Chicago
  assert.equal(isCentralDigestHour(t, { hour: 7 }), true);
  assert.equal(isCentralDigestHour(t, { hour: 8 }), false);
  assert.equal(isCentralDigestHour(t, { hour: 12, timeZone: 'UTC' }), true, 'the zone is a parameter too');
});
