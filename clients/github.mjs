// Thin GitHub REST client for the PR-gate (read PR metadata, set the required status + label) and
// the reconcile (open + merge content status-flip PRs). Injectable fetch. The gate uses ONLY the
// read + status + label methods and NEVER checks out PR code (pull_request_target safety).

export class GitHubError extends Error {
  constructor(status, body) {
    super(`github error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

/** Default sleep for the merge retry. Injectable so tests do not actually wait. */
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * sow-198: is this merge failure worth retrying?
 *
 * GitHub computes PR mergeability ASYNCHRONOUSLY. When a PR is opened seconds after its own base moved,
 * a merge call can arrive before that computation settles and is answered `405 Base branch was modified`.
 * That is the failure that killed the 2026-08-08 reconcile run: it merged PR #256, then opened #257 off
 * the four-second-old tip, and the merge was refused. The identical merge succeeded twenty seconds later.
 *
 * Deliberately NARROW. A 405 for a draft PR or a genuine conflict is a real refusal and must fail fast,
 * because the PR-gate's fail-open-safe handling (scripts/pr-gate.mjs) reports those correctly today and
 * should not be slowed down by a pointless retry loop. Only the documented transient message, plus the
 * usual rate-limit and server-side classes, are retried.
 */
export function isRetryableMergeError(err) {
  if (!(err instanceof GitHubError)) return false;
  if (err.status === 429 || err.status >= 500) return true;
  return err.status === 405 && /Base branch was modified/i.test(String(err.body ?? ''));
}

export function createGitHubClient({ token, repo, fetch = globalThis.fetch, baseUrl = 'https://api.github.com', sleep = defaultSleep }) {
  if (!token) throw new Error('createGitHubClient: token is required');
  if (!repo) throw new Error('createGitHubClient: repo ("owner/name") is required');

  async function req(method, path, body) {
    const res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'gbti-network-controller',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (!res.ok) throw new GitHubError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  return {
    _req: req,

    // ---- PR-gate reads (metadata only) ----
    getPull(number) {
      return req('GET', `/repos/${repo}/pulls/${number}`);
    },
    /** Changed file paths only. Paginates so large PRs are fully classified. */
    async listPullFilePaths(number) {
      const paths = [];
      for (let page = 1; ; page++) {
        const batch = await req('GET', `/repos/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
        if (!batch?.length) break;
        for (const f of batch) paths.push(f.filename);
        if (batch.length < 100) break;
      }
      return paths;
    },
    /** All reviews on a PR (metadata: user.id, state, commit_id). Paginates. Used to read owner approval. */
    async listReviews(number) {
      const reviews = [];
      for (let page = 1; ; page++) {
        const batch = await req('GET', `/repos/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`);
        if (!batch?.length) break;
        for (const r of batch) reviews.push(r);
        if (batch.length < 100) break;
      }
      return reviews;
    },

    // ---- required status check + label ----
    setStatus(sha, { state, context, description, targetUrl }) {
      return req('POST', `/repos/${repo}/statuses/${sha}`, {
        state, // success | failure | pending | error
        context,
        description: description?.slice(0, 140),
        ...(targetUrl ? { target_url: targetUrl } : {}),
      });
    },
    setLabels(number, labels) {
      return req('PUT', `/repos/${repo}/issues/${number}/labels`, { labels });
    },
    /** SOW-053: ADD labels without removing existing ones (PUT/setLabels replaces; this keeps the gate label). */
    addLabels(number, labels) {
      return req('POST', `/repos/${repo}/issues/${number}/labels`, { labels });
    },
    /** SOW-053: post a comment on a PR (issues endpoint). */
    comment(number, body) {
      return req('POST', `/repos/${repo}/issues/${number}/comments`, { body });
    },
    /** SOW-053: open PRs (metadata; the list endpoint omits mergeable_state, so the caller getPull()s each). */
    listOpenPulls() {
      return req('GET', `/repos/${repo}/pulls?state=open&per_page=100`);
    },
    /** Post an optional comment, then close the PR. Used to auto-reject non-member PRs with a nudge. */
    async closePull(number, { comment } = {}) {
      if (comment) await req('POST', `/repos/${repo}/issues/${number}/comments`, { body: comment });
      return req('PATCH', `/repos/${repo}/pulls/${number}`, { state: 'closed' });
    },

    // ---- reconcile content flips (open + merge a status-change PR) ----
    getRef(ref) {
      return req('GET', `/repos/${repo}/git/ref/${ref}`);
    },
    createRef(branch, sha) {
      return req('POST', `/repos/${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
    },
    /** Delete a branch ref. Used by the SOW-035 E2E cleanup to scrub a test branch after closing its PR. */
    deleteRef(branch) {
      return req('DELETE', `/repos/${repo}/git/refs/heads/${branch}`);
    },
    getContent(path, ref) {
      const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
      return req('GET', `/repos/${repo}/contents/${path}${q}`);
    },
    putContent(path, { message, content, branch, sha }) {
      return req('PUT', `/repos/${repo}/contents/${path}`, {
        message,
        content, // base64
        branch,
        ...(sha ? { sha } : {}),
      });
    },
    createPull({ title, head, base, body, draft = false }) {
      // draft: a GitHub draft PR cannot auto-merge, so the SOW-035 E2E authoring cycle opens drafts to avoid any
      // race with the gate's auto-merge before it scrubs the PR.
      return req('POST', `/repos/${repo}/pulls`, { title, head, base, body, draft });
    },
    /**
     * Squash-merge a PR, retrying the transient merge race (sow-198). See isRetryableMergeError for why
     * this is needed and why it is narrow.
     *
     * Between attempts we ask whether the merge ALREADY LANDED, which matters twice over. A lost response
     * to a merge that actually succeeded would otherwise be retried into a spurious failure. And it is how
     * we notice a CONCURRENT merge by the PR-gate: the gate auto-merges every bot PR on its own
     * `pull_request_target` run, so on 2026-08-08 it landed #257 twenty seconds after we had given up on
     * it. An already-merged PR is a success, not an error, and reporting it as one is what made a run that
     * had done its work exit 1.
     *
     * Four attempts with linear backoff (2s, 4s, 6s), so at most about twelve extra seconds.
     */
    async mergePull(number, { method = 'squash', attempts = 4, delayMs = 2000 } = {}) {
      for (let attempt = 1; ; attempt++) {
        try {
          return await req('PUT', `/repos/${repo}/pulls/${number}/merge`, { merge_method: method });
        } catch (err) {
          if (attempt >= attempts || !isRetryableMergeError(err)) throw err;
          // Did it land anyway (a lost response, or the gate merging it concurrently)? Treat that as success.
          // A failed lookup must NOT mask the original error, so we swallow only the lookup itself.
          let pull = null;
          try { pull = await req('GET', `/repos/${repo}/pulls/${number}`); } catch { pull = null; }
          if (pull?.merged) return { merged: true, sha: pull.merge_commit_sha ?? null, alreadyMerged: true };
          await sleep(delayMs * attempt);
        }
      }
    },
  };
}
