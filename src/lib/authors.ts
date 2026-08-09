/**
 * The network's own content identity (sow-195). `gbtilabs` is a REAL member folder holding what used to
 * live in `house/`; `gbti` is the retired pseudo-author, kept here so anything written before the move
 * still renders identically. Both display as "GBTI Network", because the folder move is deliberately
 * invisible to readers: the byline, the avatar and the card all read exactly as they did before.
 *
 * This is the ONE place that knows it. Callers that have a profile prefer its displayName
 * (ContentMeta, AuthorBox), and callers that do not (ArticleTeaser) fall through to here, so the two
 * cannot disagree the way they would if only the profile carried the name.
 */
const NETWORK_AUTHORS = new Set(['gbti', 'gbtilabs']);

/** Display name + profile link for a content author username. */
export function authorDisplay(username: string): string {
  return NETWORK_AUTHORS.has(username) ? 'GBTI Network' : username;
}

export function authorHref(username: string): string {
  // The retired `gbti` pseudo-author has no profile page, so it still points at the homepage. `gbtilabs`
  // is a real member and gets its real profile.
  return username === 'gbti' ? '/' : `/members/${username}/`;
}

/** House (GBTI Network) avatar: the Gravatar for the gbti.labs account. Only the Gravatar HASH (a
 *  one-way digest) is stored, never the email, since the content repo is public. The Avatar component
 *  rewrites `d=` to 404, so the brand letter disc shows if the Gravatar is ever removed. The gbtilabs
 *  profile carries this same hash, so the avatar is unchanged by the sow-195 move either way. */
export const GBTI_AVATAR = 'https://secure.gravatar.com/avatar/061a44e977c1338f8b6d2e0e36b36f1a?s=512&d=mm';

/** Avatar URL for a content author: the member's profile avatar if provided, else the house Gravatar
 *  for the network identity, else undefined (the Avatar component then renders a letter disc). */
export function authorAvatar(username: string, profileAvatar?: string): string | undefined {
  return profileAvatar ?? (NETWORK_AUTHORS.has(username) ? GBTI_AVATAR : undefined);
}

/** Format a date the way the legacy site did: ordinal day + short month + year ("13th Oct 2025"). UTC
 *  throughout: a date-only frontmatter value (publishedAt: 2026-08-04) parses to UTC midnight, so reading
 *  local parts renders the day before in any negative-offset timezone (confirmed both directions: a UTC
 *  build renders the 4th, a local CDT build of the same value renders the 3rd). Reading the UTC parts
 *  makes the rendered date match the date the author actually wrote, everywhere it builds or previews. */
export function formatDate(d?: Date): string {
  if (!d) return '';
  const day = d.getUTCDate();
  const j = day % 10;
  const k = day % 100;
  const suffix = j === 1 && k !== 11 ? 'st' : j === 2 && k !== 12 ? 'nd' : j === 3 && k !== 13 ? 'rd' : 'th';
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  return `${day}${suffix} ${month} ${d.getUTCFullYear()}`;
}
