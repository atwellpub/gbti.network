// sow-166 follow-up: resolve a LEGACY WordPress address for a grandfathered member, so the comped co-op
// members who predate Stripe can be reached by the digest at all.
//
// WHY THIS EXISTS. 21 members hold complimentary access granted before the paid system, so they have no
// Stripe Customer and therefore no address anywhere in the running system. The digest backfill correctly
// reported them unreachable. They are not: the production WordPress database dump holds 68 accounts and
// every one carries an email address. 15 of the 21 match a legacy account.
//
// THE ALLOW-SET IS THE WHOLE SAFETY MODEL, AND IT IS ENFORCED HERE RATHER THAN AT THE CALL SITE. The dump
// contains ~50 further people who registered on the old site and were never comped. The owner's decision
// (2026-08-24) was the 15 comped members ONLY. A resolver that returns "the address for this login" would
// make that decision a property of who happens to call it, which is exactly the kind of boundary that holds
// until the first hurried second caller. So this module cannot be asked for an address outside the set: the
// set is a required argument, matching happens only within it, and everything else in the file is invisible
// to the caller.
//
// The dump is at .data/legacy/db/*.sql, which is gitignored and local-only, so the PARSING is here and the
// FILE READING is the caller's. That also makes every rule below unit-testable without an 87MB fixture.

/** Fold a login, nicename or display name to a comparison key. */
export const normalizeName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Extract the VALUES blobs for `INSERT INTO \`table\` VALUES ...;`, respecting quoted semicolons.
 * Shared shape with scripts/extract-db-members.mjs, which reads the same dump for profile generation.
 */
export function valuesBlobs(sql, table) {
  const blobs = [];
  const re = new RegExp('INSERT INTO `' + table + '` VALUES ', 'g');
  let m;
  while ((m = re.exec(sql))) {
    let i = m.index + m[0].length;
    let inStr = false;
    const start = i;
    while (i < sql.length) {
      const c = sql[i];
      if (inStr) { if (c === '\\') { i += 2; continue; } if (c === "'") inStr = false; i++; continue; }
      if (c === "'") inStr = true;
      else if (c === ';') break;
      i++;
    }
    blobs.push(sql.slice(start, i));
  }
  return blobs;
}

/** Parse a `(..),(..)` tuple list into arrays of fields, with unquoted NULL as null. */
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
    while (i < n) {
      const c = blob[i];
      if (inStr) {
        if (c === '\\') { field += blob[i + 1]; i += 2; continue; }
        if (c === "'") { inStr = false; i++; continue; }
        field += c; i++; continue;
      }
      if (c === "'") { inStr = true; quoted = true; i++; continue; }
      if (c === ',') { fields.push(quoted ? field : (field === 'NULL' ? null : field)); field = ''; quoted = false; i++; continue; }
      if (c === ')') { fields.push(quoted ? field : (field === 'NULL' ? null : field)); i++; break; }
      field += c; i++;
    }
    if (fields.length) rows.push(fields);
  }
  return rows;
}

/** wp_users columns, by position: ID, user_login, user_pass, user_nicename, user_email, ..., display_name. */
export function parseLegacyUsers(sql) {
  const users = [];
  for (const blob of valuesBlobs(sql, 'wp_users')) {
    for (const r of parseTuples(blob)) {
      const email = String(r[4] ?? '');
      users.push({ id: String(r[0] ?? ''), login: r[1], nicename: r[3], display: r[9], email: email.includes('@') ? email : null });
    }
  }
  return users;
}

/**
 * Match an ALLOWED set of members against legacy accounts.
 *
 * @param users   parseLegacyUsers output
 * @param allowed [{ githubId, login }] and NOTHING may be resolved outside it
 * @returns { matched: [{githubId, login, email, matchedOn, legacyId}], unmatched: [{githubId, login}] }
 *
 * MATCHING IS DELIBERATELY EXACT-AFTER-FOLDING, never fuzzy. A fuzzy match here does not produce a slightly
 * wrong report, it emails the wrong person, and the folding (lowercase, drop non-alphanumerics) is already
 * generous enough to bridge "andrija-naglic" to "andrija naglic". Anything it misses belongs in the
 * unmatched list for a human to look at, which is a far better failure than a confident near-miss.
 *
 * A legacy account may be claimed by AT MOST ONE member. Two members folding to the same key is a data
 * problem, and silently giving both the same address would send one person another person's digest.
 */
export function matchLegacyAddresses(users = [], allowed = []) {
  const byKey = new Map();
  for (const u of users) {
    if (!u?.email) continue;
    for (const candidate of [u.login, u.nicename, u.display]) {
      const k = normalizeName(candidate);
      if (k && !byKey.has(k)) byKey.set(k, u);
    }
  }
  const matched = [];
  const unmatched = [];
  const claimed = new Set();
  for (const a of allowed) {
    const githubId = String(a?.githubId ?? '');
    const login = String(a?.login ?? '');
    if (!githubId || !login) { unmatched.push({ githubId, login, reason: 'incomplete allow-set entry' }); continue; }
    const key = normalizeName(login);
    const u = key ? byKey.get(key) : null;
    if (!u) { unmatched.push({ githubId, login, reason: 'no legacy account with this name' }); continue; }
    if (claimed.has(u.id)) { unmatched.push({ githubId, login, reason: `legacy account ${u.id} already claimed by another member` }); continue; }
    claimed.add(u.id);
    matched.push({ githubId, login, email: u.email, legacyId: u.id, matchedOn: normalizeName(u.login) === key ? 'login' : (normalizeName(u.nicename) === key ? 'nicename' : 'display') });
  }
  return { matched, unmatched };
}

/**
 * Fold OWNER-SUPPLIED addresses into the resolution, for grandfathered members the dump cannot reach.
 *
 * Five of the twenty grandfathered members have no legacy WordPress account, so no automated source holds an
 * address for them and the script correctly reported them unreachable. The owner can still know an address by
 * other means. This is the seam for that, and it is deliberately NARROW in three ways:
 *
 *   1. THE ALLOW-SET STILL BINDS. A supplied pair is honoured only when its login is in
 *      house/grandfathered.yml. The scope decision of 2026-08-24 is enforced in code rather than by
 *      invocation, and an env var must not be a way around it. A login outside the allow-set is REPORTED as
 *      rejected rather than dropped, so a typo does not look like a successful enrolment of somebody else.
 *   2. IT NEVER OVERRIDES THE DUMP. Only currently-unmatched logins are eligible. The dump is the
 *      corroborated source; a hand-typed address must not silently replace a resolved one.
 *   3. IT NEVER REACHES A COMMITTED FILE. The pairs arrive in MAIL_ENROLL_EXTRA at run time, the address goes
 *      into the HMAC and out of scope, and nothing here prints an address, exactly as the rest of the script
 *      already guarantees.
 *
 * Format: `login=address`, separated by commas or whitespace. Returns
 * { matched, unmatched, supplied, rejected } with the same row shape the dump matcher produces, so every
 * downstream step is unchanged.
 */
export function applySuppliedAddresses(matched, unmatched, allowed, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return { matched, unmatched, supplied: [], rejected: [] };

  const byLogin = new Map(allowed.map((a) => [a.login.toLowerCase(), a]));
  const stillUnmatched = new Map(unmatched.map((u) => [String(u.login ?? '').toLowerCase(), u]));

  const supplied = [];
  const rejected = [];
  const claimed = new Set();
  for (const pair of text.split(/[\s,]+/).filter(Boolean)) {
    const eq = pair.indexOf('=');
    if (eq < 1) { rejected.push({ pair, reason: 'not in login=address form' }); continue; }
    const login = pair.slice(0, eq).trim().toLowerCase();
    const email = pair.slice(eq + 1).trim();
    if (!email.includes('@')) { rejected.push({ pair: login, reason: 'no address' }); continue; }
    const entry = byLogin.get(login);
    if (!entry) { rejected.push({ pair: login, reason: 'not in the grandfathered allow-set' }); continue; }
    if (!stillUnmatched.has(login)) { rejected.push({ pair: login, reason: 'already resolved from the dump; not overridden' }); continue; }
    if (claimed.has(login)) { rejected.push({ pair: login, reason: 'named twice' }); continue; }
    claimed.add(login);
    supplied.push({ githubId: entry.githubId, login: entry.login, email, matchedOn: 'owner-supplied' });
  }

  return {
    matched: [...matched, ...supplied],
    unmatched: unmatched.filter((u) => !claimed.has(String(u.login ?? '').toLowerCase())),
    supplied,
    rejected,
  };
}
