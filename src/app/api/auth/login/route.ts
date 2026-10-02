import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { Session } from '../../../../models/Session.ts';
import {
  validateLoginPayload,
  verifyPassword,
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createRateLimitKey,
  generateSessionToken,
  calculateSessionExpiry,
  getSessionCookieOptions,
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
      recordFailedAttempt(rateLimitKey);
      // Uniform generic error to prevent account enumeration
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid email/username or password',
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

    // 8. Set HttpOnly session cookie
    const cookieOpts = getSessionCookieOptions(rememberMe);
    const response = NextResponse.json(
      {
        success: true,
        data: {
          user: sanitizeUser(user),
        },
      },
      { status: 200 }
    );

    response.cookies.set(cookieOpts.name, sessionToken, cookieOpts);
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
      },
      { status: 500 }
    );
  }
}
