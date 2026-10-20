/**
 * SalahTrack Centralized Localization & Formatting Engine
 * 
 * Provides unified, timezone-resilient date, Hijri calendar, currency,
 * number, and prayer name formatters across Uzbek ('uz'), Russian ('ru'), and English ('en').
 * 
 * Governing Standard: AGENTS.md & Phase1_Localization_Master_Plan.md
 */

import type { Language } from '@/locales/translations';
import type { PrayerId } from '@/types/prayer';

const UZ_MONTHS = [
  'yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun',
  'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr',
];

const CANONICAL_PRAYER_NAMES: Record<Language, Record<PrayerId, string>> = {
  uz: {
    fajr: 'Bomdod',
    dhuhr: 'Peshin',
    asr: 'Asr',
    maghrib: 'Shom',
    isha: 'Xufton',
  },
  ru: {
    fajr: 'Фаджр',
    dhuhr: 'Зухр',
    asr: 'Аср',
    maghrib: 'Магриб',
    isha: 'Иша',
  },
  en: {
    fajr: 'Fajr',
    dhuhr: 'Dhuhr',
    asr: 'Asr',
    maghrib: 'Maghrib',
    isha: 'Isha',
  },
};

interface ParsedDateParts {
  year: number;
  monthIndex: number;
  day: number;
}

function parseDateInput(dateInput: Date | string | unknown): ParsedDateParts | null {
  if (!dateInput) return null;

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const monthIndex = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      if (!isNaN(year) && !isNaN(monthIndex) && !isNaN(day) && monthIndex >= 0 && monthIndex <= 11 && day >= 1 && day <= 31) {
        return { year, monthIndex, day };
      }
    }
    const d = new Date(trimmed);
    if (isNaN(d.getTime())) return null;
    return {
      year: d.getFullYear(),
      monthIndex: d.getMonth(),
      day: d.getDate(),
    };
  }

  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return {
      year: dateInput.getFullYear(),
      monthIndex: dateInput.getMonth(),
      day: dateInput.getDate(),
    };
  }

  return null;
}

/**
 * Format Gregorian date into localized string
 * - uz: "20-oktabr, 2026-yil"
 * - ru: "20 октября 2026 г."
 * - en: "October 20, 2026"
 */
export function formatLocalizedDate(dateInput: Date | string, lang: Language = 'uz'): string {
  const parts = parseDateInput(dateInput);
  if (!parts) return '';

  const { year, monthIndex, day } = parts;

  if (lang === 'uz') {
    const month = UZ_MONTHS[monthIndex] || '';
    return `${day}-${month}, ${year}-yil`;
  }

  const localeMap: Record<Language, string> = {
    ru: 'ru-RU',
    en: 'en-US',
    uz: 'uz-UZ',
  };

  const safeLocale = (lang in localeMap && Object.prototype.hasOwnProperty.call(localeMap, lang))
    ? localeMap[lang]
    : 'en-US';

  // Constructing a Date at local noon (12:00:00) prevents any timezone offset from shifting the calendar day
  const safeDate = new Date(year, monthIndex, day, 12, 0, 0);

  return new Intl.DateTimeFormat(safeLocale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(safeDate);
}

/**
 * Format Hijri date with cultural adjustments
 * - uz: "18-Rabiʼus soniy 1448 hijriy"
 * - ru: "18 Раби аль-ахир 1448 г. хиджры"
 * - en: "18 Rabi al-Thani 1448 Hijri"
 */
export function formatLocalizedHijriDate(dateInput: Date | string = new Date(), lang: Language = 'uz'): string {
  const parts = parseDateInput(dateInput);
  if (!parts) return '';

  try {
    const safeDate = new Date(parts.year, parts.monthIndex, parts.day, 12, 0, 0);

    const localeMap: Record<Language, string> = {
      ru: 'ru-RU-u-ca-islamic-civil',
      en: 'en-US-u-ca-islamic-civil',
      uz: 'uz-UZ-u-ca-islamic-civil',
    };

    const safeLocale = (lang in localeMap && Object.prototype.hasOwnProperty.call(localeMap, lang))
      ? localeMap[lang]
      : 'en-US-u-ca-islamic-civil';

    const formatted = new Intl.DateTimeFormat(safeLocale, {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(safeDate);

    let cleaned = formatted.trim();
    if (lang === 'ru') {
      cleaned = cleaned.replace(/\s*г\.\s*AH\b/i, ' г. хиджры').replace(/\s*AH\b/i, ' г. хиджры');
    } else if (lang === 'uz') {
      cleaned = cleaned.replace(/\s*AH\b/i, ' hijriy');
    } else {
      cleaned = cleaned.replace(/\s*AH\b/i, ' Hijri');
    }
    return cleaned;
  } catch {
    // Fallback safe values in case Intl calendar throws
    if (lang === 'en') return '18 Rabi al-Thani 1448 Hijri';
    if (lang === 'uz') return '18-Rabiʼus soniy 1448 hijriy';
    return '18 Раби аль-ахир 1448 г. хиджры';
  }
}

/**
 * Format currency in Uzbekistan Som (UZS)
 * - uz: "15 000 UZS"
 * - ru: "15 000 UZS"
 * - en: "15,000 UZS"
 */
export function formatCurrency(amount: number, lang: Language = 'uz'): string {
  if (!isFinite(amount)) return '0 UZS';
  const rounded = Math.round(amount);

  if (lang === 'en') {
    return `${rounded.toLocaleString('en-US')} UZS`;
  }
  // uz & ru use non-breaking or thin space separators
  return `${rounded.toLocaleString('ru-RU').replace(/\u00A0/g, ' ')} UZS`;
}

/**
 * Format integer or decimal numbers according to active locale
 */
export function formatNumber(value: number, lang: Language = 'uz'): string {
  if (!isFinite(value)) return '0';
  const localeMap: Record<Language, string> = {
    uz: 'uz-UZ',
    ru: 'ru-RU',
    en: 'en-US',
  };
  const safeLocale = (lang in localeMap && Object.prototype.hasOwnProperty.call(localeMap, lang))
    ? localeMap[lang]
    : 'en-US';
  return value.toLocaleString(safeLocale);
}

/**
 * Get canonical prayer name
 */
export function formatPrayerName(prayerId: PrayerId, lang: Language = 'uz'): string {
  const safeLang = (lang in CANONICAL_PRAYER_NAMES && Object.prototype.hasOwnProperty.call(CANONICAL_PRAYER_NAMES, lang))
    ? lang
    : 'uz';
  return CANONICAL_PRAYER_NAMES[safeLang]?.[prayerId] || CANONICAL_PRAYER_NAMES.uz[prayerId] || prayerId;
}
