import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { User } from '../../../models/User.ts';
import { PrayerRecord } from '../../../models/Prayer.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import type { PrayerId } from '../../../types/prayer.ts';

const PRAYER_KEYS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface LeaderboardEntry {
  rank: number;
  name: string;
  username: string;
  completedCount: number;
  onTimeCount: number;
  totalPossible: number;
  consistencyPercentage: number;
  isCurrentUser: boolean;
}

/**
 * GET /api/leaderboard?period=daily|weekly|monthly&date=YYYY-MM-DD
 *
 * Computes multi-user leaderboard with strict privacy guarantees:
 * - Only includes users who explicitly opted in (preferences.showOnLeaderboard: true)
 * - Period selection:
 *     * daily (5 max)
 *     * weekly (35 max)
 *     * monthly (150 max)
 * - Deterministic tie-breaking:
 *     1. Completed prayer count
 *     2. On-time prayer count
 *     3. Consistency percentage
 *     4. Deterministic creation timestamp
 * - Response contains only sanitized public statistics; zero private user fields exposed.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateRequest(request);
    const currentUserId = auth?.user?.id;

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'daily';
    const dateParam = searchParams.get('date');

    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const targetDate = dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayStr;

    await connectDB();

    // 1. Fetch only opted-in users (privacy by default)
    const optedInUsers = await User.find({
      'preferences.showOnLeaderboard': true,
    }).select('name username createdAt');

    if (optedInUsers.length === 0) {
      return NextResponse.json(
        {
          success: true,
          data: {
            period,
            date: targetDate,
            leaderboard: [],
            totalParticipants: 0,
            userOptedIn: auth?.user?.preferences?.showOnLeaderboard || false,
          },
        },
        { status: 200 }
      );
    }

    // 2. Compute date boundaries & total possible prayers
    let startDate = targetDate;
    let endDate = targetDate;
    let totalPossible = 5;

    const targetDateObj = new Date(`${targetDate}T00:00:00Z`);

    if (period === 'weekly') {
      const sixDaysAgo = new Date(targetDateObj.getTime() - 6 * 24 * 60 * 60 * 1000);
      startDate = sixDaysAgo.toISOString().split('T')[0];
      endDate = targetDate;
      totalPossible = 35; // 7 days * 5
    } else if (period === 'monthly') {
      const twentyNineDaysAgo = new Date(targetDateObj.getTime() - 29 * 24 * 60 * 60 * 1000);
      startDate = twentyNineDaysAgo.toISOString().split('T')[0];
      endDate = targetDate;
      totalPossible = 150; // 30 days * 5
    }

    // 3. Query all records for opted-in users within the period window
    const userIds = optedInUsers.map((u) => u._id);
    const records = await PrayerRecord.find({
      userId: { $in: userIds },
      date: { $gte: startDate, $lte: endDate },
    });

    // 4. Aggregate score per user
    const scoreMap = new Map<string, { completedCount: number; onTimeCount: number }>();
    for (const u of optedInUsers) {
      scoreMap.set(u._id.toString(), { completedCount: 0, onTimeCount: 0 });
    }

    for (const rec of records) {
      const uid = rec.userId.toString();
      const currentScore = scoreMap.get(uid);
      if (!currentScore) continue;

      for (const key of PRAYER_KEYS) {
        const st = rec.prayers[key]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED') {
          currentScore.completedCount += 1;
          currentScore.onTimeCount += 1;
        } else if (st === 'PRAYED_LATE') {
          currentScore.completedCount += 1;
        }
      }
    }

    // 5. Build and sort leaderboard entries using deterministic tie-breakers
    const participantList = optedInUsers.map((u) => {
      const uid = u._id.toString();
      const score = scoreMap.get(uid) || { completedCount: 0, onTimeCount: 0 };
      const consistencyPercentage = Math.round((score.completedCount / totalPossible) * 100);

      return {
        userId: uid,
        name: u.name,
        username: u.username,
        completedCount: score.completedCount,
        onTimeCount: score.onTimeCount,
        totalPossible,
        consistencyPercentage,
        createdAt: u.createdAt.getTime(),
        isCurrentUser: currentUserId ? uid === currentUserId : false,
      };
    });

    participantList.sort((a, b) => {
      // 1. Completed prayer count (descending)
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      // 2. On-time prayer count (descending)
      if (b.onTimeCount !== a.onTimeCount) {
        return b.onTimeCount - a.onTimeCount;
      }
      // 3. Consistency percentage (descending)
      if (b.consistencyPercentage !== a.consistencyPercentage) {
        return b.consistencyPercentage - a.consistencyPercentage;
      }
      // 4. Stable deterministic fallback: user creation date
      return a.createdAt - b.createdAt;
    });

    // 6. Assign ranks and shape final public response
    const leaderboard: LeaderboardEntry[] = participantList.map((entry, index) => ({
      rank: index + 1,
      name: entry.name,
      username: entry.username,
      completedCount: entry.completedCount,
      onTimeCount: entry.onTimeCount,
      totalPossible: entry.totalPossible,
      consistencyPercentage: entry.consistencyPercentage,
      isCurrentUser: entry.isCurrentUser,
    }));

    return NextResponse.json(
      {
        success: true,
        data: {
          period,
          startDate,
          endDate,
          leaderboard,
          totalParticipants: leaderboard.length,
          userOptedIn: auth?.user?.preferences?.showOnLeaderboard || false,
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error in GET /api/leaderboard:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
