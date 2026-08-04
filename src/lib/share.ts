// Programmatic social-share intent builder (see .data/ops/share-ops/README.md). One schema per content
// type drives the lead sentence and the base discovery hashtags; the content's top-level category adds
// one more hashtag. X carries the lead + hashtags in its own intent params; LinkedIn and Reddit scrape or
// accept a title from the URL itself, so they need no text payload. No SDKs, no trackers, every target is
// a plain intent URL, plus a client-side copy-link. Reused across prompt / post / product pages.

import { categoryLabel, topKey } from './taxonomy';

export type ShareType = 'prompt' | 'post' | 'product';

// Per-type share schema: the conversational lead and the base hashtags. Edit here to retune the voice
// or discovery tags for a whole content type in one place.
const SHARE_SCHEMA: Record<ShareType, { lead: string; hashtags: string[] }> = {
  prompt: { lead: 'Have a look at this AI prompt I found:', hashtags: ['gbti', 'aiprompts'] },
  post: { lead: 'Worth a read from GBTI Network:', hashtags: ['gbti', 'devblog'] },
  product: { lead: 'Check out this tool on GBTI Network:', hashtags: ['gbti', 'devtools'] },
};

/** Slugify any word/label into a bare hashtag token (letters + digits only, lowercased). '' if nothing usable. */
function hashtagToken(word: string): string {
  return (word || '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

export interface ShareInput {
  type: ShareType;
  title: string;
  url: string; // absolute, canonical URL (build from Astro.site)
  categories?: string[]; // taxonomy path; its top-level key becomes the category hashtag
}

export interface ShareLinks {
  lead: string; // the conversational lead sentence
  hashtags: string[]; // ['#gbti', '#aiprompts', '#ai'] — display form
  x: string; // X intent href (hashtags carried in the intent's hashtags param)
  linkedin: string; // LinkedIn share-offsite href (url only; LinkedIn scrapes the page's own OG tags)
  reddit: string; // reddit submit href (url + title, no hashtags; Reddit has no hashtag concept)
}

/**
 * Build every share variant for one content item. Pure + framework-free, so it is unit-testable and the
 * same logic serves prompts, posts, and products. Platform shaping:
 *  - X: text = "lead title", url + hashtags ride their own intent params (hashtags help discovery).
 *  - LinkedIn: url only, its share-offsite endpoint pulls title/description from the page's OG tags.
 *  - Reddit: url + title as separate params, its submit page has no hashtag concept.
 */
export function buildShare({ type, title, url, categories }: ShareInput): ShareLinks {
  const schema = SHARE_SCHEMA[type];
  const enc = encodeURIComponent;

  // Base hashtags + one category hashtag derived from the top-level taxonomy key (e.g. ai -> #ai).
  const catKey = topKey(categories);
  const catToken = catKey ? hashtagToken(categoryLabel(catKey)) : '';
  const tokens = [...schema.hashtags.map(hashtagToken), catToken].filter(Boolean);
  // De-dupe while preserving order (a base tag may equal the category, e.g. nothing overlaps today but stay safe).
  const seen = new Set<string>();
  const uniqueTokens = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  const hashtags = uniqueTokens.map((t) => `#${t}`);

  const lead = schema.lead;
  const headline = `${lead} ${title}`.trim(); // the human sentence, no url, no tags

  return {
    lead,
    hashtags,
    x: `https://twitter.com/intent/tweet?text=${enc(headline)}&url=${enc(url)}${
      uniqueTokens.length ? `&hashtags=${enc(uniqueTokens.join(','))}` : ''
    }`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`,
    reddit: `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(title)}`,
  };
}
