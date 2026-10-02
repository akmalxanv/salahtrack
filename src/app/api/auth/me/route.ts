import { NextRequest, NextResponse } from 'next/server.js';
import { authenticateRequest } from '../../../../lib/auth/index.ts';

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);

    if (!auth) {
      return NextResponse.json(
        {
          success: false,
          error: 'Unauthorized: No active session found',
        },
        { status: 401 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          user: auth.user,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    const err = error as Error & { code?: string | number };
    console.error('[Auth Me Error]:', {
      name: err.name || 'Error',
      message: err.message,
      code: err.code,
    });
    return NextResponse.json(
      {
        success: false,
        error: 'An unexpected error occurred while fetching session',
      },
      { status: 500 }
    );
  }
}
