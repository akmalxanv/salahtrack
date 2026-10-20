import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { Session } from '../../../../models/Session.ts';
import {
  validateLoginPayload,
  verifyPassword,
  verifyDummyPassword,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createRateLimitKey,
  generateSessionToken,
  calculateSessionExpiry,
  getSessionCookieOptions,
  getExpiredSessionCookieOptions,
  PRIMARY_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  sanitizeUser,
} from '../../../../lib/auth/index.ts';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);

    // 1. Validate payload structure
    const validation = validateLoginPayload(body);
    if (!validation.isValid || !validation.data) {
      return NextResponse.json(
        {
          success: false,
          error: 'Validation failed',
          code: 'VALIDATION_FAILED',
          errors: validation.errors,
        },
        { status: 400 }
      );
    }

    const { identifier, password, rememberMe } = validation.data;
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = createRateLimitKey(ipAddress, identifier);

    // 2. Sliding-window rate limit check (Brute-force protection)
    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many failed login attempts. Please try again later.',
          code: 'AUTH_RATE_LIMITED',
          retryAfterSeconds: rateCheck.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateCheck.retryAfterSeconds),
          },
        }
      );
    }

    // 3. Connect to MongoDB Atlas
    await connectDB();

    // 4. Query user by email or username, explicitly selecting +passwordHash
    const user = await User.findOne({
      $or: [{ email: identifier }, { username: identifier }],
    }).select('+passwordHash');

    if (!user) {
      // Execute dummy password verification to guarantee constant-time behavior and defeat timing attacks
      await verifyDummyPassword(password);
      recordFailedAttempt(rateLimitKey);
      // Uniform generic error to prevent account enumeration
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email/username or password',
          code: 'AUTH_INVALID_CREDENTIALS',
        },
        { status: 401 }
      );
    }

    // 5. Constant-time password verification via Argon2id
    const isPasswordValid = await verifyPassword(password, user.passwordHash);

    if (!isPasswordValid) {
      recordFailedAttempt(rateLimitKey);
      // Uniform generic error
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email/username or password',
          code: 'AUTH_INVALID_CREDENTIALS',
        },
        { status: 401 }
      );
    }

    // 6. Clear failed attempts on successful credential verification
    resetRateLimit(rateLimitKey);

    // 7. Issue server-side session
    const sessionToken = generateSessionToken();
    const sessionExpiry = calculateSessionExpiry(rememberMe);
    const userAgent = request.headers.get('user-agent') || undefined;

    await Session.create({
      sessionToken,
      userId: user._id,
      expiresAt: sessionExpiry,
      userAgent,
      ipAddress,
    });

    // 8. Set HttpOnly session cookies (issue primary, expire legacy)
    const primaryCookieOpts = getSessionCookieOptions(rememberMe, PRIMARY_SESSION_COOKIE);
    const legacyExpiredOpts = getExpiredSessionCookieOptions(LEGACY_SESSION_COOKIE);
    const response = NextResponse.json(
      {
        success: true,
        data: {
          user: sanitizeUser(user),
        },
      },
      { status: 200 }
    );

    response.cookies.set(primaryCookieOpts.name, sessionToken, primaryCookieOpts);
    response.cookies.set(legacyExpiredOpts.name, '', legacyExpiredOpts);
    return response;
  } catch (error) {
    const err = error as Error & { code?: string | number };
    console.error('[Auth Login Error]:', {
      name: err.name || 'Error',
      message: err.message,
      code: err.code,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred during authentication',
        code: 'INTERNAL_SERVER_ERROR',
      },
      { status: 500 }
    );
  }
}
