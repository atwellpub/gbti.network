// sow-158 Phase 1b: CORS for the signup Worker. The bearer-token API stayed safe with a wildcard origin and NO
// credentials (there was no ambient cookie to ride). The website session adds a cookie, so the cookie-eligible
// routes MUST switch to a credentialed policy: a reflected, allow-listed Origin + Access-Control-Allow-Credentials.
// A wildcard origin can NEVER co-occur with credentials (the browser rejects it, and it would be an any-origin
// credential leak), so the two modes are kept strictly separate here. The allow-list is shared with the CSRF
// Origin check (csrf.mjs) via parseAllowedOrigins so they can never drift.

const DEFAULT_ALLOWED_ORIGINS = ['https://gbti.network'];

/**
 * The set of Origins allowed to make credentialed (cookie) calls. Configured by the non-secret
 * CORS_ALLOWED_ORIGINS wrangler var (comma-separated); a dev host adds http://localhost:4321 via .dev.vars.
 * Falls back to the production apex so a missing var fails closed to the tightest safe default (not open).
 */
export function parseAllowedOrigins(env) {
  const raw = typeof env?.CORS_ALLOWED_ORIGINS === 'string' ? env.CORS_ALLOWED_ORIGINS : '';
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return new Set(list.length ? list : DEFAULT_ALLOWED_ORIGINS);
}

/**
 * Build the CORS response headers for a route.
 * - credentials:false (the default; the legacy bearer-only routes): the existing wildcard shape. Safe because
 *   there is no ambient credential to ride, and it keeps the extension/npm hosts working from any origin.
 * - credentials:true (the cookie-eligible routes): reflect the request Origin ONLY if it is allow-listed, and
 *   add Access-Control-Allow-Credentials + the X-GBTI-CSRF allow-header. A non-allow-listed origin gets NO
 *   Access-Control-Allow-Origin, so the browser blocks the credentialed read. `Vary: Origin` is always present
 *   on this branch so a shared cache can never serve one origin's reflected ACAO to another.
 */
export function corsHeaders(request, env, { credentials = false, methods = 'GET, POST, OPTIONS' } = {}) {
  if (!credentials) {
    return {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Allow-Methods': methods,
    };
  }

  const origin = request.headers.get('Origin');
  const allowed = parseAllowedOrigins(env);
  const headers = {
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-GBTI-CSRF',
    'Access-Control-Allow-Methods': methods,
    // Reflecting Origin means the response varies by it; keep Authorization too since the same routes also serve
    // per-token bodies. A shared cache must key on both (these responses also carry Cache-Control: no-store).
    Vary: 'Origin, Authorization',
  };
  if (origin && allowed.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }
  return headers;
}
