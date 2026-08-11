// SOW-035 Phase 2: the CONTENT + SOCIAL create -> confirm -> scrub/hide cycles against the LIVE system, run as
// the gbtilabs superadmin (E2E_TOKEN / GH_BOT_TOKEN). Three cycles:
//   1. member-only decrypt: a real committed .enc decrypts for the paid superadmin; denied without a token.
//   2. follows: follow a real member (paid-only KV), confirm, then unfollow (scrub), confirm zero leaks.
//   3. content + comment authoring: open ONE GitHub DRAFT PR that adds a draft post AND a draft comment, confirm
//      the PR + files, then scrub (close the PR + delete the branch), confirm the branch is gone.
//
// SAFETY (why this never pollutes production): the authored files are status: draft + visibility: members (the
// build, indexes, and feeds all exclude them), the PR is a GitHub *draft* (the gate cannot auto-merge it), and
// the cycle closes the PR + deletes the branch immediately. So even a total cleanup failure leaves only a
// closed draft PR referencing invisible draft content, never anything published. The "hide via schema" fallback
// (status: draft) is therefore already baked into the created content, belt and suspenders.
//
// Run: node --env-file=.env tests/e2e/content-cycle.mjs   (authenticated cycles SKIP without a real token)

import { createRegistry } from './lib/cleanup.mjs';
import { createGitHubClient } from '../../clients/github.mjs';
import { runnable, FULL } from './lib/tags.mjs'; // SOW-035 P5: write cycles are 'full'; smoke runs read-only only

const SITE = process.env.E2E_SITE || 'https://gbti.network';
const WORKER = process.env.E2E_WORKER || 'https://signup.gbti.network';
const REPO = process.env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
const TOKEN = process.env.E2E_TOKEN || process.env.GITHUB_BOT_TOKEN || '';
const HAVE_TOKEN = !!TOKEN && !/^REPLACE/i.test(TOKEN) && TOKEN.length >= 40;
const RUN_ID = process.env.GITHUB_RUN_ID || String(process.hrtime.bigint());
const FOLLOW_TARGET = 'rfilipo'; // a real grandfathered member
const ENC_PATH = 'members/atwellpub/_enc/comment-result-describe-my-writing-style-body.enc';

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, state: ok ? 'pass' : 'fail' }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); return ok; };
const skip = (name, reason) => { results.push({ name, state: 'skip' }); console.log(`SKIP  ${name}  (${reason})`); };
const authHeaders = { Authorization: `Bearer ${TOKEN}` };
const jsonHeaders = { ...authHeaders, 'Content-Type': 'application/json' };
async function getJson(url, opts) { const r = await fetch(url, opts); let body = null; try { body = await r.json(); } catch { /* */ } return { status: r.status, ok: r.ok, body }; }
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function decryptCycle() {
  // The envelope is public (committed ciphertext in the public repo); fetch it raw.
  const raw = await fetch(`https://raw.githubusercontent.com/${REPO}/main/${ENC_PATH}`);
  let envelope = null; try { envelope = await raw.json(); } catch { /* */ }
  if (!envelope) { check('member-only .enc envelope is fetchable', false, `raw ${raw.status}`); return; }
  check('member-only .enc envelope is fetchable', true, `${ENC_PATH}`);

  const noTok = await fetch(WORKER + '/membership/decrypt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(envelope) });
  check('member-only decrypt denied without a token', noTok.status === 401 || noTok.status === 403, String(noTok.status));

  if (!HAVE_TOKEN) { skip('member-only decrypt returns plaintext for the paid superadmin', 'no real token'); return; }
  const dec = await getJson(WORKER + '/membership/decrypt', { method: 'POST', headers: jsonHeaders, body: JSON.stringify(envelope) });
  check('member-only decrypt returns plaintext for the paid superadmin', dec.status === 200 && dec.body?.ok === true && typeof dec.body?.text === 'string' && dec.body.text.length > 0, `status=${dec.status} len=${dec.body?.text?.length ?? 0}`);
}

async function followsCycle() {
  if (!runnable([FULL])) { skip('follow create + confirm + scrub', 'skipped (E2E_TAGS=smoke is read-only)'); return; }
  if (!HAVE_TOKEN) { skip('follow create + confirm + scrub', 'no real token'); return; }
  const base = await getJson(WORKER + '/membership/follows', { headers: authHeaders });
  if (base.status !== 200) { check('follow create + confirm + scrub', false, `baseline ${base.status} (paid-only; is the actor effective-paid?)`); return; }
  if ((base.body?.following || []).some((f) => f.username === FOLLOW_TARGET)) { skip('follow create + confirm + scrub', `already following ${FOLLOW_TARGET}`); return; }

  const reg = createRegistry();
  const add = await getJson(WORKER + '/membership/follows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: FOLLOW_TARGET, on: true }) });
  reg.register(`follow ${FOLLOW_TARGET}`, async () => { await fetch(WORKER + '/membership/follows', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ username: FOLLOW_TARGET, on: false }) }); });
  const present = (add.body?.following || []).some((f) => f.username === FOLLOW_TARGET);
  const recorded = check('follow recorded (create + confirm)', add.status === 200 && present, `following ${(add.body?.following || []).length}`);
  const cr = await reg.cleanup(console.log);
  const fin = await getJson(WORKER + '/membership/follows', { headers: authHeaders });
  const still = (fin.body?.following || []).some((f) => f.username === FOLLOW_TARGET);
  // Require the final read to have SUCCEEDED before trusting !still; otherwise a failed fetch (null body) reads
  // as "scrubbed" and falsely passes while the follow may still leak.
  check('follow scrubbed (zero leaks)', recorded && fin.status === 200 && !still && cr.leaked.length === 0, `status=${fin.status} leaked=${cr.leaked.length}`);
}

async function authoringCycle() {
  if (!runnable([FULL])) { skip('content + comment draft PR created (authoring + confirm)', 'skipped (E2E_TAGS=smoke is read-only)'); return; }
  if (!HAVE_TOKEN) { skip('content + comment draft PR created (authoring + confirm)', 'no real token'); skip('content PR + branch scrubbed (zero leaks)', 'no real token'); return; }
  const gh = createGitHubClient({ token: TOKEN, repo: REPO, fetch: globalThis.fetch });
  const slug = `e2e-smoke-${RUN_ID}`;
  const branch = `e2e/content-${RUN_ID}`;
  const postPath = `members/gbtilabs/posts/${slug}/index.md`;
  const commentPath = `house/comments/${slug}.md`;
  const reg = createRegistry();

  const postMd = `---\ntype: post\ntitle: "E2E smoke (safe to ignore)"\nslug: ${slug}\nstatus: draft\nvisibility: members\npublishedAt: 0\nexcerpt: "Automated SOW-035 E2E smoke. Draft + members-only; never published; auto-removed."\n---\n\nAutomated end-to-end test post. Draft and members-only, so it never reaches any public surface.\n`;
  const commentMd = `---\ntype: comment\nid: ${slug}\nauthor: gbtilabs\ntargetType: post\ntargetSlug: ${slug}\nstatus: draft\nvisibility: public\ncreatedAt: 2026-06-17\n---\n\nAutomated SOW-035 E2E test comment. Draft; never published.\n`;

  let prNumber = null;
  try {
    const baseRef = await gh.getRef('heads/main');
    const baseSha = baseRef?.object?.sha;
    if (!baseSha) throw new Error('cannot resolve main head sha');
    await gh.createRef(branch, baseSha);
    // register the branch teardown FIRST so an orphan branch is cleaned even if the PR never opens. Do NOT
    // swallow the error: a failed delete must surface in cr.leaked, never be reported as scrubbed.
    reg.register(`branch ${branch}`, async () => { await gh.deleteRef(branch); });
    // [skip ci]: the harness opens a draft PR then closes it + deletes the branch within ~2s, so any
    // pull_request CI run (Unit tests, Extension drift) would fail on a checkout of the deleted ref and email a
    // spurious failure. The skip-ci marker in the HEAD commit makes GitHub skip those push/pull_request runs.
    await gh.putContent(postPath, { message: `e2e: smoke draft post (${RUN_ID}) [skip ci]`, content: b64(postMd), branch });
    await gh.putContent(commentPath, { message: `e2e: smoke draft comment (${RUN_ID}) [skip ci]`, content: b64(commentMd), branch });
    const pull = await gh.createPull({ title: `[e2e] smoke ${RUN_ID} (auto-closing)`, head: branch, base: 'main', body: 'SOW-035 automated E2E. Draft PR + status:draft content, auto-closed and branch deleted by the harness. Safe to ignore.', draft: true });
    prNumber = pull?.number ?? null;
    // register the PR close AFTER createRef/putContent, so cleanup (reverse order) closes the PR BEFORE deleting its branch.
    if (prNumber) reg.register(`PR #${prNumber}`, async () => { await gh.closePull(prNumber, { comment: 'e2e: auto-closing test PR' }); });
    check('content + comment draft PR created (authoring + confirm)', !!prNumber, `PR #${prNumber} adds ${postPath} + ${commentPath}`);
  } catch (e) {
    check('content + comment draft PR created (authoring + confirm)', false, e?.message ?? String(e));
  }

  const cr = await reg.cleanup(console.log);
  // branchGone must be a REAL 404, not any error (a 403/5xx after a failed delete must not read as "gone").
  // The ref delete is eventually consistent: getRef can still 200 for a beat after deleteRef, so a single
  // check flakes to branchGone=false on the timing race (the admin-cycle test already polls for this exact
  // reason). Poll for the REAL 404 up to ~5s; a 403/5xx keeps looping and, after 6 tries, still reads as
  // not-gone so a genuinely stuck branch is not masked.
  let branchGone = false;
  for (let i = 0; i < 6 && !branchGone; i++) {
    try { await gh.getRef(`heads/${branch}`); } catch (e) { if (e?.status === 404) { branchGone = true; break; } }
    if (!branchGone) await new Promise((r) => setTimeout(r, 1000));
  }
  // verify the PR is actually closed (a swallowed close would otherwise leak an open draft PR).
  let prClosed = !prNumber;
  if (prNumber) { try { const pr = await gh.getPull(prNumber); prClosed = pr?.state === 'closed'; } catch (e) { prClosed = false; } }
  check('content PR + branch scrubbed (zero leaks)', cr.leaked.length === 0 && branchGone && prClosed, `cleaned=${cr.cleaned} leaked=${cr.leaked.length} branchGone=${branchGone} prClosed=${prClosed}`);
}

async function main() {
  console.log(`SOW-035 content-cycle against ${SITE} + ${WORKER} + repo ${REPO} (run ${RUN_ID})\n`);
  await decryptCycle();
  await followsCycle();
  await authoringCycle();

  const pass = results.filter((r) => r.state === 'pass').length;
  const fail = results.filter((r) => r.state === 'fail').length;
  const skipped = results.filter((r) => r.state === 'skip').length;
  console.log(`\n=== ${pass} passed, ${fail} failed, ${skipped} skipped (of ${results.length}) ===`);
  if (skipped) console.log('Skipped checks need a real token: set E2E_TOKEN, or run the e2e-smoke workflow.');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('E2E content-cycle crashed:', e?.message ?? e); process.exit(1); });
