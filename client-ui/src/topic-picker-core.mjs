// SOW-054 Phase 3/5: pure helpers for the followed-topics picker (shared by onboarding + settings). The picker
// fetches /topics.json (the vocabulary) and the member's current prefs.categories (topic keys); these toggle the
// selection and normalize the endpoint payload. Node-free + pure so node --test covers them.

/** Parse the /topics.json payload into a clean [{ key, label, group? }] list, dropping malformed entries. */
export function topicsFromJson(data) {
  const list = Array.isArray(data && data.topics) ? data.topics : [];
  return list
    .filter((t) => t && typeof t.key === 'string' && t.key)
    .map((t) => ({
      key: t.key,
      label: typeof t.label === 'string' && t.label ? t.label : t.key,
      ...(typeof t.group === 'string' && t.group ? { group: t.group } : {}),
    }));
}

/** SOW-080: filter topics by a case-insensitive label (or key) substring. A blank query returns the list unchanged. */
export function filterTopics(list, query) {
  const q = String(query || '').trim().toLowerCase();
  const arr = Array.isArray(list) ? list : [];
  if (!q) return arr;
  return arr.filter((t) => String((t && t.label) || '').toLowerCase().includes(q) || String((t && t.key) || '').toLowerCase().includes(q));
}

/** SOW-080: group topics by their optional `group` field into [{ group, topics }]. Groups appear in first-seen order;
 *  ungrouped topics collect under a trailing { group: '', topics } bucket (only when any exist). A fully ungrouped
 *  list returns a single { group: '', topics } so the picker renders one flat chip grid (backward-compatible). */
export function groupTopics(list) {
  const arr = Array.isArray(list) ? list : [];
  const order = [];
  const byGroup = new Map();
  for (const t of arr) {
    const g = t && typeof t.group === 'string' && t.group ? t.group : '';
    if (!byGroup.has(g)) { byGroup.set(g, []); if (g) order.push(g); }
    byGroup.get(g).push(t);
  }
  const out = order.map((g) => ({ group: g, topics: byGroup.get(g) }));
  if (byGroup.has('')) out.push({ group: '', topics: byGroup.get('') });
  return out;
}

/** Toggle a topic key in the selection, returning a NEW array (add if absent, remove if present). Ignores a
 *  falsy key and de-dupes. Order-stable (a newly added key goes to the end). */
export function toggleTopic(selection, key) {
  const cur = (Array.isArray(selection) ? selection : []).filter((k) => typeof k === 'string' && k);
  if (!key || typeof key !== 'string') return [...new Set(cur)];
  const set = new Set(cur);
  if (set.has(key)) { set.delete(key); return cur.filter((k) => k !== key); }
  return [...new Set([...cur, key])];
}

/** Normalize a stored prefs.categories value into the selected topic-key set (defensive: drops non-strings). */
export function selectedTopics(categories) {
  return [...new Set((Array.isArray(categories) ? categories : []).filter((k) => typeof k === 'string' && k))];
}

/**
 * sow-207 QA: the topics a brand-new member starts with, so their first feed is tuned rather than empty.
 * Owner-chosen (2026-08-11). Ordered as the owner named them; the picker renders alphabetically anyway.
 *
 * `entertainment` was ADDED to house/topics.yml the same day to make this set expressible: it is a
 * content-taxonomy primary and gaming's parent, but the flat follow vocabulary had never carried it.
 */
export const DEFAULT_TOPICS = Object.freeze(['devops', 'entertainment', 'music', 'gaming', 'ai']);

/**
 * The starting selection for a member who has none: `defaults`, filtered to keys the vocabulary ACTUALLY
 * has. Returns the existing selection untouched when there is one, so this can only ever fill a void.
 *
 * Filtering against the live vocabulary is the point rather than a nicety. These keys are written down in one
 * file and defined in another, so a rename or removal in house/topics.yml would otherwise persist a dead key
 * into a member's prefs, where it would sit forever biasing nothing and matching no chip.
 */
export function seedDefaultTopics(selected, vocabulary, defaults = DEFAULT_TOPICS) {
  const cur = selectedTopics(selected);
  if (cur.length) return cur;
  const known = new Set((Array.isArray(vocabulary) ? vocabulary : []).map((t) => t && t.key).filter(Boolean));
  return (Array.isArray(defaults) ? defaults : []).filter((k) => known.has(k));
}

/** Select every topic in `pool` (the filtered view, or the whole vocabulary), merged AFTER the current
 *  selection so existing picks keep priority under the cap. Returns a NEW de-duped key array. */
export function selectAllTopics(selection, pool, cap = Infinity) {
  const cur = selectedTopics(selection);
  const keys = (Array.isArray(pool) ? pool : [])
    .map((t) => t && t.key)
    .filter((k) => typeof k === 'string' && k);
  const merged = [...new Set([...cur, ...keys])];
  return Number.isFinite(cap) && cap > 0 ? merged.slice(0, cap) : merged;
}
