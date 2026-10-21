import type { StreakData } from '../types/prayer.ts';
import { DEFAULT_STREAK } from '../types/prayer.ts';

/**
 * Calculates the previous calendar day in YYYY-MM-DD format.
 * Uses UTC date calculations to avoid daylight saving or local timezone shifts.
 */
export function getYesterdayString(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().split('T')[0];
  }
  const [year, month, day] = parts.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().split('T')[0];
}

/**
 * Calculates the number of calendar days between two YYYY-MM-DD dates (toDate - fromDate).
 * Uses UTC midnight timestamps.
 */
export function getDaysDifference(fromDateStr: string, toDateStr: string): number {
  const [y1, m1, d1] = fromDateStr.split('-').map(Number);
  const [y2, m2, d2] = toDateStr.split('-').map(Number);
  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.round((utc2 - utc1) / MS_PER_DAY);
}

/**
 * Evaluates whether an existing streak remains valid when calendar date advances to todayStr.
 * - If lastActiveDate is todayStr or yesterday, streak remains valid (today is active or pending).
 * - If lastActiveDate is older than yesterday (> 1 full day difference), current streak resets to 0 while preserving best.
 */
export function evaluateRolloverStreak(streak: StreakData, todayStr: string): StreakData {
  if (!streak.lastActiveDate || streak.current === 0) {
    return {
      current: 0,
      best: streak.best || 0,
      lastActiveDate: streak.lastActiveDate || '',
    };
  }

  const diffDays = getDaysDifference(streak.lastActiveDate, todayStr);

  if (diffDays <= 1) {
    // 0 = active today; 1 = active yesterday, today pending
    return {
      current: streak.current,
      best: Math.max(streak.best, streak.current),
      lastActiveDate: streak.lastActiveDate,
    };
  }

  // More than 1 full calendar day skipped -> current streak resets to 0, best is preserved
  return {
    current: 0,
    best: Math.max(streak.best, streak.current),
    lastActiveDate: streak.lastActiveDate,
  };
}

/**
 * Calculates deterministic streak transition when prayer completion changes on actionDate.
 *
 * Rules:
 * 1. Starting new streak (0 -> 1 on first completed prayer).
 * 2. Maintaining streak on same day (additional prayers on same date don't increment current streak).
 * 3. Incrementing streak on consecutive day (yesterday -> today: N -> N + 1).
 * 4. Breaking streak when full calendar day skipped (>1 day difference resets current to 1 for this action).
 * 5. Best streak accurately tracks the all-time highest record.
 * 6. When hasCompletedPrayer is false and actionDate was lastActiveDate, reverts lastActiveDate and decrements current.
 */
/**
 * Calculates deterministic streak transition when prayer completion changes on actionDate.
 *
 * Rules:
 * 1. Starting new streak (0 -> 1 when all 5 daily prayers are completed: completedCount === 5).
 * 2. Maintaining streak on same day (actions on already-completed 5/5 date don't redundantly increment).
 * 3. Incrementing streak on consecutive qualifying day (yesterday 5/5 -> today 5/5: N -> N + 1).
 * 4. Breaking streak when full calendar day skipped (>1 day difference resets current to 1 for this 5/5 day).
 * 5. Best streak accurately tracks the all-time highest record of consecutive 5/5 days.
 * 6. When day is not/no longer completed (< 5) and actionDate was lastActiveDate, reverts lastActiveDate and decrements current.
 */
export function calculateStreakTransition(
  currentStreak: StreakData,
  actionDate: string,
  completedPrayers: boolean | number
): StreakData {
  const isDayCompleted =
    typeof completedPrayers === 'number'
      ? completedPrayers === 5
      : Boolean(completedPrayers);

  if (isDayCompleted) {
    // Starting a new streak if current is 0 or no previous active date
    if (!currentStreak.lastActiveDate || currentStreak.current === 0) {
      const newCurrent = 1;
      return {
        current: newCurrent,
        best: Math.max(currentStreak.best, newCurrent),
        lastActiveDate: actionDate,
      };
    }

    // Same-day action: maintain streak without redundant increment
    if (currentStreak.lastActiveDate === actionDate) {
      return {
        current: currentStreak.current,
        best: Math.max(currentStreak.best, currentStreak.current),
        lastActiveDate: actionDate,
      };
    }

    const diffDays = getDaysDifference(currentStreak.lastActiveDate, actionDate);

    // Consecutive day (yesterday -> today)
    if (diffDays === 1) {
      const newCurrent = currentStreak.current + 1;
      return {
        current: newCurrent,
        best: Math.max(currentStreak.best, newCurrent),
        lastActiveDate: actionDate,
      };
    }

    // Full calendar day skipped (>1 day difference)
    if (diffDays > 1) {
      const newCurrent = 1;
      return {
        current: newCurrent,
        best: Math.max(currentStreak.best, newCurrent),
        lastActiveDate: actionDate,
      };
    }

    // Action date in the past (diffDays < 0): preserve current state
    return {
      current: currentStreak.current,
      best: Math.max(currentStreak.best, currentStreak.current),
      lastActiveDate: currentStreak.lastActiveDate,
    };
  }

  // When day is NOT completed (< 5 prayers)
  if (currentStreak.lastActiveDate === actionDate) {
    if (currentStreak.current > 1) {
      return {
        current: currentStreak.current - 1,
        best: currentStreak.best,
        lastActiveDate: getYesterdayString(actionDate),
      };
    }
    return {
      current: 0,
      best: currentStreak.best,
      lastActiveDate: '',
    };
  }

  // Not actionDate: evaluate rollover
  return evaluateRolloverStreak(currentStreak, actionDate);
}

/**
 * Calculates deterministic streak metrics across user's complete prayer history relative to referenceDateStr.
 *
 * Rules:
 * - A day counts toward streak ONLY when all 5 daily prayers are completed (count === 5).
 * - Consecutive qualifying days (5/5) increment the streak.
 * - If any finished day (days strictly before referenceDateStr) has count < 5, streak resets to 0.
 * - If referenceDateStr (today) has count === 5, today increments streak.
 * - If referenceDateStr (today) has count < 5, but yesterday had count === 5,
 *   the streak up to yesterday is preserved (today is in progress and has not finished yet).
 * - If yesterday had count < 5 (and today < 5), current streak is 0.
 * - Best streak is the maximum consecutive run of 5/5 days across all history.
 *
 * @param recordMap Map of date (YYYY-MM-DD) to count of completed prayers on that date
 * @param referenceDateStr Anchor date for "today" (YYYY-MM-DD)
 */
export function calculateStreakFromHistory(
  recordMap: Map<string, number>,
  referenceDateStr: string
): StreakData {
  // A day qualifies toward a streak ONLY when all 5 daily prayers are completed (count === 5)
  const qualifyingDates = Array.from(recordMap.entries())
    .filter(([, count]) => count === 5)
    .map(([date]) => date)
    .sort();

  if (qualifyingDates.length === 0) {
    return { ...DEFAULT_STREAK };
  }

  // 1. Calculate best streak across entire history (maximum consecutive run of 5/5 days)
  let bestStreak = 0;
  let tempStreak = 0;
  let prevDateStr: string | null = null;

  for (const dateStr of qualifyingDates) {
    if (prevDateStr === null) {
      tempStreak = 1;
    } else {
      const diff = getDaysDifference(prevDateStr, dateStr);
      if (diff === 1) {
        tempStreak++;
      } else {
        tempStreak = 1;
      }
    }
    if (tempStreak > bestStreak) {
      bestStreak = tempStreak;
    }
    prevDateStr = dateStr;
  }

  // 2. Identify latest active date up to referenceDateStr
  const qualifyingUpToReference = qualifyingDates.filter((d) => d <= referenceDateStr);
  const mostRecentActiveDate =
    qualifyingUpToReference.length > 0
      ? qualifyingUpToReference[qualifyingUpToReference.length - 1]
      : '';

  // 3. Calculate current streak backwards from referenceDateStr
  // - If referenceDateStr (today) has count === 5, today increments streak.
  // - If referenceDateStr (today) has count < 5, but yesterday had count === 5,
  //   the streak up to yesterday is preserved (today is in progress).
  // - If yesterday had count < 5, current streak is 0.
  const todayCount = recordMap.get(referenceDateStr) || 0;
  const yesterdayStr = getYesterdayString(referenceDateStr);
  const yesterdayCount = recordMap.get(yesterdayStr) || 0;

  let checkDateStr: string | null = null;

  if (todayCount === 5) {
    checkDateStr = referenceDateStr;
  } else if (yesterdayCount === 5) {
    checkDateStr = yesterdayStr;
  } else {
    // Both today and yesterday failed to reach 5/5 -> current streak is 0
    return {
      current: 0,
      best: Math.max(bestStreak, 0),
      lastActiveDate: mostRecentActiveDate,
    };
  }

  let currentStreak = 0;
  while (checkDateStr !== null) {
    const count = recordMap.get(checkDateStr) || 0;
    if (count === 5) {
      currentStreak++;
      checkDateStr = getYesterdayString(checkDateStr);
    } else {
      break;
    }
  }

  return {
    current: currentStreak,
    best: Math.max(bestStreak, currentStreak),
    lastActiveDate: mostRecentActiveDate,
  };
}

/**
 * Safely validates and deserializes unknown data (e.g. from SSR cookies or localStorage)
 * into a valid StreakData object. Defends against malformed JSON, prototype pollution,
 * negative numbers, or non-finite values.
 *
 * @param data Unknown input value to validate
 * @returns Validated StreakData object, or null if input is malformed or invalid
 */
export function validateStreakData(data: unknown): StreakData | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const obj = data as Record<string, unknown>;

  const current =
    typeof obj.current === 'number' && Number.isFinite(obj.current) && obj.current >= 0
      ? Math.floor(obj.current)
      : null;

  const best =
    typeof obj.best === 'number' && Number.isFinite(obj.best) && obj.best >= 0
      ? Math.floor(obj.best)
      : null;

  const lastActiveDate =
    typeof obj.lastActiveDate === 'string' &&
    (obj.lastActiveDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(obj.lastActiveDate))
      ? obj.lastActiveDate
      : null;

  if (current === null || best === null || lastActiveDate === null) {
    return null;
  }

  return {
    current,
    best: Math.max(best, current),
    lastActiveDate,
  };
}
