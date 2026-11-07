import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { Session } from '../../../../models/Session.ts';
import {
  authenticateRequest,
  verifyPassword,
  hashPassword,
  validatePassword,
} from '../../../../lib/auth/index.ts';
import {
  checkRateLimit,
  recordFailedAttempt,
  resetRateLimit,
  createRateLimitKey,
  DEFAULT_AUTH_RATE_LIMIT,
} from '../../../../lib/auth/rate-limit.ts';

/**
 * POST /api/user/change-password
 *
 * Allows an authenticated user to change their password securely:
 * - Enforces sliding-window IP and identifier rate limiting (max 5 failed attempts per 15m)
 * - Validates input types and bounds length (<= 128 chars) to mitigate Argon2id computational DoS
 * - Verifies current password using Argon2id constant-time verification
 * - Validates new password complexity and matching confirmation
 * - Enforces that new password differs from current password
 * - Hashes new password with Argon2id
 * - Revokes all other sessions across devices while preserving current active session
 * - Resets rate limiter upon successful password change
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    // 1. Sliding-window rate limit check: protects against password brute-force
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = createRateLimitKey(ipAddress, `pwd-change:${auth.user.id}`);
    const rateCheck = checkRateLimit(rateLimitKey, DEFAULT_AUTH_RATE_LIMIT);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many failed password change attempts. Please try again later.',
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword, confirmPassword } = body as Record<string, unknown>;

    // 2. Strict input validation and type checking
    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      typeof confirmPassword !== 'string' ||
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      return NextResponse.json(
        {
          success: false,
          error: 'Current password, new password, and confirmation are required strings',
          code: 'VALIDATION_FAILED',
        },
        { status: 400 }
      );
    }

    // DoS Mitigation: limit maximum character lengths to avoid Argon2id CPU exhaustion
    if (currentPassword.length > 128 || newPassword.length > 128 || confirmPassword.length > 128) {
      return NextResponse.json(
        { success: false, error: 'Password must not exceed 128 characters', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'New passwords do not match', code: 'PASSWORDS_DO_NOT_MATCH' },
        { status: 400 }
      );
    }

    // Prevent re-using the exact same current password
    if (currentPassword === newPassword) {
      return NextResponse.json(
        { success: false, error: 'New password must be different from current password', code: 'NEW_PASSWORD_SAME_AS_CURRENT' },
        { status: 400 }
      );
    }

    // Validate new password complexity
    const passwordValidation = validatePassword(newPassword);
    if (!passwordValidation.isValid) {
      return NextResponse.json(
        { success: false, error: passwordValidation.errors[0], code: 'PASSWORD_TOO_WEAK' },
        { status: 400 }
      );
    }

    await connectDB();

    // Query user explicitly selecting +passwordHash
    const user = await User.findById(auth.user.id).select('+passwordHash');
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found', code: 'USER_NOT_FOUND' },
        { status: 404 }
      );
    }

    // 3. Constant-time check of current password via Argon2id
    const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      // Record failed attempt in rate limiter
      const failedResult = recordFailedAttempt(rateLimitKey, DEFAULT_AUTH_RATE_LIMIT);
      return NextResponse.json(
        {
          success: false,
          error: 'Current password does not match',
          code: 'INVALID_CURRENT_PASSWORD',
          remainingAttempts: failedResult.remaining,
        },
        {
          status: 401,
          headers: failedResult.allowed ? {} : { 'Retry-After': String(failedResult.retryAfterSeconds) },
        }
      );
    }

    // 4. Hash and update password with Argon2id
    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    // 5. Invalidate all other active sessions across other devices
    await Session.deleteMany({
      userId: user._id,
      sessionToken: { $ne: auth.session.sessionToken },
    });

    // 6. Reset rate limit counter on successful password update
    resetRateLimit(rateLimitKey);

    return NextResponse.json(
      {
        success: true,
        message: 'Password changed successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/user/change-password:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while changing password', code: 'INTERNAL_SERVER_ERROR' },
      { status: 500 }
    );
  }
}
