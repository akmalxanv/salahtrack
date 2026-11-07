/**
 * SalahTrack Centralized Hijri (Islamic) Calendar Engine
 *
 * Provides authentic, timezone-resilient Hijri date calculations,
 * Umm al-Qura astronomical lunar calendar conversions, moon sighting adjustments (±1 day),
 * Arabic numeral conversions, and localized month names across Uzbek, Russian, and English.
 *
 * Governing Standard: AGENTS.md
 */

import type { Language } from '@/locales/translations';

export interface HijriDateInfo {
  year: number;               // e.g. 1448
  month: number;              // 1 to 12
  day: number;                // 1 to 30
  monthNameArabic: string;    // e.g. 'جُمَادَى الأُولَى'
  monthNameLocalized: string; // e.g. 'Jumodul avval' / 'Джумада аль-уля' / 'Jumada al-Ula'
  arabicDay: string;          // e.g. '٢٧'
  arabicYear: string;         // e.g. '١٤٤٨'
  formatted: string;          // e.g. '27-Jumodul avval, 1448 hijriy'
  formattedArabic: string;    // e.g. '٢٧ جمادى الأولى ١٤٤٨ هـ'
  era: string;                // 'hijriy' / 'г. хиджры' / 'AH'
  arabicEra: string;          // 'هـ'
}

export interface HijriMonthDay {
  hijriDay: number;
  hijriMonth: number;
  hijriYear: number;
  gregorianDateStr: string;   // 'YYYY-MM-DD'
  dayOfWeek: number;          // 0 = Monday, ..., 6 = Sunday (ISO standard Monday-first)
  isToday: boolean;
  isFuture: boolean;
}

export const HIJRI_MONTHS = {
  ar: [
    'المُحَرَّم',
    'صَفَر',
    'رَبِيع الأَوَّل',
    'رَبِيع الآخِر',
    'جُمَادَى الأُولَى',
    'جُمَادَى الآخِرَة',
    'رَجَب',
    'شَعْبَان',
    'رَمَضَان',
    'شَوَّال',
    'ذُو القَعْدَة',
    'ذُو الحِجَّة',
  ],
  uz: [
    'Muharram',
    'Safar',
    'Rabiʼul avval',
    'Rabiʼus soniy',
    'Jumodul avval',
    'Jumodus soniy',
    'Rajab',
    'Shaʼbon',
    'Ramazon',
    'Shavvol',
    'Zulqaʼda',
    'Zulhijja',
  ],
  ru: [
    'Мухаррам',
    'Сафар',
    'Раби аль-авваль',
    'Раби аль-ахир',
    'Джумада аль-уля',
    'Джумада аль-ахира',
    'Раджаб',
    'Шаабан',
    'Рамадан',
    'Шавваль',
    'Зуль-каада',
    'Зуль-хиджа',
  ],
  en: [
    'Muharram',
    'Safar',
    "Rabi' al-Awwal",
    "Rabi' al-Thani",
    'Jumada al-Ula',
    'Jumada al-Akhirah',
    'Rajab',
    "Sha'ban",
    'Ramadan',
    'Shawwal',
    "Dhu al-Qi'dah",
    'Dhu al-Hijjah',
  ],
} as const;

const UZ_SHORT_MONTHS = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
const RU_SHORT_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const EN_SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

/**
 * Converts Western Arabic digits (0-9) to Eastern Arabic-Indic numerals (٠-٩)
 */
export function toArabicNumerals(num: number | string): string {
  return String(num).replace(/\d/g, (d) => ARABIC_DIGITS[parseInt(d, 10)] || d);
}

/**
 * Parses any date input safely into { year, monthIndex (0-11), day } at local midday
 * to prevent timezone drift across DST or UTC boundaries.
 */
function parseSafeDateInput(dateInput: Date | string | unknown): { year: number; monthIndex: number; day: number } {
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const monthIndex = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      if (!isNaN(year) && monthIndex >= 0 && monthIndex <= 11 && day >= 1 && day <= 31) {
        return { year, monthIndex, day };
      }
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return { year: d.getFullYear(), monthIndex: d.getMonth(), day: d.getDate() };
    }
  } else if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    return {
      year: dateInput.getFullYear(),
      monthIndex: dateInput.getMonth(),
      day: dateInput.getDate(),
    };
  }

  const now = new Date();
  return { year: now.getFullYear(), monthIndex: now.getMonth(), day: now.getDate() };
}

/**
 * Calculates raw Hijri components { year, month (1-12), day (1-30) }
 * using Intl `islamic-umalqura` calendar with optional sighting offset.
 */
export function getHijriParts(
  dateInput: Date | string,
  adjustment: number = 0
): { year: number; month: number; day: number } {
  const { year, monthIndex, day } = parseSafeDateInput(dateInput);
  // Construct date at midday (12:00:00) with sighting offset applied in days
  const d = new Date(year, monthIndex, day + adjustment, 12, 0, 0);

  try {
    const fmt = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'numeric',
      year: 'numeric',
    });
    const parts = fmt.formatToParts(d);
    let hDay = 1;
    let hMonth = 1;
    let hYear = 1448;

    for (const p of parts) {
      if (p.type === 'day') hDay = parseInt(p.value, 10);
      if (p.type === 'month') hMonth = parseInt(p.value, 10);
      if (p.type === 'year') hYear = parseInt(p.value, 10);
    }

    if (hMonth >= 1 && hMonth <= 12 && hDay >= 1 && hDay <= 30) {
      return { year: hYear, month: hMonth, day: hDay };
    }
  } catch {
    // Fallback if Intl calendar throws
  }

  // Algorithmic civil fallback (Kuwaiti algorithm)
  const dt = new Date(year, monthIndex, day + adjustment, 12, 0, 0);
  const dVal = dt.getDate();
  let mVal = dt.getMonth() + 1;
  let yVal = dt.getFullYear();

  if (mVal < 3) {
    yVal -= 1;
    mVal += 12;
  }

  const a = Math.floor(yVal / 100);
  const b = 2 - a + Math.floor(a / 4);
  const jd = Math.floor(365.25 * (yVal + 4716)) + Math.floor(30.6001 * (mVal + 1)) + dVal + b - 1524;
  let bJd = jd - 1948440 + 10632;
  const n = Math.floor((bJd - 1) / 10631);
  bJd = bJd - 10631 * n + 354;
  const j = Math.floor((10985 - bJd) / 5316) * Math.floor((50 * bJd) / 17719) +
            Math.floor(bJd / 5670) * Math.floor((43 * bJd) / 15238);
  bJd = bJd - Math.floor((30 - j) / 15) * Math.floor((17719 * j) / 50) -
        Math.floor(j / 16) * Math.floor((15238 * j) / 43) + 29;
  const mH = Math.floor((24 * bJd) / 709);
  const dH = bJd - Math.floor((709 * mH) / 24);
  const yH = 30 * n + j - 30;

  return {
    year: Math.max(1400, Math.min(1500, yH)),
    month: Math.max(1, Math.min(12, mH)),
    day: Math.max(1, Math.min(30, dH)),
  };
}

/**
 * Returns complete localized Hijri date details with Arabic calligraphy and localized text
 */
export function getHijriDate(
  dateInput: Date | string,
  lang: Language = 'uz',
  adjustment: number = 0
): HijriDateInfo {
  const parts = getHijriParts(dateInput, adjustment);
  const monthIdx = parts.month - 1;

  const monthNameArabic = HIJRI_MONTHS.ar[monthIdx] || 'المُحَرَّم';
  const monthNameLocalized =
    lang === 'uz'
      ? HIJRI_MONTHS.uz[monthIdx]
      : lang === 'ru'
      ? HIJRI_MONTHS.ru[monthIdx]
      : HIJRI_MONTHS.en[monthIdx];

  const arabicDay = toArabicNumerals(parts.day);
  const arabicYear = toArabicNumerals(parts.year);

  let era = 'AH';
  if (lang === 'uz') era = 'hijriy';
  else if (lang === 'ru') era = 'г. хиджры';

  const arabicEra = 'هـ';

  // Format localized string
  let formatted = '';
  if (lang === 'uz') {
    formatted = `${parts.day}-${monthNameLocalized}, ${parts.year} ${era}`;
  } else if (lang === 'ru') {
    formatted = `${parts.day} ${monthNameLocalized} ${parts.year} ${era}`;
  } else {
    formatted = `${parts.day} ${monthNameLocalized} ${parts.year} ${era}`;
  }

  const formattedArabic = `${arabicDay} ${monthNameArabic} ${arabicYear} ${arabicEra}`;

  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    monthNameArabic,
    monthNameLocalized,
    arabicDay,
    arabicYear,
    formatted,
    formattedArabic,
    era,
    arabicEra,
  };
}

/**
 * Formats a localized Hijri date string for quick display (e.g. badges, headers)
 */
export function formatHijriDateString(
  dateInput: Date | string = new Date(),
  lang: Language = 'uz',
  adjustment: number = 0
): string {
  return getHijriDate(dateInput, lang, adjustment).formatted;
}

/**
 * Retrieves all days (1 to 29 or 30) for a specific Hijri month and year,
 * mapping each day to its exact Gregorian date and Monday-first day of week (0 = Monday, ..., 6 = Sunday).
 */
export function getHijriMonthDays(
  targetYear: number,
  targetMonth: number,
  adjustment: number = 0
): HijriMonthDay[] {
  const today = new Date();
  const currentH = getHijriParts(today, adjustment);
  const monthDiff = (targetYear - currentH.year) * 12 + (targetMonth - currentH.month);

  // Estimate the Gregorian anchor date for target month (~29.53 days per lunar month)
  const est = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12, 0, 0);
  est.setDate(est.getDate() + Math.round(monthDiff * 29.530588));

  // Refine to find the exact target (targetYear, targetMonth)
  const cur = new Date(est);
  let h = getHijriParts(cur, adjustment);
  let limit = 0;
  while ((h.year !== targetYear || h.month !== targetMonth) && limit < 40) {
    const diff = (targetYear - h.year) * 12 + (targetMonth - h.month);
    if (diff > 0) cur.setDate(cur.getDate() + 1);
    else cur.setDate(cur.getDate() - 1);
    h = getHijriParts(cur, adjustment);
    limit++;
  }

  // Walk backwards to find day 1 of the target Hijri month
  limit = 0;
  while (h.year === targetYear && h.month === targetMonth && h.day > 1 && limit < 35) {
    cur.setDate(cur.getDate() - 1);
    h = getHijriParts(cur, adjustment);
    limit++;
  }

  // Correct if stepped into previous month
  while (h.year !== targetYear || h.month !== targetMonth) {
    cur.setDate(cur.getDate() + 1);
    h = getHijriParts(cur, adjustment);
  }

  // Format today's string 'YYYY-MM-DD'
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate()
  ).padStart(2, '0')}`;

  // Collect all days in this lunar month
  const days: HijriMonthDay[] = [];
  while (h.year === targetYear && h.month === targetMonth) {
    const yStr = cur.getFullYear();
    const mStr = String(cur.getMonth() + 1).padStart(2, '0');
    const dStr = String(cur.getDate()).padStart(2, '0');
    const gregorianDateStr = `${yStr}-${mStr}-${dStr}`;

    const rawDay = cur.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
    const dayOfWeek = (rawDay + 6) % 7; // Convert to Mon = 0, ..., Sun = 6

    const isToday = gregorianDateStr === todayStr;
    const isFuture = gregorianDateStr > todayStr;

    days.push({
      hijriDay: h.day,
      hijriMonth: h.month,
      hijriYear: h.year,
      gregorianDateStr,
      dayOfWeek,
      isToday,
      isFuture,
    });

    cur.setDate(cur.getDate() + 1);
    h = getHijriParts(cur, adjustment);
  }

  return days;
}

/**
 * Formats a short Gregorian date string for compact calendar day subtext (e.g. '7 Nov' / '7-noy' / '7 ноя')
 */
export function formatShortGregorianDate(dateStr: string, lang: Language = 'uz'): string {
  const parts = dateStr.split('-');
  if (parts.length < 3) return dateStr;
  const day = parseInt(parts[2], 10);
  const mIdx = parseInt(parts[1], 10) - 1;

  if (isNaN(day) || mIdx < 0 || mIdx > 11) return dateStr;

  if (lang === 'uz') {
    return `${day}-${UZ_SHORT_MONTHS[mIdx]}`;
  }
  if (lang === 'ru') {
    return `${day} ${RU_SHORT_MONTHS[mIdx]}`;
  }
  return `${day} ${EN_SHORT_MONTHS[mIdx]}`;
}
