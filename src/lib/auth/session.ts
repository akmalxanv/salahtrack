import crypto from 'node:crypto';

/**
 * Standard cookie name for the authenticated session identifier.
 * Stored strictly on the server and transmitted via secure HttpOnly cookie.
 */
export const SESSION_COOKIE_NAME = 'salahtrack_session';

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
 */
export function getSessionCookieOptions(rememberMe: boolean = false): SessionCookieOptions {
  const maxAge = rememberMe
    ? REMEMBER_ME_SESSION_DURATION_SECONDS
    : STANDARD_SESSION_DURATION_SECONDS;

  return {
    name: SESSION_COOKIE_NAME,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  };
}

/**
 * Returns cookie options with maxAge=0 for immediate session cookie destruction upon logout.
 */
export function getExpiredSessionCookieOptions(): SessionCookieOptions {
  return {
    name: SESSION_COOKIE_NAME,
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
