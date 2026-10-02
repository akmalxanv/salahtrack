import { cookies } from 'next/headers.js';
import { NextRequest } from 'next/server.js';
import { connectDB } from '../mongodb.ts';
import { User, type IUser } from '../../models/User.ts';
import { Session, type ISession } from '../../models/Session.ts';
import { SESSION_COOKIE_NAME } from './session.ts';

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
  };
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthContext {
  user: SafeUser;
  session: ISession;
}

/**
 * Sanitizes a Mongoose User document into a SafeUser object.
 */
export function sanitizeUser(user: IUser): SafeUser {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    preferences: {
      language: user.preferences?.language || 'uz',
      calculationMethod: user.preferences?.calculationMethod || 'MWL',
      showOnLeaderboard: Boolean(user.preferences?.showOnLeaderboard),
    },
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

/**
 * Validates a session token directly against MongoDB Atlas.
 * Used internally by both NextRequest and Server Component cookie extractors.
 *
 * @param token Raw session token string
 * @returns AuthContext containing sanitized user and active session, or null if invalid/expired.
 */
export async function validateSessionToken(token: string): Promise<AuthContext | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  await connectDB();

  const session = await Session.findOne({ sessionToken: token });
  if (!session) {
    return null;
  }

  // Check TTL expiration
  if (session.expiresAt.getTime() <= Date.now()) {
    // Session is expired; delete immediately from database
    await Session.deleteOne({ _id: session._id }).catch(() => {});
    return null;
  }

  // Find user associated with session (passwordHash excluded by default)
  const user = await User.findById(session.userId);
  if (!user) {
    // Dangling session for deleted user; clean up
    await Session.deleteOne({ _id: session._id }).catch(() => {});
    return null;
  }

  // Touch lastActiveAt if more than 15 minutes since last update (reduces write load)
  const now = Date.now();
  if (now - session.lastActiveAt.getTime() > 15 * 60 * 1000) {
    session.lastActiveAt = new Date(now);
    await session.save().catch(() => {});
  }

  return {
    user: sanitizeUser(user),
    session,
  };
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
    const sessionCookie = cookieStore.get(SESSION_COOKIE_NAME);

    if (!sessionCookie || !sessionCookie.value) {
      return null;
    }

    return await validateSessionToken(sessionCookie.value);
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
    token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  }

  if (!token) {
    try {
      const cookieStore = await cookies();
      token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
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
