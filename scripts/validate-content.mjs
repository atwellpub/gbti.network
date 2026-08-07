#!/usr/bin/env node
// Content validation for the public-repo PR model (SOW-003 CI / SOW-005 scoping). Enforces the
// rules the Astro build does NOT: per-author scoping (a member may only author content inside their
// own members/<username>/ folder), globally-unique slugs per type, and valid status/visibility.
// The Astro build separately validates frontmatter against the Zod schemas. Runs locally + in CI.
//   node scripts/validate-content.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { isImageGenTarget } from '../client/src/image-models.mjs';
import { isSanctionedAvatar } from '../client-ui/src/profile-fields.mjs'; // SOW-129: the avatar host allowlist (shared)
import { membersIndexFromParsed, overrideConsistencyErrors } from '../membership/overrides-core.mjs';
import { validateNewsChannels } from '../membership/news-channels.mjs'; // SOW-043: the news-category -> Discord channel map
import { validateCoupons } from '../membership/coupons.mjs'; // SOW-119: the coupon registry
import { validateTopicMap } from '../membership/topic-map.mjs'; // SOW-054: the followed-topic -> news-category map
import { topicVocabKeys } from '../membership/topics-vocab.mjs'; // SOW-080: the flat house/topics.yml topic vocabulary
import { validateTierDisplay } from '../membership/tiers-display.mjs'; // sow-185: the membership tier display data
import { PAID_GRANT_TIERS } from '../membership/tier-gate.mjs'; // sow-185: the paid tiers a grandfather grant may name
import { CATEGORY_NAMES } from '../workers/signup/news/config/categories.mjs'; // SOW-054: the canonical news category labels

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const errors = [];
const slugs = { post: new Map(), product: new Map(), prompt: new Map(), applet: new Map() };

// Canonical taxonomy (house/taxonomy.yml). Every content `categories` path must resolve in this tree
// (SOW-012) — the single source of truth shared with src/lib/taxonomy.ts. A path may stop at any node.
const TAXONOMY = (() => {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(ROOT, 'house/taxonomy.yml'), 'utf8'));
    return (doc && doc.tree) || {};
  } catch {
    return {};
  }
})();

// SOW-087: the flat topic vocabulary (house/topics.yml). A share's optional `category` must be one of these
// keys so the category -> Discord-channel map can resolve it.
const TOPIC_KEYS = (() => {
  try {
    return new Set(topicVocabKeys(yaml.load(fs.readFileSync(path.join(ROOT, 'house/topics.yml'), 'utf8'))));
  } catch {
    return new Set();
  }
})();

function validCategoryPath(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return true; // uncategorized is allowed
  let level = TAXONOMY;
  for (const seg of arr) {
    if (!level || !level[seg]) return false;
    level = level[seg].children;
  }
  return true;
}

/** sow-140: a product's newsFeed (the member-owned RSS the admin registry may approve into the news pool)
 *  must be an https URL. RSS VALIDITY is verified by the moderator at approval time (CI stays offline). */
function checkNewsFeed(fm, rel) {
  const v = fm?.newsFeed;
  if (v === undefined || v === null) return;
  if (typeof v !== 'string' || !/^https:\/\/[^\s]+$/i.test(v)) {
    errors.push(`${rel}: newsFeed must be an https URL to the product's RSS feed (got ${JSON.stringify(v)}). See sow-140.`);
  }
}

/** SOW-015: an encrypted link must be member-only (encryption attaches only to visibility: members). */
function checkEncryptedLinks(fm, rel) {
  const links = fm?.links;
  if (!Array.isArray(links)) return;
  for (const [i, l] of links.entries()) {
    if (l && l.encrypted === true && l.visibility !== 'members') {
      errors.push(`${rel}: links[${i}] is encrypted but not visibility: members (encryption attaches only to member-only links). See SOW-015.`);
    }
  }
}

/**
 * SOW-016 member-only gating: publicStub is only meaningful for a members item, and an encryptedBody must
 * reference a real v1 .enc envelope (never a missing file or a committed plaintext). Modes A (members, no
 * stub), B (members, stub), and C (public, with a member-only section) all encrypt the gated body to a .enc.
 */
const MEMBER_MARKER = '<!-- members-only -->';

function checkMemberGating(fm, rel, body = '') {
  if (fm == null) return;
  if (fm.publicStub === true && fm.visibility !== 'members') {
    errors.push(`${rel}: publicStub:true requires visibility: members (a public item has no body to gate). See SOW-016.`);
  }
  // SOW-016: the `<!-- members-only -->` marker is a publish-time split directive. The client encrypts the
  // gated tail and strips the marker, so a committed body must NEVER contain it (otherwise the gated plaintext
  // would render inline). Enforce at PR time, not just in the dist build guard.
  if (typeof body === 'string' && body.includes(MEMBER_MARKER)) {
    errors.push(`${rel}: the body still contains the ${MEMBER_MARKER} marker (the gated section was not split). Publish via the client so the tail is encrypted and the marker removed. See SOW-016.`);
  }
  const enc = fm.encryptedBody;
  if (enc == null) return;
  if (typeof enc !== 'string') {
    errors.push(`${rel}: encryptedBody must be a repo-relative path string to a .enc envelope`);
    return;
  }
  const abs = path.join(ROOT, enc);
  if (!fs.existsSync(abs)) {
    errors.push(`${rel}: encryptedBody points at a missing file: ${enc} (publish via the client so the .enc ships in the same PR). See SOW-016.`);
    return;
  }
  try {
    const env = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (env?.v !== 1 || typeof env.iv !== 'string' || typeof env.ct !== 'string' || typeof env.aad !== 'string') {
      errors.push(`${rel}: encryptedBody ${enc} is not a valid v1 encrypted envelope (it may be plaintext; encrypt it via the client)`);
    }
  } catch {
    errors.push(`${rel}: encryptedBody ${enc} is not valid JSON (a .enc must be an encrypted v1 envelope, not raw plaintext)`);
  }
}

/** Each content item's `categories` must be a valid ordered path in the canonical taxonomy. */
function checkCategories(fm, rel) {
  const cats = fm?.categories;
  if (cats == null) return;
  if (!Array.isArray(cats)) {
    errors.push(`${rel}: categories must be an array path into house/taxonomy.yml`);
    return;
  }
  if (!validCategoryPath(cats)) {
    errors.push(`${rel}: categories ${JSON.stringify(cats)} is not a valid path in house/taxonomy.yml (canonical taxonomy)`);
  }
}

const field = (txt, key) => {
  const m = new RegExp(`^${key}:\\s*"?([^"\\n]+?)"?\\s*$`, 'm').exec(txt);
  return m ? m[1].trim() : null;
};


/** Parse the leading YAML frontmatter block, or null. Never throws (malformed YAML => null, build catches it). */
function frontmatter(txt) {
  const m = /^---\n([\s\S]*?)\n---/.exec(txt);
  if (!m) return null;
  try {
    const doc = yaml.load(m[1]);
    return doc && typeof doc === 'object' ? doc : null;
  } catch {
    return null;
  }
}

function checkContent(file, owner, type) {
  const txt = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  const author = field(txt, 'author');
  if (owner && author && author !== owner) {
    errors.push(`${rel}: author "${author}" must equal the folder owner "${owner}" (members may only author their own content)`);
  }
  const status = field(txt, 'status');
  if (status && !['draft', 'published'].includes(status)) errors.push(`${rel}: invalid status "${status}"`);
  const vis = field(txt, 'visibility');
  if (vis && !['public', 'members'].includes(vis)) errors.push(`${rel}: invalid visibility "${vis}"`);
  const slug = field(txt, 'slug');
  if (slug && slugs[type]) {
    if (slugs[type].has(slug)) errors.push(`${rel}: duplicate ${type} slug "${slug}" (already used by ${slugs[type].get(slug)})`);
    else slugs[type].set(slug, rel);
  }
  const bodyOf = (t) => t.replace(/^---\n[\s\S]*?\n---/, '');
  if (type === 'post' || type === 'product' || type === 'prompt' || type === 'applet') {
    const fm = frontmatter(txt);
    checkCategories(fm, rel);
    checkEncryptedLinks(fm, rel);
    if (type === 'product') checkNewsFeed(fm, rel); // sow-140
    checkMemberGating(fm, rel, bodyOf(txt)); // SOW-016
    // A prompt result image is reserved for image-gen models: reject an `image` unless a target is one.
    if (type === 'prompt' && fm.image && !isImageGenTarget(fm.targets)) {
      errors.push(`${rel}: a prompt "image" is only allowed when one of its targets is an image-gen model (e.g. Nano Banana, MidJourney). See client/src/image-models.mjs.`);
    }
  } else if (type === 'comment' || type === 'share') {
    // SOW-016: encryptedBody resolves to a real v1 envelope + no members-only marker leaks into the body.
    // SOW-018: a Share is gated the same way (a members Share encrypts its body); author scoping above
    // already enforces author === folder owner.
    const fmc = frontmatter(txt) || {};
    checkMemberGating(fmc, rel, bodyOf(txt));
    // SOW-087: a share's optional `category` is ONE flat topic key (house/topics.yml), not a taxonomy path; it
    // routes the share's category Discord post, so an unknown key would silently never route.
    if (type === 'share' && fmc.category != null && !TOPIC_KEYS.has(String(fmc.category))) {
      errors.push(`${rel}: share category "${fmc.category}" is not a topic key in house/topics.yml (SOW-087)`);
    }
    // SOW-032: a share comment is identified by the composite "<author>/<shareId>" targetSlug (a Share id is a
    // member-scoped timestamp-slug, not globally unique), so it stays unambiguous across members. The shareId stamp
    // is VARIABLE length: shareId() slices the createdAt digits to 14, so a date-only createdAt yields an 8-digit
    // stamp (e.g. 20260610-...) while a full timestamp yields 14 (20260615120000-...). Accept 1-14 leading digits.
    // The from-the-author intro requirement (SOW-014) only targets products/prompts, so a share never demands one.
    if (type === 'comment' && fmc.targetType === 'share' && !/^[a-z0-9][a-z0-9-]*\/[0-9]{1,14}-[a-z0-9-]+$/.test(String(fmc.targetSlug || ''))) {
      errors.push(`${rel}: a share comment targetSlug must be "<author>/<shareId>" (e.g. alice/20260615120000-x or alice/20260610-x). See SOW-032.`);
    }
    // SOW-046 D: a news comment targets a deterministic slug-safe id derived from the (URL-shaped) news guid:
    // "news-<hash>" (newsTargetSlug in client-ui/src/news.mjs). A raw guid (a URL) is never used as a targetSlug.
    if (type === 'comment' && fmc.targetType === 'news' && !/^news-[a-z0-9]+$/.test(String(fmc.targetSlug || ''))) {
      errors.push(`${rel}: a news comment targetSlug must be "news-<hash>" (the hashed news guid; see newsTargetSlug). See SOW-046 D.`);
    }
    // SOW-044: comments are members-only + encrypted. A `public` comment is allowed ONLY as a from-the-author
    // intro (authorNote:true) on a post/product/prompt; a discussion reply, and ANY comment on a Share, must be
    // members. A members comment must carry its body in an encrypted envelope, never as committed plaintext.
    if (type === 'comment') {
      const cvis = fmc.visibility ?? 'members';
      const isPublicIntro = fmc.authorNote === true && ['post', 'product', 'prompt'].includes(fmc.targetType);
      if (cvis === 'public' && !isPublicIntro) {
        errors.push(`${rel}: a public comment is only allowed as a from-the-author intro (authorNote:true on a post/product/prompt). A discussion comment, and any comment on a share, must be visibility:members. See SOW-044.`);
      }
      if (cvis === 'members' && bodyOf(txt).trim() && !fmc.encryptedBody) {
        errors.push(`${rel}: a members-only comment must encrypt its body to an encryptedBody .enc, never commit plaintext. Publish via the client. See SOW-044.`);
      }
    }
  }
}

const has = (p) => fs.existsSync(p);
// sow-158: recursive file list (for the member .mdx ban). Small trees only (one member folder at a time).
function* walkFiles(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else yield p;
  }
}
function eachSlug(base, owner) {
  for (const sub of ['posts', 'products', 'prompts']) {
    const dir = path.join(base, sub);
    if (!has(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const idx = path.join(dir, slug, 'index.md');
      if (has(idx)) checkContent(idx, owner, sub.slice(0, -1));
    }
  }
}

// house = org content (no per-author scoping)
eachSlug(path.join(ROOT, 'house'), null);
// SOW-022: applets are a SUPERADMIN-only content type, GBTI-only (house/applets/<slug>/index.md). Validate
// like a product (author scoping null, categories, slug). Members cannot author them (checked below).
const houseApplets = path.join(ROOT, 'house/applets');
if (has(houseApplets)) for (const slug of fs.readdirSync(houseApplets)) {
  const idx = path.join(houseApplets, slug, 'index.md');
  if (has(idx)) checkContent(idx, null, 'applet');
}
for (const page of has(path.join(ROOT, 'house/pages')) ? fs.readdirSync(path.join(ROOT, 'house/pages')) : []) {
  if (page.endsWith('.md')) checkContent(path.join(ROOT, 'house/pages', page), null, 'page');
}
// house/comments: GBTI's own comments (e.g. the from-the-author intro on house products/prompts). Author must be `gbti`.
// house/comments: GBTI-hosted comments (e.g. the from-the-author intro on house products/prompts). The
// author is the content owner (which may be a member handle like atwellpub now, not only `gbti`), so no
// fixed-author scoping here; house is admin-owned (CODEOWNERS) and ungated.
const houseComments = path.join(ROOT, 'house/comments');
if (has(houseComments)) for (const c of fs.readdirSync(houseComments)) if (c.endsWith('.md')) checkContent(path.join(houseComments, c), null, 'comment');

// members = scoped to <username>
const membersDir = path.join(ROOT, 'members');
if (has(membersDir)) {
  for (const user of fs.readdirSync(membersDir)) {
    const base = path.join(membersDir, user);
    if (!fs.statSync(base).isDirectory()) continue;
    eachSlug(base, user);
    // SOW-022: applets are superadmin-only. A member must never publish one; they link out from a product instead.
    if (has(path.join(base, 'applets'))) errors.push(`members/${user}/applets/: applets are a superadmin-only content type (SOW-022); members link out from a product instead`);
    // sow-158: member content is .md ONLY. MDX runs through a different pipeline than the sanitized
    // markdown config, so a member .mdx would be an unsanitized-HTML bypass; the collections no longer
    // load it, and this error gives the PR a clear message instead of a silently unrendered file.
    for (const f of walkFiles(base)) {
      if (f.endsWith('.mdx')) errors.push(`${path.relative(ROOT, f)}: .mdx is not allowed in member folders (sow-158); use .md`);
    }
    const profile = path.join(base, 'profile.md');
    if (has(profile)) {
      const ptxt = fs.readFileSync(profile, 'utf8');
      const u = field(ptxt, 'username');
      if (u && u !== user) errors.push(`members/${user}/profile.md: username "${u}" must equal the folder name "${user}"`);
      const av = field(ptxt, 'avatar');
      if (!isSanctionedAvatar(av)) errors.push(`members/${user}/profile.md: avatar "${av}" must be an https GitHub or Gravatar image URL; external image links are not allowed (SOW-129).`);
    }
    const comments = path.join(base, 'comments');
    if (has(comments)) for (const c of fs.readdirSync(comments)) if (c.endsWith('.md')) checkContent(path.join(comments, c), user, 'comment');
    // SOW-018: member Shares (status updates) live one-file-per in members/<user>/shares/. Author-scoped to
    // the folder owner, gated like comments (a members Share encrypts its body to .enc, no marker leak).
    const shares = path.join(base, 'shares');
    if (has(shares)) for (const s of fs.readdirSync(shares)) if (s.endsWith('.md')) checkContent(path.join(shares, s), user, 'share');
  }
}

// SOW-024: favorites.yml is RETIRED. Favorites moved off the immutable public repo onto the deletable edge
// store (Cloudflare KV), keyed by github_id, so a member's right-to-erasure is a hard delete. The public site
// only ever sees the member-identity-free aggregate in house/favorite-counts.yml (synced from KV by reconcile).
// A members/*/favorites.yml committed to git is therefore an error: it would put who-favorited-what back into
// immutable history. This guard prevents the git path (SOW-013) from being reintroduced.
if (has(membersDir)) {
  for (const user of fs.readdirSync(membersDir)) {
    const fav = path.join(membersDir, user, 'favorites.yml');
    if (has(fav)) {
      errors.push(`${path.relative(ROOT, fav)}: favorites.yml is retired (SOW-024). Favorites live in the edge store (KV), not git; remove this file.`);
    }
  }
}

// SOW-014: a published product/prompt requires a from-the-author introduction comment (a published
// comment by the content author targeting it). Enforced ONLY over the files changed in the PR
// (CHANGED_FILES, set by .github/workflows/content-check.yml), so already-published content is
// grandfathered and local full-repo runs skip it. The metadata-only merge gate is unchanged.
function buildCommentIndex() {
  const files = [];
  const hc = path.join(ROOT, 'house/comments');
  if (has(hc)) for (const f of fs.readdirSync(hc)) if (f.endsWith('.md')) files.push(path.join(hc, f));
  if (has(membersDir)) for (const u of fs.readdirSync(membersDir)) {
    const cd = path.join(membersDir, u, 'comments');
    if (fs.existsSync(cd) && fs.statSync(path.join(membersDir, u)).isDirectory()) {
      for (const f of fs.readdirSync(cd)) if (f.endsWith('.md')) files.push(path.join(cd, f));
    }
  }
  // `${targetType}:${targetSlug}` -> Map(author -> count of published, non-empty, authorNote-flagged comments).
  // SOW-014: only a comment the author DELIBERATELY flagged `authorNote: true` is the from-the-author note;
  // an ordinary conversational comment by the same author no longer satisfies the requirement.
  const idx = new Map();
  for (const file of files) {
    const txt = fs.readFileSync(file, 'utf8');
    const fm = frontmatter(txt) || {};
    const body = txt.replace(/^---\n[\s\S]*?\n---/, '').trim();
    if (!fm.targetType || !fm.targetSlug || !fm.author || !body) continue;
    if ((fm.status ?? 'published') !== 'published') continue;
    if (fm.authorNote !== true) continue;
    const key = `${fm.targetType}:${fm.targetSlug}`;
    if (!idx.has(key)) idx.set(key, new Map());
    const byAuthor = idx.get(key);
    byAuthor.set(fm.author, (byAuthor.get(fm.author) ?? 0) + 1);
  }
  return idx;
}

function validateAuthorIntro() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) return; // no PR diff => grandfather existing content (local + push runs skip this rule)
  const changed = raw.split(/\s+/).filter(Boolean);
  const idx = buildCommentIndex();
  for (const rel of changed) {
    const m = /^(?:house|members\/[^/]+)\/(products|prompts)\/[^/]+\/index\.md$/.exec(rel.replace(/^\.?\//, ''));
    if (!m) continue;
    const type = m[1].slice(0, -1); // 'product' | 'prompt'
    const abs = path.join(ROOT, rel);
    if (!has(abs)) continue; // deleted in the PR
    const txt = fs.readFileSync(abs, 'utf8');
    if (field(txt, 'status') !== 'published') continue; // only published content needs an intro
    const author = field(txt, 'author');
    const slug = field(txt, 'slug');
    const count = idx.get(`${type}:${slug}`)?.get(author) ?? 0;
    if (!author || count < 1) {
      errors.push(`${rel}: a published ${type} requires a from-the-author note by "${author}" in the same pull request (a published comment with authorNote: true, targetType:${type}, targetSlug:${slug}). See SOW-014.`);
    }
  }
  // Exactly one author note per target+author: a changed comment flagged `authorNote` must not collide with another.
  const reported = new Set();
  for (const rel of changed) {
    const cm = /^(?:house|members\/[^/]+)\/comments\/[^/]+\.mdx?$/.exec(rel.replace(/^\.?\//, ''));
    if (!cm) continue;
    const abs = path.join(ROOT, rel);
    if (!has(abs)) continue;
    const fm = frontmatter(fs.readFileSync(abs, 'utf8')) || {};
    if (fm.authorNote !== true) continue;
    const key = `${fm.targetType}:${fm.targetSlug}`;
    const dupKey = `${key}:${fm.author}`;
    if ((idx.get(key)?.get(fm.author) ?? 0) > 1 && !reported.has(dupKey)) {
      reported.add(dupKey);
      errors.push(`${rel}: more than one from-the-author note (authorNote: true) by "${fm.author}" targets ${fm.targetType}:${fm.targetSlug}. Exactly one is allowed; edit the existing note instead. See SOW-014.`);
    }
  }
}
validateAuthorIntro();

// SOW-100 tag policy (2026-07-08): tags are DASH-CONNECTED going forward. Diff-scoped like the intro check,
// so existing content is grandfathered; the client normalizes member input at build time, making this the
// backstop for hand-authored PRs.
function validateTagShape() {
  const raw = (process.env.CHANGED_FILES || '').trim();
  if (!raw) return;
  const TAG_RE = /^[a-z0-9][a-z0-9.-]*$/;
  const errors = [];
  for (const rel of raw.split(/[\s,]+/).filter(Boolean)) {
    if (!/^(members\/[^/]+|house)\/(posts|products|prompts)\/[^/]+\/index\.md$/.test(rel)) continue;
    let fm;
    try { fm = yaml.load((/^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(path.join(ROOT, rel), 'utf8')) || [])[1] || '') || {}; } catch { continue; }
    for (const t of Array.isArray(fm.tags) ? fm.tags : []) {
      if (!TAG_RE.test(String(t))) errors.push(`${rel}: tag "${t}" must be dash-connected (lowercase letters, digits, dots, hyphens)`);
    }
  }
  if (errors.length) {
    console.error(`\n✗ tag shape check failed (${errors.length}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exitCode = 1;
  }
}
validateTagShape();

// Override grants (bans / grandfathered / roles) must reference github_ids consistent with members-index.yml.
// A typo'd or swapped github_id<->login otherwise FAILS CLOSED silently (the wrong id never matches the member,
// so a comp/ban grant just does nothing). Skips ids/logins not in the index (folderless grants + the bot).
function validateOverrideConsistency() {
  const load = (rel) => {
    try { return yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) ?? {}; } catch { return {}; }
  };
  const idx = membersIndexFromParsed(load('house/members-index.yml'));
  if (!idx.size) return; // no members-index yet (pre-M0) -> nothing to check against
  const gf = load('house/grandfathered.yml');
  const bn = load('house/bans.yml');
  const rl = load('house/roles.yml');
  const tag = (list, src) => (Array.isArray(list) ? list : []).map((e) => ({ ...e, _src: src }));
  const entries = [
    ...tag(gf.grandfathered, 'grandfathered.yml'),
    ...tag(bn.bans, 'bans.yml'),
    ...tag(rl.superadmins, 'roles.yml superadmins'),
    ...tag(rl.admins, 'roles.yml admins'),
    ...tag(rl.moderators, 'roles.yml moderators'),
  ];
  for (const err of overrideConsistencyErrors(idx, entries)) errors.push(err);
}
validateOverrideConsistency();

// sow-185: a grandfather grant may carry an optional `tier` naming the membership tier it confers. When
// present it MUST be one of the paid tiers (member / creator); anything else (a typo, or `none`) is rejected,
// because a bad value would silently fall back to the creator default in tier-gate.grantTier and over-grant.
function validateGrandfatherTiers() {
  const rel = 'house/grandfathered.yml';
  if (!has(path.join(ROOT, rel))) return; // optional file
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  // Guard the shape: a `grandfathered:` mapping (missing the list dashes) parses to a non-array, which `?? []`
  // does not catch, so iterating it would throw an uncaught TypeError and crash the validator. Coerce cleanly.
  for (const e of Array.isArray(parsed?.grandfathered) ? parsed.grandfathered : []) {
    if (e?.tier === undefined || e?.tier === null) continue; // no tier -> defaults to creator, allowed
    if (!PAID_GRANT_TIERS.includes(e.tier)) {
      errors.push(`${rel}: grant for github_id ${e.github_id ?? '(unknown)'} has tier "${e.tier}"; allowed: ${PAID_GRANT_TIERS.join(', ')}`);
    }
  }
}
validateGrandfatherTiers();

// SOW-043: the news-category -> Discord channel map (house/news-channels.yml). Absent is fine; when present, it
// must be a list of { category, numeric channelId } with no duplicate category (a bad map would silently misroute
// or drop a heart-publish). Pure validation lives in membership/news-channels.mjs.
function validateNewsChannelsConfig() {
  const rel = 'house/news-channels.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateNewsChannels(parsed)) errors.push(err);
}
validateNewsChannelsConfig();

// SOW-119: the coupon registry (house/coupons.yml). A malformed coupon fails CI rather than silently
// granting nothing at signup (the runtime core also fails closed, but the author should know).
function validateCouponsConfig() {
  const rel = 'house/coupons.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateCoupons(parsed, { file: rel })) errors.push(err);
}
validateCouponsConfig();

// SOW-087: the content/share category -> Discord channel map (house/content-channels.yml). The same shape and
// rules as the news map (a list of { category, numeric channelId }, no duplicate category), validated by the
// same pure core with the file label swapped.
function validateContentChannelsConfig() {
  const rel = 'house/content-channels.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  for (const err of validateNewsChannels(parsed, { file: 'content-channels.yml' })) errors.push(err);
}
validateContentChannelsConfig();

// SOW-054 + SOW-080: the followed-topic -> news-category map (house/topic-map.yml). Absent is fine; when present,
// every topic must be a real topic in house/topics.yml (the flat vocabulary, no longer the content taxonomy) and
// every mapped news category must be canonical. Pure validation lives in membership/topic-map.mjs.
function validateTopicMapConfig() {
  const rel = 'house/topic-map.yml';
  if (!has(path.join(ROOT, rel))) return; // optional config
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  let topicsParsed = {};
  try { topicsParsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house/topics.yml'), 'utf8')); } catch { /* absent -> no topics */ }
  const opts = { topicKeys: topicVocabKeys(topicsParsed), newsCategories: CATEGORY_NAMES };
  for (const err of validateTopicMap(parsed, opts)) errors.push(err);
}
validateTopicMapConfig();

// sow-185: the membership tier data (house/membership-tiers.yml), the single source of truth for the homepage
// pricing accordion + the tier gating. REQUIRED: the site build (src/lib/tiers.ts) reads it directly. A missing
// tier, a purchasable tier with no price env var, or any malformed field fails CI. Pure validation lives in
// membership/tiers-display.mjs, the same parser the build uses.
function validateTiersConfig() {
  const rel = 'house/membership-tiers.yml';
  if (!has(path.join(ROOT, rel))) { errors.push(`${rel}: the required membership tier data file is missing`); return; }
  let parsed;
  try { parsed = yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')); }
  catch { errors.push(`${rel}: not valid YAML`); return; }
  const r = validateTierDisplay(parsed);
  if (!r.ok) errors.push(`${rel}: ${r.error}`);
}
validateTiersConfig();

// SOW-076 Phase 3: `--json` emits the errors as machine-readable JSON (for the post-publish remediation), while the
// exit code is unchanged. The default human output is untouched.
const JSON_OUT = process.argv.includes('--json');
if (errors.length) {
  if (JSON_OUT) console.log(JSON.stringify({ ok: false, errors }));
  else {
    console.error(`✗ content validation failed (${errors.length} issue${errors.length === 1 ? '' : 's'}):`);
    for (const e of errors) console.error('  - ' + e);
  }
  process.exit(1);
}
if (JSON_OUT) console.log(JSON.stringify({ ok: true, errors: [] }));
else console.log('✓ content validation passed (author scoping, unique slugs, valid status/visibility, canonical categories)');
