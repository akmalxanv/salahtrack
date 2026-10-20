/**
 * SalahTrack Islamic Liturgical Prayer-Cycle Engine
 *
 * Implements pure, zero-dependency temporal calculations for the Islamic prayer day.
 *
 * Islamic Day Boundary Rules:
 * - In Islamic fiqh, the daily liturgical cycle is demarcated by Fajr (dawn), not midnight (00:00).
 * - Isha prayer window begins at Isha adhan and extends overnight through midnight until the
 *   onset of true dawn (Fajr) the following morning.
 * - Between 00:00:00 and Fajr adhan (post-midnight pre-Fajr window):
 *   * The active liturgical prayer date is yesterday's calendar date.
 *   * Isha from yesterday continues to be the active prayer.
 *   * Next upcoming prayer is today's Fajr.
 * - At or after Fajr adhan:
 *   * The active liturgical prayer date rolls over to today's calendar date.
 *   * Fajr becomes active.
 *
 * Governing Standard: AGENTS.md & PM Architectural Specification
 */

import type { PrayerId } from '../types/prayer.ts';
import { getYesterdayString } from './streak.ts';

export const DEFAULT_FAJR_TIME = '04:47';
export const DEFAULT_DHUHR_TIME = '12:13';
export const DEFAULT_ASR_TIME = '16:20';
export const DEFAULT_MAGHRIB_TIME = '18:05';
export const DEFAULT_ISHA_TIME = '19:32';
export const DEFAULT_TIMEZONE = 'Asia/Tashkent';

export const ORDERED_PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

export interface ZonedDateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm
}

export interface ParsedTime {
  hours: number;
  minutes: number;
  timeStr: string;
}

export interface PrayerCycleTimings {
  fajr?: { time: string; endTime?: string } | string;
  dhuhr?: { time: string; endTime?: string } | string;
  asr?: { time: string; endTime?: string } | string;
  maghrib?: { time: string; endTime?: string } | string;
  isha?: { time: string; endTime?: string } | string;
}

export interface PrayerCycleOptions {
  now?: Date;
  fajrTimeStr?: string;
  ishaTimeStr?: string;
  timings?: PrayerCycleTimings;
  timezone?: string;
}

export interface PrayerCycleResolution {
  liturgicalDate: string;          // Active prayer date (YYYY-MM-DD)
  calendarDate: string;            // Gregorian calendar date in target timezone (YYYY-MM-DD)
  isPostMidnight: boolean;         // true if between 00:00:00 and Fajr adhan
  activePrayerId: PrayerId | null; // Currently active prayer (or null during non-obligatory gap like Duha)
  nextPrayerId: PrayerId;          // Next obligatory prayer
  fajrTime: string;                // Fajr start time (HH:mm)
  ishaTime: string;                // Isha start time (HH:mm)
  currentMinutes: number;          // Minutes elapsed since midnight in target timezone
  timeUntilNextMinutes: number;    // Minutes remaining until next prayer
  hoursUntilNext: number;          // Hours component remaining
  minutesUntilNext: number;        // Minutes component remaining (0-59)
}

/**
 * Parses an HH:mm or H:m time string into numeric hours and minutes.
 * Returns normalized two-digit 'HH:mm' string.
 * Gracefully falls back to defaultTime if malformed or missing.
 */
export function parseTime(timeStr?: string, defaultTime = DEFAULT_FAJR_TIME): ParsedTime {
  if (typeof timeStr !== 'string' || !timeStr.includes(':')) {
    const [defH, defM] = defaultTime.split(':').map((v) => parseInt(v, 10));
    const safeH = isNaN(defH) ? 5 : defH;
    const safeM = isNaN(defM) ? 0 : defM;
    const pad = (n: number) => String(n).padStart(2, '0');
    return { hours: safeH, minutes: safeM, timeStr: `${pad(safeH)}:${pad(safeM)}` };
  }

  const parts = timeStr.trim().split(':');
  let hours = parseInt(parts[0], 10);
  let minutes = parseInt(parts[1], 10);

  if (isNaN(hours) || hours < 0 || hours > 23) {
    hours = 5;
  }
  if (isNaN(minutes) || minutes < 0 || minutes > 59) {
    minutes = 0;
  }

  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    hours,
    minutes,
    timeStr: `${pad(hours)}:${pad(minutes)}`,
  };
}

/**
 * Converts hours and minutes into total minutes since midnight (0..1439).
 */
export function timeToMinutes(hours: number, minutes: number): number {
  return Math.max(0, Math.min(1439, hours * 60 + minutes));
}

/**
 * Converts an HH:mm time string directly to minutes since midnight.
 */
export function timeStringToMinutes(timeStr?: string, defaultTime = DEFAULT_FAJR_TIME): number {
  const { hours, minutes } = parseTime(timeStr, defaultTime);
  return timeToMinutes(hours, minutes);
}

/**
 * Validates and sanitizes IANA timezone strings against prototype pollution,
 * control character injection, and invalid formats.
 */
export function sanitizeTimezone(tz?: unknown): string {
  if (typeof tz !== 'string') return DEFAULT_TIMEZONE;
  const trimmed = tz.trim();
  if (
    !trimmed ||
    trimmed.length > 64 ||
    trimmed === '__proto__' ||
    trimmed === 'constructor' ||
    trimmed === 'prototype' ||
    !/^[A-Za-z0-9_\-+]+(?:\/[A-Za-z0-9_\-+]+)*$/.test(trimmed)
  ) {
    return DEFAULT_TIMEZONE;
  }
  return trimmed;
}

/**
 * Extracts date and time components for a Date in a specific IANA timezone.
 * Resilient against invalid timezone strings, prototype pollution, invalid Date inputs, and DST shifts.
 */
export function getZonedDateParts(
  date: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE
): ZonedDateParts {
  const safeDate = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const safeTz = sanitizeTimezone(timezone);

  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: safeTz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });

    const parts = formatter.formatToParts(safeDate);
    const getVal = (type: Intl.DateTimeFormatPartTypes): string =>
      parts.find((p) => p.type === type)?.value || '00';

    const year = parseInt(getVal('year'), 10);
    const month = parseInt(getVal('month'), 10);
    const day = parseInt(getVal('day'), 10);
    let hour = parseInt(getVal('hour'), 10);
    if (hour === 24) hour = 0;
    const minute = parseInt(getVal('minute'), 10);
    const second = parseInt(getVal('second'), 10);

    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const timeStr = `${pad(hour)}:${pad(minute)}`;

    return { year, month, day, hour, minute, second, dateStr, timeStr };
  } catch {
    // Safe fallback using validated Date methods
    const year = safeDate.getFullYear();
    const month = safeDate.getMonth() + 1;
    const day = safeDate.getDate();
    const hour = safeDate.getHours();
    const minute = safeDate.getMinutes();
    const second = safeDate.getSeconds();

    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${year}-${pad(month)}-${pad(day)}`;
    const timeStr = `${pad(hour)}:${pad(minute)}`;

    return { year, month, day, hour, minute, second, dateStr, timeStr };
  }
}

/**
 * Returns Gregorian calendar date string (YYYY-MM-DD) for a Date in target timezone.
 */
export function getCalendarDate(date: Date = new Date(), timezone = DEFAULT_TIMEZONE): string {
  return getZonedDateParts(date, timezone).dateStr;
}

/**
 * Returns true if current time in target timezone is between 00:00:00 and Fajr adhan.
 * During this interval, Isha from the previous calendar day is continuing.
 */
export function isPostMidnightPreFajr(
  now: Date = new Date(),
  fajrTimeStr = DEFAULT_FAJR_TIME,
  timezone = DEFAULT_TIMEZONE
): boolean {
  const { hour, minute } = getZonedDateParts(now, timezone);
  const currentMinutes = timeToMinutes(hour, minute);
  const fajrMinutes = timeStringToMinutes(fajrTimeStr, DEFAULT_FAJR_TIME);

  return currentMinutes < fajrMinutes;
}

/**
 * Returns the active Islamic liturgical date (YYYY-MM-DD).
 * - If current time in timezone is before Fajr adhan (00:00 -> Fajr):
 *   returns yesterday's calendar date (Isha continues from yesterday).
 * - If current time is >= Fajr adhan:
 *   returns today's calendar date.
 */
export function getLiturgicalDate(
  now: Date = new Date(),
  fajrTimeStr = DEFAULT_FAJR_TIME,
  timezone = DEFAULT_TIMEZONE
): string {
  const { dateStr, hour, minute } = getZonedDateParts(now, timezone);
  const currentMinutes = timeToMinutes(hour, minute);
  const fajrMinutes = timeStringToMinutes(fajrTimeStr, DEFAULT_FAJR_TIME);

  if (currentMinutes < fajrMinutes) {
    return getYesterdayString(dateStr);
  }

  return dateStr;
}

/**
 * Helper to safely extract an HH:mm string from either a string or an object with `{ time: string }`.
 */
function extractTime(
  entry?: { time: string; endTime?: string } | string,
  fallback = '05:00'
): string {
  if (!entry) return fallback;
  if (typeof entry === 'string') return parseTime(entry, fallback).timeStr;
  if (typeof entry.time === 'string') return parseTime(entry.time, fallback).timeStr;
  return fallback;
}

/**
 * Resolves full Islamic prayer cycle state at a given instant:
 * - Active liturgical date (accounting for midnight rollover rule)
 * - Current calendar date
 * - Whether currently in post-midnight pre-Fajr window
 * - Active prayer ID (Isha extends overnight until Fajr)
 * - Next prayer ID and countdown minutes
 */
export function resolvePrayerCycle(options: PrayerCycleOptions = {}): PrayerCycleResolution {
  const now = options.now instanceof Date && !isNaN(options.now.getTime()) ? options.now : new Date();
  const timezone = sanitizeTimezone(options.timezone);
  const timings = options.timings;

  const fajrTime = extractTime(timings?.fajr || options.fajrTimeStr, DEFAULT_FAJR_TIME);
  const dhuhrTime = extractTime(timings?.dhuhr, DEFAULT_DHUHR_TIME);
  const asrTime = extractTime(timings?.asr, DEFAULT_ASR_TIME);
  const maghribTime = extractTime(timings?.maghrib, DEFAULT_MAGHRIB_TIME);
  const ishaTime = extractTime(timings?.isha || options.ishaTimeStr, DEFAULT_ISHA_TIME);

  const { dateStr: calendarDate, hour, minute } = getZonedDateParts(now, timezone);
  const currentMinutes = timeToMinutes(hour, minute);

  const fajrMinutes = timeStringToMinutes(fajrTime, DEFAULT_FAJR_TIME);
  const dhuhrMinutes = timeStringToMinutes(dhuhrTime, DEFAULT_DHUHR_TIME);
  const asrMinutes = timeStringToMinutes(asrTime, DEFAULT_ASR_TIME);
  const maghribMinutes = timeStringToMinutes(maghribTime, DEFAULT_MAGHRIB_TIME);
  const ishaMinutes = timeStringToMinutes(ishaTime, DEFAULT_ISHA_TIME);

  const isPostMidnight = currentMinutes < fajrMinutes;
  const liturgicalDate = isPostMidnight ? getYesterdayString(calendarDate) : calendarDate;

  // Determine active prayer and next prayer
  let activePrayerId: PrayerId | null = null;
  let nextPrayerId: PrayerId = 'fajr';
  let targetNextMinutes = fajrMinutes;

  if (isPostMidnight) {
    // 00:00 -> Fajr: Isha continues from yesterday night
    activePrayerId = 'isha';
    nextPrayerId = 'fajr';
    targetNextMinutes = fajrMinutes;
  } else if (currentMinutes >= fajrMinutes && currentMinutes < dhuhrMinutes) {
    // Fajr window
    // If Fajr end time (sunrise) is available, verify if still within Fajr window
    const fajrEndTime = typeof timings?.fajr === 'object' && timings.fajr?.endTime
      ? extractTime(timings.fajr.endTime, '06:19')
      : null;
    const sunriseMinutes = fajrEndTime ? timeStringToMinutes(fajrEndTime, '06:19') : null;

    if (sunriseMinutes && currentMinutes >= sunriseMinutes) {
      // Between Sunrise and Dhuhr (Duha / Ishraq gap - no obligatory prayer)
      activePrayerId = null;
    } else {
      activePrayerId = 'fajr';
    }
    nextPrayerId = 'dhuhr';
    targetNextMinutes = dhuhrMinutes;
  } else if (currentMinutes >= dhuhrMinutes && currentMinutes < asrMinutes) {
    activePrayerId = 'dhuhr';
    nextPrayerId = 'asr';
    targetNextMinutes = asrMinutes;
  } else if (currentMinutes >= asrMinutes && currentMinutes < maghribMinutes) {
    activePrayerId = 'asr';
    nextPrayerId = 'maghrib';
    targetNextMinutes = maghribMinutes;
  } else if (currentMinutes >= maghribMinutes && currentMinutes < ishaMinutes) {
    activePrayerId = 'maghrib';
    nextPrayerId = 'isha';
    targetNextMinutes = ishaMinutes;
  } else {
    // currentMinutes >= ishaMinutes -> Isha is active until next Fajr
    activePrayerId = 'isha';
    nextPrayerId = 'fajr';
    targetNextMinutes = fajrMinutes; // tomorrow's Fajr
  }

  // Calculate remaining countdown minutes
  let timeUntilNextMinutes = 0;
  if (targetNextMinutes > currentMinutes) {
    timeUntilNextMinutes = targetNextMinutes - currentMinutes;
  } else {
    // Overnight countdown (e.g. from 21:00 to 04:47 tomorrow)
    timeUntilNextMinutes = (1440 - currentMinutes) + targetNextMinutes;
  }

  const hoursUntilNext = Math.floor(timeUntilNextMinutes / 60);
  const minutesUntilNext = timeUntilNextMinutes % 60;

  return {
    liturgicalDate,
    calendarDate,
    isPostMidnight,
    activePrayerId,
    nextPrayerId,
    fajrTime,
    ishaTime,
    currentMinutes,
    timeUntilNextMinutes,
    hoursUntilNext,
    minutesUntilNext,
  };
}
