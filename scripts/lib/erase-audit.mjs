// SOW-024: the erasure AUDIT LOG. When a member is erased, we must be able to evidence compliance (what was
// erased, when, with what outcome) WITHOUT re-introducing the personal data we just deleted. So the record is
// IDENTITY-MINIMAL: the immutable github_id pseudonym + a timestamp + the per-step outcomes + an optional
// operator id. It carries NO username, email, Discord id, or any other personal field (sop-member-erasure.md:
// "Do NOT write the member's personal data into that record or into Git").
//
// It lives in the DELETABLE edge store (Cloudflare KV), NOT git, keyed `erasure-audit:<github_id>:<iso>`, so it
// is retention-bounded and prunable (and a member's own audit record can be deleted after the compliance
// window). Writes via the CF KV REST API, gated behind CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN: a
// reported no-op without them (never a silent success), a throw on a real API error. Pure builder + injectable
// fetch, so it is unit-tested with fakes.

export const AUDIT_KEY = (githubId, iso) => `erasure-audit:${githubId}:${iso}`;

// The only step fields ever recorded. A whitelist (not a passthrough) so a step result can never smuggle a
// personal field (username, email, a Discord id) into the audit record.
const STEP_ALLOWED = ['step', 'outcome', 'detail'];

/** Reduce a raw orchestrator step result to its identity-free audit shape (whitelisted fields only). */
export function sanitizeStep(s = {}) {
  const out = {};
  for (const k of STEP_ALLOWED) if (s[k] !== undefined && s[k] !== null) out[k] = s[k];
  return out;
}

/** complete = every enacted step succeeded; failed = every step errored; partial = a mix. */
export function deriveAuditStatus(steps = []) {
  const enacted = steps.filter((s) => s.outcome !== 'skipped');
  if (enacted.length === 0) return 'noop';
  const errored = enacted.filter((s) => s.outcome === 'error');
  // A step that could not READ part of the keyspace it was scrubbing has not proven those records are gone. It is
  // not an error (it did the work it could see) but it must never total up to `complete`, or the compliance
  // artifact asserts an erasure the run cannot evidence.
  const incomplete = enacted.filter((s) => s.outcome === 'incomplete');
  if (errored.length === 0) return incomplete.length ? 'partial' : 'complete';
  if (errored.length === enacted.length) return 'failed';
  return 'partial';
}

/**
 * Pure: shape the identity-minimal audit record. `steps` are sanitized (whitelisted fields only) so no personal
 * data can leak in even if a caller passes a richer result object.
 */
export function buildAuditRecord({ githubId, operator = null, apply = true, steps = [], now = new Date(), kind = 'erasure-audit' } = {}) {
  if (!githubId) throw new Error('a github_id is required for the audit record');
  const clean = steps.map(sanitizeStep);
  return {
    // sow-212: the test reset writes `test-reset-audit` here. A statutory right-to-erasure and a developer
    // resetting their own test account must never be indistinguishable in the audit log.
    kind,
    githubId: String(githubId),
    at: now.toISOString(),
    operator: operator ? String(operator) : null,
    apply: !!apply,
    steps: clean,
    status: deriveAuditStatus(clean),
  };
}

/** PUT a value to the signup Worker's KV via the Cloudflare REST API. Reported no-op without creds; throws on a
 *  real API error. Mirrors scripts/lib/kv-mirror.mjs. */
async function putKvKey({ key, value, env = process.env, fetchImpl = globalThis.fetch }) {
  const accountId = env.CF_ACCOUNT_ID;
  const namespaceId = env.CF_KV_NAMESPACE_ID;
  const apiToken = env.CF_API_TOKEN;
  if (!accountId || !namespaceId || !apiToken) {
    return { recorded: false, key, reason: 'CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN not set' };
  }
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`;
  const res = await fetchImpl(url, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'text/plain' },
    body: value,
  });
  if (!res || !res.ok) {
    const detail = res && res.text ? await res.text().catch(() => '') : '';
    throw new Error(`audit record write failed: ${res ? res.status : 'no response'} ${String(detail).slice(0, 200)}`);
  }
  return { recorded: true, key };
}

/** Persist one erasure audit record to the deletable edge store. */
export async function storeAuditRecord({ record, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!record?.githubId || !record?.at) throw new Error('an audit record with githubId + at is required');
  return putKvKey({ key: AUDIT_KEY(record.githubId, record.at), value: JSON.stringify(record), env, fetchImpl });
}
