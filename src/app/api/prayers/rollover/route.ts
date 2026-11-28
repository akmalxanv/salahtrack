import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB, execLean } from '../../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../../models/Prayer.ts';
import { authenticateRequest } from '../../../../lib/auth/index.ts';
import { calculateStreakFromHistory, getDaysDifference } from '../../../../lib/streak.ts';
import { isValidCalendarDate } from '../route.ts';
import { calculateAccountabilityFines } from '../../../../lib/accountability.ts';
import { getLiturgicalDate, resolveUserStartDate, sanitizeTimezone } from '../../../../lib/prayer-cycle.ts';
import { clearLeaderboardCache } from '../../leaderboard/route.ts';
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

    const { fromDate, toDate, timezone } = body as { fromDate?: unknown; toDate?: unknown; timezone?: unknown };

    if (fromDate !== undefined && (typeof fromDate !== 'string' || !isValidCalendarDate(fromDate))) {
      return NextResponse.json(
        { success: false, error: 'Valid fromDate in YYYY-MM-DD format is required', code: 'INVALID_FROM_DATE' },
        { status: 400 }
      );
    }

    if (toDate !== undefined && (typeof toDate !== 'string' || !isValidCalendarDate(toDate))) {
      return NextResponse.json(
        { success: false, error: 'Valid toDate in YYYY-MM-DD format is required', code: 'INVALID_TO_DATE' },
        { status: 400 }
      );
    }

    const resolvedTz = sanitizeTimezone(
      typeof timezone === 'string' ? timezone : auth.user.preferences?.timezone
    );
    const resolvedToDate: string =
      typeof toDate === 'string' ? toDate : getLiturgicalDate(new Date(), undefined, resolvedTz);

    let resolvedFromDate: string | null = null;

    await connectDB();

    if (typeof fromDate === 'string') {
      resolvedFromDate = fromDate;
      if (!(resolvedFromDate < resolvedToDate)) {
        return NextResponse.json(
          { success: false, error: 'fromDate must be strictly earlier than toDate', code: 'INVALID_DATE_RANGE' },
          { status: 400 }
        );
      }

      const gapDays = getDaysDifference(resolvedFromDate, resolvedToDate);
      if (gapDays > 365) {
        return NextResponse.json(
          { success: false, error: 'Date gap cannot exceed 365 days', code: 'DATE_GAP_EXCEEDED' },
          { status: 400 }
        );
      }
    } else {
      // Automatically determine fromDate: user's last recorded date before resolvedToDate
      let lastRecordedDate: string | null = null;
      try {
        if (typeof PrayerRecord?.find === 'function') {
          const q = PrayerRecord.find({ userId: auth.user.id });
          const records = typeof (q as { sort?: unknown }).sort === 'function'
            ? await (q as { sort: (order: unknown) => Promise<Array<{ date: string }>> }).sort({ date: -1 })
            : await q;
          if (Array.isArray(records)) {
            const priorRecords = records
              .filter((r) => r?.date && isValidCalendarDate(r.date) && r.date < resolvedToDate)
              .sort((a, b) => b.date.localeCompare(a.date));
            if (priorRecords.length > 0) {
              lastRecordedDate = priorRecords[0].date;
            }
          }
        }
      } catch {
        lastRecordedDate = null;
      }

      if (lastRecordedDate && lastRecordedDate < resolvedToDate) {
        resolvedFromDate = lastRecordedDate;
        const gap = getDaysDifference(resolvedFromDate, resolvedToDate);
        if (gap > 365) {
          resolvedFromDate = getDateWithDayOffset(resolvedToDate, -365);
        }
      } else {
        // User has no prior tracking history before resolvedToDate: do not fabricate missed days
        resolvedFromDate = null;
      }
    }

    const now = new Date();
    const userStartDate = resolveUserStartDate({
      platformStartDate: auth.user.platformStartDate,
      createdAt: auth.user.createdAt,
      timezone: resolvedTz,
    });

    const gapDays = resolvedFromDate ? getDaysDifference(resolvedFromDate, resolvedToDate) : 0;

    // 1. For resolvedFromDate: Convert lingering PENDING prayers to MISSED ONLY if resolvedFromDate >= userStartDate.
    // Historical dates before the user's activation/launch date are strictly excluded from automatic Qaza generation.
    if (resolvedFromDate && resolvedFromDate >= userStartDate) {
      const fromRecord = await PrayerRecord.findOne({
        userId: auth.user.id,
        date: resolvedFromDate,
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
          fromRecord.finesAccrued = calculateAccountabilityFines(resolvedFromDate, fromRecord.prayers, resolvedToDate);
          if (typeof fromRecord.markModified === 'function') {
            fromRecord.markModified('prayers');
            fromRecord.markModified('finesAccrued');
          }
          await fromRecord.save();
        }
      }
    }

    // 2. For intermediate days between resolvedFromDate and resolvedToDate:
    // Strictly skip any date before userStartDate so automatic Qaza never generates pre-launch records.
    const eligibleInterDates: string[] = [];
    if (resolvedFromDate && gapDays > 1) {
      for (let i = 1; i < gapDays; i++) {
        const interDate = getDateWithDayOffset(resolvedFromDate, i);
        if (interDate >= userStartDate) {
          eligibleInterDates.push(interDate);
        }
      }
    }

    // Batch-fetch all existing intermediate records in a single indexed query (eliminates N+1 findOne loop)
    const interRecordMap = new Map<string, Awaited<ReturnType<typeof PrayerRecord.findOne>>>();
    if (eligibleInterDates.length > 0) {
      const existingInterRecords = (await PrayerRecord.find({
        userId: auth.user.id,
        date: { $in: eligibleInterDates },
      })) as Array<NonNullable<Awaited<ReturnType<typeof PrayerRecord.findOne>>>>;
      for (const rec of existingInterRecords) {
        if (rec?.date) {
          interRecordMap.set(rec.date, rec);
        }
      }
    }

    for (const interDate of eligibleInterDates) {
      let interRecord = interRecordMap.get(interDate) ?? null;

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
          interRecord.finesAccrued = calculateAccountabilityFines(interDate, interRecord.prayers, resolvedToDate);
          if (typeof interRecord.markModified === 'function') {
            interRecord.markModified('prayers');
            interRecord.markModified('finesAccrued');
          }
          await interRecord.save();
        }
      }
    }

    // 3. For toDate: Find or initialize PrayerRecord with default pending prayers (if on/after userStartDate)
    if (resolvedToDate >= userStartDate) {
      let toRecord = await PrayerRecord.findOne({
        userId: auth.user.id,
        date: resolvedToDate,
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
            date: resolvedToDate,
            prayers: defaultPendingPrayers,
            finesAccrued: 0,
          });
          await toRecord.save();
        } catch (err: unknown) {
          const errorWithCode = err as { code?: number };
          if (errorWithCode?.code === 11000) {
            toRecord = await PrayerRecord.findOne({
              userId: auth.user.id,
              date: resolvedToDate,
            });
          } else {
            throw err;
          }
        }
      }
    }

    // 4. Recalculate streak for user across updated records using lean projection
    const streakBaseQuery = PrayerRecord.find({ userId: auth.user.id });
    const streakSelectedQuery =
      typeof (streakBaseQuery as { select?: (fields: string) => unknown })?.select === 'function'
        ? (streakBaseQuery as { select: (fields: string) => unknown }).select('date prayers')
        : streakBaseQuery;
    const streakSortedQuery =
      typeof (streakSelectedQuery as { sort?: (order: unknown) => unknown })?.sort === 'function'
        ? (streakSelectedQuery as { sort: (order: unknown) => unknown }).sort({ date: -1 })
        : streakSelectedQuery;
    const allUserRecords = await execLean<
      Array<{ date?: string; prayers?: Record<PrayerId, { status?: PrayerStatus }> }>
    >(streakSortedQuery);

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

    const streak = calculateStreakFromHistory(recordMap, resolvedToDate);
    clearLeaderboardCache();

    // 5. Return 200 with fromDate, toDate, userStartDate, streak
    return NextResponse.json(
      {
        success: true,
        fromDate: resolvedFromDate,
        toDate: resolvedToDate,
        userStartDate,
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
