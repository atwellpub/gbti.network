// Admin/superadmin operations (SOW-006; SOW-038 P4). Each reads the current LOCAL file, applies the consolidated
// pure governance core (membership/superadmin-actions.mjs), and opens the appropriate house/cross-folder PR
// (publishFiles). SOW-038 P4 converged this path off the parallel admin-edits.mjs onto superadmin-actions, so the
// SAME module the effective-status precedence reads (overrides-core) is the module the panel writes, and every
// governance action now gains (1) idempotency — a no-op when already in that state, no redundant PR — and (2) an
// identity-minimal audit entry, folded into the PR body (the PR is the audit trail).
//
// Capability is checked against the signed-in role from the LOCAL roles.yml, but that is UX gating only: the
// SOW-005 gate + CODEOWNERS are the real boundary (a member who fakes a role locally still cannot merge the PR).
// Errors use OperationError so every transport (CLI/MCP/UI) maps them consistently.

import yaml from 'js-yaml';

import { OperationError, syncForkIfCreatingBranch } from './operations.mjs';
import { canModerate, canBanGrandfather, canManageRoles } from './roles.mjs';
import { ban, unban, grandfather, revokeGrandfather, grantRole, SuperadminActionError } from '../../membership/superadmin-actions.mjs';
import { addCategory as addCategoryEdit, renameLabel as renameLabelEdit, TaxonomyEditError } from '../../membership/taxonomy-edits.mjs';
import { addSource as addSourceEdit, removeSource as removeSourceEdit, setSourceEnabled as setSourceEnabledEdit, NewsSourceEditError } from '../../membership/news-source-edits.mjs'; // SOW-056 P2
import { addQuote as addQuoteEdit, removeQuote as removeQuoteEdit, setQuoteEnabled as setQuoteEnabledEdit, QuoteEditError } from '../../membership/quote-edits.mjs'; // SOW-063 P3
import { addWord as addWordEdit, removeWord as removeWordEdit, setWordEnabled as setWordEnabledEdit, WordEditError } from '../../membership/word-edits.mjs'; // sow-259
import { setChannel as setChannelEdit, removeChannel as removeChannelEdit, ContentChannelEditError } from '../../membership/content-channels-edits.mjs'; // SOW-087
import { addFlagTerm as addFlagTermEdit, removeFlagTerm as removeFlagTermEdit, ModerationFlagEditError } from '../../membership/moderation-flags-edits.mjs'; // SOW-087
import { setTemplate as setTemplateEdit, setNewsEngagement as setNewsEngagementEdit, setContentEngagement as setContentEngagementEdit, setSyndicationSettings as setSyndicationSettingsEdit, SYNDICATION_CHANNEL_NAMES, TemplateEditError } from '../../membership/syndication-template-edits.mjs'; // SOW-087 + SOW-111 + SOW-088 + SOW-126
import { addCouponEdit, updateCouponEdit, CouponEditError } from '../../membership/coupon-edits.mjs'; // SOW-119
import { syndicationConfigFromParsed, TEMPLATE_TYPES, TEMPLATE_CHANNELS, newsEngagement, NEWS_ENGAGEMENT_TIERS, contentEngagement, CONTENT_ENGAGEMENT_SIGNALS, AUTO_TYPES, AUTO_CHANNELS, MATRIX_CHANNELS, AUTO_MODES, CHANNEL_CAPABILITY } from '../../membership/syndication-config-core.mjs'; // SOW-087 + SOW-111 + SOW-088 + SOW-125 + SOW-126
import { retagContent, parseContentFile, flipContentStatus } from './content-ops.mjs';
import { publishFiles } from './publish.mjs';

// SOW-152: fresh-base the fork branch before an admin CONFIG write, exactly like the content publish path
// (operations.mjs callers of syncForkIfCreatingBranch). Without this, an admin write force-resets its branch
// onto the fork's POSSIBLY-STALE main, whose merge-base can predate the file on upstream -> an add/add
// ("new file mode") conflict that a superadmin-automerge PR then stalls on forever. The sync is fail-soft (its
// own try/catch), so a miss never breaks the write; it only ensures commitToBranchOnFork bases on a fresh main.
// EVERY admin write goes through here so none is skipped.
async function adminPublish(ctx, opts) {
  await syncForkIfCreatingBranch(ctx, opts.repo, opts.branch);
  return publishFiles(opts);
}

function requireRole(ctx, check, need) {
  const role = ctx.role?.() ?? 'member';
  if (!check(role)) throw new OperationError('forbidden', `requires ${need} (you are ${role})`);
  return role;
}

// Host-agnostic: read the CURRENT house/content file through ctx.reader (node = working copy, extension =
// GitHub Contents API) so an edit never clobbers the rest of the file. The repoPath guard ensures the node
// host has a local clone to read from (the extension host satisfies it with a sentinel).
function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'run `gbti login` first');
  if (!ctx.store?.get('repoPath')) throw new OperationError('bad-request', 'no local repoPath configured');
  return { repo };
}

// Host-portable read: the npm host's reader.readFile is sync (returns a string); the extension's is async
// (GitHub Contents API). `await` handles both (awaiting a plain string yields the string), so the same admin
// ops run in either host.
const readYaml = async (ctx, rel) => {
  try {
    return yaml.load((await ctx.reader?.readFile?.(rel)) || '') ?? {};
  } catch {
    return {};
  }
};
const dumpYaml = (obj) => yaml.dump(obj, { lineWidth: 100, noRefs: true });
const slugOf = (rel) => rel.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 48);

// SOW-038 P4: the action context for the governance core — the signed-in actor (for the identity-minimal audit
// entry) + the deterministic clock. Actor is null when the host did not attach an identity (the audit allows it).
function actionCtx(ctx) {
  const id = ctx.identity?.();
  return {
    actor: id ? { githubId: id.githubId ?? id.github_id ?? null, login: id.login ?? null } : null,
    now: ctx.now ? ctx.now() : undefined,
  };
}
// Fold the identity-minimal audit entry into the PR body (the PR is the audit trail) as a parseable, low-noise
// HTML comment, under an optional human-readable reason line.
function prBody(reason, auditEntry) {
  const head = reason ? `Reason: ${reason}\n\n` : '';
  return `${head}<!-- gbti-audit ${JSON.stringify(auditEntry)} -->`;
}
// A governance action that did not change anything (already in that state) -> a graceful idempotent no-op, no PR.
const noop = (message, auditEntry) => ({ changed: false, noop: true, message, audit: auditEntry });

function requireId(githubId) {
  if (githubId === undefined || githubId === null || String(githubId).trim() === '') {
    throw new OperationError('bad-request', 'githubId is required');
  }
  return String(githubId);
}
function requirePath(rel) {
  if (!rel || typeof rel !== 'string' || rel.includes('\\') || rel.startsWith('/')) {
    throw new OperationError('bad-request', 'a valid in-repo content path is required');
  }
  // Reject any non-canonical segment. Note `.` matters: path.join normalizes a `./` prefix away, so a
  // bare `rel.includes('..')` check is not enough to keep a path inside its intended scope.
  const segments = rel.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new OperationError('bad-request', 'a valid in-repo content path is required');
  }
  return rel;
}

/** Moderation (deplatform/remove) is content-only: restrict to a member content folder. */
function requireMemberContentPath(rel) {
  requirePath(rel);
  if (!rel.startsWith('members/')) {
    throw new OperationError('forbidden', 'moderation is limited to member content (members/<user>/...)');
  }
  return rel;
}

// ---- admin: ban / grandfather (house/bans.yml, house/grandfathered.yml) ----

export async function banMember(ctx, { githubId, reason } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = ban(await readYaml(ctx, 'house/bans.yml'), { githubId: id, reason }, actionCtx(ctx));
  if (!changed) return noop(`already banned: ${id}`, audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/ban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(next) }], message: `Ban ${id}`, title: `Ban member ${id}`, body: prBody(reason, audit) });
  return { ...pr, changed: true, audit };
}

export async function unbanMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = unban(await readYaml(ctx, 'house/bans.yml'), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not banned: ${id}`, audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/unban-${id}`, files: [{ path: 'house/bans.yml', content: dumpYaml(next) }], message: `Unban ${id}`, title: `Unban member ${id}`, body: prBody(null, audit) });
  return { ...pr, changed: true, audit };
}

export async function grandfatherMember(ctx, { githubId, reason, until = null, login } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  let result;
  try {
    result = grandfather(await readYaml(ctx, 'house/grandfathered.yml'), { githubId: id, login, reason, until }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError('bad-request', err.message);
    throw err;
  }
  if (!result.changed) return noop(`already grandfathered: ${id}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/grandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(result.next) }], message: `Grandfather ${id}`, title: `Grandfather member ${id}`, body: prBody(reason, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function ungrandfatherMember(ctx, { githubId } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  const { next, changed, audit } = revokeGrandfather(await readYaml(ctx, 'house/grandfathered.yml'), { githubId: id }, actionCtx(ctx));
  if (!changed) return noop(`not grandfathered: ${id}`, audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/ungrandfather-${id}`, files: [{ path: 'house/grandfathered.yml', content: dumpYaml(next) }], message: `Remove grandfather ${id}`, title: `Remove grandfather for ${id}`, body: prBody(null, audit) });
  return { ...pr, changed: true, audit };
}

// ---- superadmin: role management (house/roles.yml) ----

export async function setMemberRole(ctx, { githubId, role, login } = {}) {
  requireRole(ctx, canManageRoles, 'superadmin');
  const { repo } = requireRepo(ctx);
  const id = requireId(githubId);
  if (!role) throw new OperationError('bad-request', 'role is required (member|moderator|admin|superadmin)');
  let result;
  try {
    result = grantRole(await readYaml(ctx, 'house/roles.yml'), { githubId: id, role, login }, actionCtx(ctx));
  } catch (err) {
    if (err instanceof SuperadminActionError) throw new OperationError('bad-request', err.message);
    throw err;
  }
  if (!result.changed) return noop(`already ${role}: ${id}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/role-${id}`, files: [{ path: 'house/roles.yml', content: dumpYaml(result.next) }], message: `Set ${id} role=${role}`, title: `Set role for ${id}: ${role}`, body: prBody(`role: ${role}`, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

// ---- moderator: deplatform / remove any content ----

export async function deplatformContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  // SOW-038: deplatform = status -> draft (excludes it from the build, indexes, and feeds). Visibility is left
  // intact (not forced to members) so a later restore keeps the content's original public/members audience.
  const flip = flipContentStatus(text, 'draft'); // SOW-106: the shared status-flip core
  const content = flip.changed ? flip.content : text;
  return adminPublish(ctx, { repo, branch: `gbti/deplatform-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Deplatform ${rel}`, title: `Deplatform ${rel}`, body: 'Moderation: set status to draft.' });
}

// SOW-071: the inverse of deplatform (status -> published); visibility is left untouched. Moderator+, members content
// only. The unhideContent pure core (superadmin-actions.mjs) also flips visibility, which is NOT the inverse of what
// deplatform does, so this inlines the status flip to mirror deplatformContent exactly.
export async function republishContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canModerate, 'moderator');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  const text = await ctx.reader?.readFile?.(rel);
  if (text == null) throw new OperationError('not-found', `no such file: ${rel}`);
  const flip = flipContentStatus(text, 'published'); // SOW-106: the shared status-flip core
  const content = flip.changed ? flip.content : text;
  return adminPublish(ctx, { repo, branch: `gbti/republish-${slugOf(rel)}`, files: [{ path: rel, content }], message: `Republish ${rel}`, title: `Republish ${rel}`, body: 'Moderation: set status to published.' });
}

// SOW-071: Remove is a destructive file delete, so it is gated heavier than Hide -> admin+ (was moderator+), so the
// enforced boundary matches the displayed UI tier. CODEOWNERS + the SOW-005 gate remain the real merge boundary.
export async function removeContent(ctx, { path: rel } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  requireMemberContentPath(rel);
  return adminPublish(ctx, { repo, branch: `gbti/remove-${slugOf(rel)}`, files: [{ path: rel, content: null }], message: `Remove ${rel}`, title: `Remove ${rel}`, body: 'Moderation: remove content.' });
}

// ---- admin: category manager (house/taxonomy.yml) — SOW-055 v1 (add + rename-label, the safe ops) ----

const TAXONOMY_PATH = 'house/taxonomy.yml';
// yaml.dump drops comments; taxonomy.yml carries a load-bearing documentation header (the SOW-012 contract), so
// preserve the leading comment block and re-prepend it on write.
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}

/** Read the current canonical taxonomy ({ tree }) for the category-manager UI. Public data; read-only. */
export async function getTaxonomy(ctx) {
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { tree: parsed.tree || {} };
}

export async function addContentCategory(ctx, { parentPath, key, label } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin'); // house/taxonomy.yml is admin-owned (CODEOWNERS); the gate is the real boundary
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = addCategoryEdit(parsed, { parentPath, key, label }, actionCtx(ctx)); }
  catch (err) { if (err instanceof TaxonomyEditError) throw new OperationError('bad-request', err.message); throw err; }
  const fullPath = [...(Array.isArray(parentPath) ? parentPath : []), key].filter(Boolean);
  if (!result.changed) return noop(`category already exists: ${fullPath.join(' > ')}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/category-add-${slugOf(fullPath.join('-'))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Add category ${fullPath.join('/')}`, title: `Add category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function renameContentCategoryLabel(ctx, { path, label } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(TAXONOMY_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = renameLabelEdit(parsed, { path, label }, actionCtx(ctx)); }
  catch (err) { if (err instanceof TaxonomyEditError) throw new OperationError('bad-request', err.message); throw err; }
  const p = Array.isArray(path) ? path : [];
  if (!result.changed) return noop(`label unchanged: ${p.join(' > ')}`, result.audit);
  const pr = await adminPublish(ctx, { repo, branch: `gbti/category-rename-${slugOf(p.join('-'))}`, files: [{ path: TAXONOMY_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message: `Rename category ${p.join('/')} -> ${label}`, title: `Rename category: ${label}`, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

// SOW-056 Phase 2: the superadmin news-source-pool manager. Each edit applies the pure news-source-edits core to the
// parsed house/news-sources.yml and opens an auto-merged house PR (admin-owned via CODEOWNERS; the gate is the real
// boundary), exactly like the category manager. Edits go live at the Pages-deploy cadence (the worker reads the
// rebuilt /news-sources.json next cron).
const NEWS_SOURCES_PATH = 'house/news-sources.yml';

/** Read the current news-source pool for the manager UI. Public data; read-only. */
export async function getNewsSourcePool(ctx) {
  const raw = (await ctx.reader?.readFile?.(NEWS_SOURCES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { sources: Array.isArray(parsed.sources) ? parsed.sources : [] };
}

async function editNewsSources(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(NEWS_SOURCES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof NewsSourceEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: NEWS_SOURCES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addNewsSource(ctx, { id, name, url, description } = {}) {
  const sid = slugOf(String(id || name || ''));
  return editNewsSources(ctx, (parsed) => addSourceEdit(parsed, { id, name, url, description }, actionCtx(ctx)),
    { branch: `gbti/news-source-add-${sid}`, message: `Add news source ${id || name}`, title: `Add news source: ${name || id}`, noopMsg: `news source already present: ${id || name}` });
}

export async function removeNewsSource(ctx, { id } = {}) {
  const sid = slugOf(String(id || ''));
  return editNewsSources(ctx, (parsed) => removeSourceEdit(parsed, { id }, actionCtx(ctx)),
    { branch: `gbti/news-source-remove-${sid}`, message: `Remove news source ${id}`, title: `Remove news source: ${id}`, noopMsg: `no such news source: ${id}` });
}

export async function setNewsSourceEnabled(ctx, { id, enabled } = {}) {
  const sid = slugOf(String(id || ''));
  const on = !!enabled;
  return editNewsSources(ctx, (parsed) => setSourceEnabledEdit(parsed, { id, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/news-source-${on ? 'enable' : 'disable'}-${sid}`, message: `${on ? 'Enable' : 'Disable'} news source ${id}`, title: `${on ? 'Enable' : 'Disable'} news source: ${id}`, noopMsg: `news source already ${on ? 'enabled' : 'disabled'}: ${id}` });
}

// SOW-119: the coupon-pool manager (config half). Each edit applies the pure coupon-edits core to the parsed
// house/coupons.yml and opens an auto-merged house PR, exactly like the news-source manager. Edits reach the
// signup Worker at the next coupons:config mirror sync (reconcile or the 6h sync-overrides-mirror tick). The
// runtime half (usage counts + invite links) is Worker/KV via member-admin-client (operations.mjs).
const COUPONS_PATH = 'house/coupons.yml';

/** Read the current coupon pool for the manager UI. Admin-owned config; read-only here. */
export async function getCouponPool(ctx) {
  const raw = (await ctx.reader?.readFile?.(COUPONS_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { coupons: Array.isArray(parsed.coupons) ? parsed.coupons : [] };
}

async function editCoupons(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(COUPONS_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof CouponEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: COUPONS_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addCoupon(ctx, { code, freeDays, note, maxRedemptions, expiresAt } = {}) {
  const c = String(code || '').trim().toUpperCase();
  return editCoupons(ctx, (parsed) => addCouponEdit(parsed, { code, freeDays, note, maxRedemptions, expiresAt }, actionCtx(ctx)),
    { branch: `gbti/coupon-add-${c.toLowerCase()}`, message: `Add coupon ${c}`, title: `Add coupon: ${c}`, noopMsg: `coupon already present: ${c}` });
}

export async function updateCoupon(ctx, { code, patch } = {}) {
  const c = String(code || '').trim().toUpperCase();
  return editCoupons(ctx, (parsed) => updateCouponEdit(parsed, { code, patch }, actionCtx(ctx)),
    { branch: `gbti/coupon-update-${c.toLowerCase()}-${Date.now()}`, message: `Update coupon ${c}`, title: `Update coupon: ${c}`, noopMsg: `coupon already in that state: ${c}` });
}

// SOW-063 Phase 3: the superadmin quote-pool manager. Each edit applies the pure quote-edits core to the parsed
// house/quotes.yml and opens an auto-merged house PR (admin-owned via CODEOWNERS; the gate is the real boundary),
// exactly like the news-source manager. Edits go live at the Pages-deploy cadence (the extension reads the rebuilt
// /quotes.json). Quotes are keyed by their text (no id).
const QUOTES_PATH = 'house/quotes.yml';
const quoteSlug = (text) => slugOf(String(text || '').slice(0, 40)) || 'quote';

/** Read the current quote pool for the manager UI. Public data; read-only. */
export async function getQuotePool(ctx) {
  const raw = (await ctx.reader?.readFile?.(QUOTES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [] };
}

async function editQuotes(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(QUOTES_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof QuoteEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: QUOTES_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addQuote(ctx, { text, author } = {}) {
  return editQuotes(ctx, (parsed) => addQuoteEdit(parsed, { text, author }, actionCtx(ctx)),
    { branch: `gbti/quote-add-${quoteSlug(text)}`, message: `Add quote (${author || 'unknown'})`, title: `Add quote: ${author || 'unknown'}`, noopMsg: 'quote already present' });
}

export async function removeQuote(ctx, { text } = {}) {
  return editQuotes(ctx, (parsed) => removeQuoteEdit(parsed, { text }, actionCtx(ctx)),
    { branch: `gbti/quote-remove-${quoteSlug(text)}`, message: 'Remove quote', title: 'Remove quote', noopMsg: 'no such quote' });
}

export async function setQuoteEnabled(ctx, { text, enabled } = {}) {
  const on = !!enabled;
  return editQuotes(ctx, (parsed) => setQuoteEnabledEdit(parsed, { text, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/quote-${on ? 'enable' : 'disable'}-${quoteSlug(text)}`, message: `${on ? 'Enable' : 'Disable'} quote`, title: `${on ? 'Enable' : 'Disable'} quote`, noopMsg: `quote already ${on ? 'enabled' : 'disabled'}` });
}

// sow-259: the admin word-of-the-day pool manager. Byte-for-byte the quote-manager shape: apply the pure
// word-edits core to the parsed house/words.yml and open an auto-merged house PR (admin-owned via CODEOWNERS; the
// gate is the real boundary). Edits go live at the Pages-deploy cadence, when the rebuilt /words.json ships.
// Words are keyed by the word itself (no id).
const WORDS_PATH = 'house/words.yml';
const wordSlug = (word) => slugOf(String(word || '').slice(0, 40)) || 'word';

/** Read the current word pool for the manager UI. Public data; read-only. */
export async function getWordPool(ctx) {
  const raw = (await ctx.reader?.readFile?.(WORDS_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  return { words: Array.isArray(parsed.words) ? parsed.words : [] };
}

async function editWords(ctx, edit, { branch, message, title, noopMsg }) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(WORDS_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof WordEditError) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: WORDS_PATH, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit) });
  return { ...pr, changed: true, audit: result.audit };
}

export async function addWord(ctx, { word, partOfSpeech, definition } = {}) {
  return editWords(ctx, (parsed) => addWordEdit(parsed, { word, partOfSpeech, definition }, actionCtx(ctx)),
    { branch: `gbti/word-add-${wordSlug(word)}`, message: `Add word (${word || 'unknown'})`, title: `Add word: ${word || 'unknown'}`, noopMsg: 'word already present' });
}

export async function removeWord(ctx, { word } = {}) {
  return editWords(ctx, (parsed) => removeWordEdit(parsed, { word }, actionCtx(ctx)),
    { branch: `gbti/word-remove-${wordSlug(word)}`, message: 'Remove word', title: 'Remove word', noopMsg: 'no such word' });
}

export async function setWordEnabled(ctx, { word, enabled } = {}) {
  const on = !!enabled;
  return editWords(ctx, (parsed) => setWordEnabledEdit(parsed, { word, enabled: on }, actionCtx(ctx)),
    { branch: `gbti/word-${on ? 'enable' : 'disable'}-${wordSlug(word)}`, message: `${on ? 'Enable' : 'Disable'} word`, title: `${on ? 'Enable' : 'Disable'} word`, noopMsg: `word already ${on ? 'enabled' : 'disabled'}` });
}

// SOW-087: the superadmin channel-map + template + flag-word editors. Same shape as the news-source manager
// (a pure edit core over the parsed house yaml + a publishFiles PR preserving the doc header), but gated
// SUPERADMIN (canManageRoles): house/content-channels.yml and house/moderation-flags.yml are
// superadmin-CODEOWNED, and the template lives in house/syndication-config.yml (same ownership tier).
const CONTENT_CHANNELS_PATH = 'house/content-channels.yml';
const MODERATION_FLAGS_PATH = 'house/moderation-flags.yml';
const SYNDICATION_CONFIG_PATH = 'house/syndication-config.yml';

/** Read the category -> Discord-channel map for the manager UI. Public data; read-only. */
export async function getContentChannelPool(ctx) {
  const parsed = await readYaml(ctx, CONTENT_CHANNELS_PATH);
  return { channels: Array.isArray(parsed.channels) ? parsed.channels : [] };
}

/** Read the moderation word lists for the manager UI. Public data (the file is in the public repo); read-only. */
export async function getModerationFlagPool(ctx) {
  const parsed = await readYaml(ctx, MODERATION_FLAGS_PATH);
  const lists = parsed.lists && typeof parsed.lists === 'object' && !Array.isArray(parsed.lists) ? parsed.lists : {};
  return { lists };
}

/** Read the per-type templates (+ SOW-088 per-channel overrides) for the manager UI. Read-only. */
export async function getSyndicationTemplatePool(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  return { templates: cfg.templates, channelTemplates: cfg.channel_templates, stubTemplates: cfg.stub_templates, channelTemplatesStub: cfg.channel_templates_stub, types: [...TEMPLATE_TYPES], channels: [...TEMPLATE_CHANNELS] };
}

async function editHouseYaml(ctx, relPath, edit, { branch, message, title, noopMsg, errType }) {
  requireRole(ctx, canManageRoles, 'superadmin');
  const { repo } = requireRepo(ctx);
  const raw = (await ctx.reader?.readFile?.(relPath)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  let result;
  try { result = edit(parsed); }
  catch (err) { if (err instanceof errType) throw new OperationError('bad-request', err.message); throw err; }
  if (!result.changed) return noop(noopMsg, result.audit);
  // clobberOpenPull: a house-config branch's open PR is always this same edit, so a stale CONFLICTING
  // PR self-heals to fresh content on the next save (hit live 2026-07-12, PR #107).
  const pr = await adminPublish(ctx, { repo, branch, files: [{ path: relPath, content: leadingComment(raw) + dumpYaml(result.next) }], message, title, body: prBody(null, result.audit), clobberOpenPull: true });
  return { ...pr, changed: true, audit: result.audit };
}

// SOW-100: apply a BATCH of pending category-workspace edits as ONE house PR. Ops are the pending-set
// vocabulary from client-ui/src/categories-core.mjs: label / add (house/taxonomy.yml) and channel-set /
// channel-remove (house/content-channels.yml). Each op applies its EXISTING pure edit core over fresh reads;
// an op that no-ops is skipped (idempotent); the first invalid op aborts the whole batch (nothing published).
// Key renames / moves / removes are review-gated CI migrations and are NEVER accepted here. Gate: admin for a
// taxonomy-only batch, superadmin when any channel op is present (matching the per-action gates).
// SOW-100 tag curation: rename / merge / retire a free-form tag across the items carrying it. `paths` come
// from the client's index aggregation but are NEVER trusted: each file is read fresh and only rewritten when
// it actually carries the tag (retagContent no-ops otherwise). One PR for the whole edit; admin-gated (a
// superadmin's PR auto-merges per SOW-108, a plain admin's falls to the review lane). rename == merge when
// the destination already exists (the helper dedupes).
export async function applyTagEdit(ctx, { mode, action, tag, to, paths } = {}) {
  requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);
  // `mode` is the wire name (client.admin spreads args into { action: 'tag-edit', ...args }, so an inner
  // `action` key would clobber the route); `action` stays accepted for direct API callers.
  const act = String(mode || action || '');
  if (!['rename', 'merge', 'retire'].includes(act)) throw new OperationError('bad-request', 'mode must be rename, merge, or retire');
  const src = String(tag || '').trim().toLowerCase();
  if (!src) throw new OperationError('bad-request', 'a tag is required');
  const dest = act === 'retire' ? null : String(to || '').trim().toLowerCase();
  if (act !== 'retire' && !dest) throw new OperationError('bad-request', `${act} needs a destination tag`);
  if (dest === src) throw new OperationError('bad-request', 'the destination equals the source');
  const list = (Array.isArray(paths) ? paths : []).filter((p) => /^(members\/[a-z0-9][a-z0-9-]*|house)\/(posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/.test(String(p)));
  if (!list.length || list.length > 100) throw new OperationError('bad-request', 'between 1 and 100 content paths are required');
  const files = [];
  for (const rel of list) {
    const text = await ctx.reader?.readFile?.(rel);
    if (text == null) continue;
    const r = retagContent(text, { tag: src, to: dest });
    if (r.changed) files.push({ path: rel, content: r.content });
  }
  if (!files.length) return noop(`no item carries the tag "${src}"`);
  const verb = act === 'retire' ? `Retire tag ${src}` : `${act === 'merge' ? 'Merge' : 'Rename'} tag ${src} -> ${dest}`;
  const pr = await adminPublish(ctx, { repo, branch: `gbti/tag-${act}-${slugOf(src)}`, files, message: verb, title: verb, body: `Tag curation (SOW-100): ${verb} across ${files.length} item${files.length === 1 ? '' : 's'}.` });
  return { ...pr, changed: true, rewritten: files.length };
}

export async function applyCategoryBatch(ctx, { ops, descriptions } = {}) {
  const list = Array.isArray(ops) ? ops : [];
  if (!list.length) throw new OperationError('bad-request', 'the batch is empty');
  const kinds = new Set(list.map((o) => o?.kind));
  for (const k of kinds) {
    if (!['label', 'add', 'channel-set', 'channel-remove'].includes(k)) {
      throw new OperationError('bad-request', `op kind "${k}" cannot batch (migrations are review-gated dispatches)`);
    }
  }
  const hasChannel = list.some((o) => o.kind === 'channel-set' || o.kind === 'channel-remove');
  if (hasChannel) requireRole(ctx, canManageRoles, 'superadmin');
  else requireRole(ctx, canBanGrandfather, 'admin');
  const { repo } = requireRepo(ctx);

  const files = [];
  const applied = [];
  const applyFile = async (relPath, opsForFile, applyOne, errType) => {
    if (!opsForFile.length) return;
    const raw = (await ctx.reader?.readFile?.(relPath)) || '';
    let parsed;
    try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
    let changed = false;
    for (const op of opsForFile) {
      let result;
      try { result = applyOne(parsed, op); }
      catch (err) { if (err instanceof errType) throw new OperationError('bad-request', `${op.kind} ${JSON.stringify(op.args)}: ${err.message}`); throw err; }
      if (result.changed) { parsed = result.next; changed = true; applied.push(op); }
    }
    if (changed) files.push({ path: relPath, content: leadingComment(raw) + dumpYaml(parsed) });
  };

  await applyFile(TAXONOMY_PATH, list.filter((o) => o.kind === 'label' || o.kind === 'add'), (parsed, op) => (
    op.kind === 'add'
      ? addCategoryEdit(parsed, { parentPath: op.args?.parentPath ?? [], key: op.args?.key, label: op.args?.label }, actionCtx(ctx))
      : renameLabelEdit(parsed, { path: op.args?.path, label: op.args?.label }, actionCtx(ctx))
  ), TaxonomyEditError);
  await applyFile(CONTENT_CHANNELS_PATH, list.filter((o) => o.kind === 'channel-set' || o.kind === 'channel-remove'), (parsed, op) => (
    op.kind === 'channel-set'
      ? setChannelEdit(parsed, { category: op.args?.category, channelId: op.args?.channelId }, actionCtx(ctx))
      : removeChannelEdit(parsed, { category: op.args?.category }, actionCtx(ctx))
  ), ContentChannelEditError);

  if (!files.length) return noop('every batched edit was already applied', { ops: list.length });
  const lines = Array.isArray(descriptions) && descriptions.length ? descriptions : list.map((o) => `${o.kind}: ${JSON.stringify(o.args)}`);
  const stamp = (ctx.now?.() ?? new Date().toISOString()).replace(/[^0-9]/g, '').slice(0, 14);
  const pr = await adminPublish(ctx, {
    repo,
    branch: `gbti/category-batch-${stamp}`,
    files,
    message: `Categories: ${applied.length} change${applied.length === 1 ? '' : 's'}`,
    title: `Categories: ${applied.length} change${applied.length === 1 ? '' : 's'}`,
    body: `Batched category-workspace edits (SOW-100):\n\n${lines.map((d) => `- ${d}`).join('\n')}`,
  });
  return { ...pr, changed: true, applied: applied.length, skipped: list.length - applied.length };
}

export async function setContentChannel(ctx, { category, channelId } = {}) {
  const slug = slugOf(String(category || ''));
  return editHouseYaml(ctx, CONTENT_CHANNELS_PATH, (parsed) => setChannelEdit(parsed, { category, channelId }, actionCtx(ctx)), {
    branch: `gbti/content-channel-set-${slug}`,
    message: `Map category ${category} to Discord channel ${channelId}`,
    title: `Map category to Discord channel: ${category}`,
    noopMsg: `category already mapped to that channel: ${category}`,
    errType: ContentChannelEditError,
  });
}

export async function removeContentChannel(ctx, { category } = {}) {
  const slug = slugOf(String(category || ''));
  return editHouseYaml(ctx, CONTENT_CHANNELS_PATH, (parsed) => removeChannelEdit(parsed, { category }, actionCtx(ctx)), {
    branch: `gbti/content-channel-remove-${slug}`,
    message: `Unmap category ${category} from its Discord channel`,
    title: `Unmap category channel: ${category}`,
    noopMsg: `no channel mapping for category: ${category}`,
    errType: ContentChannelEditError,
  });
}

export async function addModerationFlagTerm(ctx, { list, term } = {}) {
  const slug = slugOf(`${list}-${String(term || '').slice(0, 24)}`);
  return editHouseYaml(ctx, MODERATION_FLAGS_PATH, (parsed) => addFlagTermEdit(parsed, { list, term }, actionCtx(ctx)), {
    branch: `gbti/flag-term-add-${slug}`,
    message: `Add a ${list} moderation term`,
    title: `Add moderation term (${list})`,
    noopMsg: `term already in ${list}`,
    errType: ModerationFlagEditError,
  });
}

export async function removeModerationFlagTerm(ctx, { list, term } = {}) {
  const slug = slugOf(`${list}-${String(term || '').slice(0, 24)}`);
  return editHouseYaml(ctx, MODERATION_FLAGS_PATH, (parsed) => removeFlagTermEdit(parsed, { list, term }, actionCtx(ctx)), {
    branch: `gbti/flag-term-remove-${slug}`,
    message: `Remove a ${list} moderation term`,
    title: `Remove moderation term (${list})`,
    noopMsg: `term not in ${list}`,
    errType: ModerationFlagEditError,
  });
}

/** SOW-088: apply a BATCH of template edits as ONE house PR (the admin card's Save; per-field PRs raced
 *  each other on the same file). Each edit applies the pure setTemplate core over the same parsed doc;
 *  no-ops are skipped; the first invalid edit aborts the batch (nothing published). Superadmin. */
export async function setSyndicationTemplates(ctx, { edits } = {}) {
  requireRole(ctx, canManageRoles, 'superadmin');
  const { repo } = requireRepo(ctx);
  const list = Array.isArray(edits) ? edits : [];
  if (!list.length) return noop('no template edits', null);
  const raw = (await ctx.reader?.readFile?.(SYNDICATION_CONFIG_PATH)) || '';
  let parsed;
  try { parsed = yaml.load(raw) || {}; } catch { parsed = {}; }
  const audits = [];
  let doc = parsed;
  let changed = 0;
  for (const e of list) {
    let result;
    try { result = setTemplateEdit(doc, { type: e?.type, template: e?.template, channel: e?.channel, stub: e?.stub === true }, actionCtx(ctx)); }
    catch (err) { if (err instanceof TemplateEditError) throw new OperationError('bad-request', err.message); throw err; }
    doc = result.next;
    audits.push(result.audit);
    if (result.changed) changed++;
  }
  if (!changed) return noop('no template changes', audits);
  const pr = await adminPublish(ctx, {
    repo,
    branch: 'gbti/syndication-templates',
    files: [{ path: SYNDICATION_CONFIG_PATH, content: leadingComment(raw) + dumpYaml(doc) }],
    message: `Set ${changed} syndication template${changed === 1 ? '' : 's'}`,
    title: `Set syndication templates (${changed})`,
    body: prBody(null, audits),
    clobberOpenPull: true,
  });
  return { ...pr, changed: true, count: changed, audit: audits };
}

export async function setSyndicationTemplate(ctx, { type, template, channel, stub } = {}) {
  const slug = slugOf(`${channel ? `${channel}-` : ''}${stub ? 'stub-' : ''}${String(type || '')}`);
  const label = channel ? `${channel} ${type}` : type;
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setTemplateEdit(parsed, { type, template, channel, stub }, actionCtx(ctx)), {
    branch: `gbti/syndication-template-${slug}`,
    message: `Set the ${label} syndication template`,
    title: `Set syndication template: ${label}`,
    noopMsg: `template unchanged: ${label}`,
    errType: TemplateEditError,
  });
}

// SOW-088: the syndication pipeline settings (master switch, approval mode, hold window, channel switches).

/** Read the normalized pipeline settings for the manager UI. Public house data; read-only. */
export async function getSyndicationSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  const channels = {};
  for (const name of SYNDICATION_CHANNEL_NAMES) channels[name] = Boolean(cfg.channels?.[name]);
  // SOW-125: the per-type-per-channel auto-share matrix, the per-channel delay overrides, and the
  // channel-capability map so the UI derives auto/manual/building from ONE source (no stale "building" flags).
  const autoMatrix = {};
  for (const t of AUTO_TYPES) { autoMatrix[t] = {}; for (const ch of MATRIX_CHANNELS) autoMatrix[t][ch] = cfg.auto_matrix?.[t]?.[ch] ?? 'off'; }
  return {
    settings: {
      enabled: cfg.enabled, requireApproval: cfg.require_approval, holdMinutes: cfg.hold_minutes, channels,
      autoMatrix, channelHoldMinutes: { ...cfg.channel_hold_minutes },
    },
    channelNames: [...SYNDICATION_CHANNEL_NAMES],
    // SOW-125: matrixChannels (auto + manual) drive the matrix columns; autoChannels (auto-only) drive the
    // per-channel delay inputs; capability lets the UI derive auto/manual/building from ONE source.
    autoTypes: [...AUTO_TYPES], matrixChannels: [...MATRIX_CHANNELS], autoChannels: [...AUTO_CHANNELS], autoModes: [...AUTO_MODES], capability: { ...CHANNEL_CAPABILITY },
  };
}

export async function setSyndicationSettings(ctx, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setSyndicationSettingsEdit(parsed, { enabled, requireApproval, holdMinutes, channels, autoMatrix, channelHoldMinutes }, actionCtx(ctx)), {
    branch: 'gbti/syndication-settings',
    message: 'Set the syndication pipeline settings',
    title: 'Set syndication settings',
    noopMsg: 'syndication settings unchanged',
    errType: TemplateEditError,
  });
}

// SOW-111: the news engagement auto-share settings (house/syndication-config.yml `news_engagement`).

/** Read the normalized news engagement settings for the manager UI. Public data; read-only. */
export async function getNewsEngagementSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  return { settings: { ...newsEngagement(syndicationConfigFromParsed(parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS] };
}

export async function setNewsEngagementSettings(ctx, { enabled, openThreshold, tier, commentAutopost } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setNewsEngagementEdit(parsed, { enabled, openThreshold, tier, commentAutopost }, actionCtx(ctx)), {
    branch: 'gbti/news-engagement-set',
    message: 'Set the news engagement auto-share settings',
    title: 'Set news auto-share settings',
    noopMsg: 'news engagement settings unchanged',
    errType: TemplateEditError,
  });
}

// SOW-126: the content engagement auto-share settings (house/syndication-config.yml `content_engagement`),
// the `popular` matrix engine's tunables. Same shape as the news engagement settings above.

/** Read the normalized content engagement settings for the manager UI. Public data; read-only. */
export async function getContentEngagementSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  return { settings: { ...contentEngagement(syndicationConfigFromParsed(parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS], signals: [...CONTENT_ENGAGEMENT_SIGNALS] };
}

export async function setContentEngagementSettings(ctx, { enabled, threshold, tier, signals } = {}) {
  return editHouseYaml(ctx, SYNDICATION_CONFIG_PATH, (parsed) => setContentEngagementEdit(parsed, { enabled, threshold, tier, signals }, actionCtx(ctx)), {
    branch: 'gbti/content-engagement-set',
    message: 'Set content engagement auto-share settings',
    title: 'Set content engagement auto-share settings',
    noopMsg: 'content engagement settings unchanged',
    errType: TemplateEditError,
  });
}
