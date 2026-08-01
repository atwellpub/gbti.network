// The browser wrapper over member-gate-core.mjs (the node-testable resolver). A gated page calls
// resolveMemberSession({ base }) and branches on the returned state: 'in' -> mount; 'out' -> the page's
// signed-out path (redirect / sign-in CTA); 'error' -> a transient failure, keep the session and show a soft
// retry (never a forced logout). See member-gate-core.mjs for the rationale (the re-login fix).
import { resolveMemberSession as coreResolve } from './member-gate-core.mjs';

export type MemberSession =
  | { state: 'in'; payload: any }
  | { state: 'out' }
  | { state: 'error' };

/** Resolve the signed-in member from /membership/status over the cookie session, retrying a transient failure so
 *  a momentary blip never bounces a valid session to /login. `fetchImpl` defaults to the real fetch. */
export function resolveMemberSession(opts: { base: string; fetchImpl?: typeof fetch; retries?: number }): Promise<MemberSession> {
  return coreResolve({ fetchImpl: opts.fetchImpl ?? fetch, ...opts }) as Promise<MemberSession>;
}
