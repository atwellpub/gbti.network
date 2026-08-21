// sow-259: the pure, node-testable core for the word of the day. Holds NO DOM and NO chrome APIs, so it unit-tests
// exactly like client-ui/src/splash.mjs, and the same module serves both the Astro build (which renders the initial
// pick into the homepage rail) and the browser (which re-picks on load, because the page is prerendered and
// CDN-cached so a build-time-only pick would freeze the word until the next deploy).
//
// The rotation is a deterministic bucket over the enabled list, not random and not stateful: every reader in the
// same UTC day sees the same word, with no storage and no server. That shared word is the point of a word of the
// day. It is the SOW-063 pickQuote design at a 24-hour scale.

// The fail-soft bundled set, also the git-native seed's opening entries (house/words.yml). Each { word,
// partOfSpeech, definition }. Used when /words.json cannot be read, so the card degrades to a real word rather
// than an empty box.
export const BUNDLED_WORDS = [
  { word: 'ephemeral', partOfSpeech: 'adjective', definition: 'Lasting for a very short time.' },
  { word: 'laconic', partOfSpeech: 'adjective', definition: 'Using very few words.' },
  { word: 'quotidian', partOfSpeech: 'adjective', definition: 'Ordinary, or occurring every day.' },
  { word: 'alacrity', partOfSpeech: 'noun', definition: 'Brisk and cheerful readiness.' },
  { word: 'equanimity', partOfSpeech: 'noun', definition: 'Calmness and composure under strain.' },
  { word: 'lacuna', partOfSpeech: 'noun', definition: 'A gap where something is missing.' },
  { word: 'obviate', partOfSpeech: 'verb', definition: 'To remove a need or a difficulty before it arises.' },
  { word: 'halcyon', partOfSpeech: 'adjective', definition: 'Calm and peaceful, or idyllically happy in memory.' },
];

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Normalize an arbitrary words array to the ENABLED, well-formed set. Drops blank, malformed and disabled entries.
 *  partOfSpeech is OPTIONAL (an entry without one is still usable); word + definition are required. */
export function enabledWords(words) {
  if (!Array.isArray(words)) return [];
  return words
    .filter((w) => w && w.enabled !== false && String(w.word || '').trim() && String(w.definition || '').trim())
    .map((w) => ({
      word: String(w.word).trim(),
      partOfSpeech: String(w.partOfSpeech || '').trim(),
      definition: String(w.definition).trim(),
    }));
}

/** Deterministic 24-hour-bucketed pick over the enabled set: every reader in the same UTC day sees the same word,
 *  and it advances to the next at UTC midnight. Returns a { word, partOfSpeech, definition }, or null when there is
 *  no usable entry (the caller renders nothing rather than an empty card). */
export function pickWord(words, now = Date.now()) {
  const list = enabledWords(words);
  if (!list.length) return null;
  const bucket = Math.floor(now / ONE_DAY_MS);
  return list[((bucket % list.length) + list.length) % list.length];
}
