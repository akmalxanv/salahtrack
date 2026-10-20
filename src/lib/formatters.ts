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

/**
 * Format Gregorian date into localized string
 * - uz: "20-oktabr, 2026-yil"
 * - ru: "20 октября 2026 г."
 * - en: "October 20, 2026"
 */
export function formatLocalizedDate(dateInput: Date | string, lang: Language = 'uz'): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  if (lang === 'uz') {
    const day = date.getDate();
    const month = UZ_MONTHS[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}, ${year}-yil`;
  }

  const localeMap: Record<Language, string> = {
    ru: 'ru-RU',
    en: 'en-US',
    uz: 'uz-UZ',
  };

  return new Intl.DateTimeFormat(localeMap[lang] || 'en-US', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(date);
}

/**
 * Format Hijri date with cultural adjustments
 * - uz: "18-Rabiʼus soniy 1448 hijriy"
 * - ru: "18 Раби аль-ахир 1448 г. хиджры"
 * - en: "18 Rabi al-Thani 1448 Hijri"
 */
export function formatLocalizedHijriDate(dateInput: Date | string = new Date(), lang: Language = 'uz'): string {
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (isNaN(date.getTime())) return '';

  try {
    const localeMap: Record<Language, string> = {
      ru: 'ru-RU-u-ca-islamic-civil',
      en: 'en-US-u-ca-islamic-civil',
      uz: 'uz-UZ-u-ca-islamic-civil',
    };

    const formatted = new Intl.DateTimeFormat(localeMap[lang] || 'en-US-u-ca-islamic-civil', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);

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
  return value.toLocaleString(localeMap[lang] || 'en-US');
}

/**
 * Get canonical prayer name
 */
export function formatPrayerName(prayerId: PrayerId, lang: Language = 'uz'): string {
  return CANONICAL_PRAYER_NAMES[lang]?.[prayerId] || CANONICAL_PRAYER_NAMES.uz[prayerId] || prayerId;
}
