// CATEGORY DEFINITIONS — managed here at the filesystem level (no database).
//
// This is the fixed label set the AI classifier may choose from. To change the taxonomy, edit this
// array and redeploy (`npm run deploy`). Each entry:
//   name        the label stored on items and exposed by the API (must be unique).
//   description a short hint shown to the AI to make classification accurate. Keep it concrete.
//   default     (optional) exactly one category should set `default: true`; it is the fallback used
//               when the AI is unavailable/uncertain or returns something off-list.
//
// Adding a category: append an entry. Removing one: delete it (existing items keep their old label
// until reclassified or pruned). The classifier validates AI output against `name` (case-insensitive).

export const CATEGORIES = [
  { name: 'AI/ML', description: 'Artificial intelligence, machine learning, LLMs, models, agents, AI tooling and research.' },
  { name: 'Web Dev', description: 'Frontend and web platform: JavaScript/TypeScript, browsers, CSS, HTML, accessibility.' },
  { name: 'Frameworks/Libraries', description: 'Releases and updates to frameworks and popular libraries: React, Vue, Svelte, Angular, Next.js, Django, Laravel, Spring, etc.' },
  { name: 'Open Source', description: 'Open-source projects, releases, licensing, maintainers, foundations and community governance.' },
  { name: 'Security', description: 'Vulnerabilities, CVEs, exploits, breaches, malware, supply-chain attacks and defensive security.' },
  { name: 'DevOps/Cloud', description: 'Cloud platforms, infrastructure, containers, Kubernetes, CI/CD, observability and SRE.' },
  { name: 'Programming Languages', description: 'Language releases and features: Rust, Go, Python, Java, C++, PHP, runtimes and compilers.' },
  { name: 'Hardware', description: 'Chips, processors, GPUs, semiconductors, devices, servers and consumer electronics.' },
  { name: 'Blockchain', description: 'Cryptocurrency, web3, smart contracts, DeFi, Bitcoin, Ethereum and on-chain news.' },
  { name: 'Energy', description: 'Batteries, EVs, solar, wind, nuclear, the grid, storage and clean/renewable energy technology.' },
  { name: 'Business/Funding', description: 'Company news, funding rounds, IPOs, acquisitions, layoffs and the business of tech.' },
  { name: 'Other', description: 'General technology or anything that does not clearly fit another category.', default: true },
];

/** The fallback category name (the one flagged `default`, else "Other", else the last entry). */
export const DEFAULT_CATEGORY =
  (CATEGORIES.find((c) => c.default) ?? CATEGORIES.find((c) => c.name === 'Other') ?? CATEGORIES.at(-1)).name;

/** Just the names, for validation and the prompt. */
export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name);
