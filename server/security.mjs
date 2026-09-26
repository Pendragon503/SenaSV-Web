import { randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function parseCookies(header) {
  const jar = {};
  if (!header) return jar;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!name) continue;
    try {
      jar[name] = decodeURIComponent(value);
    } catch {
      jar[name] = value;
    }
  }
  return jar;
}

/**
 * @param {string} name
 * @param {string} value pass '' with maxAgeSeconds 0 to clear the cookie
 * @param {{ maxAgeSeconds?: number, httpOnly?: boolean, secure?: boolean, sameSite?: 'Lax'|'Strict'|'None', path?: string }} options
 */
export function serializeCookie(name, value, options = {}) {
  const {
    maxAgeSeconds,
    httpOnly = false,
    secure = true,
    sameSite = 'Lax',
    path = '/',
  } = options;
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (typeof maxAgeSeconds === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`);
  if (httpOnly) parts.push('HttpOnly');
  // SameSite=None requires Secure per spec; enforce it regardless of the flag passed in.
  if (secure || sameSite === 'None') parts.push('Secure');
  return parts.join('; ');
}

export function appendSetCookie(response, cookieString) {
  const existing = response.getHeader('Set-Cookie');
  if (!existing) {
    response.setHeader('Set-Cookie', cookieString);
  } else if (Array.isArray(existing)) {
    response.setHeader('Set-Cookie', [...existing, cookieString]);
  } else {
    response.setHeader('Set-Cookie', [existing, cookieString]);
  }
}

// ---------------------------------------------------------------------------
// Passwords (scrypt, no external deps)
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 64;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN, SCRYPT_PARAMS);
  return `scrypt:${SCRYPT_PARAMS.N}:${SCRYPT_PARAMS.r}:${SCRYPT_PARAMS.p}:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const segments = String(stored || '').split(':');
  if (segments.length !== 6 || segments[0] !== 'scrypt') return false;
  const [, nStr, rStr, pStr, saltHex, hashHex] = segments;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const derived = scryptSync(password, salt, expected.length, {
    N: Number(nStr),
    r: Number(rStr),
    p: Number(pStr),
  });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Session tokens: the raw token lives only in the cookie; the DB stores a
// SHA-256 hash of it so a database leak alone cannot be replayed as a session.
// ---------------------------------------------------------------------------

export function generateSessionToken() {
  return randomBytes(32).toString('hex');
}

export function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

// ---------------------------------------------------------------------------
// CORS (credentialed): only ever reflects an explicitly allow-listed origin,
// never '*', since cookies require a concrete origin plus Allow-Credentials.
// ---------------------------------------------------------------------------

export function applyCors(response, origin, allowedOrigins) {
  if (allowedOrigins.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

// ---------------------------------------------------------------------------
// Generic sliding-window rate limiter, namespaced per caller.
// ---------------------------------------------------------------------------

export function createRateLimiter(maxPerWindow, windowMs) {
  const buckets = new Map();
  return function consume(key) {
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || now - bucket.startedAt > windowMs) {
      buckets.set(key, { startedAt: now, count: 1 });
      return true;
    }
    bucket.count += 1;
    return bucket.count <= maxPerWindow;
  };
}
