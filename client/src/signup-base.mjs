// The signup Worker base URL (SOW-002 / SOW-011 / SOW-016). Kept in its own NODE-FREE module so importing it
// (e.g. from operations.mjs, which the Chrome extension bundles) never drags in the node-only settings/autostart
// graph. Override locally with GBTI_SIGNUP_BASE; defaults to production.
export const SIGNUP_BASE = (globalThis.process?.env?.GBTI_SIGNUP_BASE) || 'https://signup.gbti.network';

// The PUBLIC device-flow GitHub OAuth app client id. Public by design (device flow has no client secret), so it
// ships in BOTH the extension and the npm client; the same app serves local + production. Override with
// GBTI_GITHUB_CLIENT_ID (node only); the extension bundles the baked default. (globalThis.process is undefined in
// the MV3 service worker, so the optional chaining safely falls through to the default there.)
export const GITHUB_CLIENT_ID = (globalThis.process?.env?.GBTI_GITHUB_CLIENT_ID) || 'Ov23limR5x7taIm33sTY';

// SOW-026: the GitHub APP path (per-repo least privilege). A GitHub App's user-to-server token can be scoped to
// ONLY the member's fork (contents:write + pull_requests:write on the fork), unlike the classic OAuth app whose
// public_repo scope is account-wide. The device flow works the same for a GitHub App (no client secret), so the
// only client-side change is the client id + dropping the (ignored) OAuth scope; the App's slug drives the
// install deep-links + install-detection. PLACEHOLDERS until the App is provisioned (set GBTI_GITHUB_APP_CLIENT_ID
// + the slug at M0). The canonical upstream repo the member forks.
export const GITHUB_APP_CLIENT_ID = (globalThis.process?.env?.GBTI_GITHUB_APP_CLIENT_ID) || 'Iv1.gbti-app-placeholder';
export const GITHUB_APP_SLUG = (globalThis.process?.env?.GBTI_GITHUB_APP_SLUG) || 'gbti-network';
export const UPSTREAM_REPO = (globalThis.process?.env?.GBTI_UPSTREAM_REPO) || 'gbti-network/gbti.network';

// AUTH_MODE = 'classic' (today, account-wide public_repo) | 'app' (SOW-026, fork-scoped GitHub App) |
// 'hosted' (SOW-156 spike: identity-only sign-in, no fork, no install; the Worker does the git work).
// Defaults to classic so nothing changes until a mode is explicitly set via GBTI_AUTH_MODE.
const rawAuthMode = globalThis.process?.env?.GBTI_AUTH_MODE;
export const AUTH_MODE = rawAuthMode === 'app' ? 'app' : rawAuthMode === 'hosted' ? 'hosted' : 'classic';
export const isAppMode = () => AUTH_MODE === 'app';
export const isHostedMode = () => AUTH_MODE === 'hosted';
/** The device-flow client id for the active auth mode. Hosted uses the App id too (identity-only: with no
 *  install granted, an App user token identifies the member and can touch nothing else). */
export const activeClientId = () => (AUTH_MODE === 'classic' ? GITHUB_CLIENT_ID : GITHUB_APP_CLIENT_ID);
/** The OAuth scope for the active mode. GitHub Apps IGNORE scope (permissions come from the install), so app +
 *  hosted send an empty scope; classic keeps the account-wide public_repo read:user it has always used. */
export const activeScope = () => (AUTH_MODE === 'classic' ? 'public_repo read:user' : '');
