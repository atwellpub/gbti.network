// SOW-166: the weekly compile orchestrator (Worker IO). Once a week it gathers the public content + the news,
// calls composeIssue ONCE to freeze a single issue (mail:issue:<issueId>), and enqueues one pending send record
// per subscriber. It sends NOTHING: the drain (on the shared */5 tick, behind the fail-closed send gate) is what
// releases sends. Compile once, drain smoothly (Q12).
//
// PURE CORE, INJECTED IO. The mapping + the issue id live in membership/mail-compile-core.mjs (unit-tested with
// no IO). This module supplies the three gathers (content artifacts over HTTP, news from NEWS_KV + the SOW-111
// open counts, the subscriber base) and orchestrates. Every dep is injectable so the whole orchestrator is
// tested with fakes.
//
// ALWAYS-SEND (owner ruling, 2026-08-21): the compile always composes + enqueues, even a fully-empty week (a
// non-state anyway, since news ingests daily). The gate is shouldSend(issue) from the composer, which returns
// true unconditionally and carries the ruling; keeping it as the gate (rather than deleting it) means the day
// the owner ever wants a skip, it is one honest predicate to change.
//
// FROZEN + IDEMPOTENT. The issue id is the stable weekly-YYYY-MM-DD, so a re-run of the same day's compile finds
// the frozen issue and does not recompose; enqueueIssue is idempotent (it never duplicates or resurrects a
// terminal record), so re-enqueuing only picks up subscribers added since. Content leak safety is composeIssue's
// (visibility === 'public', fail closed); this module only moves already-public metadata.

import { getIssue, putIssue, enqueueIssue, getSubscriber } from './mail-store.mjs';
import { composeIssue, shouldSend } from '../../membership/mail-digest.mjs';
import { normalizeContent, normalizeNews, weeklyIssueId } from '../../membership/mail-compile-core.mjs';
import { canReceive } from '../../membership/mail-subscriber.mjs';
import { MAIL_SUBSCRIBER_PREFIX } from '../../membership/mail-suppress.mjs';
import { queryItems as kvQueryItems } from './news/src/store.mjs';
import { normalizeNewsOpens, distinctOpenerCount } from '../../membership/news-opens.mjs';
import { NEWS_OPENS_KEY } from './membership-news-opened.mjs';

const SITE_URL_DEFAULT = 'https://gbti.network';
const MAIL_ISSUE_PREFIX = 'mail:issue:';
const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * Resolve the content-window lower bound (`since`) for a NEW issue: the generatedAt of the most recent PRIOR
 * frozen issue, so "since the last issue" is literally true and a skipped or delayed week WIDENS the window
 * rather than dropping the intervening content on the floor (composeIssue drops member items with date < since,
 * inclusive boundary). Taking the GREATEST prior issueId (not last-week's computed id) is what makes a MISSED
 * week correct: computing `weekly-<today-7d>` and reading it would miss and fall back to bootstrap in exactly
 * the outage case the anchor exists for.
 *
 * For the very FIRST issue (no prior) it falls back to nowMs - bootstrapMs (default 7 days): a bounded, honest
 * launch window (news-led, and the member sections show their empty-section notes for a quiet first week)
 * rather than dumping the newest-N-ever back catalog. ALWAYS returns a finite number given a finite nowMs (the
 * forgotten-param trap), and the value is echoed on the frozen issue as window.since so a missing window is
 * visible in the artifact, not silent.
 *
 * Enumerates the mail:issue: prefix (one key per week, so a decade of issues fits inside a single KV list
 * page). Considers ONLY ids of the canonical `weekly-YYYY-MM-DD` shape, which sort lexicographically =
 * chronologically, so a hand-seeded or backfilled issue with a foreign id shape can never be mistaken for the
 * prior issue.
 */
export async function resolveSince(kv, { nowMs, currentIssueId, bootstrapMs = WEEK_MS, pageBudget = 50 } = {}) {
  const bootstrap = Number(nowMs) - bootstrapMs;
  if (!kv?.list) return bootstrap;
  let bestId = null;
  let cursor;
  for (let page = 0; page < pageBudget; page++) {
    let res;
    try { res = await kv.list({ prefix: MAIL_ISSUE_PREFIX, cursor }); } catch { break; }
    for (const k of res?.keys ?? []) {
      const id = k.name.slice(MAIL_ISSUE_PREFIX.length);
      if (!id.startsWith('weekly-')) continue;              // only canonical ids sort chronologically
      if (currentIssueId && id >= currentIssueId) continue; // strictly before self; ignores self + any future
      if (bestId == null || id > bestId) bestId = id;
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  if (bestId == null) return bootstrap; // first issue ever
  const prev = await getIssue(kv, bestId);
  const gen = Number(prev?.generatedAt);
  if (Number.isFinite(gen)) return gen;
  // Defensive: a prior issue somehow missing generatedAt. Parse its date (midnight UTC) so a delayed week still
  // widens from the right week boundary rather than collapsing to bootstrap.
  const parsed = Date.parse(`${bestId.slice('weekly-'.length)}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : bootstrap;
}

/**
 * Gather the member content entries from the public build artifacts over HTTP. Fail-SOFT per artifact: a failed
 * or non-OK fetch yields [] for that artifact rather than crashing the compile, because news is guaranteed daily
 * and a degraded member section (its empty-section note) is far better than no issue. Returns the RAW artifact
 * entries (activity-index uses `type` post/product/prompt + visibility; shares-index uses type:'share'); the
 * pure normalizer maps them and composeIssue's guard decides public-vs-member.
 */
export async function gatherContentEntries(env, { fetchImpl = globalThis.fetch, siteUrl } = {}) {
  const base = String(siteUrl || env?.SITE_URL || SITE_URL_DEFAULT).replace(/\/$/, '');
  const one = async (path) => {
    try {
      const res = await fetchImpl(`${base}${path}`, { headers: { accept: 'application/json' } });
      if (!res || !res.ok) return [];
      const body = await res.json();
      return Array.isArray(body?.entries) ? body.entries : [];
    } catch {
      return [];
    }
  };
  const [activity, shares] = await Promise.all([one('/activity-index.json'), one('/shares-index.json')]);
  return [...activity, ...shares];
}

/**
 * Gather recent news items and attach the SOW-111 distinct-opener count to each. News items live in NEWS_KV
 * (fields guid/title/link/source/publishedAt); the open counts live in SIGNUP_KV under news-opens:<guid>. Maps
 * the news store's field names (link -> url, publishedAt -> a ms date) to the normalizer's shape here, so the
 * pure normalizer stays store-agnostic. composeIssue ranks by opens then date and caps the list, so this returns
 * the recent window (default 60), not a pre-ranked slice.
 */
export async function gatherNewsEntries(env, { kv = env?.SIGNUP_KV, queryItems = kvQueryItems, limit = 60 } = {}) {
  if (!env?.NEWS_KV) return [];
  let items = [];
  try {
    const res = await queryItems(env, { limit });
    items = Array.isArray(res?.items) ? res.items : [];
  } catch {
    return [];
  }
  const opensFor = async (guid) => {
    if (!kv || !guid) return 0;
    try {
      const record = normalizeNewsOpens(await kv.get(NEWS_OPENS_KEY(guid), 'json'));
      return distinctOpenerCount(record);
    } catch {
      return 0; // an unreadable open count is 0 (a ranking signal, not a gate): it de-prioritizes, never leaks
    }
  };
  return Promise.all(items.map(async (it) => ({
    title: it?.title,
    url: it?.link,
    source: it?.source,
    date: it?.publishedAt ? new Date(it.publishedAt).valueOf() || 0 : 0,
    opens: await opensFor(it?.guid),
  })));
}

/**
 * Enumerate the subscriber base: every mail:subscriber:<hash> record that canReceive (has a usable address and
 * is not disabled). Returns the recipient hashes. Paginates the KV list so a large base is fully walked; a bound
 * (default 200 pages) is a runaway backstop, and a truncated walk is logged by the caller, never silent.
 */
export async function listRecipientHashes(kv, { pageBudget = 200 } = {}) {
  if (!kv?.list) return { hashes: [], truncated: false };
  const hashes = [];
  let cursor;
  let truncated = true;
  for (let page = 0; page < pageBudget; page++) {
    let res;
    try {
      res = await kv.list({ prefix: MAIL_SUBSCRIBER_PREFIX, cursor });
    } catch {
      break;
    }
    for (const k of res?.keys ?? []) {
      const hash = k.name.slice(MAIL_SUBSCRIBER_PREFIX.length);
      if (!hash) continue;
      // eslint-disable-next-line no-await-in-loop -- bounded page, and the reads pipeline within a page below
      const sub = await getSubscriber(kv, hash);
      if (sub && canReceive(sub)) hashes.push(hash);
    }
    if (res?.list_complete || !res?.cursor) { truncated = false; break; }
    cursor = res.cursor;
  }
  return { hashes, truncated };
}

/**
 * Compile ONE weekly issue and enqueue it to the subscriber base. Idempotent by the frozen issue id. Returns a
 * summary (never throws for a caller: the cron logs whatever comes back).
 */
export async function compileWeeklyIssue(env, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  siteUrl,
  queryItems = kvQueryItems,
  displayName, // optional handle -> display-name resolver (members-index), supplied by a later increment
  perSection,
  maxNews,
} = {}) {
  if (!kv) return { ok: false, reason: 'no kv' };
  const nowMs = Number(now());
  const issueId = weeklyIssueId(nowMs);

  // Freeze once: if the issue already exists, reuse it (do NOT recompose); otherwise gather + compose + persist.
  let issue = await getIssue(kv, issueId);
  let composed = false;
  if (!issue) {
    const [contentEntries, newsEntries, since] = await Promise.all([
      gatherContentEntries(env, { fetchImpl, siteUrl }),
      gatherNewsEntries(env, { kv, queryItems }),
      resolveSince(kv, { nowMs, currentIssueId: issueId }),
    ]);
    const items = normalizeContent(contentEntries, { displayName });
    const news = normalizeNews(newsEntries);
    // The content window (composeIssue `since`, PublicationMaster PR 320) is PART OF THE SECTION CONTRACT, not
    // an optimization: without it every issue re-sends the newest-N-ever best-of and the empty-section notes
    // become unreachable code. KNOWN, ACCEPTED limitation (SOW-166): `since` windows on publishedAt, which the
    // client stamps at PR-open time (operations.mjs), NOT at merge/deploy. So a held-for-review or backdated
    // item that first enters the build artifact AFTER the prior compile is dropped by the window and never
    // mailed. The exact fix ("not previously mailed" via an already-mailed `exclude` set) is a fast-follow
    // GATED BEFORE unrestricted send; the tiny allowlist test launch is unaffected. See the SOW-166 note.
    issue = composeIssue({ issueId, items, news, now }, { perSection, maxNews, since });
    // ALWAYS-SEND: shouldSend is unconditionally true, but gate on it honestly so a future skip is one edit.
    if (!shouldSend(issue)) return { ok: true, issueId, composed: false, skipped: true, reason: 'nothing to send' };
    await putIssue(kv, issue);
    composed = true;
  }

  const { hashes, truncated } = await listRecipientHashes(kv);
  const enq = await enqueueIssue(kv, issue, hashes, { now });

  return {
    ok: true,
    issueId,
    composed,
    recipients: hashes.length,
    enqueued: enq?.enqueued ?? 0,
    pending: enq?.pending ?? 0,
    recipientsTruncated: truncated, // the caller MUST surface this: a truncated base under-sends silently otherwise
    counts: issue?.counts ?? null,
    since: issue?.window?.since ?? null, // the resolved window, surfaced for the cron log; null here is a caller bug
  };
}
