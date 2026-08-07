// Build-time git provenance for a content file. The public content repo IS the database, so a post's
// "who built this, in what commits and PRs" is just the git log of its file. Read it once at build with
// `git log` (no API, no token, no stored history). Degrades to an empty list when git is unavailable
// (e.g. a shallow CI clone) or the file is not yet committed, so the UI simply renders nothing.
import { execFileSync } from 'node:child_process';

export const REPO_URL = 'https://github.com/gbti-network/gbti.network';

export interface FileCommit {
  hash: string;
  authorName: string;
  authorLogin: string | null; // parsed from a GitHub noreply email when possible
  date: string; // YYYY-MM-DD
  subject: string;
  pr: number | null; // parsed from "(#123)" or "Merge pull request #123"
  add: number; // lines added to THIS file in the commit (from --numstat)
  del: number; // lines removed from THIS file in the commit
  commitUrl: string;
  isImport: boolean; // the one-time bulk import of legacy content (a repo root commit), hidden from history
}

const cache = new Map<string, FileCommit[]>();
const FS = '\x1f'; // unit separator: safe field delimiter inside a git --format line
const RS = '\x1e'; // record separator: prefixes each commit header so we can tell it from --numstat lines

// The legacy-content bulk import is the repo's root commit(s). We hide it from per-post history and show
// an "imported from the old site" note instead. Detect it structurally (no parents), not by message.
let importHashesCache: Set<string> | null = null;
function importHashes(): Set<string> {
  if (importHashesCache) return importHashesCache;
  let set = new Set<string>();
  try {
    const raw = execFileSync('git', ['rev-list', '--max-parents=0', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    set = new Set(raw.split('\n').map((s) => s.trim()).filter(Boolean));
  } catch {
    set = new Set();
  }
  importHashesCache = set;
  return set;
}

/** GitHub login from a commit email like `12+login@users.noreply.github.com` or `login@users.noreply.github.com`. */
function loginFromEmail(email: string): string | null {
  const m = (email || '').match(/^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/i);
  return m ? m[1] : null;
}

/** Pull a PR number out of a squash subject `… (#123)` or a merge subject `Merge pull request #123`. */
function parsePr(subject: string): number | null {
  const m = subject.match(/\(#(\d+)\)\s*$/) || subject.match(/Merge pull request #(\d+)\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Commits that touched `filePath` (repo-root-relative, the Astro entry.filePath), newest first.
 * Returns [] on any failure so callers can treat "no history" and "no git" identically.
 */
export function fileCommits(filePath?: string, limit = 25): FileCommit[] {
  if (!filePath) return [];
  const rel = filePath.replace(/^\.?\//, '');
  const hit = cache.get(rel);
  if (hit) return hit;
  const imports = importHashes();
  let commits: FileCommit[] = [];
  try {
    // --numstat appends "<add>\t<del>\t<path>" lines after each commit; RS lets us tell headers apart.
    const raw = execFileSync(
      'git',
      ['log', `-n${limit}`, '--follow', '--numstat', '--date=short', `--format=${RS}%H${FS}%an${FS}%ae${FS}%ad${FS}%s`, '--', rel],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    );
    let cur: FileCommit | null = null;
    for (const line of raw.split('\n')) {
      if (line.startsWith(RS)) {
        const [hash, authorName, email, date, subject = ''] = line.slice(1).split(FS);
        cur = {
          hash,
          authorName,
          authorLogin: loginFromEmail(email),
          date,
          subject,
          pr: parsePr(subject),
          add: 0,
          del: 0,
          commitUrl: `${REPO_URL}/commit/${hash}`,
          isImport: imports.has(hash),
        };
        commits.push(cur);
      } else if (cur) {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t/); // numstat row for the file ("-" = binary)
        if (m) {
          cur.add += m[1] === '-' ? 0 : Number(m[1]);
          cur.del += m[2] === '-' ? 0 : Number(m[2]);
        }
      }
    }
  } catch {
    commits = [];
  }
  cache.set(rel, commits);
  return commits;
}

/**
 * sow-192: the whole repo's commit dates as [YYYY-MM-DD, count] pairs, oldest first, for the homepage
 * activity heatmap and the "commits" counter. Read once at build with `git log --all` (no API, no token).
 * Fail closed: [] on any failure (a shallow CI clone, a git-less environment), so the heatmap renders empty
 * and the counter shows 0. The deploy build checks out at fetch-depth: 0, so production has the full history.
 */
let commitDatesCache: Array<[string, number]> | null = null;
export function commitsByDate(): Array<[string, number]> {
  if (commitDatesCache) return commitDatesCache;
  let out: Array<[string, number]> = [];
  try {
    const raw = execFileSync('git', ['log', '--all', '--date=short', '--pretty=%ad'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const counts = new Map<string, number>();
    for (const line of raw.split('\n')) {
      const day = line.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    out = [...counts.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  } catch {
    out = [];
  }
  commitDatesCache = out;
  return out;
}

/** sow-192: total commits across the repo history (0 on any failure). Derived from commitsByDate(). */
export function commitCount(): number {
  return commitsByDate().reduce((n, [, c]) => n + c, 0);
}

export function fileHistoryHref(filePath?: string): string {
  if (!filePath) return REPO_URL;
  return `${REPO_URL}/commits/main/${filePath.replace(/^\.?\//, '')}`;
}

export function prUrl(pr: number): string {
  return `${REPO_URL}/pull/${pr}`;
}

export function profileHref(login: string | null): string | null {
  return login ? `https://github.com/${login}` : null;
}
