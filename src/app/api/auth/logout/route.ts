import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { Session } from '../../../../models/Session.ts';
import {
  PRIMARY_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  getExpiredSessionCookieOptions,
} from '../../../../lib/auth/index.ts';

export async function POST(request: NextRequest) {
  try {
    const token =
      request.cookies.get(PRIMARY_SESSION_COOKIE)?.value ||
      request.cookies.get(LEGACY_SESSION_COOKIE)?.value;

    if (token) {
      try {
        await connectDB();
        // Server-side session invalidation: immediately delete the active session document
        await Session.deleteOne({ sessionToken: token });
      } catch (dbError) {
        // Even if database operation encounters an error, proceed to clear client cookies
        console.error('Error invalidating session in database:', dbError);
      }
    }

    const primaryExpiredOpts = getExpiredSessionCookieOptions(PRIMARY_SESSION_COOKIE);
    const legacyExpiredOpts = getExpiredSessionCookieOptions(LEGACY_SESSION_COOKIE);

    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Overwrite BOTH primary and legacy session cookies with Max-Age=0 to instruct browser to delete them immediately
    response.cookies.set(primaryExpiredOpts.name, '', primaryExpiredOpts);
    response.cookies.set(legacyExpiredOpts.name, '', legacyExpiredOpts);
    return response;
  } catch (error) {
    console.error('Error in POST /api/auth/logout:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred during logout',
      },
      { status: 500 }
    );
  }
}
