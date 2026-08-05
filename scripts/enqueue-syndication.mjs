#!/usr/bin/env node
// SOW-058 P4: the content-publish ENQUEUE runner (replaces the immediate Discord post in syndicate-content.mjs).
// Given the content files ADDED in a push to main, it builds a syndication queue item per publishable
// post/product/prompt/SHARE and ENQUEUES it via the Cloudflare KV REST API. NOTHING posts here: each item is
// `pending` and waits for a superadmin to APPROVE it in the tracker, after which the Worker drain posts it to
// every enabled channel. SOW-087: shares now enqueue HERE at publish time (the SOW-057 upvote trigger is
// retired); each item carries its `category` (a share's flat topic key, or the content's top-level taxonomy
// key) for the category-channel Discord post, the author's profile displayName (`authorName`, for the no-ping
// template), and its moderation `flags` (house/moderation-flags.yml over title + blurb; a flagged item always
// waits for superadmin approval). Metadata only (url + title + blurb + image); a members-only / Mode A body is
// NEVER read. The author's Discord mention is resolved at enqueue time (Stripe) and stored on the item, so the
// drain stays network-free for identity.
//   node scripts/enqueue-syndication.mjs --added members/alice/posts/x/index.md        # dry-run (no KV write)
//   node scripts/enqueue-syndication.mjs --apply --added <path> [<path> ...]           # enqueue to KV
// Requires (for --apply): CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN; STRIPE_SECRET_KEY enables @mentions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { parseContentFile } from '../client/src/content-ops.mjs';
import { createStripeClient } from '../clients/stripe.mjs';
import { buildSyndicationItem, publicUrlFor } from './lib/content-syndication.mjs';
import { reverseMembersIndex, createMentionResolver } from './lib/discord-mention.mjs';
import { enqueueViaKvRest } from './lib/syndication-rest.mjs';
import { flagText } from '../membership/moderation-flags.mjs'; // SOW-087: the moderation word-list gate
import { loadSyndicationConfig } from '../membership/syndication-config.mjs'; // SOW-125: the auto-share matrix
import { deliverChannelsForType } from '../membership/syndication-config-core.mjs'; // SOW-125: per-type gate

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const ai = argv.indexOf('--added');
  let added = [];
  if (ai >= 0) {
    added = argv.slice(ai + 1)
      .filter((a) => !a.startsWith('--'))
      .flatMap((t) => String(t).split(/[\s,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { apply, added };
}

/** Load house/members-index.yml into a { github_id: username } map (flat, or under a `members:` key). */
function loadMembersIndex(root) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, 'house/members-index.yml'), 'utf8')) ?? {};
    const map = doc && typeof doc === 'object' && doc.members && typeof doc.members === 'object' ? doc.members : doc;
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function parseOverrides(env) {
  try { return env.DISCORD_MENTION_OVERRIDES ? JSON.parse(env.DISCORD_MENTION_OVERRIDES) : {}; } catch { return {}; }
}

/** Path-key for the queue dedupe/targetSlug: members/alice/posts/x/index.md -> members/alice/posts/x. */
export function pathKey(rel) {
  return String(rel).replace(/\/index\.md$/, '').replace(/\.md$/, '');
}

/** SOW-087: the routing category — a share carries ONE flat topic key; content routes by its top-level taxonomy key. */
export function categoryOf(item, fm) {
  if (item.type === 'share') return typeof fm.category === 'string' ? fm.category : null;
  return Array.isArray(fm.categories) && typeof fm.categories[0] === 'string' ? fm.categories[0] : null;
}

/** Map a buildSyndicationItem result + its frontmatter to a buildQueueItem INPUT (metadata only, never the body). */
export function toQueueInput({ item, fm, rel, mention, siteOrigin, authorName = null, authorDiscord = null, authorX = null, authorBluesky = null, authorMastodon = null, authorReddit = null, authorDevto = null, authorNote = null, moderation = null }) {
  const title = item.title;
  const blurb = (fm.shortDescription || fm.excerpt || fm.description || '').toString().trim() || null;
  return {
    source: item.type,
    targetType: item.type,
    targetSlug: pathKey(rel),
    author: item.author,
    authorName: authorName || null, // SOW-087: profile displayName, feeds the no-ping template
    authorDiscord: authorDiscord || null, // SOW-088: the public profile Discord handle
    authorX: authorX || null, // SOW-120: the public profile X handle, feeds {member-x-handle}
    authorBluesky: authorBluesky || null, // SOW-122: the public profile Bluesky handle, feeds {member-bluesky-handle}
    authorMastodon: authorMastodon || null, // SOW-123: the public profile Mastodon handle, feeds {member-mastodon-handle}
    authorReddit: authorReddit || null, // the public profile Reddit username, feeds {member-reddit-handle}
    authorDevto: authorDevto || null, // SOW-140: the public profile dev.to handle, feeds {member-devto-handle}
    // SOW-014: the from-the-author intro comment body, feeding {author-note}, {author-note-italic} and
    // {author-note-block}. The AUTO rail never supplied it, so every template referencing the note rendered
    // empty (the stored reddit-comment template quotes it, so it rendered a bare ""). buildQueueItem clamps
    // it to 4000 chars and drops it entirely for a members-only item.
    authorNote: authorNote || null,
    tags: Array.isArray(fm.tags) ? fm.tags.filter((t) => typeof t === 'string') : null, // SOW-120: feeds {tags-hashtags}
    title,
    blurb,
    // A share posts its off-network link; content posts its public page (null for Mode A members-only).
    url: (item.type === 'share' ? item.shareUrl : publicUrlFor(item, siteOrigin)) || null,
    image: fm.coverImage || fm.image || null,
    category: categoryOf(item, fm), // SOW-087: routes the category-channel Discord post
    categoryPath: item.type === 'share' ? null : (Array.isArray(fm.categories) ? fm.categories.filter((c) => typeof c === 'string') : null), // SOW-088: leaf-first channel routing
    visibility: item.visibility,
    mention: mention || null,
    flags: flagText(moderation, `${title || ''} ${blurb || ''}`), // SOW-087: the posted surface only
    trigger: 'publish',
  };
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch, deps = {} } = {}) {
  const { apply, added: argvAdded } = parseArgs(argv);
  // The workflow passes paths via the SYNDICATE_ADDED env var (NOT argv) so a path can never be shell-interpreted.
  const added = argvAdded.length
    ? argvAdded
    : String(env.SYNDICATE_ADDED || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const readFile = deps.readFile ?? ((rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  });
  const siteOrigin = env.SITE_ORIGIN || 'https://gbti.network';

  // SOW-125: the per-type-per-channel auto-share matrix. An item is only enqueued if its TYPE has at least one
  // channel set to `on` (auto at publish) AND enabled. Shares default to OFF everywhere, so a share is skipped
  // here (manual syndication is unaffected). Fail-open note: if the config cannot be read, `cfg` is the
  // fail-closed default (shares off, the rest on for enabled channels), matching the documented behavior.
  const cfg = deps.config ?? loadSyndicationConfig(root);

  // SOW-131: the master switch is the fail-closed gate (default false). Nothing enqueues while syndication is
  // off, and a missing/unreadable config normalizes to enabled:false, so it enqueues nothing. Previously the
  // fail-closed behavior leaned on the per-channel `channels` flags (all false by default); those are gone now
  // that channel enablement is matrix-derived, so the master switch carries the invariant.
  if (!cfg?.enabled) {
    console.log('enqueue-syndication: syndication is off (master switch); nothing to enqueue.');
    return { enqueued: 0, inputs: [] };
  }

  // Build a publishable item from each added path (SOW-087: shares now enqueue here too, at publish time).
  // SOW-112: a permalink RENAME adds the file at its new path, which this diff-of-adds would announce as a
  // brand-new publish. A rename-generated redirectFrom entry has the canonical URL shape (legacy migration
  // entries are WordPress-shaped and never match), so it is a precise, deterministic skip marker.
  const RENAME_MARK_RE = /^\/(articles|products|prompts)\/[a-z0-9][a-z0-9-]*\/$/;
  const built = [];
  for (const rel of added) {
    const txt = readFile(rel);
    if (txt == null) continue;
    let fm;
    try { fm = parseContentFile(txt).frontmatter; } catch { continue; }
    const item = buildSyndicationItem(rel, fm);
    if (!item) continue;
    if (Array.isArray(fm.redirectFrom) && fm.redirectFrom.some((e) => RENAME_MARK_RE.test(String(e || '').trim()))) {
      console.log(`  skip (a permalink rename, already announced at its original publish): ${rel}`);
      continue;
    }
    // SOW-125: skip a type with NO channel set to deliver (`on`) — auto OR manual (e.g. shares by default).
    // Nothing to auto-post AND nothing to enqueue as a manual task, so there is nothing to queue.
    const deliverChannels = deliverChannelsForType(cfg, item.type);
    if (deliverChannels.length === 0) {
      console.log(`  skip (auto-share off for type "${item.type}" on every channel): ${rel}`);
      continue;
    }
    built.push({ item, fm, rel });
  }
  console.log(`enqueue-syndication: ${added.length} changed path(s), ${built.length} publishable item(s)${apply ? '' : ' (dry-run)'}`);
  if (!built.length) {
    if (!apply) console.log('Nothing to enqueue.');
    return { enqueued: 0, inputs: [] };
  }

  // Resolve each author's Discord mention at enqueue time (Stripe), so the drain never re-hits Stripe.
  const reverseIndex = reverseMembersIndex(loadMembersIndex(root));
  const stripe = deps.stripe ?? (env.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null);
  const resolveMention = deps.resolveMention ?? createMentionResolver({ reverseIndex, stripe, overrides: parseOverrides(env) });

  // SOW-087: the moderation word lists (working copy) + the author's profile displayName (for the no-ping template).
  let moderation = null;
  try { moderation = yaml.load(readFile('house/moderation-flags.yml') ?? '') ?? null; } catch { moderation = null; }
  const profileCache = new Map();
  const readProfileFm = (author) => {
    const a = String(author || '');
    if (!a || a === 'gbti' || a === 'house') return null;
    if (profileCache.has(a)) return profileCache.get(a);
    let fm = null;
    try {
      const profile = readFile(`members/${a}/profile.md`);
      if (profile != null) fm = parseContentFile(profile).frontmatter ?? null;
    } catch { fm = null; }
    profileCache.set(a, fm);
    return fm;
  };
  const resolveAuthorName = deps.resolveAuthorName ?? ((author) => {
    if (String(author) === 'gbti' || String(author) === 'house') return 'GBTI Network';
    return readProfileFm(author)?.displayName || null;
  });
  // SOW-088: the profile's PUBLIC Discord handle feeds {member-discord-username} + the drain's guild lookup.
  const resolveAuthorDiscord = deps.resolveAuthorDiscord ?? ((author) => readProfileFm(author)?.links?.discord || null);
  // SOW-120: the profile's PUBLIC X handle feeds {member-x-handle}.
  const resolveAuthorX = deps.resolveAuthorX ?? ((author) => readProfileFm(author)?.links?.x || null);
  // SOW-122: the profile's PUBLIC Bluesky handle feeds {member-bluesky-handle}.
  const resolveAuthorBluesky = deps.resolveAuthorBluesky ?? ((author) => readProfileFm(author)?.links?.bluesky || null);
  // SOW-123: the profile's PUBLIC Mastodon handle feeds {member-mastodon-handle}.
  const resolveAuthorMastodon = deps.resolveAuthorMastodon ?? ((author) => readProfileFm(author)?.links?.mastodon || null);
  // The profile's PUBLIC Reddit username feeds {member-reddit-handle} (the Reddit first comment credits it).
  const resolveAuthorReddit = deps.resolveAuthorReddit ?? ((author) => readProfileFm(author)?.links?.reddit || null);
  // SOW-140: the profile's PUBLIC dev.to handle feeds {member-devto-handle} (the dev.to byline mention).
  const resolveAuthorDevto = deps.resolveAuthorDevto ?? ((author) => readProfileFm(author)?.links?.devto || null);
  // SOW-014: the from-the-author intro comment for a post/product/prompt. Its id is deterministic
  // (intro-<slug>), and a house item keeps its notes under house/comments/. Only a PUBLIC authorNote:true
  // comment qualifies (a members note must never reach an off-network channel); shares have no intro.
  const resolveAuthorNote = deps.resolveAuthorNote ?? ((item, rel) => {
    if (!item) return null;
    // sow-147 (owner, 2026-08-05): a SHARE's "author comment" IS its markdown body — the text the composer
    // collects under "What are you reading, building, or finding?" and the same field the sow-181 add_share
    // MCP tool writes. Shares carry no intro-comment file, so read the body straight off the share itself.
    if (item.type === 'share') {
      if (item.visibility !== 'public') return null; // a members share body is encrypted; it never syndicates
      try {
        const text = readFile(rel);
        if (text == null) return null;
        const { frontmatter, body } = parseContentFile(text);
        if (frontmatter?.encryptedBody) return null; // belt and braces: a stub carries no plaintext to quote
        return String(body || '').trim() || null;
      } catch { return null; }
    }
    const author = String(item.author || '');
    const slug = String(item.slug || '');
    if (!author || !slug) return null;
    const dir = (author === 'gbti' || author === 'house') ? 'house/comments' : `members/${author}/comments`;
    try {
      const text = readFile(`${dir}/intro-${slug}.md`);
      if (text == null) return null;
      const { frontmatter, body } = parseContentFile(text);
      if (frontmatter?.authorNote !== true) return null;
      if ((frontmatter?.visibility ?? 'public') !== 'public') return null;
      if ((frontmatter?.status ?? 'published') !== 'published') return null;
      return String(body || '').trim() || null;
    } catch { return null; }
  });

  const inputs = [];
  for (const b of built) {
    inputs.push(toQueueInput({
      ...b,
      mention: await resolveMention(b.item.author),
      siteOrigin,
      authorName: resolveAuthorName(b.item.author),
      authorDiscord: resolveAuthorDiscord(b.item.author),
      authorX: resolveAuthorX(b.item.author),
      authorBluesky: resolveAuthorBluesky(b.item.author),
      authorMastodon: resolveAuthorMastodon(b.item.author),
      authorReddit: resolveAuthorReddit(b.item.author),
      authorDevto: resolveAuthorDevto(b.item.author),
      authorNote: resolveAuthorNote(b.item, b.rel),
      moderation,
    }));
  }
  for (const inp of inputs) {
    const notes = [
      inp.url ? '' : ' (members-only, link-less)',
      inp.category ? ` [${inp.category}]` : '',
      inp.flags.length ? ` FLAGGED: ${inp.flags.join(', ')}` : '',
    ].join('');
    console.log(`  -> ${inp.source}: ${inp.targetSlug}${notes}`);
  }

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to enqueue to KV (items then wait for superadmin approval).');
    return { enqueued: 0, inputs };
  }
  const r = await enqueueViaKvRest(inputs, { env, fetchImpl: deps.enqueueFetch ?? fetchImpl });
  if (!r.available) {
    console.error(`✗ --apply needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN (${r.reason})`);
    process.exitCode = 1;
    return { enqueued: 0, inputs };
  }
  console.log(`enqueued ${r.enqueued}/${inputs.length} (pending superadmin approval)`);
  return { enqueued: r.enqueued, inputs, results: r.results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
