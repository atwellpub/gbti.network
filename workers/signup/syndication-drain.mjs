// SOW-058: the cron drain. Every tick: read the config, list items past the one-hour hold, and post each to every
// READY channel (config-enabled + secrets present), recording per-channel results. Idempotent: a channel already
// "sent" is never re-posted (channelDone), a cron overlap is guarded by a fresh re-read + claim, and a late cancel
// is honored because the item is re-read immediately before posting. A failed channel is retried next tick up to
// MAX_DRAIN_ATTEMPTS, then the item is marked failed. Pure over an injected kv/now/fetch/adapters (unit-tested).

import { markClaimed, markSent, markFailed, recordChannel, channelDone, isDue, channelDue } from '../../membership/syndication-queue.mjs';
import { resolveAdapterRun } from '../../membership/syndication-adapters.mjs';
import { isSyndicationEnabled, requiresApproval, isAutoOn, autoModeFor, channelHoldMs, explicitChannelHoldMs, MATRIX_CHANNELS, channelCapability } from '../../membership/syndication-config-core.mjs';
import { renderChannelText } from '../../membership/syndication-render.mjs'; // SOW-121
import { buildSocialTask } from '../../membership/social-queue.mjs'; // SOW-121
import { putTask } from './social-queue-store.mjs'; // SOW-121
import { readSyndicationConfig, readContentChannels, getItem, putItem, listDue, removeFromPending } from './syndication-store.mjs';
import { resolveGuildMention } from './membership-syndicate-now.mjs'; // SOW-088: a real author mention for the auto path

export async function drainSyndication(env, {
  kv = env?.SIGNUP_KV,
  now = Date.now,
  fetchImpl = globalThis.fetch,
  limit = null,
  adapters = null,
  maxAttempts = 5,
} = {}) {
  if (!kv) return { drained: 0, reason: 'no kv' };
  const cfg = await readSyndicationConfig(kv);
  if (!isSyndicationEnabled(cfg)) return { drained: 0, reason: 'disabled' };

  const cap = Number(limit ?? env?.MAX_DRAIN_PER_TICK ?? 10);
  // SOW-058: with require_approval (the default), ONLY superadmin-approved items are due; a pending item never posts.
  const requireApproval = requiresApproval(cfg);
  const due = await listDue(kv, { now, limit: cap, requireApproval });
  // SOW-087: the category -> channel map feeds the discord-category adapter (null = category posts no-op).
  const channelMap = await readContentChannels(kv);
  const { ready, skipped } = resolveAdapterRun({ cfg, env, adapters, fetchImpl, channelMap });
  // The channels this ITEM hands to the Social Queue: a normal trigger delivers every `on-manual` cell
  // (any capability; the owner's per-channel moderation gate); a `popular` promotion delivers its `popular`
  // cells on manual-capability channels only (an auto-capability popular cell posts via its adapter).
  const manualTaskOn = (item, ch) => (item?.trigger === 'popular'
    ? autoModeFor(cfg, item.source, ch) === 'popular' && channelCapability(ch) === 'manual'
    : autoModeFor(cfg, item.source, ch) === 'on-manual');
  // The channels the manual loop VISITS for this item: every manual-capability channel (so an off/popular
  // cell still records its terminal skip, exactly as before) plus any auto-capability channel routed
  // `on-manual` for this item's type.
  const manualCandidates = (item) => MATRIX_CHANNELS.filter((ch) => channelCapability(ch) === 'manual'
    || autoModeFor(cfg, item.source, ch) === 'on-manual');

  let sent = 0;
  let failed = 0;
  // SOW-125: a `ready` adapter is auto-`on` for THIS item's type. A `ready` channel set to off/popular for the
  // type is recorded as a terminal skip (never posts). A per-channel hold that has not elapsed leaves the channel
  // HOLDING for a later tick. The `channelHoldMs` is read from the LIVE config, so a mid-flight hold change applies.
  // SOW-126: the trigger decides which cells deliver, EXCLUSIVELY. A `popular`-promoted item delivers ONLY to
  // its `popular` channels (never the `on` ones), so a promotion can never re-post to or resurrect an `on`
  // channel; a plain publish delivers ONLY to its `on` channels (never a `popular` one). This keeps the two
  // syndications of one piece of content strictly separate.
  const onFor = (item, name) => (item?.trigger === 'popular'
    ? autoModeFor(cfg, item.source, name) === 'popular'
    : isAutoOn(cfg, item.source, name));
  // SOW-125: the per-channel hold is mode-aware. In the APPROVAL model an approved item posts "now" (an explicit
  // override still staggers from approval, but a no-override channel is 0 -> the next tick); in auto-hold mode the
  // delay is the override or the global hold. `channelDue` uses the approvedAt baseline, so these compose.
  const holdForChannel = (item, name) => (item.approvedAt ? explicitChannelHoldMs(cfg, name) : channelHoldMs(cfg, name));
  const chDue = (item, name, nowMs) => channelDue(item, nowMs, holdForChannel(item, name));
  for (const stale of due) {
    // Fresh read to honor a cancel that landed since the list snapshot, and to claim against a cron overlap.
    // isDue re-checks eligibility on the fresh item (SOW-087: an approved FLAGGED item is due even when
    // require_approval is off, so a plain status compare would wrongly skip it).
    let item = await getItem(kv, stale.id);
    if (!item || !isDue(item, Number(now()), { requireApproval })) continue; // never post an unapproved/cancelled item

    // SOW-125: what still needs doing this tick? A FULLY-SETTLED item (every matrix-on ready channel already
    // sent/skipped) must still be claimed so it TERMINALIZES (it may have finished its last channel on a prior
    // tick and only needs markSent). Otherwise, if nothing is actionable and some on-channels are merely HOLDING
    // for their per-channel delay, skip the item WITHOUT claiming or burning an attempt (so a long-delayed
    // channel does not exhaust maxAttempts while it waits).
    const nowMs0 = Number(now());
    const fullySettled = !ready.some((a) => onFor(item, a.name) && !channelDone(item, a.name));
    const hasPostable = ready.some((a) => !channelDone(item, a.name) && onFor(item, a.name) && chDue(item, a.name, nowMs0));
    const hasMatrixOff = ready.some((a) => !channelDone(item, a.name) && !onFor(item, a.name));
    const hasUnconfigured = skipped.some((name) => !channelDone(item, name));
    const hasManual = manualCandidates(item).some((ch) => !item.perChannel?.[ch]); // a task to create, or a terminal skip to record
    if (!fullySettled && !hasPostable && !hasMatrixOff && !hasUnconfigured && !hasManual) continue; // all remaining channels are holding

    item = markClaimed(item, { now });
    item = { ...item, attempts: (item.attempts || 0) + 1 };
    await putItem(kv, item);

    let anyFail = false; // SOW-125: a channel (auto OR a manual-assist task write) that failed retryably this tick

    // Record config-enabled-but-unconfigured channels as skipped (not failed). An ON-MANUAL channel is
    // exempt: its Social Queue review task needs NO adapter secrets (Copy/Assist/done work without them,
    // and the queue's Post now answers not-configured on its own), so it falls through to the task loop.
    for (const name of skipped) {
      if (manualTaskOn(item, name)) continue;
      if (!channelDone(item, name)) item = recordChannel(item, name, { status: 'skipped', reason: 'not configured', at: Number(now()) });
    }

    // SOW-121 + SOW-125: the Social Queue loop. A manual-capability channel (x, linkedin) NEVER auto-posts;
    // its deliverable cell (`on-manual`, incl. a coerced legacy `on`) enqueues a Social Queue task a
    // superadmin posts by hand. An AUTO-capability channel routed `on-manual` enqueues the same task for
    // review (the queue's Post now sends it through the adapter). A candidate whose cell does not deliver
    // for this item's type/trigger records a terminal skip so the tracker stays truthful. A 'queued-manual'
    // marker means ZERO API calls happened. Fail-soft: a task write miss retries next tick.
    for (const ch of manualCandidates(item)) {
      if (item.perChannel?.[ch]) continue; // already tasked/marked on a prior tick
      if (!manualTaskOn(item, ch)) { item = recordChannel(item, ch, { status: 'skipped', reason: 'auto-off', at: Number(now()) }); continue; }
      try {
        // A manual-capability channel keeps its channel-only template chain (X/LinkedIn are whole-message
        // channels with explicit templates); an AUTO channel routed on-manual also falls back to the SHARED
        // templates, so the reviewed text tracks what the automatic path would have posted.
        const text = renderChannelText(cfg, item, ch, { channelOnly: channelCapability(ch) === 'manual' });
        await putTask(kv, buildSocialTask({ item, channel: ch, text, trigger: 'auto', now: Number(now()) }));
        item = recordChannel(item, ch, { status: 'queued-manual', at: Number(now()) });
      } catch {
        // SOW-125: the task write (or render) failed. Mark the item as having a retryable failure so it is NOT
        // falsely terminalized 'sent' with the manual task lost (the settlement below only inspects the auto
        // `ready` channels). It stays pending, the task write retries next tick, and a persistent failure
        // terminalizes via maxAttempts instead of looping forever.
        anyFail = true;
      }
    }

    // SOW-088: a REAL author mention for the auto path too. The CI enqueue's DISCORD_MENTION_OVERRIDES map
    // wins when present; otherwise the guild member search resolves it (fail-soft to the text fallback).
    if (!item.mention) {
      const mention = await resolveGuildMention(env, item, { fetchImpl });
      if (mention) item = { ...item, mention };
    }

    let holding = false; // SOW-125: an on-channel whose per-channel hold has not elapsed yet (retry, do not fail)
    for (const adapter of ready) {
      if (channelDone(item, adapter.name)) continue; // already sent/skipped on a prior tick; never re-post
      // SOW-125 matrix gate: a channel set to off/popular for this item's type is a terminal skip (never posts).
      // An ON-MANUAL channel is NOT stamped here: it belongs to the Social Queue loop above, and its only way
      // to be un-recorded at this point is a FAILED task write, which must retry next tick (a terminal
      // auto-off stamp would kill that retry and misreport a cell the owner set on-manual).
      if (!onFor(item, adapter.name)) {
        if (!manualTaskOn(item, adapter.name)) item = recordChannel(item, adapter.name, { status: 'skipped', reason: 'auto-off', at: Number(now()) });
        continue;
      }
      // SOW-125 per-channel delay: not yet past this channel's hold -> leave it for a later tick (never recorded).
      if (!chDue(item, adapter.name, Number(now()))) { holding = true; continue; }
      let result;
      try {
        result = await adapter.post(item);
      } catch (e) {
        result = { ok: false, error: String(e?.message || e) };
      }
      if (result?.ok && result.skipped) {
        // SOW-087: a clean per-item no-op (e.g. no category channel mapped). Terminal, never retried.
        item = recordChannel(item, adapter.name, { status: 'skipped', reason: result.reason || 'skipped', at: Number(now()) });
      } else if (result?.ok) {
        // An adapter may report a fail-soft SIDE result alongside a successful post (reddit's first comment,
        // reddit.mjs). It never un-sends the post, but dropping it made a failed comment invisible in the
        // tracker, so carry it onto the per-channel record.
        item = recordChannel(item, adapter.name, {
          status: 'sent',
          id: result.id || null,
          url: result.url || null,
          ...(result.comment ? { comment: result.comment } : {}),
          at: Number(now()),
        });
      } else {
        anyFail = true;
        item = recordChannel(item, adapter.name, { status: 'failed', error: result?.error || 'post failed', at: Number(now()) });
      }
    }

    // SOW-125: the item is fully settled only when every on-channel is terminal (sent/skipped). A HOLDING channel
    // (its per-channel delay has not elapsed) keeps the item pending for a later tick and is NOT a failure. A
    // failed channel retries until maxAttempts. Priority: holding > fail-retry > success/fail-terminal.
    const unsettled = ready.some((a) => onFor(item, a.name) && !channelDone(item, a.name));
    if (!unsettled && !anyFail) {
      item = markSent(item, { now });
      await putItem(kv, item);
      await removeFromPending(kv, item.id);
      sent++;
    } else if (holding) {
      // At least one on-channel is still waiting for its delay: retry next tick, clear the claim so it can be
      // re-claimed (and re-cancelled). Do NOT count this against maxAttempts (the wait is not a failure).
      item = { ...item, claimedAt: null };
      await putItem(kv, item);
    } else if ((item.attempts || 0) >= maxAttempts) {
      item = markFailed(item, { now });
      await putItem(kv, item);
      await removeFromPending(kv, item.id);
      failed++;
    } else {
      // A retryable channel failure: leave pending, clear the claim.
      item = { ...item, claimedAt: null };
      await putItem(kv, item);
    }
  }

  return { drained: sent, failed, due: due.length, ready: ready.map((a) => a.name), skipped };
}
