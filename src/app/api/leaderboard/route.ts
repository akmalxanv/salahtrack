import { NextRequest, NextResponse } from 'next/server.js';
import { connectDB } from '../../../lib/mongodb.ts';
import { User } from '../../../models/User.ts';
import { PrayerRecord } from '../../../models/Prayer.ts';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import { calculateStreakFromHistory } from '../../../lib/streak.ts';
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
  currentStreak: number;
  isCurrentUser: boolean;
}

export interface CachedLeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  username: string;
  completedCount: number;
  onTimeCount: number;
  currentStreak: number;
  totalPossible: number;
  consistencyPercentage: number;
}

export interface CachedLeaderboardData {
  period: string;
  startDate: string;
  endDate: string;
  entries: CachedLeaderboardEntry[];
  totalParticipants: number;
  cachedAt: number;
}

export const LEADERBOARD_CACHE_TTL_MS = 30 * 1000; // 30 seconds TTL
const leaderboardCache = new Map<string, CachedLeaderboardData>();

/**
 * Flushes the in-memory leaderboard cache.
 */
export function clearLeaderboardCache(): void {
  leaderboardCache.clear();
}

export const _clearLeaderboardCache = clearLeaderboardCache;

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
    const cacheKey = `${period}:${targetDate}`;

    // 0. High-performance TTL memory cache check (0ms response, zero database round-trips)
    const cached = leaderboardCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < LEADERBOARD_CACHE_TTL_MS) {
      return NextResponse.json(
        {
          success: true,
          data: {
            period: cached.period,
            startDate: cached.startDate,
            endDate: cached.endDate,
            leaderboard: cached.entries.map((entry) => ({
              rank: entry.rank,
              name: entry.name,
              username: entry.username,
              completedCount: entry.completedCount,
              onTimeCount: entry.onTimeCount,
              currentStreak: entry.currentStreak,
              totalPossible: entry.totalPossible,
              consistencyPercentage: entry.consistencyPercentage,
              isCurrentUser: currentUserId ? entry.userId === currentUserId : false,
            })),
            totalParticipants: cached.totalParticipants,
            userOptedIn: auth?.user?.preferences?.showOnLeaderboard || false,
          },
        },
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
          },
        }
      );
    }

    await connectDB();

    // 1. Fetch only opted-in users (privacy by default)
    const optedInUsers = await User.find({
      'preferences.showOnLeaderboard': true,
    }).select('_id name username createdAt').lean();

    if (optedInUsers.length === 0) {
      leaderboardCache.set(cacheKey, {
        period,
        startDate: targetDate,
        endDate: targetDate,
        entries: [],
        totalParticipants: 0,
        cachedAt: Date.now(),
      });

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
        {
          status: 200,
          headers: {
            'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
          },
        }
      );
    }

    // 2. Compute date boundaries & total possible prayers
    let startDate = targetDate;
    let endDate = targetDate;
    let totalPossible = 5;

    const targetDateObj = new Date(`${targetDate}T00:00:00Z`);
    const validTargetTime = isNaN(targetDateObj.getTime()) ? now.getTime() : targetDateObj.getTime();

    if (period === 'weekly') {
      const sixDaysAgo = new Date(validTargetTime - 6 * 24 * 60 * 60 * 1000);
      startDate = sixDaysAgo.toISOString().split('T')[0];
      endDate = targetDate;
      totalPossible = 35; // 7 days * 5
    } else if (period === 'monthly') {
      const twentyNineDaysAgo = new Date(validTargetTime - 29 * 24 * 60 * 60 * 1000);
      startDate = twentyNineDaysAgo.toISOString().split('T')[0];
      endDate = targetDate;
      totalPossible = 150; // 30 days * 5
    }

    // 3. Query records for opted-in users:
    // Period window for consistency scores, and bounded recent window (last 60 days) for streaks.
    // Optimizing streakRecords query prevents full collection scans across unbounded history.
    const streakStartDate = new Date(validTargetTime - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const userIds = optedInUsers.map((u) => u._id);
    const [records, streakRecords] = await Promise.all([
      PrayerRecord.find({
        userId: { $in: userIds },
        date: { $gte: startDate, $lte: endDate },
      }).select('userId date prayers').lean(),
      PrayerRecord.find({
        userId: { $in: userIds },
        date: { $gte: streakStartDate, $lte: targetDate },
      }).sort({ date: -1 }).select('userId date prayers').lean(),
    ]);

    // 4. Compute current streaks for all opted-in users
    const userStreakMap = new Map<string, number>();
    for (const u of optedInUsers) {
      const uStr = u._id.toString();
      const userRecs = streakRecords.filter((r) => r.userId.toString() === uStr);
      const recordMap = new Map<string, number>();
      for (const rec of userRecs) {
        let comp = 0;
        for (const key of PRAYER_KEYS) {
          const st = rec.prayers?.[key]?.status;
          if (st === 'PRAYED_ON_TIME' || st === 'PRAYED' || st === 'PRAYED_LATE') {
            comp++;
          }
        }
        recordMap.set(rec.date, comp === 5 ? 5 : 0);
      }
      const streakData = calculateStreakFromHistory(recordMap, targetDate);
      userStreakMap.set(uStr, streakData.current);
    }

    // 5. Aggregate score per user
    const scoreMap = new Map<string, { completedCount: number; onTimeCount: number }>();
    for (const u of optedInUsers) {
      scoreMap.set(u._id.toString(), { completedCount: 0, onTimeCount: 0 });
    }

    for (const rec of records) {
      const uid = rec.userId.toString();
      const currentScore = scoreMap.get(uid);
      if (!currentScore) continue;

      for (const key of PRAYER_KEYS) {
        const st = rec.prayers?.[key]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED') {
          currentScore.completedCount += 1;
          currentScore.onTimeCount += 1;
        } else if (st === 'PRAYED_LATE') {
          currentScore.completedCount += 1;
        }
      }
    }

    // 6. Build participant list with clean defaults for missing/zero data
    const participantList = optedInUsers.map((u) => {
      const uid = u._id.toString();
      const score = scoreMap.get(uid) || { completedCount: 0, onTimeCount: 0 };
      const completedCount = score.completedCount || 0;
      const onTimeCount = score.onTimeCount || 0;
      const rawPercentage = totalPossible > 0 ? Math.round((completedCount / totalPossible) * 100) : 0;
      const consistencyPercentage = isNaN(rawPercentage) ? 0 : rawPercentage;
      const createdAt = u.createdAt ? new Date(u.createdAt).getTime() : 0;

      return {
        userId: uid,
        name: u.name,
        username: u.username,
        completedCount,
        onTimeCount,
        currentStreak: userStreakMap.get(uid) || 0,
        totalPossible,
        consistencyPercentage,
        createdAt,
        isCurrentUser: currentUserId ? uid === currentUserId : false,
      };
    });

    // 6. Deterministic sorting:
    //    1. Percentage / completedCount descending
    //    2. onTimeCount descending
    //    3. User creation date ascending (older account first)
    //    4. Deterministic fallback by userId
    participantList.sort((a, b) => {
      if (b.consistencyPercentage !== a.consistencyPercentage) {
        return b.consistencyPercentage - a.consistencyPercentage;
      }
      if (b.completedCount !== a.completedCount) {
        return b.completedCount - a.completedCount;
      }
      if (b.onTimeCount !== a.onTimeCount) {
        return b.onTimeCount - a.onTimeCount;
      }
      if (a.createdAt !== b.createdAt) {
        return a.createdAt - b.createdAt;
      }
      return a.userId.localeCompare(b.userId);
    });

    // 7. Assign ranks with Standard Competition Ranking (1224 ranking):
    //    Identical performance metrics share the rank; next rank reflects true position.
    let currentRank = 1;
    const leaderboard: LeaderboardEntry[] = [];
    const cachedEntries: CachedLeaderboardEntry[] = [];

    for (let i = 0; i < participantList.length; i++) {
      const entry = participantList[i];
      if (i > 0) {
        const prev = participantList[i - 1];
        const isTie =
          entry.consistencyPercentage === prev.consistencyPercentage &&
          entry.completedCount === prev.completedCount &&
          entry.onTimeCount === prev.onTimeCount;

        if (!isTie) {
          currentRank = i + 1;
        }
      } else {
        currentRank = 1;
      }

      cachedEntries.push({
        rank: currentRank,
        userId: entry.userId,
        name: entry.name,
        username: entry.username,
        completedCount: entry.completedCount,
        onTimeCount: entry.onTimeCount,
        currentStreak: entry.currentStreak,
        totalPossible: entry.totalPossible,
        consistencyPercentage: entry.consistencyPercentage,
      });

      leaderboard.push({
        rank: currentRank,
        name: entry.name,
        username: entry.username,
        completedCount: entry.completedCount,
        onTimeCount: entry.onTimeCount,
        currentStreak: entry.currentStreak,
        totalPossible: entry.totalPossible,
        consistencyPercentage: entry.consistencyPercentage,
        isCurrentUser: entry.isCurrentUser,
      });
    }

    // Cache pre-computed leaderboard results for this period & date
    leaderboardCache.set(cacheKey, {
      period,
      startDate,
      endDate,
      entries: cachedEntries,
      totalParticipants: leaderboard.length,
      cachedAt: Date.now(),
    });

    // Prune stale cache entries if map exceeds 200 items
    if (leaderboardCache.size > 200) {
      const cutoff = Date.now() - LEADERBOARD_CACHE_TTL_MS;
      for (const [key, item] of leaderboardCache.entries()) {
        if (item.cachedAt < cutoff) {
          leaderboardCache.delete(key);
        }
      }
    }

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
      {
        status: 200,
        headers: {
          'Cache-Control': 'private, max-age=15, stale-while-revalidate=30',
        },
      }
    );
  } catch (error) {
    console.error('Error in GET /api/leaderboard:', error);
    return NextResponse.json(
      { success: false, error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
