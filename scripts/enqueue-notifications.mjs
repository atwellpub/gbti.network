#!/usr/bin/env node
// SOW-186 phase 4 (DELIVERY): the follow-the-author EMAIL fan-out runner, a step in the publish Action
// (.github/workflows/syndicate-content.yml). Given the content files that TRANSITIONED to published in a push, it
// resolves, per published post/product/prompt, the followers who have turned the EMAIL channel on and are
// mailable, and ENQUEUES one eager notification mail issue per item (workers/signup/mail-store.mjs enqueueIssue).
// It SENDS NOTHING: the notification issue is a normal eager issue that the existing */5 Worker drain drains
// behind the same fail-closed send gate, rate budget, suppression re-check and one-click unsubscribe as the
// weekly digest (the drain reads only issueId from an issue and is never touched here).
//
//   node scripts/enqueue-notifications.mjs --added members/alice/posts/x/index.md      # dry-run (no KV write)
//   node scripts/enqueue-notifications.mjs --apply --added <path> [<path> ...]         # resolve + enqueue to KV
//   node scripts/enqueue-notifications.mjs --apply                                     # push mode: diff BEFORE..AFTER
// Requires (for --apply): CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN (the same SIGNUP_KV the Worker drains).
// Needs NO Stripe and NO MAIL_SUPPRESS_KEY: a recipient's mail hash comes from their own member subscriber record
// (mail-subscriber.mjs requires githubId), never recomputed from an address.
//
// WHY THE PUBLISH ACTION (not the drain). Fan-out at publish keeps the drain byte-for-byte unchanged, so the
// notification path cannot weaken a guard the digest path shares (SowMaster's binding condition, 2026-08-22); and
// REST from the Action has no 50-subrequest Worker ceiling. See membership/mail-notify.mjs for the full rationale.
//
// LEAK GUARD: an item is a candidate ONLY when publicUrlFor returns a non-null url (scripts/lib/content-
// syndication.mjs: null for a members-only / Mode A body and for every share). A gated item is never enqueued;
// the issue carries only public metadata (author, name, type, title, url); the renderer reads a fixed allow-list.
//
// FAIL-CLOSED + DORMANT: resolveNotify (membership/notify-resolve.mjs) defaults the email channel OFF, so until a
// member opts in via the settings surface AND has a mailable subscriber record AND the owner opens the send gate
// AND the MAIL_* secrets are provisioned, this resolves to zero recipients. The scale confirms it is safe now:
// OnboardingMaster measured 22 members, 2 mailable, and no email-on preferences exist yet, so a live run today
// enqueues nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { parseContentFile } from '../client/src/content-ops.mjs';
import { buildSyndicationItem, publicUrlFor } from './lib/content-syndication.mjs';
import { reverseMembersIndex } from './lib/discord-mention.mjs';
import { selectPublishedTransitions } from './lib/publish-transitions.mjs';
// erase-member.mjs is the script-lib home for the KV REST shim AND the follows:/prefs: key builders (it already
// re-declares them from the canonical Worker handlers, membership-follows.mjs / membership-prefs.mjs, because
// those pull the Worker runtime graph and cannot be imported into a node script). Importing all three from here
// reuses the shim's dependency graph with no new key-literal duplication.
import { kvRestShim, FOLLOWS_KEY, PREFS_KEY } from './lib/erase-member.mjs';
import { FOLLOWERS_KEY, followerIds } from '../membership/member-followers.mjs';
import { normalizeFollows } from '../membership/member-follows.mjs';
import { normalizePrefs } from '../membership/member-prefs.mjs';
import { MAIL_SUBSCRIBER_PREFIX } from '../membership/mail-suppress.mjs';
import { buildNotificationIssue, selectEmailRecipients, eventForType } from '../membership/mail-notify.mjs';
import { enqueueIssue } from '../workers/signup/mail-store.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const valAfter = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null;
  };
  const ai = argv.indexOf('--added');
  let added = [];
  if (ai >= 0) {
    added = argv.slice(ai + 1)
      .filter((a) => !a.startsWith('--'))
      .flatMap((t) => String(t).split(/[\s,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { apply, added, before: valAfter('--before'), after: valAfter('--after') };
}

/** Load house/members-index.yml into a { github_id: username } map (flat, or under a `members:` key). Mirrors
 *  scripts/enqueue-syndication.mjs (a local copy is intentional: the two runners must not share mutable state). */
function loadMembersIndex(readFile) {
  try {
    const doc = yaml.load(readFile('house/members-index.yml') ?? '') ?? {};
    const map = doc && typeof doc === 'object' && doc.members && typeof doc.members === 'object' ? doc.members : doc;
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

/** The author's display name for the byline: the profile displayName, GBTI Network for house content, else null
 *  (the renderer falls back to the handle). Public metadata only. */
function makeAuthorNameResolver(readFile) {
  const cache = new Map();
  return (author) => {
    const a = String(author || '');
    if (a === 'gbti' || a === 'house') return 'GBTI Network';
    if (!a) return null;
    if (cache.has(a)) return cache.get(a);
    let name = null;
    try {
      const profile = readFile(`members/${a}/profile.md`);
      if (profile != null) name = parseContentFile(profile).frontmatter?.displayName || null;
    } catch { name = null; }
    cache.set(a, name);
    return name;
  };
}

/** Scan mail:subscriber:* once and build a { github_id -> mailHash } map for MEMBER records (source:'member',
 *  which mail-subscriber.mjs requires to carry githubId). This is the github_id -> hash resolution the fan-out
 *  needs; it is also why the anon path (no github_id) gets no follow-notification (correct: an anon subscriber
 *  is not a member and follows no one). The drain re-checks suppression + resolves the address per recipient, so
 *  including a member here is safe even if they later unsubscribe or have no address. */
async function buildMemberHashMap(kv) {
  const map = new Map();
  let cursor;
  for (let page = 0; page < 100000; page++) {
    const res = await kv.list({ prefix: MAIL_SUBSCRIBER_PREFIX, cursor });
    for (const { name } of res.keys ?? []) {
      const rec = await kv.get(name, 'json');
      if (rec && rec.source === 'member' && rec.githubId && rec.hash) map.set(String(rec.githubId), String(rec.hash));
    }
    if (res.list_complete) break;
    cursor = res.cursor;
    if (!cursor) break;
  }
  return map;
}

/** Resolve the mailable, email-opted-in recipient hashes for one published item. Reads the reverse follower
 *  index, then each follower's forward follows (for the per-follow override) and prefs (for the global default),
 *  and filters through the pure selectEmailRecipients (email fail-closed OFF). */
async function resolveRecipients(kv, item, { reverse, hashById }) {
  // reverseMembersIndex returns a Map keyed by the LOWERCASED username (scripts/lib/discord-mention.mjs).
  const authorId = reverse.get(String(item.author).toLowerCase());
  if (!authorId) return { recipients: [], reason: 'author not in members-index (cannot resolve followers)' };
  const fids = followerIds(await kv.get(FOLLOWERS_KEY(String(authorId)), 'json'));
  if (!fids.length) return { recipients: [], reason: 'no followers' };

  const perFollower = [];
  for (const fid of fids) {
    const hash = hashById.get(String(fid));
    if (!hash) continue; // not a mailable member subscriber
    const follows = normalizeFollows(await kv.get(FOLLOWS_KEY(String(fid)), 'json'));
    const entry = follows.following.find((e) => e.username === item.author);
    const followNotify = entry && entry.notify ? entry.notify : undefined;
    const globalNotify = normalizePrefs(await kv.get(PREFS_KEY(String(fid)), 'json')).notify;
    perFollower.push({ githubId: fid, mailHash: hash, followNotify, globalNotify });
  }
  const recipients = selectEmailRecipients(perFollower, { event: item.event, authorId });
  return { recipients, reason: recipients.length ? null : 'no follower has the email channel on' };
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch, deps = {}, now = Date.now } = {}) {
  const { apply, added: argvAdded, before: cliBefore, after: cliAfter } = parseArgs(argv);
  const readFile = deps.readFile ?? ((rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  });
  const siteOrigin = env.SITE_ORIGIN || 'https://gbti.network';

  // Push mode: select the content files that TRANSITIONED to published in this push (mirrors enqueue-syndication).
  // A manual --added / SYNDICATE_ADDED list takes precedence. Fail-closed to [] on any git error or missing baseline.
  let added = argvAdded.length
    ? argvAdded
    : String(env.SYNDICATE_ADDED || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const before = cliBefore ?? env.SYNDICATE_BEFORE;
  const after = cliAfter ?? env.SYNDICATE_AFTER;
  if (!added.length && (before || after)) {
    const select = deps.selectTransitions ?? selectPublishedTransitions;
    added = select({ before, after, root, parseFm: (t) => parseContentFile(t).frontmatter });
  }

  // Build candidate items, LEAK-GATED on publicUrlFor (null for members-only / Mode A and for shares).
  const resolveAuthorName = deps.resolveAuthorName ?? makeAuthorNameResolver(readFile);
  const candidates = [];
  for (const rel of added) {
    const txt = readFile(rel);
    if (txt == null) continue;
    let fm;
    try { fm = parseContentFile(txt).frontmatter; } catch { continue; }
    const item = buildSyndicationItem(rel, fm);
    if (!item) continue;
    if (item.type === 'share') { console.log(`  skip (shares have no email notification): ${rel}`); continue; }
    const url = publicUrlFor(item, siteOrigin);
    if (!url) { console.log(`  skip (members-only / no public page, leak-gated): ${rel}`); continue; }
    const event = eventForType(item.type);
    if (!event) { console.log(`  skip (type "${item.type}" has no notify event): ${rel}`); continue; }
    candidates.push({ ...item, url, event, authorName: resolveAuthorName(item.author) });
  }
  console.log(`enqueue-notifications: ${added.length} changed path(s), ${candidates.length} notifiable item(s)${apply ? '' : ' (dry-run)'}`);
  if (!candidates.length) {
    console.log('Nothing to notify.');
    return { enqueued: 0, notified: 0, items: [] };
  }

  const kv = deps.kv ?? kvRestShim({ env, fetchImpl });
  if (!kv) {
    // No CF creds: report the candidate items but do not (cannot) resolve recipients.
    for (const c of candidates) console.log(`  -> ${c.type}: ${c.author}/${c.slug} "${c.title}" (recipients need CF creds)`);
    if (apply) {
      console.error('✗ --apply needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN');
      process.exitCode = 1;
    }
    return { enqueued: 0, notified: 0, items: candidates.map((c) => ({ author: c.author, slug: c.slug, type: c.type, recipients: null })) };
  }

  const reverse = reverseMembersIndex(loadMembersIndex(readFile));
  const hashById = await buildMemberHashMap(kv);

  let enqueued = 0;
  let notified = 0;
  const items = [];
  for (const c of candidates) {
    const { recipients, reason } = await resolveRecipients(kv, c, { reverse, hashById });
    const issue = buildNotificationIssue({
      type: c.type, author: c.author, slug: c.slug, title: c.title,
      authorName: c.authorName, url: c.url, generatedAt: now(),
    });
    if (!recipients.length) {
      console.log(`  -> ${c.type}: ${c.author}/${c.slug} "${c.title}" -> 0 recipients (${reason})`);
      items.push({ issueId: issue.issueId, author: c.author, slug: c.slug, type: c.type, recipients: 0 });
      continue;
    }
    notified += recipients.length;
    if (apply) {
      const r = await enqueueIssue(kv, issue, recipients, { now });
      enqueued += r.enqueued;
      console.log(`  -> ${c.type}: ${c.author}/${c.slug} "${c.title}" -> enqueued ${r.enqueued}/${recipients.length} recipient(s)`);
    } else {
      console.log(`  -> ${c.type}: ${c.author}/${c.slug} "${c.title}" -> ${recipients.length} recipient(s) (dry-run)`);
    }
    items.push({ issueId: issue.issueId, author: c.author, slug: c.slug, type: c.type, recipients: recipients.length });
  }

  if (!apply) console.log('\nDry-run only. Re-run with --apply to enqueue notification issues to KV.');
  else console.log(`enqueued ${enqueued} send record(s) across ${items.filter((i) => i.recipients).length} issue(s); the drain sends them behind the fail-closed gate.`);
  return { enqueued, notified, items };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
