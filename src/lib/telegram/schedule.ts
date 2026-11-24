/**
 * Pure scheduling logic for Telegram group announcements (no I/O, unit-tested).
 *
 * The cron endpoint is pinged every ~5 minutes. On each tick we rebuild the list of
 * events for "yesterday" and "today" (yesterday matters because Isha's nudge can fall
 * after local midnight) and fire every event whose instant has passed but whose
 * window has not closed yet. A late tick inside the window still delivers; a tick after
 * the window skips the event, so stale messages ("Asr has started" an hour late) are
 * never sent.
 */
import type { PrayerId } from '../../types/prayer.ts';

export const PRAYER_IDS: PrayerId[] = ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];

/** How long after an event's instant a tick may still deliver it. */
export const START_WINDOW_MIN = 15;
export const NUDGE_WINDOW_MIN = 20;
export const SUMMARY_WINDOW_MIN = 60;

/** Nudge this many minutes before the prayer's time runs out. */
export const NUDGE_BEFORE_END_MIN = 30;
/** Local time for the daily debt summary. */
export const DAILY_SUMMARY_TIME = '21:00';
/** Weekly leaderboard: Friday (Jumu'ah) at this local time. 5 = Friday in getUTCDay(). */
export const WEEKLY_LEADERBOARD_DAY = 5;
export const WEEKLY_LEADERBOARD_TIME = '10:00';

export interface DayTimings {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  /** Islamic midnight from fatvo.uz; Isha nudge is anchored to it when present. */
  midnight?: string;
}

export type ScheduledEvent =
  | { id: `start:${PrayerId}`; kind: 'start'; prayer: PrayerId; at: number; windowMin: number; time: string }
  | { id: `nudge:${PrayerId}`; kind: 'nudge'; prayer: PrayerId; at: number; windowMin: number; endsAt: string }
  | { id: 'summary'; kind: 'summary'; at: number; windowMin: number }
  | { id: 'weekly'; kind: 'weekly'; at: number; windowMin: number };

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const HH_MM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Converts a local wall-clock time on `date` at a fixed UTC offset to a UTC epoch (ms). */
export function localTimeToInstant(date: string, hhmm: string, tzOffsetHours: number): number {
  const [y, m, d] = date.split('-').map(Number);
  const match = HH_MM.exec(hhmm);
  if (!match || !y || !m || !d) return NaN;
  const utc = Date.UTC(y, m - 1, d, Number(match[1]), Number(match[2]));
  return utc - tzOffsetHours * 60 * MINUTE_MS;
}

function minutesOf(hhmm: string): number {
  const match = HH_MM.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
}

/** Instant of `end`, rolled to the next day when it is not after `start` (e.g. Isha → midnight). */
function endInstant(date: string, start: string, end: string, tzOffsetHours: number): number {
  const base = localTimeToInstant(date, end, tzOffsetHours);
  return minutesOf(end) <= minutesOf(start) ? base + DAY_MS : base;
}

export function dayOfWeek(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Builds every announcement for one prayer-day at a location. */
export function buildDayEvents(date: string, t: DayTimings, tzOffsetHours: number): ScheduledEvent[] {
  const events: ScheduledEvent[] = [];
  const endOf: Record<PrayerId, string> = {
    fajr: t.sunrise,
    dhuhr: t.asr,
    asr: t.maghrib,
    maghrib: t.isha,
    // No fixed end before Fajr; nudge before Islamic midnight (or 2h after Isha starts).
    isha: t.midnight && HH_MM.test(t.midnight) ? t.midnight : '',
  };

  for (const prayer of PRAYER_IDS) {
    const start = t[prayer];
    const startAt = localTimeToInstant(date, start, tzOffsetHours);
    if (!Number.isFinite(startAt)) continue;

    events.push({ id: `start:${prayer}`, kind: 'start', prayer, at: startAt, windowMin: START_WINDOW_MIN, time: start });

    const end = endOf[prayer];
    const endAt = end ? endInstant(date, start, end, tzOffsetHours) : startAt + 150 * MINUTE_MS;
    if (!Number.isFinite(endAt)) continue;
    // Never nudge sooner than 15 min after the prayer starts (short windows such as Maghrib)
    const nudgeAt = Math.max(startAt + 15 * MINUTE_MS, endAt - NUDGE_BEFORE_END_MIN * MINUTE_MS);
    if (nudgeAt >= endAt) continue;
    const endsAtLocal = end || formatLocalTime(endAt, tzOffsetHours);
    events.push({ id: `nudge:${prayer}`, kind: 'nudge', prayer, at: nudgeAt, windowMin: NUDGE_WINDOW_MIN, endsAt: endsAtLocal });
  }

  events.push({
    id: 'summary',
    kind: 'summary',
    at: localTimeToInstant(date, DAILY_SUMMARY_TIME, tzOffsetHours),
    windowMin: SUMMARY_WINDOW_MIN,
  });

  if (dayOfWeek(date) === WEEKLY_LEADERBOARD_DAY) {
    events.push({
      id: 'weekly',
      kind: 'weekly',
      at: localTimeToInstant(date, WEEKLY_LEADERBOARD_TIME, tzOffsetHours),
      windowMin: SUMMARY_WINDOW_MIN,
    });
  }

  return events;
}

export function formatLocalTime(instant: number, tzOffsetHours: number): string {
  const d = new Date(instant + tzOffsetHours * 60 * MINUTE_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Events whose instant has passed and whose delivery window is still open at `now`. */
export function dueEvents(events: ScheduledEvent[], now: number): ScheduledEvent[] {
  return events.filter((e) => now >= e.at && now < e.at + e.windowMin * MINUTE_MS);
}
