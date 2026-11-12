/**
 * Client-side location persistence shared by Dashboard, Qibla and Account pages.
 *
 * Single place that:
 *   1. writes the device location to localStorage (`salahtrack_location`),
 *   2. notifies listeners on the same page (`salahtrack_location_update`),
 *   3. best-effort syncs it to the user's profile (PUT /api/user/profile) so the
 *      server-side /api/prayer-times fallback and other devices use the new place.
 *
 * Guests get a 401 from the profile endpoint — that is expected and silently ignored.
 */

export const LOCATION_STORAGE_KEY = 'salahtrack_location';
export const CITY_NAME_STORAGE_KEY = 'salahtrack_city_name';
export const LOCATION_UPDATE_EVENT = 'salahtrack_location_update';

/** Movement threshold before we treat a fresh GPS fix as "the user moved". */
export const LOCATION_CHANGE_THRESHOLD_KM = 3;

export interface StoredLocation {
  lat: number;
  lng: number;
  city?: string;
  timezone?: string;
  /** 'gps' locations are auto-refreshed when the device moves; 'manual' ones never are. */
  source?: 'gps' | 'manual';
  /** Epoch ms of the last write — lets the dashboard prefer the newest device location. */
  updatedAt?: number;
}

function isValidCoord(lat: unknown, lng: unknown): lat is number {
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

export function readStoredLocation(): StoredLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredLocation> | null;
    if (!parsed || !isValidCoord(parsed.lat, parsed.lng)) return null;
    return {
      lat: parsed.lat,
      lng: parsed.lng as number,
      city: typeof parsed.city === 'string' ? parsed.city : undefined,
      timezone: typeof parsed.timezone === 'string' ? parsed.timezone : undefined,
      source: parsed.source === 'gps' || parsed.source === 'manual' ? parsed.source : undefined,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
}

export function getBrowserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Great-circle distance (haversine) in kilometres. */
export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Persists a new location locally, notifies the page, and (unless disabled)
 * syncs it to the server profile in the background.
 */
export async function saveLocation(
  loc: Omit<StoredLocation, 'updatedAt'>,
  options: { syncToServer?: boolean } = {}
): Promise<void> {
  if (typeof window === 'undefined' || !isValidCoord(loc.lat, loc.lng)) return;

  const next: StoredLocation = {
    ...loc,
    lat: Math.round(loc.lat * 1e6) / 1e6,
    lng: Math.round(loc.lng * 1e6) / 1e6,
    timezone: loc.timezone || getBrowserTimezone(),
    updatedAt: Date.now(),
  };

  try {
    localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(next));
    if (next.city) localStorage.setItem(CITY_NAME_STORAGE_KEY, next.city);
  } catch {
    // Storage blocked (private mode) — in-memory listeners still get the event below
  }
  window.dispatchEvent(new CustomEvent(LOCATION_UPDATE_EVENT));

  if (options.syncToServer === false) return;

  try {
    await fetch('/api/user/profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({
        preferences: {
          // Always send city (null clears it): a stale preset name on the server would
          // otherwise override the new coordinates in /api/prayer-times.
          city: next.city ?? null,
          latitude: next.lat,
          longitude: next.lng,
          ...(next.timezone ? { timezone: next.timezone } : {}),
        },
      }),
    });
  } catch {
    // Offline: localStorage already holds the new location; the server copy
    // will be refreshed next time the location is saved while online.
  }
}
