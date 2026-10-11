/**
 * Curated Global and Regional City Catalog for Qibla Finder
 * Contains 31 verified cities (14 in Uzbekistan, 17 major international hubs).
 *
 * Each preset includes coordinates, trilingual names (uz, ru, en, ar),
 * country code, timezone, and computed Qibla geodesic values.
 */

import type { CityPreset } from '@/types/qibla';
import { calculateQiblaBearing, calculateDistanceToKaaba } from './qibla.ts';

interface RawCityDefinition {
  id: string;
  name: string;
  nativeNames: {
    uz: string;
    ru: string;
    en: string;
    ar?: string;
  };
  country: string;
  countryCode: string;
  region?: string;
  lat: number;
  lng: number;
  timezone?: string;
}

const RAW_CITIES: RawCityDefinition[] = [
  // ==========================================
  // Uzbekistan (14 Core Administrative Centers)
  // ==========================================
  {
    id: 'tashkent',
    name: 'Tashkent',
    nativeNames: { uz: 'Toshkent', ru: 'Ташкент', en: 'Tashkent', ar: 'طشقند' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Toshkent shahri',
    lat: 41.2995,
    lng: 69.2401,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'samarkand',
    name: 'Samarkand',
    nativeNames: { uz: 'Samarqand', ru: 'Самарканд', en: 'Samarkand', ar: 'سمرقند' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Samarqand viloyati',
    lat: 39.6542,
    lng: 66.9597,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'bukhara',
    name: 'Bukhara',
    nativeNames: { uz: 'Buxoro', ru: 'Бухара', en: 'Bukhara', ar: 'بخارى' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Buxoro viloyati',
    lat: 39.7747,
    lng: 64.4286,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'namangan',
    name: 'Namangan',
    nativeNames: { uz: 'Namangan', ru: 'Наманган', en: 'Namangan', ar: 'نمنغان' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Namangan viloyati',
    lat: 40.9983,
    lng: 71.6726,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'andijan',
    name: 'Andijan',
    nativeNames: { uz: 'Andijon', ru: 'Андижан', en: 'Andijan', ar: 'أنديجان' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Andijon viloyati',
    lat: 40.7821,
    lng: 72.3442,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'fergana',
    name: 'Fergana',
    nativeNames: { uz: "Farg'ona", ru: 'Фергана', en: 'Fergana', ar: 'فرغانة' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: "Farg'ona viloyati",
    lat: 40.3842,
    lng: 71.7843,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'nukus',
    name: 'Nukus',
    nativeNames: { uz: 'Nukus', ru: 'Нукус', en: 'Nukus', ar: 'نوكوس' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: "Qoraqalpog'iston Respublikasi",
    lat: 42.4602,
    lng: 59.6166,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'khiva',
    name: 'Khiva',
    nativeNames: { uz: 'Xiva', ru: 'Хива', en: 'Khiva', ar: 'خيوا' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Xorazm viloyati',
    lat: 41.3783,
    lng: 60.3639,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'qarshi',
    name: 'Qarshi',
    nativeNames: { uz: 'Qarshi', ru: 'Карши', en: 'Qarshi', ar: 'قرشي' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Qashqadaryo viloyati',
    lat: 38.8606,
    lng: 65.7891,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'termez',
    name: 'Termez',
    nativeNames: { uz: 'Termiz', ru: 'Термез', en: 'Termez', ar: 'ترمذ' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Surxondaryo viloyati',
    lat: 37.2242,
    lng: 67.2783,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'jizzakh',
    name: 'Jizzakh',
    nativeNames: { uz: 'Jizzax', ru: 'Джизак', en: 'Jizzakh', ar: 'جيزاخ' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Jizzax viloyati',
    lat: 40.1158,
    lng: 67.8422,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'navoiy',
    name: 'Navoiy',
    nativeNames: { uz: 'Navoiy', ru: 'Навои', en: 'Navoiy', ar: 'نافوي' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Navoiy viloyati',
    lat: 40.0844,
    lng: 65.3792,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'guliston',
    name: 'Guliston',
    nativeNames: { uz: 'Guliston', ru: 'Гулистан', en: 'Guliston', ar: 'غوليستان' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Sirdaryo viloyati',
    lat: 40.4897,
    lng: 68.7842,
    timezone: 'Asia/Tashkent',
  },
  {
    id: 'urgench',
    name: 'Urgench',
    nativeNames: { uz: 'Urganch', ru: 'Ургенч', en: 'Urgench', ar: 'أورgench' },
    country: 'Uzbekistan',
    countryCode: 'UZ',
    region: 'Xorazm viloyati',
    lat: 41.5562,
    lng: 60.6314,
    timezone: 'Asia/Tashkent',
  },

  // ==========================================
  // International Cities (17 Strategic Global Hubs)
  // ==========================================
  {
    id: 'makkah',
    name: 'Makkah',
    nativeNames: { uz: 'Makka', ru: 'Мекка', en: 'Makkah', ar: 'مكة المكرمة' },
    country: 'Saudi Arabia',
    countryCode: 'SA',
    region: 'Makkah Province',
    lat: 21.4225,
    lng: 39.8262,
    timezone: 'Asia/Riyadh',
  },
  {
    id: 'madinah',
    name: 'Madinah',
    nativeNames: { uz: 'Madina', ru: 'Медина', en: 'Madinah', ar: 'المدينة المنورة' },
    country: 'Saudi Arabia',
    countryCode: 'SA',
    region: 'Al Madinah Province',
    lat: 24.4672,
    lng: 39.6111,
    timezone: 'Asia/Riyadh',
  },
  {
    id: 'jerusalem',
    name: 'Jerusalem',
    nativeNames: { uz: 'Quddus', ru: 'Иерусалим', en: 'Jerusalem', ar: 'القدس' },
    country: 'Palestine',
    countryCode: 'PS',
    lat: 31.7683,
    lng: 35.2137,
    timezone: 'Asia/Jerusalem',
  },
  {
    id: 'istanbul',
    name: 'Istanbul',
    nativeNames: { uz: 'Istanbul', ru: 'Стамбул', en: 'Istanbul', ar: 'إسطنبول' },
    country: 'Turkey',
    countryCode: 'TR',
    lat: 41.0082,
    lng: 28.9784,
    timezone: 'Europe/Istanbul',
  },
  {
    id: 'cairo',
    name: 'Cairo',
    nativeNames: { uz: 'Qohira', ru: 'Каир', en: 'Cairo', ar: 'القاهرة' },
    country: 'Egypt',
    countryCode: 'EG',
    lat: 30.0444,
    lng: 31.2357,
    timezone: 'Africa/Cairo',
  },
  {
    id: 'dubai',
    name: 'Dubai',
    nativeNames: { uz: 'Dubay', ru: 'Дубай', en: 'Dubai', ar: 'دبي' },
    country: 'United Arab Emirates',
    countryCode: 'AE',
    lat: 25.2048,
    lng: 55.2708,
    timezone: 'Asia/Dubai',
  },
  {
    id: 'doha',
    name: 'Doha',
    nativeNames: { uz: 'Doha', ru: 'Доха', en: 'Doha', ar: 'الدوحة' },
    country: 'Qatar',
    countryCode: 'QA',
    lat: 25.2854,
    lng: 51.5310,
    timezone: 'Asia/Qatar',
  },
  {
    id: 'london',
    name: 'London',
    nativeNames: { uz: 'London', ru: 'Лондон', en: 'London', ar: 'لندن' },
    country: 'United Kingdom',
    countryCode: 'GB',
    lat: 51.5074,
    lng: -0.1278,
    timezone: 'Europe/London',
  },
  {
    id: 'paris',
    name: 'Paris',
    nativeNames: { uz: 'Parij', ru: 'Париж', en: 'Paris', ar: 'باريس' },
    country: 'France',
    countryCode: 'FR',
    lat: 48.8566,
    lng: 2.3522,
    timezone: 'Europe/Paris',
  },
  {
    id: 'berlin',
    name: 'Berlin',
    nativeNames: { uz: 'Berlin', ru: 'Берлин', en: 'Berlin', ar: 'برلين' },
    country: 'Germany',
    countryCode: 'DE',
    lat: 52.5200,
    lng: 13.4050,
    timezone: 'Europe/Berlin',
  },
  {
    id: 'moscow',
    name: 'Moscow',
    nativeNames: { uz: 'Moskva', ru: 'Москва', en: 'Moscow', ar: 'موسكو' },
    country: 'Russia',
    countryCode: 'RU',
    lat: 55.7558,
    lng: 37.6173,
    timezone: 'Europe/Moscow',
  },
  {
    id: 'new-york',
    name: 'New York',
    nativeNames: { uz: 'Nyu-York', ru: 'Нью-Йорк', en: 'New York', ar: 'نيويورك' },
    country: 'United States',
    countryCode: 'US',
    lat: 40.7128,
    lng: -74.0060,
    timezone: 'America/New_York',
  },
  {
    id: 'toronto',
    name: 'Toronto',
    nativeNames: { uz: 'Toronto', ru: 'Торонто', en: 'Toronto', ar: 'تورونتو' },
    country: 'Canada',
    countryCode: 'CA',
    lat: 43.6532,
    lng: -79.3832,
    timezone: 'America/Toronto',
  },
  {
    id: 'tokyo',
    name: 'Tokyo',
    nativeNames: { uz: 'Tokio', ru: 'Токио', en: 'Tokyo', ar: 'طوكيو' },
    country: 'Japan',
    countryCode: 'JP',
    lat: 35.6762,
    lng: 139.6503,
    timezone: 'Asia/Tokyo',
  },
  {
    id: 'kuala-lumpur',
    name: 'Kuala Lumpur',
    nativeNames: { uz: 'Kuala-Lumpur', ru: 'Куала-Лумпур', en: 'Kuala Lumpur', ar: 'كوالالمبور' },
    country: 'Malaysia',
    countryCode: 'MY',
    lat: 3.1390,
    lng: 101.6869,
    timezone: 'Asia/Kuala_Lumpur',
  },
  {
    id: 'jakarta',
    name: 'Jakarta',
    nativeNames: { uz: 'Jakarta', ru: 'Джакарта', en: 'Jakarta', ar: 'جاكرتا' },
    country: 'Indonesia',
    countryCode: 'ID',
    lat: -6.2088,
    lng: 106.8456,
    timezone: 'Asia/Jakarta',
  },
  {
    id: 'sydney',
    name: 'Sydney',
    nativeNames: { uz: 'Sidney', ru: 'Сидней', en: 'Sydney', ar: 'سيدني' },
    country: 'Australia',
    countryCode: 'AU',
    lat: -33.8688,
    lng: 151.2093,
    timezone: 'Australia/Sydney',
  },
];

/**
 * Compiled immutable catalog of cities with pre-computed Qibla azimuth and distances.
 */
export const CITIES: readonly CityPreset[] = Object.freeze(
  RAW_CITIES.map((raw): CityPreset => {
    const qiblaBearing = calculateQiblaBearing(raw.lat, raw.lng);
    const distanceKm = calculateDistanceToKaaba(raw.lat, raw.lng);

    return Object.freeze({
      id: raw.id,
      name: raw.name,
      nativeNames: Object.freeze({ ...raw.nativeNames }),
      country: raw.country,
      countryCode: raw.countryCode,
      region: raw.region,
      coordinates: Object.freeze({ lat: raw.lat, lng: raw.lng }),
      timezone: raw.timezone,
      qiblaBearing,
      distanceKm,
    });
  })
);

/**
 * Subsets for convenient regional rendering
 */
export const UZBEKISTAN_CITIES: readonly CityPreset[] = Object.freeze(
  CITIES.filter((city) => city.countryCode === 'UZ')
);

export const INTERNATIONAL_CITIES: readonly CityPreset[] = Object.freeze(
  CITIES.filter((city) => city.countryCode !== 'UZ')
);

/**
 * Fast O(1) slug map lookup index
 */
const CITY_MAP = new Map<string, CityPreset>();
for (const city of CITIES) {
  CITY_MAP.set(city.id.toLowerCase(), city);
}

/**
 * Normalizes a search query or city string:
 * removes Uzbek apostrophes, lowercases, and trims.
 */
function normalizeSearchText(text: string): string {
  return text
    .toLowerCase()
    .replace(/['`’ʻ]/g, '')
    .trim();
}

/**
 * Resolves a city preset by its unique slug identifier.
 *
 * @param id Unique city identifier (e.g., 'tashkent', 'makkah')
 * @returns CityPreset if found, undefined otherwise
 */
export function findCityById(id: string): CityPreset | undefined {
  if (!id || typeof id !== 'string') {
    return undefined;
  }
  return CITY_MAP.get(id.trim().toLowerCase());
}

/**
 * Fast search helper querying city names across Uzbek, Russian, English, Arabic,
 * country name, country code, and slug.
 *
 * Employs relevance scoring:
 *   1. Exact name / id match
 *   2. Prefix match on primary or native names
 *   3. Prefix match on country
 *   4. Substring match
 *
 * @param query Free-text search term
 * @returns Filtered, relevance-ranked list of matching CityPresets
 */
export function searchCities(query: string): CityPreset[] {
  if (!query || typeof query !== 'string' || query.trim() === '') {
    return [...CITIES];
  }

  const cleanQuery = normalizeSearchText(query.slice(0, 100));
  if (cleanQuery === '') {
    return [...CITIES];
  }

  type ScoredCity = {
    city: CityPreset;
    score: number;
  };

  const scored: ScoredCity[] = [];

  for (const city of CITIES) {
    const cleanId = normalizeSearchText(city.id);
    const cleanName = normalizeSearchText(city.name);
    const cleanUz = normalizeSearchText(city.nativeNames.uz);
    const cleanRu = normalizeSearchText(city.nativeNames.ru);
    const cleanEn = normalizeSearchText(city.nativeNames.en);
    const cleanAr = city.nativeNames.ar ? normalizeSearchText(city.nativeNames.ar) : '';
    const cleanCountry = normalizeSearchText(city.country);
    const cleanCode = city.countryCode.toLowerCase();

    // 1. Exact match (highest priority)
    if (
      cleanId === cleanQuery ||
      cleanName === cleanQuery ||
      cleanUz === cleanQuery ||
      cleanRu === cleanQuery ||
      cleanEn === cleanQuery ||
      cleanCode === cleanQuery
    ) {
      scored.push({ city, score: 100 });
      continue;
    }

    // 2. Starts with query (prefix match)
    if (
      cleanName.startsWith(cleanQuery) ||
      cleanUz.startsWith(cleanQuery) ||
      cleanRu.startsWith(cleanQuery) ||
      cleanEn.startsWith(cleanQuery) ||
      cleanId.startsWith(cleanQuery) ||
      (cleanAr !== '' && cleanAr.startsWith(cleanQuery))
    ) {
      scored.push({ city, score: 80 });
      continue;
    }

    // 3. Country prefix match
    if (cleanCountry.startsWith(cleanQuery)) {
      scored.push({ city, score: 60 });
      continue;
    }

    // 4. Substring match
    if (
      cleanName.includes(cleanQuery) ||
      cleanUz.includes(cleanQuery) ||
      cleanRu.includes(cleanQuery) ||
      cleanEn.includes(cleanQuery) ||
      cleanId.includes(cleanQuery) ||
      cleanCountry.includes(cleanQuery) ||
      (cleanAr !== '' && cleanAr.includes(cleanQuery))
    ) {
      scored.push({ city, score: 40 });
      continue;
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.city);
}
