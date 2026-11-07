import { NextRequest, NextResponse } from 'next/server.js';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../lib/mongodb.ts';
import { Group } from '../../../../../models/Group.ts';
import { PrayerRecord } from '../../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../../lib/auth/index.ts';
import { consumeRateLimit, createRateLimitKey } from '../../../../../lib/auth/rate-limit.ts';
import type { PrayerId, PrayerStatus } from '../../../../../types/prayer.ts';

const PRAYER_KEYS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

// Max date range: 93 days (approx 1 quarter) prevents query-flooding DoS
const MAX_DATE_RANGE_MS = 93 * 24 * 60 * 60 * 1000;

// Rate limit: 60 read requests per 1-minute sliding window to prevent member scraping
const CIRCLE_HISTORY_RATE_LIMIT = {
  maxAttempts: 60,
  windowMs: 60 * 1000,
};

interface RouteContext {
  params: Promise<{ id: string }>;
}

export interface SanitizedMemberPrayerEntry {
  status: PrayerStatus;
  prayedAt?: Date;
}

export interface SanitizedMemberPrayerRecord {
  date: string;
  prayers: Partial<Record<PrayerId, SanitizedMemberPrayerEntry>>;
}

/**
 * GET /api/groups/[id]/member-history?memberId=...&startDate=...&endDate=...
 *
 * Query-based alias for retrieving member prayer history.
 * Strict Security Guarantees:
 * 1. Authentication required (401).
 * 2. Caller MUST belong to circle [id] (BOLA/IDOR prevention, 403).
 * 3. Target member MUST belong to circle [id] (BOLA/IDOR prevention, 403).
 * 4. Bounded date ranges (max 93 days) to protect against DoS query exhaustion (400).
 * 5. Strictly sanitizes response: financial fields (paidAmount, isPaid, paidAt, finesAccrued),
 *    private user notes, missed/makeup timestamps, and internal DB metadata are omitted.
 * 6. Rate limited to prevent automated member history scraping (429).
 */
export async function GET(request: NextRequest, props: RouteContext) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized: Authentication required', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const ipAddress = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || '127.0.0.1';
    const rateLimitKey = createRateLimitKey(ipAddress, `circle-hist:${auth.user.id}`);
    const rateCheck = consumeRateLimit(rateLimitKey, CIRCLE_HISTORY_RATE_LIMIT);

    if (!rateCheck.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Too many requests. Please wait a moment before trying again.',
          code: 'AUTH_RATE_LIMITED',
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

    const { id: circleId } = await props.params;
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('memberId');

    if (!circleId || !mongoose.Types.ObjectId.isValid(circleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid circle ID', code: 'INVALID_CIRCLE_ID' },
        { status: 400 }
      );
    }

    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid member ID parameter', code: 'INVALID_MEMBER_ID' },
        { status: 400 }
      );
    }

    await connectDB();

    const group = await Group.findById(circleId);
    if (!group) {
      return NextResponse.json(
        { success: false, error: 'Circle not found', code: 'CIRCLE_NOT_FOUND' },
        { status: 404 }
      );
    }

    // Both caller AND target member MUST be members of this circle (BOLA / IDOR defense)
    const isCallerMember = group.members.some(
      (m: { userId: mongoose.Types.ObjectId }) => m.userId.toString() === auth.user.id
    );
    const isTargetMember = group.members.some(
      (m: { userId: mongoose.Types.ObjectId }) => m.userId.toString() === memberId
    );

    if (!isCallerMember || !isTargetMember) {
      return NextResponse.json(
        {
          success: false,
          error: 'Forbidden: Both you and the target member must belong to this circle',
          code: 'FORBIDDEN_NOT_MEMBER',
        },
        { status: 403 }
      );
    }

    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMonthPrefix = todayStr.slice(0, 7);

    let startDate: string;
    let endDate: string;

    if (startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)) {
      startDate = startDateParam;
      if (endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)) {
        endDate = endDateParam;
      } else {
        const [y, m] = startDate.slice(0, 7).split('-').map(Number);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        endDate = `${startDate.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
      }
    } else {
      startDate = `${currentMonthPrefix}-01`;
      if (endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)) {
        endDate = endDateParam;
      } else {
        const [y, m] = currentMonthPrefix.split('-').map(Number);
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        endDate = `${currentMonthPrefix}-${String(lastDay).padStart(2, '0')}`;
      }
    }

    // Ensure valid chronological ordering
    if (startDate > endDate) {
      const temp = startDate;
      startDate = endDate;
      endDate = temp;
    }

    // Enforce maximum allowable date span to prevent query exhaustion
    const startMs = new Date(startDate).getTime();
    const endMs = new Date(endDate).getTime();
    if (endMs - startMs > MAX_DATE_RANGE_MS) {
      return NextResponse.json(
        {
          success: false,
          error: 'Requested date range exceeds the maximum allowed limit of 93 days',
          code: 'DATE_RANGE_TOO_LARGE',
        },
        { status: 400 }
      );
    }

    // Query prayer records for the target member with scoped projection
    const records = await PrayerRecord.find({
      userId: new mongoose.Types.ObjectId(memberId),
      date: { $gte: startDate, $lte: endDate },
    })
      .select('date prayers')
      .sort({ date: 1 })
      .lean();

    // Sanitize records: strictly keep only date and prayer status/prayedAt
    // Explicitly omit paidAmount, isPaid, paidAt, finesAccrued, and private notes
    const sanitizedRecords: SanitizedMemberPrayerRecord[] = (records as unknown as Array<{ date: string; prayers?: Record<string, { status: PrayerStatus; prayedAt?: Date }> }>).map((rec) => {
      const sanitizedPrayers: Partial<Record<PrayerId, SanitizedMemberPrayerEntry>> = {};

      if (rec.prayers && typeof rec.prayers === 'object') {
        for (const pKey of PRAYER_KEYS) {
          const prayer = (rec.prayers as Record<string, { status: PrayerStatus; prayedAt?: Date }>)[pKey];
          if (prayer && prayer.status) {
            sanitizedPrayers[pKey] = {
              status: prayer.status,
              ...(prayer.prayedAt ? { prayedAt: prayer.prayedAt } : {}),
            };
          }
        }
      }

      return {
        date: rec.date,
        prayers: sanitizedPrayers,
      };
    });

    return NextResponse.json(
      {
        success: true,
        data: {
          circleId,
          memberId,
          startDate,
          endDate,
          records: sanitizedRecords,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/groups/[id]/member-history:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
