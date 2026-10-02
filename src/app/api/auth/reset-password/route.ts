import { NextRequest, NextResponse } from 'next/server.js';
import crypto from 'node:crypto';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { Session } from '../../../../models/Session.ts';
import { validateResetPasswordPayload, hashPassword } from '../../../../lib/auth/index.ts';

/**
 * POST /api/auth/reset-password
 *
 * Implements password reset execution:
 * - Validates token format, password complexity, and confirmation match
 * - Hashes incoming raw token with SHA-256 and searches user by hashed token + valid expiry
 * - Updates password with Argon2id hash
 * - Clears password reset token and expiration fields
 * - Revokes all active database sessions for the user (session invalidation on credential change)
 * - Returns 200 OK
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);

    const validation = validateResetPasswordPayload(body);
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

    const { token, newPassword } = validation.data;

    await connectDB();

    // 1. Hash incoming token with SHA-256 to compare with stored hash
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 2. Locate user with valid reset token and unexpired timestamp
    // Note: passwordResetTokenHash and passwordResetExpires are select: false by default
    const user = await User.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetTokenHash +passwordResetExpires');

    if (!user) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid or expired password reset token',
        },
        { status: 400 }
      );
    }

    // 3. Hash new password with Argon2id
    const newPasswordHash = await hashPassword(newPassword);

    // 4. Update user credentials and purge reset token
    user.passwordHash = newPasswordHash;
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    // 5. Invalidate all active sessions for this user across all devices
    await Session.deleteMany({ userId: user._id });

    return NextResponse.json(
      {
        success: true,
        message: 'Password updated successfully. Please log in with your new credentials.',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/auth/reset-password:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred while resetting password',
      },
      { status: 500 }
    );
  }
}
