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
const MEMBER_SECTION_KEYS = ['article', 'product', 'prompt', 'share'];

/**
 * The prior frozen issue ids, canonical `weekly-YYYY-MM-DD` shape only, strictly before currentIssueId. Enumerates
 * the mail:issue: prefix (one key per week, so a decade of issues fits inside a single KV list page). The shape
 * filter means a hand-seeded or backfilled issue with a foreign id can never be counted as a prior issue.
 */
async function listPriorIssueIds(kv, { currentIssueId, pageBudget = 50 } = {}) {
  if (!kv?.list) return [];
  const ids = [];
  let cursor;
  for (let page = 0; page < pageBudget; page++) {
    let res;
    try { res = await kv.list({ prefix: MAIL_ISSUE_PREFIX, cursor }); } catch { break; }
    for (const k of res?.keys ?? []) {
      const id = k.name.slice(MAIL_ISSUE_PREFIX.length);
      if (!id.startsWith('weekly-')) continue;              // only canonical ids sort chronologically
      if (currentIssueId && id >= currentIssueId) continue; // strictly before self; ignores self + any future
      ids.push(id);
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return ids;
}

/**
 * Resolve the composeIssue window for a NEW issue. `since` and `exclude` are a FILTER and a FLOOR applied
 * TOGETHER, not alternatives (SowMaster ruling + PublicationMaster correction, 2026-08-21; composeIssue chains
 * both filters):
 *   - FIRST issue (no prior frozen issue): { firstIssue: true, since: nowMs - bootstrapMs, exclude: null }.
 *     A bounded, launch-worded issue rather than the newest-N-ever back catalogue.
 *   - THEREAFTER (a prior exists): { firstIssue: false, since: the newsletter EPOCH, exclude: <mailed urls> }.
 *     The epoch (a floor months in the past) drops everything published BEFORE the newsletter existed; exclude
 *     drops what has already been mailed. Together: mail everything published since the newsletter began that
 *     has not been mailed yet, exactly once however late it arrives. This CLOSES Trap Two (a held or backdated
 *     item published DURING the newsletter's life stays eligible until mailed) WITHOUT re-opening the
 *     back-catalogue drain: `since = null` would make the pool the whole 40-per-type artifact, so issue two
 *     would mail the pre-newsletter archive and walk backwards in time, and the empty-section notes would be
 *     unreachable until it drained. A floor cannot cut off a contribution held for days; only a tight per-issue
 *     window could, and this is not one.
 *
 * The epoch is the FIRST issue's own launch floor, recorded as its `window.since`, so there is no new constant
 * and nothing to tune. The mailed set is the union of member-section item urls across the last `historyDepth`
 * prior issues, derived from the frozen issues themselves so there is no separate accumulator to drift; the
 * bound is safe because the artifact caps at 40 per type, so a url aged out of it can never reappear.
 */
export async function resolveWindow(kv, { nowMs, currentIssueId, bootstrapMs = WEEK_MS, historyDepth = 26, pageBudget = 50 } = {}) {
  const priorIds = await listPriorIssueIds(kv, { currentIssueId, pageBudget });
  if (priorIds.length === 0) {
    return { firstIssue: true, since: Number(nowMs) - bootstrapMs, exclude: null };
  }
  const sorted = priorIds.slice().sort();                       // chronological ascending (weekly- sorts as dates)
  const recent = sorted.slice(-Math.max(1, historyDepth)).reverse(); // the newest `historyDepth`, newest-first
  const exclude = new Set();
  for (const id of recent) {
    // eslint-disable-next-line no-await-in-loop -- bounded by historyDepth, and this is the weekly compile, not a tick
    const issue = await getIssue(kv, id);
    const sections = issue?.sections;
    if (!sections) continue;
    for (const key of MEMBER_SECTION_KEYS) {
      for (const item of sections[key] ?? []) {
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        if (url) exclude.add(url); // news is deliberately NOT excluded (ranked by opens, may re-surface)
      }
    }
  }
  const since = await resolveEpoch(kv, sorted[0], { nowMs, bootstrapMs });
  return { firstIssue: false, since, exclude };
}

/**
 * The newsletter EPOCH: the first issue's launch floor. It is that issue's recorded `window.since` (the oldest
 * frozen issue is always a first issue, composed with firstIssue:true, so it always carries a finite one, even
 * across a transition where later issues were composed with a null since). Defensive fallback for a legacy or
 * hand-seeded first issue with no recorded floor: its own date at midnight UTC, so a pre-newsletter item is
 * still floored; last-ditch a week-ago floor if even the id will not parse.
 */
async function resolveEpoch(kv, oldestId, { nowMs, bootstrapMs }) {
  const first = await getIssue(kv, oldestId);
  const recorded = Number(first?.window?.since);
  if (Number.isFinite(recorded)) return recorded;
  const parsed = Date.parse(`${String(oldestId).slice('weekly-'.length)}T00:00:00Z`);
  return Number.isFinite(parsed) ? parsed : Number(nowMs) - bootstrapMs;
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
    const [contentEntries, newsEntries, regime] = await Promise.all([
      gatherContentEntries(env, { fetchImpl, siteUrl }),
      gatherNewsEntries(env, { kv, queryItems }),
      resolveWindow(kv, { nowMs, currentIssueId: issueId }),
    ]);
    const items = normalizeContent(contentEntries, { displayName });
    const news = normalizeNews(newsEntries);
    // The window is PART OF THE SECTION CONTRACT (composeIssue, PR 320/321), not an optimization: without it
    // every issue re-sends the newest-N-ever best-of and the empty-section notes become unreachable. `since`
    // and `exclude` are TWO REGIMES (SowMaster ruling): the FIRST issue bounds by a launch window (since), and
    // every issue after excludes the already-mailed urls (exclude). The exclude regime CLOSES the Trap Two
    // loss: a held-for-review contribution or a backdated item stays eligible until it has actually been mailed,
    // instead of being dropped by a publishedAt window it predates. resolveWindow returns exactly one regime.
    issue = composeIssue({ issueId, items, news, now }, {
      perSection, maxNews, since: regime.since, exclude: regime.exclude, firstIssue: regime.firstIssue,
    });
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
    // The resolved window, surfaced for the cron log. firstIssue: since = launch floor, excluded null. Thereafter:
    // since = the newsletter epoch, excluded a count. `since` null on a composed issue would be the forgotten-floor
    // bug (the whole-artifact back-catalogue drain); the frozen issue's window records both so it is never silent.
    firstIssue: Boolean(issue?.launchNote),
    since: issue?.window?.since ?? null,
    excluded: issue?.window?.excluded ?? null,
  };
}
