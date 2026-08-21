// sow-259: the PURE word-of-the-day pool edit core. Given the PARSED house/words.yml ({ words: [{ word,
// partOfSpeech, definition, enabled }] }) plus an action, each function returns { next, changed, audit } — `next` is
// the new parsed doc (the caller serializes + commits it via the SOW-005 PR flow), `changed` is false when the
// action is already satisfied (idempotent), and `audit` is an identity-minimal log entry folded into the PR body.
// Node-free (no fs / no yaml) so it runs in the client, the Worker, and node tests. A direct sibling of
// membership/quote-edits.mjs; words have no id, so they are identified by their (normalized, case-insensitive)
// word, which is also the dedupe key.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (house/** is admin-owned) +
// no-bypass branch protection + the metadata-only gate, exactly like roles/bans/quote edits. A non-admin PR
// touching house/words.yml is auto-rejected regardless of what this computes.

export class WordEditError extends Error {}

// These caps are LOAD-BEARING at two layers. The Worker's wordInput must reject at exactly these numbers, because
// this core SILENTLY TRUNCATES past them: an endpoint that admits a longer value hands the member a quiet edit
// they did not ask for. That exact mismatch was a real UX bug caught in review on the quote/news-source managers,
// and the fix was to match the caps rather than to stop truncating.
export const MAX_WORD = 64;
export const MAX_PART_OF_SPEECH = 24;
export const MAX_DEFINITION = 240;

const norm = (t) => String(t || '').trim();
const keyOf = (t) => norm(t).toLowerCase();

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new WordEditError('invalid timestamp');
  return d.toISOString();
}

/** Identity-minimal audit entry (the SOW-024/038/055/056 shape), keyed by the word rather than a github_id. */
function auditEntry(ctx, action, word, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { word },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!Array.isArray(d.words)) d.words = [];
  return d;
}

/**
 * ADD a word. Idempotent: re-adding the same word (case-insensitive) is a no-op. New words default to enabled.
 * Requires a non-empty word + definition; partOfSpeech is OPTIONAL, because a usable entry is a word and what it
 * means, and refusing an entry over a missing grammatical label would block a good edit for no reader benefit.
 */
export function addWord(doc, { word, partOfSpeech, definition, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const w = norm(word).slice(0, MAX_WORD);
  const p = norm(partOfSpeech).slice(0, MAX_PART_OF_SPEECH);
  const def = norm(definition).slice(0, MAX_DEFINITION);
  if (!w) throw new WordEditError('a word is required');
  if (!def) throw new WordEditError('a definition is required');
  const exists = d.words.find((x) => keyOf(x.word) === keyOf(w));
  if (exists) return { next: d, changed: false, audit: auditEntry(ctx, 'word.add', w, { noop: true }) };
  d.words.push({ word: w, partOfSpeech: p, definition: def, enabled: enabled !== false });
  return { next: d, changed: true, audit: auditEntry(ctx, 'word.add', w, { partOfSpeech: p || null }) };
}

/** ENABLE / DISABLE a word (the preferred way to retire one, since it keeps the history). Idempotent. */
export function setWordEnabled(doc, { word, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const want = enabled !== false;
  const w = d.words.find((x) => keyOf(x.word) === keyOf(word));
  if (!w) throw new WordEditError(`word not found: ${norm(word)}`);
  if ((w.enabled !== false) === want) return { next: d, changed: false, audit: auditEntry(ctx, 'word.enable', w.word, { enabled: want, noop: true }) };
  w.enabled = want;
  return { next: d, changed: true, audit: auditEntry(ctx, 'word.enable', w.word, { enabled: want }) };
}

/** REMOVE a word outright (prefer setWordEnabled(false) to keep history; remove is for genuinely bad entries). */
export function removeWord(doc, { word } = {}, ctx = {}) {
  const d = clean(doc);
  const i = d.words.findIndex((x) => keyOf(x.word) === keyOf(word));
  if (i < 0) throw new WordEditError(`word not found: ${norm(word)}`);
  const [gone] = d.words.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'word.remove', gone?.word ?? norm(word), null) };
}
