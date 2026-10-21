import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';
import { calculateStreakFromHistory, getDaysDifference } from '../../../../lib/streak.ts';
import { calculateFines, isValidCalendarDate } from '../route.ts';
import type { PrayerId, PrayerStatus } from '../../../../types/prayer.ts';

const VALID_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * Calculates a calendar date string (YYYY-MM-DD) shifted by an exact number of days.
 * Uses UTC arithmetic to avoid Daylight Saving Time (DST) or timezone-dependent drift.
 */
function getDateWithDayOffset(baseDateStr: string, offsetDays: number): string {
  const [y, m, d] = baseDateStr.split('-').map(Number);
  const targetUtc = Date.UTC(y, m - 1, d) + offsetDays * 24 * 60 * 60 * 1000;
  const dObj = new Date(targetUtc);
  const year = dObj.getUTCFullYear();
  const month = String(dObj.getUTCMonth() + 1).padStart(2, '0');
  const day = String(dObj.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * POST /api/prayers/rollover
 *
 * Performs deterministic calendar day rollover for the authenticated user:
 * 1. Authenticates request and guards ownership.
 * 2. Validates fromDate and toDate formats (YYYY-MM-DD), ensures fromDate < toDate,
 *    and bounds the gap to at most 365 days (DoS defense).
 * 3. On fromDate: converts any lingering PENDING prayers to MISSED, calculates fines, and persists.
 * 4. For intermediate days (if user was away for > 1 day): creates records with all 5 MISSED prayers
 *    and 75,000 UZS fines accrued for any missing days.
 * 5. On toDate: ensures document exists with default PENDING prayers.
 * 6. Recalculates user's streak deterministically across all records relative to toDate.
 * 7. Returns { success: true, fromDate, toDate, streak }.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized', code: 'AUTH_UNAUTHORIZED' },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Invalid request payload', code: 'VALIDATION_FAILED' },
        { status: 400 }
      );
    }

    const { fromDate, toDate } = body as { fromDate?: unknown; toDate?: unknown; timezone?: unknown };

    if (typeof fromDate !== 'string' || !isValidCalendarDate(fromDate)) {
      return NextResponse.json(
        { success: false, error: 'Valid fromDate in YYYY-MM-DD format is required', code: 'INVALID_FROM_DATE' },
        { status: 400 }
      );
    }

    if (typeof toDate !== 'string' || !isValidCalendarDate(toDate)) {
      return NextResponse.json(
        { success: false, error: 'Valid toDate in YYYY-MM-DD format is required', code: 'INVALID_TO_DATE' },
        { status: 400 }
      );
    }

    if (!(fromDate < toDate)) {
      return NextResponse.json(
        { success: false, error: 'fromDate must be strictly earlier than toDate', code: 'INVALID_DATE_RANGE' },
        { status: 400 }
      );
    }

    const gapDays = getDaysDifference(fromDate, toDate);
    if (gapDays > 365) {
      return NextResponse.json(
        { success: false, error: 'Date gap cannot exceed 365 days', code: 'DATE_GAP_EXCEEDED' },
        { status: 400 }
      );
    }

    await connectDB();
    const now = new Date();

    // 1. For fromDate: Convert lingering PENDING prayers to MISSED and recalculate fines
    const fromRecord = await PrayerRecord.findOne({
      userId: auth.user.id,
      date: fromDate,
    });

    if (fromRecord) {
      let modified = false;
      for (const prayerId of VALID_PRAYER_IDS) {
        if (fromRecord.prayers?.[prayerId]?.status === 'PENDING') {
          fromRecord.prayers[prayerId].status = 'MISSED';
          fromRecord.prayers[prayerId].missedAt = now;
          modified = true;
        }
      }
      if (modified || fromRecord.finesAccrued === undefined) {
        fromRecord.finesAccrued = calculateFines(fromDate, fromRecord.prayers);
        if (typeof fromRecord.markModified === 'function') {
          fromRecord.markModified('prayers');
          fromRecord.markModified('finesAccrued');
        }
        await fromRecord.save();
      }
    }

    // 2. For intermediate days between fromDate and toDate (if user was away for > 1 day)
    for (let i = 1; i < gapDays; i++) {
      const interDate = getDateWithDayOffset(fromDate, i);
      let interRecord = await PrayerRecord.findOne({
        userId: auth.user.id,
        date: interDate,
      });

      if (!interRecord) {
        const missedPrayers = {
          fajr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
          dhuhr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
          asr: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
          maghrib: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
          isha: { status: 'MISSED' as PrayerStatus, missedAt: now, isPaid: false, paidAmount: 0 },
        };

        try {
          interRecord = new PrayerRecord({
            userId: auth.user.id,
            date: interDate,
            prayers: missedPrayers,
            finesAccrued: 75000,
          });
          await interRecord.save();
        } catch (err: unknown) {
          const errorWithCode = err as { code?: number };
          if (errorWithCode?.code === 11000) {
            interRecord = await PrayerRecord.findOne({
              userId: auth.user.id,
              date: interDate,
            });
          } else {
            throw err;
          }
        }
      } else {
        let hasPending = false;
        for (const prayerId of VALID_PRAYER_IDS) {
          if (interRecord.prayers?.[prayerId]?.status === 'PENDING') {
            interRecord.prayers[prayerId].status = 'MISSED';
            interRecord.prayers[prayerId].missedAt = now;
            hasPending = true;
          }
        }
        if (hasPending) {
          interRecord.finesAccrued = calculateFines(interDate, interRecord.prayers);
          if (typeof interRecord.markModified === 'function') {
            interRecord.markModified('prayers');
            interRecord.markModified('finesAccrued');
          }
          await interRecord.save();
        }
      }
    }

    // 3. For toDate: Find or initialize PrayerRecord with default pending prayers
    let toRecord = await PrayerRecord.findOne({
      userId: auth.user.id,
      date: toDate,
    });

    if (!toRecord) {
      const defaultPendingPrayers = {
        fajr: { status: 'PENDING' as PrayerStatus, isPaid: false, paidAmount: 0 },
        dhuhr: { status: 'PENDING' as PrayerStatus, isPaid: false, paidAmount: 0 },
        asr: { status: 'PENDING' as PrayerStatus, isPaid: false, paidAmount: 0 },
        maghrib: { status: 'PENDING' as PrayerStatus, isPaid: false, paidAmount: 0 },
        isha: { status: 'PENDING' as PrayerStatus, isPaid: false, paidAmount: 0 },
      };

      try {
        toRecord = new PrayerRecord({
          userId: auth.user.id,
          date: toDate,
          prayers: defaultPendingPrayers,
          finesAccrued: 0,
        });
        await toRecord.save();
      } catch (err: unknown) {
        const errorWithCode = err as { code?: number };
        if (errorWithCode?.code === 11000) {
          toRecord = await PrayerRecord.findOne({
            userId: auth.user.id,
            date: toDate,
          });
        } else {
          throw err;
        }
      }
    }

    // 4. Recalculate streak for user across updated records
    const query = PrayerRecord.find({ userId: auth.user.id });
    const allUserRecords = typeof query.sort === 'function' ? await query.sort({ date: -1 }) : await query;

    const recordMap = new Map<string, number>();
    for (const rec of allUserRecords) {
      let completedCount = 0;
      for (const prayerId of VALID_PRAYER_IDS) {
        const st = rec.prayers?.[prayerId]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED' || st === 'PRAYED_LATE') {
          completedCount++;
        }
      }
      if (rec.date) {
        recordMap.set(rec.date, completedCount === 5 ? 5 : 0);
      }
    }

    const streak = calculateStreakFromHistory(recordMap, toDate);

    // 5. Return 200 with fromDate, toDate, streak
    return NextResponse.json(
      {
        success: true,
        fromDate,
        toDate,
        streak,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in POST /api/prayers/rollover:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error', code: 'INTERNAL_SERVER_ERROR' },
      { status: 500 }
    );
  }
}
