import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { Session } from '../../../../models/Session.ts';
import { SESSION_COOKIE_NAME, getExpiredSessionCookieOptions } from '../../../../lib/auth/index.ts';

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
      try {
        await connectDB();
        // Server-side session invalidation: immediately delete the active session document
        await Session.deleteOne({ sessionToken: token });
      } catch (dbError) {
        // Even if database operation encounters an error, proceed to clear client cookie
        console.error('Error invalidating session in database:', dbError);
      }
    }

    const expiredCookieOpts = getExpiredSessionCookieOptions();
    const response = NextResponse.json(
      {
        success: true,
        message: 'Logged out successfully',
      },
      { status: 200 }
    );

    // Overwrite session cookie with Max-Age=0 to instruct browser to delete it immediately
    response.cookies.set(expiredCookieOpts.name, '', expiredCookieOpts);
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
