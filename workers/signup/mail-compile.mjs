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
// The FIRST issue's bootstrap window (owner ruling 2026-08-22): 90 days, not 7. The newest member content at
// launch was 18 days old, so a 7-day inaugural window composes to ZERO member items (QAmaster measured 7d = 0,
// 30d = 2, 90d = 7 items), and an empty first issue is the worst first impression for a list nobody has
// unsubscribed from yet. This widens the INAUGURAL issue ONLY; every later issue stays weekly via the rolling
// floor + exclude below, which do not read this constant.
const BOOTSTRAP_MS = 90 * 24 * 3600 * 1000;
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
 *     A bounded, launch-worded issue rather than the newest-N-ever back catalogue. bootstrapMs defaults to
 *     BOOTSTRAP_MS (90 days, owner ruling 2026-08-22) so the inaugural issue is not empty; see the constant.
 *   - THEREAFTER (a prior exists): { firstIssue: false, since: the COUPLED floor, exclude: <mailed urls> }.
 *     The floor drops everything published too long ago to still be excludable; exclude drops what has already
 *     been mailed. Together: mail everything published since the newsletter began that has not been mailed yet,
 *     exactly once however late it arrives. This CLOSES Trap Two (a held or backdated item published DURING the
 *     newsletter's life stays eligible until mailed) WITHOUT re-opening the back-catalogue drain: `since = null`
 *     would make the pool the whole 40-per-type artifact, so issue two would mail the pre-newsletter archive and
 *     walk backwards in time, and the empty-section notes would be unreachable until it drained. A floor cannot
 *     cut off a contribution held for days; only a tight per-issue window could, and this is not one.
 *
 * The floor MUST be coupled to the exclude window or a third trap opens: the floor is time-based and exclude is
 * issue-count-based, so an item can sit ABOVE a fixed epoch floor and OUTSIDE the rolling exclude window at once,
 * and then re-mails on a historyDepth cycle (the product/prompt/share artifacts never turn over, so exclude is the
 * only thing stopping a re-mail, and it expires at historyDepth). So while nothing has aged out of the window the
 * floor is the FIRST issue's launch floor (its recorded `window.since`, the epoch), and the moment an issue ages
 * OUT the floor advances to the COMPILE TIME of the oldest issue still IN the window: anything an aged-out issue
 * mailed was published no later than its compile, hence below this floor. historyDepth stays the single tunable,
 * and there is no separate accumulator to drift: both the mailed set and the floor are read from the frozen
 * issues themselves.
 */
export async function resolveWindow(kv, { nowMs, currentIssueId, bootstrapMs = BOOTSTRAP_MS, historyDepth = 26, pageBudget = 50 } = {}) {
  const priorIds = await listPriorIssueIds(kv, { currentIssueId, pageBudget });
  if (priorIds.length === 0) {
    return { firstIssue: true, since: Number(nowMs) - bootstrapMs, exclude: null };
  }
  const depth = Math.max(1, historyDepth);
  const sorted = priorIds.slice().sort();          // chronological ascending (weekly- sorts as dates)
  const windowIds = sorted.slice(-depth);          // the newest `depth` prior issues (all of them, if fewer)
  const agedOut = sorted.length > depth;           // has any issue fallen OUT of the exclude window?

  const exclude = new Set();
  let oldestInWindowGen = null;
  for (let i = 0; i < windowIds.length; i++) {
    // eslint-disable-next-line no-await-in-loop -- bounded by historyDepth, and this is the weekly compile, not a tick
    const issue = await getIssue(kv, windowIds[i]);
    if (i === 0) oldestInWindowGen = Number(issue?.generatedAt); // windowIds[0] is the OLDEST issue in the window
    const sections = issue?.sections;
    if (!sections) continue;
    for (const key of MEMBER_SECTION_KEYS) {
      for (const item of sections[key] ?? []) {
        const url = typeof item?.url === 'string' ? item.url.trim() : '';
        if (url) exclude.add(url); // news is deliberately NOT excluded (ranked by opens, may re-surface)
      }
    }
  }

  // The floor, COUPLED to the exclude window. The floor is time-based and the exclude set is issue-COUNT-based;
  // uncoupled, an item can be ABOVE a fixed epoch floor and OUTSIDE the rolling exclude window at once, so it is
  // neither floored nor excluded and re-mails on a historyDepth cycle. This bites for real: the product/prompt/
  // share artifacts sit below their 40-per-type cap (or have none), so they never turn over and exclude is the
  // ONLY thing stopping a re-mail. Once an issue has aged OUT of the window, the floor advances to the COMPILE
  // TIME of the oldest issue still IN the window: anything an older, now-excluded issue mailed was published no
  // later than that issue's compile, hence strictly below this floor, so it can neither escape exclude nor clear
  // the floor. While nothing has aged out (exclude still covers every prior issue) the epoch is correct and does
  // not over-floor recent un-mailed launch content. historyDepth stays the single tunable.
  let since;
  if (agedOut && Number.isFinite(oldestInWindowGen)) {
    since = oldestInWindowGen;
  } else {
    since = await resolveEpoch(kv, sorted[0], { nowMs, bootstrapMs });
  }
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
  if (!kv?.list) return { hashes: [], truncated: false, readErrors: 0 };
  const hashes = [];
  let cursor;
  let truncated = true;
  let readErrors = 0;
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
      // getSubscriber now THROWS on an unreadable record (was a swallow-to-null). COUNT it and skip this one hash
      // rather than let a single read blip abort the whole base walk; the caller folds readErrors into the
      // truncated signal, so a frozen issue is never enqueued against a silently short recipient base.
      let sub;
      // eslint-disable-next-line no-await-in-loop -- bounded page, and the reads pipeline within a page below
      try { sub = await getSubscriber(kv, hash); }
      catch { readErrors++; continue; }
      if (sub && canReceive(sub)) hashes.push(hash);
    }
    if (res?.list_complete || !res?.cursor) { truncated = false; break; }
    cursor = res.cursor;
  }
  return { hashes, truncated, readErrors };
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
  historyDepth, // exclude-window depth in issues; undefined -> resolveWindow's default. Also the floor's coupling depth.
  // sow-166 follow-up: an explicit id, used ONLY by the admin rehearsal trigger (membership-admin-mail.mjs).
  // The weekly cron never passes one and keeps the date-derived id. A rehearsal passes a `test-` id, which
  // listPriorIssueIds cannot count, so rehearsing a send does not consume the real inaugural back catalogue.
  issueId: issueIdOverride = null,
} = {}) {
  if (!kv) return { ok: false, reason: 'no kv' };
  const nowMs = Number(now());
  const issueId = String(issueIdOverride || '').trim() || weeklyIssueId(nowMs);

  // Freeze once: if the issue already exists, reuse it (do NOT recompose); otherwise gather + compose + persist.
  let issue = await getIssue(kv, issueId);
  let composed = false;
  if (!issue) {
    const [contentEntries, newsEntries, regime] = await Promise.all([
      gatherContentEntries(env, { fetchImpl, siteUrl }),
      gatherNewsEntries(env, { kv, queryItems }),
      resolveWindow(kv, { nowMs, currentIssueId: issueId, historyDepth }),
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

  const { hashes, truncated, readErrors } = await listRecipientHashes(kv);
  const enq = await enqueueIssue(kv, issue, hashes, { now });

  return {
    ok: true,
    issueId,
    composed,
    recipients: hashes.length,
    enqueued: enq?.enqueued ?? 0,
    pending: enq?.pending ?? 0,
    // A truncated page walk OR any unreadable subscriber record leaves the base silently short; fold both so the
    // cron surfaces one honest "under-sent" signal, and keep the raw read-error count for the log.
    recipientsTruncated: truncated || readErrors > 0, // the caller MUST surface this: a short base under-sends silently otherwise
    recipientReadErrors: readErrors,
    counts: issue?.counts ?? null,
    // The resolved window, surfaced for the cron log. firstIssue: since = launch floor, excluded null. Thereafter:
    // since = the coupled floor (the epoch until an issue ages out of the exclude window, then the compile time of
    // the oldest issue still IN the window) and excluded a count. `since` null on a composed issue would be the
    // forgotten-floor bug (the whole-artifact back-catalogue drain); the frozen issue records both so it is never silent.
    firstIssue: Boolean(issue?.launchNote),
    since: issue?.window?.since ?? null,
    excluded: issue?.window?.excluded ?? null,
  };
}
