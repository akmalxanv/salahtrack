/**
 * SalahTrack Client Storage Synchronization Engine
 *
 * Manages date-keyed localStorage persistence and synchronization between
 * HomeDashboard daily prayers and the historical prayer ledger (salahtrack_history_records).
 * Ensures instant 0ms optimistic UI updates across all tabs and routes (/progress, /calendar, /stats).
 *
 * Governing Standard: AGENTS.md & Phase 2 Blueprint
 */

import type { PrayerId, PrayerItem, PrayerStatus, PrayerHistoryRecord } from '@/types/prayer';
import { calculateAccountabilityFines, calculateAccountabilityLedger } from './accountability.ts';
import { calculateStreakFromHistory } from './streak.ts';
import { parseDateComponents, formatDateString } from './calendar.ts';
import { PLATFORM_LAUNCH_DATE, DEFAULT_TIMEZONE } from './prayer-cycle.ts';
import { getBrowserTimezone } from './location.ts';

export const STORAGE_KEY_DAILY_PRAYERS = 'salahtrack_daily_prayers';
export const STORAGE_KEY_HISTORY_RECORDS = 'salahtrack_history_records';
export const STORAGE_KEY_LAST_ACTIVE_DATE = 'salahtrack_last_active_date';
export const STORAGE_KEY_QAZA_COUNT = 'salahtrack_qaza_count';
export const STORAGE_KEY_STREAK = 'salahtrack_streak';
export const STORAGE_KEY_ACCOUNTABILITY_CACHE = 'salahtrack_accountability_cache';
export const STORAGE_KEY_SETTLED_DONATIONS = 'salahtrack_settled_donations';
export const STORAGE_KEY_PLATFORM_START_DATE = 'salahtrack_platform_start_date';
export const STORAGE_KEY_ACTIVE_USER_ID = 'salahtrack_active_user_id';
export const STORAGE_KEY_PENDING_SYNC_QUEUE = 'salahtrack_pending_sync_queue';

export const ALL_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const MAX_COOKIE_BYTE_LENGTH = 2048;

export function resolveEffectiveStartDate(minStartDate?: string): string {
  if (
    typeof minStartDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(minStartDate) &&
    minStartDate > PLATFORM_LAUNCH_DATE
  ) {
    return minStartDate;
  }
  return PLATFORM_LAUNCH_DATE;
}

/**
 * Returns or initializes the persistent start date for guest mode.
 * Never sets a date earlier than PLATFORM_LAUNCH_DATE and preserves any existing
 * legitimate records already present in localStorage.
 */
export function getOrInitGuestStartDate(activeDate: string): string {
  if (typeof window === 'undefined') return PLATFORM_LAUNCH_DATE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY_PLATFORM_START_DATE);
    if (stored && /^\d{4}-\d{2}-\d{2}$/.test(stored)) {
      return resolveEffectiveStartDate(stored);
    }

    const records = getStoredHistoryRecords();
    const existingDates = Object.keys(records)
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= PLATFORM_LAUNCH_DATE)
      .sort();

    let candidate = activeDate && /^\d{4}-\d{2}-\d{2}$/.test(activeDate) ? activeDate : PLATFORM_LAUNCH_DATE;
    if (existingDates.length > 0 && existingDates[0] < candidate) {
      candidate = existingDates[0];
    }
    const effective = resolveEffectiveStartDate(candidate);
    window.localStorage.setItem(STORAGE_KEY_PLATFORM_START_DATE, effective);
    return effective;
  } catch {
    return PLATFORM_LAUNCH_DATE;
  }
}

/**
 * Isolates cached localStorage prayer data across account switches and logouts.
 * Prevents User A's cached prayer/streak/accountability data from bleeding into User B's session.
 */
export function syncActiveUserContext(nextUserId: string | null): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const prevUserId = window.localStorage.getItem(STORAGE_KEY_ACTIVE_USER_ID);
    const normalizedNext = nextUserId || '';

    // Clear user-scoped prayer caches when logging out, switching accounts,
    // or transitioning from Guest mode into an authenticated user session.
    const isLoggingOut = Boolean(prevUserId && !normalizedNext);
    const isSwitchingAccounts = Boolean(prevUserId && normalizedNext && prevUserId !== normalizedNext);
    const isLoggingInFromGuest = Boolean(!prevUserId && normalizedNext);
    const shouldClear = isLoggingOut || isSwitchingAccounts || isLoggingInFromGuest;

    if (shouldClear) {
      window.localStorage.removeItem(STORAGE_KEY_DAILY_PRAYERS);
      window.localStorage.removeItem(STORAGE_KEY_HISTORY_RECORDS);
      window.localStorage.removeItem(STORAGE_KEY_LAST_ACTIVE_DATE);
      window.localStorage.removeItem(STORAGE_KEY_QAZA_COUNT);
      window.localStorage.removeItem(STORAGE_KEY_STREAK);
      window.localStorage.removeItem(STORAGE_KEY_ACCOUNTABILITY_CACHE);
      window.localStorage.removeItem(STORAGE_KEY_SETTLED_DONATIONS);
      window.localStorage.removeItem(STORAGE_KEY_PLATFORM_START_DATE);
      window.localStorage.removeItem(STORAGE_KEY_PENDING_SYNC_QUEUE);
      setClientCookie(STORAGE_KEY_DAILY_PRAYERS, '', 0);
      setClientCookie(STORAGE_KEY_LAST_ACTIVE_DATE, '', 0);
      setClientCookie(STORAGE_KEY_QAZA_COUNT, '', 0);
      setClientCookie(STORAGE_KEY_STREAK, '', 0);
      dispatchStorageUpdate();
    }

    if (normalizedNext) {
      window.localStorage.setItem(STORAGE_KEY_ACTIVE_USER_ID, normalizedNext);
    } else {
      window.localStorage.removeItem(STORAGE_KEY_ACTIVE_USER_ID);
    }
    return shouldClear;
  } catch {
    return false;
  }
}

export interface PendingPrayerMutation {
  date: string;
  prayerId?: PrayerId;
  status?: PrayerStatus;
  prayers?: Partial<Record<PrayerId, PrayerStatus>>;
  timezone?: string;
  queuedAt: number;
}

export function enqueuePendingPrayerMutation(mutation: Omit<PendingPrayerMutation, 'queuedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PENDING_SYNC_QUEUE);
    const list: PendingPrayerMutation[] = raw ? JSON.parse(raw) : [];
    const safeList = Array.isArray(list) ? list : [];

    const filtered = safeList.filter((item) => {
      if (item.date !== mutation.date) return true;
      if (mutation.prayers) {
        // A batch update/reset supersedes prior batch entries and matching prayerIds on the same date
        if (item.prayers) return false;
        if (item.prayerId && item.prayerId in mutation.prayers) return false;
        return true;
      }
      // Single prayer mutation supersedes prior single mutations for the same (date, prayerId)
      return item.prayerId !== mutation.prayerId;
    });

    filtered.push({ ...mutation, queuedAt: Date.now() });
    window.localStorage.setItem(STORAGE_KEY_PENDING_SYNC_QUEUE, JSON.stringify(filtered.slice(-100)));
  } catch {
    // ignore
  }
}

export function getPendingPrayerMutations(): PendingPrayerMutation[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PENDING_SYNC_QUEUE);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function removePendingPrayerMutation(date: string, prayerId?: PrayerId): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getPendingPrayerMutations();
    const next = current.filter((m) => {
      if (m.date !== date) return true;
      if (prayerId) {
        return m.prayerId !== prayerId;
      }
      // When prayerId is omitted, clear batch entries for this date
      return !m.prayers;
    });
    if (next.length === 0) {
      window.localStorage.removeItem(STORAGE_KEY_PENDING_SYNC_QUEUE);
    } else {
      window.localStorage.setItem(STORAGE_KEY_PENDING_SYNC_QUEUE, JSON.stringify(next));
    }
  } catch {
    // ignore
  }
}

export async function flushPendingPrayerMutations(fallbackTimezone?: string): Promise<number> {
  const queue = getPendingPrayerMutations();
  if (queue.length === 0) return 0;
  let synced = 0;
  for (const item of queue) {
    try {
      const resolvedTimezone = item.timezone || fallbackTimezone || getBrowserTimezone() || DEFAULT_TIMEZONE;
      const payload = item.prayers
        ? {
            date: item.date,
            prayers: item.prayers,
            timezone: resolvedTimezone,
          }
        : {
            date: item.date,
            prayerId: item.prayerId,
            status: item.status,
            timezone: resolvedTimezone,
          };

      const res = await fetch('/api/prayers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) {
        removePendingPrayerMutation(item.date, item.prayers ? undefined : item.prayerId);
        if (res.ok) synced++;
      } else {
        // Server error or rate-limit: keep unsynced items intact and retry later
        break;
      }
    } catch {
      // Still offline; keep unsynced items intact and retry on next online event
      break;
    }
  }
  return synced;
}

/**
 * Safely sets an HTTP-accessible client cookie for SSR hydration matching.
 * Enforces maximum size bounds (2048 bytes) to avoid 431 Request Header Fields Too Large,
 * sanitizes cookie keys to prevent header injection, and uses encodeURIComponent to prevent CRLF injection.
 */
function setClientCookie(name: string, value: string, maxAgeSeconds = 31536000): void {
  if (typeof window === 'undefined') return;
  try {
    const safeName = name.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (!safeName) return;

    const encodedValue = encodeURIComponent(value);
    if (encodedValue.length > MAX_COOKIE_BYTE_LENGTH) {
      return;
    }

    const isSecure = window.location.protocol === 'https:';
    const secureAttr = isSecure ? '; Secure' : '';
    document.cookie = `${safeName}=${encodedValue}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax${secureAttr}`;
  } catch {
    // ignore
  }
}

/**
 * Dispatches the custom local-storage-update event so all listening hooks refresh
 */
export function dispatchStorageUpdate(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new Event('local-storage-update'));
  } catch {
    // ignore
  }
}

/**
 * Retrieves all stored history records from localStorage with prototype pollution protection.
 */
export function getStoredHistoryRecords(): Record<string, PrayerHistoryRecord> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_HISTORY_RECORDS);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const cleanRecords: Record<string, PrayerHistoryRecord> = Object.create(null);
      for (const [dateKey, record] of Object.entries(parsed)) {
        if (
          dateKey !== '__proto__' &&
          dateKey !== 'constructor' &&
          dateKey !== 'prototype' &&
          /^\d{4}-\d{2}-\d{2}$/.test(dateKey) &&
          record &&
          typeof record === 'object'
        ) {
          cleanRecords[dateKey] = record as PrayerHistoryRecord;
        }
      }
      return cleanRecords;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * Persists history records to localStorage and notifies listeners
 */
export function saveStoredHistoryRecords(records: Record<string, PrayerHistoryRecord>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_HISTORY_RECORDS, JSON.stringify(records));
    dispatchStorageUpdate();
  } catch (err) {
    console.error('Failed to save history records to localStorage:', err);
  }
}

/**
 * Mirrors daily prayers into salahtrack_history_records under the specified liturgical date.
 * Preserves existing timestamps, notes, and fines if already recorded.
 */
export function mirrorDailyPrayersToHistory(
  liturgicalDate: string,
  prayers: PrayerItem[]
): Record<string, PrayerHistoryRecord> {
  if (typeof window === 'undefined' || !liturgicalDate) return {};

  try {
    const records = getStoredHistoryRecords();
    const existingRecord: PrayerHistoryRecord = records[liturgicalDate] || {
      date: liturgicalDate,
      prayers: {
        fajr: { status: 'PENDING' },
        dhuhr: { status: 'PENDING' },
        asr: { status: 'PENDING' },
        maghrib: { status: 'PENDING' },
        isha: { status: 'PENDING' },
      },
      finesAccrued: 0,
    };

    const updatedPrayers = { ...existingRecord.prayers };
    const nowIso = new Date().toISOString();

    for (const prayer of prayers) {
      const normalizedStatus: PrayerStatus = prayer.status === 'PRAYED' ? 'PRAYED_ON_TIME' : prayer.status;
      const currentEntry = updatedPrayers[prayer.id] || { status: 'PENDING' };

      const isCompleted = normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE';
      const isPending = normalizedStatus === 'PENDING';
      const prayedAt = isPending
        ? undefined
        : isCompleted
          ? currentEntry.prayedAt || prayer.updatedAt || nowIso
          : currentEntry.prayedAt;

      const missedAt = isPending
        ? undefined
        : normalizedStatus === 'MISSED'
          ? currentEntry.missedAt || prayer.updatedAt || nowIso
          : currentEntry.missedAt;

      const madeUpAt = isPending
        ? undefined
        : normalizedStatus === 'MADE_UP'
          ? currentEntry.madeUpAt || prayer.updatedAt || nowIso
          : currentEntry.madeUpAt;

      updatedPrayers[prayer.id] = {
        ...currentEntry,
        status: normalizedStatus,
        prayedAt,
        missedAt,
        madeUpAt,
      };
    }

    const calculatedFines = calculateAccountabilityFines(existingRecord.date, updatedPrayers);

    records[liturgicalDate] = {
      ...existingRecord,
      prayers: updatedPrayers,
      finesAccrued: calculatedFines,
      updatedAt: nowIso,
    };

    saveStoredHistoryRecords(records);
    return records;
  } catch (err) {
    console.error('Failed to mirror daily prayers to history:', err);
    return {};
  }
}

/**
 * Saves current liturgical daily prayers, updates cookie with liturgicalDate envelope,
 * records last active date, mirrors into history, and dispatches update event.
 */
export function saveDailyPrayersSync(liturgicalDate: string, prayers: PrayerItem[]): void {
  if (typeof window === 'undefined' || !liturgicalDate) return;

  try {
    // 1. Save raw array to localStorage for useLocalStorage hook compatibility
    window.localStorage.setItem(STORAGE_KEY_DAILY_PRAYERS, JSON.stringify(prayers));

    // 2. Save last active date
    window.localStorage.setItem(STORAGE_KEY_LAST_ACTIVE_DATE, JSON.stringify(liturgicalDate));

    // 3. Set cookie with wrapped envelope { date, prayers } for SSR hydration matching
    const cookiePayload = JSON.stringify({ date: liturgicalDate, prayers });
    setClientCookie(STORAGE_KEY_DAILY_PRAYERS, cookiePayload);
    setClientCookie(STORAGE_KEY_LAST_ACTIVE_DATE, JSON.stringify(liturgicalDate));

    // 4. Mirror into salahtrack_history_records
    mirrorDailyPrayersToHistory(liturgicalDate, prayers);

    // 5. Notify all listeners
    dispatchStorageUpdate();
  } catch (err) {
    console.error('Failed to save daily prayers sync:', err);
  }
}

/**
 * Loads prayers for a specific liturgical date from localStorage.
 * If history record exists for the date, maps statuses onto defaultPrayers.
 * If not in history, checks daily store if lastActiveDate matches liturgicalDate.
 * Otherwise returns default pending prayers.
 */
export function loadPrayersForLiturgicalDate(
  liturgicalDate: string,
  defaultPrayers: PrayerItem[]
): PrayerItem[] {
  if (typeof window === 'undefined' || !liturgicalDate) return defaultPrayers;

  try {
    const records = getStoredHistoryRecords();
    const historyRec = records[liturgicalDate];

    if (historyRec?.prayers) {
      return defaultPrayers.map((p) => {
        const entry = historyRec.prayers[p.id];
        return {
          ...p,
          status: entry?.status || 'PENDING',
        };
      });
    }

    // Fallback: check if daily store has matching active date
    const rawDate = window.localStorage.getItem(STORAGE_KEY_LAST_ACTIVE_DATE);
    const lastDate = rawDate ? JSON.parse(rawDate) : null;
    if (lastDate === liturgicalDate) {
      const rawDaily = window.localStorage.getItem(STORAGE_KEY_DAILY_PRAYERS);
      if (rawDaily) {
        const parsed = JSON.parse(rawDaily);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as PrayerItem[];
        }
      }
    }

    return defaultPrayers.map((p) => ({ ...p, status: 'PENDING' }));
  } catch {
    return defaultPrayers;
  }
}

/**
 * Archives a completed liturgical day into salahtrack_history_records.
 * Ensures all 5 prayers exist. Any prayer with status 'PENDING' is converted to 'MISSED'
 * with missedAt timestamp ONLY when completedDate >= effectiveStartDate (never predating
 * platform launch or user activation date).
 * Recalculates finesAccrued for the completed day.
 * Returns { uncompletedCount } representing total uncompleted prayers (converted to MISSED or already MISSED).
 */
export function archiveLiturgicalDay(
  completedDate: string,
  prayers: PrayerItem[],
  minStartDate: string = PLATFORM_LAUNCH_DATE
): { uncompletedCount: number } {
  if (typeof window === 'undefined' || !completedDate) {
    return { uncompletedCount: 0 };
  }

  const effectiveStartDate = resolveEffectiveStartDate(minStartDate);
  if (completedDate < effectiveStartDate) {
    return { uncompletedCount: 0 };
  }

  try {
    const records = getStoredHistoryRecords();
    const existingRecord: PrayerHistoryRecord = records[completedDate] || {
      date: completedDate,
      prayers: {
        fajr: { status: 'PENDING' },
        dhuhr: { status: 'PENDING' },
        asr: { status: 'PENDING' },
        maghrib: { status: 'PENDING' },
        isha: { status: 'PENDING' },
      },
      finesAccrued: 0,
    };

    const updatedPrayers = { ...existingRecord.prayers };
    const nowIso = new Date().toISOString();
    let uncompletedCount = 0;

    for (const prayerId of ALL_PRAYER_IDS) {
      const incoming = prayers.find((p) => p.id === prayerId);
      const incomingStatus: PrayerStatus | undefined = incoming
        ? incoming.status === 'PRAYED'
          ? 'PRAYED_ON_TIME'
          : incoming.status
        : undefined;

      const currentEntry = updatedPrayers[prayerId];
      const effectiveStatus: PrayerStatus = incomingStatus || currentEntry?.status || 'PENDING';

      if (effectiveStatus === 'PENDING' || effectiveStatus === 'MISSED') {
        updatedPrayers[prayerId] = {
          ...currentEntry,
          status: 'MISSED',
          missedAt: currentEntry?.missedAt || incoming?.updatedAt || nowIso,
        };
        uncompletedCount++;
      } else {
        const isCompleted = effectiveStatus === 'PRAYED_ON_TIME' || effectiveStatus === 'PRAYED_LATE';
        updatedPrayers[prayerId] = {
          ...currentEntry,
          status: effectiveStatus,
          prayedAt: isCompleted ? currentEntry?.prayedAt || incoming?.updatedAt || nowIso : currentEntry?.prayedAt,
          madeUpAt: effectiveStatus === 'MADE_UP' ? currentEntry?.madeUpAt || incoming?.updatedAt || nowIso : currentEntry?.madeUpAt,
        };
      }
    }

    const finesAccrued = calculateAccountabilityFines(completedDate, updatedPrayers);

    records[completedDate] = {
      ...existingRecord,
      date: completedDate,
      prayers: updatedPrayers,
      finesAccrued,
      updatedAt: nowIso,
    };

    saveStoredHistoryRecords(records);
    return { uncompletedCount };
  } catch (err) {
    console.error('Failed to archive liturgical day:', err);
    return { uncompletedCount: 0 };
  }
}

/**
 * Catches up multi-day gaps between fromDate and toDate (exclusive).
 * For each intermediate calendar date missing from history (strictly on or after effectiveStartDate),
 * creates a record with all 5 prayers set to status: 'MISSED' and finesAccrued: 75000.
 * Never creates missed/Qaza records for dates before minStartDate or PLATFORM_LAUNCH_DATE.
 * Returns total missed prayers created across all intermediate days.
 */
export function catchupMultiDayGap(
  fromDate: string,
  toDate: string,
  minStartDate: string = PLATFORM_LAUNCH_DATE
): number {
  if (typeof window === 'undefined' || !fromDate || !toDate || fromDate >= toDate) {
    return 0;
  }

  const effectiveStartDate = resolveEffectiveStartDate(minStartDate);
  if (toDate <= effectiveStartDate) {
    return 0;
  }

  try {
    const records = getStoredHistoryRecords();
    let missedPrayersCreated = 0;
    let modified = false;

    // Advance day by day strictly using UTC to avoid DST hour skew
    const { year: fromY, month: fromM, day: fromD } = parseDateComponents(fromDate);
    let currentUtc = Date.UTC(fromY, fromM - 1, fromD) + 24 * 60 * 60 * 1000;

    // Clamp start to effectiveStartDate so pre-activation days are never processed
    const { year: startY, month: startM, day: startD } = parseDateComponents(effectiveStartDate);
    const minStartUtc = Date.UTC(startY, startM - 1, startD);
    if (currentUtc < minStartUtc) {
      currentUtc = minStartUtc;
    }

    const { year: toY, month: toM, day: toD } = parseDateComponents(toDate);
    const endUtc = Date.UTC(toY, toM - 1, toD);

    // Safety cap at 365 days to guard against corrupted localStorage dates
    const maxStartUtc = endUtc - 365 * 24 * 60 * 60 * 1000;
    if (currentUtc < maxStartUtc) {
      currentUtc = maxStartUtc;
    }

    const nowIso = new Date().toISOString();

    while (currentUtc < endUtc) {
      const d = new Date(currentUtc);
      const dateStr = formatDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());

      if (dateStr >= effectiveStartDate && !records[dateStr]) {
        records[dateStr] = {
          date: dateStr,
          prayers: {
            fajr: { status: 'MISSED', missedAt: nowIso },
            dhuhr: { status: 'MISSED', missedAt: nowIso },
            asr: { status: 'MISSED', missedAt: nowIso },
            maghrib: { status: 'MISSED', missedAt: nowIso },
            isha: { status: 'MISSED', missedAt: nowIso },
          },
          finesAccrued: 75000,
          updatedAt: nowIso,
        };
        missedPrayersCreated += 5;
        modified = true;
      }

      currentUtc += 24 * 60 * 60 * 1000;
    }

    if (modified) {
      saveStoredHistoryRecords(records);
    }

    return missedPrayersCreated;
  } catch (err) {
    console.error('Failed to catch up multi-day gap:', err);
    return 0;
  }
}

/**
 * Recomputes and persists qaza count, streak, and accountability cache from stored history records.
 */
export function syncDerivedMetricsToStorage(
  records: Record<string, PrayerHistoryRecord>,
  referenceDateStr: string
): void {
  if (typeof window === 'undefined' || !referenceDateStr) return;
  try {
    const ledger = calculateAccountabilityLedger(records, referenceDateStr);
    const qazaCount = ledger.pendingQazaCount ?? ledger.missedCount;
    const acct = {
      totalAmount: ledger.totalAmount,
      pendingQazaCount: qazaCount,
    };

    const recordMap = new Map<string, number>();
    for (const [dateKey, rec] of Object.entries(records)) {
      if (!rec?.prayers) continue;
      let completed = 0;
      for (const pId of ALL_PRAYER_IDS) {
        const st = rec.prayers[pId]?.status;
        if (st === 'PRAYED_ON_TIME' || st === 'PRAYED' || st === 'PRAYED_LATE') {
          completed++;
        }
      }
      recordMap.set(dateKey, completed === 5 ? 5 : 0);
    }
    const streakData = calculateStreakFromHistory(recordMap, referenceDateStr);

    const qazaStr = JSON.stringify(qazaCount);
    const streakStr = JSON.stringify(streakData);
    window.localStorage.setItem(STORAGE_KEY_QAZA_COUNT, qazaStr);
    window.localStorage.setItem(STORAGE_KEY_STREAK, streakStr);
    window.localStorage.setItem(STORAGE_KEY_ACCOUNTABILITY_CACHE, JSON.stringify(acct));
    setClientCookie(STORAGE_KEY_QAZA_COUNT, qazaStr);
    setClientCookie(STORAGE_KEY_STREAK, streakStr);
    dispatchStorageUpdate();
  } catch {
    // ignore
  }
}

/**
 * Resets all non-paid prayers for a specific date back to PENDING in localStorage.
 * If resetting a pre-start date results in all 5 prayers being PENDING without notes or payments,
 * prunes the date key completely so zero ghost indicators remain on pre-start calendar dates.
 */
export function resetDateInStoredHistory(
  targetDate: string,
  minStartDate?: string
): Record<string, PrayerHistoryRecord> {
  if (typeof window === 'undefined' || !targetDate) return {};
  try {
    const records = getStoredHistoryRecords();
    const existing = records[targetDate];
    if (!existing || !existing.prayers) return records;

    const updatedPrayers = { ...existing.prayers };
    for (const pId of ALL_PRAYER_IDS) {
      const entry = updatedPrayers[pId];
      if (!entry?.isPaid) {
        updatedPrayers[pId] = {
          status: 'PENDING',
          isPaid: false,
          paidAmount: 0,
        };
      }
    }

    let effectiveStart = PLATFORM_LAUNCH_DATE;
    if (minStartDate) {
      effectiveStart = resolveEffectiveStartDate(minStartDate);
    } else {
      const storedStart = window.localStorage.getItem(STORAGE_KEY_PLATFORM_START_DATE);
      if (storedStart) {
        effectiveStart = resolveEffectiveStartDate(storedStart);
      }
    }

    const allResetAndClean = ALL_PRAYER_IDS.every((pId) => {
      const entry = updatedPrayers[pId];
      return (
        (!entry || entry.status === 'PENDING') &&
        !entry?.isPaid &&
        !entry?.notes &&
        !(entry?.paidAmount && entry.paidAmount > 0)
      );
    });

    if (targetDate < effectiveStart && allResetAndClean) {
      delete records[targetDate];
    } else {
      records[targetDate] = {
        ...existing,
        prayers: updatedPrayers,
        finesAccrued: calculateAccountabilityFines(targetDate, updatedPrayers),
        updatedAt: new Date().toISOString(),
      };
    }

    saveStoredHistoryRecords(records);
    return records;
  } catch {
    return {};
  }
}
