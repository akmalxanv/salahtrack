import { NextRequest, NextResponse } from 'next/server.js';
import mongoose from 'mongoose';
import { connectDB } from '../../../../../../../lib/mongodb.ts';
import { Group } from '../../../../../../../models/Group.ts';
import { PrayerRecord } from '../../../../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../../../../lib/auth/index.ts';
import type { PrayerId, PrayerStatus } from '../../../../../../../types/prayer.ts';

const PRAYER_KEYS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

interface RouteContext {
  params: Promise<{ id: string; memberId: string }>;
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
 * GET /api/groups/[id]/members/[memberId]/prayers
 *
 * Retrieves read-only prayer history for a fellow circle member.
 * Strict Security Guarantees:
 * 1. Authentication required.
 * 2. Caller and target member MUST both belong to circle [id] (BOLA/IDOR prevention).
 * 3. Strictly sanitizes response: financial fields (paidAmount, isPaid, finesAccrued)
 *    and private user notes are omitted to preserve privacy.
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

    const { id: circleId, memberId } = await props.params;

    if (!circleId || !mongoose.Types.ObjectId.isValid(circleId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid circle ID', code: 'INVALID_CIRCLE_ID' },
        { status: 400 }
      );
    }

    if (!memberId || !mongoose.Types.ObjectId.isValid(memberId)) {
      return NextResponse.json(
        { success: false, error: 'Invalid member ID', code: 'INVALID_MEMBER_ID' },
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

    // Both caller AND target member MUST be members of this circle
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

    const { searchParams } = new URL(request.url);
    const startDateParam = searchParams.get('startDate');
    const endDateParam = searchParams.get('endDate');

    // Default to current month if date bounds not provided
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const currentMonthPrefix = todayStr.slice(0, 7); // YYYY-MM

    const startDate =
      startDateParam && /^\d{4}-\d{2}-\d{2}$/.test(startDateParam)
        ? startDateParam
        : `${currentMonthPrefix}-01`;

    let endDate =
      endDateParam && /^\d{4}-\d{2}-\d{2}$/.test(endDateParam)
        ? endDateParam
        : '';

    if (!endDate) {
      const [y, m] = currentMonthPrefix.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      endDate = `${currentMonthPrefix}-${String(lastDay).padStart(2, '0')}`;
    }

    // Query prayer records for the target member
    const records = await PrayerRecord.find({
      userId: memberId,
      date: { $gte: startDate, $lte: endDate },
    })
      .select('date prayers')
      .sort({ date: 1 })
      .lean();

    // Sanitize records: strictly keep only date and prayer status/prayedAt
    // Omit paidAmount, isPaid, finesAccrued, and private notes
    const sanitizedRecords: SanitizedMemberPrayerRecord[] = (records as unknown as Array<{ date: string; prayers?: Record<string, { status: PrayerStatus; prayedAt?: Date }> }>).map((rec) => {
      const sanitizedPrayers: Partial<Record<PrayerId, SanitizedMemberPrayerEntry>> = {};

      if (rec.prayers && typeof rec.prayers === 'object') {
        for (const pKey of PRAYER_KEYS) {
          const prayer = (rec.prayers as Record<string, { status: PrayerStatus; prayedAt?: Date }>)[pKey];
          if (prayer && prayer.status) {
            sanitizedPrayers[pKey] = {
              status: prayer.status,
              prayedAt: prayer.prayedAt,
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
    console.error('Error in GET /api/groups/[id]/members/[memberId]/prayers:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error', code: 'INTERNAL_ERROR' },
      { status: 500 }
    );
  }
}
