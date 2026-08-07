// SOW-015: mirror the git-native override files (bans / roles / grandfathered) into the signup Worker's
// SIGNUP_KV namespace, so GET /membership/key can apply ban > staff > grandfather SERVER-SIDE (it cannot read
// the repo at request time, and it must not trust the client to apply the ban). The reconcile calls this on
// each --apply run; the Worker reads the blob (overrides:mirror) and fails closed if it is missing or stale.
//
// Writes via the Cloudflare KV REST API, gated behind CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN. If
// those are not set (local dry-runs, tests), it is a no-op that reports the reason. Injected fetch for tests.

import { toSyndicationMirror } from '../../membership/syndication-config.mjs';
import { toTopicsMirror, TOPICS_MIRROR_KEY } from '../../membership/topics-vocab.mjs';
import { toCouponsMirror, COUPONS_MIRROR_KEY } from '../../membership/coupons.mjs';

export const OVERRIDES_KV_KEY = 'overrides:mirror';
export const SYNDICATION_KV_KEY = 'synd:config';
export const CONTENT_CHANNELS_KV_KEY = 'synd:channels'; // SOW-087: house/content-channels.yml
export const TOPICS_KV_KEY = TOPICS_MIRROR_KEY; // SOW-087: house/topics.yml (the share category suggester)
export const COUPONS_KV_KEY = COUPONS_MIRROR_KEY; // SOW-119: house/coupons.yml (signup coupon validation)

/** Build the compact mirror blob the Worker reads. Stores the RAW parsed YAML (the Worker rebuilds Maps). */
export function buildOverridesMirror(raw, now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    roles: raw?.roles ?? {},
    bans: raw?.bans ?? {},
    grandfathered: raw?.grandfathered ?? {},
  };
}

/**
 * PUT the mirror to Cloudflare KV. Returns { written, key, bytes, reason }. Throws only on a real API error
 * (so the reconcile can fail the run); a missing-credentials situation is a reported no-op, not a throw.
 */
export async function mirrorOverridesToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = OVERRIDES_KV_KEY } = {}) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  const blob = buildOverridesMirror(raw, now);
  const body = JSON.stringify(blob);
  if (!accountId || !namespaceId || !apiToken) {
    return { written: false, key, bytes: body.length, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
    body,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`KV mirror write failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { written: true, key, bytes: body.length };
}

/**
 * SOW-058: PUT the secret-free syndication config mirror (toSyndicationMirror: { enabled, require_approval,
 * hold_minutes, upvote_threshold, channels }) to KV key synd:config, so the Worker drain reads the live
 * house/syndication-config.yml WITHOUT a redeploy. `raw` is the parsed YAML; toSyndicationMirror normalizes it.
 * Same REST + creds-gated no-op pattern as the overrides mirror; throws only on a real API error.
 */
export async function mirrorSyndicationConfigToKv({ raw, env = process.env, fetchImpl = globalThis.fetch, key = SYNDICATION_KV_KEY } = {}) {
  return putKvJson({ label: 'syndication config', body: JSON.stringify(toSyndicationMirror(raw ?? {})), env, fetchImpl, key });
}

/** Shared creds-gated KV REST PUT (the overrides-mirror pattern). Throws only on a real API error. */
export async function putKvJson({ label, body, env = process.env, fetchImpl = globalThis.fetch, key }) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { written: false, key, bytes: body.length, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
    body,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`${label} mirror write failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { written: true, key, bytes: body.length };
}

/** SOW-087: the category -> Discord-channel map mirror ({ generatedAt, channels }). `raw` is parsed YAML. */
export function buildContentChannelsMirror(raw, now = new Date()) {
  return { generatedAt: now.toISOString(), channels: Array.isArray(raw?.channels) ? raw.channels : [] };
}

/** SOW-087: PUT house/content-channels.yml -> KV synd:channels, so the drain routes category posts live. */
export async function mirrorContentChannelsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = CONTENT_CHANNELS_KV_KEY } = {}) {
  return putKvJson({ label: 'content channels', body: JSON.stringify(buildContentChannelsMirror(raw, now)), env, fetchImpl, key });
}

/** SOW-087: PUT house/topics.yml -> KV topics:vocab, so the Worker's share category suggester sees the live vocabulary. */
export async function mirrorTopicsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = TOPICS_KV_KEY } = {}) {
  return putKvJson({ label: 'topics vocabulary', body: JSON.stringify(toTopicsMirror(raw, () => now.toISOString())), env, fetchImpl, key });
}

/** SOW-119: PUT house/coupons.yml -> KV coupons:config, so signup validates coupon codes against live values. */
export async function mirrorCouponsToKv({ raw, env = process.env, now = new Date(), fetchImpl = globalThis.fetch, key = COUPONS_KV_KEY } = {}) {
  return putKvJson({ label: 'coupons', body: JSON.stringify(toCouponsMirror(raw, now)), env, fetchImpl, key });
}
