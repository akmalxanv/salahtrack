import { NextRequest, NextResponse } from 'next/server.js';
import crypto from 'node:crypto';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import {
  validateForgotPasswordPayload,
  checkRateLimit,
  recordFailedAttempt,
  createRateLimitKey,
} from '../../../../lib/auth/index.ts';

/**
 * POST /api/auth/forgot-password
 *
 * Implements password recovery initiation with strict protection against account enumeration:
 * - Validates input format (RFC 5322 email regex)
 * - Sliding-window rate-limited by IP + email key (max 5 attempts per 15 min)
 * - If email exists: generates 32-byte cryptographically secure random token, hashes with SHA-256,
 *   stores hash and 15-minute expiration on User document
 * - In local development: logs recovery link to server console for testing
 * - Returns uniform 200 OK message regardless of whether the email exists
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);

    const validation = validateForgotPasswordPayload(body);
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

    const { email } = validation.data;
    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = createRateLimitKey(ipAddress, `forgot:${email}`);

    const rateCheck = checkRateLimit(rateLimitKey);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many password reset requests. Please try again later.',
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

    await connectDB();

    const user = await User.findOne({ email });

    if (user) {
      // 1. Generate 32-byte hex crypto token (high entropy)
      const rawToken = crypto.randomBytes(32).toString('hex');

      // 2. Hash token with SHA-256 for secure database storage
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

      // 3. Set expiration to 15 minutes from now
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

      user.passwordResetTokenHash = tokenHash;
      user.passwordResetExpires = expiresAt;
      await user.save();

      // In development / local testing: log the reset link to the console
      if (process.env.NODE_ENV !== 'production') {
        const origin = request.nextUrl?.origin || 'http://localhost:3000';
        console.log(`[PASSWORD RESET LINK for ${email}]: ${origin}/reset-password?token=${rawToken}`);
      }
    } else {
      // Record rate limit attempt even on nonexistent accounts to prevent timing side channels
      recordFailedAttempt(rateLimitKey);
    }

    // Always return the exact same success response (prevents account enumeration)
    return NextResponse.json(
      {
        success: true,
        message: 'If an account with that email exists, password reset instructions have been sent.',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/auth/forgot-password:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred while processing password reset request',
      },
      { status: 500 }
    );
  }
}
