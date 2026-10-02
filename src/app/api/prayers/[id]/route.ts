import { NextRequest, NextResponse } from 'next/server';
import { connectDB } from '@/lib/mongodb';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Dynamic route handler demonstrating Next.js 15+ asynchronous params handling
 * and singleton MongoDB Atlas connection pattern.
 */
export async function GET(
  request: NextRequest,
  props: RouteContext
) {
  try {
    // Next.js 15/16: Request params are promises and MUST be awaited
    const params = await props.params;
    const { id } = params;

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Prayer ID is required' },
        { status: 400 }
      );
    }

    // Connect to MongoDB Atlas via cached singleton
    await connectDB();

    return NextResponse.json({
      success: true,
      data: {
        id,
        message: `Prayer record queried for ID: ${id}`,
      },
    });
  } catch (error) {
    console.error('Error in dynamic prayer route handler:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
