import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';

/**
 * GET /api/prayers/history?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
 *
 * Retrieves the authenticated user's private prayer ledger history across a date range.
 * Defaults to the current month if parameters are omitted.
 * Enforces ownership: only returns documents where userId matches the authenticated session.
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

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const now = new Date();
    const defaultEndDate = now.toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const defaultStartDate = thirtyDaysAgo.toISOString().split('T')[0];

    const startDate = startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
      ? startDateParam
      : defaultStartDate;

    const endDate = endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
      ? endDateParam
      : defaultEndDate;

    await connectDB();

    const records = await PrayerRecord.find({
      userId: auth.user.id,
      date: { $gte: startDate, $lte: endDate },
    }).sort({ date: -1 });

    return NextResponse.json(
      {
        success: true,
        data: {
          records,
          total: records.length,
          startDate,
          endDate,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/prayers/history:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
