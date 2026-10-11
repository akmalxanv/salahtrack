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
export function calculateStreakTransition(
  currentStreak: StreakData,
  actionDate: string,
  hasCompletedPrayer: boolean
): StreakData {
  if (hasCompletedPrayer) {
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

  // When prayer was uncompleted (hasCompletedPrayer === false)
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
 * @param recordMap Map of date (YYYY-MM-DD) to count of completed prayers on that date
 * @param referenceDateStr Anchor date for "today" (YYYY-MM-DD)
 */
export function calculateStreakFromHistory(
  recordMap: Map<string, number>,
  referenceDateStr: string
): StreakData {
  const activeDates = Array.from(recordMap.entries())
    .filter(([, count]) => count > 0)
    .map(([date]) => date)
    .sort();

  if (activeDates.length === 0) {
    return { ...DEFAULT_STREAK };
  }

  // 1. Calculate best streak across entire history
  let bestStreak = 0;
  let tempStreak = 0;
  let prevDateStr: string | null = null;

  for (const dateStr of activeDates) {
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
  const activeDatesUpToReference = activeDates.filter((d) => d <= referenceDateStr);
  const mostRecentActiveDate = activeDatesUpToReference.length > 0
    ? activeDatesUpToReference[activeDatesUpToReference.length - 1]
    : '';

  // 3. Calculate current streak backwards from referenceDateStr
  let currentStreak = 0;
  const todayCount = recordMap.get(referenceDateStr) || 0;

  let checkDateStr: string;
  if (todayCount > 0) {
    checkDateStr = referenceDateStr;
  } else {
    // Today has no completed prayers yet; check if yesterday was active
    checkDateStr = getYesterdayString(referenceDateStr);
  }

  while (true) {
    const count = recordMap.get(checkDateStr) || 0;
    if (count > 0) {
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
