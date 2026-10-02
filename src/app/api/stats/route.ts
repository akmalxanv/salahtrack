import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { PrayerRecord } from '../../../models/Prayer.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
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

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];

    // Compute date boundaries
    const sevenDaysAgo = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const thirtyDaysAgo = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

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
      recordMap.set(rec.date, comp);
    }

    // Calculate current streak: consecutive days with at least 1 prayer (or all 5)
    let currentStreak = 0;
    const checkDate = new Date(now);

    // If today has completed prayers, start from today, otherwise check from yesterday
    const todayCount = recordMap.get(todayStr) || 0;
    if (todayCount === 0) {
      checkDate.setDate(checkDate.getDate() - 1);
    }

    while (true) {
      const dStr = checkDate.toISOString().split('T')[0];
      const count = recordMap.get(dStr) || 0;
      if (count > 0) {
        currentStreak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else {
        break;
      }
    }

    // Calculate best streak across entire history
    let bestStreak = currentStreak;
    let tempStreak = 0;
    const sortedDates = Array.from(recordMap.keys()).sort();

    for (let i = 0; i < sortedDates.length; i++) {
      const dateKey = sortedDates[i];
      const count = recordMap.get(dateKey) || 0;

      if (count > 0) {
        if (i === 0) {
          tempStreak = 1;
        } else {
          const prev = new Date(sortedDates[i - 1]);
          const curr = new Date(dateKey);
          const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays === 1) {
            tempStreak++;
          } else {
            tempStreak = 1;
          }
        }
        if (tempStreak > bestStreak) {
          bestStreak = tempStreak;
        }
      } else {
        tempStreak = 0;
      }
    }

    // 4. Accountability balance: sum of all active fines
    const totalFinesAgg = await PrayerRecord.aggregate([
      { $match: { userId: auth.user.id } },
      { $group: { _id: null, total: { $sum: '$finesAccrued' } } },
    ]);
    const accountabilityAmount = totalFinesAgg[0]?.total || 0;

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
            current: currentStreak,
            best: bestStreak,
          },
          accountability: {
            totalAmount: accountabilityAmount,
            currency: 'UZS',
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
