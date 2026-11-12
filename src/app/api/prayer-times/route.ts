import { NextRequest, NextResponse } from 'next/server.js';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import { findCityByNameOrId, findCityByCoordinates } from '../../../lib/cities.ts';

export const dynamic = 'force-dynamic';

/**
 * /api/prayer-times — backend proxy for api.fatvo.uz (the single source of prayer times).
 *
 * fatvo.uz computes times with the Muslim Board of Uzbekistan methodology, so there is
 * no calculation-method or madhab parameter: only coordinates, date, UTC offset and the
 * language used for the reverse-geocoded address.
 */

export const FATVO_API_BASE = 'https://api.fatvo.uz/v1/prayer-times';

/** Default location when the request and the user profile provide none. */
const DEFAULT_LOCATION = {
  lat: 41.2995,
  lng: 69.2401,
  city: 'Tashkent',
  country: 'Uzbekistan',
  timezone: 'Asia/Tashkent',
};

const CUSTOM_LOCATION = 'Custom Location';
const UPSTREAM_TIMEOUT_MS = 5000;

export type PrayerTimesLang = 'uz' | 'ru' | 'en';
const SUPPORTED_LANGS: readonly PrayerTimesLang[] = ['uz', 'ru', 'en'];

/** Raw response shape returned by api.fatvo.uz/v1/prayer-times */
interface FatvoPrayerTimesResponse {
  date?: string;
  imsak?: string;
  fajr?: string;
  sunrise?: string;
  dhuhr?: string;
  asr?: string;
  maghrib?: string;
  isha?: string;
  midnight?: string;
  address?: { region?: string; city?: string; county?: string; country?: string };
}

const HH_MM = /^\d{2}:\d{2}$/;

export interface PrayerTimesTimings {
  fajr: { time: string; endTime: string };
  dhuhr: { time: string; endTime: string };
  asr: { time: string; endTime: string };
  maghrib: { time: string; endTime: string };
  isha: { time: string; endTime: string; isOvernight: boolean };
}

export interface PrayerTimesPayload {
  success: true;
  city: string;
  country: string;
  timezone: string;
  location: {
    latitude: number;
    longitude: number;
  };
  timings: PrayerTimesTimings;
  /** Supplementary times from fatvo.uz (not tracked as prayers). */
  extras?: { imsak?: string; sunrise?: string; midnight?: string };
  provider: 'fatvo.uz';
  tzOffset: number;
  date: string;
  source: 'live';
}

export interface PrayerTimesCacheEntry {
  data: PrayerTimesPayload;
  cachedAt: number;
  expiresAt: number;
}

export const MAX_PRAYER_TIMES_CACHE_ENTRIES = 1000;
export const PRAYER_TIMES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// In-memory cache & in-flight request deduplication map
const prayerTimesCache = new Map<string, PrayerTimesCacheEntry>();
const inFlightRequests = new Map<string, Promise<PrayerTimesPayload | null>>();

/**
 * Resolves the UTC offset (in hours, may be fractional e.g. 5.5) of an IANA
 * timezone on a given date. Returns null for unknown/invalid zone names.
 * Using the specific date makes DST-observing zones (e.g. Europe/London) resolve correctly.
 */
export function getTimezoneOffsetHours(timeZone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(at);
    const label = parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
    if (label === 'GMT' || label === 'UTC') return 0;
    const match = /^GMT([+-])(\d{1,2})(?::(\d{2}))?$/.exec(label);
    if (!match) return null;
    const sign = match[1] === '-' ? -1 : 1;
    return sign * (Number(match[2]) + Number(match[3] ?? 0) / 60);
  } catch {
    return null;
  }
}

/** Validates a client-supplied numeric UTC offset (hours). Real-world range is -12..+14. */
function parseTzOffset(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < -12 || n > 14) return null;
  // Snap to the nearest quarter hour (covers +5:45 Nepal, +9:30 Adelaide, etc.)
  return Math.round(n * 4) / 4;
}

function isValidLatLng(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

/** Returns YYYY-MM-DD for "today" at the given UTC offset. */
function todayAtOffset(offsetHours: number): string {
  return new Date(Date.now() + offsetHours * 3600 * 1000).toISOString().slice(0, 10);
}

/**
 * Builds a deterministic cache key from the parameters that change the upstream
 * response: date, coordinates, UTC offset and address language.
 * Key format: `${date || 'today'}_${lat.toFixed(4)}_${lng.toFixed(4)}_${tzOffset}_${lang}`
 */
export function buildPrayerTimesCacheKey(
  date: string | null | undefined,
  lat: number,
  lng: number,
  tzOffset: number,
  lang: PrayerTimesLang
): string {
  const dateKey =
    date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())
      ? date.trim()
      : 'today';
  return `${dateKey}_${lat.toFixed(4)}_${lng.toFixed(4)}_${tzOffset}_${lang}`;
}

/**
 * Clears the prayer times in-memory cache and cancels any in-flight references.
 * Exported for test environment isolation and administrative cache resets.
 */
export function clearPrayerTimesCache(): void {
  prayerTimesCache.clear();
  inFlightRequests.clear();
}

/** Returns current count of entries in the in-memory cache. */
export function getPrayerTimesCacheSize(): number {
  return prayerTimesCache.size;
}

/** Returns current count of in-flight deduplicated requests. */
export function getInFlightRequestsSize(): number {
  return inFlightRequests.size;
}

/**
 * Retrieves a valid, unexpired entry from the in-memory cache (LRU ordering refreshed).
 */
export function getPrayerTimesFromCache(key: string): PrayerTimesPayload | null {
  const entry = prayerTimesCache.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    prayerTimesCache.delete(key);
    return null;
  }

  // Refresh LRU order (delete & re-insert at end of Map)
  prayerTimesCache.delete(key);
  prayerTimesCache.set(key, entry);

  return entry.data;
}

/**
 * Persists a prayer times payload into the in-memory TTL cache with LRU eviction guard.
 */
export function setPrayerTimesInCache(
  key: string,
  data: PrayerTimesPayload,
  ttlMs: number = PRAYER_TIMES_CACHE_TTL_MS
): void {
  const now = Date.now();

  // 1. Evict expired entries if cache is at or exceeds capacity limit
  if (prayerTimesCache.size >= MAX_PRAYER_TIMES_CACHE_ENTRIES) {
    for (const [k, entry] of prayerTimesCache.entries()) {
      if (entry.expiresAt <= now) {
        prayerTimesCache.delete(k);
      }
    }
  }

  // 2. If still at capacity, evict the least recently used / oldest item (first key in Map)
  if (prayerTimesCache.size >= MAX_PRAYER_TIMES_CACHE_ENTRIES) {
    const oldestKey = prayerTimesCache.keys().next().value;
    if (oldestKey !== undefined) {
      prayerTimesCache.delete(oldestKey);
    }
  }

  prayerTimesCache.set(key, {
    data,
    cachedAt: now,
    expiresAt: now + ttlMs,
  });
}

/** Upstream failure → explicit 502. Never invent times; the client keeps its last good copy. */
function upstreamUnavailable() {
  return NextResponse.json(
    {
      success: false,
      error: 'Prayer times service (fatvo.uz) is unavailable. Please try again later.',
      code: 'PRAYER_TIMES_UNAVAILABLE',
    },
    { status: 502 }
  );
}

/** Fetches and normalises one day of times from fatvo.uz. Returns null on any failure. */
async function fetchFromFatvo(
  apiUrl: string,
  meta: { lat: number; lng: number; cityName: string; countryName: string; timezone: string; tzOffset: number; isoDate: string }
): Promise<PrayerTimesPayload | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const res = await fetch(apiUrl, {
      signal: controller.signal,
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;

    const data = (await res.json()) as FatvoPrayerTimesResponse;
    const { fajr, sunrise, dhuhr, asr, maghrib, isha } = data ?? {};

    // Reject partial/malformed upstream payloads rather than rendering garbage times
    if (![fajr, sunrise, dhuhr, asr, maghrib, isha].every((v) => typeof v === 'string' && HH_MM.test(v))) {
      return null;
    }

    const upstreamCity = data.address?.city?.trim();
    const upstreamCountry = data.address?.country?.trim();
    const isGenericName = meta.cityName === CUSTOM_LOCATION || /^-?\d/.test(meta.cityName);

    return {
      success: true,
      city: isGenericName && upstreamCity ? upstreamCity : meta.cityName,
      country: meta.countryName || upstreamCountry || '',
      timezone: meta.timezone,
      location: { latitude: meta.lat, longitude: meta.lng },
      timings: {
        fajr: { time: fajr!, endTime: sunrise! },
        dhuhr: { time: dhuhr!, endTime: asr! },
        asr: { time: asr!, endTime: maghrib! },
        maghrib: { time: maghrib!, endTime: isha! },
        isha: { time: isha!, endTime: fajr!, isOvernight: true },
      },
      extras: { imsak: data.imsak, sunrise, midnight: data.midnight },
      provider: 'fatvo.uz',
      tzOffset: meta.tzOffset,
      date: meta.isoDate,
      source: 'live',
    };
  } catch (fetchErr) {
    console.error('Failed to fetch prayer times from fatvo.uz:', fetchErr);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 0. Authenticate optionally to read saved location / language preferences
    const auth = await authenticateRequest(request).catch(() => null);
    const prefs = auth?.user?.preferences;

    const cityQuery = searchParams.get('city');
    const latQuery = searchParams.get('latitude') || searchParams.get('lat');
    const lngQuery = searchParams.get('longitude') || searchParams.get('lng');
    const tzQuery = searchParams.get('timezone') || searchParams.get('tz');

    // Only accept real IANA zones (Intl validates them) — never echo arbitrary strings back
    const validTzQuery =
      tzQuery && getTimezoneOffsetHours(tzQuery.trim(), new Date()) !== null ? tzQuery.trim() : undefined;

    let lat = DEFAULT_LOCATION.lat;
    let lng = DEFAULT_LOCATION.lng;
    let cityName = DEFAULT_LOCATION.city;
    let countryName = DEFAULT_LOCATION.country;
    let tzName: string | undefined = validTzQuery ?? DEFAULT_LOCATION.timezone;
    let coordsResolved = false;

    const applyCoords = (newLat: number, newLng: number, fallbackTz?: string) => {
      lat = newLat;
      lng = newLng;
      coordsResolved = true;
      const knownCity = findCityByCoordinates(lat, lng);
      if (knownCity) {
        cityName = knownCity.name;
        countryName = knownCity.country;
        tzName = knownCity.timezone;
      } else {
        cityName = CUSTOM_LOCATION;
        countryName = '';
        tzName = validTzQuery || fallbackTz;
      }
    };

    // 1. Explicit city preset
    if (cityQuery) {
      const cityPreset = findCityByNameOrId(cityQuery);
      if (cityPreset) {
        lat = cityPreset.coordinates.lat;
        lng = cityPreset.coordinates.lng;
        cityName = cityPreset.name;
        countryName = cityPreset.country;
        tzName = cityPreset.timezone;
        coordsResolved = true;
      }
    }

    // 2. Explicit coordinates
    if (!coordsResolved && latQuery && lngQuery) {
      const parsedLat = Number(latQuery);
      const parsedLng = Number(lngQuery);
      if (isValidLatLng(parsedLat, parsedLng)) {
        applyCoords(parsedLat, parsedLng);
      }
    }

    // 3. Unknown city name without coordinates — never silently default to Tashkent
    if (cityQuery && !coordsResolved) {
      return NextResponse.json(
        {
          success: false,
          error: `Unable to resolve geographic coordinates for city "${cityQuery.slice(0, 60)}". Please specify latitude and longitude.`,
          code: 'COORDINATES_REQUIRED',
        },
        { status: 400 }
      );
    }

    // 4. Saved profile location (coordinates first — they are the user's real position)
    if (!coordsResolved && prefs) {
      if (isValidLatLng(prefs.latitude, prefs.longitude)) {
        applyCoords(prefs.latitude, prefs.longitude as number, prefs.timezone);
      } else if (prefs.city) {
        const cityPreset = findCityByNameOrId(prefs.city);
        if (cityPreset) {
          lat = cityPreset.coordinates.lat;
          lng = cityPreset.coordinates.lng;
          cityName = cityPreset.name;
          countryName = cityPreset.country;
          tzName = cityPreset.timezone;
          coordsResolved = true;
        }
      }
      if (!validTzQuery && prefs.timezone && !coordsResolved) {
        tzName = prefs.timezone;
      }
    }

    // 5. UTC offset sent to fatvo.uz (tz_offset):
    //    explicit ?tz_offset → IANA timezone for that date → longitude estimate.
    const dateQuery = searchParams.get('date');
    const validDate = dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery) ? dateQuery : null;
    const offsetProbe = validDate ? new Date(`${validDate}T12:00:00Z`) : new Date();
    const tzOffset =
      parseTzOffset(searchParams.get('tz_offset')) ??
      (tzName ? getTimezoneOffsetHours(tzName, offsetProbe) : null) ??
      Math.round(lng / 15);

    // 6. Address language (uz default, matches the app default locale)
    const langQuery = searchParams.get('lang') as PrayerTimesLang | null;
    const lang: PrayerTimesLang =
      langQuery && SUPPORTED_LANGS.includes(langQuery)
        ? langQuery
        : (prefs?.language as PrayerTimesLang | undefined) ?? 'uz';

    const isoDate = validDate ?? todayAtOffset(tzOffset);
    const cacheKey = buildPrayerTimesCacheKey(isoDate, lat, lng, tzOffset, lang);

    const skipCache =
      request.headers.get('cache-control') === 'no-cache' ||
      request.headers.get('cache-control') === 'no-store' ||
      request.headers.get('x-skip-cache') === 'true' ||
      searchParams.get('skipCache') === 'true' ||
      searchParams.get('fresh') === 'true';

    // 7. In-memory TTL cache (fast path <1ms)
    if (!skipCache) {
      const cached = getPrayerTimesFromCache(cacheKey);
      if (cached) {
        return NextResponse.json(cached, {
          headers: {
            'X-Cache': 'HIT',
            'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
          },
        });
      }
    }

    // 8. Deduplicate concurrent upstream requests for the same key
    let isDeduped = false;
    let inFlightPromise = inFlightRequests.get(cacheKey);

    if (inFlightPromise && !skipCache) {
      isDeduped = true;
    } else {
      // Values are validated numbers / whitelisted strings; URLSearchParams still encodes them.
      const upstreamParams = new URLSearchParams({
        lat: String(lat),
        lon: String(lng),
        date: isoDate.split('-').reverse().join('-'), // fatvo.uz expects DD-MM-YYYY
        tz_offset: String(tzOffset),
        lang,
      });

      inFlightPromise = fetchFromFatvo(`${FATVO_API_BASE}?${upstreamParams.toString()}`, {
        lat,
        lng,
        cityName,
        countryName,
        timezone: tzName || `UTC${tzOffset >= 0 ? '+' : ''}${tzOffset}`,
        tzOffset,
        isoDate,
      })
        .then((payload) => {
          // Cache only verified live responses — failures are never cached
          if (payload) setPrayerTimesInCache(cacheKey, payload);
          return payload;
        })
        .finally(() => {
          inFlightRequests.delete(cacheKey);
        });

      inFlightRequests.set(cacheKey, inFlightPromise);
    }

    const payload = await inFlightPromise;
    if (!payload) return upstreamUnavailable();

    return NextResponse.json(payload, {
      headers: {
        'X-Cache': isDeduped ? 'DEDUPED' : 'MISS',
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Failed to resolve prayer times:', error);
    return upstreamUnavailable();
  }
}
