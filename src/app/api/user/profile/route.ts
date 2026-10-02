import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { User } from '../../../../models/User.ts';
import { authenticateRequest, sanitizeUser } from '../../../../lib/auth/index.ts';

/**
 * GET /api/user/profile
 * Retrieves the currently authenticated user's private profile.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: { user: auth.user },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/user/profile:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/user/profile
 * Updates the authenticated user's personal details and preferences.
 * Enforces server-side authorization: users may ONLY modify their own profile.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload' },
        { status: 400 }
      );
    }

    await connectDB();

    const user = await User.findById(auth.user.id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'User not found' },
        { status: 404 }
      );
    }

    // 1. Update Full Name if provided
    if (typeof body.name === 'string') {
      const trimmedName = body.name.trim();
      if (trimmedName.length >= 2 && trimmedName.length <= 50) {
        user.name = trimmedName;
      } else {
        return NextResponse.json(
          { success: false, error: 'Name must be between 2 and 50 characters' },
          { status: 400 }
        );
      }
    }

    // 2. Update Preferences if provided
    if (body.preferences && typeof body.preferences === 'object') {
      const { language, calculationMethod, showOnLeaderboard } = body.preferences;

      if (language && ['uz', 'ru', 'en'].includes(language)) {
        user.preferences.language = language;
      }

      if (calculationMethod && typeof calculationMethod === 'string') {
        user.preferences.calculationMethod = calculationMethod;
      }

      if (typeof showOnLeaderboard === 'boolean') {
        user.preferences.showOnLeaderboard = showOnLeaderboard;
      }
    }

    await user.save();

    const updatedSafeUser = sanitizeUser(user);
    return NextResponse.json(
      {
        success: true,
        data: { user: updatedSafeUser },
        message: 'Profile updated successfully',
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in PUT /api/user/profile:', error);
    return NextResponse.json(
      { success: false, error: 'An unexpected error occurred while updating profile' },
      { status: 500 }
    );
  }
}
