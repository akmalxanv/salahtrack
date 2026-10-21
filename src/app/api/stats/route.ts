import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../models/Prayer.ts';
import { QazaPayment } from '../../../models/QazaPayment.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import { calculateStreakFromHistory } from '../../../lib/streak.ts';
import { getLiturgicalDate } from '../../../lib/prayer-cycle.ts';
import {
  calculateAuthoritativeDebt,
  BASE_PLEDGE_AMOUNT,
  OVERDUE_PENALTY_AMOUNT,
  GRACE_PERIOD_DAYS,
} from '../../../lib/accountability.ts';
import type { PrayerId } from '../../../types/prayer.ts';

const PRAYER_KEYS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/**
 * GET /api/stats
 * Computes transparent, deterministic personal statistics for the authenticated user.
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

    await connectDB();

    const { searchParams } = new URL(request.url);
    const clientToday = searchParams.get('today');
    const timezone = searchParams.get('timezone') || undefined;
    const todayRegex = /^\d{4}-\d{2}-\d{2}$/;
    const maxAllowedDate = new Date(Date.now() + 14 * 60 * 60 * 1000).toISOString().split('T')[0];
    let todayStr = getLiturgicalDate(new Date(), undefined, timezone);

    if (clientToday && todayRegex.test(clientToday)) {
      const [y, m, d] = clientToday.split('-').map(Number);
      const parsedUtc = new Date(Date.UTC(y, m - 1, d));
      // Verify date is a real calendar date and doesn't exceed global timezone threshold
      if (
        parsedUtc.toISOString().split('T')[0] === clientToday &&
        clientToday <= maxAllowedDate
      ) {
        todayStr = clientToday;
      }
    }

    // Compute date boundaries
    const [y, m, d] = todayStr.split('-').map(Number);
    const todayUtc = Date.UTC(y, m - 1, d);
    const sevenDaysAgo = new Date(todayUtc - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(todayUtc - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    // Query records for the last 30 days
    const recentRecords = await PrayerRecord.find({
      userId: auth.user.id,
      date: { $gte: thirtyDaysAgo, $lte: todayStr },
    }).sort({ date: -1 });

    // 1. Today's metrics
    const todayRecord = recentRecords.find((r) => r.date === todayStr);
    let todayOnTime = 0;
    let todayLate = 0;
    let todayMissed = 0;
    let todayMadeUp = 0;

    if (todayRecord) {
      for (const key of PRAYER_KEYS) {
        const st = todayRecord.prayers[key]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED') todayOnTime++;
        else if (st === 'PRAYED_LATE') todayLate++;
        else if (st === 'MISSED') todayMissed++;
        else if (st === 'MADE_UP') todayMadeUp++;
      }
    }
    const todayCompleted = todayOnTime + todayLate;

    // 2. Weekly & Monthly metrics (7 days & 30 days)
    let weeklyCompleted = 0;
    let monthlyCompleted = 0;
    let totalOnTime30d = 0;
    let totalLate30d = 0;
    let totalMissed30d = 0;
    let totalMadeUp30d = 0;

    for (const record of recentRecords) {
      let recordCompleted = 0;

      for (const key of PRAYER_KEYS) {
        const st = record.prayers[key]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED') {
          recordCompleted++;
          totalOnTime30d++;
        } else if (st === 'PRAYED_LATE') {
          recordCompleted++;
          totalLate30d++;
        } else if (st === 'MISSED') {
          totalMissed30d++;
        } else if (st === 'MADE_UP') {
          totalMadeUp30d++;
        }
      }

      if (record.date >= sevenDaysAgo) {
        weeklyCompleted += recordCompleted;
      }
      monthlyCompleted += recordCompleted;
    }

    // 3. Streak Calculation
    // Query all records for user sorted by date descending to calculate current and best streak
    const allUserRecords = await PrayerRecord.find({
      userId: auth.user.id,
    }).sort({ date: -1 });

    const recordMap = new Map<string, number>();
    for (const rec of allUserRecords) {
      let comp = 0;
      for (const key of PRAYER_KEYS) {
        const st = rec.prayers[key]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED' || st === 'PRAYED_LATE') {
          comp++;
        }
      }
      // A day qualifies for streak only when all five daily prayers are completed (comp === 5)
      recordMap.set(rec.date, comp === 5 ? 5 : 0);
    }

    const streakData = calculateStreakFromHistory(recordMap, todayStr);

    // 4. Accountability balance & detailed breakdown via Authoritative Debt Service
    const debtResult = calculateAuthoritativeDebt(allUserRecords, {
      referenceDate: todayStr,
      timezone,
    });

    // Compute total settled/paid amount across all completed Qaza payments
    const userPayments = await QazaPayment.find({ userId: auth.user.id });
    const totalPaidAmount = userPayments.reduce((sum, p) => sum + (p.totalAmount || 0), 0);

    return NextResponse.json(
      {
        success: true,
        data: {
          today: {
            completed: todayCompleted,
            totalPossible: 5,
            percentage: Math.round((todayCompleted / 5) * 100),
            onTime: todayOnTime,
            late: todayLate,
            missed: todayMissed,
            madeUp: todayMadeUp,
          },
          weekly: {
            completed: weeklyCompleted,
            totalPossible: 35, // 7 days * 5
            percentage: Math.round((weeklyCompleted / 35) * 100),
          },
          monthly: {
            completed: monthlyCompleted,
            totalPossible: 150, // 30 days * 5
            percentage: Math.round((monthlyCompleted / 150) * 100),
          },
          counts30d: {
            onTime: totalOnTime30d,
            late: totalLate30d,
            missed: totalMissed30d,
            madeUp: totalMadeUp30d,
          },
          streaks: {
            current: streakData.current,
            best: streakData.best,
            lastActiveDate: streakData.lastActiveDate,
          },
          accountability: {
            totalAmount: debtResult.totalFinancialDebt,
            totalFinancialDebt: debtResult.totalFinancialDebt,
            totalBaseAmount: debtResult.totalBaseDebt,
            totalOverdueAmount: debtResult.totalOverdueDebt,
            totalPaidAmount,
            pendingQazaCount: debtResult.pendingQazaCount,
            completedQazaCount: debtResult.completedQazaCount,
            settledFinancialCount: debtResult.settledFinancialCount,
            unpaidFinancialCount: debtResult.unpaidFinancialCount,
            totalMissed: debtResult.items.filter((it) => it.status === 'MISSED').length,
            totalOverdue: debtResult.items.filter((it) => it.isOverdue && it.status === 'MISSED').length,
            totalMadeUp: debtResult.items.filter((it) => it.status === 'MADE_UP').length,
            currency: 'UZS',
            baseRatePerPrayer: BASE_PLEDGE_AMOUNT,
            overdueRatePerPrayer: OVERDUE_PENALTY_AMOUNT,
            gracePeriodDays: GRACE_PERIOD_DAYS,
            breakdown: debtResult.items,
          },
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/stats:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
