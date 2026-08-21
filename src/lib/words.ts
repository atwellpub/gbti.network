// sow-259: the ONE build-time loader for the word-of-the-day pool (house/words.yml).
//
// It is a shared lib rather than a private helper because there are TWO build-time consumers and a second copy
// would drift silently: src/pages/words.json.ts publishes the pool as a CDN artifact, and
// src/components/home/WordOfTheDay.astro renders the initial pick into the homepage rail. The rotation itself is
// NOT here: that lives in client-ui/src/word-of-the-day.mjs, which both the build and the browser import, so the
// server-rendered word and the client re-pick can never disagree about how a word is chosen.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export type Word = { word: string; partOfSpeech: string; definition: string; enabled: boolean };

/** Parse + validate house/words.yml. THROWS at build time on a malformed or duplicate entry, so a bad edit fails
 *  the build instead of shipping a broken pool (the quotes.json.ts contract). Returns the FULL pool including
 *  disabled entries and the `enabled` flag, because the admin manager needs to list them. */
export function loadWords(): Word[] {
  const file = path.resolve(process.cwd(), 'house', 'words.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { words?: unknown } | null;
  const raw = Array.isArray(parsed?.words) ? parsed!.words : [];
  const seen = new Set<string>();
  const out: Word[] = [];
  for (const w of raw as any[]) {
    const word = String(w?.word || '').trim();
    const definition = String(w?.definition || '').trim();
    const partOfSpeech = String(w?.partOfSpeech || '').trim();
    if (!word || !definition) throw new Error(`words.yml: each word needs a non-empty word and definition (got word="${word}", definition="${definition}")`);
    const key = word.toLowerCase();
    if (seen.has(key)) throw new Error(`words.yml: duplicate word "${word}"`);
    seen.add(key);
    out.push({ word, partOfSpeech, definition, enabled: w?.enabled !== false });
  }
  return out;
}
