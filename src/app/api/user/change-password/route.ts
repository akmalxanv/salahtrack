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

/**
 * POST /api/user/change-password
 *
 * Allows an authenticated user to change their password securely:
 * - Verifies current password using Argon2id constant-time verification
 * - Validates new password complexity and matching confirmation
 * - Hashes new password with Argon2id
 * - Revokes all other sessions across devices while preserving current active session
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request body', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    const { currentPassword, newPassword, confirmPassword } = body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'Current password, new password, and confirmation are required', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    if (newPassword !== confirmPassword) {
      return NextResponse.json(
        { success: false, error: 'New passwords do not match', code: 'PASSWORDS_DO_NOT_MATCH' },
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

    // Constant-time check of current password
    const isCurrentValid = await verifyPassword(currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      return NextResponse.json(
        { success: false, error: 'Current password does not match', code: 'INVALID_CURRENT_PASSWORD' },
        { status: 401 }
      );
    }

    // Hash and update password
    user.passwordHash = await hashPassword(newPassword);
    await user.save();

    // Invalidate all other active sessions across other devices
    await Session.deleteMany({
      userId: user._id,
      sessionToken: { $ne: auth.session.sessionToken },
    });

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
