import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { Session } from '../../../../models/Session.ts';
import {
  validateSignupPayload,
  hashPassword,
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

    // 1. Validate payload
    const validation = validateSignupPayload(body);
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

    const { name, email, username, password } = validation.data;

    // 2. Connect to MongoDB
    await connectDB();

    // 3. Collision check (Email and Username must be unique)
    const existing = await User.findOne({
      $or: [{ email }, { username }],
    });

    if (existing) {
      const isEmail = existing.email === email;
      return NextResponse.json(
        {
          success: false,
          error: isEmail ? 'Email is already registered' : 'Username is already taken',
          code: isEmail ? 'DUPLICATE_EMAIL' : 'DUPLICATE_USERNAME',
          field: isEmail ? 'email' : 'username',
        },
        { status: 409 }
      );
    }

    // 4. Hash password with Argon2id
    const passwordHash = await hashPassword(password);

    // 5. Persist User in MongoDB Atlas
    const user = await User.create({
      name,
      email,
      username,
      passwordHash,
      role: 'user',
      preferences: {
        language: 'uz',
        calculationMethod: 'MWL',
      },
    });

    // 6. Generate cryptographically secure session
    const sessionToken = generateSessionToken();
    const sessionExpiry = calculateSessionExpiry(false);
    const userAgent = request.headers.get('user-agent') || undefined;
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';

    await Session.create({
      sessionToken,
      userId: user._id,
      expiresAt: sessionExpiry,
      userAgent,
      ipAddress,
    });

    // 7. Configure secure HttpOnly cookies (issue primary, expire legacy) and return sanitized user
    const primaryCookieOpts = getSessionCookieOptions(false, PRIMARY_SESSION_COOKIE);
    const legacyExpiredOpts = getExpiredSessionCookieOptions(LEGACY_SESSION_COOKIE);
    const response = NextResponse.json(
      {
        success: true,
        data: {
          user: sanitizeUser(user),
        },
      },
      { status: 201 }
    );

    response.cookies.set(primaryCookieOpts.name, sessionToken, primaryCookieOpts);
    response.cookies.set(legacyExpiredOpts.name, '', legacyExpiredOpts);
    return response;
  } catch (error) {
    const err = error as Error & { code?: string | number };
    console.error('[Auth Signup Error]:', {
      name: err.name || 'Error',
      message: err.message,
      code: err.code,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred during registration',
        code: 'INTERNAL_SERVER_ERROR',
      },
      { status: 500 }
    );
  }
}
