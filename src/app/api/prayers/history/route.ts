import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB, execLean } from '../../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';
import {
  getLiturgicalDate,
  resolveUserStartDate,
  sanitizeFajrTime,
  sanitizeTimezone,
} from '../../../../lib/prayer-cycle.ts';
import { ensureUserRolledOver, getUserFirstTrackingDate } from '../../../../lib/prayer-rollover.ts';
import { isValidCalendarDate } from '../route.ts';

/**
 * GET /api/prayers/history?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD&timezone=...
 *
 * Retrieves the authenticated user's private prayer ledger history across a date range.
 * Defaults to the trailing 30 liturgical days (bounded by userStartDate) if parameters are omitted.
 * Enforces ownership: only returns documents where userId matches the authenticated session.
 * Reconciles uncompleted past prayer records before returning, converting lingering PENDING -> MISSED.
 * Returns earliestTrackingDate so client can accurately render pre-tracking vs uncompleted days.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');
    const fajrTime = sanitizeFajrTime(searchParams.get('fajrTime'));
    const timezone = sanitizeTimezone(searchParams.get('timezone') || auth.user.preferences?.timezone);
    const currentLiturgicalDate = getLiturgicalDate(new Date(), fajrTime, timezone);

    const now = new Date();
    const defaultEndDate = getLiturgicalDate(now, fajrTime, timezone);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const rawDefaultStartDate = getLiturgicalDate(thirtyDaysAgo, fajrTime, timezone);
    const userStartDate = resolveUserStartDate({
      platformStartDate: auth.user.platformStartDate,
      createdAt: auth.user.createdAt,
      timezone,
    });
    const defaultStartDate =
      rawDefaultStartDate < userStartDate && userStartDate <= defaultEndDate
        ? userStartDate
        : rawDefaultStartDate;

    const startDate = startDateParam && isValidCalendarDate(startDateParam)
      ? startDateParam
      : defaultStartDate;

    const endDate = endDateParam && isValidCalendarDate(endDateParam)
      ? endDateParam
      : defaultEndDate;

    await connectDB();

    // Auto-rollover uncompleted past prayers before returning
    await ensureUserRolledOver(auth.user.id, currentLiturgicalDate, { timezone, fillGapDays: false });
    const earliestTrackingDate = await getUserFirstTrackingDate(auth.user.id, currentLiturgicalDate);

    const records = await execLean<unknown[]>(
      PrayerRecord.find({
        userId: auth.user.id,
        date: { $gte: startDate, $lte: endDate },
      }).sort({ date: -1 })
    );

    return NextResponse.json(
      {
        success: true,
        data: {
          records,
          total: records.length,
          startDate,
          endDate,
          earliestTrackingDate,
          platformStartDate: userStartDate,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/prayers/history:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error', code: 'INTERNAL_SERVER_ERROR' },
      { status: 500 }
    );
  }
}
