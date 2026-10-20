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

export const STORAGE_KEY_DAILY_PRAYERS = 'salahtrack_daily_prayers';
export const STORAGE_KEY_HISTORY_RECORDS = 'salahtrack_history_records';
export const STORAGE_KEY_LAST_ACTIVE_DATE = 'salahtrack_last_active_date';
export const STORAGE_KEY_QAZA_COUNT = 'salahtrack_qaza_count';
export const STORAGE_KEY_STREAK = 'salahtrack_streak';

export const ALL_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export const MAX_COOKIE_BYTE_LENGTH = 2048;

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

    for (const prayer of prayers) {
      const normalizedStatus: PrayerStatus = prayer.status === 'PRAYED' ? 'PRAYED_ON_TIME' : prayer.status;
      const currentEntry = updatedPrayers[prayer.id] || { status: 'PENDING' };

      const isCompleted = normalizedStatus === 'PRAYED_ON_TIME' || normalizedStatus === 'PRAYED_LATE';
      const prayedAt = isCompleted
        ? currentEntry.prayedAt || prayer.updatedAt || new Date().toISOString()
        : currentEntry.prayedAt;

      updatedPrayers[prayer.id] = {
        ...currentEntry,
        status: normalizedStatus,
        prayedAt,
      };
    }

    records[liturgicalDate] = {
      ...existingRecord,
      prayers: updatedPrayers,
      updatedAt: new Date().toISOString(),
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
 * Calculates uncompleted prayers that should be converted to Qaza.
 */
export function archiveLiturgicalDay(
  completedDate: string,
  prayers: PrayerItem[]
): { uncompletedCount: number } {
  if (typeof window === 'undefined' || !completedDate) {
    return { uncompletedCount: 0 };
  }

  try {
    mirrorDailyPrayersToHistory(completedDate, prayers);

    const uncompletedCount = prayers.filter(
      (p) => p.status === 'PENDING' || p.status === 'MISSED'
    ).length;

    return { uncompletedCount };
  } catch (err) {
    console.error('Failed to archive liturgical day:', err);
    return { uncompletedCount: 0 };
  }
}
