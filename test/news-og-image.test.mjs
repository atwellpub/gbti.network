import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scrapeOgImage, fetchOgImage } from '../workers/signup/news/src/og-image.mjs';

// SOW-050 Tier 1: scrape a page's lead image (og:image preferred), resolving relative + protocol-relative URLs.
test('scrapeOgImage prefers og:image and resolves protocol-relative + relative URLs', () => {
  assert.equal(scrapeOgImage('<meta property="og:image" content="https://cdn.ex.com/a.jpg">'), 'https://cdn.ex.com/a.jpg');
  assert.equal(scrapeOgImage('<meta property="og:image" content="//cdn.ex.com/b.jpg">'), 'https://cdn.ex.com/b.jpg');
  assert.equal(scrapeOgImage('<meta property="og:image" content="/img/c.jpg">', 'https://ex.com/post/1'), 'https://ex.com/img/c.jpg');
});

test('scrapeOgImage falls back to twitter:image then link image_src; attribute order agnostic', () => {
  assert.equal(scrapeOgImage('<meta name="twitter:image" content="https://cdn.ex.com/t.png">'), 'https://cdn.ex.com/t.png');
  assert.equal(scrapeOgImage('<meta content="https://cdn.ex.com/o.png" property="og:image">'), 'https://cdn.ex.com/o.png'); // content before property
  assert.equal(scrapeOgImage('<link rel="image_src" href="https://cdn.ex.com/l.png">'), 'https://cdn.ex.com/l.png');
  // og:image still wins over a twitter:image present in the same head
  assert.equal(scrapeOgImage('<meta name="twitter:image" content="https://cdn.ex.com/t.png"><meta property="og:image" content="https://cdn.ex.com/o.png">'), 'https://cdn.ex.com/o.png');
});

test('scrapeOgImage rejects svg/data and returns empty when none', () => {
  assert.equal(scrapeOgImage('<meta property="og:image" content="https://cdn.ex.com/x.svg">'), '');
  assert.equal(scrapeOgImage('<meta property="og:image" content="data:image/png;base64,AAAA">'), '');
  assert.equal(scrapeOgImage('<p>no meta here</p>'), '');
  assert.equal(scrapeOgImage(''), '');
});

test('fetchOgImage scrapes via an injected fetch; null on non-ok / non-html / error / bad url', async () => {
  const html = async (url) => ({ ok: true, headers: { get: () => 'text/html; charset=utf-8' }, text: async () => `<meta property="og:image" content="${url}/og.jpg">` });
  assert.equal(await fetchOgImage('https://ex.com/p', { fetchImpl: html }), 'https://ex.com/p/og.jpg');

  const notOk = async () => ({ ok: false, headers: { get: () => '' }, text: async () => '' });
  assert.equal(await fetchOgImage('https://ex.com/p', { fetchImpl: notOk }), null);

  const pdf = async () => ({ ok: true, headers: { get: () => 'application/pdf' }, text: async () => '%PDF' });
  assert.equal(await fetchOgImage('https://ex.com/p.pdf', { fetchImpl: pdf }), null);

  const boom = async () => { throw new Error('network'); };
  assert.equal(await fetchOgImage('https://ex.com/p', { fetchImpl: boom }), null);

  assert.equal(await fetchOgImage('not-a-url', { fetchImpl: html }), null);
});
