// Shared operations core (SOW-006). The managed abstractions, transport-agnostic: the CMS HTTP API
// (api.mjs) and the MCP tools (mcp-tools.mjs) both call these, so the human UI and a member's agents drive
// the EXACT same content-ops + publish flow. None of this decides privilege: it scopes to the member's own
// folder and forces the gated fields (via content-ops), but the SOW-005 gate remains authoritative.
//
// Errors are typed OperationError(code, ...) so each transport can map a code to its own shape (HTTP status
// or MCP isError). Codes: no-identity | not-authenticated | not-found | bad-request | invalid-content.
//
// This module is the PUBLIC SURFACE. The implementation lives in the operations-*.mjs siblings; this file
// re-exports exactly the names it always exported, so no caller changes. Add a new op to the sibling that
// owns its domain, then re-export it here.

export {
  CLIENT_VERSION,
  OperationError,
  getStatus,
} from './operations-core.mjs';

export {
  listContent,
  listMembersOnly,
  listShares,
  listShareComments,
  AUTHOR_NOTE_TYPES,
  _resetCommentsIndexCache,
  listComments,
  readContent,
  getContentItem,
  validateContent,
} from './operations-read.mjs';

export {
  authorContent,
  saveDraft,
  forkContentMatchesLive,
  listDrafts,
  readDraft,
  discardDraft,
  publishDraft,
  decryptMemberAsset,
} from './operations-drafts.mjs';

export {
  renameOriginOf,
  renameContent,
  setOwnContentStatus,
  syncForkIfCreatingBranch,
  publish,
  describeContentPublish,
  buildIntroCommentFile,
  planMemberFiles,
} from './operations-publish.mjs';

export {
  publishShare,
  publishComment,
  deleteComment,
  getComment,
  editComment,
} from './operations-social.mjs';

export {
  getMemberActivity,
  getMemberEarnings,
  mutateMemberActivity,
  getFollows,
  setFollow,
  upvoteContent,
  ogPreview,
  getSyndicationQueue,
  cancelSyndication,
  approveSyndication,
  getSocialQueue,
  socialQueueAction,
  getSyndicateNowInfo,
  syndicateNow,
  getNews,
  getNewsSources,
  getPrefs,
  setPrefs,
  publishNews,
  reflectNewsDiscussion,
  recordNewsOpen,
  recordContentOpen,
  getDiscordInvite,
  getDiscordLinkUrl,
  discordUnlink,
  getDiscordLinkStatus,
  getOnboardingStatus,
} from './operations-member.mjs';

export {
  getOverridesRoster,
  getOpenPulls,
  listDiscordChannels,
  getCouponUsageOp,
  listInvitesOp,
  createInviteOp,
  updateInviteOp,
  refreshCouponUntil,
  triggerAdminOp,
  listPRs,
  prStatus,
  listIncomingContributions,
  getContributionReview,
  reviewContribution,
  itemImagesDir,
  stageImage,
} from './operations-admin.mjs';
