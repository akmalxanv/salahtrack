import crypto from 'node:crypto';

/**
 * Primary and legacy session cookie names.
 * PRIMARY_SESSION_COOKIE ('namozlarim_session') is issued for new sessions under the Namozlarim / Namozlarim.uz rebrand.
 * LEGACY_SESSION_COOKIE ('salahtrack_session') is maintained and accepted for seamless backwards compatibility.
 */
export const PRIMARY_SESSION_COOKIE = 'namozlarim_session';
export const LEGACY_SESSION_COOKIE = 'salahtrack_session';
export const SESSION_COOKIE_NAME = PRIMARY_SESSION_COOKIE;

/**
 * Session durations:
 * - Standard: 7 days (604,800 seconds)
 * - Remember Me: 30 days (2,592,000 seconds)
 */
export const STANDARD_SESSION_DURATION_SECONDS = 7 * 24 * 60 * 60;
export const REMEMBER_ME_SESSION_DURATION_SECONDS = 30 * 24 * 60 * 60;

export const STANDARD_SESSION_DURATION_MS = STANDARD_SESSION_DURATION_SECONDS * 1000;
export const REMEMBER_ME_SESSION_DURATION_MS = REMEMBER_ME_SESSION_DURATION_SECONDS * 1000;

export interface SessionCookieOptions {
  name: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
  path: string;
  maxAge: number;
}

/**
 * Generates a cryptographically secure, unpredictable 256-bit session token.
 * Uses node:crypto randomBytes to guarantee high entropy.
 *
 * @returns A 64-character hexadecimal session token string.
 */
export function generateSessionToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Returns security-hardened cookie configuration options for session persistence.
 *
 * Security attributes:
 * - HttpOnly: true (prevents client-side scripts from reading the cookie, mitigating XSS token theft)
 * - Secure: true in production (prevents transmission over unencrypted HTTP)
 * - SameSite: 'lax' (mitigates CSRF on cross-site requests while permitting top-level navigation)
 * - Path: '/' (available across all application routes)
 *
 * @param rememberMe When true, session lifetime is extended from 7 to 30 days.
 * @param cookieName Cookie identifier (defaults to PRIMARY_SESSION_COOKIE).
 */
export function getSessionCookieOptions(
  rememberMe: boolean = false,
  cookieName: string = PRIMARY_SESSION_COOKIE
): SessionCookieOptions {
  const maxAge = rememberMe
    ? REMEMBER_ME_SESSION_DURATION_SECONDS
    : STANDARD_SESSION_DURATION_SECONDS;

  return {
    name: cookieName,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/**
 * Returns cookie options with maxAge=0 for immediate session cookie destruction upon logout.
 *
 * @param cookieName Cookie identifier to expire (defaults to PRIMARY_SESSION_COOKIE).
 */
export function getExpiredSessionCookieOptions(
  cookieName: string = PRIMARY_SESSION_COOKIE
): SessionCookieOptions {
  return {
    name: cookieName,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  };
}

/**
 * Computes the exact expiration Date for session records saved to MongoDB Atlas.
 * Used alongside the MongoDB TTL index (expires: 0) for automated document cleanup.
 *
 * @param rememberMe Whether the session was requested with extended duration.
 */
export function calculateSessionExpiry(rememberMe: boolean = false): Date {
  const durationMs = rememberMe
    ? REMEMBER_ME_SESSION_DURATION_MS
    : STANDARD_SESSION_DURATION_MS;

  return new Date(Date.now() + durationMs);
}
