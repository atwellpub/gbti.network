// sow-259: publish the git-native word-of-the-day pool (house/words.yml) as a build artifact. Same "static site is
// the published read-view" pattern as quotes.json.ts and news-sources.json.ts: the YAML is the source of truth in
// the repo (portable, a fork carries its own), and this endpoint is how a reader consumes it without a GitHub
// token (a public, CDN-cached URL). The homepage rail card fetches it to re-pick the word client side, because the
// page is prerendered and a build-time-only pick would freeze the word until the next deploy.
// The FULL pool is emitted (including disabled entries + the `enabled` flag) so the admin manager can show them;
// consumers filter to enabled and pick one on a 24-hour rotation. Metadata only (words are not secret).
// CORS `*` so a non-site host (the extension, if it ever grows a card) can read the same artifact.
// Parsing + validation live in src/lib/words.ts, shared with the rail component so there is one loader.
import type { APIRoute } from 'astro';
import { loadWords } from '../lib/words';

export const prerender = true;

export const GET: APIRoute = async () => {
  const words = loadWords();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: words.length, words });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
