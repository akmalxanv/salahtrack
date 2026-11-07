import { NextRequest, NextResponse } from 'next/server.js';
import { authenticateRequest } from '../../../lib/auth/index.ts';
import { findCityByNameOrId, findCityByCoordinates } from '../../../lib/cities.ts';

export const dynamic = 'force-dynamic';

// Default fallback Tashkent timings (Hanafi, MWL / Muslim Board of Uzbekistan coordinates: 41.2995, 69.2401)
const TASHKENT_COORDS = {
  lat: 41.2995,
  lng: 69.2401,
  city: 'Tashkent',
  country: 'Uzbekistan',
  timezone: 'Asia/Tashkent',
};

const TASHKENT_FALLBACK = {
  fajr: { time: '04:47', endTime: '06:19' },
  dhuhr: { time: '12:13', endTime: '16:20' },
  asr: { time: '16:20', endTime: '18:05' },
  maghrib: { time: '18:05', endTime: '19:32' },
  isha: { time: '19:32', endTime: '04:47', isOvernight: true },
};

export const METHOD_MAP: Record<string, number> = {
  MWL: 3, // Muslim World League
  ISNA: 2, // Islamic Society of North America
  EGYPT: 5, // Egyptian General Authority of Survey
  MAKKAH: 4, // Umm Al-Qura University, Makkah
  KARACHI: 1, // University of Islamic Sciences, Karachi
  TEHRAN: 7, // Institute of Geophysics, University of Tehran
  GULF: 8, // Gulf Region
  KUWAIT: 9, // Kuwait
  QATAR: 10, // Qatar
  SINGAPORE: 11, // Majlis Ugama Islam Singapura
  FRANCE: 12, // UOIF
  TURKEY: 13, // Diyanet İşleri Başkanlığı
  RUSSIA: 14, // Spiritual Administration of Muslims of Russia
};

/**
 * Checks whether the given coordinates or city name match Tashkent (within 0.05°).
 * Verified fallback timings are strictly reserved for Tashkent.
 */
function isTashkentLocation(lat: number, lng: number, city?: string): boolean {
  if (city) {
    const normalized = city.trim().toLowerCase();
    if (
      normalized === 'tashkent' ||
      normalized === 'toshkent' ||
      normalized === 'ташкент' ||
      normalized === 'طشقند'
    ) {
      return true;
    }
  }
  const latDiff = Math.abs(lat - TASHKENT_COORDS.lat);
  const lngDiff = Math.abs(lng - TASHKENT_COORDS.lng);
  return latDiff <= 0.05 && lngDiff <= 0.05;
}

/**
 * Safely handles external API failures.
 * Returns verified fallback timings ONLY for Tashkent.
 * For non-Tashkent locations, returns an explicit 502 error to avoid silently displaying wrong prayer times.
 */
function handleApiFailure(
  lat: number,
  lng: number,
  cityName: string,
  countryName: string,
  tzName: string | undefined,
  method: number,
  warning?: string
) {
  if (isTashkentLocation(lat, lng, cityName)) {
    return NextResponse.json({
      success: true,
      city: cityName || TASHKENT_COORDS.city,
      country: countryName || TASHKENT_COORDS.country,
      timezone: tzName || TASHKENT_COORDS.timezone,
      location: { latitude: lat, longitude: lng },
      method,
      timings: TASHKENT_FALLBACK,
      source: 'fallback',
      ...(warning ? { warning } : {}),
    });
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Unable to calculate prayer times for the requested location. External service unavailable.',
      code: 'PRAYER_TIMES_UNAVAILABLE',
    },
    { status: 502 }
  );
}

export async function GET(request: NextRequest) {
  let lat = TASHKENT_COORDS.lat;
  let lng = TASHKENT_COORDS.lng;
  let cityName = TASHKENT_COORDS.city;
  let countryName = TASHKENT_COORDS.country;
  let tzName: string | undefined = TASHKENT_COORDS.timezone;
  let method = 3; // Default: Muslim World League (MWL)

  try {
    const { searchParams } = new URL(request.url);

    // 0. Authenticate optionally to inspect user preferences
    const auth = await authenticateRequest(request).catch(() => null);

    const cityQuery = searchParams.get('city');
    const latQuery = searchParams.get('latitude') || searchParams.get('lat');
    const lngQuery = searchParams.get('longitude') || searchParams.get('lng');
    const methodQuery = searchParams.get('method');
    const tzQuery = searchParams.get('timezone') || searchParams.get('tz');

    if (tzQuery) {
      tzName = tzQuery.trim();
    }

    let coordsResolved = false;

    // 1. If city parameter is passed directly in searchParams
    if (cityQuery) {
      const cityPreset = findCityByNameOrId(cityQuery);
      if (cityPreset) {
        lat = cityPreset.coordinates.lat;
        lng = cityPreset.coordinates.lng;
        cityName = cityPreset.name;
        countryName = cityPreset.country;
        tzName = cityPreset.timezone;
        coordsResolved = true;
      } else {
        cityName = cityQuery.trim();
      }
    }

    // 2. If lat & lng parameters are passed directly in searchParams
    if (!coordsResolved && latQuery && lngQuery) {
      const parsedLat = parseFloat(latQuery);
      const parsedLng = parseFloat(lngQuery);
      if (
        !isNaN(parsedLat) &&
        parsedLat >= -90 &&
        parsedLat <= 90 &&
        !isNaN(parsedLng) &&
        parsedLng >= -180 &&
        parsedLng <= 180
      ) {
        lat = parsedLat;
        lng = parsedLng;
        coordsResolved = true;

        // Check if coords match a known city in src/lib/cities.ts
        const knownCity = findCityByCoordinates(lat, lng);
        if (knownCity) {
          cityName = knownCity.name;
          countryName = knownCity.country;
          tzName = knownCity.timezone;
        } else {
          cityName = 'Custom Location';
          countryName = '';
          tzName = undefined;
        }
      }
    }

    // 3. Fallback to user preferences if not provided in searchParams
    if (!coordsResolved && auth?.user?.preferences) {
      const prefCity = auth.user.preferences.city;
      const prefLat = auth.user.preferences.latitude;
      const prefLng = auth.user.preferences.longitude;
      const prefTz = auth.user.preferences.timezone;

      if (prefTz && !tzQuery) {
        tzName = prefTz;
      }

      if (prefCity) {
        const cityPreset = findCityByNameOrId(prefCity);
        if (cityPreset) {
          lat = cityPreset.coordinates.lat;
          lng = cityPreset.coordinates.lng;
          cityName = cityPreset.name;
          countryName = cityPreset.country;
          tzName = cityPreset.timezone;
          coordsResolved = true;
        } else {
          cityName = prefCity;
        }
      }

      if (
        !coordsResolved &&
        typeof prefLat === 'number' &&
        typeof prefLng === 'number' &&
        Number.isFinite(prefLat) &&
        prefLat >= -90 &&
        prefLat <= 90 &&
        Number.isFinite(prefLng) &&
        prefLng >= -180 &&
        prefLng <= 180
      ) {
        lat = prefLat;
        lng = prefLng;
        coordsResolved = true;

        const knownCity = findCityByCoordinates(lat, lng);
        if (knownCity) {
          cityName = knownCity.name;
          countryName = knownCity.country;
          tzName = knownCity.timezone;
        } else if (!cityName || cityName === TASHKENT_COORDS.city) {
          cityName = 'Custom Location';
          countryName = '';
          tzName = undefined;
        }
      }
    }

    // 4. Resolve calculation method
    if (methodQuery) {
      const upper = methodQuery.toUpperCase();
      if (METHOD_MAP[upper] !== undefined) {
        method = METHOD_MAP[upper];
      } else {
        const parsedMethod = parseInt(methodQuery, 10);
        if (!isNaN(parsedMethod) && parsedMethod >= 0 && parsedMethod <= 25) {
          method = parsedMethod;
        }
      }
    } else if (auth?.user?.preferences?.calculationMethod) {
      const prefUpper = auth.user.preferences.calculationMethod.toUpperCase();
      if (METHOD_MAP[prefUpper] !== undefined) {
        method = METHOD_MAP[prefUpper];
      } else {
        const parsedMethod = parseInt(auth.user.preferences.calculationMethod, 10);
        if (!isNaN(parsedMethod) && parsedMethod >= 0 && parsedMethod <= 25) {
          method = parsedMethod;
        }
      }
    }

    // 5. Resolve school (Hanafi = 1, Shafi/Default = 0)
    const schoolQuery = searchParams.get('school');
    const school = schoolQuery === '0' ? 0 : 1;

    // 6. Resolve date if specified
    const dateQuery = searchParams.get('date');
    const endpointDate =
      dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
        ? dateQuery.split('-').reverse().join('-') // convert YYYY-MM-DD to DD-MM-YYYY for Aladhan
        : '';

    const apiUrl = endpointDate
      ? `https://api.aladhan.com/v1/timings/${endpointDate}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`
      : `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`;

    // 7. Fetch from Aladhan API with resilient 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(apiUrl, {
      signal: controller.signal,
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return handleApiFailure(
        lat,
        lng,
        cityName,
        countryName,
        tzName,
        method,
        'External prayer times API returned error, fallback timings provided.'
      );
    }

    const data = await res.json();
    const timings = data?.data?.timings;
    const meta = data?.data?.meta;

    if (!timings) {
      return handleApiFailure(lat, lng, cityName, countryName, tzName, method);
    }

    const formatTime = (t: string) => t.slice(0, 5);

    return NextResponse.json({
      success: true,
      city:
        cityName !== 'Custom Location' && cityName !== TASHKENT_COORDS.city
          ? cityName
          : meta?.timezone?.split('/')[1]?.replace(/_/g, ' ') || cityName,
      country: countryName || meta?.timezone?.split('/')[0] || TASHKENT_COORDS.country,
      timezone: tzName || meta?.timezone || TASHKENT_COORDS.timezone,
      location: {
        latitude: lat,
        longitude: lng,
      },
      method,
      school: school === 1 ? 'Hanafi' : 'Shafi',
      timings: {
        fajr: { time: formatTime(timings.Fajr), endTime: formatTime(timings.Sunrise) },
        dhuhr: { time: formatTime(timings.Dhuhr), endTime: formatTime(timings.Asr) },
        asr: { time: formatTime(timings.Asr), endTime: formatTime(timings.Maghrib) },
        maghrib: { time: formatTime(timings.Maghrib), endTime: formatTime(timings.Isha) },
        isha: {
          time: formatTime(timings.Isha),
          endTime: formatTime(timings.Fajr),
          isOvernight: true,
        },
      },
      source: 'live',
    });
  } catch (error) {
    console.error('Failed to fetch prayer times:', error);
    return handleApiFailure(lat, lng, cityName, countryName, tzName, method);
  }
}
