// Lightweight signed session for the signup Worker (SOW-002, membership-and-access.md section 3).
// The session is a cookie keyed by github_id. It is signed (not encrypted) with HMAC SHA-256 over
// SESSION_SECRET using Web Crypto, which is available in Cloudflare Workers and in Node 22. The
// payload carries no PII beyond github_id and github_login so a leaked cookie reveals nothing
// sensitive. Verification is constant-time and fail-closed: any tampering, a bad signature, an
// expired token, or a malformed cookie returns null (no session).

const COOKIE_NAME = 'gbti_session';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

const enc = new TextEncoder();

/** base64url encode bytes or a UTF-8 string without padding. */
function b64urlEncode(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url decode to a Uint8Array. Returns null on any malformed input (fail closed). */
function b64urlDecodeBytes(str) {
  if (typeof str !== 'string' || str.length === 0) return null;
  try {
    const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
    const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function b64urlDecodeString(str) {
  const bytes = b64urlDecodeBytes(str);
  if (!bytes) return null;
  try {
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

async function importKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
}

async function hmac(secret, message) {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return b64urlEncode(sig);
}

/** Constant-time compare of two strings. Avoids leaking signature length-prefix matches via timing. */
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Sign a session token: base64url(JSON payload).signature. The payload carries github_id, login,
 * an issued-at (iat) and an expiry (exp) so a stolen cookie ages out. No PII beyond id + login.
 */
export async function signSession({ githubId, githubLogin }, secret, { ttlSeconds = DEFAULT_TTL_SECONDS, now = Date.now() } = {}) {
  if (!secret) throw new Error('signSession: SESSION_SECRET is required');
  if (!githubId) throw new Error('signSession: githubId is required');
  const iat = Math.floor(now / 1000);
  const payload = {
    github_id: String(githubId),
    github_login: githubLogin ? String(githubLogin) : undefined,
    iat,
    exp: iat + ttlSeconds,
  };
  const body = b64urlEncode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${body}.${sig}`;
}

/**
 * Verify a session token. Returns the payload ({ github_id, github_login, iat, exp }) on success or
 * null on any failure: malformed token, bad signature, or expiry passed. Fail closed.
 */
export async function verifySession(token, secret, { now = Date.now() } = {}) {
  if (!secret || typeof token !== 'string') return null;
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (!timingSafeEqual(sig, expected)) return null;
  const json = b64urlDecodeString(body);
  if (json === null) return null;
  let payload;
  try {
    payload = JSON.parse(json);
  } catch {
    return null;
  }
  if (!payload || typeof payload.github_id !== 'string') return null;
  if (typeof payload.exp === 'number' && Math.floor(now / 1000) >= payload.exp) return null;
  return payload;
}

/**
 * Build a Set-Cookie header value for the session. HttpOnly + Secure + SameSite=Lax + Path=/, host-only.
 * `secure` defaults true (production over HTTPS). sow-158 Phase 1b: a dev host over http://localhost can pass
 * secure:false so the browser will store the cookie; this is gated on an env flag by the caller, never on by
 * default (a non-Secure session cookie in production would be sent over plain HTTP).
 */
export function sessionCookieHeader(token, { ttlSeconds = DEFAULT_TTL_SECONDS, secure = true } = {}) {
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Max-Age=${ttlSeconds}`,
  ];
  return attrs.join('; ');
}

/** Extract the raw session token from a Cookie request header, or null if absent. */
export function readSessionCookie(cookieHeader) {
  if (typeof cookieHeader !== 'string') return null;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const name = part.slice(0, eq).trim();
    if (name === COOKIE_NAME) return part.slice(eq + 1).trim();
  }
  return null;
}

export { COOKIE_NAME };
