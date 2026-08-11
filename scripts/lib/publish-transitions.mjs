// sow-208: select the content paths that TRANSITIONED to published in a push, instead of the paths merely
// ADDED. Publishing is a status flip now (sow-194 made committed drafts first-class), so an article added as a
// draft and later published by modifying its status line never appears as an ADD, and the old diff-filter=A
// selection silently missed it. A transition = the file is published in AFTER and was NOT published in BEFORE
// (it did not exist, or it was a draft). A rename whose status is published on BOTH sides is NOT a transition,
// so a single house-content migration (sow-195 renamed 35 files) never floods the queue with reposts.
//
// Fail-closed: any git error, or an unreadable/zero before ref, selects NOTHING rather than guessing (never
// retro-fire the backlog). The script's own status guard, the redirectFrom rename skip, and the queue dedupe
// (keyed on the content path) remain as layered safety on top of this selection.
import { execFileSync } from 'node:child_process';

// The same content-path shapes the workflow used before (posts/products/prompts index.md + shares).
const CONTENT_RE = /^(members\/[a-z0-9][a-z0-9-]*|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;
const SHARE_RE = /^members\/[a-z0-9][a-z0-9-]*\/shares\/[a-z0-9][a-z0-9._-]*\.(md|mdx)$/;
const ZERO_SHA = '0000000000000000000000000000000000000000';

/** Is this a publishable content path (post/product/prompt index.md, or a share)? */
export function isContentPath(p) {
  const s = String(p || '');
  return CONTENT_RE.test(s) || SHARE_RE.test(s);
}

/** The effective status of parsed frontmatter. A missing status defaults to 'published', matching the
 *  script's own guard (`frontmatter?.status ?? 'published'`), so the two never disagree. */
export function statusOf(fm) {
  return fm && fm.status != null ? String(fm.status) : 'published';
}

/** A publish transition: published in AFTER, and NOT published in BEFORE. `beforeFm === null` means the file
 *  did not exist at the before ref (a genuine add). `afterFm === null` (deleted/unreadable) is never a publish. */
export function isPublishTransition(beforeFm, afterFm) {
  if (afterFm == null) return false;
  if (statusOf(afterFm) !== 'published') return false;
  if (beforeFm == null) return true; // added (or renamed from nothing) and published now
  return statusOf(beforeFm) !== 'published'; // draft -> published; published -> published is NOT a transition
}

const defaultRunGit = (args, root) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function readFm(runGit, sha, p, parseFm) {
  let txt;
  try { txt = runGit(['show', `${sha}:${p}`]); } catch { return null; } // absent at that ref
  if (txt == null) return null;
  try { return parseFm(txt); } catch { return null; }
}

/**
 * Return the content paths that transitioned to published between `before` and `after`.
 * `runGit(args)` runs git in the repo (injectable for tests); `parseFm(text)` parses frontmatter from a file's
 * text (inject the project's parseContentFile-backed reader). Fail-closed: any error selects [].
 */
export function selectPublishedTransitions({ before, after, root = '.', runGit, parseFm } = {}) {
  const git = runGit ?? ((args) => defaultRunGit(args, root));
  if (typeof parseFm !== 'function') return [];
  if (!before || !after || before === ZERO_SHA || after === ZERO_SHA) return []; // no baseline -> never retro-fire
  let raw;
  try { raw = git(['diff', '--name-status', '-M', before, after, '--', 'members', 'house']); }
  catch { return []; }
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (!line.trim()) continue;
    const cols = line.split('\t');
    const code = cols[0] || '';
    let oldPath = null;
    let newPath = null;
    if (code.startsWith('R') || code.startsWith('C')) { oldPath = cols[1]; newPath = cols[2]; } // rename / copy
    else if (code.startsWith('A')) { newPath = cols[1]; oldPath = null; } // added
    else if (code.startsWith('M') || code.startsWith('T')) { newPath = cols[1]; oldPath = cols[1]; } // modified
    else continue; // D (delete) and anything else is never a publish
    if (!newPath || !isContentPath(newPath)) continue;
    const afterFm = readFm(git, after, newPath, parseFm);
    const beforeFm = oldPath ? readFm(git, before, oldPath, parseFm) : null;
    if (isPublishTransition(beforeFm, afterFm)) out.push(newPath);
  }
  return out;
}
