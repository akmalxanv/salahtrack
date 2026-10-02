import { NextRequest, NextResponse } from 'next/server.js';
import { authenticateRequest } from '@/lib/auth/guard';

export const revalidate = 3600; // Cache for 1 hour

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
  isha: { time: '19:32', endTime: '23:59' },
};

const METHOD_MAP: Record<string, number> = {
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

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // 1. Resolve coordinates (defaulting safely to Tashkent)
    let lat = TASHKENT_COORDS.lat;
    let lng = TASHKENT_COORDS.lng;

    const latQuery = searchParams.get('latitude') || searchParams.get('lat');
    const lngQuery = searchParams.get('longitude') || searchParams.get('lng');

    if (latQuery && lngQuery) {
      const parsedLat = parseFloat(latQuery);
      const parsedLng = parseFloat(lngQuery);
      if (!isNaN(parsedLat) && parsedLat >= -90 && parsedLat <= 90) {
        lat = parsedLat;
      }
      if (!isNaN(parsedLng) && parsedLng >= -180 && parsedLng <= 180) {
        lng = parsedLng;
      }
    }

    // 2. Resolve calculation method
    let method = 3; // Default: Muslim World League (MWL)
    const methodQuery = searchParams.get('method');

    if (methodQuery) {
      if (METHOD_MAP[methodQuery.toUpperCase()]) {
        method = METHOD_MAP[methodQuery.toUpperCase()];
      } else {
        const parsedMethod = parseInt(methodQuery, 10);
        if (!isNaN(parsedMethod) && parsedMethod >= 0 && parsedMethod <= 25) {
          method = parsedMethod;
        }
      }
    } else {
      // Check user preferences if logged in
      try {
        const auth = await authenticateRequest(request);
        if (auth && auth.user.preferences?.calculationMethod) {
          const prefMethod = auth.user.preferences.calculationMethod.toUpperCase();
          if (METHOD_MAP[prefMethod]) {
            method = METHOD_MAP[prefMethod];
          }
        }
      } catch {
        // Silently continue with default if auth check encounters any issue
      }
    }

    // 3. Resolve school (Hanafi = 1, Shafi/Default = 0)
    const schoolQuery = searchParams.get('school');
    const school = schoolQuery === '0' ? 0 : 1;

    // 4. Resolve date if specified
    const dateQuery = searchParams.get('date');
    const endpointDate = dateQuery && /^\d{4}-\d{2}-\d{2}$/.test(dateQuery)
      ? dateQuery.split('-').reverse().join('-') // convert YYYY-MM-DD to DD-MM-YYYY for Aladhan
      : '';

    const apiUrl = endpointDate
      ? `https://api.aladhan.com/v1/timings/${endpointDate}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`
      : `https://api.aladhan.com/v1/timings?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`;

    // 5. Fetch from Aladhan API with resilient 5-second timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(apiUrl, {
      signal: controller.signal,
      next: { revalidate: 3600 },
      headers: { Accept: 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      return NextResponse.json({
        success: true,
        city: lat === TASHKENT_COORDS.lat ? TASHKENT_COORDS.city : 'Custom Location',
        country: lat === TASHKENT_COORDS.lat ? TASHKENT_COORDS.country : '',
        timezone: TASHKENT_COORDS.timezone,
        location: { latitude: lat, longitude: lng },
        timings: TASHKENT_FALLBACK,
        source: 'fallback',
        warning: 'External prayer times API returned error, fallback timings provided.',
      });
    }

    const data = await res.json();
    const timings = data?.data?.timings;
    const meta = data?.data?.meta;

    if (!timings) {
      return NextResponse.json({
        success: true,
        city: TASHKENT_COORDS.city,
        timezone: TASHKENT_COORDS.timezone,
        location: { latitude: lat, longitude: lng },
        timings: TASHKENT_FALLBACK,
        source: 'fallback',
      });
    }

    const formatTime = (t: string) => t.slice(0, 5);

    return NextResponse.json({
      success: true,
      city: meta?.timezone?.split('/')[1]?.replace(/_/g, ' ') || TASHKENT_COORDS.city,
      country: meta?.timezone?.split('/')[0] || TASHKENT_COORDS.country,
      timezone: meta?.timezone || TASHKENT_COORDS.timezone,
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
        isha: { time: formatTime(timings.Isha), endTime: '23:59' },
      },
      source: 'live',
    });
  } catch (error) {
    console.error('Failed to fetch prayer times:', error);
    return NextResponse.json({
      success: true,
      city: TASHKENT_COORDS.city,
      timezone: TASHKENT_COORDS.timezone,
      location: { latitude: TASHKENT_COORDS.lat, longitude: TASHKENT_COORDS.lng },
      timings: TASHKENT_FALLBACK,
      source: 'fallback',
    });
  }
}
