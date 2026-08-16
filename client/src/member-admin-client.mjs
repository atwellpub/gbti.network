// SOW-038 P2: the client read path for the admin per-member Stripe-status map, via the signup Worker's
// GET /membership/admin/statuses. Mirrors member-follows-client.mjs: a thin, injectable-fetch wrapper that sends
// the GitHub bearer token. The Worker is the authority (admin-gated, fail-closed); this just relays. Unit-tested
// with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class AdminClientError extends Error {}

/**
 * The Stripe roster maps for the superadmin dashboard. Admin-only (the Worker enforces it). Returns
 * { statuses: { github_id -> stripe status }, tiers: { github_id -> tier }, logins: { github_id -> github_login },
 * pendingGrants: { github_id -> { code, until, tier } } }. `logins` feeds the SOW-091 username fallback;
 * `tiers` is the live Stripe tier (sow-229); `pendingGrants` are coupon redemptions in KV that reconcile has
 * not yet folded into git (sow-229, a display annotation only).
 */
export async function getRosterStatuses({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/admin/statuses', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `admin statuses request failed (${res.status})`);
  return { statuses: data?.statuses ?? {}, tiers: data?.tiers ?? {}, logins: data?.logins ?? {}, pendingGrants: data?.pendingGrants ?? {} };
}

/** SOW-100: the guild's Discord channels (id, name, type, parentId) for the categories workspace.
 *  Admin-only (the Worker enforces it; KV-cached an hour server-side). */
export async function getDiscordChannels({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/discord-channels', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `discord channels request failed (${res.status})`);
  return data?.channels ?? [];
}

/** SOW-038 P3: trigger an allow-listed superadmin operation (reconcile / e2e) via the Worker's
 *  POST /membership/admin/ops. Admin-only (the Worker re-checks + holds the dispatch token). Returns
 *  { ok, triggered } or throws AdminClientError. */
export async function triggerAdminOp({ token, signupBase, fetch = globalThis.fetch, action, params }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/admin/ops', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(params ? { action, params } : { action }), // SOW-055: category-migrate carries params
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `operation failed (${res.status})`);
  return data;
}

/** SOW-119: per-coupon usage (counts + redemption records), admin-gated. Sharing needs no server state
 *  since the 2026-07-18 QA feedback: the share URL is the plain visible /codeable-invite/?coupon=<CODE>. */
export async function getCouponUsage({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/admin/coupon-usage', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `coupon usage request failed (${res.status})`);
  return { usage: data?.usage ?? {}, configFresh: data?.configFresh ?? false };
}

/** SOW-058: the superadmin syndication queue (admin-gated read) -> { pending, sent, cancelled, failed }. */
export async function getSyndicationQueue({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/syndication', { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndication queue request failed (${res.status})`);
  return data;
}

/** SOW-088: the Manually Syndicate readiness read (destinations + templates + channel map; SUPERADMIN only). */
export async function getSyndicateNow({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/syndicate-now', { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndicate-now info failed (${res.status})`);
  return data;
}

/** SOW-088: post one item to one destination NOW (SUPERADMIN only; the Worker renders + sanitizes the template). */
export async function syndicateNow({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/syndicate-now', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ destination, item, template, channelId, forwardChannelId, redditKind, bodyTemplate, commentTemplate, devtoIntroTemplate, devtoFooterTemplate, devtoStubTemplate, devtoDraft }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `syndicate-now failed (${res.status})`);
  return data;
}

/** SOW-058: cancel/reject a pending or approved syndication item (SUPERADMIN only; the Worker enforces it). */
export async function cancelSyndication({ id, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/syndication/cancel', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `cancel request failed (${res.status})`);
  return data;
}

/** SOW-058: approve a pending syndication item (SUPERADMIN only) so the drain posts it to every enabled channel. */
export async function approveSyndication({ id, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/syndication/approve', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `approve request failed (${res.status})`);
  return data;
}

/** SOW-121: the superadmin Social Queue read (manual-assist tasks: pending + done). */
export async function getSocialQueue({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/social-queue', { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `social queue request failed (${res.status})`);
  return data;
}

/** SOW-121: mark a manual-assist task done or delete it (SUPERADMIN only; the Worker enforces). */
export async function socialQueueAction({ action, id, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new AdminClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/social-queue', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new AdminClientError(data?.message || data?.error || `social queue action failed (${res.status})`);
  return data;
}
