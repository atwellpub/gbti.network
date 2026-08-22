// Read the legacy WordPress dump for the ONE thing the live system cannot supply: the email address of a
// member who joined before Stripe was the registry. Fifteen of the twenty members the weekly digest cannot
// currently reach have an address here and nowhere else.
//
// THE ADDRESS-CONTAINMENT RULE THIS MODULE EXISTS TO KEEP. A real address is personal data belonging to a
// person who has not been asked about this backfill, so it is allowed exactly one destination: the Stripe
// POST that makes them reachable. It must not reach a log line, a report, a committed file, the KV
// subscriber record, or an agent transcript. This module therefore offers two different shapes, and callers
// planning anything use the second:
//
//   githubEmailIndex()   -> the addresses themselves. One caller, at the moment of the POST.
//   addressAvailability() -> a Set of github ids, WHICH ADDRESS EXISTS BUT NOT WHAT IT IS.
//
// Everything upstream of the POST (planning, counting, reporting, testing) takes the availability Set, so no
// plan object, report field or test fixture is even capable of holding an address.
//
// The dump lives under `.data/`, which is gitignored, so it cannot be committed by accident.

const GITHUB_URL_RE = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/?#]+)/i;

/**
 * The VALUES blob of every `INSERT INTO \`table\` VALUES ...;` in the dump.
 *
 * Scans character by character tracking quote state rather than splitting on ';', because a member bio
 * containing a semicolon would otherwise truncate the statement mid-row and silently drop every member
 * after it. Same reason the escape case consumes two characters: a bio ending in a backslash would
 * otherwise flip the parser out of string state and read the rest of the file as SQL.
 */
export function valuesBlobs(sql, table) {
  const blobs = [];
  const re = new RegExp('INSERT INTO `' + table + '` VALUES ', 'g');
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length;
    const start = i;
    let inStr = false;
    while (i < sql.length) {
      const c = sql[i];
      if (inStr) {
        if (c === '\\') { i += 2; continue; }
        if (c === "'") inStr = false;
        i++;
        continue;
      }
      if (c === "'") inStr = true;
      else if (c === ';') break;
      i++;
    }
    blobs.push(sql.slice(start, i));
  }
  return blobs;
}

/** Parse a `(..),(..)` tuple list into arrays of fields. An unquoted NULL becomes null. */
export function parseTuples(blob) {
  const rows = [];
  let i = 0;
  const n = blob.length;
  while (i < n) {
    while (i < n && blob[i] !== '(') i++;
    if (i >= n) break;
    i++;
    const fields = [];
    let field = '';
    let inStr = false;
    let quoted = false;
    let done = false;
    while (i < n && !done) {
      const c = blob[i];
      if (inStr) {
        if (c === '\\') { field += blob[i + 1]; i += 2; continue; }
        if (c === "'") { inStr = false; i++; continue; }
        field += c;
        i++;
      } else if (c === "'") {
        inStr = true;
        quoted = true;
        i++;
      } else if (c === ',') {
        fields.push(quoted ? field : (field.trim() === 'NULL' ? null : field.trim()));
        field = '';
        quoted = false;
        i++;
      } else if (c === ')') {
        fields.push(quoted ? field : (field.trim() === 'NULL' ? null : field.trim()));
        done = true;
        i++;
      } else {
        field += c;
        i++;
      }
    }
    rows.push(fields);
  }
  return rows;
}

/**
 * The github login out of a stored `social_github` value, lowercased, or null.
 *
 * Every value in the real dump is a full profile URL, but the field was free text on a WordPress profile
 * form, so a bare login is accepted too. LOWERCASING IS LOAD-BEARING RATHER THAN TIDINESS: github logins are
 * case-insensitive and the dump holds `Eyesandnose` and `MattBissett` against ids stored lowercase, so a
 * case-sensitive match drops those members back into the unreachable list for a reason that is not real.
 */
export function normalizeGithubLogin(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const m = GITHUB_URL_RE.exec(raw);
  const login = (m ? m[1] : raw).replace(/^@/, '').replace(/\.git$/, '').trim();
  if (!login || login.includes('/') || login.includes(' ')) return null;
  return login.toLowerCase();
}

/**
 * Map lowercased github login -> email address, for every dump user who recorded a github profile.
 *
 * RETURNS REAL ADDRESSES. Call it only where one is about to be handed to Stripe; everywhere else call
 * `addressAvailability` instead.
 */
export function githubEmailIndex(sql) {
  const emailByUserId = new Map();
  for (const blob of valuesBlobs(sql, 'wp_users')) {
    for (const r of parseTuples(blob)) {
      const email = String(r[4] ?? '').trim();
      if (r[0] && email) emailByUserId.set(String(r[0]), email);
    }
  }

  const index = new Map();
  for (const blob of valuesBlobs(sql, 'wp_usermeta')) {
    for (const r of parseTuples(blob)) {
      if (r[2] !== 'social_github') continue;
      const login = normalizeGithubLogin(r[3]);
      const email = emailByUserId.get(String(r[1]));
      // First writer wins. A duplicate is a person who registered twice under one github profile, and the
      // earlier row is the account their membership is attached to.
      if (login && email && !index.has(login)) index.set(login, email);
    }
  }
  return index;
}

/**
 * Which of these members an address exists for, as a Set of github ids AND NOTHING ELSE.
 *
 * This is the shape every planning, counting and reporting path takes, so those paths cannot hold an address
 * even by mistake.
 */
export function addressAvailability(index, members = []) {
  const have = new Set();
  for (const m of members) {
    const githubId = String(m?.githubId ?? '').trim();
    const login = String(m?.githubLogin ?? m?.username ?? '').trim().toLowerCase();
    if (githubId && login && index.has(login)) have.add(githubId);
  }
  return have;
}
