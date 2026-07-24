// SOW-143: the shared member-directory loader. /members-index.json (SOW-029) is small + public (CORS *) and
// carries the fields both the reader author drawer and the member-detail view need (username, displayName,
// avatar, headline, links, roles, skills, and, since SOW-143, a plain-text bio excerpt). Fetch it once per page
// and memoize the promise so the two elements share ONE cache instead of each holding their own (which could
// disagree). The parse is factored out as a pure `directoryMap` so it is unit-testable without the network.

const SITE = 'https://gbti.network';
const lc = (s) => String(s || '').toLowerCase();

/** Turn a parsed /members-index.json object into a Map keyed by lowercase username. Pure; tolerates a missing
 *  or malformed `members` array. */
export function directoryMap(json) {
  const members = json && Array.isArray(json.members) ? json.members : [];
  return new Map(members.filter((m) => m && m.username).map((m) => [lc(m.username), m]));
}

let _directory = null;
/** Fetch + memoize the member directory as a Map<lowercase-username, entry>. Fails soft to an empty Map (a build
 *  without the JSON, an offline tab) so callers never throw. The promise is cached across every element open. */
export function loadMembersDirectory() {
  if (_directory) return _directory;
  _directory = fetch(`${SITE}/members-index.json`)
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((j) => directoryMap(j))
    .catch(() => new Map());
  return _directory;
}
