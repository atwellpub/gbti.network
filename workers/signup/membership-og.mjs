// SOW-057: POST /membership/og-preview — fetch a link's OpenGraph preview SERVER-SIDE so the share composer can
// prefill a featured image (the browser/extension cannot fetch arbitrary cross-origin pages). Returns
// { ok, image, title, description, tags, suggestedCategory }. Authenticated by the GitHub bearer token (the
// extension/npm hosts) OR the website's gbti_session cookie (allowCookie, CSRF-gated) -- any signed-in member.
// The fetch is SSRF-guarded (no private/loopback/link-local/metadata
// targets), bounded, timed out, and NEVER throws (a bad target page returns { ok: true, image: null }).
//
// SOW-087: alongside the preview, the page's declared tags feed a topic-category SUGGESTION (topic-suggest.mjs,
// AI-assisted, fail-open to null) that pre-fills the composer's category select; the member always confirms.
//
// Uses the shared regex scraper (workers/lib/og-scrape.mjs). Pure over injected deps (fetchImpl/fetchUser/suggest),
// so it is unit-tested with fakes (no network, no secrets).

import { githubFetchUser } from './oauth.mjs';
import { resolveIdentity } from './identity.mjs'; // sow-158 Phase 1b shared choke point: bearer OR cookie + CSRF
import { scrapeOgPreview } from '../lib/og-scrape.mjs';
import { oembedEndpointFor, previewFromOembed } from '../lib/oembed-providers.mjs'; // SOW-102: provider fallback
import { mediumFeedUrlFor, previewFromMediumFeed } from '../lib/medium-preview.mjs'; // Medium RSS fallback (bot-challenged pages)
import { suggestTopic } from './topic-suggest.mjs';

const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 60000;

// IPv4 literal -> blocked if loopback/private/link-local/this-network.
function isBlockedIpv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 10 || a === 127 || a === 0) return true; // private / loopback / this-network
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 192 && b === 168) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
  return false;
}

function isBlockedHost(host) {
  // WHATWG URL keeps IPv6 hosts bracketed (e.g. "[::1]"); strip the brackets and a trailing dot before matching.
  const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === 'metadata.google.internal') return true;
  if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true; // IPv6 loopback/link-local/ULA
  if (isBlockedIpv4(h)) return true;
  return false;
}

/** Validate an author-supplied URL for a safe outbound fetch. Returns { ok, url } or { ok:false }. */
export function safeFetchTarget(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return { ok: false, reason: 'not a valid URL' }; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'only http(s) URLs are allowed' };
  if (u.username || u.password) return { ok: false, reason: 'credentials in the URL are not allowed' };
  if (isBlockedHost(u.hostname)) return { ok: false, reason: 'that host is not allowed' };
  return { ok: true, url: u.toString() };
}

// sow-211: `reason` says WHY a preview is empty, because four very different outcomes used to arrive at the
// composer as one indistinguishable { ok: true, ...nulls }: the page genuinely has no OpenGraph data, we
// could not reach it, it is not a web page at all, or it timed out. The route still NEVER throws and still
// never 500s, so this is additive: `reason: null` is the genuine no-data case and keeps today's behaviour.
// The composer turns each into its own sentence (ogPreviewState in gbti-share-composer.mjs).
const EMPTY_PREVIEW = { ok: true, image: null, title: null, description: null, tags: [], suggestedCategory: null, reason: null };

export async function handleOgPreview(request, env, {
  fetchImpl = globalThis.fetch,
  fetchUser = githubFetchUser,
  suggest = suggestTopic, // SOW-087: injectable for tests
  allowCookie = false, // opt-in the WEBSITE (cookie session) path; the extension/npm bearer path is unchanged
  verifyCookie, // injectable cookie verifier for tests (defaults to the identity resolver's own)
  // sow-211: injectable alongside the other deps so the TIMEOUT branch is testable. Distinguishing a timeout
  // from a refused connection needs the abort to actually fire, and a test cannot wait 8 real seconds.
  timeoutMs = FETCH_TIMEOUT_MS,
} = {}) {
  if (request.method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  // Any signed-in member may fetch a preview. Bearer (extension/npm) OR the gbti_session cookie (website),
  // resolved through the shared choke point so a cookie POST also clears the double-submit CSRF gate. The OG
  // fetch itself is SSRF-guarded below; identity is only used to gate the route, not to scope the fetch.
  const identityOpts = { fetchImpl, fetchUser, allowCookie };
  if (verifyCookie) identityOpts.verifyCookie = verifyCookie;
  const a = await resolveIdentity(request, env, identityOpts);
  if (!a.ok) return a;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } };
  }

  const target = safeFetchTarget(payload?.url);
  if (!target.ok) return { status: 400, body: { error: 'invalid_url', message: target.reason } };

  // SOW-102: provider oEmbed FIRST for matched links (YouTube, Vimeo). These providers serve no OG markup
  // to a datacenter fetch (the generic scrape comes back empty), but their public oEmbed APIs answer with
  // the title + author + thumbnail. Any oEmbed failure just falls through to the generic scrape.
  let preview = null;
  const oembedUrl = oembedEndpointFor(target.url);
  if (oembedUrl) {
    const oc = new AbortController();
    const ot = setTimeout(() => oc.abort(), timeoutMs);
    try {
      const res = await fetchImpl(oembedUrl, {
        signal: oc.signal,
        headers: { 'User-Agent': 'gbti-link-preview/0.1 (+https://gbti.network)', Accept: 'application/json' },
        cf: { cacheTtl: 1800, cacheEverything: true },
      });
      if (res && res.ok) preview = previewFromOembed(await res.json());
    } catch { /* fall through to the generic scrape */ }
    finally { clearTimeout(ot); }
  }

  // Medium fallback: Medium bot-challenges EVERY page fetch (so the generic scrape below always comes back
  // empty) and has no oEmbed, but the author/publication RSS feed still answers a plain server fetch and
  // carries recent items' title + lead image. Best-effort: an article older than the feed window stays
  // previewless. Any failure falls through to the generic scrape (harmless; it 403s into the empty preview).
  if (!preview) {
    const feedUrl = mediumFeedUrlFor(target.url);
    if (feedUrl) {
      const mc = new AbortController();
      const mt = setTimeout(() => mc.abort(), timeoutMs);
      try {
        const res = await fetchImpl(feedUrl, {
          signal: mc.signal,
          headers: { 'User-Agent': 'gbti-link-preview/0.1 (+https://gbti.network)', Accept: 'application/rss+xml, application/xml, text/xml' },
          cf: { cacheTtl: 1800, cacheEverything: true },
        });
        if (res && res.ok) preview = previewFromMediumFeed(await res.text(), target.url);
      } catch { /* fall through */ }
      finally { clearTimeout(mt); }
    }
  }

  // Bounded, timed-out fetch. Any failure returns a clean empty preview (never a 500), since an OG miss is normal.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    if (!preview) {
      const res = await fetchImpl(target.url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: { 'User-Agent': 'gbti-link-preview/0.1 (+https://gbti.network)', Accept: 'text/html,application/xhtml+xml' },
        cf: { cacheTtl: 1800, cacheEverything: true },
      });
      if (!res || !res.ok) return { status: 200, body: { ...EMPTY_PREVIEW, reason: 'unreachable' } };
      const ct = res.headers?.get?.('content-type') || '';
      if (ct && !/html|xml/i.test(ct)) return { status: 200, body: { ...EMPTY_PREVIEW, reason: 'not-a-page' } };
      let html = await res.text();
      if (typeof html === 'string' && html.length > MAX_BYTES) html = html.slice(0, MAX_BYTES);
      preview = scrapeOgPreview(html, target.url);
    }
    // SOW-087: a topic-category suggestion for the composer (fail-open: any error just means no suggestion).
    // SOW-102: with ZERO scraped signal the suggester is SKIPPED (it hallucinated a category from nothing).
    let suggestedCategory = null;
    const hasSignal = Boolean(preview.title || preview.description || (preview.tags && preview.tags.length));
    if (hasSignal) {
      try {
        suggestedCategory = await suggest(env, { title: preview.title, description: preview.description, tags: preview.tags });
      } catch {
        suggestedCategory = null;
      }
    }
    return {
      status: 200,
      body: {
        ok: true,
        image: preview.image || null,
        title: preview.title || null,
        description: preview.description || null,
        tags: preview.tags || [],
        suggestedCategory: suggestedCategory || null,
        // We reached the page and read it. If it yielded nothing, that IS the genuine no-data case.
        reason: null,
      },
    };
  } catch {
    // The abort signal is the only thing that distinguishes "took too long" from "refused/failed", and the
    // difference matters to the author: one is worth retrying, the other usually is not.
    return { status: 200, body: { ...EMPTY_PREVIEW, reason: controller.signal.aborted ? 'timeout' : 'unreachable' } };
  } finally {
    clearTimeout(timer);
  }
}
