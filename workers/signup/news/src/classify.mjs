// Classify an item into one of the file-defined categories (config/categories.mjs) using Workers AI.
//
// The model is told to reply with ONLY a label; we then VALIDATE that string against the allowlist
// (CF Llama models have no reliable guided-JSON mode, so we constrain by prompt + validation). If the
// AI is unavailable, over quota, or returns something off-list, we fall back to a cheap keyword guess
// and finally to the DEFAULT_CATEGORY. Ingestion must never block on classification.

import { CATEGORIES, CATEGORY_NAMES, DEFAULT_CATEGORY } from '../config/categories.mjs';

// Lightweight keyword fallback. First matching pattern wins; order matters (most specific first).
// Used only when the AI call fails — keeps quota exhaustion graceful instead of dumping to "Other".
const KEYWORD_RULES = [
  { category: 'Security', re: /\b(cve|vulnerabilit|exploit|rce|zero-day|0-day|malware|ransomware|breach|backdoor|supply.chain|patch tuesday)\b/i },
  { category: 'Blockchain', re: /\b(blockchain|crypto|bitcoin|ethereum|\bweb3\b|defi|smart contract|nft|token|stablecoin|on-chain)\b/i },
  { category: 'Energy', re: /\b(solar|wind|nuclear|battery|batteries|\bev\b|electric vehicle|grid|renewable|photovoltaic|energy storage|gigafactory)\b/i },
  { category: 'AI/ML', re: /\b(\bai\b|a\.i\.|machine learning|\bllm\b|\bgpt\b|claude|anthropic|openai|gemini|model|neural|inference|diffusion|agentic)\b/i },
  { category: 'Business/Funding', re: /\b(funding|raises?|raised|series [a-e]\b|ipo|acqui|merger|valuation|billion|\$\d|layoffs?)\b/i },
  { category: 'Hardware', re: /\b(chip|gpu|cpu|semiconductor|silicon|processor|nvidia|amd|arm\b|server|motherboard|ssd|ram)\b/i },
  { category: 'DevOps/Cloud', re: /\b(kubernetes|k8s|docker|container|cloud|aws|azure|\bgcp\b|terraform|ci\/cd|observability|\bsre\b|serverless)\b/i },
  { category: 'Frameworks/Libraries', re: /\b(react|vue|svelte|angular|next\.js|nuxt|django|laravel|spring boot|rails|flutter|astro|remix)\b/i },
  { category: 'Programming Languages', re: /\b(rust|golang|\bgo\b|python|java\b|kotlin|c\+\+|typescript|compiler|runtime|jdk|release)\b/i },
  { category: 'Web Dev', re: /\b(javascript|\bcss\b|\bhtml\b|browser|chrome|firefox|webassembly|wasm|frontend|web platform)\b/i },
  { category: 'Open Source', re: /\b(open source|open-source|\bfoss\b|license|maintainer|github|gitlab|foundation)\b/i },
];

/**
 * Map a raw model string to a valid category name (case-insensitive, tolerant of extra words/quotes),
 * or null if nothing matches. Pure.
 */
export function normalizeLabel(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase();
  // Prefer an exact-ish match; fall back to substring containment for chatty replies.
  let best = null;
  for (const name of CATEGORY_NAMES) {
    const n = name.toLowerCase();
    if (s === n) return name; // clean exact match
    if (s.includes(n) && (!best || n.length > best.toLowerCase().length)) best = name;
  }
  return best;
}

/** Cheap keyword-based category guess from title + summary, or null. Pure. */
export function keywordCategory(item) {
  const hay = `${item?.title ?? ''} ${item?.summary ?? ''}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(hay)) return rule.category;
  }
  return null;
}

/** Build the system + user messages for the classifier. Pure. */
export function buildMessages(item) {
  const list = CATEGORIES.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  const system =
    'You classify a developer/tech news item into exactly ONE category from the list below. ' +
    'Reply with ONLY the category name, exactly as written, and nothing else.\n\nCategories:\n' + list;
  const user = `Title: ${item.title}\nSummary: ${item.summary || '(none)'}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Classify one item. Returns { category, classified } where classified=true means the AI produced a
 * valid label (false means we used a keyword/default fallback and it should be retried later).
 */
export async function classifyItem(env, item) {
  const model = env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct';
  try {
    const out = await env.AI.run(model, {
      messages: buildMessages(item),
      max_tokens: 12,
      temperature: 0,
    });
    const label = normalizeLabel(out?.response ?? out?.result ?? '');
    if (label) return { category: label, classified: true };
  } catch (err) {
    console.error(JSON.stringify({ at: 'classify', guid: item.guid, error: String(err?.message || err) }));
  }
  // Fallbacks: keyword guess, then the configured default. Marked unclassified for a later retry.
  return { category: keywordCategory(item) || DEFAULT_CATEGORY, classified: false };
}

// SOW-046 A: the combined classify + SUMMARIZE call. One Workers AI call returns BOTH the category and a 1-2
// sentence summary, so we never exceed the free 50-subrequest/run budget (a separate summarize call would). The
// summary is generated from the feed's full article text when it inlines one (item.contentText from
// <content:encoded>/<content>), else from the short excerpt. Same model + fail-closed posture as classifyItem.

const MAX_SUMMARY_CHARS = 400;

/** System + user messages for the combined classify+summarize call. Pure. */
export function buildAnalysisMessages(item) {
  const list = CATEGORIES.map((c) => `- ${c.name}: ${c.description}`).join('\n');
  const system =
    'You analyze a developer/tech news item. Reply in EXACTLY this format and NOTHING else:\n' +
    'CATEGORY: <one category name, copied exactly from the list below>\n' +
    'SUMMARY: <one or two plain sentences, no preamble, no markdown, no line breaks>\n\n' +
    'Categories:\n' + list;
  const body = item?.contentText || item?.summary || '';
  const user = `Title: ${item?.title ?? ''}\n\nContent:\n${body || '(none)'}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Parse the model's "CATEGORY: ...\nSUMMARY: ..." reply. Pure. Returns { category, digest } (either may be null).
 * The category is read ONLY from its own labelled line (so a category word appearing inside the summary text can
 * never hijack the label), then validated against the allowlist via normalizeLabel.
 */
export function parseAnalysis(raw) {
  const s = typeof raw === 'string' ? raw : (raw?.response ?? raw?.result ?? '');
  const catMatch = typeof s === 'string' ? s.match(/CATEGORY\s*:\s*(.+)/i) : null;
  const sumMatch = typeof s === 'string' ? s.match(/SUMMARY\s*:\s*([\s\S]+)/i) : null;
  const category = catMatch ? normalizeLabel(catMatch[1].split(/\r?\n/)[0]) : null;
  let digest = sumMatch ? sumMatch[1] : null;
  if (digest) {
    // collapse whitespace + trim FIRST, then strip wrapping quotes (so leading/trailing spaces can't hide them)
    digest = digest.replace(/\s+/g, ' ').trim();
    digest = digest.replace(/^["'“”']+/, '').replace(/["'“”']+$/, '').trim();
    if (digest.length > MAX_SUMMARY_CHARS) digest = digest.slice(0, MAX_SUMMARY_CHARS).trim();
    if (!digest) digest = null;
  }
  return { category, digest };
}

/**
 * One AI call that classifies AND summarizes. Returns { category, classified, digest, summarized }. Fail-closed
 * PER FIELD: a missing/invalid category falls back to keyword/default (classified:false, retried later); a missing
 * summary yields digest:null (summarized:false) and the caller falls back to the feed excerpt for display.
 */
export async function analyzeItem(env, item) {
  const model = env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct';
  try {
    const out = await env.AI.run(model, {
      messages: buildAnalysisMessages(item),
      max_tokens: 160,
      temperature: 0,
    });
    const { category, digest } = parseAnalysis(out?.response ?? out?.result ?? '');
    return {
      category: category || keywordCategory(item) || DEFAULT_CATEGORY,
      classified: Boolean(category),
      digest: digest || null,
      summarized: Boolean(digest),
    };
  } catch (err) {
    console.error(JSON.stringify({ at: 'analyze', guid: item.guid, error: String(err?.message || err) }));
    return { category: keywordCategory(item) || DEFAULT_CATEGORY, classified: false, digest: null, summarized: false };
  }
}
