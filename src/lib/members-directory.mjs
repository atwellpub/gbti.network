// SOW-029: pure builder for /members-index.json, the minimized member directory the extension welcome view
// (<gbti-welcome>) fetches for its randomized "follow members" list, AND (SOW-050) the in-extension reader's
// right-hand author drawer (avatar, name, headline, Follow, social links incl. Discord). Still NO github_id,
// email, or location. We DO now carry the profile's public `links` (github, website, x, discord, etc.): the
// member directory + each profile page already render these on the public site, so this surface adds no new
// exposure, and the reader's "show this author's Discord on inspection" need is exactly that public data. Plain
// .mjs so the Astro endpoint maps the collection into it and `node --test` imports the pure builder directly.

// The public social link keys we surface (the profile schema's links subset). Discord is included by design so the
// reader can reveal the author's Discord handle on inspection.
const LINK_KEYS = ['github', 'website', 'x', 'bluesky', 'youtube', 'devto', 'reddit', 'mastodon', 'linkedin', 'discord', 'instagram', 'threads', 'tiktok', 'twitch', 'facebook', 'dailydev', 'producthunt', 'rumble', 'soundcloud', 'mixcloud', 'spotify', 'bandcamp', 'wordpress', 'substack', 'medium', 'hashnode', 'peerlist', 'gitlab', 'stackoverflow', 'patreon', 'kofi', 'telegram'];

/** Parse a lowercase github login from a profile links.github value (a URL or a bare handle), else undefined. */
function githubLoginFromLinks(github) {
  if (!github) return undefined;
  const m = String(github).match(/github\.com\/([^/?#]+)/i);
  if (m) return m[1].toLowerCase();
  const h = String(github).trim().replace(/^@/, '');
  return /^[a-z0-9-]+$/i.test(h) ? h.toLowerCase() : undefined;
}

/** Keep only the known, non-empty public link keys (drops unknown keys + blanks). Returns undefined when none. */
function publicLinks(links) {
  if (!links || typeof links !== 'object') return undefined;
  const out = {};
  for (const k of LINK_KEYS) {
    const v = links[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * SOW-143: a short PLAIN-TEXT excerpt of a profile's markdown bio BODY, for the in-extension member detail view.
 * The body already renders publicly at /members/<u>/, so this adds no new exposure, but it MUST be plain text:
 * member markdown bodies render raw HTML on the site (no sanitize), so we strip ALL markup here and the extension
 * additionally renders the result escaped. Drops fenced code, HTML tags, link/heading/emphasis/tick markers,
 * collapses whitespace, and truncates on a word boundary. Returns undefined for an empty result (so the field is
 * omitted, matching the links/roles/skills pattern). Pure.
 */
export function bioExcerpt(body, max = 280) {
  let t = String(body == null ? '' : body);
  t = t.replace(/```[\s\S]*?```/g, ' ');        // fenced code blocks
  t = t.replace(/<[^>]*>/g, ' ');               // well-formed HTML tags
  t = t.replace(/[<>]/g, ' ');                  // any residual angle bracket (an UNCLOSED tag leaves a '<') -> no bracket ever reaches the JSON
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');   // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // links -> their label
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');      // heading markers
  t = t.replace(/^\s{0,3}>\s?/gm, '');           // blockquote markers
  t = t.replace(/[*_`~]+/g, '');                 // emphasis / inline-code / strikethrough ticks
  t = t.replace(/\s+/g, ' ').trim();             // collapse whitespace
  if (!t) return undefined;
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/**
 * @param {{ data: { username:string, displayName?:string, avatar?:string, headline?:string, tier?:string, links?:Record<string,string> } }[]} profiles
 *   ALREADY filtered to public + directory profiles by the caller.
 * @param {(login?:string)=>(string|undefined)} [avatarFallback]  github avatar by login, for profiles without a gravatar.
 * @returns {{ username:string, displayName:string, avatar:string|null, headline:string|null, tier:string, links?:Record<string,string>, roles?:string[], skills?:string[] }[]}
 */
export function buildMembersDirectory(profiles, avatarFallback = () => undefined) {
  return (profiles || []).map((p) => {
    const d = p.data || {};
    const login = githubLoginFromLinks(d.links?.github) || d.username;
    const links = publicLinks(d.links);
    // SOW-129: carry the PUBLIC roles + skills too (rendered on the profile + the reader author card, owner
    // decision 2026-07-19). Still NO location (kept off the public surfaces).
    const roles = Array.isArray(d.roles) ? d.roles.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()) : [];
    const skills = Array.isArray(d.skills) ? d.skills.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()) : [];
    // SOW-143: a plain-text bio excerpt (from the markdown BODY) + the join date, for the member detail view.
    const bio = bioExcerpt(p.body);
    const joinedAt = d.joinedAt ? new Date(d.joinedAt).toISOString() : undefined;
    return {
      username: d.username,
      displayName: d.displayName || d.username,
      avatar: d.avatar || avatarFallback(login) || null,
      headline: d.headline || null,
      tier: d.tier || 'trial',
      ...(links ? { links } : {}),
      ...(roles.length ? { roles } : {}),
      ...(skills.length ? { skills } : {}),
      ...(bio ? { bio } : {}),
      ...(joinedAt ? { joinedAt } : {}),
    };
  });
}
