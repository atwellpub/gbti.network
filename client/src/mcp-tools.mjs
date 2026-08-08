// MCP managed-abstraction tools (SOW-006). A minimal, dependency-free MCP (JSON-RPC 2.0) layer so a
// member's AI agents author through the SAME content-ops + publish flow as the CMS UI. Tool handlers call
// the shared operations core; the gate stays authoritative. Both transports use this: stdio (mcp-stdio.mjs,
// a trusted spawned child) and the hardened HTTP server (POST /mcp, behind localhost + token + Origin/Host).
//
// We implement the small slice of MCP we need (initialize, tools/list, tools/call) rather than pull an SDK,
// matching this repo's no-SDK pattern and keeping it unit-testable with no install.

import {
  OperationError,
  CLIENT_VERSION,
  getStatus,
  listContent,
  getContentItem,
  validateContent,
  publish,
  authorContent,
  listPRs,
  prStatus,
  listIncomingContributions,
  getContributionReview,
  reviewContribution,
  publishComment,
  editComment,
  listComments,
  publishShare,
  ogPreview,
  listDrafts,
  readDraft,
  discardDraft,
  publishDraft,
} from './operations.mjs';
import { startDeviceLogin, confirmDeviceLogin, logout } from './mcp-auth.mjs';

const PROTOCOL_VERSION = '2024-11-05';

const obj = (properties, required = []) => ({ type: 'object', properties, required, additionalProperties: true });
const TYPE_ENUM = { type: 'string', enum: ['post', 'product', 'prompt', 'profile'] };
// SOW-106: the REQUIRED author intent. "published" merges to the network (public); "draft" stages on the fork.
const STATUS_ENUM = { type: 'string', enum: ['draft', 'published'], description: 'REQUIRED: "published" merges and goes live on the network; "draft" stages on your fork for review.' };
const COMMENT_TARGET = { type: 'string', enum: ['post', 'product', 'prompt', 'share', 'news'] }; // SOW-072
// sow-193: `path` + `scope`, which authorContent forwards to publish()/saveDraft() now. `path` is what turns a
// re-publish under a changed slug into a RENAME (one PR that moves the item and 301s the old URL) instead of a
// duplicate item with the old page still live. `scope` targets the non-member house/ folder (superadmin only,
// re-checked server-side); omit it for your own folder.
const PATH_PARAM = { type: 'string', description: 'The repo path of the EXISTING item you are editing (members/<you>/<type>s/<slug>/index.md). Pass it whenever the item already exists: it preserves publishedAt, carries redirectFrom, and makes a changed slug a rename rather than a duplicate.' };
const SCOPE_PARAM = { type: 'string', enum: ['member', 'house'], description: 'Target folder. "member" (default) is your own folder; "house" is the non-member house/ content and is superadmin-only, re-checked server-side.' };

// The managed-abstraction tools. Each handler returns a plain JSON-serializable result (or throws an
// OperationError); dispatch() wraps it into MCP tool-call content.
export const TOOLS = [
  {
    name: 'login',
    description: 'Start GitHub sign-in via device flow (the shared GBTI OAuth app; no Chrome/extension needed). Returns a verification URL + code for the member to approve, then call `login_confirm`.',
    inputSchema: obj({}),
    handler: (ctx) => startDeviceLogin(ctx),
  },
  {
    name: 'login_confirm',
    description: 'Finish the sign-in started by `login`: poll for the member approval. Returns { pending: true } until approved (call again), then { ok: true } with the identity. Persists the token locally so publishing works with Chrome closed.',
    inputSchema: obj({}),
    handler: (ctx) => confirmDeviceLogin(ctx),
  },
  {
    name: 'logout',
    description: 'Sign out locally (clears the stored token + identity).',
    inputSchema: obj({}),
    handler: (ctx) => logout(ctx),
  },
  {
    name: 'whoami',
    description: 'Return the signed-in identity, membership/auth status, and client settings.',
    inputSchema: obj({}),
    handler: (ctx) => getStatus(ctx),
  },
  {
    name: 'list_my_content',
    description: "List the member's own content (posts/products/prompts/profile). Optional `type` filter.",
    inputSchema: obj({ type: TYPE_ENUM, scope: SCOPE_PARAM }),
    handler: (ctx, args) => listContent(ctx, { type: args?.type, scope: args?.scope }),
  },
  {
    name: 'get_content',
    description: "Read one of the member's own content files (frontmatter + body) by repo `path`.",
    inputSchema: obj({ path: { type: 'string' } }, ['path']),
    handler: (ctx, args) => getContentItem(ctx, { path: args?.path }),
  },
  {
    name: 'validate_content',
    description: 'Validate a content object against the schema WITHOUT publishing. Returns { valid, path | error, issues }.',
    inputSchema: obj({ type: TYPE_ENUM, input: { type: 'object' }, body: { type: 'string' } }, ['type', 'input']),
    handler: (ctx, args) => validateContent(ctx, { type: args?.type, input: args?.input, body: args?.body }),
  },
  {
    name: 'publish_content',
    description: 'Author a content object. REQUIRED `status`: "published" merges it (public, goes live on the network) and returns the PR number + url; "draft" stages it on your fork for review (no PR). Forces author/owner fields; goes through the gate. For a new product/prompt, pass `authorNote` (markdown) to seed the required SOW-014 from-the-author intro comment into the SAME PR.',
    inputSchema: obj(
      { type: TYPE_ENUM, input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM },
      ['type', 'input', 'status'],
    ),
    handler: (ctx, args) => authorContent(ctx, args ?? {}),
  },
  // SOW-025: per-type "add content" shortcuts so an agent gets guided tools instead of the generic
  // publish_content. Each pre-sets `type` and forwards to the same gated publish flow (author is forced to the
  // signed-in member; publishing is paid-only). Call validate_content first if unsure which fields are required.
  {
    name: 'add_prompt',
    description: 'Author a PROMPT. REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" stages it on your fork for review. input requires: title, slug (kebab-case), shortDescription; optional: targets[], categories[] (taxonomy path), tags[], variables[], sourceUrl. The markdown `body` is the prompt text. author is forced to you. SOW-014: a new prompt needs a from-the-author intro, so pass `authorNote` (markdown) and it publishes as your public intro comment in the SAME PR.',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'prompt' }),
  },
  {
    name: 'add_product',
    description: 'Author a PRODUCT. REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" stages it on your fork for review. input requires: title, slug, shortDescription, icon (repo image path), featuredImage (16:10 repo image path); optional: categories[], tags[], pricing, links[]. The markdown `body` is the product description. author is forced to you. SOW-014: a new product needs a from-the-author intro, so pass `authorNote` (markdown) and it publishes as your public intro comment in the SAME PR. (Attach images via the repo first; an MCP image-upload tool is a follow-on.)',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, authorNote: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'product' }),
  },
  {
    name: 'add_post',
    description: 'Author a BLOG POST. REQUIRED `status`: "published" publishes it live (a PR that merges), "draft" stages it on your fork for review. input requires: title, slug (kebab-case); optional: excerpt, categories[], tags[], coverImage, publishedAt. The markdown `body` is the article. author is forced to you.',
    inputSchema: obj({ input: { type: 'object' }, status: STATUS_ENUM, body: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' }, path: PATH_PARAM, scope: SCOPE_PARAM }, ['input', 'status']),
    handler: (ctx, args) => authorContent(ctx, { ...(args ?? {}), type: 'post' }),
  },
  // sow-193: the DRAFT lifecycle. These four operations existed and were tested since SOW-082 but none was
  // exposed as a tool, so an agent could create a draft with status:"draft" and then never list, read, publish
  // or discard it. A fork-staged draft is at least a visible branch on the member's own GitHub; a hosted draft
  // lives in private KV, so the hole was about to get worse. Thin wrappers, no new logic.
  {
    name: 'list_drafts',
    description: 'List your staged drafts (items saved with status:"draft" and not yet published). Optional `type` filter. Each row carries its type, slug, title, whether it still validates against the current schema, and its pull request if one is open.',
    inputSchema: obj({ type: TYPE_ENUM }),
    handler: (ctx, args) => listDrafts(ctx, { type: args?.type }),
  },
  {
    name: 'read_draft',
    description: 'Read one staged draft (frontmatter + body) by `type` and `slug`, so you can revise it before publishing.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' } }, ['type', 'slug']),
    handler: (ctx, args) => readDraft(ctx, { type: args?.type, slug: args?.slug }),
  },
  {
    name: 'publish_draft',
    description: 'Publish a staged draft: opens the gated pull request from the draft branch it is already on. Paid-only, like every publish.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } }, ['type', 'slug']),
    handler: (ctx, args) => publishDraft(ctx, { type: args?.type, slug: args?.slug, title: args?.title, prBody: args?.prBody }),
  },
  {
    name: 'discard_draft',
    description: 'Discard a staged draft and delete its branch. Refused while the draft has an open pull request: withdraw the pull request first. This is not reversible, so confirm with the member before calling it.',
    inputSchema: obj({ type: TYPE_ENUM, slug: { type: 'string' } }, ['type', 'slug']),
    handler: (ctx, args) => discardDraft(ctx, { type: args?.type, slug: args?.slug }),
  },
  {
    name: 'list_prs',
    description: "List the member's open pull requests upstream.",
    inputSchema: obj({}),
    handler: (ctx) => listPRs(ctx),
  },
  {
    name: 'pr_status',
    description: 'Read the gate status (held vs mergeable) for one of the member PRs by `number`.',
    inputSchema: obj({ number: { type: 'integer' } }, ['number']),
    handler: (ctx, args) => prStatus(ctx, { number: args?.number }),
  },
  {
    name: 'list_contributions',
    description: "List incoming contributions to review: open pull requests another member opened against the signed-in member's own folder, awaiting their approval (SOW-028).",
    inputSchema: obj({}),
    handler: (ctx) => listIncomingContributions(ctx),
  },
  {
    name: 'get_contribution',
    description: 'Read one incoming contribution by PR `number`: its per-file unified diff and the proposed new body of each changed markdown file (SOW-028).',
    inputSchema: obj({ number: { type: 'integer' } }, ['number']),
    handler: (ctx, args) => getContributionReview(ctx, { number: args?.number }),
  },
  {
    name: 'review_contribution',
    description: "Decide an incoming contribution to your folder: approve (merges + awards), request-changes, or decline (closes it). The client never merges directly; approve submits a GitHub review the gate reads. Args: number, decision ('approve'|'request-changes'|'decline'), optional message (SOW-028).",
    inputSchema: obj(
      { number: { type: 'integer' }, decision: { type: 'string', enum: ['approve', 'request-changes', 'decline'] }, message: { type: 'string' } },
      ['number', 'decision'],
    ),
    handler: (ctx, args) => reviewContribution(ctx, { number: args?.number, decision: args?.decision, message: args?.message }),
  },
  // SOW-072: commenting via MCP — author the SAME members-only (encrypted) comment + author-intro flow the CMS UI
  // uses, through the gated PR pipeline. targetSlug: the content slug for a post/product/prompt; "<author>/<shareId>"
  // for a Share (SOW-032); the news targetSlug for news. The server forces visibility (only an authorNote intro on
  // your own post/product/prompt is public; every reply, and ALL Share comments, are members-only + encrypted).
  {
    name: 'post_comment',
    description: 'Post a comment as a pull request (members-only + encrypted unless it is a public from-the-author intro). input: targetType ("post"|"product"|"prompt"|"share"|"news"), targetSlug (content slug, or "<author>/<shareId>" for a share), body (markdown). optional: authorNote (true = a public "from the author" intro, valid only on your own post/product/prompt), parentId (reply), message/title/prBody. author is forced to you; paid-only; goes through the gate. Returns the PR number + url.',
    inputSchema: obj(
      { targetType: COMMENT_TARGET, targetSlug: { type: 'string' }, body: { type: 'string' }, authorNote: { type: 'boolean' }, parentId: { type: 'string' }, message: { type: 'string' }, title: { type: 'string' }, prBody: { type: 'string' } },
      ['targetType', 'targetSlug', 'body'],
    ),
    handler: (ctx, args) => publishComment(ctx, args ?? {}),
  },
  {
    name: 'edit_comment',
    description: 'Edit one of your own comments by `id` (re-publishes through the gate; visibility is re-derived and a members body is re-encrypted). Args: id, body (markdown), optional authorNote.',
    inputSchema: obj({ id: { type: 'string' }, body: { type: 'string' }, authorNote: { type: 'boolean' } }, ['id', 'body']),
    handler: (ctx, args) => editComment(ctx, { id: args?.id, body: args?.body, authorNote: args?.authorNote }),
  },
  // sow-181: post a SHARE from an agent. A Share is a link to something worth reading, so the tool takes a url
  // and does the OG extraction ITSELF (ogPreview, the same SSRF-guarded Worker route the extension composer
  // uses) rather than making the caller pre-fetch metadata. `visibility` is REQUIRED with no default so the
  // agent has to ask the member public-or-members before anything is written: the schema default is `members`,
  // and silently defaulting would quietly hide a share the member meant to publish, or publish one they meant
  // to keep in the members stream.
  {
    name: 'add_share',
    description: 'Post a SHARE (a link to something worth reading) to the network. REQUIRED `url` and REQUIRED `visibility`: "public" (anyone can see it, and it may syndicate) or "members" (the members-only stream, body encrypted). ALWAYS ask the member which one they want before calling; never guess. Title, description and image are auto-extracted from the url unless you pass them. Optional: title, shortDescription, image, category (one flat topic key), tags[], body (your own note about the link). author is forced to you; posting a Share is paid-only and goes through the gate. Returns the PR number + url.',
    inputSchema: obj(
      {
        url: { type: 'string', description: 'The link being shared (absolute http/https URL).' },
        visibility: { type: 'string', enum: ['public', 'members'], description: 'REQUIRED: ask the member. "public" is visible to everyone and may syndicate to social channels; "members" stays in the members-only stream.' },
        title: { type: 'string' },
        shortDescription: { type: 'string' },
        image: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        body: { type: 'string', description: 'Optional note in your own words about why the link is worth reading.' },
        message: { type: 'string' }, prBody: { type: 'string' },
      },
      ['url', 'visibility'],
    ),
    handler: (ctx, args) => addShare(ctx, args ?? {}),
  },
  {
    name: 'preview_link',
    description: 'Fetch the OpenGraph metadata for a url (title, description, image) WITHOUT posting anything. Useful to show the member what a Share will look like before calling add_share. Server-side and SSRF-guarded.',
    inputSchema: obj({ url: { type: 'string' } }, ['url']),
    handler: (ctx, args) => ogPreview(ctx, { url: args?.url }),
  },
  {
    name: 'list_comments',
    description: 'Read the published comment thread for a target. Args: targetType ("post"|"product"|"prompt"|"share"|"news"), targetSlug (content slug, or "<author>/<shareId>" for a share), optional limit. Reads merged/published comments (a just-posted comment appears after its PR merges + the site deploys).',
    inputSchema: obj({ targetType: COMMENT_TARGET, targetSlug: { type: 'string' }, limit: { type: 'integer' } }, ['targetType', 'targetSlug']),
    handler: (ctx, args) => listComments(ctx, { targetType: args?.targetType, targetSlug: args?.targetSlug, limit: args?.limit }),
  },
];

/**
 * sow-181: add_share = extract THEN publish, in one call.
 *
 * The OG fetch is best-effort on purpose: a link whose metadata cannot be read (a 403, a site with no OG
 * tags, a timeout) must still be shareable, so a failed extraction degrades to the url alone rather than
 * failing the share. Anything the caller passed explicitly always wins over the extracted value, so an agent
 * can correct a bad title without losing the rest.
 */
export async function addShare(ctx, args = {}) {
  const url = String(args.url || '').trim();
  if (!url) throw new OperationError('bad-request', 'url is required');
  const visibility = args.visibility;
  if (visibility !== 'public' && visibility !== 'members') {
    throw new OperationError('bad-request', 'visibility is required and must be "public" or "members". Ask the member which they want before posting.');
  }
  let og = null;
  try { og = await ogPreview(ctx, { url }); } catch { og = null; } // best-effort: never block a share on extraction
  const input = stripBlank({
    url,
    visibility,
    title: args.title ?? og?.title,
    shortDescription: args.shortDescription ?? og?.description,
    image: args.image ?? og?.image,
    category: args.category,
    tags: Array.isArray(args.tags) ? args.tags : undefined,
  });
  // NB: publishShare's `title` is the PULL REQUEST title, not the share's. Leave it unset so it derives
  // "New Share: <share title>" itself; passing args.title here would conflate the two.
  return publishShare(ctx, { input, body: args.body ?? '', message: args.message, prBody: args.prBody });
}

const stripBlank = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function toolText(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

/**
 * Handle one JSON-RPC message. Returns a response object, or null for notifications (no id). Never throws:
 * tool/operation errors become an isError tool result or a JSON-RPC error.
 */
export async function dispatch(message, ctx) {
  const { id, method, params } = message ?? {};
  const isNotification = id === undefined || id === null;

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: { tools: {} },
      serverInfo: { name: 'gbti-network', version: CLIENT_VERSION },
    });
  }

  if (method === 'notifications/initialized' || method === 'initialized') {
    return null; // notification, no response
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  }

  if (method === 'tools/call') {
    const tool = TOOLS_BY_NAME.get(params?.name);
    if (!tool) return rpcError(id, -32602, `unknown tool: ${params?.name}`);
    try {
      const result = await tool.handler(ctx, params?.arguments ?? {});
      return rpcResult(id, toolText(result));
    } catch (err) {
      // Surface operation errors as an MCP tool error (so the agent sees the reason), not a transport error.
      const detail = err instanceof OperationError
        ? { error: err.code, message: err.message, ...(err.details ? { issues: err.details } : {}) }
        : { error: 'internal_error', message: err?.message };
      return rpcResult(id, { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }], isError: true });
    }
  }

  if (isNotification) return null;
  return rpcError(id, -32601, `method not found: ${method}`);
}
