/**
 * Resolves a linked user's location, timezone and current liturgical date — the
 * same "today" the website dashboard uses (the day switches at Fajr, not midnight).
 */
import { findCityByCoordinates, findCityByNameOrId } from '../cities.ts';
import { getPrayerTimesForLocation, getTimezoneOffsetHours, type PrayerTimesPayload } from '../../app/api/prayer-times/route.ts';
import { getLiturgicalDate, getZonedDateParts } from '../prayer-cycle.ts';
import { getDateWithDayOffset } from '../prayer-rollover.ts';
import { sanitizeBotLang } from './messages.ts';

export const DEFAULT_LOCATION = { city: 'Tashkent', lat: 41.2995, lng: 69.2401, timezone: 'Asia/Tashkent' };

export interface UserPrefs {
  language?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  timezone?: string;
}

export function resolveLocation(prefs: UserPrefs | undefined) {
  const lat = prefs?.latitude;
  const lng = prefs?.longitude;
  if (typeof lat === 'number' && typeof lng === 'number' && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    const known = findCityByCoordinates(lat, lng);
    const tz = known?.timezone ?? prefs?.timezone;
    const timezone = tz && getTimezoneOffsetHours(tz, new Date()) !== null ? tz : DEFAULT_LOCATION.timezone;
    return { city: known?.name ?? prefs?.city ?? '', lat, lng, timezone };
  }
  const preset = prefs?.city ? findCityByNameOrId(prefs.city) : undefined;
  if (preset) {
    return {
      city: preset.name,
      lat: preset.coordinates.lat,
      lng: preset.coordinates.lng,
      timezone: preset.timezone ?? DEFAULT_LOCATION.timezone,
    };
  }
  return DEFAULT_LOCATION;
}

export interface UserClock {
  city: string;
  timezone: string;
  /** Current liturgical date (YYYY-MM-DD). */
  today: string;
  /** Prayer times for `today`, when fatvo.uz answered. */
  times: PrayerTimesPayload | null;
}

export async function getUserClock(prefs: UserPrefs | undefined, now: Date = new Date()): Promise<UserClock> {
  const loc = resolveLocation(prefs);
  const lang = sanitizeBotLang(prefs?.language);
  const calendarDate = getZonedDateParts(now, loc.timezone).dateStr;
  const load = (date: string) =>
    getPrayerTimesForLocation({ lat: loc.lat, lng: loc.lng, timezone: loc.timezone, date, lang, cityName: loc.city }).catch(
      () => null
    );

  const calendarTimes = await load(calendarDate);
  // fatvo.uz down → the default Fajr time decides the day switch (same fallback as the API routes)
  const today = getLiturgicalDate(now, calendarTimes?.timings.fajr.time, loc.timezone);
  const times = today === calendarDate ? calendarTimes : await load(getDateWithDayOffset(calendarDate, -1));
  return { city: loc.city || calendarTimes?.city || '', timezone: loc.timezone, today, times };
}
