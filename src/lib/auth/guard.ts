import { cookies } from 'next/headers.js';
import { NextRequest } from 'next/server.js';
import { connectDB, execLean } from '../mongodb.ts';
import { User, type IUser } from '../../models/User.ts';
import { Session, type ISession } from '../../models/Session.ts';
import { PRIMARY_SESSION_COOKIE, LEGACY_SESSION_COOKIE } from './session.ts';

/**
 * Sanitized public profile of an authenticated user.
 * Guaranteed to never contain password hashes, reset tokens, or private credentials.
 */
export interface SafeUser {
  id: string;
  name: string;
  email: string;
  username: string;
  role: 'user' | 'admin';
  preferences: {
    language: 'uz' | 'ru' | 'en';
    calculationMethod?: string;
    showOnLeaderboard: boolean;
    city?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthContext {
  user: SafeUser;
  session: ISession;
}

export interface CachedSessionEntry {
  auth: AuthContext;
  cachedAt: number;
}

/**
 * In-memory session cache to eliminate redundant MongoDB queries on every page transition and RSC render.
 * Module-level Map keyed by sessionToken with a 60-second TTL.
 */
export const SESSION_CACHE_TTL_MS = 60 * 1000;
const sessionCache = new Map<string, CachedSessionEntry>();

/**
 * Invalidates the in-memory session cache.
 * - If a token or user ID is provided, removes matching cache entries.
 * - If called without arguments, completely flushes the session cache.
 */
export function invalidateSessionCache(tokenOrUserId?: string): void {
  if (!tokenOrUserId) {
    sessionCache.clear();
    return;
  }
  sessionCache.delete(tokenOrUserId);
  for (const [key, entry] of sessionCache.entries()) {
    if (entry.auth.user.id === tokenOrUserId || entry.auth.session.sessionToken === tokenOrUserId) {
      sessionCache.delete(key);
    }
  }
}

/**
 * Sanitizes a Mongoose User document or lean user record into a SafeUser object.
 */
export function sanitizeUser(user: IUser | (Partial<IUser> & { _id: { toString(): string } | string })): SafeUser {
  return {
    id: user._id.toString(),
    name: user.name || '',
    email: user.email || '',
    username: user.username || '',
    role: (user.role as 'user' | 'admin') || 'user',
    preferences: {
      language: user.preferences?.language || 'uz',
      calculationMethod: user.preferences?.calculationMethod || 'MWL',
      showOnLeaderboard: Boolean(user.preferences?.showOnLeaderboard),
      city: user.preferences?.city,
      latitude: user.preferences?.latitude,
      longitude: user.preferences?.longitude,
      timezone: user.preferences?.timezone,
    },
    createdAt: user.createdAt ? new Date(user.createdAt) : new Date(),
    updatedAt: user.updatedAt ? new Date(user.updatedAt) : new Date(),
  };
}

/**
 * Validates a session token directly against MongoDB Atlas with an in-memory cache layer.
 * Used internally by both NextRequest and Server Component cookie extractors.
 *
 * @param token Raw session token string
 * @returns AuthContext containing sanitized user and active session, or null if invalid/expired.
 */
export async function validateSessionToken(token: string): Promise<AuthContext | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  const now = Date.now();

  // Fast path: check in-memory cache
  const cached = sessionCache.get(token);
  if (cached) {
    const isFresh = now - cached.cachedAt < SESSION_CACHE_TTL_MS;
    const expiresAtMs = cached.auth.session.expiresAt
      ? new Date(cached.auth.session.expiresAt).getTime()
      : 0;
    const isNotExpired = expiresAtMs > now;

    if (isFresh && isNotExpired) {
      return cached.auth;
    }
    // Stale or expired entry
    sessionCache.delete(token);
  }

  await connectDB();

  const session = await execLean<ISession | null>(Session.findOne({ sessionToken: token }));
  if (!session) {
    return null;
  }

  // Check TTL expiration
  const expiresAtMs = session.expiresAt ? new Date(session.expiresAt).getTime() : 0;
  if (expiresAtMs <= now) {
    // Session is expired; delete immediately from database
    await Session.deleteOne({ _id: session._id }).catch(() => {});
    sessionCache.delete(token);
    return null;
  }

  // Find user associated with session (passwordHash excluded by default)
  const user = await execLean<IUser | null>(User.findById(session.userId));
  if (!user) {
    // Dangling session for deleted user; clean up
    await Session.deleteOne({ _id: session._id }).catch(() => {});
    sessionCache.delete(token);
    return null;
  }

  // Touch lastActiveAt if more than 15 minutes since last update (reduces write load)
  // Non-blocking / fire-and-forget: do NOT await this update on every single authenticated request!
  const lastActiveMs = session.lastActiveAt ? new Date(session.lastActiveAt).getTime() : 0;
  if (now - lastActiveMs > 15 * 60 * 1000) {
    Session.updateOne({ _id: session._id }, { $set: { lastActiveAt: new Date(now) } }).catch(() => {});
  }

  const authContext: AuthContext = {
    user: sanitizeUser(user),
    session: session as unknown as ISession,
  };

  // Cache authenticated context
  sessionCache.set(token, {
    auth: authContext,
    cachedAt: now,
  });

  // Defensive cleanup if map grows too large
  if (sessionCache.size > 5000) {
    const cutoff = now - SESSION_CACHE_TTL_MS;
    for (const [key, entry] of sessionCache.entries()) {
      if (entry.cachedAt < cutoff) {
        sessionCache.delete(key);
      }
    }
  }

  return authContext;
}

/**
 * Retrieves and validates the current authenticated session from cookies in Server Components
 * or Route Handlers (Next.js 16 asynchronous cookies).
 *
 * @returns AuthContext if valid session exists, or null otherwise.
 */
export async function getCurrentSession(): Promise<AuthContext | null> {
  try {
    const cookieStore = await cookies();
    const sessionToken =
      cookieStore.get(PRIMARY_SESSION_COOKIE)?.value ||
      cookieStore.get(LEGACY_SESSION_COOKIE)?.value;

    if (!sessionToken) {
      return null;
    }

    return await validateSessionToken(sessionToken);
  } catch {
    return null;
  }
}

/**
 * Extracts and validates the session token from a NextRequest object or falls back to cookies().
 * Ideal for API Route Handlers.
 *
 * @param request Optional NextRequest instance
 * @returns AuthContext if valid, or null otherwise.
 */
export async function authenticateRequest(request?: NextRequest): Promise<AuthContext | null> {
  let token: string | undefined;

  if (request) {
    token =
      request.cookies.get(PRIMARY_SESSION_COOKIE)?.value ||
      request.cookies.get(LEGACY_SESSION_COOKIE)?.value;
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token =
        cookieStore.get(PRIMARY_SESSION_COOKIE)?.value ||
        cookieStore.get(LEGACY_SESSION_COOKIE)?.value;
    } catch {
      // In certain runtimes where cookies() is not available, ignore
    }
  }

  if (!token) {
    return null;
  }

  return await validateSessionToken(token);
}

/**
 * Enforces session authentication. Throws an Error if no valid session is found.
 * Suitable for protected server action or component boundaries.
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getCurrentSession();
  if (!auth) {
    throw new Error('Unauthorized');
  }
  return auth;
}
